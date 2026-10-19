import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ActivityIndicator, Alert, Animated, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MotionPressable from '@/components/MotionPressable';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { animateLayoutChange } from '@/lib/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import Ionicons from '@expo/vector-icons/Ionicons';
import EventAttendanceManager from '@/components/EventAttendanceManager';
import EventAudiencePicker from '@/components/EventAudiencePicker';
import AcademicManagement, { AcademicPicker } from '@/components/AcademicManagement';
import EventQRCode from '@/components/EventQRCode';
import StatusBadge from '@/components/StatusBadge';

import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { MOTION } from '@/constants/motion';
import { useAuth } from '@/lib/auth';
import { subscribeToSupabaseDataChanges } from '@/lib/supabaseRealtime';
import { approveTeacher, deleteAdminUser, deactivateAdminUser, getAdminDashboardData, reactivateAdminUser, updateAdminUser, type AdminDashboardData } from '@/lib/admin';
import { getProfileWithError } from '@/lib/profiles';
import { archiveEvent, createEvent, deleteEvent, setEventStatus, type CloudEvent } from '@/lib/events';
import { assignStudent, formatCourseLabel, type EventAudienceScope } from '@/lib/academic';

type AdminDropdownKey =
  | 'academic-setup'
  | 'academic-active-courses'
  | 'academic-active-sections'
  | 'create-event'
  | 'event-attendance'
  | 'registered-users'
  | 'events'
  | 'attendance-summary';
type DashboardSummaryTarget = 'registered-users' | 'events' | 'attendance-summary';

const DEFAULT_ADMIN_DROPDOWN_STATE: Record<AdminDropdownKey, boolean> = {
  'academic-setup': false,
  'academic-active-courses': false,
  'academic-active-sections': false,
  'create-event': false,
  'event-attendance': false,
  'registered-users': false,
  'events': false,
  'attendance-summary': false,
};

function getAdminSectionStorageKey(userId: string) {
  return `admin-dashboard-sections-${userId}`;
}

function getEventCreatorLabel(users: AdminDashboardData['users'], createdBy: string | null) {
  const creator = createdBy ? users.find((item) => item.id === createdBy) : undefined;
  return creator?.full_name || creator?.email || 'Unknown user';
}

