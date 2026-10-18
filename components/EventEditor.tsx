import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MotionPressable from '@/components/MotionPressable';
import { MOTION } from '@/constants/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { animateLayoutChange } from '@/lib/motion';

import AppTextInput from '@/components/AppTextInput';
import EventAudiencePicker from '@/components/EventAudiencePicker';
import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { getEventAudienceConfig, type EventAudienceScope } from '@/lib/academic';
import { normalizeEventCode, updateEventWithAudience, type CloudEvent, type EventEditInput, type EventStatus } from '@/lib/events';

type Props = { event: CloudEvent; onSaved: () => void; onCancel: () => void; bottomInset?: number };
type PickerTarget = 'start' | 'end' | 'late';
type FormSnapshot = {
  title: string;
  eventCode: string;
  venue: string;
  description: string;
  start: number | null;
  end: number | null;
  lateAfter: number | null;
  status: EventStatus;
  audienceMode: 'all' | 'groups';
  audienceScope: EventAudienceScope;
};

const SECTIONS = [
  { id: 'basic', title: 'Basic Information' },
  { id: 'schedule', title: 'Schedule' },
  { id: 'venue', title: 'Venue & Description' },
  { id: 'participants', title: 'Eligible Participants' },
  { id: 'status', title: 'Event Status' },
] as const;

function formatDateTime(value: string | null) {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
    timeZone: 'Asia/Manila',
  });
}

function snapshotKey(snapshot: FormSnapshot) {
  return JSON.stringify({
    ...snapshot,
    audienceScope: {
      courseIds: [...snapshot.audienceScope.courseIds].sort(),
      yearLevelIds: [...snapshot.audienceScope.yearLevelIds].sort(),
      sectionIds: [...snapshot.audienceScope.sectionIds].sort(),
    },
  });
}

