import { getFreshAccessToken, supabase } from './supabase';
import type { Session } from '@supabase/supabase-js';
import { getEventAudienceConfig, type EventAudienceScope } from './academic';

export type Event = {
  eventId: string;
  title: string;
  start: string;
  end: string;
  lateAfter?: string;
  venue?: string;
  description?: string;
  audience?: {
    courseIds?: string[];
    yearLevelIds?: string[];
    sectionIds?: string[];
  };
};

export type CloudEvent = {
  id: string;
  event_code: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  late_time: string | null;
  created_by: string | null;
  created_at: string;
  status: EventStatus;
  event_status?: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  venue: string | null;
  description: string | null;
  archived_at: string | null;
  audience_mode: 'all' | 'groups' | 'legacy';
  audience_configured_at?: string | null;
};

export type EventEditInput = {
  eventCode: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  lateAfter: string | null;
  venue: string | null;
  description: string | null;
  status: EventStatus;
};

export type EventStatus = 'open' | 'closed';

export type DiscoveryEvent = CloudEvent & {
  attended: boolean;
  attendanceStatus?: 'present' | 'late' | null;
};

export async function getEventCreatorNames(
  creatorIds: string[],
  accessToken?: string,
): Promise<Record<string, string>> {
  const uniqueCreatorIds = Array.from(new Set(creatorIds.filter(Boolean)));
  if (uniqueCreatorIds.length === 0) return {};

  const request = supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', uniqueCreatorIds);
  if (accessToken) request.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data, error } = await request;
  if (error) throw error;

  return Object.fromEntries(
    (data ?? []).map((profile: { id: string; full_name: string | null; email: string }) => [
      profile.id,
      profile.full_name?.trim() || profile.email || 'Unknown user',
    ]),
  );
}

function sanitizeEventText(value: string, maxLength = 120) {
  return value
    .replace(/\\/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function sameIdSet(left: string[], right: string[]) {
  const a = Array.from(new Set(left)).sort();
  const b = Array.from(new Set(right)).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function normalizeEventCode(value: string) {
  return sanitizeEventText(value, 40).replace(/[^A-Za-z0-9_-]/g, '');
}

export async function createEvent(
  event: Event,
  fallbackSession?: Session | null,
): Promise<{ data: CloudEvent | null; error: string | null }> {
  try {
    const accessToken = await getFreshAccessToken(fallbackSession);
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authData.user?.id) {
      return { data: null, error: authError?.message ?? 'You must be signed in to create an event.' };
    }
    if (fallbackSession && authData.user.id !== fallbackSession.user.id) {
      return { data: null, error: 'The signed-in account changed. Please sign in again before creating an event.' };
    }

    const safeEventId = normalizeEventCode(event.eventId);
    const safeTitle = sanitizeEventText(event.title, 120);

    if (!safeEventId || !safeTitle) {
      return { data: null, error: 'Event title and code are required.' };
    }

    const request = supabase.rpc('create_event_with_audience_late_details', {
      p_event_code: safeEventId,
      p_title: safeTitle,
      p_start_time: event.start || null,
      p_end_time: event.end || null,
      p_late_time: event.lateAfter || null,
      p_venue: event.venue ? sanitizeEventText(event.venue, 160) : null,
      p_description: event.description ? sanitizeEventText(event.description, 2000) : null,
      p_course_ids: event.audience?.courseIds ?? [],
      p_year_level_ids: event.audience?.yearLevelIds ?? [],
      p_section_ids: event.audience?.sectionIds ?? [],
    });
    request.setHeader('Authorization', `Bearer ${accessToken}`);
    const { data, error } = await request;

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes('duplicate') || message.includes('events_event_code') || message.includes('event_code')) {
        return { data: null, error: 'That event code is already in use. Please enter a different event code.' };
      }
      return { data: null, error: error.message };
    }

    const created = data as CloudEvent | null;
    if (!created?.id) return { data: null, error: 'The event was saved but its record could not be verified.' };
    if (created.created_by !== authData.user.id) {
      return {
        data: null,
        error: 'The event was saved, but this account is not listed as its creator. Contact an administrator before sharing its QR code.',
      };
    }
    const savedAudience = await getEventAudienceConfig(created.id, fallbackSession);
    const requestedGroups = event.audience?.courseIds?.length || event.audience?.yearLevelIds?.length || event.audience?.sectionIds?.length;
    if (requestedGroups && (savedAudience.mode !== 'groups' || !savedAudience.groups.length
      || !sameIdSet(savedAudience.scope.courseIds, event.audience?.courseIds ?? [])
      || !sameIdSet(savedAudience.scope.yearLevelIds, event.audience?.yearLevelIds ?? [])
      || !sameIdSet(savedAudience.scope.sectionIds, event.audience?.sectionIds ?? []))) {
      return { data: null, error: 'The event was saved but its participant groups could not be verified.' };
    }
    if (!requestedGroups && savedAudience.mode !== 'all') {
      return { data: null, error: 'The event was saved but its All Students configuration could not be verified.' };
    }
    return { data: created, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'The event could not be created. Check your connection and try again.',
    };
  }
}

