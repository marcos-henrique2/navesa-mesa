/**
 * Cache em memória do snapshot (doc §1.4).
 *
 * - Dentro do TTL (5 min): serve direto.
 * - Passou do TTL: roda a query barata de assinatura; igual → renova o TTL,
 *   diferente → recarrega tudo.
 * - Idade máxima: recarrega mesmo com assinatura igual (pega upsert que não mexe
 *   em count/max(atualizado_em), ex. reupload manual do mesmo período).
 * - Uma carga/checagem por vez (single-flight); falha com cache antigo presente
 *   serve o antigo marcado como `desatualizado` em vez de derrubar a pergunta.
 */
import type { Snapshot } from "@cerebro/data/loader";

export type FontesCache = {
  carregar: () => Promise<Snapshot>;
  assinatura: () => Promise<string>;
};

export type EstadoCache = { snapshot: Snapshot; desatualizado: boolean };

export class CacheSnapshot {
  private atual: Snapshot | null = null;
  private verificadoEm = 0;
  private carregadoEm = 0;
  private emVoo: Promise<EstadoCache> | null = null;

  constructor(
    private readonly fontes: FontesCache,
    private readonly opts: { ttlMs: number; idadeMaxMs: number; agora?: () => number; onErro?: (e: unknown) => void },
  ) {}

  private agora(): number {
    return this.opts.agora ? this.opts.agora() : Date.now();
  }

  /** Último snapshot carregado, sem I/O (para o /v1/health). */
  espiar(): Snapshot | null {
    return this.atual;
  }

  async obter(): Promise<EstadoCache> {
    const t = this.agora();
    if (this.atual && t - this.verificadoEm < this.opts.ttlMs) {
      return { snapshot: this.atual, desatualizado: false };
    }
    if (!this.emVoo) {
      this.emVoo = this.atualizar().finally(() => {
        this.emVoo = null;
      });
    }
    return this.emVoo;
  }

  private async recarregar(): Promise<EstadoCache> {
    const snap = await this.fontes.carregar();
    this.atual = snap;
    this.verificadoEm = this.carregadoEm = this.agora();
    return { snapshot: snap, desatualizado: false };
  }

  private async atualizar(): Promise<EstadoCache> {
    const antigo = this.atual;
    try {
      if (!antigo) return await this.recarregar();
      if (this.agora() - this.carregadoEm >= this.opts.idadeMaxMs) return await this.recarregar();
      const assinatura = await this.fontes.assinatura();
      if (assinatura !== antigo.assinatura) return await this.recarregar();
      this.verificadoEm = this.agora();
      return { snapshot: antigo, desatualizado: false };
    } catch (err) {
      if (!antigo) throw err;
      this.opts.onErro?.(err);
      return { snapshot: antigo, desatualizado: true };
    }
  }
}
