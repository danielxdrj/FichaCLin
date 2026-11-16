/**
 * Cria (ou vincula) um usuário e dá papel de DONO nos consultórios existentes.
 * A senha é digitada no terminal e nunca aparece na tela nem em argumentos de linha de comando.
 *
 * Uso:
 *   npm run user:create -- --email voce@exemplo.com --name "Seu Nome" [--cro "CRO-SP 12345"] [--role owner|dentist|reception]
 *
 * 2FA: dono e dentista cadastram o aplicativo autenticador no primeiro login (REQ-24).
 */
import pg from 'pg';
import { config } from '../src/config.js';
import { hashPassword, passwordProblems } from '../src/services/password.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Lê uma linha do terminal sem ecoar os caracteres. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('Rode este comando em um terminal interativo.'));
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (c === '\u0003') process.exit(130); // Ctrl+C
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim();
  const cro = arg('cro')?.trim() ?? null;
  const role = arg('role') ?? 'owner';
  if (!email || !name) throw new Error('Informe --email e --name.');
  if (!['owner', 'dentist', 'reception'].includes(role)) throw new Error('--role deve ser owner, dentist ou reception.');
  if (role === 'dentist' && !cro) throw new Error('Dentista precisa de --cro.');

  const db = new pg.Client({ connectionString: config.ownerDatabaseUrl });
  await db.connect();
  try {
    let user = (await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0];
    if (!user) {
      const password = await askHidden('Escolha uma senha (mín. 10 caracteres, letras e números): ');
      const problem = passwordProblems(password);
      if (problem) throw new Error(problem);
      if (password !== (await askHidden('Repita a senha: '))) throw new Error('As senhas não conferem.');
      user = (
        await db.query<{ id: string }>(
          'INSERT INTO users (email, name, cro, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
          [email, name, cro, await hashPassword(password)],
        )
      ).rows[0];
      console.log(`Usuário criado: ${email}`);
    } else {
      console.log(`Usuário já existe: ${email} (senha mantida)`);
    }
    const clinics = await db.query<{ id: string; name: string }>('SELECT id, name FROM clinics ORDER BY name');
    for (const c of clinics.rows) {
      await db.query(
        `INSERT INTO memberships (clinic_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (clinic_id, user_id) DO UPDATE SET role = EXCLUDED.role, active = true`,
        [c.id, user.id, role],
      );
      console.log(`  vinculado a "${c.name}" como ${role}`);
    }
    if (role !== 'reception') console.log('No primeiro login, cadastre o Fichaclin no seu app autenticador (2FA).');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(`Erro: ${err.message}`);
  process.exit(1);
});
