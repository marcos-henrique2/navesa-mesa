/**
 * Gerador do texto de anúncio de repasse (B2B / Auto Avaliar).
 *
 * Função PURA: recebe o repasse + config de regras fixas e devolve o texto
 * pronto pra colar no campo de observação do Auto Avaliar. Sem side effects,
 * sem `Date.now`, sem I/O — 100% testável.
 *
 * O template foi aprovado pelo Marcos. NÃO inclui itens avaliados nem laudo
 * (cautelar) — esses sobem separados no Auto Avaliar. Por isso
 * `cautelar_status_manual` é ignorado de propósito aqui.
 */

import { formatInt } from "@/lib/utils";
import { ANUNCIO_CONFIG, type AnuncioConfig } from "@/lib/repasses/anuncio-config";
import type { Repasse } from "@/lib/repasses/types";

const SEP = "------------------------------------------------";

/** Monta o título "ANO_FAB/ANO_MODELO", tolerando um dos dois nulo. */
function formatAno(fab: number | null, modelo: number | null): string {
  if (fab != null && modelo != null) return `${fab}/${modelo}`;
  if (fab != null) return String(fab);
  if (modelo != null) return String(modelo);
  return "";
}

/** Linha condicional de IPVA. `null` se não deve aparecer. */
function linhaIpva(repasse: Repasse): string | null {
  switch (repasse.ipva_status) {
    case "pago":
      return "- IPVA 2026: PAGO";
    case "em_aberto":
      return "- IPVA 2026: A PAGAR PELO COMPRADOR";
    default:
      // nao_verificado ou null → omite
      return null;
  }
}

/** Linha condicional de documentação. `null` se não deve aparecer. */
function linhaDoc(repasse: Repasse): string | null {
  switch (repasse.documentacao_status) {
    case "ok":
      return "- Documentação: APROVADA, em ordem";
    case "pendente":
      return "- Documentação: PENDENTE";
    case "irregular":
      return "- Documentação: IRREGULAR — verifique antes do lance";
    default:
      // nao_verificado ou null → omite
      return null;
  }
}

export function gerarAnuncioRepasse(repasse: Repasse, config: AnuncioConfig = ANUNCIO_CONFIG): string {
  const ano = formatAno(repasse.ano_fabricacao, repasse.ano_modelo);
  const tituloModelo = ano ? `${repasse.modelo} - ${ano}` : repasse.modelo;

  const km = repasse.km != null ? `${formatInt(repasse.km)} km` : null;
  const corLinha = [repasse.cor, km].filter((p): p is string => Boolean(p)).join(" | ");

  // ─── Situação documental: fixas + condicionais ──────────────────────────
  const documentais: string[] = [];
  const ipva = linhaIpva(repasse);
  if (ipva) documentais.push(ipva);
  const doc = linhaDoc(repasse);
  if (doc) documentais.push(doc);
  documentais.push(`- Tempo de entrega da documentação: ${config.tempoEntregaDoc}`);

  const blocos: string[] = [];

  // Cabeçalho
  blocos.push(tituloModelo);
  if (corLinha) blocos.push(corLinha);
  blocos.push("");
  blocos.push(">> VENDA EXCLUSIVA PARA REVENDEDORES (B2B) - Grupo Navesa / Repasse");

  // Condições da operação
  blocos.push("");
  blocos.push(SEP);
  blocos.push("CONDIÇÕES DA OPERAÇÃO");
  blocos.push(SEP);
  blocos.push("- Veículo vendido NO ESTADO EM QUE SE ENCONTRA");
  blocos.push("- Sem garantia e sem vistoria prévia");
  blocos.push("- Informações e imagens têm caráter informativo");
  blocos.push("- Proposta sujeita à aprovação interna");
  blocos.push("- Pagamento do veículo em até 24 horas");
  blocos.push(`- Retirada em até ${config.prazoRetiradaDias} dias corridos`);
  blocos.push("- Conferência do veículo e da documentação no ato da retirada");
  blocos.push(
    "- O comprador assume integralmente: tributos, multas, transferência, frete, logística e demais encargos",
  );

  // Situação documental
  blocos.push("");
  blocos.push(SEP);
  blocos.push("SITUAÇÃO DOCUMENTAL");
  blocos.push(SEP);
  for (const linha of documentais) blocos.push(linha);

  // Liberação do veículo
  blocos.push("");
  blocos.push(SEP);
  blocos.push("LIBERAÇÃO DO VEÍCULO");
  blocos.push(SEP);
  blocos.push(
    "O veículo será liberado após a confirmação do pagamento do valor combinado, do comunicado de venda e da taxa Auto Avaliar.",
  );

  // Retirada e contato
  blocos.push("");
  blocos.push(SEP);
  blocos.push("RETIRADA E CONTATO");
  blocos.push(SEP);
  blocos.push(`Local de retirada: ${config.localRetirada}`);
  blocos.push("Mesa de Repasse Navesa:");
  blocos.push(`WhatsApp: ${config.whatsapp}`);
  blocos.push(`E-mail: ${config.email}`);

  // Observações (condicional)
  const obs = repasse.observacoes?.trim();
  if (obs) {
    blocos.push("");
    blocos.push(SEP);
    blocos.push("OBSERVAÇÕES");
    blocos.push(SEP);
    blocos.push(obs);
  }

  // Importante
  blocos.push("");
  blocos.push(SEP);
  blocos.push("IMPORTANTE");
  blocos.push(SEP);
  blocos.push(
    "Leia o anúncio com atenção. NÃO temos acesso para efetuar cancelamento - qualquer dúvida, entre em contato ANTES de dar o lance. Ao enviar proposta, o comprador declara ciência e concordância com todas as condições da operação.",
  );

  return blocos.join("\n");
}
