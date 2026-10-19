import { getFreshAccessToken, supabase } from './supabase';
import type { Session } from '@supabase/supabase-js';
import { normalizeEventAttendanceSummary, type EventAttendanceStudent, type EventAttendanceSummary } from './attendanceSummary';
import type { CloudEvent } from './events';

export { normalizeEventAttendanceSummary } from './attendanceSummary';
export type { EventAttendanceStudent, EventAttendanceSummary } from './attendanceSummary';

export type Course = { id: string; code: string; name: string; is_active: boolean; academic_level_id: string | null; is_preliminary?: boolean };
export type AcademicLevel = { id: string; code: string; name: string; sort_order: number; is_active: boolean };
export type YearLevel = { id: string; name: string; sort_order: number; is_active: boolean };
export type AcademicSection = {
  id: string;
  course_id: string;
  year_level_id: string;
  section_code: string;
  section_name: string;
  academic_year: string;
  is_active: boolean;
  year_level_name?: string;
};

export function formatCourseLabel(course: { name: string; code: string }) {
  const escapedCode = course.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = course.name.replace(new RegExp(`\\s*\\(${escapedCode}\\)\\s*$`, 'i'), '').trim();
  return `${name} (${course.code})`;
}

export type AttendanceCorrection = {
  id: string;
  studentId: string;
  previousStatus: 'present' | 'absent' | 'late' | 'excused' | null;
  newStatus: 'present' | 'absent' | 'late' | 'excused' | null;
  actorId: string | null;
  createdAt: string;
};

export async function getEventAttendanceCorrections(
  eventId: string,
  fallbackSession?: Session | null,
): Promise<{ data: AttendanceCorrection[] | null; error: string | null }> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(fallbackSession);
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Your session could not be refreshed.' };
  }
  const request = supabase.rpc('get_event_attendance_corrections', {
    p_event_id: eventId,
  });
  request.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data, error } = await request;
  if (error) return { data: null, error: 'Correction history could not be loaded.' };
  if (!Array.isArray(data)) return { data: null, error: 'Correction history returned an invalid response.' };

  return {
    data: data.map((row: {
      id: string;
      student_id: string;
      previous_status: AttendanceCorrection['previousStatus'];
      new_status: AttendanceCorrection['newStatus'];
      actor_id: string | null;
      created_at: string;
    }) => ({
      id: row.id,
      studentId: row.student_id,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      actorId: row.actor_id,
      createdAt: row.created_at,
    })),
    error: null,
  };
}

export type AttendanceExportRecord = {
  attendance_id: string;
  student_id: string;
  student_number: string | null;
  full_name: string | null;
  email: string | null;
  role: string | null;
  event_name: string;
  event_date: string | null;
  status: 'present' | 'absent' | 'late' | 'excused';
  scanned_at: string | null;
  recorded_at: string;
};

export type AttendanceExportPage = {
  totalCount: number;
  records: AttendanceExportRecord[];
};

export async function getEventAttendanceExportPage(
  eventId: string,
  filters: {
    courseId?: string;
    yearLevelId?: string;
    sectionId?: string;
    status?: string;
    search?: string;
  },
  offset: number,
  limit: number,
  fallbackSession?: Session | null,
): Promise<{ data: AttendanceExportPage | null; error: string | null }> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(fallbackSession);
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Your session could not be refreshed.' };
  }
  const request = supabase.rpc('get_event_attendance_export', {
    p_event_id: eventId,
    p_offset: offset,
    p_limit: limit,
    p_course_id: filters.courseId || null,
    p_year_level_id: filters.yearLevelId || null,
    p_section_id: filters.sectionId || null,
    p_status: filters.status || null,
    p_from_date: null,
    p_to_date: null,
    p_search: filters.search?.trim() || null,
  });
  request.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data, error } = await request;

  if (error) return { data: null, error: error.message };
  if (!data || typeof data !== 'object') {
    return { data: null, error: 'The attendance export returned an invalid response.' };
  }

  const result = data as { total_count?: unknown; records?: unknown };
  if (typeof result.total_count !== 'number' || !Number.isInteger(result.total_count)
    || !Array.isArray(result.records)) {
    return { data: null, error: 'The attendance export returned an invalid response.' };
  }

  return {
    data: {
      totalCount: result.total_count,
      records: result.records as AttendanceExportRecord[],
    },
    error: null,
  };
}

export async function getAcademicLevels(): Promise<AcademicLevel[]> {
  const { data } = await supabase.from('academic_levels').select('id, code, name, sort_order, is_active').eq('is_active', true).order('sort_order');
  return (data ?? []) as AcademicLevel[];
}

