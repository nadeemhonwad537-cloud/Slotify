import assert from 'node:assert/strict';
import test from 'node:test';
import { dayLatestEnd, SATURDAY_LATEST_END } from '../src/rules/scheduleRules';

test('Saturday hard stop uses the owner-confirmed 12:30 cutoff', () => {
  assert.equal(SATURDAY_LATEST_END, '12:30:00');
  assert.equal(dayLatestEnd('SAT', null), '12:30:00');
  assert.equal(dayLatestEnd('SAT', '12:00:00'), '12:00:00');
  assert.equal(dayLatestEnd('SAT', '13:00:00'), '12:30:00');
});

test('weekday closing times remain term-configured', () => {
  assert.equal(dayLatestEnd('MON', null), null);
  assert.equal(dayLatestEnd('FRI', '17:00:00'), '17:00:00');
});
