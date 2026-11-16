// Mostra o código 2FA atual dos usuários FICTÍCIOS do seed (somente desenvolvimento).
import { DEV_USERS } from '../src/db/seed.js';
import { currentTotp } from '../src/services/totp.js';

for (const u of DEV_USERS) {
  console.log(`${u.email.padEnd(36)} ${u.totp ? currentTotp(u.totp) : '(sem 2FA — recepção)'}`);
}
