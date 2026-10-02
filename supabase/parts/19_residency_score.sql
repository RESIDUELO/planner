-- =====================================================================
-- Minha nota: a nota que a pessoa tirou em cada residência (ex.: 78/100),
-- guardada junto da residência para não esquecer. Texto livre, curto.
-- Seguro para rodar mais de uma vez.
-- =====================================================================
alter table public.residencies add column if not exists my_score text not null default ''
  check (char_length(my_score) <= 60);

-- Conferência: deve mostrar 1 linha
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'residencies' and column_name = 'my_score';
