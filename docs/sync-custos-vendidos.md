# Custos vendidos — sincronização Oracle → Supabase

Ativação: 08/10/2026. A tarefa Windows `NavesaMesa-SyncNBS` chama `npm run sync-nbs` na pasta `navesa-mesa-sync-automatico`, a cada 2 horas. A etapa `custos` agora roda após veículos e vendas. Nenhuma mudança de schema nem deploy frontend foi necessário.

## Consulta e proteção dos dados

Fonte: SQL fornecido `-- Vendido Detalhado Custo ---.txt`. Usados efetivamente vendidos (`STATUS=V`, `NOVO_USADO=U`, `CONSIGNATO=N`, extras excluídos `0/F/X`). Custos específicos por chave completa empresa/produto/modelo/chassi, classificados pelo TIPO e VALOR_FINAL. Preserva custo/margem oficiais, desconto incondicional e deságio. Atualiza `custos_detalhados` por placa; mantém a venda mais recente e não apaga histórico ausente. Datas são gravadas à meia-noite de São Paulo.

Antes da gravação, concilia os componentes com o custo final em centavos. Linhas divergentes, custo/venda zero ou inválido e comissão VD sem regra individual validada ficam fora da gravação; mantém registro anterior. `sync_log` registra `sucesso`, `parcial` ou `erro`, com contagens. Uma execução parcial não significa que as placas bloqueadas tenham sido corrigidas.

## Operação

- Normal: `npm run sync-nbs` (estoque, vendas e custos dos últimos 90 dias).
- Somente custos: `npm run sync-nbs -- --somente-custos`.
- Validar sem gravar dados ou log: `npm run sync-nbs -- --somente-custos --dry-run`.
- Carga histórica: adicionar `--custos-desde=2026-01-01`.

Carga inicial: 3.133 placas atualizadas, custo oficial aprovado R$ 403.997.712,30, igual à soma dos componentes. Sete placas repetidas foram deduplicadas. Banco vivo: novas vendas podem aparecer durante a conferência e entram na próxima rodada.

Placas preservadas por diferença de custo: SDF6J40 (R$ 1.375,00), SGY8H22 (R$ 775,00), RBO2F40 (R$ 324,95). A fonte dos resíduos não foi identificada; não há ajuste artificial.

Backup anterior: `scripts/custos-vendidos-antes-sync-20261008.local.json`, na cópia `navesa-mesa`; ignorado pelo Git. Contém os 3.118 registros anteriores e não deve ser publicado.

Validação: 1.240 testes passaram, TypeScript e lint dos arquivos alterados passaram. Carga executada pela mesma cópia da tarefa agendada. Leitura posterior confirmou os registros presentes e a preservação das três placas bloqueadas.

## Markup de estoque — pendência separada

O quarto relatório não foi automatizado. O cálculo oficial usa `PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE` e `VEICULOS_MARKUP_TMP`, inacessíveis para COMISSAO. Nenhum pacote foi executado e nenhum dado de `custos_estoque_detalhado` foi alterado. Ver `sync-custos-markup-acesso.md` para o pedido concreto ao responsável NBS. O upload do PDF continua disponível.