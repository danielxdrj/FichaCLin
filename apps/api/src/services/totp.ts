import { authenticator } from 'otplib';

// REQ-24: segundo fator TOTP (RFC 6238), compatível com Google Authenticator, Authy etc.
authenticator.options = { window: 1 };

export function newTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, 'Fichaclin', secret);
}

export function verifyTotp(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return authenticator.check(code, secret);
}

export function currentTotp(secret: string): string {
  return authenticator.generate(secret);
}
