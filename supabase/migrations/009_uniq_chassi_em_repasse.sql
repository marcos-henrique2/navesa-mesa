-- Navesa Mesa — Q1 hotfix: guarda contra duplicata de repasse ativo por chassi.
--
-- Schema antes deixava criar 2 repasses com status='subido' pro mesmo chassi
-- se houvesse race (2 abas, ou clique antes do mapa de chassis carregar).
-- Defesa vivia só no client.
--
-- Índice parcial único: 1 repasse "subido" por chassi. Quando vira
-- 'vendido' / 'nao_vendido' / 'cancelado', sai do índice e abre vaga pra
-- subir novamente caso o carro volte pro estoque.
--
-- Erro 23505 retornado pelo Postgres é capturado em createRepasse() e
-- traduzido pra mensagem amigável em pt-BR.

create unique index if not exists repasses_chassi_subido_uniq
  on repasses(chassi)
  where status = 'subido';
