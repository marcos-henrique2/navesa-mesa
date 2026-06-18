-- Navesa Mesa — Repasses: persistir "Valor Auto Avaliar"
--
-- Antes esse valor (avaliação da plataforma Auto Avaliar) vinha VAZIO no XLSX
-- pro Marcos digitar no Excel — e se perdia ao re-exportar pra acumular lotes.
-- Agora ele preenche INLINE no /repasses (igual IPVA/Doc/Cautelar/Valor pra
-- subir/Observação) e o XLSX vem pré-preenchido. Lote incremental fica
-- automático, nada se perde.
--
-- NUMERIC(12,2) nullable — mesmo padrão de `valor_subir`.
-- 100% idempotente (IF NOT EXISTS) — pode rodar várias vezes sem efeito.

ALTER TABLE repasses ADD COLUMN IF NOT EXISTS valor_auto_avaliar NUMERIC(12, 2);
COMMENT ON COLUMN repasses.valor_auto_avaliar IS 'Valor que o Auto Avaliar avaliou o veiculo (preenchido manual no /repasses). Comparado com custo e preco no XLSX.';
