import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MotionPressable from '@/components/MotionPressable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StatusBadge from '@/components/StatusBadge';

import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { getAdminDashboardData } from '@/lib/admin';
import { useAuth } from '@/lib/auth';
import { getProfileWithError, type Role } from '@/lib/profiles';
import { getEventAttendanceSummary, type EventAttendanceSummary } from '@/lib/academic';
import {
  getAttendanceHistory,
  getTeacherEventSummary,
  type AttendanceRecord,
  type TeacherEventSummary,
} from '@/lib/attendance';
import { subscribeToAttendanceHistoryUpdates } from '@/lib/attendanceHistoryEvents';
import {
  calculateStudentAttendanceStats,
  isInCurrentManilaMonth,
} from '@/lib/studentAttendanceStats';

type HistoryStatusFilter = 'all' | 'present' | 'late' | 'absent' | 'excused';

type AttendanceReportEvent = TeacherEventSummary & {
  attendanceFinalized: boolean;
  summary: EventAttendanceSummary | null;
  countError?: string;
};

function isAttendanceFinalized(event: TeacherEventSummary) {
  if (event.eventStatus === 'completed') return true;
  if (event.eventStatus === 'cancelled' || !event.endTime) return false;
  const endTime = Date.parse(event.endTime);
  return Number.isFinite(endTime) && endTime <= Date.now();
}

async function addAttendanceSummaries(events: TeacherEventSummary[]): Promise<AttendanceReportEvent[]> {
  return Promise.all(events.map(async (event) => {
    const shouldFinalize = isAttendanceFinalized(event);
    try {
      const result = await getEventAttendanceSummary(event.eventId, { attendanceFinalized: shouldFinalize });
      const attendanceFinalized = event.eventStatus === 'completed' || (shouldFinalize && !result.error);
      if (result.error || !result.data) {
        return { ...event, attendanceFinalized, status: attendanceFinalized ? 'closed' : event.status, summary: null, countError: result.error ?? 'Attendance summary is unavailable.' };
      }
      return { ...event, attendanceFinalized, status: attendanceFinalized ? 'closed' : event.status, summary: result.data };
    } catch (error) {
      const attendanceFinalized = event.eventStatus === 'completed';
      return {
        ...event,
        attendanceFinalized,
        status: attendanceFinalized ? 'closed' : event.status,
        summary: null,
        countError: error instanceof Error ? error.message : 'Attendance summary is unavailable.',
      };
    }
  }));
}

