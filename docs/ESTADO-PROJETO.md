# Estado do Projeto — Handoff entre sessões/máquinas

> Doc vivo pra continuar o trabalho em qualquer computador. Atualizado em 18/06/2026.
> Leia este arquivo + `ROADMAP.md` + `CLAUDE.md` ao retomar o projeto.

---

## 🎯 Onde paramos (18/06/2026)

Módulo de **Repasses** completo e em produção. Fluxo end-to-end funcionando:
1. Marca carros no estoque (`/veiculos`) → bulk ou por linha
2. Preenche campos manuais inline no `/repasses` (IPVA, Documentação, Cautelar, Valor pra subir, Observação)
3. Exporta XLSX profissional OU gera anúncio de texto (botão "📄 Anúncio")
4. Sobe no Auto Avaliar (manual, fora do sistema)
5. Marca "Já subi" → vai pro histórico

**Última feature entregue:** Gerador de anúncio (Sprint 3) — commit `958dee0`.
**Último fix:** coluna "Dias parado" no XLSX usa dias_patio real — commit `6fbf3af`.

---

## 📋 Gerador de Anúncio de Repasse — regras de negócio

### Estrutura do anúncio (template aprovado)
Ordem: cabeçalho (modelo/ano/cor/km) → linha B2B → CONDIÇÕES DA OPERAÇÃO → SITUAÇÃO DOCUMENTAL → LIBERAÇÃO DO VEÍCULO → RETIRADA E CONTATO → OBSERVAÇÕES (se houver) → IMPORTANTE.

- **NÃO inclui** itens avaliados nem laudo — esses sobem separados no Auto Avaliar (a pessoa vê direto)
- **Cautelar** é preenchida no sistema mas NÃO entra no texto do anúncio (sobe laudo separado)
- IPVA/Documentação: aparecem no texto conforme o dropdown preenchido (pago→"PAGO", a pagar→"A PAGAR PELO COMPRADOR", etc.)

### ⚠️ VALORES DE EXEMPLO a confirmar (em `src/lib/repasses/anuncio-config.ts`)
Estes estão com valores fictícios marcados `// TODO: confirmar com Marcos`. **Trocar antes de usar com cliente B2B real:**

| Campo | Valor atual (exemplo) | Confirmado? |
|---|---|---|
| Taxa Auto Avaliar | R$ 999,00 | ⬜ |
| Taxa administrativa Navesa | R$ 525,00 | ⬜ |
| Prazo de retirada | 10 dias | ⬜ |
| Estrutura jurídica da venda ("nome A.M") | "procuração pública outorgada" | ⬜ |
| Tempo de entrega da documentação | "até 20 dias após Detran-GO" | ⬜ |
| Local de retirada | "Grupo Navesa - Goiânia/GO" | ⬜ |
| Telefone / WhatsApp / E-mail | fictícios | ⬜ |

> Quando confirmar, é editar **1 arquivo só** (`anuncio-config.ts`) e todos os anúncios saem certos.

---

## 🔜 Pendências / próximos passos

### Operacional (Marcos)
- **Confirmar os 7 valores do config** acima (gerador de anúncio)
- **Segurança** (toggles no painel Supabase, 2 min): ativar 2FA/MFA + "Leaked Password Protection"
- **E-mail pro Auto Avaliar**: template pronto (solicitação de API) — passar pro gerente enviar
- **Subir estoque correto**: usar sempre o relatório de SEMINOVOS (com placa). O export de carros novos/zero-km (sem placa) NÃO sobe (parser exige placa)

### Dev (fila)
- **Proteção contra upload vazio**: se o parse der 0 carros, avisar e NÃO criar snapshot (evita "estoque sumiu"). Ver incidente abaixo.
- **Sprint 2 Repasses** (débitos): helper `hojeLocal()` (UTC-shift), pré-preencher cautelar do sistema, spinner por linha no checklist
- **CI**: subir `actions/checkout@v5` e `setup-node@v5` (deprecation Node 20)
- **Integração API Auto Avaliar** (futuro): puxar FIPE, avaliações, comparativo de valores — aguardando credenciais/docs da API

---

## 🛡️ Incidentes resolvidos (referência)

- **18/06 — "estoque sumiu"**: 3 uploads de um arquivo sem placa criaram snapshots vazios (22,23,24) que taparam a visão. Apagados → restaurado snapshot 21 (1.052 carros). O fix de segurança (migration 012) NÃO foi a causa.
- **Vazamento de dados (resolvido)**: view `veiculos_atual` era SECURITY DEFINER e expunha estoque/custo/margem sem login. Migration 012 (`security_invoker=true`) fechou. Confirmado: anon vê 0, authenticated vê tudo.

---

## 💾 Estado dos dados (Supabase, projeto `gjyzcyamwdldnriqydua`)

- Estoque atual: snapshot **21** (17/06), 1.052 carros (seminovos com placa)
- Repasses: ~56 carros marcados pra subir
- Migrations aplicadas: até **012** (security_invoker)
- Schema canônico: `supabase/migrations/`

---

## 🖥️ Setup em uma máquina nova (passo a passo)

1. **Instalar** Node 22+, Git, Claude Code, e logar na mesma conta Claude
2. **Clonar**: `git clone <repo navesa-mesa>` (vem código + agents AIOX + docs)
3. **Copiar `.env.local`** da outra máquina pra raiz do projeto (NÃO está no git — tem as credenciais)
4. **Instalar deps**: `npm ci`
5. **Validar**: `npm test` (deve dar verde) + `npm run dev`
6. **Abrir o Claude Code** na pasta do projeto → ele lê CLAUDE.md/AGENTS.md/ROADMAP.md/este doc automaticamente
7. **Continuar**: peça ao Claude pra "ler o docs/ESTADO-PROJETO.md e o ROADMAP" no início da sessão

> Sempre que terminar uma sessão importante, peça pra atualizar este doc — assim a "memória" viaja com o repo.
