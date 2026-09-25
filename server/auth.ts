import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { tx, one } from './db';
import { forbidden, HttpError } from './errors';

export const SESSION_COOKIE = 'rp_session';
const USER_SESSION_DAYS = 30;
const GUEST_SESSION_DAYS = 365;

export interface SessionUser {
  id: string;
  email: string | null;
  name: string;
  role: 'admin' | 'user' | 'visitor';
  isGuest: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionHash: string | null;
    user: SessionUser | null;
  }
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function registerAuth(app: FastifyInstance, opts: { cookieSecure: boolean }) {
  app.decorateRequest('sessionHash', null);
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    // Proteção CSRF: toda escrita exige um cabeçalho que formulários de outros sites não conseguem enviar.
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.url.startsWith('/api/')) {
      if (req.headers['x-requested-with'] !== 'residencia-planner') throw new HttpError(403, 'Requisição recusada.');
    }
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || !req.url.startsWith('/api/')) return;
    const hash = hashToken(token);
    const info = await tx(null, (db) => one(db, 'select * from auth.session_info($1)', [hash]));
    if (info?.role) {
      req.sessionHash = hash;
      req.user = { id: info.user_id, email: info.email, name: info.name, role: info.role, isGuest: info.is_guest };
    }
  });

  app.decorate('startSession', async (reply: FastifyReply, userId: string, isGuest: boolean, userAgent?: string) => {
    const token = randomBytes(32).toString('base64url');
    const days = isGuest ? GUEST_SESSION_DAYS : USER_SESSION_DAYS;
    await tx(null, (db) => db.query('select auth.create_session($1, $2, $3, $4)', [userId, hashToken(token), days, userAgent ?? null]));
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.cookieSecure,
      maxAge: days * 86400,
    });
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    startSession(reply: FastifyReply, userId: string, isGuest: boolean, userAgent?: string): Promise<void>;
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Faça login para continuar.');
  return req.user;
}

/** Primeira barreira (a segunda é o RLS do banco). */
export function requireAdmin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (u.role !== 'admin') throw forbidden('Área restrita a administradores.');
  return u;
}
