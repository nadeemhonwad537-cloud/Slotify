import { config as loadEnv } from 'dotenv';
import path from 'path';
import { resolveDisposableTestDatabase } from '../src/config/testDatabaseSafety';

// Rebuilds the TEST database from the real migrations + reference seed before the suite runs.
export default async function setup() {
  // Load .env from the backend root so real credentials are available.
  // This runs in the globalSetup process which does not go through vitest's env injection,
  // so we must load dotenv explicitly here as well.
  const envPath = path.resolve(__dirname, '../.env');
  const { parsed, error } = loadEnv({ path: envPath });
  if (error || !parsed) {
    throw new Error(`globalSetup: could not load .env from ${envPath} — ${error?.message ?? 'no values parsed'}`);
  }
  if (!parsed.DB_PASSWORD) {
    throw new Error('globalSetup: DB_PASSWORD is missing in .env — refusing to start tests');
  }

  const testDatabase = resolveDisposableTestDatabase(parsed, process.env);
  console.info(`[test-db-safety] Resolved target: DB_NAME=${testDatabase.name}, DB_HOST=${testDatabase.host}`);

  // The destructive setup is restricted to an explicitly approved disposable database.
  Object.assign(process.env, {
    NODE_ENV:    'test',
    DB_HOST:     testDatabase.host,
    DB_PORT:     parsed.DB_PORT  ?? '3306',
    DB_USER:     parsed.DB_USER  ?? 'slotify',
    DB_PASSWORD: parsed.DB_PASSWORD,   // real password from .env, never hardcoded
    DB_NAME:     testDatabase.name,
    JWT_SECRET:  'test-only-secret-0123456789abcdef0123456789abcdef',
  });

  const { resetDatabase } = await import('../src/db/reset');
  const { runMigrations } = await import('../src/db/migrate');
  await resetDatabase();
  await runMigrations({ seed: true });
}
