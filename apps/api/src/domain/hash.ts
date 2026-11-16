import { createHash } from 'node:crypto';

/** JSON canônico: chaves ordenadas, sem espaços — o mesmo conteúdo sempre gera o mesmo hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface SignablePayload {
  entryId: string;
  patientId: string;
  kind: string;
  content: unknown;
  authorId: string;
  authorCro: string | null;
  amendsId: string | null;
  createdAt: string;
  signedAt: string;
}

/**
 * REQ-04: assinatura eletrônica simples do MVP = sessão autenticada com 2FA
 * + carimbo de tempo + hash SHA-256 do registro + trilha de auditoria.
 * Não substitui assinatura ICP-Brasil (fase 2).
 */
export function signatureHash(p: SignablePayload): string {
  return sha256(canonicalJson(p));
}
