# Residência Planner

> Planeje seus estudos com base no que realmente cai na sua prova.

Plataforma que transforma o **histórico das provas cadastradas pelo administrador** em uma estratégia personalizada de preparação para residência médica:

**provas → questões → classificação → frequência → ranking → planner → checklist → desempenho → repetição espaçada → calendário → cobertura estimada**

## Regra fundamental: base fechada

O sistema **só conhece o que o administrador cadastra**. Não há scraping, busca na internet, APIs externas nem atualização automática de datas, valores ou questões. Se só três provas forem cadastradas, só essas três existem. O `schema.sql` não cria instituições, provas, edições, questões nem assuntos: as únicas tabelas pré-populadas são `study_methods` e `algorithm_versions`, que são configuração do sistema.

## Arquitetura

Site estático no **GitHub Pages** + **Supabase** (PostgreSQL, Auth e API REST). Não há servidor próprio.

| Camada | Tecnologia |
|---|---|
| Banco e segurança | Supabase (PostgreSQL) com Row Level Security, funções e triggers de auditoria |
| Login | Supabase Auth (e-mail e senha; visitante = login anônimo do Supabase) |
| Site | React 19, React Router, TanStack Query, Tailwind CSS 4, Vite (publicado no GitHub Pages) |
| Algoritmos | TypeScript puro em `shared/`, sem dependências, rodando no navegador |
| Testes | Vitest (unidade e integração contra um Supabase local) e Playwright (E2E) |

```
supabase/schema.sql   arquivo único para o SQL Editor (gerado a partir de supabase/parts/)
supabase/parts/       tabelas, segurança (RLS, papéis, auditoria), API do banco, dados de referência
shared/               algoritmos: estatística histórica, prioridade, memória (FSRS-like), agenda, domínio
web/src/backend/      camada de dados no navegador (fala com o Supabase; mesmas "rotas" /api/... das telas)
web/src/              interface (páginas do aluno e /admin)
web/public/config.json  URL e anon key do Supabase (públicas por design)
data/import/          arquivos prontos para o admin importar (gerados a partir dos relatórios PDF)
scripts/              Supabase local para testes, conversor PDF → importação
```

## Colocar online (Supabase + GitHub Pages)

1. **Supabase**: crie um projeto em https://supabase.com. Recomendo um projeto novo, separado do jogo.
2. **Banco**: em **SQL Editor → New query**, cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**. Rode só uma vez.
3. **Login**: em **Authentication → Sign In / Providers**, ative **Allow anonymous sign-ins** (necessário para o botão "Continuar como visitante").
   - Se quiser cadastro sem confirmação por e-mail, desative **Confirm email** em **Email**.
   - Em **Authentication → URL Configuration**, coloque a URL do site em **Site URL** (ex.: `https://residuelo.github.io/planner/`).
4. **Chaves**: em **Project Settings → API**, copie a **Project URL** e a chave **anon public**. Depois escolha uma forma de entregá-las ao site:
   - edite [`web/public/config.json`](web/public/config.json) no GitHub com esses dois valores; **ou**
   - crie as *variables* `SUPABASE_URL` e `SUPABASE_ANON_KEY` em **Settings → Secrets and variables → Actions → Variables**.

   Nunca use a chave `service_role` no site.
5. **GitHub Pages**: em **Settings → Pages → Build and deployment → Source**, escolha **GitHub Actions**. Cada push na branch padrão publica o site (workflow [`deploy.yml`](.github/workflows/deploy.yml); para publicar na hora, use **Actions → Publicar no GitHub Pages → Run workflow**) em `https://<usuário>.github.io/<repositório>/`.
6. **Administrador**: crie sua conta pelo próprio site. Depois, no SQL Editor do Supabase, rode:
   ```sql
   select public.make_admin('seu-email@exemplo.com');
   ```
   Saia e entre de novo: o menu **Administração** aparece.
7. **Dados**: em **Administração → Nova prova**, cadastre instituição, prova e edição. Depois use **Importação** com os arquivos de `data/import/`.

## Desenvolvimento local

```bash
npm install
npm run supabase:local        # Supabase local (PostgreSQL + Auth + API REST), sem Docker; porta 54321
# crie web/public/config.local.json com a URL e a anon key que o comando acima imprime
npm run dev                   # site em http://localhost:5173
```

`scripts/local-supabase.mjs` usa um PostgreSQL existente (`PG_ADMIN_URL`, padrão `postgres://rp_owner:rp_owner@localhost:5432/postgres`) e baixa os binários oficiais do Supabase Auth e do PostgREST na primeira execução.

## Segurança (seção 47)

Como o navegador fala direto com o banco, **todas** as regras de acesso vivem no PostgreSQL:

- **Tabelas globais** (instituições, bancas, provas, edições, questões, assuntos…):
  - leitura filtrada: usuários só veem edições `published`;
  - escrita só para administradores, via policy;
  - **nenhum `DELETE`** concedido: o histórico é preservado com `active = false` ou `status = archived`.
- **Dados individuais**: policy `user_id = auth.uid()` em todas as tabelas.
- **Papel no banco**: o papel (`admin`, `user`, `visitor`) fica em `user_profiles`, e um trigger impede que alguém altere o próprio papel ou status. `make_admin` só funciona no SQL Editor.
- **Funções de administração**: verificam `app.is_admin()`, e o RLS barra de novo na escrita.
- **Auditoria**: `admin_audit_logs` é append-only, preenchido por trigger com quem, quando, entidade, ação, valor anterior e valor novo.
- **Sem login, nada é lido**: o papel `anon` não tem acesso às tabelas.

