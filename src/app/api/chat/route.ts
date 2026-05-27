import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { streamText, type LanguageModel } from "ai";
import type { InsightsBundle } from "@/lib/analytics/insights";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type RequestBody = {
  messages: ChatMessage[];
  bundle: InsightsBundle | null;
  periodo?: { inicio: string | null; fim: string | null } | null;
};

function buildSystemPrompt(bundle: InsightsBundle | null, periodo: RequestBody["periodo"]): string {
  if (!bundle) {
    return `Você é o assistente de análise da Mesa de Precificação da Navesa, concessionária Ford/Renault/GWM/etc. baseada em Goiás.

O usuário ainda não subiu relatórios — peça pra ele ir em /upload e subir os 3 XLSX do NBS (Estoque, Vendas e Custos).
Sem dados, você só responde em alto nível sobre como o sistema funciona.`;
  }

  const fmt = (n: number) =>
    "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return `Você é o assistente de análise da Mesa de Precificação da Navesa (concessionária multi-marca em Goiás).

== CONTEXTO DO PERÍODO ==
Período analisado: ${periodo?.inicio ?? "?"} → ${periodo?.fim ?? "?"}

== SUMÁRIO GLOBAL ==
• ${bundle.sumario.qt} vendas, faturamento ${fmt(bundle.sumario.faturamento)}
• Custo total: ${fmt(bundle.sumario.custo)}
• Margem REAL: ${fmt(bundle.sumario.margem)} (${bundle.sumario.margemPct.toFixed(2)}%)
• Ganhos Indiretos (bônus fábrica + valorização): ${fmt(bundle.sumario.ganhosIndiretos)}
• Margem SEM bônus: ${fmt(bundle.sumario.margemSemBonus)}
• Cobertura de custos oficiais NBS: ${(bundle.sumario.cobertura * 100).toFixed(1)}%
${bundle.sumario.dependeDeBonus ? "• ⚠️ OPERAÇÃO DEPENDE DOS BÔNUS — sem eles, está no prejuízo." : "• ✓ Operação positiva mesmo sem bônus."}

== ESTRUTURA DO JSON (mapa de campos) ==
O JSON abaixo contém TUDO sobre o período. Cada chave responde perguntas específicas:

• **sumario** — visão consolidada (já listado acima)
• **lojas** — margem agregada por loja (ranking)
• **marcas** — margem por marca de carro (RANGER, JEEP, GWM, etc.)
• **giro** — buckets de dias_estoque (0-15d, 16-30d, ..., 180+d) com margem
• **modelosPiores** / **modelosMelhores** — top 15 modelos por margem absoluta
• **trocas** — comparação "com troca" vs "sem troca"
• **vendedoresTop** / **vendedoresPiores** — top 10 e piores 10 vendedores
• **outliersLucro** / **outliersPrejuizo** — top 10 vendas individuais extremas
• **estoque** — estoque ATUAL em risco (carros parados de modelos c/ histórico negativo)
• **clientesRecorrentes** — clientes com 2+ compras
• **topModelosPorLoja** — pra cada loja, os 7 modelos mais vendidos LÁ DENTRO (use pra "qual carro mais sai na loja X?")
• **topMarcasPorLoja** — pra cada loja, as 5 marcas mais vendidas
• **topVendedoresPorLoja** — pra cada loja, os 5 melhores vendedores
• **lojasDeCadaModelo** — pra cada modelo top, em quais lojas é mais vendido (use pra "onde a Ranger XLT mais sai?")
• **vendasPorMes** — série temporal mês a mês (tendência, sazonalidade)
• **vendasPorUF** — distribuição geográfica de clientes (GO, MS, DF, etc.)
• **pfVsPj** — comparação cliente pessoa física vs jurídica (ticket, margem, volume)
• **idadeVeiculo** — buckets de idade do veículo (0-2 anos, 3-5, ...) com margem
• **km** — buckets de quilometragem com margem
• **estoquePorLoja** — distribuição do estoque atual entre lojas
• **estoquePorMarca** — distribuição do estoque atual entre marcas
• **classificacao** — política Auto Avaliar: distribuição A-E + canal Show Room × Repasse + rebaixados por estoque parado

== DADOS ESTRUTURADOS (JSON) ==
Use o JSON abaixo como ÚNICA fonte. Não invente números — sempre cite do JSON.

${JSON.stringify(bundle)}

== INSTRUÇÕES ==
1. Responda em português brasileiro, tom direto e amigável, com termos do mercado automotivo (giro, pátio, F&I, etc.).
2. Cite SEMPRE números do JSON acima. Nunca invente.
3. Use markdown leve (negrito, listas, tabelas) pra clareza.
4. Quando o usuário perguntar algo que envolve comparação, monte tabela markdown curta.
5. Quando identificar risco ou oportunidade, destaque com emoji (⚠️ 🔴 🟢 ✅).
6. Seja conciso: respostas curtas são melhores. Só vá pra resposta longa se o usuário pedir detalhe.
7. Se a pergunta envolve "qual modelo mais vende na loja X" → use **topModelosPorLoja**.
8. Se "onde a marca/modelo X mais sai" → use **lojasDeCadaModelo**.
9. Se "evolução / mês a mês / tendência" → use **vendasPorMes**.
10. Se "PF/PJ" ou "pessoa física/jurídica" → use **pfVsPj**.
11. Se "carro novo/velho" ou "ano/idade" → use **idadeVeiculo**.
12. Se não conseguir responder, diga claramente o que falta no JSON.
13. Fórmula oficial NBS:
    Custo Total = Nota Fábrica + Desp Oficina + Frete + Forplan + Impostos + Comissões + ADM + Despesas Gerais − Ganhos Indiretos
    Margem = Valor Vendido − Custo Total
14. Valores monetários: exiba como "R$ X.XXX,XX" (separador brasileiro).
15. Quando o usuário citar nome de loja, faça match case-insensitive contra os nomes do JSON (ex: "aeroporto" → "NAVESA FORD AEROPORTO").`;
}

/**
 * Seleção do provider/modelo:
 * - Prioriza GOOGLE_GENERATIVE_AI_API_KEY (Gemini Flash — free tier generoso, 1500 req/dia)
 * - Fallback pra ANTHROPIC_API_KEY (Claude Haiku — pago após créditos iniciais)
 */
function pickModel(): { model: LanguageModel; provedor: string } | { error: string } {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { model: google("gemini-2.5-flash"), provedor: "gemini" };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { model: anthropic("claude-haiku-4-5-20251001"), provedor: "anthropic" };
  }
  return {
    error:
      "Nenhuma API key configurada. Crie .env.local na raiz com GOOGLE_GENERATIVE_AI_API_KEY=... (gratuito em aistudio.google.com/apikey) ou ANTHROPIC_API_KEY=sk-ant-... e reinicie o servidor.",
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;

    const picked = pickModel();
    if ("error" in picked) {
      return new Response(JSON.stringify({ error: picked.error }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const system = buildSystemPrompt(body.bundle, body.periodo ?? null);

    const result = streamText({
      model: picked.model,
      system,
      messages: body.messages,
      temperature: 0.3,
    });

    return result.toTextStreamResponse();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
