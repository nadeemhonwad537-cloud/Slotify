import { config as loadEnv } from 'dotenv';
import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';
import { resolveDisposableTestDatabase } from './src/config/testDatabaseSafety';

// Load backend/.env for credentials and the explicitly approved disposable test target.
const envPath = path.resolve(__dirname, '.env');
const { parsed: dotenvParsed, error: dotenvError } = loadEnv({ path: envPath });
if (dotenvError || !dotenvParsed) {
  throw new Error(`vitest.config.ts: could not load .env from ${envPath} — ${dotenvError?.message ?? 'no values parsed'}`);
}

const testDatabase = resolveDisposableTestDatabase(dotenvParsed, process.env);

if (dotenvParsed.DB_PASSWORD === undefined || dotenvParsed.DB_PASSWORD === '') {
  throw new Error('vitest.config.ts: DB_PASSWORD is missing in .env — refusing to start tests');
}

console.info(`[test-db-safety] Resolved target: DB_NAME=${testDatabase.name}, DB_HOST=${testDatabase.host}`);

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.node.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      NODE_ENV:   'test',
      DB_HOST:    testDatabase.host,
      DB_PORT:    dotenvParsed.DB_PORT   ?? '3306',
      DB_USER:    dotenvParsed.DB_USER   ?? 'slotify',
      DB_PASSWORD: dotenvParsed.DB_PASSWORD,   // real password, never hardcoded
      DB_NAME:    testDatabase.name,
      JWT_SECRET: 'test-only-secret-0123456789abcdef0123456789abcdef',
      BCRYPT_COST: '4',
      ALLOWED_ORIGINS: 'http://localhost:5173',
    },
  },
});
