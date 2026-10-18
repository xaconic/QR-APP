import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MotionPressable from '@/components/MotionPressable';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { animateLayoutChange } from '@/lib/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from '@/components/AppButton';
import EventAttendanceManager from '@/components/EventAttendanceManager';
import StatusBadge from '@/components/StatusBadge';
import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { useAuth } from '@/lib/auth';
import { createEvent, deleteEvent, getEventsByTeacher, setEventStatus, type CloudEvent } from '@/lib/events';
import { getProfileWithError, type Role } from '@/lib/profiles';
import { getAcademicSections, getCourses, getYearLevels, getTeacherAuthorizedEvents, type AcademicSection, type Course, type YearLevel } from '@/lib/academic';

function toLocalISO(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
  );
}

function formatDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('month')} ${get('day')}, ${get('year')} at ${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
}

const QUICK_END_OPTIONS = [
  { label: '+30 min', ms: 30 * 60 * 1000 },
  { label: '+1 hour', ms: 60 * 60 * 1000 },
  { label: '+2 hours', ms: 2 * 60 * 60 * 1000 },
];

type EditTarget = 'start' | 'end';
type MyEventsSort = 'date' | 'name';

export default function TeacherScreen() {
  const { user, session } = useAuth();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [title, setTitle] = useState('');
  const [eventId, setEventId] = useState('');
  const [startDate, setStartDate] = useState(() => new Date());
  const [endDate, setEndDate] = useState(
    () => new Date(Date.now() + 60 * 60 * 1000)
  );
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editingPart, setEditingPart] = useState<'date' | 'time'>('date');
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [role, setRole] = useState<Role | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [events, setEvents] = useState<CloudEvent[]>([]);
  const [myEventsSort, setMyEventsSort] = useState<MyEventsSort>('date');
  const [myEventsExpanded, setMyEventsExpanded] = useState(true);
  const myEventsChevron = useRef(new Animated.Value(1)).current;
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [audienceCourses, setAudienceCourses] = useState<Course[]>([]);
  const [audienceYearLevels, setAudienceYearLevels] = useState<YearLevel[]>([]);
  const [audienceSections, setAudienceSections] = useState<AcademicSection[]>([]);
  const [audienceCourseIds, setAudienceCourseIds] = useState<string[]>([]);
  const [audienceYearLevelIds, setAudienceYearLevelIds] = useState<string[]>([]);
  const [audienceSectionIds, setAudienceSectionIds] = useState<string[]>([]);
  const [audienceLoading, setAudienceLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setAudienceLoading(true);
    Promise.all([getCourses(), getYearLevels()]).then(([courses, years]) => {
      if (!active) return;
      setAudienceCourses(courses);
      setAudienceYearLevels(years);
    }).finally(() => { if (active) setAudienceLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getAcademicSections()
      .then((sections) => { if (active) setAudienceSections(sections); });
    return () => { active = false; };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      if (!user) {
        setRole(null);
        setRoleLoading(false);
        return () => {
          active = false;
        };
      }

      setRoleError(null);
      getProfileWithError(user.id, session?.access_token)
        .then(async ({ profile, error }) => {
          if (!active) return;
          if (error) throw new Error(error);
          if (!profile) throw new Error('No Acadence profile was found for this account.');
          setRole(profile.role);
          if (profile.role === 'teacher' && profile.is_active) setEvents((await getTeacherAuthorizedEvents(user.id)) as CloudEvent[]);
          setRoleLoading(false);
        })
        .catch((error: unknown) => {
          if (!active) return;
          console.error('Unable to verify the teacher account profile.', error);
          setRole(null);
          setRoleError(error instanceof Error ? error.message : 'Unable to verify your account profile.');
          setRoleLoading(false);
        });

      return () => {
        active = false;
      };
    }, [session?.access_token, user])
  );

  const isAndroid = Platform.OS === 'android';
  const audienceSectionOptions = audienceSections
    .filter((section) => audienceCourseIds.length > 0 && audienceYearLevelIds.length > 0)
    .filter((section) => audienceCourseIds.includes(section.course_id) && audienceYearLevelIds.includes(section.year_level_id))
    .sort((left, right) => {
      const leftYear = audienceYearLevels.find((year) => year.id === left.year_level_id)?.sort_order ?? 0;
      const rightYear = audienceYearLevels.find((year) => year.id === right.year_level_id)?.sort_order ?? 0;
      if (leftYear !== rightYear) return leftYear - rightYear;
      const leftCourse = audienceCourses.find((course) => course.id === left.course_id)?.code ?? '';
      const rightCourse = audienceCourses.find((course) => course.id === right.course_id)?.code ?? '';
      return leftCourse.localeCompare(rightCourse) || left.section_name.localeCompare(right.section_name);
    });
  const sortedEvents = useMemo(() => [...events].sort((left, right) => {
    if (myEventsSort === 'name') return left.title.localeCompare(right.title);
    return new Date(right.start_time ?? right.created_at).getTime()
      - new Date(left.start_time ?? left.created_at).getTime();
  }), [events, myEventsSort]);

  if (roleLoading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="small" color={COLORS.primary} />
        <Text style={styles.emptyTitle}>Checking your account...</Text>
      </View>
    );
  }

  if (role !== 'teacher') {
    return (
      <View style={styles.centerState}>
        <Ionicons name="lock-closed-outline" size={40} color={COLORS.primary} />
        <Text style={styles.emptyTitle}>{roleError ? 'Account unavailable' : 'Teachers Only'}</Text>
        <Text style={styles.emptyText}>{roleError ?? 'Only teacher accounts can create events.'}</Text>
      </View>
    );
  }

  const openPicker = (target: EditTarget) => {
    setMessage(null);
    setMessageTone('info');
    setEditTarget(target);
    setEditingPart('date');
  };

  const onPickerChange = (
    event: DateTimePickerEvent,
    selected?: Date
  ) => {
    if (!editTarget) return;
    if (event.type === 'dismissed' || !selected) {
      setEditTarget(null);
      setEditingPart('date');
      return;
    }

    const current = editTarget === 'start' ? startDate : endDate;
    const next = new Date(current);
    next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);

    if (editTarget === 'start') setStartDate(next);
    else setEndDate(next);

    if (isAndroid && editingPart === 'date') {
      setEditingPart('time');
    } else {
      setEditTarget(null);
      setEditingPart('date');
    }
  };

  const handleQuickEnd = (ms: number) => {
    setMessage(null);
    setMessageTone('info');
    setEndDate(new Date(startDate.getTime() + ms));
  };

  const handleCreateEvent = () => {
    const event = {
      eventId: eventId.trim(),
      title: title.trim(),
      start: toLocalISO(startDate),
      end: toLocalISO(endDate),
    };

    if (!event.eventId || !event.title) {
      setMessageTone('error');
      setMessage('Event title and code are required.');
      return;
    }

    if (endDate.getTime() <= startDate.getTime()) {
      setMessageTone('error');
      setMessage('End time must be after start time.');
      return;
    }

    const audience = audienceCourseIds.length || audienceYearLevelIds.length || audienceSectionIds.length
      ? { courseIds: audienceCourseIds, yearLevelIds: audienceYearLevelIds, sectionIds: audienceSectionIds }
      : undefined;

    createEvent({ ...event, audience }).then(({ error }) => {
      if (error) {
        setMessageTone('error');
        setMessage(`Could not save the event: ${error}`);
        return;
      }

      setMessage('Event saved! Scan the QR with the Scan tab to test it.');
      setMessageTone('success');
      if (user) getEventsByTeacher(user.id).then(setEvents);
    });
  };

  const handleStatusChange = async (event: CloudEvent) => {
    if (statusLoading || deletingEventId) return;
    const nextStatus = event.status === 'open' ? 'closed' : 'open';
    setMessage(null);
    setMessageTone('info');
    setStatusLoading(event.id);
    try {
      const result = await setEventStatus(event.id, nextStatus);
      if (result.error) {
        setMessageTone('error');
        setMessage(result.error);
        return;
      }
      setEvents((current) => current.map((item) => item.id === event.id ? { ...item, status: nextStatus } : item));
      setMessageTone('success');
      setMessage(nextStatus === 'closed' ? 'Event closed. New scans will be rejected.' : 'Event reopened.');
    } catch (error: unknown) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : 'Could not update the event status. Please try again.');
    } finally {
      setStatusLoading(null);
    }
  };

  const handleDeleteEvent = (event: CloudEvent) => {
    if (statusLoading || deletingEventId) return;
    const removeEvent = async () => {
      setMessage(null);
      setMessageTone('info');
      setDeletingEventId(event.id);
      try {
        const result = await deleteEvent(event.id);
        if (result.error) {
          setMessageTone('error');
          setMessage(result.error);
          return;
        }
        setEvents((current) => current.filter((item) => item.id !== event.id));
        setMessageTone('success');
        setMessage('Event deleted.');
      } catch (error: unknown) {
        setMessageTone('error');
        setMessage(error instanceof Error ? error.message : 'Could not delete the event. Please try again.');
      } finally {
        setDeletingEventId(null);
      }
    };

    const confirmation = `Delete “${event.title}”? This will also remove its attendance records and cannot be undone.`;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Delete event?\n\n${confirmation}`)) void removeEvent();
      return;
    }

    Alert.alert(
      'Delete event?',
      confirmation,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void removeEvent(); } },
      ],
    );
  };

  const toggleMyEvents = () => {
    const nextExpanded = !myEventsExpanded;
    animateLayoutChange(reduceMotion);
    myEventsChevron.stopAnimation();
    if (reduceMotion === false) {
      Animated.timing(myEventsChevron, {
        toValue: nextExpanded ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    } else {
      myEventsChevron.setValue(nextExpanded ? 1 : 0);
    }
    setMyEventsExpanded(nextExpanded);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 24 + insets.top }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Teacher Events</Text>
      <Text style={styles.subtitle}>Manage your events and attendance from here. Use the centered + button to create an event QR.</Text>

      {message && (
        <View style={[
          styles.feedback,
          messageTone === 'success' && styles.feedbackSuccess,
          messageTone === 'error' && styles.feedbackError,
        ]}>
          <Ionicons
            name={messageTone === 'error' ? 'alert-circle-outline' : messageTone === 'success' ? 'checkmark-circle-outline' : 'information-circle-outline'}
            size={17}
            color={messageTone === 'error' ? COLORS.danger : messageTone === 'success' ? COLORS.success : COLORS.primary}
          />
          <Text style={[
            styles.feedbackText,
            messageTone === 'success' && styles.feedbackSuccessText,
            messageTone === 'error' && styles.feedbackErrorText,
          ]} accessibilityLiveRegion="polite">{message}</Text>
        </View>
      )}

      <EventAttendanceManager events={events} />

      {editTarget && (
        <View style={styles.pickerContainer}>
          <DateTimePicker
            value={editTarget === 'start' ? startDate : endDate}
            mode={isAndroid ? editingPart : 'datetime'}
            display={isAndroid ? 'default' : 'spinner'}
            onChange={onPickerChange}
            accentColor={COLORS.primary}
            textColor={COLORS.textPrimary}
            themeVariant="light"
          />
        </View>
      )}

      <View style={styles.myEventsContainer}>
        <MotionPressable
          style={({ pressed }) => [styles.myEventsHeader, pressed && styles.myEventsHeaderPressed]}
          onPress={toggleMyEvents}
          accessibilityRole="button"
          accessibilityState={{ expanded: myEventsExpanded }}
          accessibilityLabel={`My Events, ${events.length} ${events.length === 1 ? 'event' : 'events'}`}
        >
          <View style={styles.myEventsHeading}>
            <Text style={styles.sectionTitle}>My Events</Text>
            <Text style={styles.eventCount}>{events.length}</Text>
          </View>
          <View style={styles.chevronCircle}>
            <Animated.View style={{
              transform: [{
                rotate: myEventsChevron.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '180deg'],
                }),
              }],
            }}>
              <Ionicons name="chevron-down" size={16} color={COLORS.primary} />
            </Animated.View>
          </View>
        </MotionPressable>
        {myEventsExpanded ? (
          <View style={styles.myEventsContent}>
            {events.length > 0 && <View style={styles.eventsSortRow}>
              <Text style={styles.eventsSortLabel}>Sort by</Text>
              <View style={styles.eventsSortOptions} accessibilityRole="radiogroup">
                {(['date', 'name'] as const).map((option) => {
                  const selected = myEventsSort === option;
                  return <MotionPressable
                    key={option}
                    style={({ pressed }) => [
                      styles.eventsSortOption,
                      selected && styles.eventsSortOptionSelected,
                      pressed && styles.eventsSortOptionPressed,
                    ]}
                    onPress={() => setMyEventsSort(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Sort my events by ${option === 'date' ? 'date, newest first' : 'name, A to Z'}`}
                  >
                    <Text style={[styles.eventsSortOptionText, selected && styles.eventsSortOptionTextSelected]}>
                      {option === 'date' ? 'Date' : 'Name'}
                    </Text>
                  </MotionPressable>;
                })}
              </View>
            </View>}
            {sortedEvents.length === 0 ? (
              <View style={styles.eventsEmpty}>
                <Ionicons name="calendar-outline" size={22} color={COLORS.textMuted} />
                <Text style={styles.eventsEmptyTitle}>No events yet</Text>
                <Text style={styles.eventsEmptyText}>Create an event with the + button to start taking attendance.</Text>
              </View>
            ) : sortedEvents.map((event) => {
              const busy = statusLoading !== null || deletingEventId !== null;
              return <View style={styles.eventCard} key={event.id}>
                <View style={styles.eventHeader}>
                  <View style={styles.eventInfo}>
                    <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
                    <Text style={styles.eventMeta} numberOfLines={1}>{event.event_code}</Text>
                  </View>
                  <StatusBadge status={event.status} />
                </View>
                <View style={styles.eventActions}>
                  <MotionPressable
                    style={({ pressed }) => [styles.actionButton, styles.editButton, pressed && styles.actionPressed, busy && styles.actionDisabled]}
                    disabled={busy}
                    onPress={() => router.push({ pathname: '/event-edit', params: { eventId: event.id } })}
                    accessibilityRole="button"
                  >
                    <Text style={styles.editButtonText}>Edit</Text>
                  </MotionPressable>
                  <MotionPressable
                    style={({ pressed }) => [
                      styles.actionButton,
                      event.status === 'open' ? styles.closeEventButton : styles.reopenButton,
                      pressed && styles.actionPressed,
                      busy && styles.actionDisabled,
                    ]}
                    disabled={busy}
                    onPress={() => handleStatusChange(event)}
                    accessibilityRole="button"
                  >
                    {statusLoading === event.id ? <ActivityIndicator size="small" color={event.status === 'open' ? COLORS.textSecondary : COLORS.primary} /> : (
                      <Text style={[styles.statusButtonText, event.status === 'open' && styles.closeEventButtonText]}>{event.status === 'open' ? 'Close' : 'Reopen'}</Text>
                    )}
                  </MotionPressable>
                  {event.created_by === user?.id && <MotionPressable
                    style={({ pressed }) => [styles.actionButton, styles.deleteButton, pressed && styles.actionPressed, busy && styles.actionDisabled]}
                    disabled={busy}
                    onPress={() => handleDeleteEvent(event)}
                    accessibilityRole="button"
                  >
                    {deletingEventId === event.id ? <ActivityIndicator size="small" color={COLORS.danger} /> : <Text style={styles.deleteButtonText}>Delete</Text>}
                  </MotionPressable>}
                </View>
              </View>;
            })}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

