-- =====================================================================
-- Banca de cada edição. Quando a banca da próxima prova é a mesma de só
-- parte das provas anteriores (ex.: SUS-SP passou para a VUNESP em 2026 e
-- continua em 2027), a análise dá mais peso às provas da banca atual e usa
-- as antigas só para confirmar os temas (shared/stats.ts).
-- Seguro para rodar mais de uma vez.
-- =====================================================================
alter table public.exam_editions add column if not exists board text
  check (board is null or char_length(board) <= 60);

create or replace function public.exam_history_data(p_exam_ids uuid[], p_include_drafts boolean default false)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'editions', coalesce((
      select jsonb_agg(jsonb_build_object('id', ed.id, 'exam_id', ed.exam_id, 'year', ed.year, 'status', ed.status, 'board', ed.board,
               'question_count', (select count(*) from questions q where q.exam_edition_id = ed.id and q.active),
               'classified_count', (select count(*) from questions q where q.exam_edition_id = ed.id and q.active
                                     and exists (select 1 from question_subjects qs where qs.question_id = q.id)))
             order by ed.year)
        from exam_editions ed
       where ed.exam_id = any(p_exam_ids)
         and (case when p_include_drafts then ed.status <> 'archived' else ed.status = 'published' end)), '[]'::jsonb),
    -- links: [questão, edição, prova, assunto raiz, peso, assunto classificado]
    'links', coalesce((
      select jsonb_agg(jsonb_build_array(q.id, q.exam_edition_id, ed.exam_id, r.root, qs.relevance_weight, qs.subject_id))
        from questions q
        join exam_editions ed on ed.id = q.exam_edition_id
        join question_subjects qs on qs.question_id = q.id
        join subject_roots r on r.id = qs.subject_id
        join subjects s on s.id = r.root and s.active
       where ed.exam_id = any(p_exam_ids) and q.active
         and (case when p_include_drafts then ed.status <> 'archived' else ed.status = 'published' end)), '[]'::jsonb)
  )
$$;
grant execute on function public.exam_history_data(uuid[], boolean) to authenticated;
revoke execute on function public.exam_history_data(uuid[], boolean) from anon;