export async function getEventById(eventId: string): Promise<CloudEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle();

  if (error || !data) return null;
  return data as CloudEvent;
}

export async function getManagedEventById(
  eventId: string,
  fallbackSession?: Session | null,
): Promise<{ data: CloudEvent | null; error: string | null }> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(fallbackSession);
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Your session could not be refreshed.' };
  }
  const request = supabase.rpc('get_managed_event', { p_event_id: eventId });
  request.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data, error } = await request;
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: 'The event was not found or is not available to this account.' };
  return { data: data as CloudEvent, error: null };
}

export async function updateEvent(
  eventId: string,
  input: EventEditInput
): Promise<{ data: CloudEvent | null; error: string | null }> {
  const { data, error } = await supabase.rpc('update_event', {
    p_event_id: eventId,
    p_event_code: normalizeEventCode(input.eventCode),
    p_title: sanitizeEventText(input.title, 120),
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_venue: input.venue ? sanitizeEventText(input.venue, 160) : null,
    p_description: input.description ? sanitizeEventText(input.description, 2000) : null,
    p_status: input.status,
  });

  if (!error) return { data: data as CloudEvent, error: null };

  const message = error.message.toLowerCase();
  if (message.includes('not authorized') || message.includes('forbidden')) {
    return { data: null, error: 'You are not authorized to edit this event.' };
  }
  if (message.includes('event not found')) return { data: null, error: 'Event no longer exists.' };
  if (message.includes('already in use') || message.includes('duplicate') || message.includes('event_code')) {
    return { data: null, error: 'That event code is already in use.' };
  }
  if (message.includes('status must')) return { data: null, error: 'Invalid event status.' };
  if (message.includes('start time') || message.includes('end time') || message.includes('date')) {
    return { data: null, error: 'Please enter valid event dates with the end after the start.' };
  }
  return { data: null, error: error.message };
}

export async function updateEventWithAudience(
  eventId: string,
  input: EventEditInput,
  audienceMode: 'all' | 'groups',
  audienceScope: EventAudienceScope,
): Promise<{ data: CloudEvent | null; error: string | null }> {
  const { data, error } = await supabase.rpc('update_event_with_audience_late', {
    p_event_id: eventId,
    p_event_code: normalizeEventCode(input.eventCode),
    p_title: sanitizeEventText(input.title, 120),
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_late_time: input.lateAfter,
    p_venue: input.venue ? sanitizeEventText(input.venue, 160) : null,
    p_description: input.description ? sanitizeEventText(input.description, 2000) : null,
    p_status: input.status,
    p_audience_mode: audienceMode,
    p_course_ids: audienceScope.courseIds,
    p_year_level_ids: audienceScope.yearLevelIds,
    p_section_ids: audienceScope.sectionIds,
  });
  if (error) return { data: null, error: error.message };

  const saved = await getEventAudienceConfig(eventId);
  if (saved.mode !== audienceMode) return { data: null, error: 'Event saved but participant configuration could not be verified.' };
  if (audienceMode === 'groups' && (!saved.groups.length
    || !sameIdSet(saved.scope.courseIds, audienceScope.courseIds)
    || !sameIdSet(saved.scope.yearLevelIds, audienceScope.yearLevelIds)
    || !sameIdSet(saved.scope.sectionIds, audienceScope.sectionIds))) {
    return { data: null, error: 'Event saved but participant groups could not be verified.' };
  }
  return { data: data as CloudEvent, error: null };
}

