import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MotionPressable from '@/components/MotionPressable';
import { MOTION } from '@/constants/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from '@/components/AppButton';
import AppTextInput from '@/components/AppTextInput';
import EventAudiencePicker from '@/components/EventAudiencePicker';
import EventQRCode from '@/components/EventQRCode';
import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { createEvent, normalizeEventCode } from '@/lib/events';
import type { EventAudienceScope } from '@/lib/academic';
import { useAuth } from '@/lib/auth';
import { getProfile, type Role } from '@/lib/profiles';

const QUICK_END_OPTIONS = [
  { label: '+30 min', milliseconds: 30 * 60 * 1000 },
  { label: '+1 hour', milliseconds: 60 * 60 * 1000 },
  { label: '+2 hours', milliseconds: 2 * 60 * 60 * 1000 },
];

export default function CreateEventTab() {
  const { user, session } = useAuth();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { reset } = useLocalSearchParams<{ reset?: string }>();
  const [title, setTitle] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [venue, setVenue] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState(new Date());
  const [end, setEnd] = useState(() => new Date(Date.now() + 60 * 60 * 1000));
  const [lateAfter, setLateAfter] = useState(() => new Date(Date.now() + 15 * 60 * 1000));
  const [picker, setPicker] = useState<'start' | 'end' | 'late' | null>(null);
  const [pickerPart, setPickerPart] = useState<'date' | 'time'>('date');
  const [mode, setMode] = useState<'all' | 'groups'>('all');
  const [scope, setScope] = useState<EventAudienceScope>({ courseIds: [], yearLevelIds: [], sectionIds: [] });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createdEvent, setCreatedEvent] = useState<{ id: string; event_code: string; title: string; start_time: string; end_time: string } | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [closing, setClosing] = useState(false);
  const successAnimation = useRef(new Animated.Value(0)).current;
  const modalAnimation = useRef(new Animated.Value(0)).current;
  const hasEntered = useRef(false);

  const closeModal = useCallback(() => {
    if (closing) return;
    setClosing(true);
    Animated.timing(modalAnimation, {
      toValue: 0,
      duration: reduceMotion ? 0 : MOTION.stateDuration,
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished) router.back();
    });
  }, [closing, modalAnimation, reduceMotion]);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null || hasEntered.current) return;
    hasEntered.current = true;
    modalAnimation.setValue(0);
    Animated.timing(modalAnimation, {
      toValue: 1,
      duration: reduceMotion ? 0 : MOTION.modalDuration,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [modalAnimation, reduceMotion]);

  useEffect(() => {
    let active = true;
    if (!user) { setRole(null); setRoleLoading(false); return () => { active = false; }; }
    getProfile(user.id, session?.access_token).then((profile) => {
      if (!active) return;
      setRole(profile?.role ?? null);
    }).catch(() => {
      if (active) setRole(null);
    }).finally(() => {
      if (active) setRoleLoading(false);
    });
    return () => { active = false; };
  }, [session?.access_token, user]);

  useEffect(() => {
    if (!reset) return;
    setTitle('');
    setEventCode('');
    setVenue('');
    setDescription('');
    setStart(new Date());
    setEnd(new Date(Date.now() + 60 * 60 * 1000));
    setLateAfter(new Date(Date.now() + 15 * 60 * 1000));
    setPicker(null);
    setPickerPart('date');
    setMode('all');
    setScope({ courseIds: [], yearLevelIds: [], sectionIds: [] });
    setMessage(null);
    setCreatedEvent(null);
  }, [reset]);

  useEffect(() => {
    if (!createdEvent) return;
    successAnimation.setValue(0);
    if (reduceMotion) {
      successAnimation.setValue(1);
      return;
    }
    Animated.spring(successAnimation, { toValue: 1, useNativeDriver: true, damping: 14, stiffness: 150 }).start();
  }, [createdEvent, reduceMotion, successAnimation]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeModal();
      return true;
    });
    return () => subscription.remove();
  }, [closeModal]);

  const applyDate = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === 'dismissed' || !selected || !picker) {
      setPicker(null);
      setPickerPart('date');
      return;
    }

    const current = picker === 'start' ? start : picker === 'end' ? end : lateAfter;
    const next = new Date(current);
    if (pickerPart === 'date') {
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      if (picker === 'start') setStart(next);
      else if (picker === 'end') setEnd(next);
      else setLateAfter(next);
      if (Platform.OS === 'android') {
        setPickerPart('time');
        return;
      }
    } else {
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    }
    if (picker === 'start') setStart(next);
    else if (picker === 'end') setEnd(next);
    else setLateAfter(next);
    setPicker(null);
    setPickerPart('date');
  };

  const setQuickEnd = (milliseconds: number) => {
    setEnd(new Date(start.getTime() + milliseconds));
  };

  const save = async () => {
    const safeCode = normalizeEventCode(eventCode);
    setMessage(null);
    if (!title.trim() || !safeCode) { setMessage('Event title and code are required.'); return; }
    if (end <= start) { setMessage('End time must be after start time.'); return; }
    if (lateAfter < start || lateAfter > end) { setMessage('Late time must be between the start and end times.'); return; }
    if (mode === 'groups' && (!scope.courseIds.length || !scope.yearLevelIds.length || !scope.sectionIds.length)) {
      setMessage('Select at least one course, year level, and section.'); return;
    }
    setSaving(true);
    const result = await createEvent({
      eventId: safeCode,
      title: title.trim(),
      start: start.toISOString(),
      end: end.toISOString(),
      lateAfter: lateAfter.toISOString(),
      venue: venue.trim() || undefined,
      description: description.trim() || undefined,
      audience: mode === 'groups' ? scope : { courseIds: [], yearLevelIds: [], sectionIds: [] },
    });
    setSaving(false);
    if (result.error) { setMessage(result.error); return; }
    if (!result.data) { setMessage('The event was created but could not be loaded. Please refresh and try again.'); return; }
    setCreatedEvent({
      id: result.data.id,
      event_code: result.data.event_code,
      title: result.data.title,
      start_time: result.data.start_time ?? start.toISOString(),
      end_time: result.data.end_time ?? end.toISOString(),
    });
  };

  if (roleLoading) return <View style={styles.unauthorized}><ActivityIndicator color={COLORS.primary} /></View>;
  if (role !== 'teacher' && role !== 'admin') return <View style={styles.unauthorized}><Text style={styles.title}>Event creation unavailable</Text><Text style={styles.subtitle}>Only Teacher and Administrator accounts can create events.</Text><AppButton title="Close" icon="close" onPress={() => router.back()} /></View>;

  if (createdEvent) return <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
    <ScrollView contentContainerStyle={styles.successContent} showsVerticalScrollIndicator={false}>
      <Animated.View style={[styles.formCard, styles.successCard, { opacity: successAnimation, transform: [{ translateY: successAnimation.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}>
        <MotionPressable style={styles.successClose} onPress={() => router.back()} hitSlop={10}><Text style={styles.close}>×</Text></MotionPressable>
        <Animated.View style={[styles.successIconCircle, { transform: [{ scale: successAnimation }] }]}><Text style={styles.successIcon}>✓</Text></Animated.View>
        <Text style={styles.successTitle}>Event Created</Text>
        <Text style={styles.successEventTitle}>{createdEvent.title}</Text>
        <Text style={styles.eventCode}>Event code · {createdEvent.event_code}</Text>
        <Text style={styles.qrHint}>Display this live code at the event so students can check in.</Text>
        <View style={styles.qrPanel}><Text style={styles.qrTitle}>Attendance QR</Text><EventQRCode event={createdEvent} /></View>
      </Animated.View>
    </ScrollView>
  </View>;

  return <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
    <KeyboardAvoidingView style={styles.keyboardArea} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Animated.View
        style={[
          styles.formCard,
          { maxHeight: Math.max(180, window.height - insets.top - insets.bottom - 24) },
          styles.modalCard,
          {
            opacity: modalAnimation,
            transform: [{ scale: modalAnimation.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}><Ionicons name="calendar-outline" size={20} color={COLORS.primary} /></View>
          <View style={styles.headerText}>
            <Text style={styles.title}>Create Event QR</Text>
            <Text style={styles.subtitle}>Create an attendance event</Text>
          </View>
          <MotionPressable style={styles.headerClose} onPress={closeModal} disabled={closing} accessibilityRole="button" accessibilityLabel="Close create event form">
            <Ionicons name="close" size={22} color={COLORS.textSecondary} />
          </MotionPressable>
        </View>
        <ScrollView
          style={styles.formScroll}
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
        >
          <View style={styles.field}>
            <Text style={styles.label}>Event Title</Text>
            <AppTextInput inputStyle={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Founders Day Assembly" />
          </View>
          <View style={[styles.fieldRow, window.width < 360 && styles.fieldRowStacked]}>
            <View style={[styles.field, styles.halfField]}>
              <Text style={styles.label}>Event Code</Text>
              <AppTextInput inputStyle={styles.input} value={eventCode} onChangeText={setEventCode} autoCapitalize="characters" placeholder="Event code" />
            </View>
            <View style={[styles.field, styles.halfField]}>
              <Text style={styles.label}>Venue (optional)</Text>
              <AppTextInput inputStyle={styles.input} value={venue} onChangeText={setVenue} placeholder="e.g. AVR 1" />
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Description (optional)</Text>
            <AppTextInput inputStyle={[styles.input, styles.descriptionInput]} value={description} onChangeText={setDescription} placeholder="Add event details" multiline />
          </View>
          <View style={styles.schedule}>
            <View style={styles.scheduleHeading}>
              <View style={styles.scheduleIcon}><Ionicons name="time-outline" size={15} color={COLORS.primary} /></View>
              <Text style={styles.sectionLabel}>SCHEDULE</Text>
            </View>
            <View style={[styles.fieldRow, window.width < 360 && styles.fieldRowStacked]}>
              <View style={[styles.field, styles.halfField]}>
                <Text style={styles.label}>Starts</Text>
                <DateField value={start} onDatePress={() => { setPickerPart('date'); setPicker('start'); }} onTimePress={() => { setPickerPart('time'); setPicker('start'); }} />
              </View>
              <View style={[styles.field, styles.halfField]}>
                <Text style={styles.label}>Ends</Text>
                <DateField value={end} onDatePress={() => { setPickerPart('date'); setPicker('end'); }} onTimePress={() => { setPickerPart('time'); setPicker('end'); }} />
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Late after</Text>
              <DateField value={lateAfter} onDatePress={() => { setPickerPart('date'); setPicker('late'); }} onTimePress={() => { setPickerPart('time'); setPicker('late'); }} />
            </View>
            <Text style={styles.quickHint}>Check-ins at or after this time are marked Late.</Text>
            <View style={styles.quickRow}>
              {QUICK_END_OPTIONS.map((option) => <MotionPressable key={option.label} style={styles.quickChip} onPress={() => setQuickEnd(option.milliseconds)}><Text style={styles.quickChipText}>{option.label}</Text></MotionPressable>)}
            </View>
            <Text style={styles.quickHint}>Set the end time from the start.</Text>
          </View>
          {picker && <DateTimePicker key={`${picker}-${pickerPart}`} value={picker === 'start' ? start : picker === 'end' ? end : lateAfter} mode={Platform.OS === 'android' ? pickerPart : 'datetime'} display={Platform.OS === 'android' ? 'default' : 'spinner'} onChange={applyDate} />}
          <EventAudiencePicker mode={mode} onModeChange={setMode} scope={scope} onScopeChange={setScope} disabled={saving} />
        </ScrollView>
        <View style={styles.formFooter}>
          {message && <Text style={styles.message}>{message}</Text>}
          {saving && <ActivityIndicator color={COLORS.primary} style={styles.loader} />}
          <View style={[styles.footerActions, window.width < 380 && styles.footerActionsStacked]}>
            <View style={styles.footerButton}><AppButton theme="primary" title="Create Event QR" icon="add-circle-outline" onPress={save} disabled={saving || closing} loading={saving} loadingTitle="Creating event..." compact /></View>
            <View style={styles.footerButton}><AppButton theme="card" title="Cancel" icon="close-circle-outline" onPress={closeModal} disabled={saving || closing} compact /></View>
          </View>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  </View>;
}

function DateField({ value, onDatePress, onTimePress }: { value: Date; onDatePress: () => void; onTimePress: () => void }) {
  return <View style={styles.dateField}>
    <MotionPressable style={({ pressed }) => [styles.datePart, pressed && styles.datePartPressed]} onPress={onDatePress} accessibilityRole="button" accessibilityLabel={`Change date, ${value.toLocaleDateString('en-PH', { dateStyle: 'medium' })}`}>
      <Text style={styles.dateText} numberOfLines={1}>{value.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</Text>
    </MotionPressable>
    <MotionPressable style={({ pressed }) => [styles.timePart, pressed && styles.datePartPressed]} onPress={onTimePress} accessibilityRole="button" accessibilityLabel={`Change time, ${value.toLocaleTimeString('en-PH', { timeStyle: 'short' })}`}>
      <Text style={styles.dateText} numberOfLines={1}>{value.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</Text>
    </MotionPressable>
    <MotionPressable style={({ pressed }) => pressed && styles.datePartPressed} onPress={onDatePress} accessibilityRole="button" accessibilityLabel="Open date picker" hitSlop={6}>
      <Ionicons name="calendar-outline" size={17} color={COLORS.primary} />
    </MotionPressable>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.backdrop, paddingHorizontal: 12 },
  keyboardArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalCard: { borderColor: COLORS.border, backgroundColor: COLORS.background },
  unauthorized: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 5 },
  formCard: { width: '100%', maxWidth: 560, maxHeight: '90%', flexShrink: 1, backgroundColor: COLORS.background, borderColor: COLORS.border, borderWidth: 1, borderRadius: 16, padding: 14, overflow: 'hidden' },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: `${COLORS.primary}14`, borderWidth: 1, borderColor: `${COLORS.primary}28`, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  headerText: { flex: 1, minWidth: 0 },
  headerClose: { width: 44, height: 44, borderRadius: 10, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  formScroll: { flexShrink: 1, minHeight: 0 },
  formContent: { paddingTop: 10, paddingBottom: 12 },
  formFooter: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10, backgroundColor: COLORS.background },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footerActionsStacked: { flexDirection: 'column', alignItems: 'stretch' },
  footerButton: { flex: 1, minWidth: 0 },
  title: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700', fontFamily: FONTS.bold, letterSpacing: -0.25 },
  subtitle: { color: COLORS.textSecondary, fontSize: 11, marginTop: 3, fontFamily: FONTS.medium },
  successContent: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  successCard: { borderRadius: 16 },
  successClose: { position: 'absolute', top: 10, right: 12, zIndex: 2, padding: 2 },
  successIconCircle: { alignSelf: 'center', width: 48, height: 48, borderRadius: 14, backgroundColor: `${COLORS.success}18`, borderWidth: 1, borderColor: `${COLORS.success}55`, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  successIcon: { color: COLORS.success, fontSize: 30, fontWeight: '800' },
  successTitle: { alignSelf: 'center', width: '100%', color: COLORS.textPrimary, fontSize: 22, fontWeight: '700', fontFamily: FONTS.bold, textAlign: 'center', marginTop: 4 },
  successEventTitle: { alignSelf: 'center', width: '100%', color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', fontFamily: FONTS.semiBold, textAlign: 'center', marginTop: 8 },
  eventCode: { alignSelf: 'center', width: '100%', color: COLORS.primary, fontSize: 13, fontWeight: '600', fontFamily: FONTS.semiBold, textAlign: 'center', marginTop: 5 },
  qrHint: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, textAlign: 'center', marginTop: 14 },
  qrPanel: { backgroundColor: `${COLORS.surface}55`, borderRadius: 18, borderWidth: 1, borderColor: `${COLORS.border}AA`, marginTop: 12, paddingTop: 10, paddingHorizontal: 8, paddingBottom: 4 },
  qrTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: FONTS.bold, textAlign: 'center' },
  close: { color: COLORS.textPrimary, fontSize: 28, lineHeight: 26, paddingHorizontal: 3 },
  field: { marginBottom: 10 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  fieldRowStacked: { flexDirection: 'column' },
  halfField: { flex: 1, minWidth: 0 },
  label: { color: COLORS.textPrimary, fontWeight: '600', fontFamily: FONTS.semiBold, fontSize: 12, letterSpacing: 0.1, marginBottom: 5 },
  input: { minHeight: 44, backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 8, color: COLORS.textPrimary, paddingHorizontal: 12, paddingVertical: 7, fontSize: 13, fontFamily: FONTS.regular, textAlignVertical: 'center' },
  descriptionInput: { minHeight: 62, textAlignVertical: 'top' },
  dateField: { minHeight: 44, backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5 },
  datePart: { minWidth: 0, flexShrink: 0 },
  timePart: { flex: 1, minWidth: 0 },
  datePartPressed: { opacity: 0.7 },
  dateText: { minWidth: 0, color: COLORS.textPrimary, fontSize: 12, fontFamily: FONTS.medium },
  schedule: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 10, padding: 11, marginBottom: 10 },
  scheduleHeading: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  scheduleIcon: { width: 24, height: 24, borderRadius: 8, backgroundColor: `${COLORS.primary}18`, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { color: COLORS.textSecondary, fontSize: 10, fontWeight: '700', fontFamily: FONTS.bold, letterSpacing: 1 },
  quickRow: { flexDirection: 'row', gap: 6, marginTop: 3 },
  quickChip: { minHeight: 34, backgroundColor: `${COLORS.primary}18`, borderColor: `${COLORS.primary}44`, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, justifyContent: 'center' },
  quickChipText: { color: COLORS.primary, fontSize: 11, fontWeight: '700', fontFamily: FONTS.bold },
  quickHint: { color: COLORS.textSecondary, fontSize: 11, fontFamily: FONTS.regular, marginTop: 4, lineHeight: 16 },
  message: { color: COLORS.danger, marginBottom: 6, lineHeight: 17, fontSize: 12, fontFamily: FONTS.medium },
  loader: { marginVertical: 4 },
});
