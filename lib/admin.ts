import { getFreshAccessToken, supabase } from './supabase';
import type { Session } from '@supabase/supabase-js';
import { normalizeEventAttendanceSummary } from './attendanceSummary';

export type AdminUser = {
  id: string;
  display_id: string;
  email: string;
  full_name: string | null;
  role: 'student' | 'teacher' | 'admin';
  created_at: string;
  is_active: boolean;
  deactivated_at: string | null;
  teacher_requested_at: string | null;
  course_id: string | null;
  academic_level_id: string | null;
  year_level_id: string | null;
  section_id: string | null;
  course_code: string | null;
  course_name: string | null;
  year_level_name: string | null;
  section_name: string | null;
  section_code: string | null;
};

export type AdminEvent = {
  id: string;
  event_code: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  created_by: string | null;
  created_at: string;
  status: 'open' | 'closed';
  event_status?: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  venue: string | null;
  description: string | null;
  archived_at: string | null;
  audience_mode: 'all' | 'groups' | 'legacy';
};

export type AdminAttendanceSummary = {
  eventId: string;
  eventTitle: string;
  totalStudents: number;
  attendeeCount: number;
  lateCount: number;
  absentCount: number;
};

export type AdminCourse = {
  id: string;
  code: string;
  name: string;
  academic_level_id: string | null;
};

export type AdminYearLevel = {
  id: string;
  name: string;
};

export type AdminSection = {
  id: string;
  course_id: string;
  year_level_id: string;
  section_code: string;
  section_name: string;
  academic_year: string;
};

export type AdminDashboardData = {
  users: AdminUser[];
  events: AdminEvent[];
  attendance: AdminAttendanceSummary[];
  courses: AdminCourse[];
  yearLevels: AdminYearLevel[];
  sections: AdminSection[];
};