export async function setEventStatus(
  eventId: string,
  status: EventStatus
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('set_event_status', {
    p_event_id: eventId,
    p_status: status,
  });

  if (!error) return { error: null };

  const message = error.message.toLowerCase();
  if (message.includes('not authorized') || message.includes('forbidden')) {
    return { error: 'You are not authorized to change this event.' };
  }
  if (message.includes('event not found')) {
    return { error: 'Event no longer exists.' };
  }
  if (message.includes('status must')) {
    return { error: 'Invalid event status.' };
  }
  return { error: error.message };
}

export async function archiveEvent(eventId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('admin_archive_event', { p_event_id: eventId });
  if (!error) return { error: null };
  const message = error.message.toLowerCase();
  if (message.includes('not authorized')) return { error: 'You are not authorized to archive this event.' };
  if (message.includes('not found')) return { error: 'Event no longer exists.' };
  return { error: error.message };
}

export async function deleteEvent(
  eventId: string,
  fallbackSession?: Session | null,
): Promise<{ error: string | null }> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(fallbackSession);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your session could not be refreshed.' };
  }
  const request = supabase.rpc('delete_event', { p_event_id: eventId });
  request.setHeader('Authorization', `Bearer ${accessToken}`);
  const { error } = await request;
  if (!error) return { error: null };

  const message = error.message.toLowerCase();
  if (message.includes('not authorized') || message.includes('forbidden')) {
    return { error: 'You are not authorized to delete this event.' };
  }
  if (message.includes('event not found')) {
    return { error: 'Event no longer exists.' };
  }
  return { error: error.message };
}

export async function getEventsByTeacher(
  teacherId: string
): Promise<CloudEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as CloudEvent[];
}

export async function getEventByCode(
  code: string
): Promise<CloudEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('event_code', code)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as CloudEvent;
}

export async function getDiscoveryEvents(
  studentId?: string,
  accessToken?: string,
): Promise<DiscoveryEvent[]> {
  if (studentId) {
    const discoveryRequest = supabase.rpc('get_student_discovery_events');
    if (accessToken) discoveryRequest.setHeader('Authorization', `Bearer ${accessToken}`);
    const { data, error } = await discoveryRequest;
    if (error) throw error;
    if (!data) return [];

    const discoveryEvents = data as DiscoveryEvent[];
    if (!discoveryEvents.length) return discoveryEvents;

    const attendanceRequest = supabase
      .from('attendance')
      .select('event_id, status')
      .eq('student_id', studentId)
      .in('event_id', discoveryEvents.map((event) => event.id));
    if (accessToken) attendanceRequest.setHeader('Authorization', `Bearer ${accessToken}`);
    const { data: attendance, error: attendanceError } = await attendanceRequest;
    if (attendanceError) throw attendanceError;

    const attendanceByEvent = new Map(
      (attendance ?? []).map((record: { event_id: string; status: string }) => [
        record.event_id,
        record.status === 'present' || record.status === 'late' ? record.status : null,
      ] as const)
    );
    return discoveryEvents.map((event) => {
      const attendanceStatus = attendanceByEvent.get(event.id) ?? null;
      return {
        ...event,
        attendanceStatus,
        attended: attendanceStatus === 'present' || attendanceStatus === 'late',
      };
    });
  }

  const eventsRequest = supabase
    .from('events')
    .select('id, event_code, title, start_time, end_time, created_by, created_at, status, event_status, venue, description, archived_at, audience_mode, audience_configured_at')
    .is('archived_at', null)
    .order('start_time', { ascending: true, nullsFirst: false });
  if (accessToken) eventsRequest.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data, error } = await eventsRequest;
  if (error) throw error;
  if (!data) return [];

  let attendedIds = new Set<string>();
  if (studentId && data.length) {
    const attendance = await supabase.from('attendance').select('event_id').eq('student_id', studentId).in('event_id', data.map((item) => item.id));
    if (!attendance.error) attendedIds = new Set((attendance.data ?? []).map((row: { event_id: string }) => row.event_id));
  }
  return (data as CloudEvent[]).map((event) => ({ ...event, attended: attendedIds.has(event.id) }));
}