export async function getCourses(academicLevelId?: string): Promise<Course[]> {
  let query = supabase.from('courses').select('id, code, name, is_active, academic_level_id, is_preliminary').eq('is_active', true).order('name');
  if (academicLevelId) query = query.eq('academic_level_id', academicLevelId);
  const { data } = await query;
  return (data ?? []) as Course[];
}

export async function getYearLevels(): Promise<YearLevel[]> {
  const { data } = await supabase.from('year_levels').select('id, name, sort_order, is_active').eq('is_active', true).order('sort_order').order('name');
  return (data ?? []) as YearLevel[];
}

export async function getAcademicSections(courseId?: string, yearLevelId?: string): Promise<AcademicSection[]> {
  let query = supabase
    .from('academic_sections')
    .select('id, course_id, year_level_id, section_code, section_name, academic_year, is_active, year_levels(name)')
    .eq('is_active', true)
    .order('section_name');
  if (courseId) query = query.eq('course_id', courseId);
  if (yearLevelId) query = query.eq('year_level_id', yearLevelId);
  const { data } = await query;
  return (data ?? []).map((row: any) => ({ ...row, year_level_name: row.year_levels?.name })) as AcademicSection[];
}

export async function getYearLevelsForCourse(courseId: string): Promise<YearLevel[]> {
  const { data } = await supabase.from('course_year_levels').select('year_levels(id, name, sort_order, is_active)').eq('course_id', courseId);
  return (data ?? []).map((row: any) => row.year_levels).filter(Boolean) as YearLevel[];
}

export async function getAcademicGroupNames(profile: { academic_level_id?: string | null; course_id: string | null; year_level_id: string | null; section_id: string | null }) {
  const [level, course, year, section] = await Promise.all([
    profile.academic_level_id ? supabase.from('academic_levels').select('code, name').eq('id', profile.academic_level_id).maybeSingle() : Promise.resolve({ data: null }),
    profile.course_id ? supabase.from('courses').select('code, name').eq('id', profile.course_id).maybeSingle() : Promise.resolve({ data: null }),
    profile.year_level_id ? supabase.from('year_levels').select('name').eq('id', profile.year_level_id).maybeSingle() : Promise.resolve({ data: null }),
    profile.section_id ? supabase.from('academic_sections').select('section_code, section_name, academic_year').eq('id', profile.section_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return { academicLevel: level.data, course: course.data, yearLevel: year.data, section: section.data };
}

export async function getEventAttendanceSummary(
  eventId: string,
  filters: {
    courseId?: string;
    yearLevelId?: string;
    sectionId?: string;
    status?: string;
    attendanceFinalized?: boolean;
  } = {},
  fallbackSession?: Session | null,
): Promise<{ data: EventAttendanceSummary | null; error: string | null }> {
  const { attendanceFinalized = false, ...rpcFilters } = filters;
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(fallbackSession);
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Your session could not be refreshed.',
    };
  }

  const request = supabase.rpc('get_event_attendance_summary', {
    p_event_id: eventId,
    p_course_id: rpcFilters.courseId || null,
    p_year_level_id: rpcFilters.yearLevelId || null,
    p_section_id: rpcFilters.sectionId || null,
    p_status: rpcFilters.status || null,
  });
  request.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data, error } = await request;
  if (error) return { data: null, error: error.message };
  const summary = normalizeEventAttendanceSummary(data, attendanceFinalized);
  if (!summary) return { data: null, error: 'The attendance summary returned an invalid response.' };
  return { data: summary, error: null };
}

