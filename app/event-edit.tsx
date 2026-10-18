import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import EventEditor from '@/components/EventEditor';
import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { useAuth } from '@/lib/auth';
import { getManagedEventById, type CloudEvent } from '@/lib/events';
import { getProfile } from '@/lib/profiles';

export default function EventEditScreen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const { user, session } = useAuth();
  const insets = useSafeAreaInsets();
  const [event, setEvent] = useState<CloudEvent | null>(null);
  const [state, setState] = useState('Loading event...');

  useEffect(() => {
    let active = true;
    (async () => {
      if (!user || !eventId) { if (active) setState('Event not found.'); return; }
      const profile = await getProfile(user.id, session?.access_token);
      if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) { if (active) setState('You are not authorized to edit events.'); return; }
      const loaded = await getManagedEventById(eventId);
      if (!active) return;
      if (!loaded) setState('Event not found.'); else setEvent(loaded);
    })();
    return () => { active = false; };
  }, [eventId, session?.access_token, user]);

  if (!event) return <View style={[styles.state, { paddingTop: insets.top }]}><ActivityIndicator color={COLORS.primary} /><Text style={styles.stateText}>{state}</Text></View>;
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>EVENT SETTINGS</Text>
        <Text style={styles.title}>Edit Event</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{event.title} · {event.event_code}</Text>
      </View>
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <EventEditor
          event={event}
          bottomInset={insets.bottom}
          onSaved={() => router.back()}
          onCancel={() => router.back()}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  eyebrow: { color: COLORS.primary, fontSize: 10, letterSpacing: 1, fontFamily: FONTS.bold, marginBottom: 3 },
  title: { color: COLORS.textPrimary, fontSize: 22, lineHeight: 28, fontWeight: '700', fontFamily: FONTS.bold },
  subtitle: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, fontFamily: FONTS.regular, marginTop: 2 },
  keyboardView: { flex: 1 },
  state: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateText: { color: COLORS.textSecondary, textAlign: 'center', fontFamily: FONTS.regular, marginTop: 12 },
});
