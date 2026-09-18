import { supabase } from './supabase';

export type Event = {
  eventId: string;
  title: string;
  start: string;
  end: string;
};

export type CloudEvent = {
  id: string;
  event_code: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  created_by: string | null;
  created_at: string;
};

function sanitizeEventText(value: string, maxLength = 120) {
  return value
    .replace(/\\/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

export async function createEvent(
  event: Event
): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return { error: 'You must be signed in to create an event.' };
  }

  const safeEventId = sanitizeEventText(event.eventId, 40)
    .replace(/[^A-Za-z0-9_-]/g, '');
  const safeTitle = sanitizeEventText(event.title, 120);

  if (!safeEventId || !safeTitle) {
    return { error: 'Event title and code are required.' };
  }

  const { error } = await supabase.from('events').upsert(
    {
      event_code: safeEventId,
      title: safeTitle,
      start_time: event.start || null,
      end_time: event.end || null,
      created_by: user.id,
    },
    { onConflict: 'event_code' }
  );

  return { error: error?.message ?? null };
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
