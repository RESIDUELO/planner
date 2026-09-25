import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx, one } from '../db';
import { hashToken, requireUser, SESSION_COOKIE } from '../auth';
import { HttpError } from '../errors';

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200),
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.').max(200),
});
const registration = credentials.extend({ name: z.string().trim().min(2, 'Informe seu nome.').max(120) });

// Limitador simples contra força bruta (por IP, em memória)
const attempts = new Map<string, { n: number; until: number }>();
function throttle(ip: string) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.until < now) {
    attempts.set(ip, { n: 1, until: now + 10 * 60_000 });
    return;
  }
  a.n++;
  if (a.n > 30) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
}

export default async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/me', async (req) => ({ user: req.user }));

  app.post('/api/auth/register', async (req, reply) => {
    throttle(req.ip);
    const body = registration.parse(req.body);
    const id = await tx(null, async (db) => (await one<{ id: string }>(db, 'select auth.register($1, $2, $3) as id', [body.email, body.password, body.name]))!.id);
    await app.startSession(reply, id, false, req.headers['user-agent']);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    throttle(req.ip);
    const body = credentials.parse(req.body);
    const row = await tx(null, (db) => one<{ id: string | null }>(db, 'select auth.verify_login($1, $2) as id', [body.email, body.password]));
    if (!row?.id) throw new HttpError(401, 'E-mail ou senha incorretos.');
    await app.startSession(reply, row.id, false, req.headers['user-agent']);
    return { ok: true };
  });

  app.post('/api/auth/guest', async (req, reply) => {
    throttle(req.ip);
    const id = await tx(null, async (db) => (await one<{ id: string }>(db, 'select auth.create_guest() as id'))!.id);
    await app.startSession(reply, id, true, req.headers['user-agent']);
    return { ok: true };
  });

  /** Visitante → conta comum, mantendo todo o progresso. */
  app.post('/api/auth/upgrade', async (req) => {
    const u = requireUser(req);
    if (!u.isGuest) throw new HttpError(400, 'Sua conta já está registrada.');
    const body = registration.parse(req.body);
    await tx(req.sessionHash, (db) => db.query('select auth.upgrade_guest($1, $2, $3)', [body.email, body.password, body.name]));
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await tx(null, (db) => db.query('select auth.end_session($1)', [hashToken(token)]));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.patch('/api/auth/profile', async (req) => {
    requireUser(req);
    const body = z.object({ name: z.string().trim().min(2).max(120) }).parse(req.body);
    await tx(req.sessionHash, (db) => db.query('update public.user_profiles set name = $1 where user_id = app.current_user_id()', [body.name]));
    return { ok: true };
  });
}
