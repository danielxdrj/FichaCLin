import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// .env fica na raiz do monorepo e nunca é versionado (REQ-18 da segurança do repositório).
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../../.env') });

const isProd = process.env.NODE_ENV === 'production';

function env(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return devDefault;
}

export const config = {
  isProd,
  port: Number(process.env.API_PORT ?? 3333),
  databaseUrl: env('DATABASE_URL', 'postgres://fichaclin_app:dev_app_password@localhost:5434/fichaclin'),
  ownerDatabaseUrl: env('DATABASE_OWNER_URL', 'postgres://fichaclin_owner:dev_owner_password@localhost:5434/fichaclin'),
  appDbPassword: env('APP_DB_PASSWORD', 'dev_app_password'),
  dpo: {
    // REQ-10: canal do encarregado exibido na tela de Suporte.
    name: process.env.DPO_NAME ?? 'Encarregado (a definir)',
    email: process.env.DPO_EMAIL ?? 'encarregado@fichaclin.example',
  },
  // REQ-27: cookies só por HTTPS em produção. COOKIE_SECURE=false apenas para a stack local em http://localhost.
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  session: { ttlHours: 12, cookieName: 'fc_session' },
  login: { maxAttempts: 5, lockMinutes: 15 }, // REQ-25
};
