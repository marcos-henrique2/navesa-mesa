/**
 * Gerador da mensagem de WhatsApp pro lead.
 *
 * Função PURA: recebe o carro + o lead + o contexto e devolve o texto pronto
 * pra mandar via wa.me. Sem side effects, sem I/O — 100% testável.
 *
 * IMPORTANTE: a mensagem NÃO cita valor/preço — é um primeiro contato pra
 * reaquecer ou apresentar o carro, não uma proposta.
 *
 * Dois contextos de copy:
 *   - 'visualizou' (reaquecer): o lead VIU o anúncio no Auto Avaliar
 *   - 'oferta' (apresentar): o Marcos está oferecendo um carro novo pro lead
 *
 * Compat: aceita a assinatura antiga `gerarMensagemLead(repasse, interessado)`,
 * que mapeia pra contexto='visualizou' (página de interessados por carro).
 */

import { formatInt } from "@/lib/utils";
import type { Repasse } from "@/lib/repasses/types";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

/** Carro genérico ofertável — fonte unificada (repasse ou estoque). */
export type CarroOfertavel = {
  modelo: string;
  ano: number | null;
  km: number | null;
};

/** Contexto da mensagem — define a copy usada. */
export type ContextoMensagem = "visualizou" | "oferta";

/** Primeiro nome do lead (primeiro token). Empresa → primeiro token mesmo. */
function primeiroNome(nome: string): string {
  const token = nome.trim().split(/\s+/)[0];
  return token ?? "";
}

/** Adaptador: Repasse → CarroOfertavel. Ano = modelo, senão fabricação. */
export function repasseParaCarro(repasse: Repasse): CarroOfertavel {
  return {
    modelo: repasse.modelo,
    ano: repasse.ano_modelo ?? repasse.ano_fabricacao ?? null,
    km: repasse.km,
  };
}

/** Adaptador: VeiculoParsed (estoque) → CarroOfertavel. */
export function veiculoParaCarro(veiculo: VeiculoParsed): CarroOfertavel {
  return {
    modelo: veiculo.modelo,
    ano: veiculo.ano_modelo ?? veiculo.ano_fabricacao ?? null,
    km: veiculo.km,
  };
}

/** "{MODELO} {ANO} (X km)" — omite ano/km quando ausentes. */
function descricaoCarro(carro: CarroOfertavel): string {
  const modeloAno = carro.ano != null ? `${carro.modelo} ${carro.ano}` : carro.modelo;
  const kmTrecho = carro.km != null ? ` (${formatInt(carro.km)} km)` : "";
  return `${modeloAno}${kmTrecho}`;
}

function mensagemVisualizou(nome: string, carro: CarroOfertavel): string {
  return [
    `Olá, ${nome}! Aqui é o Marcos, da Mesa de Repasse do Grupo Navesa.`,
    ``,
    `Vi que você se interessou pela ${descricaoCarro(carro)} que anunciei no Auto Avaliar.`,
    ``,
    `Ela ainda está disponível! Rolou interesse de fechar negócio? Ficou alguma dúvida sobre o carro ou a documentação?`,
    ``,
    `Me diz o que falta que eu vejo o que dá pra fazer pra gente fechar. 🤝`,
  ].join("\n");
}

function mensagemOferta(nome: string, carro: CarroOfertavel): string {
  return [
    `Olá, ${nome}! Aqui é o Marcos, da Mesa de Repasse do Grupo Navesa.`,
    ``,
    `Tenho uma ${descricaoCarro(carro)} que pode te interessar pra repasse.`,
    ``,
    `Quer dar uma olhada? Posso te passar mais detalhes e fotos do carro.`,
    ``,
    `Me avisa que eu já te mando tudo. 🤝`,
  ].join("\n");
}

/** Aceita o lead como objeto `{ nome }` (novo) ou um RepasseInteressado (compat). */
type LeadMinimo = { nome: string };

/**
 * Gera a mensagem de WhatsApp.
 *
 * Sobrecarga nova (preferida):
 *   gerarMensagemLead(carro, { nome }, contexto)
 *
 * Sobrecarga compat (página de interessados por carro):
 *   gerarMensagemLead(repasse, interessado) → contexto='visualizou'
 */
export function gerarMensagemLead(
  carro: CarroOfertavel,
  lead: LeadMinimo,
  contexto: ContextoMensagem,
): string;
export function gerarMensagemLead(repasse: Repasse, interessado: LeadMinimo): string;
export function gerarMensagemLead(
  primeiro: CarroOfertavel | Repasse,
  lead: LeadMinimo,
  contexto?: ContextoMensagem,
): string {
  // Distingue Repasse (tem `id`/`placa`) de CarroOfertavel (só modelo/ano/km).
  const carro: CarroOfertavel =
    "placa" in primeiro ? repasseParaCarro(primeiro) : primeiro;
  const ctx: ContextoMensagem = contexto ?? "visualizou";
  const nome = primeiroNome(lead.nome);

  return ctx === "oferta" ? mensagemOferta(nome, carro) : mensagemVisualizou(nome, carro);
}
