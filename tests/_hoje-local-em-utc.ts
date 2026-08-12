/**
 * Sonda do Risco R2 — NÃO é um arquivo de teste (por isso o `_`, como
 * `_mocks.ts`): o glob da suíte é `tests/*.test.ts` e não o coleta.
 *
 * Existe pra ser executada por `data-local.test.ts` num processo FILHO com
 * `TZ=UTC`, que é o cenário real da Vercel. O fuso do processo só dá pra fixar
 * na largada do Node, então não há como provar isso dentro da própria suíte.
 *
 * ⚠️ Por que arquivo de verdade e não `--eval`: o hook do tsx não engata no
 * contexto `[eval]` do Node 22 (o runner do CI), e o namespace do módulo volta
 * vazio — `m.hojeLocal is not a function`. Com arquivo real ele engata nos dois
 * runtimes. Não trocar por `--eval`.
 *
 * Imprime `<fuso resolvido>|<data>` pra que o teste possa afirmar que o
 * processo REALMENTE rodou em UTC — sem isso, um `TZ` ignorado pelo sistema
 * operacional deixaria a asserção passar sem provar nada.
 */

import { hojeLocal } from "@/lib/utils/data-local";

const instante = process.argv[2] ?? "2026-08-07T01:00:00Z";
const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone;

process.stdout.write(`${fuso}|${hojeLocal(new Date(instante))}`);