export default function HistoryScreen() {
  const { user, session } = useAuth();
  const insets = useSafeAreaInsets();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [teacherSummaries, setTeacherSummaries] = useState<AttendanceReportEvent[]>([]);
  const [adminEventSummaries, setAdminEventSummaries] = useState<AttendanceReportEvent[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('all');
  const [currentMonthOnly, setCurrentMonthOnly] = useState(false);
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<AttendanceRecord | null>(null);
  const [selectedTeacherEvent, setSelectedTeacherEvent] = useState<AttendanceReportEvent | null>(null);
  const [selectedAttendance, setSelectedAttendance] = useState<EventAttendanceSummary | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const attendanceRequestId = useRef(0);
  const attendanceStats = useMemo(() => calculateStudentAttendanceStats(records.map((record) => ({
    eventKey: record.eventUuid || record.eventId || record.id,
    status: record.status,
    occurredAt: record.recordedAt ?? record.scannedAt,
    eventDate: record.eventStartTime,
    attendanceFinalized: record.attendanceFinalized,
  }))), [records]);
  const visibleHistoryRecords = useMemo(() => {
    const search = historySearch.trim().toLocaleLowerCase();
    return records.filter((record) => (
      (statusFilter === 'all' || record.status === statusFilter)
      && (!currentMonthOnly || isInCurrentManilaMonth(record.eventStartTime ?? record.scannedAt))
      && (!search || `${record.eventTitle} ${record.eventId}`.toLocaleLowerCase().includes(search))
    ));
  }, [currentMonthOnly, historySearch, records, statusFilter]);

  const loadAttendanceDetails = useCallback(async (event: TeacherEventSummary, showLoading: boolean) => {
    const requestId = ++attendanceRequestId.current;
    if (showLoading) {
      setSelectedAttendance(null);
      setAttendanceError(null);
      setAttendanceLoading(true);
    }
    try {
      const shouldFinalize = isAttendanceFinalized(event);
      const result = await getEventAttendanceSummary(event.eventId, { attendanceFinalized: shouldFinalize });
      const attendanceFinalized = event.eventStatus === 'completed' || (shouldFinalize && !result.error);
      if (requestId !== attendanceRequestId.current) return;
      setSelectedAttendance(result.data);
      setAttendanceError(result.error);
      const updateSummary = (items: AttendanceReportEvent[]) => items.map((item) => (
        item.eventId === event.eventId
          ? {
            ...item,
            status: attendanceFinalized ? 'closed' : item.status,
            attendanceFinalized,
            summary: result.data,
            countError: result.error ?? undefined,
          }
          : item
      ));
      setTeacherSummaries(updateSummary);
      setAdminEventSummaries(updateSummary);
      setSelectedTeacherEvent((current) => current?.eventId === event.eventId
        ? { ...current, status: attendanceFinalized ? 'closed' : current.status, attendanceFinalized }
        : current);
    } catch (error) {
      if (requestId !== attendanceRequestId.current) return;
      const message = error instanceof Error ? error.message : 'Unable to load attendance details.';
      setSelectedAttendance(null);
      setAttendanceError(message);
      const updateSummary = (items: AttendanceReportEvent[]) => items.map((item) => (
        item.eventId === event.eventId ? { ...item, summary: null, countError: message } : item
      ));
      setTeacherSummaries(updateSummary);
      setAdminEventSummaries(updateSummary);
    } finally {
      if (requestId === attendanceRequestId.current) setAttendanceLoading(false);
    }
  }, []);

  const openTeacherEvent = (event: AttendanceReportEvent) => {
    setSelectedTeacherEvent(event);
    setSelectedAttendance(event.summary);
    setAttendanceError(event.countError ?? null);
    void loadAttendanceDetails(event, true);
  };

  const loadHistory = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setHistoryError(null);
    if (!user) {
      if (showLoading) setLoading(false);
      return;
    }

    try {
      const { profile, error } = await getProfileWithError(user.id, session?.access_token);
      if (error) throw new Error(`Unable to load your account profile: ${error}`);
      if (!profile) throw new Error('No Acadence profile was found for this account.');
      const currentRole = profile.role;
      setRole(currentRole);

      if (currentRole === 'teacher') {
        const summaries = await getTeacherEventSummary(user.id);
        setHistoryError(summaries.error);
        setTeacherSummaries(await addAttendanceSummaries(summaries.data ?? []));
        setAdminEventSummaries([]);
        setAdminError(null);
        setRecords([]);
        return;
      }

      if (currentRole === 'admin') {
        const result = await getAdminDashboardData();
        const summaries: TeacherEventSummary[] = (result.data?.events ?? []).map((event) => ({
          eventId: event.id,
          eventCode: event.event_code,
          title: event.title,
          status: event.status,
          eventStatus: event.event_status ?? 'upcoming',
          endTime: event.end_time,
        }));
        setAdminEventSummaries(await addAttendanceSummaries(summaries));
        setAdminError(result.error);
        setTeacherSummaries([]);
        setRecords([]);
        return;
      }

      const history = await getAttendanceHistory(user.id, session?.access_token);
      setRecords(history.data ?? []);
      setHistoryError(history.error);
      setTeacherSummaries([]);
      setAdminEventSummaries([]);
      setAdminError(null);
    } catch (error) {
      console.error('Unable to load attendance overview.', error);
      setRole(null);
      setRecords([]);
      setTeacherSummaries([]);
      setAdminEventSummaries([]);
      setHistoryError(error instanceof Error ? error.message : 'Attendance information could not be loaded. Check your connection and try again.');
      setAdminError('Attendance information could not be loaded. Please try again.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [session?.access_token, user]);

  const refreshHistory = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadHistory();
    } finally {
      setRefreshing(false);
    }
  }, [loadHistory]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  useEffect(
    () => subscribeToAttendanceHistoryUpdates(() => { void loadHistory(false); }),
    [loadHistory],
  );

  useEffect(() => {
    if (!selectedTeacherEvent) return;
    const interval = setInterval(() => {
      void loadAttendanceDetails(selectedTeacherEvent, false);
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedTeacherEvent, loadAttendanceDetails]);

  if (role === 'teacher') {
    return (
      <View style={[styles.container, { paddingTop: 24 + insets.top }]}>
        <View style={styles.adminHeader}>
          <Text style={styles.adminTitle}>Attendance Overview</Text>
          <Text style={styles.adminSubtitle}>Review attendance for events you manage.</Text>
        </View>

        {loading ? (
          <View style={styles.adminLoading}><ActivityIndicator color={COLORS.primary} /><Text style={styles.adminLoadingText}>Loading events...</Text></View>
        ) : historyError ? (
          <View style={styles.adminNotice}>
            <Ionicons name="alert-circle-outline" size={19} color={COLORS.danger} />
            <View style={styles.historyLoadError}>
              <Text style={styles.adminError}>{historyError}</Text>
              <MotionPressable style={styles.historyRetryButton} onPress={() => { void loadHistory(); }} accessibilityRole="button">
                <Text style={styles.historyRetryText}>Try again</Text>
              </MotionPressable>
            </View>
          </View>
        ) : teacherSummaries.length === 0 ? (
          <View style={styles.adminEmpty}>
            <Text style={styles.adminEmptyTitle}>No events yet</Text>
            <Text style={styles.adminEmptyText}>Events you create or manage and their attendance will appear here.</Text>
          </View>
        ) : (
          <FlatList
            data={teacherSummaries}
            keyExtractor={(item) => item.eventId}
            contentContainerStyle={styles.adminList}
            renderItem={({ item }) => (
              <MotionPressable
                style={({ pressed }) => [styles.adminEventCard, pressed && styles.adminCardPressed]}
                onPress={() => openTeacherEvent(item)}
                accessibilityRole="button"
                accessibilityLabel={attendanceReportAccessibilityLabel(item)}
                accessibilityHint="View attendance records"
              >
                <View style={styles.adminEventTop}>
                  <View style={styles.adminEventInfo}>
                    <Text style={styles.adminEventTitle} numberOfLines={2}>{item.title}</Text>
                    <Text style={styles.adminEventCode}>{item.eventCode}</Text>
                  </View>
                  <StatusBadge status={item.status} />
                </View>
                <View style={styles.adminCardFooter}>
                  <AttendanceReportMetrics
                    summary={item.summary}
                    error={item.countError}
                  />
                </View>
                <View style={[styles.adminFinalizationStatus, item.attendanceFinalized && styles.adminFinalizedStatus]}>
                  <Ionicons name={item.attendanceFinalized ? 'checkmark-circle-outline' : 'time-outline'} size={14} color={item.attendanceFinalized ? COLORS.success : COLORS.textMuted} />
                  <Text style={[styles.adminFinalizationText, item.attendanceFinalized && styles.adminFinalizedText]}>
                    {item.attendanceFinalized ? 'Attendance finalized' : 'Attendance pending finalization'}
                  </Text>
                </View>
              </MotionPressable>
            )}
          />
        )}
        <TeacherAttendanceModal
          event={selectedTeacherEvent}
          summary={selectedAttendance}
          loading={attendanceLoading}
          error={attendanceError}
          onClose={() => {
            attendanceRequestId.current += 1;
            setSelectedTeacherEvent(null);
            setSelectedAttendance(null);
          }}
        />
      </View>
    );
  }

  if (role === 'admin') {
    return (
      <View style={[styles.container, { paddingTop: 24 + insets.top }]}>
        <View style={styles.adminHeader}>
          <Text style={styles.adminTitle}>Attendance Overview</Text>
          <Text style={styles.adminSubtitle}>Review attendance for every event.</Text>
        </View>

        {loading ? (
          <View style={styles.adminLoading}><ActivityIndicator color={COLORS.primary} /><Text style={styles.adminLoadingText}>Loading events...</Text></View>
        ) : adminError ? (
          <View style={styles.adminNotice}><Ionicons name="alert-circle-outline" size={19} color={COLORS.danger} /><Text style={styles.adminError}>{adminError}</Text></View>
        ) : adminEventSummaries.length === 0 ? (
          <View style={styles.adminEmpty}>
            <Text style={styles.adminEmptyTitle}>No events yet</Text>
            <Text style={styles.adminEmptyText}>Created events and their attendance will appear here.</Text>
          </View>
        ) : (
          <FlatList
            data={adminEventSummaries}
            keyExtractor={(item) => item.eventId}
            contentContainerStyle={styles.adminList}
            renderItem={({ item }) => (
              <MotionPressable
                style={({ pressed }) => [styles.adminEventCard, pressed && styles.adminCardPressed]}
                onPress={() => openTeacherEvent(item)}
                accessibilityRole="button"
                accessibilityLabel={attendanceReportAccessibilityLabel(item)}
                accessibilityHint="View attendance records"
              >
                <View style={styles.adminEventTop}>
                  <View style={styles.adminEventInfo}>
                    <Text style={styles.adminEventTitle} numberOfLines={2}>{item.title}</Text>
                    <Text style={styles.adminEventCode}>{item.eventCode}</Text>
                  </View>
                  <StatusBadge status={item.status} />
                </View>
                <View style={styles.adminCardFooter}>
                  <AttendanceReportMetrics
                    summary={item.summary}
                    error={item.countError}
                  />
                </View>
                <View style={[styles.adminFinalizationStatus, item.attendanceFinalized && styles.adminFinalizedStatus]}>
                  <Ionicons name={item.attendanceFinalized ? 'checkmark-circle-outline' : 'time-outline'} size={14} color={item.attendanceFinalized ? COLORS.success : COLORS.textMuted} />
                  <Text style={[styles.adminFinalizationText, item.attendanceFinalized && styles.adminFinalizedText]}>
                    {item.attendanceFinalized ? 'Attendance finalized' : 'Attendance pending finalization'}
                  </Text>
                </View>
              </MotionPressable>
            )}
          />
        )}
        <TeacherAttendanceModal
          event={selectedTeacherEvent}
          summary={selectedAttendance}
          loading={attendanceLoading}
          error={attendanceError}
          onClose={() => {
            attendanceRequestId.current += 1;
            setSelectedTeacherEvent(null);
            setSelectedAttendance(null);
          }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: 24 + insets.top }]}>
      {loading ? (
        <>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Attendance History</Text>
          </View>
          <View style={styles.historyState}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.historyStateText}>Loading attendance records...</Text>
          </View>
        </>
      ) : historyError ? (
        <View style={styles.historyState}>
          <View style={styles.historyEmptyIcon}>
            <Ionicons name="alert-circle-outline" size={23} color={COLORS.danger} />
          </View>
          <Text style={styles.historyEmptyTitle}>Could not load history</Text>
          <Text style={styles.historyEmptyText}>{historyError}</Text>
          <MotionPressable style={styles.historyRetryButton} onPress={() => { void loadHistory(); }} accessibilityRole="button">
            <Text style={styles.historyRetryText}>Try again</Text>
          </MotionPressable>
        </View>
      ) : (
        <FlatList
          data={visibleHistoryRecords}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.historyList}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refreshHistory(); }} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
          ListHeaderComponent={
            <View>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle}>Attendance History</Text>
                <Text style={styles.historySubtitle}>Track your attendance, review past events, and monitor your progress.</Text>
              </View>
              <StudentAttendanceOverview stats={attendanceStats} />
              <View style={styles.historySearchBox}>
                <Ionicons name="search-outline" size={18} color={COLORS.textMuted} />
                <TextInput
                  style={styles.historySearchInput}
                  value={historySearch}
                  onChangeText={setHistorySearch}
                  placeholder="Search event or code"
                  placeholderTextColor={COLORS.textMuted}
                  returnKeyType="search"
                  accessibilityLabel="Search attendance history by event name or code"
                />
                {historySearch.length > 0 ? (
                  <MotionPressable
                    onPress={() => setHistorySearch('')}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                  </MotionPressable>
                ) : null}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyFilters}>
                {(['all', 'present', 'late', 'absent', 'excused'] as const).map((filter) => (
                  <MotionPressable
                    key={filter}
                    style={[styles.historyFilter, statusFilter === filter && styles.historyFilterSelected]}
                    onPress={() => setStatusFilter(filter)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: statusFilter === filter }}
                  >
                    <Text style={[styles.historyFilterText, statusFilter === filter && styles.historyFilterTextSelected]}>
                      {filter === 'all' ? 'All statuses' : filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </Text>
                  </MotionPressable>
                ))}
              </ScrollView>
              <MotionPressable
                style={styles.historyDateFilter}
                onPress={() => setCurrentMonthOnly((current) => !current)}
                accessibilityRole="button"
                accessibilityState={{ selected: currentMonthOnly }}
              >
                <Ionicons name="calendar-outline" size={15} color={COLORS.primary} />
                <Text style={styles.historyDateFilterText}>{currentMonthOnly ? 'Showing this month' : 'All dates'}</Text>
                <Text style={styles.historyDateFilterAction}>{currentMonthOnly ? 'Show all' : 'This month'}</Text>
              </MotionPressable>
              <Text style={styles.historyCount}>
                {visibleHistoryRecords.length} of {records.length} event{records.length === 1 ? '' : 's'}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.historyEmpty}>
              <View style={styles.historyEmptyIcon}>
                <Ionicons name={records.length === 0 ? 'time-outline' : 'search-outline'} size={23} color={COLORS.primary} />
              </View>
              <Text style={styles.historyEmptyTitle}>{records.length === 0 ? 'No attendance yet' : 'No matching events'}</Text>
              <Text style={styles.historyEmptyText}>
                {records.length === 0
                  ? 'Your attendance outcomes will appear here after events are finalized.'
                  : 'Try another search or filter to find an attendance record.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <AttendanceHistoryCard record={item} onViewDetails={() => setSelectedHistoryRecord(item)} />
          )}
        />
      )}
      <StudentAttendanceDetailsModal
        record={selectedHistoryRecord}
        onClose={() => setSelectedHistoryRecord(null)}
      />
    </View>
  );
}

