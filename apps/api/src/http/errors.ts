export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (code = 'UNAUTHENTICATED', msg = 'Faça login para continuar') => new HttpError(401, code, msg);
export const forbidden = (msg = 'Você não tem permissão para esta ação', code = 'FORBIDDEN') => new HttpError(403, code, msg);
export const notFound = (msg = 'Registro não encontrado') => new HttpError(404, 'NOT_FOUND', msg);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const conflict = (msg: string) => new HttpError(409, 'CONFLICT', msg);