export async function recordEventAttendance(eventId: string, studentId: string, status: NonNullable<EventAttendanceStudent['status']>) {
  try {
    const accessToken = await getFreshAccessToken();
    const request = supabase.rpc('record_event_attendance', { p_event_id: eventId, p_student_id: studentId, p_status: status });
    request.setHeader('Authorization', `Bearer ${accessToken}`);
    const { error } = await request;
    return { error: error?.message ?? null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Attendance could not be updated.' };
  }
}

export async function clearEventAttendance(eventId: string, studentId: string) {
  try {
    const accessToken = await getFreshAccessToken();
    const request = supabase.rpc('clear_event_attendance', { p_event_id: eventId, p_student_id: studentId });
    request.setHeader('Authorization', `Bearer ${accessToken}`);
    const { error } = await request;
    return { error: error?.message ?? null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Attendance could not be cleared.' };
  }
}

export async function getTeacherAuthorizedEvents(
  teacherId: string,
  fallbackSession?: Session | null,
): Promise<{ data: CloudEvent[] | null; error: string | null }> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(fallbackSession);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Your session could not be refreshed.';
    return { data: null, error: message };
  }
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || authData.user?.id !== teacherId) {
    return { data: null, error: 'The signed-in account changed. Please sign in again and reload your events.' };
  }

  const ownedRequest = supabase
    .from('events')
    .select('*')
    .eq('created_by', teacherId)
    .is('archived_at', null);
  const assignmentsRequest = supabase
    .from('event_staff')
    .select('event_id')
    .eq('teacher_id', teacherId)
    .eq('can_manage', true);
  ownedRequest.setHeader('Authorization', `Bearer ${accessToken}`);
  assignmentsRequest.setHeader('Authorization', `Bearer ${accessToken}`);

  const [ownedResult, assignmentsResult] = await Promise.all([
    ownedRequest,
    assignmentsRequest,
  ]);
  const queryError = ownedResult.error ?? assignmentsResult.error;
  if (queryError) return { data: null, error: queryError.message };

  const owned = (ownedResult.data ?? []) as CloudEvent[];
  const ownedIds = new Set(owned.map((event) => event.id));
  const assignedIds = Array.from(new Set(
    (assignmentsResult.data ?? [])
      .map((assignment) => assignment.event_id)
      .filter((eventId) => !ownedIds.has(eventId)),
  ));

  if (assignedIds.length === 0) {
    return {
      data: owned.sort((left, right) =>
        new Date(right.start_time ?? right.created_at).getTime()
        - new Date(left.start_time ?? left.created_at).getTime()),
      error: null,
    };
  }

  const assignedRequest = supabase
    .from('events')
    .select('*')
    .in('id', assignedIds)
    .is('archived_at', null);
  assignedRequest.setHeader('Authorization', `Bearer ${accessToken}`);
  const assignedResult = await assignedRequest;
  if (assignedResult.error) return { data: null, error: assignedResult.error.message };

  return {
    data: [...owned, ...((assignedResult.data ?? []) as CloudEvent[])]
      .sort((left, right) =>
        new Date(right.start_time ?? right.created_at).getTime()
        - new Date(left.start_time ?? left.created_at).getTime()),
    error: null,
  };
}

export type EventAudienceScope = {
  courseIds: string[];
  yearLevelIds: string[];
  sectionIds: string[];
};
export type EventAudienceMode = 'all' | 'groups' | 'legacy';
export type EventAudienceGroup = {
  courseId: string;
  yearLevelId: string;
  sectionId: string;
};
export type EventAudienceConfig = {
  mode: EventAudienceMode;
  scope: EventAudienceScope;
  groups: EventAudienceGroup[];
};

const emptyAudienceScope = (): EventAudienceScope => ({ courseIds: [], yearLevelIds: [], sectionIds: [] });

function sameIdSet(left: string[], right: string[]) {
  const a = Array.from(new Set(left)).sort();
  const b = Array.from(new Set(right)).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function updateEventAudience(
  eventId: string,
  mode: 'all' | 'groups',
  scope: EventAudienceScope,
  fallbackSession?: Session | null,
): Promise<{ error: string | null }> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(fallbackSession);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your session could not be refreshed.' };
  }
  const request = supabase.rpc('update_event_audience', {
    p_event_id: eventId,
    p_audience_mode: mode,
    p_course_ids: scope.courseIds,
    p_year_level_ids: scope.yearLevelIds,
    p_section_ids: scope.sectionIds,
  });
  request.setHeader('Authorization', `Bearer ${accessToken}`);
  const { error } = await request;
  if (error) return { error: error.message };
  const saved = await getEventAudienceConfig(eventId, fallbackSession);
  if (saved.mode !== mode) return { error: 'Participant configuration could not be verified after saving.' };
  if (mode === 'groups' && (!saved.groups.length
    || !sameIdSet(saved.scope.courseIds, scope.courseIds)
    || !sameIdSet(saved.scope.yearLevelIds, scope.yearLevelIds)
    || !sameIdSet(saved.scope.sectionIds, scope.sectionIds))) {
    return { error: 'Participant groups could not be verified after saving.' };
  }
  return { error: null };
}

export async function getEventAudienceScope(eventId: string): Promise<EventAudienceScope | null> {
  const config = await getEventAudienceConfig(eventId);
  return config.mode === 'groups' ? config.scope : null;
}

