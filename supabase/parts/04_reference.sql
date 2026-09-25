-- Dados de referência do SISTEMA (não são dados de provas).
-- Nenhuma instituição, prova, edição, questão ou assunto é criado aqui:
-- essa base é exclusivamente alimentada pelo administrador.

insert into public.study_methods (code, name, activity_type, default_minutes, sort_order) values
  ('video',         'Videoaula',     'video',         60, 1),
  ('flashcards',    'Flashcards',    'flashcards',    20, 2),
  ('summary',       'Resumo',        'summary',       40, 3),
  ('reading',       'Leitura',       'reading',       45, 4),
  ('questions',     'Questões',      'questions',     40, 5),
  ('active_recall', 'Revisão ativa', 'active_recall', 20, 6);

insert into public.algorithm_versions (name, version, description, parameters) values
  ('Prioridade', 'priority_v1',
   'Ranking pela frequência histórica ponderada das provas selecionadas (desempate por presença e recência) e score dinâmico: 40% histórico, 25% proximidade da prova, 20% esquecimento, 15% desempenho.',
   '{"weights":{"historical":0.40,"proximity":0.25,"forgetting":0.20,"performance":0.15}}'),
  ('Repetição espaçada', 'fsrs_v1',
   'Modelo próprio inspirado no FSRS: estabilidade, dificuldade e retrievability com curva de esquecimento em lei de potência; retenção-alvo e intervalo máximo ajustados pelo tempo até a prova; nunca agenda após a prova.',
   '{}'),
  ('Agenda', 'scheduler_v1',
   'Distribuição diária respeitando horas, dias de estudo, questões/dia e carga projetada de revisões; reta final reservada para revisões.',
   '{}');