export async function getAdminDashboardData(fallbackSession?: Session | null): Promise<{
  data: AdminDashboardData | null;
  error: string | null;
}> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(fallbackSession);
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Your session could not be refreshed.',
    };
  }
  const authorizationRequest = supabase.rpc('is_admin');
  authorizationRequest.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data: isAdmin, error: authorizationError } = await authorizationRequest;
  if (authorizationError) return { data: null, error: `Administrator access could not be verified: ${authorizationError.message}` };
  if (isAdmin !== true) return { data: null, error: 'This signed-in account is not an active administrator in Supabase.' };

  const usersRequest = supabase
    .from('profiles')
    .select('id, display_id, email, full_name, role, created_at, is_active, deactivated_at, teacher_requested_at, academic_level_id, course_id, year_level_id, section_id')
    .order('created_at', { ascending: false });
  const eventsRequest = supabase
    .from('events')
    .select('id, event_code, title, start_time, end_time, created_by, created_at, status, event_status, venue, description, archived_at, audience_mode')
    .order('created_at', { ascending: false });
  const coursesRequest = supabase.from('courses').select('id, code, name, academic_level_id').eq('is_active', true);
  const yearsRequest = supabase.from('year_levels').select('id, name, sort_order').eq('is_active', true);
  const sectionsRequest = supabase.from('academic_sections').select('id, course_id, year_level_id, section_name, section_code, academic_year').eq('is_active', true);
  for (const request of [usersRequest, eventsRequest, coursesRequest, yearsRequest, sectionsRequest]) {
    request.setHeader('Authorization', `Bearer ${accessToken}`);
  }

  const [usersResult, eventsResult, coursesResult, yearsResult, sectionsResult] = await Promise.all([
    usersRequest,
    eventsRequest,
    coursesRequest,
    yearsRequest,
    sectionsRequest,
  ]);

  const error = usersResult.error ?? eventsResult.error ?? coursesResult.error ?? yearsResult.error ?? sectionsResult.error;
  if (error) return { data: null, error: error.message };

  const courses = new Map(
    (coursesResult.data ?? []).map((course) => [course.id, course]),
  );
  const years = new Map(
    (yearsResult.data ?? []).map((year) => [year.id, year]),
  );
  const sections = new Map(
    (sectionsResult.data ?? []).map((section) => [section.id, section]),
  );
  const users = ((usersResult.data ?? []) as Omit<AdminUser, 'course_code' | 'course_name' | 'year_level_name' | 'section_name' | 'section_code'>[])
    .map((profile): AdminUser => {
      const course = profile.course_id ? courses.get(profile.course_id) : undefined;
      const year = profile.year_level_id ? years.get(profile.year_level_id) : undefined;
      const section = profile.section_id ? sections.get(profile.section_id) : undefined;
      return {
        ...profile,
        course_code: course?.code ?? null,
        course_name: course?.name ?? null,
        year_level_name: year?.name ?? null,
        section_name: section?.section_name ?? null,
        section_code: section?.section_code ?? null,
      };
    });

  await Promise.all(
    ((eventsResult.data ?? []) as { id: string; end_time?: string | null }[])
      .filter((event) => event.end_time && new Date(event.end_time).getTime() <= Date.now())
      .map((event) => {
        const request = supabase.rpc('finalize_event_attendance', { p_event_id: event.id });
        request.setHeader('Authorization', `Bearer ${accessToken}`);
        return request;
      })
  );

  const attendanceResults = await Promise.all(
    (eventsResult.data ?? []).map(async (event) => {
      const request = supabase.rpc('get_event_attendance_summary', {
        p_event_id: event.id,
        p_course_id: null,
        p_year_level_id: null,
        p_section_id: null,
        p_status: null,
      });
      request.setHeader('Authorization', `Bearer ${accessToken}`);
      const { data, error } = await request;
      if (error) return { event, summary: null, error: error.message };

      const summary = normalizeEventAttendanceSummary(data);
      if (!summary) return { event, summary: null, error: 'The attendance summary returned an invalid response.' };
      return { event, summary, error: null };
    }),
  );
  const attendanceError = attendanceResults.find((result) => result.error)?.error;
  if (attendanceError) return { data: null, error: attendanceError };
  const attendance: AdminAttendanceSummary[] = attendanceResults.flatMap(({ event, summary }) => {
    if (!summary || summary.total === 0) return [];
    return [{
      eventId: event.id,
      eventTitle: event.title,
      totalStudents: summary.total,
      attendeeCount: summary.present + summary.late,
      lateCount: summary.late,
      absentCount: summary.absent,
    }];
  });

  return {
    data: {
      users,
      events: (eventsResult.data ?? []) as AdminEvent[],
      attendance,
      courses: (coursesResult.data ?? []) as AdminCourse[],
      yearLevels: (yearsResult.data ?? []) as AdminYearLevel[],
      sections: (sectionsResult.data ?? []) as AdminSection[],
    },
    error: null,
  };
}

export async function updateAdminUser(
  userId: string,
  fullName: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('admin_update_profile', {
    p_user_id: userId,
    p_full_name: fullName.trim() || null,
  });
  return { error: error?.message ?? null };
}

export async function approveTeacher(
  userId: string,
  fallbackSession?: Session | null,
): Promise<{ error: string | null }> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(fallbackSession);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your session could not be refreshed.' };
  }

  const request = supabase.rpc('admin_approve_teacher', { p_user_id: userId });
  request.setHeader('Authorization', `Bearer ${accessToken}`);
  const { error } = await request;
  return { error: error?.message ?? null };
}

export async function deactivateAdminUser(userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('admin_deactivate_user', { p_user_id: userId });
  return { error: error?.message ?? null };
}

export async function reactivateAdminUser(userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('admin_reactivate_user', { p_user_id: userId });
  return { error: error?.message ?? null };
}

export async function deleteAdminUser(
  userId: string,
  fallbackSession?: Session | null,
): Promise<{ error: string | null }> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(fallbackSession);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your session could not be refreshed.' };
  }

  const request = supabase.rpc('admin_delete_user', { p_user_id: userId });
  request.setHeader('Authorization', `Bearer ${accessToken}`);
  const { error } = await request;
  if (!error) return { error: null };

  const message = error.message.toLowerCase();
  if (message.includes('could not find the function') && message.includes('admin_delete_user')) {
    return {
      error: 'Permanent user deletion is not enabled in this Supabase project yet. Apply migration 20261050000000_add_admin_user_deletion.sql, then retry.',
    };
  }
  return { error: error.message };
}