export async function getEventAudienceConfig(
  eventId: string,
  fallbackSession?: Session | null,
): Promise<EventAudienceConfig> {
  const accessToken = await getFreshAccessToken(fallbackSession);

  const eventRequest = supabase
    .from('events')
    .select('audience_mode')
    .eq('id', eventId);
  eventRequest.setHeader('Authorization', `Bearer ${accessToken}`);
  const eventResult = await eventRequest.maybeSingle();
  if (eventResult.error) throw new Error(`Unable to load this event's eligibility settings: ${eventResult.error.message}`);
  if (!eventResult.data?.audience_mode) {
    throw new Error('This event has no saved eligibility settings. Refresh the event or contact an administrator.');
  }
  const mode = eventResult.data.audience_mode as EventAudienceMode;
  if (mode !== 'groups') return { mode, scope: emptyAudienceScope(), groups: [] };

  const scopeRequest = supabase.rpc('get_event_audience_scope', { p_event_id: eventId });
  scopeRequest.setHeader('Authorization', `Bearer ${accessToken}`);
  const scoped = await scopeRequest;
  let direct = scoped;
  if (scoped.error) {
    const request = supabase
      .from('event_audience')
      .select('course_id, year_level_id, section_id')
      .eq('event_id', eventId);
    request.setHeader('Authorization', `Bearer ${accessToken}`);
    direct = await request;
  }

  if (direct.error) throw new Error(`Unable to load this event's saved participant groups: ${direct.error.message}`);
  const { data } = direct;
  if (!data) throw new Error('The event participant groups could not be loaded.');
  if (data.length === 0) return { mode: 'legacy', scope: emptyAudienceScope(), groups: [] };

  const rows = data as { course_id: string | null; year_level_id: string | null; section_id: string | null }[];
  if (rows.some((row) => !row.course_id || !row.year_level_id || !row.section_id)) {
    throw new Error('This event has incomplete saved participant groups. Edit its eligibility settings before managing attendance.');
  }
  const groups = rows.map((row) => ({
    courseId: row.course_id!,
    yearLevelId: row.year_level_id!,
    sectionId: row.section_id!,
  }));
  return { mode: 'groups', groups, scope: {
    courseIds: Array.from(new Set(groups.map((group) => group.courseId))),
    yearLevelIds: Array.from(new Set(groups.map((group) => group.yearLevelId))),
    sectionIds: Array.from(new Set(groups.map((group) => group.sectionId))),
  } };
}

export async function createCourse(code: string, name: string, academicLevelId?: string) {
  if (!academicLevelId) return { error: 'Select an academic level first.' };
  const { error } = academicLevelId
    ? await supabase.rpc('admin_create_course', { p_code: code, p_name: name, p_academic_level_id: academicLevelId })
    : await supabase.rpc('admin_create_course', { p_code: code, p_name: name });
  return { error: error?.message ?? null };
}

export async function createAcademicLevel(code: string, name: string, sortOrder: number) {
  const { error } = await supabase.rpc('admin_create_academic_level', { p_code: code, p_name: name, p_sort_order: sortOrder });
  return { error: error?.message ?? null };
}

export async function setCourseYearLevels(courseId: string, yearLevelIds: string[]) {
  const { error } = await supabase.rpc('admin_set_course_year_levels', { p_course_id: courseId, p_year_level_ids: yearLevelIds });
  return { error: error?.message ?? null };
}

export async function createYearLevel(name: string, sortOrder: number) {
  const { error } = await supabase.rpc('admin_create_year_level', { p_name: name, p_sort_order: sortOrder });
  return { error: error?.message ?? null };
}

export async function createAcademicSection(input: { courseId: string; yearLevelId: string; code: string; name: string; academicYear: string }) {
  const { error } = await supabase.rpc('admin_create_section', {
    p_course_id: input.courseId,
    p_year_level_id: input.yearLevelId,
    p_section_code: input.code,
    p_section_name: input.name,
    p_academic_year: input.academicYear,
  });
  return { error: error?.message ?? null };
}

export async function assignStudent(studentId: string, courseId: string, yearLevelId: string, sectionId: string, academicYear: string) {
  const { error } = await supabase.rpc('admin_assign_student', { p_student_id: studentId, p_course_id: courseId, p_year_level_id: yearLevelId, p_section_id: sectionId, p_academic_year: academicYear });
  return { error: error?.message ?? null };
}

export async function archiveAcademicSection(sectionId: string) {
  const { error } = await supabase.rpc('admin_archive_section', { p_section_id: sectionId });
  return { error: error?.message ?? null };
}

export async function updateCourse(courseId: string, code: string, name: string) {
  const { error } = await supabase.rpc('admin_update_course', { p_course_id: courseId, p_code: code, p_name: name });
  return { error: error?.message ?? null };
}

export async function archiveCourse(courseId: string) {
  const { error } = await supabase.rpc('admin_archive_course', { p_course_id: courseId });
  return { error: error?.message ?? null };
}

export async function assignEventStaff(eventId: string, teacherId: string) {
  const { error } = await supabase.rpc('admin_assign_event_staff', { p_event_id: eventId, p_teacher_id: teacherId });
  return { error: error?.message ?? null };
}