function formatAdminTime(value: Date) {
  return value.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function parseAdminTime(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? null : Number(match[2]);
  if ((minutes !== null && minutes > 59) || (match[3] ? hours < 1 || hours > 12 : hours > 23)) return null;

  return {
    hours: match[3]
      ? (hours % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0)
      : hours,
    minutes,
  };
}

function applyAdminTime(value: Date, time: ReturnType<typeof parseAdminTime>) {
  if (!time) return value;
  const next = new Date(value);
  next.setHours(time.hours, time.minutes ?? value.getMinutes(), 0, 0);
  return next;
}

async function getAdminDropdownState(userId: string) {
  const key = getAdminSectionStorageKey(userId);
  const stored = Platform.OS === 'web'
    ? typeof window !== 'undefined' ? window.localStorage.getItem(key) : null
    : await SecureStore.getItemAsync(key);
  if (!stored) return DEFAULT_ADMIN_DROPDOWN_STATE;

  const parsed: unknown = JSON.parse(stored);
  if (!parsed || typeof parsed !== 'object') return DEFAULT_ADMIN_DROPDOWN_STATE;

  const values = parsed as Partial<Record<AdminDropdownKey, unknown>>;
  return Object.fromEntries(
    Object.entries(DEFAULT_ADMIN_DROPDOWN_STATE).map(([dropdown, defaultOpen]) => [
      dropdown,
      typeof values[dropdown as AdminDropdownKey] === 'boolean'
        ? values[dropdown as AdminDropdownKey]
        : defaultOpen,
    ]),
  ) as Record<AdminDropdownKey, boolean>;
}

async function saveAdminDropdownState(userId: string, state: Record<AdminDropdownKey, boolean>) {
  const key = getAdminSectionStorageKey(userId);
  const value = JSON.stringify(state);
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

function confirmAdminAction(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

export default function AdminScreen() {
  const { user, session } = useAuth();
  const insets = useSafeAreaInsets();
  const dashboardScrollRef = useRef<ScrollView>(null);
  const dashboardSectionPositions = useRef<Partial<Record<DashboardSummaryTarget, number>>>({});
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [adminDropdownsOpen, setAdminDropdownsOpen] = useState<Record<AdminDropdownKey, boolean>>(DEFAULT_ADMIN_DROPDOWN_STATE);
  const [sectionsLoadedForUserId, setSectionsLoadedForUserId] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardRetry, setDashboardRetry] = useState(0);
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingAcademicUserId, setEditingAcademicUserId] = useState<string | null>(null);
  const [academicCourseId, setAcademicCourseId] = useState('');
  const [academicYearLevelId, setAcademicYearLevelId] = useState('');
  const [academicSectionId, setAcademicSectionId] = useState('');
  const [adminActionLoading, setAdminActionLoading] = useState<string | null>(null);
  const [newEventCode, setNewEventCode] = useState('');
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventVenue, setNewEventVenue] = useState('');
  const [newEventDescription, setNewEventDescription] = useState('');
  const [newEventStart, setNewEventStart] = useState(() => new Date());
  const [newEventEnd, setNewEventEnd] = useState(() => new Date(Date.now() + 60 * 60 * 1000));
  const [newEventLateAfter, setNewEventLateAfter] = useState(() => new Date(Date.now() + 15 * 60 * 1000));
  const [newEventPicker, setNewEventPicker] = useState<'start' | 'end' | 'late' | null>(null);
  const [qrEventId, setQrEventId] = useState<string | null>(null);
  const [newEventAudienceMode, setNewEventAudienceMode] = useState<'all' | 'groups'>('all');
  const [newEventAudience, setNewEventAudience] = useState<EventAudienceScope>({ courseIds: [], yearLevelIds: [], sectionIds: [] });
  const [createdAdminEvent, setCreatedAdminEvent] = useState<CloudEvent | null>(null);

  const openSummarySection = (section: DashboardSummaryTarget) => {
    setAdminDropdownsOpen((current) => ({ ...current, [section]: true }));
    const position = dashboardSectionPositions.current[section];
    if (position !== undefined) dashboardScrollRef.current?.scrollTo({ y: position, animated: true });
  };

  useEffect(() => {
    const currentUserId = user?.id;
    if (!currentUserId) {
      setAdminDropdownsOpen(DEFAULT_ADMIN_DROPDOWN_STATE);
      setSectionsLoadedForUserId(null);
      return;
    }
    const userId: string = currentUserId;

    let cancelled = false;

    async function loadSectionState() {
      try {
        const storedState = await getAdminDropdownState(userId);
        if (cancelled) return;
        setAdminDropdownsOpen(storedState);
      } catch (error) {
        console.error('Unable to restore administrator dashboard dropdown state.', error);
        if (!cancelled) setAdminDropdownsOpen(DEFAULT_ADMIN_DROPDOWN_STATE);
      } finally {
        if (!cancelled) setSectionsLoadedForUserId(userId);
      }
    }

    loadSectionState();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || sectionsLoadedForUserId !== user.id) return;

    saveAdminDropdownState(user.id, adminDropdownsOpen).catch((error: unknown) => {
      console.error('Unable to save administrator dashboard dropdown state.', error);
    });
  }, [adminDropdownsOpen, sectionsLoadedForUserId, user?.id]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    async function loadDashboard() {
      setDashboardLoading(true);
      if (!user) {
        setAuthorized(false);
        setDashboardLoading(false);
        return;
      }

      let profileVerified = false;
      try {
        setError(null);
        const { profile, error: profileError } = await getProfileWithError(user.id, session?.access_token);
        if (cancelled) return;
        if (profileError) throw new Error(`Unable to verify administrator access: ${profileError}`);

        if (profile?.role !== 'admin' || profile.is_active === false) {
          setAuthorized(false);
          setDashboard(null);
          return;
        }

        profileVerified = true;
        setAuthorized(true);
        const result = await getAdminDashboardData(session);
        if (cancelled) return;

        if (result.error) {
          setError(result.error);
          setMessage(`Dashboard refresh failed: ${result.error}`);
          return;
        }
        if (!result.data) throw new Error('The administrator dashboard returned no data.');
        setDashboard(result.data);
      } catch (error) {
        if (cancelled) return;
        console.error('Unable to load administrator dashboard.', error);
        setAuthorized(profileVerified);
        setDashboard(null);
        setError(error instanceof Error ? error.message : 'Unable to load administrator data. Please try again.');
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    }

    void loadDashboard();
    const unsubscribe = subscribeToSupabaseDataChanges(() => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { void loadDashboard(); }, 200);
    });
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [dashboardRetry, session, user]));

  const changeStatus = async (event: AdminDashboardData['events'][number]) => {
    const nextStatus = event.status === 'open' ? 'closed' : 'open';
    setStatusLoading(event.id);
    setMessage(null);
    const result = await setEventStatus(event.id, nextStatus);
    setStatusLoading(null);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setDashboard((current) => current ? {
      ...current,
      events: current.events.map((item) => item.id === event.id ? { ...item, status: nextStatus } : item),
    } : current);
    setMessage(nextStatus === 'closed' ? 'Event closed.' : 'Event reopened.');
  };

  const saveUser = async (userId: string) => {
    setAdminActionLoading(userId);
    const result = await updateAdminUser(userId, editingName);
    setAdminActionLoading(null);
    if (result.error) { setMessage(result.error); return; }
    setDashboard((current) => current ? { ...current, users: current.users.map((item) => item.id === userId ? { ...item, full_name: editingName.trim() || null } : item) } : current);
    setEditingUserId(null);
    setMessage('User details updated.');
  };

  const startEditingAcademicGroup = (item: AdminDashboardData['users'][number]) => {
    setEditingUserId(null);
    setEditingAcademicUserId(item.id);
    setAcademicCourseId(item.course_id ?? '');
    setAcademicYearLevelId(item.year_level_id ?? '');
    setAcademicSectionId(item.section_id ?? '');
  };

  const saveStudentAcademicGroup = async (studentId: string) => {
    const section = dashboard?.sections.find((item) => item.id === academicSectionId);
    if (!academicCourseId || !academicYearLevelId || !section
      || section.course_id !== academicCourseId
      || section.year_level_id !== academicYearLevelId) {
      setMessage('Choose a valid course, year level, and block.');
      return;
    }

    setAdminActionLoading(`academic:${studentId}`);
    setMessage(null);
    const result = await assignStudent(studentId, academicCourseId, academicYearLevelId, academicSectionId, section.academic_year);
    if (result.error) {
      setAdminActionLoading(null);
      setMessage(result.error);
      return;
    }

    setEditingAcademicUserId(null);
    const refreshed = await getAdminDashboardData(session);
    setAdminActionLoading(null);
    if (refreshed.error || !refreshed.data) {
      setMessage(`Academic group updated, but the dashboard could not refresh: ${refreshed.error ?? 'Please reload.'}`);
      return;
    }
    setDashboard(refreshed.data);
    setMessage('Student academic group updated.');
  };

  const deactivateUser = (item: AdminDashboardData['users'][number]) => {
    confirmAdminAction('Deactivate user?', `${item.email} will no longer be active in Acadence.`, 'Deactivate', () => {
      void (async () => {
        setAdminActionLoading(item.id);
        const result = await deactivateAdminUser(item.id);
        setAdminActionLoading(null);
        if (result.error) { setMessage(result.error); return; }
        setDashboard((current) => current ? { ...current, users: current.users.map((user) => user.id === item.id ? { ...user, is_active: false, deactivated_at: new Date().toISOString() } : user) } : current);
        setMessage('User deactivated.');
      })();
    });
  };

  const approveTeacherAccount = (item: AdminDashboardData['users'][number]) => {
    confirmAdminAction('Approve teacher account?', `${item.email} will receive teacher event-management access.`, 'Approve teacher', () => {
      void (async () => {
        setAdminActionLoading(item.id);
        const result = await approveTeacher(item.id, session);
        setAdminActionLoading(null);
        if (result.error) { setMessage(result.error); return; }
        setDashboard((current) => current ? {
          ...current,
          users: current.users.map((user) => user.id === item.id ? {
            ...user,
            role: 'teacher',
            teacher_requested_at: null,
            academic_level_id: null,
            course_id: null,
            year_level_id: null,
            section_id: null,
            course_code: null,
            course_name: null,
            year_level_name: null,
            section_name: null,
            section_code: null,
          } : user),
        } : current);
        setMessage('Teacher account approved.');
      })();
    });
  };

  const reactivateUser = (item: AdminDashboardData['users'][number]) => {
    confirmAdminAction('Reactivate user?', `${item.email} will regain access to Acadence.`, 'Reactivate', () => {
      void (async () => {
        setAdminActionLoading(item.id);
        const result = await reactivateAdminUser(item.id);
        setAdminActionLoading(null);
        if (result.error) { setMessage(result.error); return; }
        setDashboard((current) => current ? {
          ...current,
          users: current.users.map((user) => user.id === item.id
            ? { ...user, is_active: true, deactivated_at: null }
            : user),
        } : current);
        setMessage('User reactivated.');
      })();
    });
  };

  const permanentlyDeleteUser = (item: AdminDashboardData['users'][number]) => {
    confirmAdminAction(
      'Delete user permanently?',
      `Delete ${item.full_name || item.email}? This permanently removes their account, profile, associated attendance, and student academic assignments. Events they created are preserved without an owner. This cannot be undone.`,
      'Delete permanently',
      () => {
        void (async () => {
            setAdminActionLoading(item.id);
            setMessage(null);
            const result = await deleteAdminUser(item.id, session);
            setAdminActionLoading(null);
            if (result.error) {
              setMessage(result.error);
              return;
            }

            setDashboard((current) => current ? {
              ...current,
              users: current.users.filter((user) => user.id !== item.id),
            } : current);
            setEditingAcademicUserId(null);
            const refreshed = await getAdminDashboardData(session);
            if (refreshed.data) {
              setDashboard(refreshed.data);
              setMessage('User and related records permanently deleted.');
            } else {
              setMessage(`User permanently deleted, but the dashboard could not refresh: ${refreshed.error ?? 'Please reload.'}`);
            }
        })();
      },
    );
  };

  const archive = (event: AdminDashboardData['events'][number]) => {
    confirmAdminAction('Archive event?', 'Attendance records will be preserved and the event will be hidden from active event management.', 'Archive', () => {
      void (async () => {
        setAdminActionLoading(event.id);
        const result = await archiveEvent(event.id);
        setAdminActionLoading(null);
        if (result.error) { setMessage(result.error); return; }
        setDashboard((current) => current ? { ...current, events: current.events.map((item) => item.id === event.id ? { ...item, archived_at: new Date().toISOString(), status: 'closed' } : item) } : current);
        setMessage('Event archived. Attendance history was preserved.');
      })();
    });
  };

  const removeEvent = (event: AdminDashboardData['events'][number]) => {
    confirmAdminAction(
      'Delete event permanently?',
      `Delete “${event.title}”? This permanently removes the event, its participant groups, QR aliases, and attendance records. Use Archive if you need to preserve attendance history.`,
      'Delete permanently',
      () => {
        void (async () => {
          setAdminActionLoading(event.id);
          const result = await deleteEvent(event.id, session);
          setAdminActionLoading(null);
          if (result.error) { setMessage(result.error); return; }
          setDashboard((current) => current ? {
            ...current,
            events: current.events.filter((item) => item.id !== event.id),
            attendance: current.attendance.filter((item) => item.eventId !== event.id),
          } : current);
          if (createdAdminEvent?.id === event.id) setCreatedAdminEvent(null);
          setMessage('Event permanently deleted.');
        })();
      },
    );
  };

  const createAdminEvent = async () => {
    setMessage(null);
    if (!newEventCode.trim() || !newEventTitle.trim()) { setMessage('Event title and code are required.'); return; }
    if (newEventEnd <= newEventStart) { setMessage('End time must be after start time.'); return; }
    if (newEventLateAfter < newEventStart || newEventLateAfter > newEventEnd) { setMessage('Late time must be between the start and end times.'); return; }
    setAdminActionLoading('create');
    const result = await createEvent({
      eventId: newEventCode,
      title: newEventTitle,
      start: newEventStart.toISOString(),
      end: newEventEnd.toISOString(),
      lateAfter: newEventLateAfter.toISOString(),
      venue: newEventVenue,
      description: newEventDescription,
      audience: newEventAudienceMode === 'groups' ? newEventAudience : undefined,
    }, session);
    setAdminActionLoading(null);
    if (result.error) { setMessage(result.error); return; }
    if (!result.data) {
      setMessage('The event was created but could not be loaded into the dashboard. Please refresh.');
      return;
    }
    const createdEvent = result.data;
    setNewEventCode(''); setNewEventTitle(''); setNewEventVenue(''); setNewEventDescription('');
    setNewEventStart(new Date()); setNewEventEnd(new Date(Date.now() + 60 * 60 * 1000)); setNewEventLateAfter(new Date(Date.now() + 15 * 60 * 1000)); setNewEventPicker(null);
    setNewEventAudienceMode('all'); setNewEventAudience({ courseIds: [], yearLevelIds: [], sectionIds: [] });
    setCreatedAdminEvent(createdEvent);
    const refreshed = await getAdminDashboardData(session);
    if (refreshed.error || !refreshed.data) {
      setDashboard((current) => current ? {
        ...current,
        events: [createdEvent, ...current.events.filter((event) => event.id !== createdEvent.id)],
      } : current);
      setMessage(`Event created, but the dashboard could not refresh: ${refreshed.error ?? 'Please reload.'}`);
      return;
    }
    setDashboard({
      ...refreshed.data,
      events: refreshed.data.events.some((event) => event.id === createdEvent.id)
        ? refreshed.data.events
        : [createdEvent, ...refreshed.data.events],
    });
    setMessage('Event created.');
  };

  if (authorized === null) {
    return <State text="Checking administrator access..." loading />;
  }

  if (!authorized) {
    return <State text="Administrators only. Your account is not authorized to view this page." />;
  }

  if (!dashboard) {
    if (dashboardLoading) return <State text="Loading administrator dashboard..." loading />;
    return <State
      text={error ?? 'Unable to load administrator data.'}
      onRetry={error ? () => setDashboardRetry((attempt) => attempt + 1) : undefined}
    />;
  }

  return (
    <ScrollView
      ref={dashboardScrollRef}
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 24 + insets.top }]}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      nestedScrollEnabled
      overScrollMode="never"
      showsVerticalScrollIndicator
    >
      <View style={styles.dashboardHeading}>
        <View style={styles.dashboardIcon}>
          <Ionicons name="shield-checkmark-outline" size={22} color={COLORS.primary} />
        </View>
        <View style={styles.dashboardHeadingText}>
          <Text style={styles.title}>Administrator Dashboard</Text>
          <Text style={styles.subtitle}>System overview and event status management</Text>
        </View>
      </View>
      {message && <View style={styles.messageBox}><Ionicons name="information-circle-outline" size={17} color={COLORS.primary} /><Text style={styles.message}>{message}</Text></View>}

      <View style={styles.summaryRow}>
        <Summary label="Users" value={dashboard.users.length} onPress={() => openSummarySection('registered-users')} />
        <Summary label="Events" value={dashboard.events.length} onPress={() => openSummarySection('events')} />
        <Summary label="Check-ins" value={dashboard.attendance.reduce((n, e) => n + e.attendeeCount, 0)} onPress={() => openSummarySection('attendance-summary')} />
      </View>

      <AcademicManagement
        users={dashboard.users}
        events={dashboard.events}
        setupExpanded={adminDropdownsOpen['academic-setup']}
        onSetupExpandedChange={(expanded) => setAdminDropdownsOpen((current) => ({ ...current, 'academic-setup': expanded }))}
        activeCoursesExpanded={adminDropdownsOpen['academic-active-courses']}
        onActiveCoursesExpandedChange={(expanded) => setAdminDropdownsOpen((current) => ({ ...current, 'academic-active-courses': expanded }))}
        activeSectionsExpanded={adminDropdownsOpen['academic-active-sections']}
        onActiveSectionsExpandedChange={(expanded) => setAdminDropdownsOpen((current) => ({ ...current, 'academic-active-sections': expanded }))}
      />

      <CollapsiblePanel
        title="Create Event"
        description="Set event details, schedule, venue, and participant groups."
        open={adminDropdownsOpen['create-event']}
        onToggle={() => setAdminDropdownsOpen((current) => ({ ...current, 'create-event': !current['create-event'] }))}
      >
        <TextInput style={styles.input} value={newEventTitle} onChangeText={setNewEventTitle} placeholder="Event title" placeholderTextColor={COLORS.textSecondary} />
        <TextInput style={styles.input} value={newEventCode} onChangeText={setNewEventCode} autoCapitalize="characters" placeholder="Event code" placeholderTextColor={COLORS.textSecondary} />
        <Text style={styles.fieldLabel}>Starts</Text>
        <AdminDateField value={newEventStart} onDatePress={() => setNewEventPicker('start')} onTimeChange={(time) => setNewEventStart((current) => applyAdminTime(current, time))} />
        <Text style={styles.fieldLabel}>Ends</Text>
        <AdminDateField value={newEventEnd} onDatePress={() => setNewEventPicker('end')} onTimeChange={(time) => setNewEventEnd((current) => applyAdminTime(current, time))} />
        <Text style={styles.fieldLabel}>Late after</Text>
        <AdminDateField value={newEventLateAfter} onDatePress={() => setNewEventPicker('late')} onTimeChange={(time) => setNewEventLateAfter((current) => applyAdminTime(current, time))} />
        {newEventPicker && <DateTimePicker
          key={newEventPicker}
          value={newEventPicker === 'start' ? newEventStart : newEventPicker === 'end' ? newEventEnd : newEventLateAfter}
          mode="date"
          display={Platform.OS === 'android' ? 'default' : 'spinner'}
          onChange={(pickerEvent: DateTimePickerEvent, selected?: Date) => {
            if (pickerEvent.type === 'dismissed' || !selected || !newEventPicker) {
              setNewEventPicker(null);
              return;
            }
            const current = newEventPicker === 'start' ? newEventStart : newEventPicker === 'end' ? newEventEnd : newEventLateAfter;
            const next = new Date(current);
            next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
            if (newEventPicker === 'start') setNewEventStart(next);
            else if (newEventPicker === 'end') setNewEventEnd(next);
            else setNewEventLateAfter(next);
            setNewEventPicker(null);
          }}
        />}
        <TextInput style={styles.input} value={newEventVenue} onChangeText={setNewEventVenue} placeholder="Venue (optional)" placeholderTextColor={COLORS.textSecondary} />
        <TextInput style={[styles.input, styles.descriptionInput]} value={newEventDescription} onChangeText={setNewEventDescription} placeholder="Description (optional)" placeholderTextColor={COLORS.textSecondary} multiline />
        <EventAudiencePicker mode={newEventAudienceMode} onModeChange={setNewEventAudienceMode} scope={newEventAudience} onScopeChange={setNewEventAudience} disabled={adminActionLoading === 'create'} />
        <MotionPressable style={styles.primaryButton} disabled={adminActionLoading === 'create'} onPress={createAdminEvent}><Text style={styles.primaryButtonText}>{adminActionLoading === 'create' ? 'Creating...' : 'Create Event'}</Text></MotionPressable>
        {createdAdminEvent && <View style={styles.createdEventPanel}>
          <Text style={styles.createdEventTitle}>Event created</Text>
          <Text style={styles.createdEventCode}>Event code · {createdAdminEvent.event_code}</Text>
          <EventQRCode event={createdAdminEvent} />
          <MotionPressable style={styles.smallButton} onPress={() => setCreatedAdminEvent(null)}><Text style={styles.statusButtonText}>Close QR</Text></MotionPressable>
        </View>}
      </CollapsiblePanel>

      <EventAttendanceManager
        events={dashboard.events}
        expanded={adminDropdownsOpen['event-attendance']}
        onExpandedChange={(expanded) => setAdminDropdownsOpen((current) => ({ ...current, 'event-attendance': expanded }))}
        description="Review attendance, update student status, and export reports."
      />

      <CollapsibleSection
        title="Registered Users"
        description="Review teacher requests, search accounts, edit student groups, and manage user access."
        count={dashboard.users.length}
        open={adminDropdownsOpen['registered-users']}
        onToggle={() => setAdminDropdownsOpen((current) => ({ ...current, 'registered-users': !current['registered-users'] }))}
        onLayout={(position) => { dashboardSectionPositions.current['registered-users'] = position; }}
      >
        <TextInput style={styles.search} value={userSearch} onChangeText={setUserSearch} placeholder="Search ID, name, email, or role" placeholderTextColor={COLORS.textSecondary} />
        {dashboard.users.filter((item) => `${item.display_id} ${item.full_name ?? ''} ${item.email} ${item.role} ${item.teacher_requested_at ? 'teacher request pending' : ''} ${item.course_code ?? ''} ${item.course_name ?? ''} ${item.year_level_name ?? ''} ${item.section_name ?? ''} ${item.section_code ?? ''}`.toLowerCase().includes(userSearch.toLowerCase().trim())).map((item) => (
          <View style={styles.card} key={item.id}>
            <View style={styles.userIdentity}>
              {editingUserId === item.id ? <TextInput style={styles.input} value={editingName} onChangeText={setEditingName} placeholder="Full name" placeholderTextColor={COLORS.textSecondary} /> : <Text style={styles.cardTitle}>{item.full_name || 'Unnamed user'}</Text>}
              <Text style={styles.meta}>{item.display_id}</Text>
            </View>
            <View style={styles.userDetails}>
              <Text style={styles.meta}>{item.email}</Text>
              {item.role === 'student' && <>
                <Text style={styles.meta}>Course: {item.course_name && item.course_code ? formatCourseLabel({ name: item.course_name, code: item.course_code }) : item.course_name ?? item.course_code ?? 'Not assigned'}</Text>
                <Text style={styles.meta}>Year level: {item.year_level_name ?? 'Not assigned'}</Text>
                <Text style={styles.meta}>Section / block: {item.section_name ?? item.section_code ?? 'Not assigned'}</Text>
              </>}
            </View>
            {editingAcademicUserId === item.id && item.role === 'student' && <>
              <View style={styles.academicEditPanel}>
                <Text style={styles.academicEditTitle}>Correct student academic group</Text>
                <AcademicPicker
                  label="Course"
                  value={academicCourseId}
                  options={dashboard.courses.map((course) => ({ id: course.id, label: formatCourseLabel(course) }))}
                  onChange={(value) => { setAcademicCourseId(value); setAcademicYearLevelId(''); setAcademicSectionId(''); }}
                />
                <AcademicPicker
                  label="Year level"
                  value={academicYearLevelId}
                  options={dashboard.yearLevels
                    .filter((year) => dashboard.sections.some((section) => section.course_id === academicCourseId && section.year_level_id === year.id))
                    .map((year) => ({ id: year.id, label: year.name }))}
                  onChange={(value) => { setAcademicYearLevelId(value); setAcademicSectionId(''); }}
                />
                <AcademicPicker
                  label="Block / section"
                  value={academicSectionId}
                  options={dashboard.sections
                    .filter((section) => section.course_id === academicCourseId && section.year_level_id === academicYearLevelId)
                    .map((section) => ({ id: section.id, label: `${section.section_name} · ${section.academic_year}` }))}
                  onChange={setAcademicSectionId}
                />
                <View style={styles.actionRow}>
                  <MotionPressable
                    style={styles.smallButton}
                    disabled={adminActionLoading === `academic:${item.id}`}
                    onPress={() => saveStudentAcademicGroup(item.id)}
                  >
                    <Text style={styles.statusButtonText}>{adminActionLoading === `academic:${item.id}` ? 'Saving...' : 'Save academic group'}</Text>
                  </MotionPressable>
                  <MotionPressable style={styles.smallButton} onPress={() => setEditingAcademicUserId(null)}>
                    <Text style={styles.statusButtonText}>Cancel</Text>
                  </MotionPressable>
                </View>
              </View>
            </>}
            <View style={styles.userStatusRow}>
              <Text style={styles.badge}>{item.role.toUpperCase()}</Text>
              {item.teacher_requested_at && <StatusBadge status="pending" label="Teacher request" shape="subtle" />}
              <StatusBadge status={item.is_active ? 'active' : 'inactive'} label={item.is_active ? 'Active' : 'Deactivated'} shape="subtle" />
            </View>
            <View style={styles.userActions}>
              <View style={[styles.actionRow, styles.userActionRow]}>
                {editingUserId === item.id ? <MotionPressable style={({ pressed }) => [styles.userActionButton, pressed && styles.userActionPressed, adminActionLoading === item.id && styles.userActionDisabled]} disabled={adminActionLoading === item.id} onPress={() => saveUser(item.id)}><Text style={styles.statusButtonText}>{adminActionLoading === item.id ? 'Saving...' : 'Save name'}</Text></MotionPressable> : <MotionPressable style={({ pressed }) => [styles.userActionButton, pressed && styles.userActionPressed]} onPress={() => { setEditingAcademicUserId(null); setEditingUserId(item.id); setEditingName(item.full_name ?? ''); }}><Text style={styles.statusButtonText}>Edit Name</Text></MotionPressable>}
                {item.role === 'student' && editingAcademicUserId !== item.id && <MotionPressable style={({ pressed }) => [styles.userActionButton, pressed && styles.userActionPressed]} onPress={() => startEditingAcademicGroup(item)}><Text style={styles.statusButtonText}>Edit Course / Block</Text></MotionPressable>}
              </View>
              <View style={[styles.actionRow, styles.userActionRow]}>
                {item.role === 'student' && item.teacher_requested_at && item.is_active && item.id !== user?.id && <MotionPressable style={({ pressed }) => [styles.userActionButton, pressed && styles.userActionPressed, adminActionLoading === item.id && styles.userActionDisabled]} disabled={adminActionLoading === item.id} onPress={() => approveTeacherAccount(item)}><Text style={styles.statusButtonText}>{adminActionLoading === item.id ? 'Approving...' : 'Approve Teacher Request'}</Text></MotionPressable>}
                {item.is_active && item.id !== user?.id && <MotionPressable style={({ pressed }) => [styles.userActionButton, styles.smallDangerButton, pressed && styles.userActionPressed, adminActionLoading === item.id && styles.userActionDisabled]} disabled={adminActionLoading === item.id} onPress={() => deactivateUser(item)}><Text style={styles.dangerText}>Deactivate</Text></MotionPressable>}
                {item.is_active && item.id === user?.id && <Text style={styles.protectedText}>Current account protected</Text>}
                {!item.is_active && item.id !== user?.id && <MotionPressable style={({ pressed }) => [styles.userActionButton, pressed && styles.userActionPressed, adminActionLoading === item.id && styles.userActionDisabled]} disabled={adminActionLoading === item.id} onPress={() => reactivateUser(item)}><Text style={styles.statusButtonText}>{adminActionLoading === item.id ? 'Reactivating...' : 'Reactivate'}</Text></MotionPressable>}
                {item.id !== user?.id && <MotionPressable style={({ pressed }) => [styles.userActionButton, styles.deleteUserButton, pressed && styles.userActionPressed, adminActionLoading === item.id && styles.userActionDisabled]} disabled={adminActionLoading === item.id} onPress={() => permanentlyDeleteUser(item)}><Text style={styles.deleteText}>Delete Permanently</Text></MotionPressable>}
              </View>
            </View>
          </View>
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        title="Events"
        description="Edit event details, manage status, archive events, or display QR codes."
        count={dashboard.events.length}
        open={adminDropdownsOpen.events}
        onToggle={() => setAdminDropdownsOpen((current) => ({ ...current, events: !current.events }))}
        onLayout={(position) => { dashboardSectionPositions.current.events = position; }}
      >
        {dashboard.events.map((item) => (
          <View style={styles.adminEventCard} key={item.id}>
            <View style={styles.adminEventHeader}>
              <View style={styles.adminEventInfo}>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.meta}>{item.event_code}</Text>
                <Text style={styles.adminEventCreator} numberOfLines={1}>
                  Created by {getEventCreatorLabel(dashboard.users, item.created_by)}
                </Text>
              </View>
              <StatusBadge status={item.archived_at ? 'archived' : item.status} />
            </View>
            {item.audience_mode === 'legacy' && <Text style={styles.warning}>Participant eligibility needs repair before attendance management.</Text>}
            {qrEventId === item.id && item.status === 'open' && !item.archived_at && (
              <View style={styles.qrPanel}>
                <EventQRCode event={item} compact />
              </View>
            )}
            <View style={styles.eventActions}>
              <View style={styles.eventActionRow}>
                <MotionPressable
                  style={[styles.eventActionButton, styles.eventEditButton]}
                  onPress={() => router.push({ pathname: '/event-edit', params: { eventId: item.id } })}
                >
                  <Text style={styles.editButtonText} numberOfLines={1}>Edit</Text>
                </MotionPressable>
                {!item.archived_at && <MotionPressable style={[styles.eventActionButton, styles.eventArchiveButton]} onPress={() => archive(item)}><Text style={styles.dangerText} numberOfLines={1}>Archive</Text></MotionPressable>}
                <MotionPressable style={[styles.eventActionButton, styles.deleteButton]} disabled={adminActionLoading === item.id} onPress={() => removeEvent(item)}><Text style={styles.deleteText} numberOfLines={1}>Delete</Text></MotionPressable>
              </View>
              <View style={styles.eventActionRow}>
                {item.status === 'open' && !item.archived_at && <MotionPressable style={[styles.eventActionButton, styles.eventQrButton]} onPress={() => setQrEventId(qrEventId === item.id ? null : item.id)}><Text style={styles.statusButtonText} numberOfLines={1}>{qrEventId === item.id ? 'Hide QR' : 'Show QR'}</Text></MotionPressable>}
                <MotionPressable
                  style={[styles.eventActionButton, styles.eventStatusButton]}
                  disabled={statusLoading === item.id}
                  onPress={() => changeStatus(item)}
                >
                  {statusLoading === item.id ? <ActivityIndicator size="small" color={COLORS.primary} /> : (
                    <Text style={styles.statusButtonText} numberOfLines={1}>{item.status === 'open' ? 'Close' : 'Reopen'}</Text>
                  )}
                </MotionPressable>
              </View>
            </View>
          </View>
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        title="Attendance Summary"
        description="A quick view of attendance across your events."
        count={dashboard.attendance.length}
        open={adminDropdownsOpen['attendance-summary']}
        onToggle={() => setAdminDropdownsOpen((current) => ({ ...current, 'attendance-summary': !current['attendance-summary'] }))}
        onLayout={(position) => { dashboardSectionPositions.current['attendance-summary'] = position; }}
      >
        {dashboard.attendance.length === 0 ? (
          <Text style={styles.meta}>No attendance records yet.</Text>
        ) : dashboard.attendance.map((item) => (
          <View style={styles.card} key={item.eventId}>
            <Text style={styles.cardTitle}>{item.eventTitle}</Text>
            <Text style={styles.meta}>
              {item.totalStudents} {item.totalStudents === 1 ? 'student' : 'students'}
              {' · '}{item.attendeeCount} checked in
              {' · '}{item.absentCount} absent
            </Text>
          </View>
        ))}
      </CollapsibleSection>
    </ScrollView>
  );
}

function State({ text, loading = false, onRetry }: { text: string; loading?: boolean; onRetry?: () => void }) {
  return (
    <View style={styles.state}>
      {loading && <ActivityIndicator color={COLORS.primary} />}
      <Text style={styles.stateText}>{text}</Text>
      {onRetry && (
        <MotionPressable style={styles.stateRetryButton} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.stateRetryText}>Try again</Text>
        </MotionPressable>
      )}
    </View>
  );
}

function Summary({ label, value, onPress }: { label: string; value: number; onPress: () => void }) {
  const icon = label === 'Users' ? 'people-outline' : label === 'Events' ? 'calendar-outline' : 'checkmark-done-outline';
  return (
    <MotionPressable
      style={({ pressed }) => [styles.summary, pressed && styles.summaryPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={`Open the ${label === 'Check-ins' ? 'attendance summary' : label.toLowerCase()} section`}
    >
      <View style={styles.summaryTopRow}>
        <View style={styles.summaryIcon}>
          <Ionicons name={icon} size={17} color={COLORS.primary} />
        </View>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
      <Text style={styles.summaryLabel}>{label}</Text>
    </MotionPressable>
  );
}

function AdminDateField({ value, onDatePress, onTimeChange }: { value: Date; onDatePress: () => void; onTimeChange: (time: ReturnType<typeof parseAdminTime>) => void }) {
  const [timeText, setTimeText] = useState(() => formatAdminTime(value));

  useEffect(() => {
    setTimeText(formatAdminTime(value));
  }, [value]);

  return <View style={styles.dateField}>
    <MotionPressable style={({ pressed }) => [styles.datePart, pressed && styles.datePartPressed]} onPress={onDatePress} accessibilityRole="button" accessibilityLabel={`Change date, ${value.toLocaleDateString('en-PH', { dateStyle: 'medium' })}`}>
      <Text style={styles.dateText} numberOfLines={1}>{value.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</Text>
    </MotionPressable>
    <TextInput
      style={styles.timeInput}
      value={timeText}
      onChangeText={setTimeText}
      onEndEditing={() => {
        const parsedTime = parseAdminTime(timeText);
        if (!parsedTime) {
          setTimeText(formatAdminTime(value));
          return;
        }
        onTimeChange(parsedTime);
      }}
      placeholder="9:30 AM"
      placeholderTextColor={COLORS.textSecondary}
      keyboardType="default"
      autoCapitalize="characters"
      selectTextOnFocus
      returnKeyType="done"
      accessibilityLabel={`Event time, currently ${formatAdminTime(value)}`}
      accessibilityHint="Enter an hour such as 12, or a full time such as 9:30 AM or 14:30."
    />
    <MotionPressable style={({ pressed }) => [styles.datePickerButton, pressed && styles.datePartPressed]} onPress={onDatePress} accessibilityRole="button" accessibilityLabel="Open date picker" hitSlop={6}>
      <Ionicons name="calendar-outline" size={17} color={COLORS.primary} />
    </MotionPressable>
  </View>;
}

function CollapsiblePanel({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <View style={styles.sectionCard}>
      <MotionPressable
        style={styles.sectionHeader}
        onPress={() => {
          animateLayoutChange(reduceMotion);
          onToggle();
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.sectionHeading}>
          <View style={styles.sectionHeadingText}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionDescription}>{description}</Text>
          </View>
        </View>
        <View style={styles.chevronCircle}>
          <ExpandableChevron open={open} />
        </View>
      </MotionPressable>
      {open && children}
    </View>
  );
}

function CollapsibleSection({
  title,
  description,
  count,
  open,
  onToggle,
  onLayout,
  children,
}: {
  title: string;
  description: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onLayout: (position: number) => void;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <View style={styles.sectionCard} onLayout={(event) => onLayout(event.nativeEvent.layout.y)}>
      <MotionPressable
        style={({ pressed }) => [styles.sectionHeader, pressed && styles.sectionHeaderPressed]}
        onPress={() => {
          animateLayoutChange(reduceMotion);
          onToggle();
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.sectionHeading}>
          <View style={styles.sectionHeadingText}>
            <Text style={styles.sectionTitle}>{title} <Text style={styles.sectionCount}>({count})</Text></Text>
            <Text style={styles.sectionDescription}>{description}</Text>
          </View>
        </View>
        <View style={styles.chevronCircle}>
          <ExpandableChevron open={open} />
        </View>
      </MotionPressable>
      {open && children}
    </View>
  );
}

function ExpandableChevron({ open }: { open: boolean }) {
  const reduceMotion = useReducedMotion();
  const rotation = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion !== false) {
      rotation.setValue(open ? 1 : 0);
      return;
    }
    const animation = Animated.timing(rotation, {
      toValue: open ? 1 : 0,
      duration: MOTION.stateDuration,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [open, reduceMotion, rotation]);

  return (
    <Animated.View style={{
      transform: [{
        rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }),
      }],
    }}>
      <Ionicons name="chevron-down" size={16} color={COLORS.primaryLight} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  dashboardHeading: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, gap: 12 },
  dashboardIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: `${COLORS.primary}18`, borderWidth: 1, borderColor: `${COLORS.primary}44`, alignItems: 'center', justifyContent: 'center' },
  dashboardHeadingText: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700', fontFamily: FONTS.bold, color: COLORS.textPrimary, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginTop: 4 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  summary: { flex: 1, backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 78, justifyContent: 'space-between' },
  summaryPressed: { opacity: 0.72, borderColor: COLORS.primary },
  summaryTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: `${COLORS.primary}22`, alignItems: 'center', justifyContent: 'center' },
  summaryValue: { fontSize: 23, fontWeight: '800', fontFamily: FONTS.extraBold, color: COLORS.textPrimary },
  summaryLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 7, fontWeight: '600', fontFamily: FONTS.semiBold },
  sectionCard: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', fontFamily: FONTS.bold, color: COLORS.textPrimary },
  sectionCount: { fontSize: 14, fontWeight: '600', fontFamily: FONTS.semiBold, color: COLORS.textSecondary },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  sectionHeadingText: { flex: 1 },
  sectionDescription: { fontSize: 12, lineHeight: 16, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginBottom: 8 },
  sectionHeaderPressed: { opacity: 0.82 },
  chevronCircle: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, borderColor: `${COLORS.primary}44`, backgroundColor: `${COLORS.primary}12`, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: COLORS.card, borderColor: `${COLORS.border}CC`, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  adminEventCard: { backgroundColor: COLORS.card, borderColor: `${COLORS.border}CC`, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 9 },
  adminEventHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  adminEventInfo: { flex: 1, minWidth: 0, gap: 3 },
  adminEventCreator: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15, fontFamily: FONTS.regular, marginTop: 2 },
  userIdentity: { gap: 1 },
  cardTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600', fontFamily: FONTS.semiBold, color: COLORS.textPrimary },
  userDetails: { marginTop: 7, gap: 2 },
  meta: { fontSize: 12, lineHeight: 17, fontFamily: FONTS.regular, color: COLORS.textSecondary },
  userStatusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9, marginTop: 9 },
  badge: { alignSelf: 'center', fontSize: 10, lineHeight: 14, letterSpacing: 0.5, fontWeight: '700', fontFamily: FONTS.bold, color: COLORS.textSecondary },
  messageBox: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: `${COLORS.primary}14`, borderColor: `${COLORS.primary}44`, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, marginBottom: 14 },
  message: { color: COLORS.primary, fontSize: 13, fontFamily: FONTS.medium, flex: 1 },
  warning: { color: COLORS.warning, fontSize: 12, fontFamily: FONTS.regular, lineHeight: 17, marginTop: 6 },
  eventActions: { width: '100%', gap: 7, marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: COLORS.border },
  eventActionRow: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8 },
  eventActionButton: { flex: 1, minWidth: 0, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  status: { fontSize: 13, fontWeight: '700', fontFamily: FONTS.bold, color: COLORS.success },
  closedStatus: { color: COLORS.statusClosed },
  statusButton: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, minWidth: 72, alignItems: 'center', justifyContent: 'center' },
  statusButtonText: { color: COLORS.primary, fontWeight: '600', fontFamily: FONTS.semiBold, fontSize: 13 },
  eventEditButton: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  eventArchiveButton: { borderWidth: 1, borderColor: `${COLORS.danger}55`, borderRadius: 8, minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 7 },
  eventQrButton: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  eventStatusButton: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, minWidth: 72 },
  editButtonText: { color: COLORS.textPrimary, fontWeight: '600', fontFamily: FONTS.semiBold, fontSize: 13 },
  search: { minHeight: 44, backgroundColor: COLORS.surfaceRaised, borderColor: COLORS.border, borderWidth: 1, borderRadius: 8, color: COLORS.textPrimary, fontFamily: FONTS.regular, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 8 },
  input: { minHeight: 44, backgroundColor: COLORS.surfaceRaised, borderColor: COLORS.border, borderWidth: 1, borderRadius: 8, color: COLORS.textPrimary, fontFamily: FONTS.regular, paddingHorizontal: 11, paddingVertical: 9, marginBottom: 6 },
  academicEditPanel: { backgroundColor: COLORS.surfaceRaised, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, padding: 10, marginTop: 10 },
  academicEditTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: FONTS.bold, marginBottom: 4 },
  fieldLabel: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '600', fontFamily: FONTS.semiBold, marginTop: 6, marginBottom: 3 },
  dateField: { minHeight: 46, backgroundColor: COLORS.surfaceRaised, borderColor: COLORS.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, marginBottom: 6, flexDirection: 'row', alignItems: 'stretch', gap: 2 },
  datePart: { minHeight: 44, flexShrink: 0, justifyContent: 'center', paddingHorizontal: 4 },
  timeInput: { flex: 1, minWidth: 70, minHeight: 44, paddingHorizontal: 4, paddingVertical: 0, color: COLORS.textPrimary, fontSize: 13, fontFamily: FONTS.regular },
  datePickerButton: { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  datePartPressed: { opacity: 0.7 },
  dateText: { color: COLORS.textPrimary, fontSize: 13, fontFamily: FONTS.regular },
  dateChevron: { color: COLORS.primary, fontSize: 20 },
  descriptionInput: { minHeight: 58, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  userActions: { borderTopWidth: 1, borderTopColor: `${COLORS.border}99`, marginTop: 11, paddingTop: 2 },
  userActionRow: { flexWrap: 'wrap' },
  userActionButton: { flex: 1, minWidth: 132, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 7 },
  userActionPressed: { opacity: 0.72 },
  userActionDisabled: { opacity: 0.5 },
  smallButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  smallDangerButton: { borderColor: `${COLORS.danger}44`, backgroundColor: `${COLORS.danger}08` },
  dangerText: { color: COLORS.danger, fontWeight: '600', fontFamily: FONTS.semiBold, fontSize: 12 },
  deleteButton: { borderWidth: 1, borderColor: `${COLORS.danger}66`, backgroundColor: `${COLORS.danger}12`, borderRadius: 8, minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 7 },
  deleteUserButton: { borderColor: `${COLORS.danger}66`, backgroundColor: `${COLORS.danger}14` },
  deleteText: { color: COLORS.danger, fontWeight: '600', fontFamily: FONTS.semiBold, fontSize: 12 },
  protectedText: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, marginLeft: 8, paddingVertical: 7 },
  primaryButton: { minHeight: 44, backgroundColor: COLORS.primaryButtonStart, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, marginTop: 4 },
  primaryButtonText: { color: COLORS.textOnPrimary, fontWeight: '600', fontFamily: FONTS.semiBold },
  qrPanel: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  qrHint: { color: '#334155', fontSize: 12, fontFamily: FONTS.regular, marginTop: 10, textAlign: 'center' },
  createdEventPanel: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, padding: 16, marginTop: 14, alignItems: 'center', gap: 6 },
  createdEventTitle: { color: COLORS.success, fontWeight: '700', fontFamily: FONTS.bold, fontSize: 16, marginTop: 2 },
  createdEventCode: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18, fontFamily: FONTS.medium },
  state: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent', padding: 24 },
  stateText: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 12 },
  stateRetryButton: { minHeight: 42, justifyContent: 'center', marginTop: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, backgroundColor: COLORS.surface },
  stateRetryText: { color: COLORS.primaryLight, fontSize: 13, fontFamily: FONTS.semiBold },
});
