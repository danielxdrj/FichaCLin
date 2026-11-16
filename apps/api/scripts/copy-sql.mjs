// Copia as migrações SQL para dist/ (o tsc não copia arquivos .sql).
import { cpSync } from 'node:fs';
cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
