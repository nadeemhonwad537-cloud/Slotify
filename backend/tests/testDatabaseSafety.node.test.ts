import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDisposableTestDatabase,
  resolveDisposableTestDatabase,
} from '../src/config/testDatabaseSafety';

test('database-backed tests require explicit reset consent and a uniquely named disposable database', () => {
  assert.throws(
    () => assertDisposableTestDatabase({
      name: 'slotify_test',
      allowReset: 'YES',
      host: '127.0.0.1',
    }),
    /SLOTIFY_TEST_DB_NAME/,
  );
  assert.throws(
    () => assertDisposableTestDatabase({
      name: 'slotify_test_disposable_run1',
      allowReset: undefined,
      host: '127.0.0.1',
    }),
    /SLOTIFY_ALLOW_DISPOSABLE_DB_RESET/,
  );
});

test('database-backed tests reject remote hosts and allow explicit local disposable targets', () => {
  assert.throws(
    () => assertDisposableTestDatabase({
      name: 'slotify_test_disposable_run1',
      allowReset: 'YES',
      host: 'db.example.net',
    }),
    /local MySQL host/,
  );
  assert.equal(assertDisposableTestDatabase({
    name: 'slotify_test_disposable_run1',
    allowReset: 'YES',
    host: '127.0.0.1',
  }), 'slotify_test_disposable_run1');
});

test('process-only disposable target and reset consent override file values', () => {
  assert.deepEqual(resolveDisposableTestDatabase(
    { DB_HOST: '127.0.0.1', SLOTIFY_TEST_DB_NAME: 'slotify_test', SLOTIFY_ALLOW_DISPOSABLE_DB_RESET: undefined },
    {
      SLOTIFY_TEST_DB_NAME: 'slotify_test_disposable_audit_20261022_1219',
      SLOTIFY_ALLOW_DISPOSABLE_DB_RESET: 'YES',
    },
  ), {
    name: 'slotify_test_disposable_audit_20261022_1219',
    host: '127.0.0.1',
  });
});

test('invalid process-only safety overrides fail closed instead of falling back', () => {
  assert.throws(() => resolveDisposableTestDatabase(
    { DB_HOST: '127.0.0.1', SLOTIFY_TEST_DB_NAME: 'slotify_test_disposable_file', SLOTIFY_ALLOW_DISPOSABLE_DB_RESET: 'YES' },
    { SLOTIFY_TEST_DB_NAME: 'slotify_dev' },
  ), /slotify_test_disposable/);
  assert.throws(() => resolveDisposableTestDatabase(
    { DB_HOST: '127.0.0.1' },
    {
      SLOTIFY_TEST_DB_NAME: 'slotify_test_disposable_audit_20261022_1219',
      SLOTIFY_ALLOW_DISPOSABLE_DB_RESET: 'YES',
      DB_HOST: 'db.example.net',
    },
  ), /local MySQL host/);
  assert.throws(() => resolveDisposableTestDatabase(
    { DB_HOST: '127.0.0.1' },
    { SLOTIFY_TEST_DB_NAME: 'slotify_test_disposable_audit_20261022_1219' },
  ), /SLOTIFY_ALLOW_DISPOSABLE_DB_RESET/);
});
