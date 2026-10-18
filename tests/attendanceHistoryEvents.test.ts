import assert from 'node:assert/strict';
import test from 'node:test';
import {
  notifyAttendanceHistoryUpdated,
  subscribeToAttendanceHistoryUpdates,
} from '../lib/attendanceHistoryEvents.ts';

test('successful attendance updates notify active history listeners', () => {
  let refreshCount = 0;
  const unsubscribe = subscribeToAttendanceHistoryUpdates(() => {
    refreshCount += 1;
  });

  notifyAttendanceHistoryUpdated();
  unsubscribe();
  notifyAttendanceHistoryUpdated();

  assert.equal(refreshCount, 1);
});

test('all active history listeners receive the update', () => {
  let firstCount = 0;
  let secondCount = 0;
  const unsubscribeFirst = subscribeToAttendanceHistoryUpdates(() => { firstCount += 1; });
  const unsubscribeSecond = subscribeToAttendanceHistoryUpdates(() => { secondCount += 1; });

  notifyAttendanceHistoryUpdated();
  unsubscribeFirst();
  unsubscribeSecond();

  assert.deepEqual([firstCount, secondCount], [1, 1]);
});
