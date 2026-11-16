import argon2 from 'argon2';

// REQ-23: senhas com Argon2 (argon2id, parâmetros OWASP).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Política mínima de senha. */
export function passwordProblems(plain: string): string | null {
  if (plain.length < 10) return 'A senha precisa ter pelo menos 10 caracteres';
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) return 'A senha precisa ter letras e números';
  return null;
}