`tests/api/flow.test.ts` faz requisições **forjadas direto na API REST do Supabase** com o token de um aluno (INSERT, UPDATE e DELETE em tabelas globais, auto-promoção, funções de admin) e confirma que o banco recusa todas.

## Algoritmos (versionados em `algorithm_versions`; parâmetros em `shared/config.ts`)

**Análise histórica (`shared/stats.ts`).** Usa somente as questões cadastradas e separa quatro métricas que não devem ser confundidas: nº absoluto de questões, % da prova, edições em que apareceu e média por edição, além da frequência recente. Questões com vários assuntos são divididas pelo `relevance_weight`. A tela sempre informa a base, por exemplo "Análise baseada em N edições cadastradas." ou "Dados insuficientes para uma análise histórica confiável."

**Prioridade (`priority_v1`).**
- Ranking = fração histórica da prova, com desempate por presença e recência. Em prova única, o assunto que mais caiu é obrigatoriamente o #1.
- Multiprova: média ponderada por prova, com peso = (2 se principal) × (0,5 + proximidade), onde proximidade = 1/(1+dias/60).
- Score dinâmico: 40% histórico, 25% proximidade, 20% esquecimento, 15% desempenho.
- Cada assunto tem a explicação de sua posição.

**Repetição espaçada (`fsrs_v1`, implementação própria).**
- Usa estabilidade, dificuldade e retrievability R(t) = (1 + t/9S)⁻¹, com avaliações Again/Hard/Good/Easy.
- Adaptação à prova: a retenção-alvo sobe de 90% (≥ 120 dias) para 95% (≤ 7 dias).
- Nenhum intervalo passa da metade do tempo restante, e **nenhuma revisão é agendada no dia da prova ou depois**.
- As revisões já agendadas são reajustadas conforme a prova se aproxima.
- Acerto abaixo de 60% em um registro de questões antecipa a revisão.

**Agenda (`scheduler_v1`).**
- Respeita horas/dia, dias da semana e questões/dia (no máximo 40% do dia).
- Reserva a carga projetada de revisões e preenche o restante com assuntos novos em ordem de frequência, método a método.
- Reserva a reta final só para revisões.
- O que não cabe é marcado como "fora do tempo disponível": o planner nunca cria mais horas do que o usuário tem.
- "Recalcular" redistribui o que falta a partir de hoje e mantém o progresso.

**Questões potencialmente dominadas.** Σ (questões esperadas do assunto × domínio estimado), onde domínio = acerto suavizado × memória atual. A interface deixa claro que é uma estimativa, não uma promessa.

## Importação (seções 42–43)

Aceita CSV, XLSX e JSON, com colunas `year, question_number, area, specialty, subject, subsubject, summary|statement, alternative_a…e, correct_answer, annulled, difficulty, question_type, guideline, source, notes` (também em português: `ano, numero, assunto, gabarito, anulada…`).

1. **Prévia**: mostra válidas, inválidas, duplicadas, anuladas, edições que serão criadas e áreas/assuntos **não encontrados**. Nada é gravado nesta etapa.
2. **Decisão**: para cada item não encontrado, o admin escolhe entre associar a um existente (vira alias reconhecido nas próximas importações), criar novo ou ignorar.
3. **Confirmação**: insere tudo numa transação. Edições novas nascem como **rascunho**.

### Dados dos relatórios enviados

`scripts/pdf-annex-to-import.py` converte os anexos de classificação dos três relatórios PDF em `data/import/` (conferido: FAMERP 480 questões com 23 anuladas; UEL 550 com 11 anuladas; UNOESTE R1 500 com 6 anuladas, mais as R+). **Esses arquivos não são carregados automaticamente**: o admin os importa pela tela de Importação. Os relatórios não trazem o enunciado das questões, só o resumo do que cada uma cobra, e por isso o enunciado fica vazio.

As três instituições nomeiam os assuntos de formas diferentes ("Saúde do Trabalhador" × "Saúde do trabalhador (CAT, NR, …)"). Para que a prioridade combinada do modo multiprova cruze os assuntos, use **Admin → Assuntos → Mesclar**: as questões são reclassificadas, o nome antigo vira alias e nada é apagado.

## Testes

```bash
npm run test:unit                                  # algoritmos
npm run test:api                                   # integração contra um Supabase local (PostgreSQL + Auth + PostgREST)
PW_CHROMIUM_PATH=/caminho/chrome npm run test:e2e  # navegador, com o site compilado em /planner/ como no GitHub Pages
```

| Seção 58 | Onde |
|---|---|
| 1 criar usuário · 2 visitante · 20 bloqueio /admin | `e2e/app.spec.ts`, `api/flow.test.ts` |
| 3–4 uma e três provas | `api/flow.test.ts` (multiprova com FAMERP + UEL + UNOESTE) e E2E |
| 5–8 métodos, planner, checklist | API + E2E |
| 9–12 20 questões / 17 acertos, domínio, 1ª revisão | API + E2E |
| 13–14 "Again" antecipa revisão | `api/flow.test.ts`, `unit/memory.test.ts` |
| 15–16 calendário, revisões atrasadas | API (data simulada) + E2E |
| 17–19 persistência | API (nova sessão) + E2E (novo contexto de navegador) |
| 21–25 admin, rascunho invisível, publicação, questões → estatísticas | API + E2E |
| RLS contra requisições forjadas | `api/flow.test.ts › Segurança` |

## Preparado para evoluir

Algoritmos versionados, domínio isolado em `shared/`, tabela de tentativas por questão (`user_question_attempts`) para simulados e prática com enunciado, e aliases de assunto para classificação assistida por IA. Qualquer sugestão de IA deve continuar passando pela aprovação do admin. Nada disso foi implementado além do necessário para o produto principal.
