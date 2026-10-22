import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchNullableFacultyProfile } from '../../frontend/src/lib/facultyProfileQuery';

test('faculty profile query preserves a valid profile', async () => {
  const profile = { faculty_id: 17, name: 'Example Faculty' };
  const result = await fetchNullableFacultyProfile(async () => profile);
  assert.deepEqual(result, profile);
});

test('faculty profile query returns null for an unlinked account', async () => {
  const result = await fetchNullableFacultyProfile(async () => null);
  assert.equal(result, null);
});

test('faculty profile query never resolves to undefined for a null-like response', async () => {
  const result = await fetchNullableFacultyProfile<{ faculty_id: number }>(async () => undefined);
  assert.equal(result, null);
});
