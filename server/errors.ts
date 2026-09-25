import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Registro') => new HttpError(404, `${what} não encontrado.`);
export const forbidden = (msg = 'Acesso negado.') => new HttpError(403, msg);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);

const PG_MESSAGES: Record<string, string> = {
  email_em_uso: 'Este e-mail já está cadastrado.',
  senha_curta: 'A senha precisa ter pelo menos 8 caracteres.',
  nao_e_visitante: 'Somente contas de visitante podem ser convertidas.',
};

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'Dados inválidos.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const code: string | undefined = err?.code;
    const known = PG_MESSAGES[err?.message];
    // Violação de RLS / privilégio: o banco recusou a operação.
    if (code === '42501') return reply.status(403).send({ error: known ?? 'Operação não permitida para o seu perfil.' });
    if (code === '23505') return reply.status(409).send({ error: known ?? 'Registro duplicado.', details: err.detail });
    if (code === '23503') return reply.status(409).send({ error: 'Registro relacionado inexistente ou em uso.', details: err.detail });
    if (code === '23514' || code === '22023' || code === '22P02' || code === '22007' || code === '22008') {
      return reply.status(400).send({ error: known ?? 'Valor inválido.', details: err.detail ?? err.message });
    }
    if (err?.validation) return reply.status(400).send({ error: 'Requisição inválida.', details: err.message });
    if (err?.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Erro interno.' });
  });
}
