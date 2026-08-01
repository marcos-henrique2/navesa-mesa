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

import { formatBRL, formatInt } from "@/lib/utils";
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

// ─── Variante de NEGOCIAÇÃO (compre-por + gancho FIPE) ───────────────────────
//
// Diferente do 'visualizou' puro (que NÃO cita preço), esta variante é o argumento
// de venda pro interessado que já viu o anúncio: inclui o compre-por (preço do
// anúncio) e, se o compre-por estiver abaixo da FIPE, o gancho "abaixo da tabela
// FIPE". Degrada sem "undefined" quando falta dado. Continua PURA e testável.

/** Argumentos de venda opcionais (dados do carro). Nulos degradam a mensagem. */
export type ArgumentosVenda = {
  /** Preço do anúncio (valor_compre_por). null → sem linha de preço. */
  comprePor: number | null;
  /** Tabela FIPE. Gancho só aparece se comprePor < fipe. */
  fipe: number | null;
};

function isNumFinito(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Monta o parágrafo com o argumento de venda. Retorna "" (sem linha) quando não
 * há compre-por — nunca vaza "undefined"/"NaN". O gancho FIPE só entra quando a
 * FIPE existe E o compre-por está abaixo dela.
 */
export function montarGanchoVenda(args: ArgumentosVenda): string {
  if (!isNumFinito(args.comprePor)) return "";
  let s = `Ela está anunciada por ${formatBRL(args.comprePor)}`;
  if (isNumFinito(args.fipe) && args.comprePor < args.fipe) {
    s += ` — abaixo da tabela FIPE (${formatBRL(args.fipe)})`;
  }
  return `${s}.`;
}

/**
 * Mensagem de reaquecimento COM argumento de venda. Base 'visualizou' + gancho
 * de preço/FIPE (quando houver). Sem gancho, cai numa mensagem equivalente à
 * 'visualizou'.
 */
export function gerarMensagemNegociacao(
  carro: CarroOfertavel,
  lead: LeadMinimo,
  args: ArgumentosVenda,
): string {
  const nome = primeiroNome(lead.nome);
  const linhas: string[] = [
    `Olá, ${nome}! Aqui é o Marcos, da Mesa de Repasse do Grupo Navesa.`,
    ``,
    `Vi que você se interessou pela ${descricaoCarro(carro)} que anunciei no Auto Avaliar.`,
    ``,
  ];

  const gancho = montarGanchoVenda(args);
  if (gancho) {
    linhas.push(gancho, ``);
  }

  linhas.push(
    `Ela ainda está disponível! Rolou interesse de fechar negócio? Ficou alguma dúvida sobre o carro ou a documentação?`,
    ``,
    `Me diz o que falta que eu vejo o que dá pra fazer pra gente fechar. 🤝`,
  );

  return linhas.join("\n");
}
