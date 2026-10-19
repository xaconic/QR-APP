import { supabase } from './supabase';

const realtimeTables = [
  'academic_levels',
  'academic_sections',
  'attendance',
  'course_year_levels',
  'courses',
  'event_audience',
  'event_staff',
  'events',
  'profiles',
  'student_academic_assignments',
  'year_levels',
] as const;

const listeners = new Set<() => void>();
const statusListeners = new Set<(connected: boolean) => void>();
let realtimeConnected = false;

export function subscribeToSupabaseDataChanges(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeToSupabaseRealtimeStatus(listener: (connected: boolean) => void) {
  statusListeners.add(listener);
  listener(realtimeConnected);
  return () => {
    statusListeners.delete(listener);
  };
}

function notifyDataChanged() {
  listeners.forEach((listener) => listener());
}

function setRealtimeConnected(connected: boolean) {
  realtimeConnected = connected;
  statusListeners.forEach((listener) => listener(connected));
}

export function subscribeToSupabaseRealtime(accessToken: string) {
  let active = true;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  const start = async () => {
    try {
      await supabase.realtime.setAuth(accessToken);
      if (!active) return;
      channel = supabase.channel('app-data-sync');
      for (const table of realtimeTables) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, notifyDataChanged);
      }
      channel.subscribe((status, error) => {
        if (!active) return;
        if (status === 'SUBSCRIBED') {
          setRealtimeConnected(true);
          notifyDataChanged();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeConnected(false);
          if (status !== 'CLOSED') {
            console.warn('Supabase realtime data sync is unavailable.', error ?? status);
          }
        }
      });
    } catch (error) {
      if (!active) return;
      setRealtimeConnected(false);
      console.warn('Unable to start Supabase realtime data sync.', error);
    }
  };

  void start();
  return () => {
    active = false;
    setRealtimeConnected(false);
    if (channel) void supabase.removeChannel(channel);
  };
}
