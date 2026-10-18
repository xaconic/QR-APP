export type StudentAttendanceStatus = 'present' | 'late' | 'absent' | 'excused';

export type StudentAttendanceStatRecord = {
  eventKey: string;
  status: StudentAttendanceStatus;
  occurredAt: string | null;
  eventDate?: string | null;
  attendanceFinalized?: boolean;
};

export type StudentAttendanceStats = {
  totalEvents: number;
  eligibleEvents: number;
  present: number;
  late: number;
  attended: number;
  absent: number;
  excused: number;
  attendanceRate: number | null;
  currentMonthEligible: number;
  currentMonthAttended: number;
  currentMonthRate: number | null;
  currentStreak: number;
  currentStreakType: 'attended' | 'absent' | null;
};

export function deduplicateStudentAttendanceRecords<T extends StudentAttendanceStatRecord>(
  records: T[],
): T[] {
  const latestByEvent = new Map<string, T>();
  records.forEach((record, index) => {
    const key = record.eventKey || `__missing_event_${index}`;
    const current = latestByEvent.get(key);
    if (!current || timestamp(record.occurredAt) > timestamp(current.occurredAt)) {
      latestByEvent.set(key, record);
    }
  });
  return Array.from(latestByEvent.values());
}

export function calculateStudentAttendanceStats(
  records: StudentAttendanceStatRecord[],
  now = new Date(),
): StudentAttendanceStats {
  const uniqueRecords = deduplicateStudentAttendanceRecords(records.filter(
    (record) => record.status === 'present'
      || record.status === 'late'
      || record.attendanceFinalized !== false,
  ));
  const summary = {
    totalEvents: uniqueRecords.length,
    eligibleEvents: 0,
    present: 0,
    late: 0,
    attended: 0,
    absent: 0,
    excused: 0,
    attendanceRate: null as number | null,
    currentMonthEligible: 0,
    currentMonthAttended: 0,
    currentMonthRate: null as number | null,
    currentStreak: 0,
    currentStreakType: null as 'attended' | 'absent' | null,
  };
  const currentMonth = manilaMonth(now);

  for (const record of uniqueRecords) {
    if (record.status === 'present') summary.present += 1;
    else if (record.status === 'late') summary.late += 1;
    else if (record.status === 'absent') summary.absent += 1;
    else if (record.status === 'excused') summary.excused += 1;

    if (record.status !== 'excused') summary.eligibleEvents += 1;
    if (record.status === 'present' || record.status === 'late') summary.attended += 1;

    const eventDate = record.eventDate ?? record.occurredAt;
    if (eventDate && manilaMonth(new Date(eventDate)) === currentMonth && record.status !== 'excused') {
      summary.currentMonthEligible += 1;
      if (record.status === 'present' || record.status === 'late') summary.currentMonthAttended += 1;
    }
  }

  if (summary.eligibleEvents > 0) {
    summary.attendanceRate = Math.round((summary.attended / summary.eligibleEvents) * 100);
  }
  if (summary.currentMonthEligible > 0) {
    summary.currentMonthRate = Math.round((summary.currentMonthAttended / summary.currentMonthEligible) * 100);
  }

  const chronologicalRecords = [...uniqueRecords].sort(
    (left, right) => timestamp(right.eventDate ?? right.occurredAt) - timestamp(left.eventDate ?? left.occurredAt),
  );
  const latestOutcome = chronologicalRecords[0]?.status;
  if (latestOutcome === 'present' || latestOutcome === 'late') summary.currentStreakType = 'attended';
  else if (latestOutcome === 'absent') summary.currentStreakType = 'absent';
  if (summary.currentStreakType) {
    for (const record of chronologicalRecords) {
      const attended = record.status === 'present' || record.status === 'late';
      const matches = summary.currentStreakType === 'attended' ? attended : record.status === 'absent';
      if (!matches) break;
      summary.currentStreak += 1;
    }
  }

  return summary;
}

export function isInCurrentManilaMonth(value: string | null | undefined, now = new Date()) {
  if (!value) return false;
  return manilaMonth(new Date(value)) === manilaMonth(now);
}

function timestamp(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function manilaMonth(date: Date) {
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}
