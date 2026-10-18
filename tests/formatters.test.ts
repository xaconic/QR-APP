import assert from 'node:assert/strict';
import test from 'node:test';
import { formatEventDate } from '../lib/formatters.ts';

test('formats event dates in Manila time', () => {
  assert.equal(formatEventDate('2026-10-18T16:30:00.000Z'), 'Mon, Oct 19, 2026');
});

test('omits dates that are missing or invalid', () => {
  assert.equal(formatEventDate(null), null);
  assert.equal(formatEventDate('not-a-date'), null);
});
