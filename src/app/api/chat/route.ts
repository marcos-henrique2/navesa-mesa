import { anthropic } from "@ai-sdk/anthropic";
import { deepseek } from "@ai-sdk/deepseek";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { streamText, type LanguageModel } from "ai";
import type { InsightsBundle } from "@/lib/analytics/insights";

export const runtime = "nodejs";
export const maxDuration = 90;

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

  return `Você é GERENTE SÊNIOR de mesa de precificação da Navesa (concessionária multi-marca em Goiás, Ford/GWM/Renault, 16 lojas, 15 anos de experiência). Respostas acionáveis, baseadas em dados reais, pt-BR direto.

REGRAS:
- Cite números EXATOS do JSON. Nunca invente. Se faltar dado, fale "preciso desse dado".
- Markdown: **negrito** em números/conceitos. Tabelas pra comparação. Listas pra ações.
- Pergunta simples (1 número) → 1-3 linhas. Pergunta estratégica → framework completo abaixo.
- Termos: giro, pátio, F&I, repasse, FIPE, floor plan, tradein.
- Valores: R$ X.XXX,XX (pt-BR). Match nomes case-insensitive ("aeroporto" → "NAVESA FORD AEROPORTO").

FRAMEWORK ANÁLISE ESTRATÉGICA (use em "o que causa X?", "analise", "diagnóstico"):
1. 📊 **RESUMO EXECUTIVO** — manchete de 1 frase, contundente
2. 🟢 PUXA / 🔴 DRENA — 2 mini-tabelas com R$ e %
3. 🔍 **CAUSA RAIZ** — 2-3 problemas estruturais, cada um com o número que prova
4. 🎯 **ONDE FOCAR** — 2-4 ações 🥇🥈🥉, cada com (impacto × esforço) e R$ estimado
5. ❓ **PERGUNTA ESTRATÉGICA** final

LENTES DE ANÁLISE (sempre passe por elas):
- **Bônus**: sumario.margem > sumario.ganhosIndiretos? Se não, operação só lucra por bônus = FRÁGIL.
- **Erro de compra**: modelo com margem cronicamente negativa = pagou caro à fábrica (não problema de venda). Ex: HAVAL PHEV.
- **Capital parado**: >60d drena via floor plan. Auto Avaliar manda repassar +30d.
- **Disciplina desconto**: vendedoresPiores dão desconto demais. Margem neg × volume = perda recuperável.
- **Fórmula vencedora**: marca/loja muito acima da média → replicar.
- **Show Room vs Repasse**: use classificacao.

PRINCÍPIOS:
- Margem REAL (depois de ganhos indiretos) é a verdade.
- Estoque em R$ = CUSTO DE FÁBRICA (capital travado), não preço de venda.
- Recomendações ACIONÁVEIS + QUANTIFICADAS. Não "melhore X", mas "reveja 23 HAVAL acima da FIPE, R$ 4M parados".

CONTEXTO:
- Período: ${periodo?.inicio ?? "?"} → ${periodo?.fim ?? "?"}
- ${bundle.sumario.qt} vendas, ${fmt(bundle.sumario.faturamento)} faturamento, margem REAL ${fmt(bundle.sumario.margem)} (${bundle.sumario.margemPct.toFixed(2)}%), bônus ${fmt(bundle.sumario.ganhosIndiretos)}, margem SEM bônus ${fmt(bundle.sumario.margemSemBonus)}
${bundle.sumario.dependeDeBonus ? "- 🚨 OPERAÇÃO DEPENDE DOS BÔNUS — sem eles, prejuízo." : "- ✅ Lucra mesmo sem bônus."}

JSON disponível (versão compacta — alguns campos foram cortados pra caber em quota):
- sumario, classificacao
- lojas (top 5), marcas (top 5)
- modelosPiores/Melhores (top 3), vendedoresTop/Piores (top 3)
- vendasPorMes (últimos 6), giro
- estoque (top 3 risco), estoquePorLoja, estoquePorMarca
- fipeAnaliseEstoque (top 3 acima/abaixo)
- outliersLucro/Prejuizo (top 2)

NÃO INCLUSOS: cruzamentos por loja (topModelosPorLoja etc.), demografia (UF, PF×PJ, idade, km), clientesRecorrentes, trocas, margemPorAnoModelo, cautelaresPorLoja. Se a pergunta precisar deles, diga "preciso desses dados, posso adicionar" e responda com o que tem.

== DADOS ==
${JSON.stringify(bundle)}`;
}

type ProvedorConfig = { nome: string; criar: () => LanguageModel };

