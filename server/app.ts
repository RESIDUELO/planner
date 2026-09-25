import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { registerAuth } from './auth';
import { registerErrorHandler } from './errors';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import adminRoutes from './routes/admin';

export interface AppOptions {
  cookieSecure?: boolean;
  staticDir?: string | null;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024, trustProxy: true });
  await app.register(cookie);
  registerErrorHandler(app);
  registerAuth(app, { cookieSecure: opts.cookieSecure ?? false });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    return payload;
  });

  app.get('/api/health', async () => ({ ok: true, name: 'Residência Planner' }));
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(adminRoutes);

  const dir = opts.staticDir;
  if (dir && existsSync(dir)) {
    await app.register(fastifyStatic, { root: dir, wildcard: false });
    // SPA: qualquer rota fora de /api devolve o index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Rota não encontrada.' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}

export const defaultStaticDir = join(process.cwd(), 'dist');
