import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEventAttendanceSummary } from '../lib/attendanceSummary.ts';

function student(id: string, status: string | null, recordedAt: string | null = null) {
  return {
    id,
    display_id: `STU-${id}`,
    full_name: `Student ${id}`,
    email: `${id}@example.test`,
    course_id: null,
    course_code: null,
    year_level_name: null,
    year_level_id: null,
    section_name: null,
    section_code: null,
    section_id: null,
    attendance_id: status ? `ATT-${id}` : null,
    status,
    recorded_at: recordedAt,
  };
}

test('finalized roster counts unrecorded students as absent', () => {
  const result = normalizeEventAttendanceSummary({
    students: [student('1', 'present'), student('2', null), student('3', null)],
  }, true);

  assert.deepEqual(
    result && [result.total, result.present, result.late, result.absent, result.pending],
    [3, 1, 0, 2, 0],
  );
});

test('active roster leaves students without records pending', () => {
  const result = normalizeEventAttendanceSummary({
    students: [student('1', 'present'), student('2', null), student('3', null)],
  });

  assert.deepEqual(
    result && [result.total, result.present, result.late, result.absent, result.pending],
    [3, 1, 0, 0, 2],
  );
});

test('mixed statuses sum to the deduplicated roster total', () => {
  const result = normalizeEventAttendanceSummary({
    students: [
      student('1', 'present'),
      student('2', 'present'),
      student('3', 'late'),
      student('4', 'absent'),
      student('5', null),
    ],
  });

  assert.deepEqual(
    result && [result.total, result.present, result.late, result.absent, result.pending],
    [5, 2, 1, 1, 1],
  );
});

test('empty roster is safe and duplicate students count once using latest record', () => {
  const empty = normalizeEventAttendanceSummary({ students: [] });
  const duplicate = normalizeEventAttendanceSummary({
    students: [
      student('1', 'present', '2026-10-17T08:00:00Z'),
      student('1', 'late', '2026-10-17T08:10:00Z'),
    ],
  });

  assert.deepEqual(empty && [empty.total, empty.pending], [0, 0]);
  assert.deepEqual(duplicate && [duplicate.total, duplicate.late, duplicate.students[0]?.status], [1, 1, 'late']);
});

test('rejects malformed summary payloads', () => {
  assert.equal(normalizeEventAttendanceSummary(null), null);
  assert.equal(normalizeEventAttendanceSummary({ students: [{}] }), null);
});