function AttendanceHistoryCard({ record, onViewDetails }: { record: AttendanceRecord; onViewDetails: () => void }) {
  const [descriptionWidth, setDescriptionWidth] = useState(0);
  const [descriptionHasMore, setDescriptionHasMore] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  return (
    <View style={styles.historyCard}>
      <View style={styles.historyCardHeader}>
        <View style={styles.historyCardHeading}>
          <Text style={styles.historyEventTitle}>{record.eventTitle || 'Untitled event'}</Text>
          <Text style={styles.historyReference}>Attendance ref · {record.displayId || shortId(record.id)}</Text>
        </View>
        <StatusBadge status={record.status} shape="subtle" />
      </View>
      <Text style={styles.historyFinalization}>
        {record.attendanceFinalized ? 'Attendance finalized' : 'Pending finalization'}
      </Text>

      <View style={styles.historyDivider} />

      <View style={styles.historyDetails}>
        {record.eventId ? (
          <View style={styles.historyDetailRow}>
            <Text style={styles.historyDetailLabel}>Event code</Text>
            <Text style={styles.historyDetailValue}>{record.eventId}</Text>
          </View>
        ) : null}
        {record.venue ? (
          <View style={styles.historyDetailRow}>
            <View style={styles.historyDetailLabelWithIcon}>
              <Ionicons name="location-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.historyDetailLabel}>Venue</Text>
            </View>
            <Text style={styles.historyDetailValue}>{record.venue}</Text>
          </View>
        ) : null}
        {record.creatorName ? (
          <View style={styles.historyDetailRow}>
            <Text style={styles.historyDetailLabel}>Created by</Text>
            <Text style={styles.historyDetailValue}>{record.creatorName}</Text>
          </View>
        ) : null}
        {record.eventStartTime ? (
          <View style={styles.historyDetailRow}>
            <View style={styles.historyDetailLabelWithIcon}>
              <Ionicons name="calendar-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.historyDetailLabel}>Event date</Text>
            </View>
            <Text style={styles.historyDetailValue}>{formatDate(record.eventStartTime)}</Text>
          </View>
        ) : null}
        <View style={styles.historyDetailRow}>
          <View style={styles.historyDetailLabelWithIcon}>
            <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
            <Text style={styles.historyDetailLabel}>
              {record.status === 'absent' ? 'Recorded absent' : record.status === 'late' ? 'Checked in late' : record.status === 'excused' ? 'Marked excused' : 'Checked in'}
            </Text>
          </View>
          <Text style={styles.historyDetailValue}>{formatDate(record.recordedAt ?? record.scannedAt)}</Text>
        </View>
      </View>

      {record.description ? (
        <View
          style={styles.historyDescriptionContainer}
          onLayout={(event) => setDescriptionWidth(Math.max(0, event.nativeEvent.layout.width))}
        >
          <Text
            style={styles.historyDescription}
            numberOfLines={descriptionExpanded ? undefined : 3}
          >
            {record.description}
          </Text>
          {descriptionWidth > 0 && (
            <Text
              style={[styles.historyDescription, styles.historyDescriptionMeasure, { width: descriptionWidth }]}
              onTextLayout={(event) => setDescriptionHasMore(event.nativeEvent.lines.length > 3)}
              accessible={false}
            >
              {record.description}
            </Text>
          )}
          {descriptionHasMore ? (
            <MotionPressable
              onPress={() => setDescriptionExpanded((expanded) => !expanded)}
              accessibilityRole="button"
              accessibilityState={{ expanded: descriptionExpanded }}
              hitSlop={6}
            >
              <Text style={styles.historyReadMore}>{descriptionExpanded ? 'Show less' : 'Read more'}</Text>
            </MotionPressable>
          ) : null}
        </View>
      ) : null}
      <MotionPressable
        style={styles.historyDetailsAction}
        onPress={onViewDetails}
        accessibilityRole="button"
        accessibilityLabel={`View details for ${record.eventTitle || 'event'}`}
      >
        <Text style={styles.historyDetailsActionText}>View event details</Text>
        <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
      </MotionPressable>
    </View>
  );
}

