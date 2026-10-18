import { supabase } from './supabase';
import { parseQRPayload } from './qr';
import { deduplicateStudentAttendanceRecords } from './studentAttendanceStats';
import { notifyAttendanceHistoryUpdated } from './attendanceHistoryEvents';

export type TeacherEventAttendance = {
  eventId: string;
  eventCode: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  status: 'open' | 'closed';
  attendeeCount: number;
  attendees: {
    studentId: string;
    scannedAt: string;
  }[];
};

export async function getTeacherEventAttendance(
  teacherId: string
): Promise<TeacherEventAttendance[]> {
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title, start_time, end_time, status, venue, description')
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (eventError || !events) return [];

  const eventIds = events.map((e: any) => e.id);
  if (eventIds.length === 0) return [];

  const { data: attendance, error: attError } = await supabase
    .from('attendance')
    .select('student_id, scanned_at, event_id, status')
    .in('event_id', eventIds)
    .order('scanned_at', { ascending: false });

  if (attError || !attendance) return [];

  return events.map((e: any) => {
    const rows = attendance.filter((a: any) => a.event_id === e.id);

    return {
      eventId: e.id,
      eventCode: e.event_code,
      title: e.title,
      startTime: e.start_time,
      endTime: e.end_time,
      status: e.status,
      attendeeCount: rows.filter((row: { status: string }) => row.status === 'present' || row.status === 'late').length,
      attendees: rows.map((a: any) => ({
        studentId: a.student_id,
        scannedAt: a.scanned_at,
      })),
    };
  });
}

export async function getTeacherEventAttendanceByCode(
  teacherId: string,
  eventCode: string
): Promise<TeacherEventAttendance | null> {
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title, start_time, end_time, status, venue, description')
    .eq('created_by', teacherId)
    .eq('event_code', eventCode)
    .order('created_at', { ascending: false });

  if (eventError || !events) return null;

  const event = events[0];
  if (!event) return null;

  const { data: attendance, error: attError } = await supabase
    .from('attendance')
    .select('student_id, scanned_at, event_id, status')
    .eq('event_id', event.id)
    .order('scanned_at', { ascending: false });

  if (attError || !attendance) return null;

  return {
    eventId: event.id,
    eventCode: event.event_code,
    title: event.title,
    startTime: event.start_time,
    endTime: event.end_time,
    status: event.status,
    attendeeCount: attendance.filter((row: { status: string }) => row.status === 'present' || row.status === 'late').length,
    attendees: attendance.map((a: any) => ({
      studentId: a.student_id,
      scannedAt: a.scanned_at,
    })),
  };
}

export type TeacherEventSummary = {
  eventId: string;
  eventCode: string;
  title: string;
  status: 'open' | 'closed';
  eventStatus: string;
  endTime: string | null;
};

export async function getTeacherEventSummary(
  teacherId: string
): Promise<{ data: TeacherEventSummary[] | null; error: string | null }> {
  const [ownedResult, assignmentsResult] = await Promise.all([
    supabase.from('events').select('id').eq('created_by', teacherId).is('archived_at', null),
    supabase.from('event_staff').select('event_id').eq('teacher_id', teacherId),
  ]);
  const queryError = ownedResult.error ?? assignmentsResult.error;
  if (queryError) {
    console.error('Unable to load events managed by this teacher.', queryError);
    return { data: null, error: 'Managed events could not be loaded. Please try again.' };
  }
  const eventIds = Array.from(new Set([
    ...(ownedResult.data ?? []).map((event: { id: string }) => event.id),
    ...(assignmentsResult.data ?? []).map((event: { event_id: string }) => event.event_id),
  ]));
  if (eventIds.length === 0) return { data: [], error: null };

  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title, status, event_status, end_time')
    .in('id', eventIds)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (eventError || !events) {
    console.error('Unable to load managed event details.', eventError);
    return { data: null, error: 'Managed events could not be loaded. Please try again.' };
  }

  return {
    data: events.map((event) => ({
      eventId: event.id,
      eventCode: event.event_code,
      title: event.title,
      status: event.status,
      eventStatus: event.event_status,
      endTime: event.end_time,
    })),
    error: null,
  };
}

export type AttendanceRecord = {
  id: string;
  displayId: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  eventUuid: string | null;
  attendanceFinalized: boolean;
  eventId: string;
  eventTitle: string;
  eventStartTime: string | null;
  creatorName: string | null;
  venue: string | null;
  description: string | null;
  scannedAt: string;
  recordedAt: string | null;
};

export type AttendanceHistoryResult = {
  data: AttendanceRecord[] | null;
  error: string | null;
};

export type RegisterResult = {
  success: boolean;
  message: string;
  eventTitle?: string;
  status?: 'present' | 'late';
};

export async function getRotatingCheckinToken(eventId: string): Promise<{
  token: string | null;
  expiresAt: string | null;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.rpc('issue_event_checkin_token', {
      p_event_id: eventId,
    });
    if (error) {
      console.error('Unable to issue a rotating event check-in token.', error);
      return { token: null, expiresAt: null, error: 'Live QR unavailable. Check your connection or event status.' };
    }
    if (!data || typeof data !== 'object'
      || typeof data.token !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.token)
      || typeof data.expires_at !== 'string'
      || Number.isNaN(Date.parse(data.expires_at))) {
      console.error('Rotating event check-in token response was invalid.', data);
      return { token: null, expiresAt: null, error: 'Live QR unavailable. Please try again.' };
    }
    return { token: data.token, expiresAt: data.expires_at, error: null };
  } catch (error: unknown) {
    console.error('Request for a rotating event check-in token failed.', error);
    return { token: null, expiresAt: null, error: 'Live QR unavailable. Check your connection and try again.' };
  }
}

