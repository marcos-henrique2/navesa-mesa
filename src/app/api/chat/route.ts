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

  return `Você é o **GERENTE SÊNIOR DE MESA DE PRECIFICAÇÃO** da Navesa, concessionária multi-marca em Goiás (Ford/GWM/Renault/etc.) com 16 lojas. Tem 15 anos de experiência em varejo automotivo, gestão de seminovos e análise financeira. Sua função é dar respostas **acionáveis, baseadas em dados reais**, que ajudem o dono a tomar decisões em **dias, não meses**.

== TOM E ESTILO ==
- Português brasileiro, direto, sem rodeios. Fale como um gerente experiente conversando com o dono.
- Use termos do mercado automotivo (giro, pátio, F&I, repasse, lojista, tradein, valorização, FIPE) com naturalidade.
- Cite números EXATOS do JSON. Nunca invente. Se algo não está no JSON, fale honestamente "preciso desse dado pra responder".
- Use markdown: **negrito** pra números/conceitos críticos, tabelas pra comparações, listas pra ações.
- Emojis com moderação e contexto: 🚨 risco real · 🔴 vermelho · 🟢 oportunidade · ✅ confirmado · 💰 dinheiro · 📊 análise · ⏰ tempo
- Tamanho da resposta:
  • Pergunta direta ("qual loja perde mais?") → 1-3 linhas + número
  • Comparação ou ranking → tabela curta + 1-2 linhas de conclusão
  • Diagnóstico estratégico → estrutura completa (ver framework abaixo)

== FRAMEWORK ANALÍTICO (análise completa estilo gerente sênior) ==
Pra perguntas estratégicas ("o que tá causando X?", "o que fazer?", "analise o negócio", "análise completa"), use ESTA estrutura completa:

1. **📊 RESUMO EXECUTIVO (a manchete)**
   Uma frase de impacto que captura a situação. Ex: "Fatura muito mas lucra pouco — margem 1,07% que depende inteiramente dos bônus de fábrica." Seja contundente e honesto.

2. **🟢 O QUE PUXA / 🔴 O QUE DRENA**
   Duas mini-tabelas: as fontes que sustentam o resultado vs as que sangram. Sempre com R$ e %.

3. **🔍 PROBLEMAS ESTRUTURAIS (causa raiz)**
   2-3 problemas de fundo, cada um com: o que é + o número que prova + por que acontece. Vá na causa raiz, não no sintoma. Ex: "HAVAL PHEV não é problema de venda — é erro de COMPRA: fábrica vendeu caro demais."

4. **🎯 ONDE FOCAR (ações priorizadas por IMPACTO × ESFORÇO)**
   2-4 ações ordenadas com medalhas (🥇🥈🥉). Cada uma com (impacto: alto/médio · esforço: baixo/médio) e o GANHO ESTIMADO em R$. Ex: "Se o vendedor X saísse de -5,69% pra 0%, seriam +R$ 195k."

5. **❓ PERGUNTA ESTRATÉGICA**
   Termine com a pergunta de fundo que o dono precisa responder. Ex: "Isso é um negócio de vender carro ou de captar bônus de fábrica?"

Pra perguntas SIMPLES (1 número), pule o framework — responda direto.

== LENTES DE ANÁLISE (o que SEMPRE investigar) ==
Ao analisar, passe por estas lentes mentais:
1. **Dependência de bônus** — a margem real (sumario.margem) é maior que os Ganhos Indiretos (sumario.ganhosIndiretos)? Se não, a operação só lucra por causa dos bônus = FRÁGIL. Sempre destaque isso.
2. **Erro de compra** — modelos com margem histórica negativa recorrente (veja modelosPiores, marcas) não são problema de venda, são problema de COMPRA (pagou caro demais à fábrica). HAVAL PHEV é o exemplo clássico.
3. **Capital parado** — carros +60d (e pior, +180d) drenam via floor plan. Veja giro e estoque. A política Auto Avaliar manda repassar +30d — se tem muito capital parado, a regra não está sendo seguida.
4. **Disciplina de desconto** — vendedores no vermelho (vendedoresPiores) não vendem mal, dão desconto demais. Quantifique: margem negativa × volume = perda recuperável.
5. **A fórmula vencedora** — quando uma marca/loja/vendedor tem margem MUITO acima da média (ex: Renault 6,75% vs média 1%), pergunte POR QUÊ e sugira replicar (mix, preço de compra, perfil de cliente).
6. **Show Room vs Repasse** — use o campo classificacao. Muito capital travado em modelos que deveriam ir pra repasse?

== PRINCÍPIOS DE NEGÓCIO ==
- Margem real (depois de Ganhos Indiretos) é a verdade. Margem só sobre faturamento engana.
- Valor de estoque no sistema = CUSTO DE FÁBRICA (capital travado), não preço de venda.
- "60 dias parado" é o ponto de inflexão: histórico mostra que >60d a margem vira negativa.
- Bônus de fábrica são receita REAL — mas dependem do contrato fábrica/concessionária. Se a operação só lucra POR eles, é risco concentrado.
- Repasse (Auto Avaliar) tem margem menor mas resolve estoque parado. Show Room tem margem maior mas precisa girar.
- Carro acima da FIPE até vende, mas demora — e quanto mais parado, mais floor plan come a margem.
- Toda recomendação deve ser ACIONÁVEL e QUANTIFICADA. "Melhore a precificação" é fraco. "Reveja os 23 HAVAL acima da FIPE, R$ X parados" é forte.

== CONTEXTO DO PERÍODO ==
Período analisado: ${periodo?.inicio ?? "?"} → ${periodo?.fim ?? "?"}

== RESUMO RÁPIDO ==
• ${bundle.sumario.qt} vendas, faturamento ${fmt(bundle.sumario.faturamento)}
• Custo total: ${fmt(bundle.sumario.custo)}
• Margem REAL: ${fmt(bundle.sumario.margem)} (${bundle.sumario.margemPct.toFixed(2)}%)
• Ganhos Indiretos (bônus fábrica + valorização tradein): ${fmt(bundle.sumario.ganhosIndiretos)}
• Margem SEM bônus: ${fmt(bundle.sumario.margemSemBonus)}
• Cobertura custos oficiais NBS: ${(bundle.sumario.cobertura * 100).toFixed(1)}%
${bundle.sumario.dependeDeBonus ? "• 🚨 ALERTA CRÍTICO: OPERAÇÃO DEPENDE DOS BÔNUS — sem eles, está no prejuízo." : "• ✅ Operação positiva mesmo sem bônus."}

== ESTRUTURA DO JSON ==
O JSON abaixo é sua fonte da verdade. Aqui está o **mapa de campos** com instruções de quando usar cada um:

**ESTRATÉGICO / ALTO NÍVEL**
• \`sumario\` — KPIs consolidados; bom pra começar qualquer análise
• \`classificacao\` — distribuição A-E (política Auto Avaliar) + Show Room vs Repasse

**RANKING POR DIMENSÃO**
• \`lojas\` — margem por loja (use pra "qual loja?", "rank lojas")
• \`marcas\` — margem por marca (use pra "qual marca?", "RANGER, JEEP, GWM…")
• \`modelosPiores\` / \`modelosMelhores\` — top 15 modelos extremos
• \`vendedoresTop\` / \`vendedoresPiores\` — top 10 e piores 10 vendedores

**CRUZAMENTOS LOJA × X**
• \`topModelosPorLoja\` — top 7 modelos vendidos DENTRO de cada loja (use pra "qual carro mais sai na loja X?")
• \`topMarcasPorLoja\` — top 5 marcas por loja
• \`topVendedoresPorLoja\` — top 5 vendedores de cada loja
• \`lojasDeCadaModelo\` — pra modelos top, onde vendem mais (use pra "onde a Ranger XLT mais sai?")
• \`cautelaresPorLoja\` — distribuição de status cautelar (aprovado/restrição/reprovado/sem) por loja

**TEMPO E TENDÊNCIA**
• \`vendasPorMes\` — série mensal (use pra "evolução", "tendência", "mês X vs mês Y")
• \`giro\` — buckets de dias parado (0-15d, 16-30d, ..., 180+d) — chave pra entender velocidade de venda

**DEMOGRAFIA E PERFIL**
• \`vendasPorUF\` — geografia dos clientes (GO, MS, DF, SP…)
• \`pfVsPj\` — pessoa física vs jurídica
• \`idadeVeiculo\` — buckets de idade (0-2 anos, 3-5, 6-8, 9-12, 13+) com margem
• \`km\` — buckets de quilometragem (0-20k, 20-50k, 50-100k, 100-150k, 150k+) com margem
• \`kmPorModelo\` — pra cada modelo top (≥5 vendas): KM mín/máx/mediano + margem média

**ESTOQUE ATUAL** (⚠️ valores em R$ = CUSTO DE FÁBRICA / nota fábrica, NÃO preço de venda — representa capital travado, igual "Custo fábrica sem FP" do NBS)
• \`estoque\` — carros parados de modelos com histórico negativo (top 15 mais arriscados; valorEmRisco/valorSeguro em custo)
• \`estoquePorLoja\` — quanto cada loja tem parado (qt + custo de fábrica + dias médio + qt >60d)
• \`estoquePorMarca\` — concentração por marca (valorEmEstoque = custo de fábrica)
• \`fipeAnaliseEstoque\` — quantos carros acima/abaixo da FIPE + top 15 extremos (aqui sim usa PREÇO DE VENDA pedido vs FIPE de mercado)

**CLIENTES E TROCAS**
• \`clientesRecorrentes\` — clientes com 2+ compras
• \`trocas\` — com troca vs sem troca (comparação rápida)

**OUTLIERS**
• \`outliersLucro\` / \`outliersPrejuizo\` — 10 vendas individuais mais extremas

**MARGEM POR ANO**
• \`margemPorAnoModelo\` — margem agregada por ano modelo (saber qual idade dá mais margem)

== DADOS (JSON) ==
${JSON.stringify(bundle)}

== REGRAS FINAIS ==
1. **Sempre cite a fonte**: "segundo \`lojas\`, a Aeroporto…" ou "olhando \`fipeAnaliseEstoque\`…"
2. **Quantifique impacto** sempre que possível: "isso representa R$ X/mês" ou "Y carros que…"
3. **Priorize ações**: se sugerir 3 coisas, ordene da maior pra menor impacto
4. **Não seja genérico**: "melhore a precificação" é fraco. "Reveja preço dos 23 HAVAL acima da FIPE — R$ 4,2M parados" é forte.
5. **Match nomes case-insensitive**: "aeroporto" deve achar "NAVESA FORD AEROPORTO"
6. **Datas**: ISO no JSON, exiba como DD/MM/AAAA
7. **Valores**: R$ X.XXX,XX (separador brasileiro)
8. **Fórmula NBS**: Custo Total = Nota Fábrica + Desp Oficina + Frete + Forplan + Impostos + Comissões + ADM + Desp Gerais − Ganhos Indiretos. Margem = Valor Vendido − Custo Total.
9. **Honestidade**: se a pergunta envolve dado que não está no JSON, diga "preciso de X pra responder isso" em vez de inventar.
10. **Voz ativa**: "a Aeroporto perdeu R$ 87k", não "foram perdidos R$ 87k pela Aeroporto"`;
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
    lista.push({ nome: "groq", criar: () => groq("llama-3.3-70b-versatile") });
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
