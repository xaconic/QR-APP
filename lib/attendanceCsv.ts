import type { AttendanceExportRecord } from './academic';
import { formatTimeOnly } from './formatters';

function getDateParts(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: values.year, month: values.month, day: values.day };
}

export function formatCsvDatePH(value: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = getDateParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

export function formatCsvTimestampPH(value: string | null) {
  const dateParts = getDateParts(value);
  const time = formatTimeOnly(value);
  if (!dateParts || !time) return '';
  return `${dateParts.year}-${dateParts.month}-${dateParts.day} ${time} +08:00`;
}

function escapeCsvField(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildAttendanceCsv(records: AttendanceExportRecord[]) {
  const rows: unknown[][] = [
    [
      'Student ID',
      'Student number',
      'Full name',
      'Email',
      'Role',
      'Event name',
      'Event date',
      'Attendance status',
      'Check-in time (Asia/Manila)',
      'Recorded at (Asia/Manila)',
    ],
    ...records.map((record) => [
      record.student_id,
      record.student_number,
      record.full_name,
      record.email,
      record.role,
      record.event_name,
      formatCsvDatePH(record.event_date),
      record.status,
      formatCsvTimestampPH(record.scanned_at),
      formatCsvTimestampPH(record.recorded_at),
    ]),
  ];

  return `\uFEFF${rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')}\r\n`;
}

export function buildAttendanceFilename(eventName: string, date: string) {
  const safeName = eventName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'event';
  return `attendance_${safeName}_${date}.csv`;
}