export async function registerAttendance(
  rawPayload: string,
  _studentId?: string
): Promise<RegisterResult> {
  const parsed = parseQRPayload(rawPayload);

  if (!parsed.ok) {
    return { success: false, message: parsed.message };
  }

  const payload = parsed.payload;

  const { data, error: attError } = await supabase.rpc('register_attendance', {
    p_event_code: payload.event,
    p_token: payload.token,
  });

  if (attError) {
    const message = attError.message.toLowerCase();
    if (message.includes('already registered')) {
      notifyAttendanceHistoryUpdated();
      return {
        success: false,
        message: 'Already checked in for this event.',
      };
    }

    if (message.includes('event is closed')) {
      return { success: false, message: 'This event is closed.' };
    }
    if (message.includes('check-in code is invalid or expired')) {
      return { success: false, message: 'This QR code expired. Ask event staff to display the live code and scan again.' };
    }
    if (message.includes('event has not started')) {
      return { success: false, message: 'This event has not started yet.' };
    }
    if (message.includes('event has already ended')) {
      return { success: false, message: 'This event has already ended.' };
    }
    if (message.includes('not found') || message.includes('unknown event')) {
      return { success: false, message: 'Event not found.' };
    }
    if (message.includes('not eligible')) {
      return { success: false, message: 'Only eligible students can register attendance.' };
    }

    console.error('Attendance registration was rejected by the server.', attError);
    return { success: false, message: 'Attendance could not be recorded. Please try again.' };
  }

  if (!data || typeof data !== 'object'
    || (data.status !== 'present' && data.status !== 'late')) {
    console.error('Attendance registration returned an invalid response.', data);
    return { success: false, message: 'Attendance could not be confirmed. Please check your history before retrying.' };
  }

  const attendanceStatus = data.status;
  notifyAttendanceHistoryUpdated();
  return {
    success: true,
    message: attendanceStatus === 'late' ? 'Attendance recorded as late.' : 'Attendance recorded!',
    eventTitle: typeof data.event_title === 'string' ? data.event_title : undefined,
    status: attendanceStatus,
  };
}

export async function getAttendanceHistory(
  studentId: string,
  accessToken?: string,
): Promise<AttendanceHistoryResult> {
  const historyRequest = supabase.rpc('get_student_attendance_history');
  if (accessToken) historyRequest.setHeader('Authorization', `Bearer ${accessToken}`);
  const historyRpc = await historyRequest;
  if (!historyRpc.error && historyRpc.data) {
    const records: AttendanceRecord[] = (historyRpc.data as any[]).map((row) => ({
      id: row.attendance_id,
      displayId: row.attendance_display_id,
      status: row.status ?? 'present',
      eventUuid: row.event_id ?? null,
      attendanceFinalized: row.attendance_finalized ?? row.status === 'absent',
      eventId: row.event_code ?? '',
      eventTitle: row.event_title ?? '',
      eventStartTime: row.event_start_time ?? null,
      creatorName: row.creator_name ?? row.creator_display_id ?? null,
      venue: row.venue ?? null,
      description: row.description ?? null,
      scannedAt: row.status === 'absent' ? row.recorded_at : row.scanned_at,
      recordedAt: row.recorded_at ?? null,
    }));
    return {
      data: normalizeStudentHistory(records),
      error: null,
    };
  }

  const historyQuery = supabase
    .from('attendance')
    .select('id, display_id, status, scanned_at, recorded_at, events ( id, event_code, title, start_time, event_status, venue, description )')
    .eq('student_id', studentId)
    .order('scanned_at', { ascending: false });
  if (accessToken) historyQuery.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data, error } = await historyQuery;

  let historyRows = data;
  let historyError = error;
  if (error && (error.code === '42703' || error.code === 'PGRST200' || error.code === 'PGRST204')) {
    const fallbackQuery = supabase
      .from('attendance')
      .select('id, display_id, status, scanned_at, recorded_at, events ( id, event_code, title, start_time, event_status )')
      .eq('student_id', studentId)
      .order('scanned_at', { ascending: false });
    if (accessToken) fallbackQuery.setHeader('Authorization', `Bearer ${accessToken}`);
    const fallback = await fallbackQuery;
    historyRows = fallback.data as typeof historyRows;
    historyError = fallback.error;
  }

  if (historyError || !historyRows) {
    console.error('Unable to load attendance history.', historyError);
    return { data: null, error: 'Attendance history could not be loaded. Check your connection and try again.' };
  }

  return {
    data: normalizeStudentHistory(historyRows.map((row: any) => ({
      id: row.id,
      displayId: row.display_id,
      status: row.status ?? 'present',
      eventUuid: row.events?.id ?? null,
      attendanceFinalized: row.events?.event_status === 'completed' || row.status === 'absent',
      eventId: row.events?.event_code ?? '',
      eventTitle: row.events?.title ?? '',
      eventStartTime: row.events?.start_time ?? null,
      creatorName: null,
      venue: row.events?.venue ?? null,
      description: row.events?.description ?? null,
      scannedAt: row.status === 'absent' ? row.recorded_at : row.scanned_at,
      recordedAt: row.recorded_at ?? null,
    }))),
    error: null,
  };
}

function normalizeStudentHistory(records: AttendanceRecord[]): AttendanceRecord[] {
  const unique = deduplicateStudentAttendanceRecords(records.map((record) => ({
    ...record,
    eventKey: record.eventUuid || record.eventId || record.id,
    occurredAt: record.recordedAt ?? record.scannedAt,
  })));
  return unique
    .sort((left, right) => Date.parse(right.eventStartTime ?? right.scannedAt) - Date.parse(left.eventStartTime ?? left.scannedAt))
    .map(({ eventKey: _eventKey, occurredAt: _occurredAt, ...record }) => record);
}