export default function EventEditor({ event, onSaved, onCancel, bottomInset = 0 }: Props) {
  const reduceMotion = useReducedMotion();
  const [title, setTitle] = useState(event.title);
  const [eventCode, setEventCode] = useState(event.event_code);
  const [venue, setVenue] = useState(event.venue ?? '');
  const [description, setDescription] = useState(event.description ?? '');
  const [start, setStart] = useState(event.start_time ? new Date(event.start_time) : null);
  const [end, setEnd] = useState(event.end_time ? new Date(event.end_time) : null);
  const [lateAfter, setLateAfter] = useState(event.late_time ? new Date(event.late_time) : null);
  const [status, setStatus] = useState<EventStatus>(event.status);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [pickerPart, setPickerPart] = useState<'date' | 'time'>('date');
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'error' | 'info'>('info');
  const [saving, setSaving] = useState(false);
  const [audienceMode, setAudienceMode] = useState<'all' | 'groups'>(event.audience_mode === 'groups' ? 'groups' : 'all');
  const [audienceScope, setAudienceScope] = useState<EventAudienceScope>({ courseIds: [], yearLevelIds: [], sectionIds: [] });
  const [audienceLoading, setAudienceLoading] = useState(true);
  const [audienceLoadError, setAudienceLoadError] = useState<string | null>(null);
  const [audienceRetry, setAudienceRetry] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    schedule: false,
    venue: false,
    participants: false,
    status: false,
  });
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const chevrons = useRef(SECTIONS.map((section) => ({
    id: section.id,
    value: new Animated.Value(section.id === 'basic' ? 1 : 0),
  }))).current;

  useEffect(() => {
    let active = true;
    setAudienceLoading(true);
    setAudienceLoadError(null);
    getEventAudienceConfig(event.id).then((config) => {
      if (!active) return;
      if (event.audience_mode !== 'legacy' && config.mode !== event.audience_mode) {
        throw new Error('Saved participant settings could not be loaded. Please retry.');
      }
      setMessage(null);
      const mode = config.mode === 'groups' || config.mode === 'legacy' ? 'groups' : 'all';
      setAudienceMode(mode);
      setAudienceScope(config.scope);
      const loadedSnapshot = makeSnapshot({
        title, eventCode, venue, description, start, end, lateAfter, status, audienceMode: mode, audienceScope: config.scope,
      });
      setInitialSnapshot(snapshotKey(loadedSnapshot));
    }).catch((error: unknown) => {
      if (!active) return;
      const loadError = error instanceof Error ? error.message : 'Unable to load participant settings.';
      setAudienceLoadError(loadError);
      setMessage(loadError);
      setMessageTone('error');
      setInitialSnapshot(null);
      setExpandedSections((current) => ({ ...current, participants: true }));
    }).finally(() => {
      if (active) setAudienceLoading(false);
    });
    return () => { active = false; };
  }, [event.id, event.audience_mode, audienceRetry]);

  const currentSnapshot = useMemo(() => snapshotKey(makeSnapshot({
    title, eventCode, venue, description, start, end, lateAfter, status, audienceMode, audienceScope,
  })), [title, eventCode, venue, description, start, end, lateAfter, status, audienceMode, audienceScope]);
  const hasUnsavedChanges = initialSnapshot !== null && currentSnapshot !== initialSnapshot;
  const formDisabled = saving || audienceLoading || !!audienceLoadError;
  const invalidSchedule = !!(start && end && end.getTime() <= start.getTime())
    || !!(lateAfter && start && lateAfter.getTime() < start.getTime())
    || !!(lateAfter && end && lateAfter.getTime() > end.getTime());

  const toggleSection = (id: string) => {
    const expanded = !expandedSections[id];
    animateLayoutChange(reduceMotion);
    const chevron = chevrons.find((item) => item.id === id);
    if (chevron && Platform.OS !== 'web' && reduceMotion === false) {
      Animated.timing(chevron.value, {
        toValue: expanded ? 1 : 0,
        duration: MOTION.stateDuration,
        useNativeDriver: true,
      }).start();
    } else if (chevron) {
      chevron.value.setValue(expanded ? 1 : 0);
    }
    setExpandedSections((current) => ({ ...current, [id]: expanded }));
  };

  const applyDate = (pickerEvent: DateTimePickerEvent, selected?: Date) => {
    if (pickerEvent.type === 'dismissed' || !selected || !picker) {
      setPicker(null);
      setPickerPart('date');
      return;
    }
    const current = picker === 'start' ? start : picker === 'end' ? end : lateAfter;
    const next = new Date(current ?? selected);
    if (pickerPart === 'date') {
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      if (picker === 'start') setStart(next); else if (picker === 'end') setEnd(next); else setLateAfter(next);
      if (Platform.OS === 'android') {
        setPickerPart('time');
        return;
      }
    } else next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    if (picker === 'start') setStart(next); else if (picker === 'end') setEnd(next); else setLateAfter(next);
    setPicker(null);
    setPickerPart('date');
  };

  const save = async () => {
    if (saving) return;
    const safeCode = normalizeEventCode(eventCode);
    const safeTitle = title.trim();
    setMessage(null);
    if (audienceLoading) {
      setMessage('Loading participant configuration. Please wait.');
      setMessageTone('info');
      return;
    }
    if (audienceLoadError) {
      setMessage('Reload the existing participant settings before saving to avoid changing eligibility unintentionally.');
      setMessageTone('error');
      setExpandedSections((current) => ({ ...current, participants: true }));
      return;
    }
    if (!safeTitle || !safeCode) {
      setMessage('Event title and code are required.');
      setMessageTone('error');
      if (!safeTitle) setExpandedSections((current) => ({ ...current, basic: true }));
      return;
    }
    if (eventCode.trim() !== safeCode) {
      setMessage('Event code may contain only letters, numbers, hyphens, and underscores.');
      setMessageTone('error');
      setExpandedSections((current) => ({ ...current, basic: true }));
      return;
    }
    if (start && Number.isNaN(start.getTime()) || end && Number.isNaN(end.getTime())) {
      setMessage('Please enter valid dates.');
      setMessageTone('error');
      setExpandedSections((current) => ({ ...current, schedule: true }));
      return;
    }
    if (start && end && end.getTime() <= start.getTime()) {
      setMessage('End time must be after start time.');
      setMessageTone('error');
      setExpandedSections((current) => ({ ...current, schedule: true }));
      return;
    }
    if (lateAfter && start && lateAfter < start || lateAfter && end && lateAfter > end) {
      setMessage('Late time must be between the start and end times.');
      setMessageTone('error');
      setExpandedSections((current) => ({ ...current, schedule: true }));
      return;
    }
    if (status !== 'open' && status !== 'closed') {
      setMessage('Invalid event status.');
      setMessageTone('error');
      setExpandedSections((current) => ({ ...current, status: true }));
      return;
    }

    const input: EventEditInput = {
      eventCode: safeCode,
      title: safeTitle,
      startTime: start ? start.toISOString() : null,
      endTime: end ? end.toISOString() : null,
      lateAfter: lateAfter ? lateAfter.toISOString() : null,
      venue: venue.trim() || null,
      description: description.trim() || null,
      status,
    };
    setSaving(true);
    try {
      const result = await updateEventWithAudience(event.id, input, audienceMode, audienceScope);
      if (result.error) {
        setMessage(result.error);
        setMessageTone('error');
        return;
      }
      onSaved();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Unable to save this event. Please try again.');
      setMessageTone('error');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (saving) return;
    if (!hasUnsavedChanges) {
      onCancel();
      return;
    }
    const discard = () => {
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.confirm('Discard unsaved changes to this event?')) onCancel();
      } else {
        Alert.alert('Discard changes?', 'Your unsaved changes will be lost.', [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: onCancel },
        ]);
      }
    };
    discard();
  };

  const participantSummary = audienceMode === 'all'
    ? 'All Students'
    : `Selected Groups · ${audienceScope.courseIds.length} courses · ${audienceScope.yearLevelIds.length} year levels · ${audienceScope.sectionIds.length} sections`;

  return (
    <View style={styles.editor}>
      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {SECTIONS.map((section) => {
          const expanded = !!expandedSections[section.id];
          const chevron = chevrons.find((item) => item.id === section.id);
          const summary = section.id === 'participants'
            ? participantSummary
            : section.id === 'basic'
              ? event.event_code
              : section.id === 'schedule'
                ? start && end ? `${formatDateTime(start.toISOString())} – ${formatDateTime(end.toISOString())}` : 'Set event dates and times'
                : section.id === 'venue'
                  ? venue.trim() || 'Optional event details'
                  : status === 'open' ? 'Open' : 'Closed';
          return (
            <View key={section.id} style={styles.section}>
              <MotionPressable
                style={({ pressed }) => [styles.sectionHeader, pressed && styles.sectionHeaderPressed]}
                onPress={() => toggleSection(section.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
              >
                <View style={styles.sectionHeadingText}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {!expanded && <Text style={styles.sectionSummary} numberOfLines={1}>{summary}</Text>}
                </View>
                <Animated.View style={{ transform: [{ rotate: chevron?.value.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) ?? '0deg' }] }}>
                  <Ionicons name="chevron-down" size={18} color={COLORS.textSecondary} />
                </Animated.View>
              </MotionPressable>

              {expanded && <View style={styles.sectionBody}>
                {section.id === 'basic' && <>
                  <FieldLabel>Event Title</FieldLabel>
                  <AppTextInput inputStyle={styles.input} value={title} onChangeText={setTitle} editable={!formDisabled} placeholder="Event title" returnKeyType="next" />
                  <FieldLabel style={styles.secondFieldLabel}>Event Code</FieldLabel>
                  <AppTextInput inputStyle={styles.input} value={eventCode} onChangeText={setEventCode} editable={!formDisabled} autoCapitalize="characters" placeholder="EVT-2026-0002" />
                  {event.event_code !== normalizeEventCode(eventCode) && <Text style={styles.notice}>Existing QR codes using the old code will remain valid.</Text>}
                </>}
                {section.id === 'schedule' && <>
                  <FieldLabel>Start Date and Time</FieldLabel>
                  <PickerField value={start} onDatePress={() => { setPickerPart('date'); setPicker('start'); }} onTimePress={() => { setPickerPart('time'); setPicker('start'); }} disabled={formDisabled} />
                  <FieldLabel style={styles.secondFieldLabel}>End Date and Time</FieldLabel>
                  <PickerField value={end} onDatePress={() => { setPickerPart('date'); setPicker('end'); }} onTimePress={() => { setPickerPart('time'); setPicker('end'); }} disabled={formDisabled} />
                  <FieldLabel style={styles.secondFieldLabel}>Late After</FieldLabel>
                  <PickerField value={lateAfter} onDatePress={() => { setPickerPart('date'); setPicker('late'); }} onTimePress={() => { setPickerPart('time'); setPicker('late'); }} disabled={formDisabled} />
                  {invalidSchedule && <Text style={styles.validation}>Check that the end is after the start and Late After falls within the event schedule.</Text>}
                  {picker && <View style={styles.datePicker}>
                    <DateTimePicker
                      value={(picker === 'start' ? start : picker === 'end' ? end : lateAfter) ?? new Date()}
                      mode={pickerPart}
                      display={Platform.OS === 'android' ? 'default' : 'spinner'}
                      onChange={applyDate}
                      accentColor={COLORS.primary}
                    />
                    {Platform.OS !== 'android' && <MotionPressable style={styles.doneButton} onPress={() => setPicker(null)}><Text style={styles.doneText}>Done</Text></MotionPressable>}
                  </View>}
                </>}
                {section.id === 'venue' && <>
                  <FieldLabel>Venue <Text style={styles.optional}>(optional)</Text></FieldLabel>
                  <AppTextInput inputStyle={styles.input} value={venue} onChangeText={setVenue} editable={!formDisabled} placeholder="Room or location" />
                  <FieldLabel style={styles.secondFieldLabel}>Description <Text style={styles.optional}>(optional)</Text></FieldLabel>
                  <AppTextInput inputStyle={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} editable={!formDisabled} placeholder="Additional event details" multiline textAlignVertical="top" />
                </>}
                {section.id === 'participants' && (
                  audienceLoadError ? <View style={styles.audienceError}>
                    <Text style={styles.validation}>Could not load the saved participant settings. Retry before editing this event.</Text>
                    <MotionPressable
                      style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
                      onPress={() => {
                        setAudienceLoadError(null);
                        setAudienceLoading(true);
                        setInitialSnapshot(null);
                        setExpandedSections((current) => ({ ...current, participants: true }));
                        setAudienceRetry((retry) => retry + 1);
                      }}
                      accessibilityRole="button"
                    >
                      <Text style={styles.retryText}>Retry</Text>
                    </MotionPressable>
                  </View> : <EventAudiencePicker
                    mode={audienceMode}
                    onModeChange={setAudienceMode}
                    scope={audienceScope}
                    onScopeChange={setAudienceScope}
                    disabled={formDisabled}
                    compact
                  />
                )}
                {section.id === 'status' && <>
                  <Text style={styles.helper}>Choose whether students can currently check in.</Text>
                  <View style={styles.statusRow}>
                    {(['open', 'closed'] as EventStatus[]).map((value) => {
                      const selected = status === value;
                      return <MotionPressable
                        key={value}
                        disabled={formDisabled}
                        onPress={() => setStatus(value)}
                        style={({ pressed }) => [styles.statusOption, selected && (value === 'open' ? styles.statusOpen : styles.statusClosed), pressed && styles.statusPressed]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, disabled: formDisabled }}
                      >
                        <Text style={[styles.statusText, selected && styles.statusSelectedText]}>{value === 'open' ? 'Open' : 'Closed'}</Text>
                      </MotionPressable>;
                    })}
                  </View>
                </>}
              </View>}
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.actionBar, { paddingBottom: Math.max(bottomInset, 10) }]}>
        {message && <Text style={[styles.message, messageTone === 'info' && styles.infoMessage]} accessibilityRole={messageTone === 'error' ? 'alert' : undefined}>{message}</Text>}
        <View style={styles.actionButtons}>
        <MotionPressable
          style={({ pressed }) => [styles.cancelButton, pressed && !saving && styles.buttonPressed, saving && styles.buttonDisabled]}
          onPress={cancel}
          disabled={saving}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </MotionPressable>
        <MotionPressable
          style={({ pressed }) => [styles.saveButton, (saving || audienceLoading || audienceLoadError) && styles.buttonDisabled, pressed && !saving && !audienceLoading && !audienceLoadError && styles.buttonPressed]}
          onPress={save}
          disabled={saving || audienceLoading || !!audienceLoadError}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving || audienceLoading || !!audienceLoadError, busy: saving }}
        >
          {saving ? <ActivityIndicator size="small" color={COLORS.textOnPrimary} /> : <Ionicons name="checkmark" size={18} color={COLORS.textOnPrimary} />}
          <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
        </MotionPressable>
        </View>
      </View>
    </View>
  );
}

