import { buildApp, defaultStaticDir } from './app';
import { initPool } from './db';
import { loadEnv } from './env';

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL (veja .env.example).');
  process.exit(1);
}
initPool(url);
const app = await buildApp({
  logger: true,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  staticDir: process.env.NODE_ENV === 'production' ? defaultStaticDir : null,
});
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