type PickerFieldProps = {
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

function PickerField({ value, icon, onPress }: PickerFieldProps) {
  return (
    <MotionPressable
      style={({ pressed }) => [styles.pickerField, pressed && styles.pickerFieldPressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={COLORS.primary} />
      <Text style={styles.pickerValue}>{value}</Text>
      <Ionicons name="calendar-outline" size={18} color={COLORS.textSecondary} />
    </MotionPressable>
  );
}

function AudienceOption({ label, selected, onPress, wide = false }: { label: string; selected: boolean; onPress: () => void; wide?: boolean }) {
  return (
    <MotionPressable style={[styles.audienceOption, wide && styles.audienceOptionWide, selected && styles.audienceOptionSelected]} onPress={onPress}>
      <Text style={[styles.audienceOptionText, selected && styles.audienceOptionTextSelected]}>{label}</Text>
    </MotionPressable>
  );
}

function toggleAudienceId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: COLORS.card,
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.textPrimary,
    fontFamily: FONTS.regular,
  },
  pickerField: {
    backgroundColor: COLORS.surface,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickerFieldPressed: {
    backgroundColor: COLORS.surface,
  },
  pickerValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    marginHorizontal: 10,
  },
  chipRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  chip: {
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginRight: 8,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FONTS.semiBold,
    color: COLORS.primary,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontFamily: FONTS.regular,
    marginTop: 6,
  },
  audienceHint: { fontSize: 12, color: COLORS.textSecondary, fontFamily: FONTS.regular, marginBottom: 6 },
  audienceBox: { backgroundColor: COLORS.card, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, padding: 10, marginTop: 4 },
  audienceSubLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', fontFamily: FONTS.bold, marginTop: 10, marginBottom: 4 },
  audienceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  audienceOption: { flexGrow: 1, maxWidth: '48%', borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: COLORS.surface, alignItems: 'center' },
  audienceOptionWide: { maxWidth: '100%', width: '100%' },
  audienceOptionSelected: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}22` },
  audienceOptionText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', fontFamily: FONTS.semiBold, textAlign: 'center' },
  audienceOptionTextSelected: { color: COLORS.primary },
  audienceSelectionSummary: { color: COLORS.primary, fontSize: 12, fontWeight: '600', fontFamily: FONTS.semiBold, marginTop: 8 },
  audienceEmpty: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, marginTop: 8 },
  pickerContainer: {
    marginTop: 12,
    alignItems: 'center',
  },
  centerState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'transparent',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    marginTop: 12,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontFamily: FONTS.regular,
    marginTop: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: COLORS.primary,
    fontFamily: FONTS.medium,
    textAlign: 'center',
    marginTop: 12,
  },
  resultCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    alignItems: 'center',
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: 12,
  },
  qrBox: {
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  payloadText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontFamily: FONTS.regular,
    textAlign: 'center',
    lineHeight: 16,
  },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: `${COLORS.primary}12`, borderWidth: 1, borderColor: `${COLORS.primary}33`, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 9, marginBottom: 12 },
  feedbackSuccess: { backgroundColor: `${COLORS.success}12`, borderColor: `${COLORS.success}44` },
  feedbackSuccessText: { color: COLORS.success },
  feedbackError: { backgroundColor: `${COLORS.danger}12`, borderColor: `${COLORS.danger}44` },
  feedbackText: { flex: 1, color: COLORS.primary, fontSize: 12, lineHeight: 17, fontFamily: FONTS.medium },
  feedbackErrorText: { color: COLORS.danger },
  myEventsContainer: { marginTop: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, overflow: 'hidden' },
  myEventsHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  myEventsHeaderPressed: { backgroundColor: COLORS.surface },
  myEventsHeading: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 12 },
  chevronCircle: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  myEventsContent: { borderTopWidth: 1, borderTopColor: COLORS.border, padding: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', fontFamily: FONTS.bold, color: COLORS.textPrimary },
  eventCount: { minWidth: 22, height: 22, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', borderRadius: 11, paddingHorizontal: 6, backgroundColor: COLORS.surface, color: COLORS.textSecondary, fontSize: 11, fontFamily: FONTS.semiBold },
  eventsSortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  eventsSortLabel: { color: COLORS.textMuted, fontSize: 12, fontFamily: FONTS.medium },
  eventsSortOptions: { width: 132, maxWidth: '58%', minHeight: 38, flexDirection: 'row', alignItems: 'center', padding: 3, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, backgroundColor: `${COLORS.background}99` },
  eventsSortOption: { flex: 1, minWidth: 0, minHeight: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 7, paddingHorizontal: 8 },
  eventsSortOptionSelected: { backgroundColor: `${COLORS.primary}24`, borderWidth: 1, borderColor: `${COLORS.primary}88` },
  eventsSortOptionPressed: { opacity: 0.72 },
  eventsSortOptionText: { color: COLORS.textMuted, fontSize: 12, fontFamily: FONTS.medium },
  eventsSortOptionTextSelected: { color: COLORS.primaryLight, fontFamily: FONTS.semiBold },
  eventCard: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 9 },
  eventHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  eventInfo: { flex: 1, minWidth: 0, gap: 3 },
  eventTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600', fontFamily: FONTS.semiBold, color: COLORS.textPrimary },
  eventMeta: { fontSize: 12, lineHeight: 17, color: COLORS.textSecondary, fontFamily: FONTS.regular },
  eventActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: COLORS.border },
  actionButton: { minHeight: 40, minWidth: 72, flexGrow: 1, flexBasis: 0, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  actionPressed: { opacity: 0.72 },
  actionDisabled: { opacity: 0.5 },
  editButton: { borderColor: COLORS.border, backgroundColor: COLORS.surface },
  editButtonText: { color: COLORS.textPrimary, fontWeight: '600', fontFamily: FONTS.semiBold, fontSize: 13 },
  closeEventButton: { borderColor: COLORS.border, backgroundColor: 'transparent' },
  closeEventButtonText: { color: COLORS.textSecondary },
  reopenButton: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}18` },
  statusButtonText: { color: COLORS.primary, fontWeight: '600', fontFamily: FONTS.semiBold, fontSize: 13 },
  deleteButton: { borderColor: `${COLORS.danger}55`, backgroundColor: `${COLORS.danger}0D` },
  deleteButtonText: { color: COLORS.danger, fontWeight: '600', fontFamily: FONTS.semiBold, fontSize: 13 },
  eventsEmpty: { alignItems: 'center', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 20 },
  eventsEmptyTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600', fontFamily: FONTS.semiBold, marginTop: 8 },
  eventsEmptyText: { maxWidth: 260, color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, fontFamily: FONTS.regular, textAlign: 'center', marginTop: 4 },
});