function StudentAttendanceOverview({ stats }: { stats: ReturnType<typeof calculateStudentAttendanceStats> }) {
  const metrics = [
    { label: 'Total eligible events', value: stats.eligibleEvents, icon: 'calendar-outline' as const, color: COLORS.primary },
    { label: 'Present', value: stats.present, icon: 'checkmark-circle-outline' as const, color: COLORS.success },
    { label: 'Absent', value: stats.absent, icon: 'close-circle-outline' as const, color: COLORS.danger },
    { label: 'Late', value: stats.late, icon: 'time-outline' as const, color: COLORS.warning },
  ];
  const monthInsight = stats.currentMonthRate === null
    ? 'No finalized attendance outcomes recorded this month.'
    : `This month: ${stats.currentMonthAttended} of ${stats.currentMonthEligible} eligible events attended (${stats.currentMonthRate}%).`;
  const streakInsight = stats.currentStreak > 0
    ? `${stats.currentStreak} consecutive ${stats.currentStreakType === 'attended' ? 'attended' : 'absent'} event${stats.currentStreak === 1 ? '' : 's'}`
    : stats.totalEvents === 0
      ? 'Your attendance insights will appear after finalized events are available.'
      : 'No current attendance streak.';

  return (
    <View style={styles.historyOverview}>
      <View style={styles.historyMetricGrid}>
        {metrics.map(({ label, value, icon, color }) => (
          <View key={label} style={styles.historyMetricCard}>
            <View style={[styles.historyMetricIcon, { backgroundColor: `${color}18` }]}>
              <Ionicons name={icon} size={17} color={color} />
            </View>
            <Text style={styles.historyMetricValue}>{value}</Text>
            <Text style={styles.historyMetricLabel}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.historyRateHeader}>
        <View>
          <Text style={styles.historySectionLabel}>Attendance rate</Text>
          <Text style={styles.historyRateValue}>{stats.attendanceRate === null ? '—' : `${stats.attendanceRate}%`}</Text>
        </View>
        <View style={styles.historyRateMeta}>
          <Text style={styles.historyRateMetaText}>
            {stats.attendanceRate === null
              ? 'No finalized eligible events yet'
              : `You attended ${stats.attended} out of ${stats.eligibleEvents} eligible events.`}
          </Text>
        </View>
      </View>
      <View
        style={styles.historyRateTrack}
        accessibilityRole="progressbar"
        accessibilityLabel="Attendance rate"
        accessibilityValue={stats.attendanceRate === null ? undefined : { min: 0, max: 100, now: stats.attendanceRate }}
      >
        {stats.attendanceRate !== null ? (
          <View style={[styles.historyRateProgress, { width: `${stats.attendanceRate}%` }]} />
        ) : null}
      </View>
      <Text style={styles.historyRateNote}>
        Recorded present and late check-ins update immediately. Absences count only after finalization; excused outcomes are excluded from the rate.
      </Text>

      <View style={styles.historyInsight}>
        <View style={styles.historyInsightTextWrap}>
          <View style={styles.historyInsightTitleRow}>
            <Ionicons name="analytics-outline" size={19} color={COLORS.primary} />
            <Text style={styles.historyInsightTitle}>Attendance Insights</Text>
          </View>
          <Text style={styles.historyInsightText}>{monthInsight}</Text>
          <Text style={styles.historyInsightText}>{streakInsight}</Text>
        </View>
      </View>
    </View>
  );
}

function StudentAttendanceDetailsModal({
  record,
  onClose,
}: {
  record: AttendanceRecord | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={!!record} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.studentDetailsBackdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.studentDetailsModal}>
          <View style={styles.studentDetailsHeader}>
            <View style={styles.studentDetailsHeading}>
              <Text style={styles.studentDetailsEyebrow}>ATTENDANCE RECORD</Text>
              <Text style={styles.studentDetailsTitle}>{record?.eventTitle || 'Event details'}</Text>
              {record?.eventId ? <Text style={styles.studentDetailsCode}>{record.eventId}</Text> : null}
            </View>
            <MotionPressable
              style={styles.closeIconButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close event details"
              hitSlop={8}
            >
              <Text style={styles.close}>×</Text>
            </MotionPressable>
          </View>
          {record ? (
            <>
              <View style={styles.studentDetailsStatus}>
                <StatusBadge status={record.status} shape="subtle" />
              </View>
              <ScrollView style={styles.studentDetailsScroll} showsVerticalScrollIndicator={false}>
                <HistoryDetail
                  label="Attendance finalization"
                  value={record.attendanceFinalized ? 'Finalized' : 'Pending finalization'}
                  icon={record.attendanceFinalized ? 'checkmark-circle-outline' : 'time-outline'}
                />
                {record.eventStartTime ? <HistoryDetail label="Event date and time" value={formatDate(record.eventStartTime)} icon="calendar-outline" /> : null}
                <HistoryDetail
                  label={record.status === 'absent' ? 'Attendance recorded' : 'Checked in'}
                  value={formatDate(record.recordedAt ?? record.scannedAt)}
                  icon="time-outline"
                />
                {record.creatorName ? <HistoryDetail label="Organizer" value={record.creatorName} icon="person-outline" /> : null}
                {record.venue ? <HistoryDetail label="Venue" value={record.venue} icon="location-outline" /> : null}
                {record.description ? (
                  <View style={styles.studentDetailsDescription}>
                    <Text style={styles.studentDetailsDescriptionLabel}>Event description</Text>
                    <Text style={styles.studentDetailsDescriptionText}>{record.description}</Text>
                  </View>
                ) : null}
              </ScrollView>
            </>
          ) : null}
          <MotionPressable style={styles.closeButton} onPress={onClose} accessibilityRole="button">
            <Text style={styles.closeButtonText}>Close</Text>
          </MotionPressable>
        </View>
      </View>
    </Modal>
  );
}

function HistoryDetail({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ComponentProps<typeof Ionicons>['name'];
}) {
  return (
    <View style={styles.studentDetailsRow}>
      <View style={styles.studentDetailsLabel}>
        <Ionicons name={icon} size={15} color={COLORS.textMuted} />
        <Text style={styles.studentDetailsLabelText}>{label}</Text>
      </View>
      <Text style={styles.studentDetailsValue}>{value}</Text>
    </View>
  );
}

function formatAttendanceReportSummary(summary: EventAttendanceSummary) {
  const parts = [
    `${summary.total} ${summary.total === 1 ? 'student' : 'students'}`,
    `${summary.present} present`,
    `${summary.late} late`,
    `${summary.absent} absent`,
  ];
  if (summary.pending > 0) parts.push(`${summary.pending} pending`);
  if (summary.excused > 0) parts.push(`${summary.excused} excused`);
  return parts.join(' · ');
}

function AttendanceReportMetrics({ summary, error }: { summary: EventAttendanceSummary | null; error?: string }) {
  return (
    <View style={styles.adminAttendanceMetrics}>
      <View style={styles.adminMetricOverview}>
        {summary ? (
          <View style={styles.adminStudentCount}>
            <Ionicons name="people-outline" size={15} color={COLORS.primaryLight} />
            <Text style={styles.adminStudentCountText} numberOfLines={1}>
              {summary.total} {summary.total === 1 ? 'student' : 'students'}
            </Text>
          </View>
        ) : <Text style={styles.adminSummaryError} numberOfLines={2}>{error ?? 'Attendance summary unavailable.'}</Text>}
        <View style={styles.adminViewDetails}>
          <Text style={styles.adminViewDetailsText}>View</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.primary} />
        </View>
      </View>
      {summary && <View style={styles.adminMetricChips}>
        <View style={[styles.adminMetricChip, styles.adminPresentChip]}>
          <Text style={[styles.adminMetricChipText, styles.adminPresentText]}>{summary.present} present</Text>
        </View>
        <View style={[styles.adminMetricChip, styles.adminAbsentChip]}>
          <Text style={[styles.adminMetricChipText, styles.adminAbsentText]}>{summary.absent} absent</Text>
        </View>
        {summary.late > 0 && <View style={[styles.adminMetricChip, styles.adminLateChip]}>
          <Text style={[styles.adminMetricChipText, styles.adminLateText]}>{summary.late} late</Text>
        </View>}
        {summary.excused > 0 && <View style={[styles.adminMetricChip, styles.adminExcusedChip]}>
          <Text style={[styles.adminMetricChipText, styles.adminExcusedText]}>{summary.excused} excused</Text>
        </View>}
        <View style={[styles.adminMetricChip, styles.adminPendingChip]}>
          <Text style={[styles.adminMetricChipText, styles.adminPendingText]}>{summary.pending} pending</Text>
        </View>
      </View>}
    </View>
  );
}

function attendanceReportAccessibilityLabel(event: AttendanceReportEvent) {
  const summary = event.summary
    ? formatAttendanceReportSummary(event.summary)
    : event.countError ?? 'Attendance summary unavailable.';
  return `${event.title}, ${summary}, event ${event.status}, attendance ${event.attendanceFinalized ? 'finalized' : 'pending finalization'}`;
}

function TeacherAttendanceModal({
  event,
  summary,
  loading,
  error,
  onClose,
}: {
  event: AttendanceReportEvent | null;
  summary: EventAttendanceSummary | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const modalProgress = useRef(new Animated.Value(0)).current;
  const closeButtonScale = useRef(new Animated.Value(1)).current;
  const insets = useSafeAreaInsets();
  const rosterStudents = [...(summary?.students ?? [])].sort((left, right) => {
    const leftPending = left.status === null ? 1 : 0;
    const rightPending = right.status === null ? 1 : 0;
    return leftPending - rightPending || (left.full_name ?? '').localeCompare(right.full_name ?? '');
  });

  useEffect(() => {
    if (!event) return;

    modalProgress.setValue(0);
    const animation = Animated.timing(modalProgress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();

    return () => animation.stop();
  }, [event?.eventId, modalProgress]);

  const animateCloseButton = (toValue: number) => {
    Animated.spring(closeButtonScale, {
      toValue,
      useNativeDriver: Platform.OS !== 'web',
      speed: 24,
      bounciness: 5,
    }).start();
  };

  return <Modal visible={!!event} transparent animationType="fade" onRequestClose={onClose}>
    <View style={[styles.modalBackdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <Animated.View style={[styles.modalCard, {
        opacity: modalProgress,
        transform: [
          { translateY: modalProgress.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
          { scale: modalProgress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) },
        ],
      }]}>
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderText}>
            <Text style={styles.modalTitle} numberOfLines={2}>{event?.title}</Text>
            <Text style={styles.modalCode}>{event?.eventCode}</Text>
            <Text style={styles.modalEventStatus}>
              Event: {event?.status === 'open' ? 'Open' : 'Closed'} · Attendance: {event?.attendanceFinalized ? 'Finalized' : 'Pending Finalization'}
            </Text>
          </View>
          <MotionPressable
            style={styles.closeIconButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close attendance details"
            hitSlop={8}
          >
            <Text style={styles.close}>×</Text>
          </MotionPressable>
        </View>
        <Text style={styles.modalSubtitle}>
          {summary
            ? formatAttendanceReportSummary(summary)
            : error ? 'Attendance details unavailable.' : 'Loading attendance details...'}
        </Text>
        {event && event.status === 'open' && !loading && !error && summary && <View style={styles.liveTracking}><View style={styles.liveTrackingDot} /><Text style={styles.liveTrackingText}>Live tracking · updates every 10 seconds</Text></View>}
        {loading ? <ActivityIndicator color={COLORS.primary} style={styles.modalLoader} /> : error ? <Text style={styles.attendanceError}>{error}</Text> : rosterStudents.length === 0 ? <Text style={styles.subtitle}>{summary?.total === 0 ? 'No eligible students were found for this event.' : 'No attendance statuses have been recorded yet.'}</Text> : <>
          <View style={styles.rosterHeading}>
            <Text style={styles.rosterTitle}>Student check-in status</Text>
            <Text style={styles.rosterPendingCount}>{summary?.pending ?? 0} pending</Text>
          </View>
          <FlatList
            data={rosterStudents}
            keyExtractor={(student) => student.id}
            style={styles.attendeeList}
            renderItem={({ item }) => {
              const statusLabel = item.status ? item.status.toUpperCase() : 'PENDING';
              return <View style={styles.attendeeItem}>
                <View style={styles.attendeeInfo}>
                  <Text style={styles.attendeeName} numberOfLines={2}>{item.full_name || 'Unnamed student'}</Text>
                  <Text style={styles.attendeeMeta}>{item.display_id || item.email}</Text>
                </View>
                <View style={[
                  styles.attendeeStatusPill,
                  !item.status && styles.attendeeStatusPendingPill,
                  item.status === 'absent' && styles.attendeeStatusAbsentPill,
                  item.status === 'late' && styles.attendeeStatusLatePill,
                  item.status === 'excused' && styles.attendeeStatusExcusedPill,
                ]}>
                  <Text style={[
                    styles.attendeeStatus,
                    !item.status && styles.attendeeStatusPending,
                    item.status === 'absent' && styles.attendeeStatusAbsent,
                    item.status === 'late' && styles.attendeeStatusLate,
                    item.status === 'excused' && styles.attendeeStatusExcused,
                  ]}>{statusLabel}</Text>
                </View>
              </View>;
            }}
          />
        </>}
        <Animated.View style={{ transform: [{ scale: closeButtonScale }] }}>
          <MotionPressable
            style={styles.closeButton}
            onPress={onClose}
            onPressIn={() => animateCloseButton(0.97)}
            onPressOut={() => animateCloseButton(1)}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </MotionPressable>
        </Animated.View>
      </Animated.View>
    </View>
  </Modal>;
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function shortId(id: string) {
  return id ? `…${id.slice(-8)}` : 'unknown';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontFamily: FONTS.regular,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 32,
  },
  adminSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontFamily: FONTS.regular,
    marginTop: 4,
    lineHeight: 19,
  },
  adminHeader: { marginBottom: 20 },
  adminEyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: '800', fontFamily: FONTS.extraBold, letterSpacing: 1.1, marginBottom: 4 },
  adminTitle: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800', fontFamily: FONTS.extraBold, letterSpacing: -0.4 },
  adminList: { paddingBottom: 28 },
  adminEventCard: { backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 10 },
  adminCardPressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  adminEventTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  adminEventInfo: { flex: 1, minWidth: 0 },
  adminEventTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700', fontFamily: FONTS.bold, letterSpacing: -0.15 },
  adminEventCode: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, marginTop: 4 },
  adminCardFooter: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 11, paddingTop: 10 },
  adminAttendanceMetrics: { minWidth: 0, gap: 8 },
  adminMetricOverview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  adminStudentCount: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  adminStudentCountText: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, fontFamily: FONTS.medium, flexShrink: 1 },
  adminMetricChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  adminMetricChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  adminMetricChipText: { fontSize: 11, lineHeight: 15, fontFamily: FONTS.medium },
  adminPresentChip: { borderColor: `${COLORS.statusPresent}30`, backgroundColor: `${COLORS.statusPresent}10` },
  adminPresentText: { color: COLORS.statusPresent },
  adminAbsentChip: { borderColor: `${COLORS.statusAbsent}30`, backgroundColor: `${COLORS.statusAbsent}10` },
  adminAbsentText: { color: COLORS.statusAbsent },
  adminLateChip: { borderColor: `${COLORS.statusLate}30`, backgroundColor: `${COLORS.statusLate}10` },
  adminLateText: { color: COLORS.statusLate },
  adminExcusedChip: { borderColor: `${COLORS.primary}30`, backgroundColor: `${COLORS.primary}10` },
  adminExcusedText: { color: COLORS.primaryLight },
  adminPendingChip: { borderColor: `${COLORS.textMuted}30`, backgroundColor: `${COLORS.surfaceRaised}80` },
  adminPendingText: { color: COLORS.textSecondary },
  adminSummaryError: { flex: 1, minWidth: 0, color: COLORS.danger, fontSize: 12, lineHeight: 18, fontFamily: FONTS.regular },
  adminFinalizationStatus: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 8, marginTop: 9 },
  adminFinalizedStatus: { backgroundColor: `${COLORS.success}12`, borderColor: `${COLORS.success}35` },
  adminFinalizationText: { flex: 1, minWidth: 0, color: COLORS.textSecondary, fontSize: 11, lineHeight: 16, fontFamily: FONTS.regular },
  adminFinalizedText: { color: COLORS.success, fontFamily: FONTS.medium },
  adminViewDetails: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 8, borderRadius: 8, flexShrink: 0 },
  adminViewDetailsText: { color: COLORS.primaryLight, fontSize: 12, fontWeight: '700', fontFamily: FONTS.bold },
  adminLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 28 },
  adminLoadingText: { color: COLORS.textSecondary, fontSize: 13 },
  adminNotice: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: `${COLORS.danger}18`, borderColor: `${COLORS.danger}55`, borderWidth: 1, borderRadius: 13, padding: 13 },
  adminError: { flex: 1, color: COLORS.danger, fontSize: 13, fontFamily: FONTS.regular, lineHeight: 19 },
  adminEmpty: { alignItems: 'center', backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 14, padding: 20, marginTop: 4 },
  adminEmptyTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700', fontFamily: FONTS.bold },
  adminEmptyText: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  error: { fontSize: 14, color: COLORS.danger, lineHeight: 20, marginTop: 20 },
  list: {
    paddingBottom: 24,
  },
  historyHeader: { marginBottom: 20 },
  historyTitle: { color: COLORS.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', fontFamily: FONTS.bold, letterSpacing: -0.45 },
  historySubtitle: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, fontFamily: FONTS.regular, marginTop: 4 },
  historyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 36 },
  historyStateText: { color: COLORS.textSecondary, fontSize: 13, fontFamily: FONTS.regular },
  historyEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 48 },
  historyEmptyIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  historyEmptyTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', fontFamily: FONTS.bold },
  historyEmptyText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, fontFamily: FONTS.regular, textAlign: 'center', marginTop: 6, maxWidth: 280 },
  historyLoadError: { flex: 1 },
  historyRetryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, marginTop: 12, borderRadius: 10, backgroundColor: COLORS.primaryButtonStart },
  historyRetryText: { color: COLORS.textOnPrimary, fontSize: 14, fontFamily: FONTS.semiBold },
  historyList: { paddingBottom: 28, flexGrow: 1 },
  historyCount: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600', fontFamily: FONTS.semiBold, marginBottom: 9 },
  historyOverview: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 16 },
  historyMetricGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 15 },
  historyMetricCard: { width: '48%', minHeight: 82, justifyContent: 'center', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  historyMetricIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  historyMetricValue: { color: COLORS.textPrimary, fontSize: 19, lineHeight: 23, fontWeight: '800', fontFamily: FONTS.extraBold, marginTop: 4 },
  historyMetricLabel: { color: COLORS.textSecondary, fontSize: 10, lineHeight: 14, fontFamily: FONTS.medium, marginTop: 1 },
  historyRateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  historySectionLabel: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: FONTS.bold },
  historyRateValue: { color: COLORS.textPrimary, fontSize: 28, lineHeight: 34, fontWeight: '800', fontFamily: FONTS.extraBold, marginTop: 3 },
  historyRateMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, justifyContent: 'flex-end' },
  historyRateMetaText: { color: COLORS.textSecondary, fontSize: 11, lineHeight: 15, fontFamily: FONTS.medium, textAlign: 'right', flexShrink: 1 },
  historyRateTrack: { height: 8, borderRadius: 99, overflow: 'hidden', backgroundColor: COLORS.surface, marginTop: 11 },
  historyRateProgress: { height: '100%', borderRadius: 99, backgroundColor: COLORS.primary },
  historyRateNote: { color: COLORS.textMuted, fontSize: 10, lineHeight: 15, fontFamily: FONTS.regular, marginTop: 8 },
  historyInsight: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: `${COLORS.primary}12`, borderRadius: 11, padding: 10, marginTop: 13 },
  historyInsightTextWrap: { flex: 1, gap: 4 },
  historyInsightTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyInsightTitle: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '700', fontFamily: FONTS.bold, marginBottom: 1 },
  historyInsightText: { color: COLORS.textSecondary, fontSize: 11, lineHeight: 16, fontFamily: FONTS.regular },
  historySearchBox: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginBottom: 10 },
  historySearchInput: { flex: 1, minWidth: 0, height: 44, color: COLORS.textPrimary, fontSize: 13, fontFamily: FONTS.regular, paddingVertical: 0 },
  historyFilters: { gap: 7, paddingBottom: 10 },
  historyFilter: { minHeight: 36, justifyContent: 'center', borderRadius: 999, paddingHorizontal: 13, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  historyFilterSelected: { backgroundColor: `${COLORS.primary}22`, borderColor: `${COLORS.primary}88` },
  historyFilterText: { color: COLORS.textSecondary, fontSize: 11, fontFamily: FONTS.medium },
  historyFilterTextSelected: { color: COLORS.primary, fontFamily: FONTS.bold },
  historyDateFilter: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 38, marginBottom: 12 },
  historyDateFilterText: { color: COLORS.textSecondary, fontSize: 11, fontFamily: FONTS.medium, flex: 1 },
  historyDateFilterAction: { color: COLORS.primary, fontSize: 11, fontFamily: FONTS.semiBold },
  historyCard: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  historyCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  historyCardHeading: { flex: 1, minWidth: 0 },
  historyEventTitle: { color: COLORS.textPrimary, fontSize: 16, lineHeight: 21, fontWeight: '700', fontFamily: FONTS.bold },
  historyReference: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, fontFamily: FONTS.regular, marginTop: 3 },
  historyFinalization: { color: COLORS.textMuted, fontSize: 10, fontFamily: FONTS.medium, marginTop: 5 },
  historyDivider: { height: 1, backgroundColor: COLORS.border, marginTop: 12, marginBottom: 10 },
  historyDetails: { gap: 7 },
  historyDetailRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 },
  historyDetailLabelWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  historyDetailLabel: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, fontFamily: FONTS.regular },
  historyDetailValue: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, fontFamily: FONTS.medium, textAlign: 'right' },
  historyDescriptionContainer: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 11, paddingTop: 9, position: 'relative' },
  historyDescription: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, fontFamily: FONTS.regular },
  historyDescriptionMeasure: { position: 'absolute', top: 9, left: 0, opacity: 0 },
  historyReadMore: { alignSelf: 'flex-start', color: COLORS.primary, fontSize: 12, fontWeight: '600', fontFamily: FONTS.semiBold, marginTop: 5 },
  historyDetailsAction: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 38, borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 10, paddingTop: 7 },
  historyDetailsActionText: { color: COLORS.primary, fontSize: 12, fontWeight: '700', fontFamily: FONTS.bold },
  studentDetailsBackdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  studentDetailsModal: { width: '100%', maxHeight: '100%', backgroundColor: COLORS.background, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 16 },
  studentDetailsHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  studentDetailsHeading: { flex: 1, minWidth: 0 },
  studentDetailsEyebrow: { color: COLORS.primary, fontSize: 9, fontWeight: '800', fontFamily: FONTS.extraBold, letterSpacing: 1 },
  studentDetailsTitle: { color: COLORS.textPrimary, fontSize: 19, lineHeight: 25, fontWeight: '800', fontFamily: FONTS.extraBold, marginTop: 4 },
  studentDetailsCode: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, marginTop: 3 },
  studentDetailsStatus: { alignSelf: 'flex-start', marginTop: 10 },
  studentDetailsScroll: { flexShrink: 1, minHeight: 0, marginTop: 5 },
  studentDetailsRow: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingVertical: 12, gap: 7 },
  studentDetailsLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  studentDetailsLabelText: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15, fontFamily: FONTS.medium },
  studentDetailsValue: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 19, fontFamily: FONTS.semiBold },
  studentDetailsDescription: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12, paddingBottom: 4 },
  studentDetailsDescriptionLabel: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15, fontFamily: FONTS.medium },
  studentDetailsDescriptionText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, fontFamily: FONTS.regular, marginTop: 6 },
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  eventMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontFamily: FONTS.regular,
    marginTop: 2,
  },
  description: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontFamily: FONTS.regular,
    lineHeight: 19,
    marginTop: 6,
  },
  modalBackdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  modalCard: { width: '100%', backgroundColor: COLORS.background, borderRadius: 16, padding: 16, maxHeight: '100%', minHeight: 0, borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  modalHeaderText: { flex: 1, minWidth: 0 },
  modalTitle: { color: COLORS.textPrimary, fontSize: 19, lineHeight: 24, fontWeight: '800', fontFamily: FONTS.extraBold },
  modalCode: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, marginTop: 3 },
  modalEventStatus: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, fontFamily: FONTS.medium, marginTop: 5 },
  closeIconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: -8, marginRight: -8 },
  close: { color: COLORS.textPrimary, fontSize: 30, lineHeight: 28 },
  modalSubtitle: { color: COLORS.primary, fontSize: 13, lineHeight: 19, fontWeight: '700', fontFamily: FONTS.bold, marginTop: 12, marginBottom: 6 },
  liveTracking: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 6 },
  liveTrackingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.success },
  liveTrackingText: { color: COLORS.success, fontSize: 11, fontFamily: FONTS.medium },
  rosterHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 6 },
  rosterTitle: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '700', fontFamily: FONTS.bold },
  rosterPendingCount: { color: COLORS.warning, fontSize: 11, fontWeight: '700', fontFamily: FONTS.bold },
  attendanceError: { color: COLORS.danger, fontSize: 13, lineHeight: 19, fontFamily: FONTS.regular, marginVertical: 16 },
  modalLoader: { marginVertical: 24 },
  attendeeList: { marginTop: 4, maxHeight: 360, flexShrink: 1, minHeight: 0 },
  attendeeItem: { backgroundColor: COLORS.card, borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderWidth: 1, borderColor: `${COLORS.border}88`, gap: 10 },
  attendeeInfo: { flex: 1, minWidth: 0 },
  attendeeName: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 18, fontWeight: '700', fontFamily: FONTS.bold },
  attendeeMeta: { color: COLORS.textSecondary, fontSize: 11, fontFamily: FONTS.regular, marginTop: 3 },
  attendeeStatusPill: { flexShrink: 0, backgroundColor: `${COLORS.success}1A`, borderWidth: 1, borderColor: `${COLORS.success}55`, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  attendeeStatusPendingPill: { backgroundColor: `${COLORS.warning}1A`, borderColor: `${COLORS.warning}55` },
  attendeeStatus: { color: COLORS.success, fontSize: 10, fontWeight: '800', fontFamily: FONTS.bold },
  attendeeStatusPending: { color: COLORS.warning },
  attendeeStatusAbsentPill: { backgroundColor: `${COLORS.danger}1A`, borderColor: `${COLORS.danger}55` },
  attendeeStatusAbsent: { color: COLORS.danger },
  attendeeStatusLatePill: { backgroundColor: `${COLORS.warning}1A`, borderColor: `${COLORS.warning}55` },
  attendeeStatusLate: { color: COLORS.warning },
  attendeeStatusExcusedPill: { backgroundColor: `${COLORS.primary}1A`, borderColor: `${COLORS.primary}55` },
  attendeeStatusExcused: { color: COLORS.primary },
  closeButton: { backgroundColor: COLORS.primaryButtonStart, borderRadius: 12, minHeight: 44, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10, flexShrink: 0 },
  closeButtonText: { color: COLORS.textOnPrimary, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  attendeeCount: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', fontFamily: FONTS.bold },
  attendeeRow: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
});
