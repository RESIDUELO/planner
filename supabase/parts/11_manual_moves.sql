-- =====================================================================
-- Arrastar no planner: aula ou revisão movida à mão fica "fixada" no dia
-- escolhido (a reorganização automática não a tira de lá). A revisão deixa
-- de ser fixada quando é feita. Seguro para rodar mais de uma vez.
-- =====================================================================
alter table public.study_schedule add column if not exists pinned boolean not null default false;
alter table public.spaced_repetition_cards add column if not exists pinned boolean not null default false;
