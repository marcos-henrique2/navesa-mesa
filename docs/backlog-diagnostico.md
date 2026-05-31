# Backlog — Diagnóstico Fase A (tech-debt)

Itens identificados pelo Quinn no QA da Fase A que **não bloqueiam** o release, mas
ficam registrados pra serem endereçados em Fase A.2 ou junto da Fase B.

> Contexto: a Fase A.1 (este ciclo) aplicou 1 HIGH + 3 MEDIUM do Quinn. O que segue
> abaixo é o resto — 1 MEDIUM (cobertura de testes ausente) + 5 LOW.

---

## MEDIUM — não bloqueia, mas precisa entrar antes da Fase B

### M1. Criar `tests/medianas.test.ts` (4+ casos)
Hoje `src/lib/pricing/medianas.ts` tem **zero cobertura de teste**. Casos mínimos:

1. **Match exato:** estoque + vendas com (FORD, RANGER, 2022) ≥ 3 amostras → mediana correta.
2. **Fallback ano ± 1:** lookup pra (FORD, RANGER, 2023) com dados só em 2022 → encontra via delta.
3. **Fallback "qualquer ano do modelo":** lookup pra (FORD, RANGER, 2025) com dados em 2018/2019/2020 → retorna mediana cruzada.
4. **Heurística por idade:** lookup pra modelo sem nenhum dado → retorna `heuristica: true` + km coerente com regra 15k/18k/20k por ano.
5. **(bônus) Janela 24 meses:** vendas antigas (> 24m) são ignoradas no bucket.
6. **(bônus) Min amostras = 3:** bucket com 2 amostras NÃO entra no mapa.

---

## LOW (5) — polish, encaixar quando passar perto

### L1. Mapping `baseClassePct → classe` (em `reprecificacao.ts`)
[`extrairClasseDoDiagnostico`](../src/lib/data/reprecificacao.ts) compara floats com `Math.abs(... ) < 1e-9`.
Funciona hoje porque os pcts são literais constantes, mas fica frágil se alguém mudar pra
valores derivados. **Sugestão:** passar `classe` explicitamente como argumento de `marcarParaReprecificar`
(o call site já tem essa info via `classesPorChassi`).

### L2. Precisão de `desvio_pct_snapshot` (`numeric(6,3)` vs `round4`)
A coluna persiste com 3 casas (`numeric(6,3)`) mas o cálculo arredonda pra 4 (`round4`).
Resultado: a 4ª casa é perdida no DB. **Sugestão:** alterar coluna pra `numeric(7,4)` na migration 003
**ou** mudar `round4 → round3` em `diagnostico.ts`. Coerência > precisão extra.

### L3. Label "+" duplicado em km abaixo da mediana
Em [`diagnostico.ts:240`](../src/lib/pricing/diagnostico.ts#L240):
```ts
label = `KM ${formatPct(Math.abs(desvio))} abaixo da mediana (+${formatPct(kmPct).replace("+", "")})`;
```
Faz `+${formatPct(0.01).replace("+", "")}` → produz `+1.0%`. Funciona, mas é gambiarra de regex.
**Sugestão:** ter uma `formatPctSemSinal()` ou passar opção pro `formatPct`.

### L4. `modelo` vazio em `buscarMedianaKm` cai direto na heurística
[`medianas.ts:95`](../src/lib/pricing/medianas.ts#L95): `if (!modelo) return aplicarHeuristica(veiculo);`
**Sem motivo no log/retorno.** Pra debugging, valeria adicionar um `motivo` ou expor que a heurística
foi forçada por falta de modelo (vs. falta de match).

### L5. Testes faltantes (4+ cases identificados pelo Quinn)
Cobertura atual do `diagnostico.test.ts` está em 14/14 (após Fase A.1). Faltam cenários:

- **Cap superior** (ajuste +2%): conseguir gerar ajusteTotalPct > +2% e validar cap.
  → Hoje só `km_vs_mediana.desvio20Abaixo` é positivo (+1%), não dá pra estourar o teto de +2%.
  Pode virar bug latente quando ajustes positivos novos forem adicionados.
- **Cautelar com_restricao isoladamente** (sem combinar com outros ajustes).
- **Veículo com km=null** + mediana existente → comportamento do ramo `km_vs_mediana`.
- **`precoAtual=null`** → status `sem_dados` (esse caminho está no código mas sem teste explícito).

---

## Notas

- Tudo aqui é **tech-debt da Fase A**, identificado durante o QA. Nada bloqueia o release atual.
- Fase B (UI) começa em paralelo. Esses itens entram numa **Fase A.2 de polish** ou
  são consumidos junto da Fase B quando alguém passar perto do código.
- Reavaliar prioridade quando o Quinn fizer re-review do release real.
