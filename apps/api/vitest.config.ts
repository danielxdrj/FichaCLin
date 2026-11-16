import { defineConfig } from 'vitest/config';

// Testes de integração usam o banco fichaclin_test (criado pelo docker/initdb), nunca o de desenvolvimento.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://fichaclin_app:dev_app_password@localhost:5434/fichaclin_test',
      DATABASE_OWNER_URL: 'postgres://fichaclin_owner:dev_owner_password@localhost:5434/fichaclin_test',
    },
  },
});
