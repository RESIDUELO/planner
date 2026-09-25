-- =====================================================================
-- Datas oficiais das próximas provas (cadastradas pelo administrador).
-- A FAMEMA (08/12/2026) já entra com a data pelo arquivo supabase/data/famema_r1.sql.
-- Seguro para rodar mais de uma vez.
-- =====================================================================
update public.exam_editions ed set exam_date = v.d
  from (values ('FAMERP', date '2026-11-24'), ('UNOESTE/HRPP', date '2026-12-05'),
               ('HU-UEL', date '2026-11-08'), ('FAMEMA', date '2026-12-08')) as v(inst, d),
       public.exams e, public.institutions i
 where ed.exam_id = e.id and e.institution_id = i.id and i.abbreviation = v.inst
   and e.name = 'R1 Acesso Direto' and ed.year = 2027;

-- Conferência
select i.abbreviation, ed.year, ed.exam_date
  from public.exam_editions ed join public.exams e on e.id = ed.exam_id join public.institutions i on i.id = e.institution_id
 where ed.year = 2027 order by 1;