function makeSnapshot(snapshot: Omit<FormSnapshot, 'start' | 'end' | 'lateAfter'> & {
  start: Date | null;
  end: Date | null;
  lateAfter: Date | null;
}): FormSnapshot {
  return {
    ...snapshot,
    start: snapshot.start?.getTime() ?? null,
    end: snapshot.end?.getTime() ?? null,
    lateAfter: snapshot.lateAfter?.getTime() ?? null,
  };
}

function FieldLabel({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

function PickerField({ value, onDatePress, onTimePress, disabled }: { value: Date | null; onDatePress: () => void; onTimePress: () => void; disabled: boolean }) {
  const date = value ?? new Date();
  return (
    <View style={[styles.picker, disabled && styles.buttonDisabled]}>
      <MotionPressable style={({ pressed }) => [styles.datePart, pressed && !disabled && styles.buttonPressed]} onPress={onDatePress} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Change date, ${value?.toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }) ?? 'not set'}`}>
        <Text style={styles.pickerText} numberOfLines={1}>{value?.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) ?? 'Not set'}</Text>
      </MotionPressable>
      <MotionPressable style={({ pressed }) => [styles.timePart, pressed && !disabled && styles.buttonPressed]} onPress={onTimePress} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Change time, ${value?.toLocaleTimeString('en-PH', { timeStyle: 'short', timeZone: 'Asia/Manila' }) ?? 'not set'}`}>
        <Text style={styles.pickerText} numberOfLines={1}>{value?.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) ?? 'Set time'}</Text>
      </MotionPressable>
      <MotionPressable style={({ pressed }) => pressed && !disabled ? styles.buttonPressed : undefined} onPress={onDatePress} disabled={disabled} accessibilityRole="button" accessibilityLabel="Open date picker" hitSlop={6}>
        <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
      </MotionPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { flex: 1, backgroundColor: COLORS.background },
  formScroll: { flex: 1 },
  formContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 18 },
  section: { marginBottom: 9, backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 11, overflow: 'hidden' },
  sectionHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  sectionHeaderPressed: { backgroundColor: COLORS.surface },
  sectionHeadingText: { flex: 1, minWidth: 0 },
  sectionTitle: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 19, fontFamily: FONTS.semiBold, fontWeight: '600' },
  sectionSummary: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, fontFamily: FONTS.regular, marginTop: 2 },
  sectionBody: { borderTopWidth: 1, borderTopColor: COLORS.border, padding: 13 },
  label: { color: COLORS.textSecondary, fontWeight: '600', fontFamily: FONTS.semiBold, fontSize: 12, marginBottom: 6 },
  secondFieldLabel: { marginTop: 14 },
  optional: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontWeight: '400' },
  input: { minHeight: 46, backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 8, color: COLORS.textPrimary, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: FONTS.regular },
  multiline: { minHeight: 96, paddingTop: 11 },
  picker: { minHeight: 46, backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  datePart: { flexShrink: 0 },
  timePart: { flex: 1, minWidth: 0 },
  pickerText: { color: COLORS.textPrimary, fontSize: 13, fontFamily: FONTS.medium },
  datePicker: { marginTop: 10, backgroundColor: COLORS.surface, borderRadius: 8, overflow: 'hidden' },
  doneButton: { alignItems: 'flex-end', paddingHorizontal: 14, paddingVertical: 10 },
  doneText: { color: COLORS.primary, fontFamily: FONTS.semiBold, fontSize: 13 },
  validation: { color: COLORS.danger, fontSize: 12, lineHeight: 17, fontFamily: FONTS.medium, marginTop: 8 },
  audienceError: { padding: 11, borderRadius: 8, borderWidth: 1, borderColor: `${COLORS.danger}44`, backgroundColor: `${COLORS.danger}0D` },
  retryButton: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: 8, marginTop: 4 },
  retryText: { color: COLORS.primary, fontSize: 13, fontFamily: FONTS.semiBold },
  notice: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, fontFamily: FONTS.regular, marginTop: 7 },
  statusRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  statusOption: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surface },
  statusOpen: { backgroundColor: `${COLORS.success}18`, borderColor: `${COLORS.success}66` },
  statusClosed: { backgroundColor: COLORS.primaryButtonStart, borderColor: COLORS.primaryButtonStart },
  statusText: { color: COLORS.textSecondary, fontWeight: '600', fontFamily: FONTS.semiBold, fontSize: 13 },
  statusSelectedText: { color: COLORS.textOnPrimary },
  statusPressed: { opacity: 0.76 },
  helper: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, fontFamily: FONTS.regular },
  message: { color: COLORS.danger, marginBottom: 8, lineHeight: 17, fontSize: 12, fontFamily: FONTS.medium },
  infoMessage: { color: COLORS.textSecondary },
  actionBar: { paddingHorizontal: 20, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.background },
  actionButtons: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cancelButton: { minHeight: 46, minWidth: 92, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, paddingHorizontal: 14 },
  cancelText: { color: COLORS.textSecondary, fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600' },
  saveButton: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 8, backgroundColor: COLORS.primaryButtonStart, paddingHorizontal: 14 },
  saveText: { color: COLORS.textOnPrimary, fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600' },
  buttonPressed: { opacity: 0.78 },
  buttonDisabled: { opacity: 0.52 },
});
