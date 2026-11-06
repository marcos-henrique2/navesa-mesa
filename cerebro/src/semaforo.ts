/**
 * Concorrência do cérebro (doc §2.2): N execuções simultâneas (cada uma spawna
 * um CLI), fila curta com espera máxima; fila cheia ou espera estourada → 429.
 */
import { ErroCerebro } from "@cerebro/erros";

type Espera = { resolver: (liberar: () => void) => void; rejeitar: (e: Error) => void; timer: NodeJS.Timeout };

export class Semaforo {
  private ativos = 0;
  private readonly fila: Espera[] = [];

  constructor(
    private readonly max: number,
    private readonly filaMax: number,
    private readonly esperaMaxMs: number,
  ) {}

  estado() {
    return { ativos: this.ativos, naFila: this.fila.length, max: this.max, filaMax: this.filaMax };
  }

  private retryAfterSeg(): number {
    return Math.max(1, Math.ceil(this.esperaMaxMs / 1000));
  }

  /** Resolve com a função `liberar` (idempotente). `signal` abortado tira da fila. */
  adquirir(signal?: AbortSignal): Promise<() => void> {
    if (this.ativos < this.max) {
      this.ativos++;
      return Promise.resolve(this.criarLiberar());
    }
    if (this.fila.length >= this.filaMax) {
      return Promise.reject(new ErroCerebro("ocupado", "Cérebro ocupado: muitas perguntas ao mesmo tempo.", this.retryAfterSeg()));
    }
    return new Promise((resolver, rejeitar) => {
      const sair = (e: Error) => {
        const i = this.fila.indexOf(espera);
        if (i >= 0) this.fila.splice(i, 1);
        clearTimeout(espera.timer);
        signal?.removeEventListener("abort", onAbort);
        rejeitar(e);
      };
      const onAbort = () => sair(new ErroCerebro("timeout", "Requisição cancelada enquanto aguardava na fila."));
      const espera: Espera = {
        resolver: (liberar) => {
          signal?.removeEventListener("abort", onAbort);
          resolver(liberar);
        },
        rejeitar,
        timer: setTimeout(
          () => sair(new ErroCerebro("ocupado", "Cérebro ocupado: tempo de espera na fila esgotado.", this.retryAfterSeg())),
          this.esperaMaxMs,
        ),
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.fila.push(espera);
    });
  }

  private criarLiberar(): () => void {
    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      const prox = this.fila.shift();
      if (prox) {
        clearTimeout(prox.timer);
        prox.resolver(this.criarLiberar()); // passa o slot adiante sem decrementar
      } else {
        this.ativos--;
      }
    };
  }
}
