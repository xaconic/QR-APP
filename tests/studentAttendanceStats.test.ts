import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateStudentAttendanceStats,
  deduplicateStudentAttendanceRecords,
  isInCurrentManilaMonth,
  type StudentAttendanceStatRecord,
} from '../lib/studentAttendanceStats.ts';

function record(
  eventKey: string,
  status: StudentAttendanceStatRecord['status'],
  date: string,
  attendanceFinalized = true,
): StudentAttendanceStatRecord {
  return {
    eventKey,
    status,
    occurredAt: date,
    eventDate: date,
    attendanceFinalized,
  };
}

test('finalized attendance counts agree with the deduplicated event records', () => {
  const stats = calculateStudentAttendanceStats([
    record('event-1', 'present', '2026-10-15T08:00:00Z'),
    record('event-2', 'absent', '2026-10-14T08:00:00Z'),
    record('event-3', 'absent', '2026-10-13T08:00:00Z'),
  ], new Date('2026-10-20T00:00:00Z'));

  assert.deepEqual(
    [stats.totalEvents, stats.present, stats.late, stats.absent, stats.excused, stats.attended, stats.attendanceRate],
    [3, 1, 0, 2, 0, 1, 33],
  );
});

test('unfinalized present check-ins are counted immediately but do not create absences', () => {
  const stats = calculateStudentAttendanceStats([
    record('active-event', 'present', '2026-10-15T08:00:00Z', false),
  ], new Date('2026-10-20T00:00:00Z'));

  assert.deepEqual(
    [stats.totalEvents, stats.present, stats.absent, stats.eligibleEvents, stats.attendanceRate],
    [1, 1, 0, 1, 100],
  );
});

test('an unfinalized absence is not counted until the event is finalized', () => {
  const stats = calculateStudentAttendanceStats([
    record('active-event', 'absent', '2026-10-15T08:00:00Z', false),
  ], new Date('2026-10-20T00:00:00Z'));

  assert.deepEqual(
    [stats.totalEvents, stats.absent, stats.eligibleEvents, stats.attendanceRate],
    [0, 0, 0, null],
  );
});

test('late check-ins count as attended and excused outcomes are excluded from rate denominator', () => {
  const stats = calculateStudentAttendanceStats([
    record('event-1', 'present', '2026-10-15T08:00:00Z'),
    record('event-2', 'late', '2026-10-14T08:00:00Z'),
    record('event-3', 'absent', '2026-10-13T08:00:00Z'),
    record('event-4', 'excused', '2026-10-12T08:00:00Z'),
  ], new Date('2026-10-20T00:00:00Z'));

  assert.deepEqual(
    [stats.totalEvents, stats.attended, stats.eligibleEvents, stats.excused, stats.attendanceRate],
    [4, 2, 3, 1, 67],
  );
});

test('duplicate event records count once and latest correction determines status', () => {
  const records = [
    record('event-1', 'absent', '2026-10-15T08:00:00Z'),
    record('event-1', 'late', '2026-10-15T08:05:00Z'),
  ];
  const unique = deduplicateStudentAttendanceRecords(records);
  const stats = calculateStudentAttendanceStats(records, new Date('2026-10-20T00:00:00Z'));

  assert.deepEqual([unique.length, unique[0]?.status], [1, 'late']);
  assert.deepEqual([stats.totalEvents, stats.late, stats.absent, stats.attendanceRate], [1, 1, 0, 100]);
});

test('empty history has no fabricated percentage or streak', () => {
  const stats = calculateStudentAttendanceStats([], new Date('2026-10-20T00:00:00Z'));

  assert.deepEqual([stats.totalEvents, stats.attendanceRate, stats.currentMonthRate, stats.currentStreak], [0, null, null, 0]);
});

test('monthly date filtering uses Manila calendar dates', () => {
  const now = new Date('2026-10-02T00:30:00Z');

  assert.equal(isInCurrentManilaMonth('2026-10-01T16:30:00Z', now), true);
  assert.equal(isInCurrentManilaMonth('2026-09-30T15:59:00Z', now), false);
  assert.equal(isInCurrentManilaMonth(null, now), false);
});
