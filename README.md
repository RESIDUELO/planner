# Residência Planner

> Planeje seus estudos com base no que realmente cai na sua prova.

Plataforma que transforma o **histórico das provas cadastradas pelo administrador** em uma estratégia personalizada de preparação para residência médica:

**provas → questões → classificação → frequência → ranking → planner → checklist → desempenho → repetição espaçada → calendário → cobertura estimada**

## Regra fundamental: base fechada

O sistema **só conhece o que o administrador cadastra**. Não há scraping, busca na internet, APIs externas nem atualização automática de datas, valores ou questões. Se só três provas forem cadastradas, só essas três existem. Nenhuma migração cria instituições, provas, edições, questões ou assuntos: as únicas tabelas pré-populadas são `study_methods` e `algorithm_versions`, que são configuração do sistema.

## Stack

| Camada | Tecnologia |
|---|---|
| Banco | PostgreSQL 16 com Row Level Security, `pgcrypto` e triggers de auditoria |
| API | Node 20+, Fastify 5, `pg`, zod |
| Web | React 19, React Router, TanStack Query, Tailwind CSS 4, Vite |
| Domínio | TypeScript puro em `shared/`, sem dependências e testado isoladamente |
| Testes | Vitest (unidade e API contra Postgres real) e Playwright (E2E) |

```
db/migrations/     esquema, segurança (RLS, papéis, auditoria), dados de referência do sistema
shared/            algoritmos: estatística histórica, prioridade, memória (FSRS-like), agenda, domínio
server/            API (rotas de auth, aluno e admin; serviços de planner, agenda e importação)
web/src/           interface (páginas do aluno e /admin)
data/import/       arquivos prontos para o admin importar (gerados a partir dos relatórios PDF)
scripts/           conversor PDF → importação, criação de admin, reset de banco
tests/             unit/, api/, e2e/
```

## Como rodar

```bash
docker compose up -d                 # ou use um PostgreSQL 16 existente
cp .env.example .env
npm install
npm run db:migrate
npm run admin:create -- --email voce@exemplo.com --name "Seu Nome" --password "senha-forte"
npm run dev                          # API :3001 + web :5173
```

Produção: `npm run build && npm start` (a API serve o `dist/` e usa `COOKIE_SECURE=true` atrás de HTTPS).

## Segurança (seção 47)

A segurança não depende do frontend nem apenas das rotas:

- A API roda **toda** transação com `SET LOCAL ROLE rp_app`, um papel sem privilégios de dono e sujeito às policies de RLS.
- A API envia ao banco **apenas o hash do token de sessão**. O usuário e o papel (`admin`, `user`, `visitor`) são resolvidos **dentro do banco** (`app.current_user_id()`, `app.is_admin()`), então um bug de rota não consegue se passar por outro usuário.
- **Tabelas globais** (instituições, bancas, provas, edições, questões, assuntos…): leitura filtrada (usuários só veem edições `published`), escrita só por admin via policy e **sem `DELETE`** concedido. O histórico é preservado com `active = false` ou `status = archived`.
- **Dados individuais**: policy `user_id = app.current_user_id()` em todas as tabelas.
- Ninguém altera o próprio papel: um trigger bloqueia mudança de `role`/`active` por não-admin e a auto-promoção.
- Senhas usam bcrypt via `pgcrypto`; o hash nunca sai do banco (`auth.verify_login`).
- `admin_audit_logs` é append-only, preenchido por trigger com quem, quando, entidade, ação, valor anterior e valor novo.
- Proteção CSRF por cabeçalho obrigatório em escritas, cookies `httpOnly` + `SameSite=Lax` e limitador de tentativas de login.

`tests/api/flow.test.ts` testa isso tudo diretamente no banco: INSERT, UPDATE e DELETE forjados por um aluno são recusados.

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
npm test                                          # unidade + API (requer PostgreSQL; TEST_DATABASE_URL opcional)
PW_CHROMIUM_PATH=/caminho/chrome npm run test:e2e # E2E no navegador (sobe servidor e banco próprios)
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
| RLS direto no banco | `api/flow.test.ts › Segurança` |

## Preparado para evoluir

Algoritmos versionados, domínio isolado em `shared/`, tabela de tentativas por questão (`user_question_attempts`) para simulados e prática com enunciado, e aliases de assunto para classificação assistida por IA. Qualquer sugestão de IA deve continuar passando pela aprovação do admin. Nada disso foi implementado além do necessário para o produto principal.