/**
 * Lista de providers em ordem de prioridade.
 * Primeiro da lista que tem API key configurada é tentado primeiro.
 * Se ele falhar com erro de quota/rate-limit/auth, tenta o próximo automaticamente.
 *
 * Ordem (mais permissivo p/ bundle grande primeiro):
 *   1. DeepSeek (V3) — free tier 50 req/dia + 64k context (cabe bundle grande)
 *   2. Groq (Llama 3.3 70B) — free tier 14.4k req/dia mas só 6k tokens/min input
 *   3. Gemini 2.5 Flash — free tier 250k tokens/min input mas esgota rápido
 *   4. Anthropic Claude Haiku — pago (fallback se todos free falharem)
 */
function listarProvidersDisponiveis(): ProvedorConfig[] {
  const lista: ProvedorConfig[] = [];
  if (process.env.DEEPSEEK_API_KEY) {
    lista.push({ nome: "deepseek", criar: () => deepseek("deepseek-chat") });
  }
  if (process.env.GROQ_API_KEY) {
    // Llama 3.1 8B instant: free tier 30k tokens/min input (vs 6k do 70B).
    // Menos "inteligente" mas suficiente pra análise + cabe folgado no bundle.
    lista.push({ nome: "groq", criar: () => groq("llama-3.1-8b-instant") });
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    lista.push({ nome: "gemini", criar: () => google("gemini-2.5-flash") });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    lista.push({ nome: "anthropic", criar: () => anthropic("claude-haiku-4-5-20251001") });
  }
  return lista;
}

function extrairRetryAfter(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/retry in ([0-9.]+)\s*s/i) ?? msg.match(/([0-9]+)\s*seconds?/i);
  if (match) return Math.ceil(Number(match[1]));
  return null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    const providers = listarProvidersDisponiveis();

    if (providers.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Nenhuma API key configurada. Adicione no .env.local: DEEPSEEK_API_KEY=sk-... (gratuito em platform.deepseek.com), GROQ_API_KEY=gsk_... (gratuito em console.groq.com), GOOGLE_GENERATIVE_AI_API_KEY=... ou ANTHROPIC_API_KEY=sk-ant-... — e reinicie o servidor.",
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }

    const system = buildSystemPrompt(body.bundle, body.periodo ?? null);

    // Tenta cada provider em sequência. SEMPRE tenta o próximo se o atual falhar
    // por qualquer motivo — quota, auth, stream vazio, timeout, etc.
    // Só usa o break quando todos foram tentados (loop natural).
    let ultimoErro: unknown = null;
    let ultimoProvider: string | null = null;
    const errosDetalhados: { provider: string; erro: string }[] = [];

    for (const provider of providers) {
      try {
        // Captura erro assíncrono do streamText via callback (alguns providers
        // retornam stream vazio em vez de exception — onError pega o motivo real).
        let erroAssincrono: unknown = null;
        const result = streamText({
          model: provider.criar(),
          system,
          messages: body.messages,
          temperature: 0.3,
          onError({ error }) {
            erroAssincrono = error;
            console.error(`[chat] streamText onError (${provider.nome}):`, error);
          },
        });

        // Força a primeira leitura do stream pra capturar erros imediatos.
        // Se vier vazio + onError disparou, propaga o erro real.
        const reader = result.textStream.getReader();
        const primeira = await reader.read();
        if (primeira.done) {
          const motivo = erroAssincrono
            ? erroAssincrono instanceof Error
              ? erroAssincrono.message
              : String(erroAssincrono)
            : `stream vazio (provider retornou sem conteúdo nem erro)`;
          throw new Error(`Provider ${provider.nome}: ${motivo}`);
        }

        // Sucesso — reconstrói um stream que começa com a chunk já lida + o restante.
        const stream = new ReadableStream<string>({
          async start(controller) {
            controller.enqueue(primeira.value);
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                controller.enqueue(value);
              }
              controller.close();
            } catch (err) {
              console.error(`[chat] erro durante streaming (${provider.nome}):`, err);
              controller.error(err);
            }
          },
        });

        const encoder = new TextEncoder();
        const transformer = stream.pipeThrough(
          new TransformStream<string, Uint8Array>({
            transform(chunk, controller) {
              controller.enqueue(encoder.encode(chunk));
            },
          }),
        );

        console.log(`[chat] sucesso com provider ${provider.nome}`);
        return new Response(transformer, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "x-provider-usado": provider.nome,
          },
        });
      } catch (err) {
        ultimoErro = err;
        ultimoProvider = provider.nome;
        const msg = err instanceof Error ? err.message : String(err);
        errosDetalhados.push({ provider: provider.nome, erro: msg });
        console.error(`[chat] provider ${provider.nome} falhou:`, err);
        // SEMPRE tenta o próximo provider. Loop natural termina quando acabar a lista.
      }
    }

    // Todos os providers falharam
    const retrySeg = extrairRetryAfter(ultimoErro);
    const msgErro = ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro);
    return new Response(
      JSON.stringify({
        error: `Todos os providers de IA falharam. Último (${ultimoProvider}): ${msgErro}`,
        retryAfter: retrySeg,
        providers_tentados: providers.map((p) => p.nome),
        erros_detalhados: errosDetalhados,
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
