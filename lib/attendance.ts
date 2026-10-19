import { getFreshAccessToken, supabase } from './supabase';
import { parseQRPayload } from './qr';
import { deduplicateStudentAttendanceRecords } from './studentAttendanceStats';
import { notifyAttendanceHistoryUpdated } from './attendanceHistoryEvents';
import { getTeacherAuthorizedEvents } from './academic';
import type { Session } from '@supabase/supabase-js';

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
  const eventResult = await getTeacherAuthorizedEvents(teacherId);
  if (eventResult.error) throw new Error(eventResult.error);
  const events = eventResult.data ?? [];
  const eventIds = events.map((event) => event.id);
  if (eventIds.length === 0) return [];

  const { data: attendance, error: attError } = await supabase
    .from('attendance')
    .select('student_id, scanned_at, event_id, status')
    .in('event_id', eventIds)
    .order('scanned_at', { ascending: false });

  if (attError) throw new Error(`Unable to load attendance for managed events: ${attError.message}`);
  if (!attendance) throw new Error('Attendance records were not returned for managed events.');

  return events.map((event) => {
    const rows = attendance.filter((row) => row.event_id === event.id);

    return {
      eventId: event.id,
      eventCode: event.event_code,
      title: event.title,
      startTime: event.start_time,
      endTime: event.end_time,
      status: event.status,
      attendeeCount: rows.filter((row: { status: string }) => row.status === 'present' || row.status === 'late').length,
      attendees: rows.map((row) => ({
        studentId: row.student_id,
        scannedAt: row.scanned_at,
      })),
    };
  });
}

export async function getTeacherEventAttendanceByCode(
  teacherId: string,
  eventCode: string
): Promise<TeacherEventAttendance | null> {
  const eventResult = await getTeacherAuthorizedEvents(teacherId);
  if (eventResult.error) throw new Error(eventResult.error);
  const event = eventResult.data?.find((item) => item.event_code === eventCode);
  if (!event) return null;

  const { data: attendance, error: attError } = await supabase
    .from('attendance')
    .select('student_id, scanned_at, event_id, status')
    .eq('event_id', event.id)
    .order('scanned_at', { ascending: false });

  if (attError) throw new Error(`Unable to load attendance for ${eventCode}: ${attError.message}`);
  if (!attendance) throw new Error(`Attendance records were not returned for ${eventCode}.`);

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
  startTime?: string | null;
  createdAt?: string;
};

export async function getTeacherEventSummary(
  teacherId: string,
  fallbackSession?: Session | null,
): Promise<{ data: TeacherEventSummary[] | null; error: string | null }> {
  const result = await getTeacherAuthorizedEvents(teacherId, fallbackSession);
  if (result.error) {
    console.error('Unable to load events managed by this teacher.', result.error);
    return { data: null, error: 'Managed events could not be loaded. Please try again.' };
  }

  return {
    data: (result.data ?? []).map((event) => ({
      eventId: event.id,
      eventCode: event.event_code,
      title: event.title,
      status: event.status,
      eventStatus: event.event_status ?? 'upcoming',
      endTime: event.end_time,
      startTime: event.start_time,
      createdAt: event.created_at,
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
  lateTime: string | null;
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

export async function getRotatingCheckinToken(
  eventId: string,
  fallbackSession?: Session | null,
): Promise<{
  token: string | null;
  expiresAt: string | null;
  error: string | null;
}> {
  try {
    const accessToken = await getFreshAccessToken(fallbackSession);
    const request = supabase.rpc('issue_event_checkin_token', {
      p_event_id: eventId,
    });
    request.setHeader('Authorization', `Bearer ${accessToken}`);
    const { data, error } = await request;
    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes('not authorized for this event')) {
        console.warn('The signed-in account is not authorized to issue a check-in token for this event.');
        return {
          token: null,
          expiresAt: null,
          error: "This account cannot display this event's live QR. Sign in as the event creator or ask an administrator to manage it.",
        };
      }
      console.warn('Unable to issue a rotating event check-in token.', error);
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
    console.warn('Request for a rotating event check-in token failed.', error);
    return { token: null, expiresAt: null, error: 'Live QR unavailable. Check your connection and try again.' };
  }
}

export async function registerAttendance(
  rawPayload: string
): Promise<RegisterResult> {
  const parsed = parseQRPayload(rawPayload);

  if (!parsed.ok) {
    return { success: false, message: parsed.message };
  }

  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken();
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Your session has expired. Please sign in again.',
    };
  }

  const payload = parsed.payload;

  const attendanceRequest = supabase.rpc('register_attendance', {
    p_event_code: payload.event,
    p_token: payload.token,
  });
  attendanceRequest.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data, error: attError } = await attendanceRequest;

  if (attError) {
    const message = attError.message.toLowerCase();
    if (message.includes('not authenticated')) {
      return { success: false, message: 'Your session has expired. Please sign in again.' };
    }
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
): Promise<AttendanceHistoryResult> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken();
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Your session has expired. Please sign in again.',
    };
  }

  const historyRequest = supabase.rpc('get_student_attendance_history');
  historyRequest.setHeader('Authorization', `Bearer ${accessToken}`);
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
      lateTime: row.late_time ?? null,
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
    .select('id, display_id, status, scanned_at, recorded_at, events ( id, event_code, title, start_time, late_time, event_status, venue, description )')
    .eq('student_id', studentId)
    .order('scanned_at', { ascending: false });
  historyQuery.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data, error } = await historyQuery;

  let historyRows = data;
  let historyError = error;
  if (error && (error.code === '42703' || error.code === 'PGRST200' || error.code === 'PGRST204')) {
    const fallbackQuery = supabase
      .from('attendance')
      .select('id, display_id, status, scanned_at, recorded_at, events ( id, event_code, title, start_time, late_time, event_status )')
      .eq('student_id', studentId)
      .order('scanned_at', { ascending: false });
    fallbackQuery.setHeader('Authorization', `Bearer ${accessToken}`);
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
      lateTime: row.events?.late_time ?? null,
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
