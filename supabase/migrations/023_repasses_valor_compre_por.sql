-- Navesa Mesa — Épico Inteligência de Repasse — Story 1.1
-- Normalizar os 3 valores por carro na `repasses`.
--
-- Mapeamento canônico (decisão D1, aprovada pelo SM):
--   - Custo      = valor_aquisicao   (JÁ EXISTE, 84/84 — NÃO tocar)
--   - Mínimo     = valor_minimo      (coluna já existe, hoje vazia — usar essa)
--   - Compre-por = valor_compre_por  (COLUNA NOVA — criada aqui)
--
-- Por que coluna dedicada e NÃO reutilizar `valor_subir`/`valor_subiu`:
-- ambas são legacy/inconsistentes (valor_subiu: 84/84 mas semântica confusa;
-- valor_subir: só 25/84 preenchidos). Reaproveitá-las herda o lixo. O SM
-- recomendou coluna limpa e dedicada — aprovado.
--
-- Precisão (decisão D3): numeric(12,2) — mesmo tipo das demais colunas de valor
-- da `repasses`, mantém centavo-perfect e consistência.
--
-- 100% idempotente (ADD COLUMN IF NOT EXISTS) — pode rodar N vezes sem efeito.
-- Sem impacto em RLS (a policy "authenticated_all_access" da tabela já cobre a
-- coluna nova — RLS é por linha, não por coluna).

ALTER TABLE repasses ADD COLUMN IF NOT EXISTS valor_compre_por numeric(12, 2);

COMMENT ON COLUMN repasses.valor_compre_por IS
  'Valor "Compre por" do carro no repasse (teto de negociação / preço de tabela). '
  'numeric(12,2) centavo-perfect. Nullable = dados incompletos (não chutar). '
  'Story 1.1 do épico Inteligência de Repasse.';
