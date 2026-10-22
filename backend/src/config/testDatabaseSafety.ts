export interface TestDatabaseTarget {
  name: string | undefined;
  allowReset: string | undefined;
  host: string | undefined;
}

export interface TestDatabaseEnvironment {
  DB_HOST?: string;
  SLOTIFY_TEST_DB_NAME?: string;
  SLOTIFY_ALLOW_DISPOSABLE_DB_RESET?: string;
}

export function assertDisposableTestDatabase(target: TestDatabaseTarget): string {
  if (target.allowReset !== 'YES') {
    throw new Error('Database-backed tests require SLOTIFY_ALLOW_DISPOSABLE_DB_RESET=YES.');
  }
  if (!target.name || !/^slotify_test_disposable_[a-z0-9_]+$/.test(target.name)) {
    throw new Error('Database-backed tests require SLOTIFY_TEST_DB_NAME matching slotify_test_disposable_<unique_suffix>.');
  }
  if (!target.host || !['127.0.0.1', 'localhost', '::1'].includes(target.host.toLowerCase())) {
    throw new Error('Database-backed tests are restricted to a local MySQL host.');
  }
  return target.name;
}

export function resolveDisposableTestDatabase(
  fileEnvironment: TestDatabaseEnvironment,
  processEnvironment: TestDatabaseEnvironment,
): { name: string; host: string } {
  const host = processEnvironment.DB_HOST ?? fileEnvironment.DB_HOST ?? '127.0.0.1';
  const name = assertDisposableTestDatabase({
    name: processEnvironment.SLOTIFY_TEST_DB_NAME ?? fileEnvironment.SLOTIFY_TEST_DB_NAME,
    allowReset: processEnvironment.SLOTIFY_ALLOW_DISPOSABLE_DB_RESET
      ?? fileEnvironment.SLOTIFY_ALLOW_DISPOSABLE_DB_RESET,
    host,
  });
  return { name, host };
}
