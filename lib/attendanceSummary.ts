export type EventAttendanceStudent = {
  id: string;
  display_id: string | null;
  full_name: string | null;
  email: string;
  course_id: string | null;
  course_code: string | null;
  year_level_name: string | null;
  year_level_id: string | null;
  section_name: string | null;
  section_code: string | null;
  section_id: string | null;
  attendance_id: string | null;
  status: 'present' | 'absent' | 'late' | 'excused' | null;
  recorded_at: string | null;
};

export type EventAttendanceSummary = {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  pending: number;
  students: EventAttendanceStudent[];
};

const attendanceStatuses = ['present', 'absent', 'late', 'excused'] as const;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isAttendanceStudent(value: unknown): value is EventAttendanceStudent {
  if (!value || typeof value !== 'object') return false;
  const student = value as Record<string, unknown>;
  return typeof student.id === 'string'
    && isNullableString(student.display_id)
    && isNullableString(student.full_name)
    && typeof student.email === 'string'
    && isNullableString(student.course_id)
    && isNullableString(student.course_code)
    && isNullableString(student.year_level_name)
    && isNullableString(student.year_level_id)
    && isNullableString(student.section_name)
    && isNullableString(student.section_code)
    && isNullableString(student.section_id)
    && isNullableString(student.attendance_id)
    && (student.status === null || attendanceStatuses.includes(student.status as typeof attendanceStatuses[number]))
    && isNullableString(student.recorded_at);
}

function laterRecord(current: EventAttendanceStudent, candidate: EventAttendanceStudent) {
  const currentTime = current.recorded_at ? Date.parse(current.recorded_at) : Number.NEGATIVE_INFINITY;
  const candidateTime = candidate.recorded_at ? Date.parse(candidate.recorded_at) : Number.NEGATIVE_INFINITY;
  return candidateTime > currentTime;
}

export function normalizeEventAttendanceSummary(
  value: unknown,
  attendanceFinalized = false,
): EventAttendanceSummary | null {
  if (!value || typeof value !== 'object') return null;
  const rawStudents = (value as Record<string, unknown>).students;
  if (!Array.isArray(rawStudents) || !rawStudents.every(isAttendanceStudent)) return null;

  const studentsById = new Map<string, EventAttendanceStudent>();
  rawStudents.forEach((student) => {
    const existing = studentsById.get(student.id);
    if (!existing || laterRecord(existing, student)) studentsById.set(student.id, student);
  });

  const students = Array.from(studentsById.values()).map((student) => ({
    ...student,
    status: student.status ?? (attendanceFinalized ? 'absent' : null),
  }));
  const summary: EventAttendanceSummary = {
    total: students.length,
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    pending: 0,
    students,
  };

  students.forEach((student) => {
    if (student.status === 'present') summary.present += 1;
    else if (student.status === 'absent') summary.absent += 1;
    else if (student.status === 'late') summary.late += 1;
    else if (student.status === 'excused') summary.excused += 1;
    else summary.pending += 1;
  });

  return summary;
}
