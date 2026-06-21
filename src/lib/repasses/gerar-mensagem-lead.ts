/**
 * Gerador da mensagem de WhatsApp pro lead que visualizou o anúncio no Auto
 * Avaliar (follow-up de repasse).
 *
 * Função PURA: recebe o repasse + o interessado e devolve o texto pronto pra
 * mandar via wa.me. Sem side effects, sem I/O — 100% testável.
 *
 * IMPORTANTE: a mensagem NÃO cita valor/preço — é um primeiro contato pra
 * reaquecer o interesse, não uma proposta.
 */

import { formatInt } from "@/lib/utils";
import type { Repasse } from "@/lib/repasses/types";
import type { RepasseInteressado } from "@/lib/repasses/interessados";

/** Primeiro nome do interessado (primeiro token). Empresa → primeiro token mesmo. */
function primeiroNome(nome: string): string {
  const token = nome.trim().split(/\s+/)[0];
  return token ?? "";
}

/** Ano pra exibir: modelo, senão fabricação. `null` se ambos ausentes. */
function anoExibicao(repasse: Repasse): number | null {
  return repasse.ano_modelo ?? repasse.ano_fabricacao ?? null;
}

export function gerarMensagemLead(repasse: Repasse, interessado: RepasseInteressado): string {
  const nome = primeiroNome(interessado.nome);
  const ano = anoExibicao(repasse);

  // "{MODELO} {ANO}" — omite o ano se ausente.
  const modeloAno = ano != null ? `${repasse.modelo} ${ano}` : repasse.modelo;
  // " (X km)" — omite quando km null.
  const kmTrecho = repasse.km != null ? ` (${formatInt(repasse.km)} km)` : "";

  return [
    `Olá, ${nome}! Aqui é o Marcos, da Mesa de Repasse do Grupo Navesa.`,
    ``,
    `Vi que você se interessou pela ${modeloAno}${kmTrecho} que anunciei no Auto Avaliar.`,
    ``,
    `Ela ainda está disponível! Rolou interesse de fechar negócio? Ficou alguma dúvida sobre o carro ou a documentação?`,
    ``,
    `Me diz o que falta que eu vejo o que dá pra fazer pra gente fechar. 🤝`,
  ].join("\n");
}
