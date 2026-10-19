import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import MotionPressable from '@/components/MotionPressable';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useAuth } from '@/lib/auth';
import { subscribeToSupabaseDataChanges } from '@/lib/supabaseRealtime';
import { animateLayoutChange } from '@/lib/motion';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AppButton from '@/components/AppButton';
import AppTextInput from '@/components/AppTextInput';
import StatusBadge from '@/components/StatusBadge';
import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import {
  buildAttendanceCsv,
  buildAttendanceFilename,
  formatCsvDatePH,
} from '@/lib/attendanceCsv';
import {
  getAcademicSections,
  getCourses,
  getEventAudienceConfig,
  getEventAttendanceSummary,
  getEventAttendanceCorrections,
  getEventAttendanceExportPage,
  clearEventAttendance,
  getYearLevels,
  recordEventAttendance,
  type AcademicSection,
  type AttendanceExportRecord,
  type Course,
  type EventAttendanceSummary,
  type AttendanceCorrection,
  type EventAudienceScope,
  type EventAudienceConfig,
  type YearLevel,
} from '@/lib/academic';

type EventChoice = { id: string; title: string; event_code?: string; start_time?: string | null; end_time?: string | null };
const ATTENDANCE_SUMMARY_TIMEOUT_MS = 15000;

function isSameAudienceConfig(left: EventAudienceConfig | null, right: EventAudienceConfig) {
  return left?.mode === right.mode
    && left.scope.courseIds.length === right.scope.courseIds.length
    && left.scope.courseIds.every((id, index) => id === right.scope.courseIds[index])
    && left.scope.yearLevelIds.length === right.scope.yearLevelIds.length
    && left.scope.yearLevelIds.every((id, index) => id === right.scope.yearLevelIds[index])
    && left.scope.sectionIds.length === right.scope.sectionIds.length
    && left.scope.sectionIds.every((id, index) => id === right.scope.sectionIds[index])
    && left.groups.length === right.groups.length
    && left.groups.every((group, index) => (
      group.courseId === right.groups[index]?.courseId
      && group.yearLevelId === right.groups[index]?.yearLevelId
      && group.sectionId === right.groups[index]?.sectionId
    ));
}

export default function EventAttendanceManager({
  events,
  expanded,
  onExpandedChange,
  description,
}: {
  events: EventChoice[];
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  description?: string;
}) {
  const { session } = useAuth();
  const reduceMotion = useReducedMotion();
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = expanded ?? internalExpanded;
  const [selectedEventId, setSelectedEventId] = useState<string | null>(events[0]?.id ?? null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [yearLevels, setYearLevels] = useState<YearLevel[]>([]);
  const [sections, setSections] = useState<AcademicSection[]>([]);
  const [audienceConfig, setAudienceConfig] = useState<EventAudienceConfig | null>(null);
  const [audienceLoaded, setAudienceLoaded] = useState(false);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [courseId, setCourseId] = useState('');
  const [yearLevelId, setYearLevelId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<EventAttendanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryRetry, setSummaryRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<AttendanceCorrection[] | null>(null);
  const [correctionsLoading, setCorrectionsLoading] = useState(false);
  const [correctionsError, setCorrectionsError] = useState<string | null>(null);
  const correctionsRequestId = useRef(0);

  useEffect(() => {
    if (!selectedEventId && events[0]) setSelectedEventId(events[0].id);
    if (selectedEventId && !events.some((event) => event.id === selectedEventId)) setSelectedEventId(events[0]?.id ?? null);
  }, [events, selectedEventId]);
  useEffect(() => { Promise.all([getCourses(), getYearLevels()]).then(([c, y]) => { setCourses(c); setYearLevels(y); }); }, []);
  useEffect(() => {
    setCourseId('');
    setYearLevelId('');
    setSectionId('');
    setAudienceConfig(null);
    setAudienceLoaded(false);
    setAudienceError(null);
  }, [selectedEventId]);
  useFocusEffect(useCallback(() => {
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    if (!selectedEventId) return () => { active = false; };
    const refreshAudience = () => {
      getEventAudienceConfig(selectedEventId, session).then((config) => {
        if (!active) return;
        setAudienceConfig((current) => isSameAudienceConfig(current, config) ? current : config);
        setAudienceLoaded(true);
        setAudienceError(null);
      }).catch((error: unknown) => {
        if (!active) return;
        console.error('Unable to refresh selected event eligibility settings.', error);
        setAudienceError(error instanceof Error ? error.message : 'Event eligibility settings could not be loaded.');
        setAudienceLoaded(true);
      });
    };
    refreshAudience();
    const unsubscribe = subscribeToSupabaseDataChanges(() => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshAudience, 200);
    });
    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [selectedEventId, session]));
  useEffect(() => {
    getAcademicSections().then(setSections);
    setSectionId('');
  }, []);
  const exportCount = useMemo(() => {
    if (!summary) return null;
    const needle = search.trim().toLocaleLowerCase();
    return summary.students.filter((student) => (
      student.attendance_id !== null
      && (!needle || `${student.full_name ?? ''} ${student.display_id ?? ''} ${student.email}`.toLocaleLowerCase().includes(needle))
    )).length;
  }, [search, summary]);
  useEffect(() => {
    setExportFeedback(null);
  }, [selectedEventId, courseId, yearLevelId, sectionId, status, search]);
  useEffect(() => {
    const requestId = ++correctionsRequestId.current;
    setCorrections(null);
    setCorrectionsError(null);
    setCorrectionsLoading(false);
    return () => {
      if (correctionsRequestId.current === requestId) correctionsRequestId.current += 1;
    };
  }, [selectedEventId]);

  const loadCorrections = async () => {
    if (!selectedEventId || correctionsLoading) return;
    const requestId = ++correctionsRequestId.current;
    setCorrectionsLoading(true);
    setCorrectionsError(null);
    try {
      const result = await getEventAttendanceCorrections(selectedEventId, session);
      if (requestId !== correctionsRequestId.current) return;
      setCorrections(result.data);
      setCorrectionsError(result.error);
    } catch (error) {
      if (requestId !== correctionsRequestId.current) return;
      console.error('Unable to load attendance correction history.', error);
      setCorrections(null);
      setCorrectionsError('Correction history could not be loaded. Please try again.');
    } finally {
      if (requestId === correctionsRequestId.current) setCorrectionsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    let timedOut = false;
    if (!selectedEventId || !audienceLoaded || !audienceConfig || audienceConfig.mode === 'legacy') {
      setSummary(null);
      setLoading(false);
      setSummaryError(null);
      return () => { active = false; };
    }
    setLoading(true);
    setSummary(null);
    setSummaryError(null);
    setMessage(null);
    const timeout = setTimeout(() => {
      timedOut = true;
      if (!active) return;
      console.error('The selected event attendance summary did not finish before the request deadline.');
      setLoading(false);
      setSummaryError('Attendance data is taking too long to load. Check your connection and try again.');
    }, ATTENDANCE_SUMMARY_TIMEOUT_MS);
    getEventAttendanceSummary(selectedEventId, { courseId, yearLevelId, sectionId, status: status || undefined }, session)
      .then((result) => {
        if (!active || timedOut) return;
        setSummary(result.data);
        setSummaryError(result.error);
      })
      .catch((error: unknown) => {
        if (!active || timedOut) return;
        console.error('Unable to load the selected event attendance summary.', error);
        setSummary(null);
        setSummaryError(errorMessage(error));
      })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [selectedEventId, audienceLoaded, audienceConfig, courseId, yearLevelId, sectionId, status, session, summaryRetry]);

  const visibleStudents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (summary?.students ?? []).filter((student) => !needle || `${student.full_name ?? ''} ${student.display_id ?? ''} ${student.email}`.toLowerCase().includes(needle));
  }, [summary, search]);

  const visibleCourses = useMemo(
    () => {
      if (!audienceLoaded || !audienceConfig) return [];
      if (audienceConfig.mode === 'all') return courses;
      if (audienceConfig.mode === 'legacy') return [];
      const eligibleCourseIds = new Set(audienceConfig.groups.map((group) => group.courseId));
      return courses.filter((item) => eligibleCourseIds.has(item.id));
    },
    [audienceLoaded, audienceConfig, courses],
  );
  const visibleYearLevels = useMemo(
    () => {
      if (!audienceLoaded || !audienceConfig) return [];
      if (audienceConfig.mode === 'all') {
        return yearLevels.filter((item) => sections.some((section) => section.year_level_id === item.id && (!courseId || section.course_id === courseId)));
      }
      if (audienceConfig.mode === 'legacy') return [];
      const eligibleYearIds = new Set(audienceConfig.groups
        .filter((group) => !courseId || group.courseId === courseId)
        .map((group) => group.yearLevelId));
      return yearLevels.filter((item) => eligibleYearIds.has(item.id));
    },
    [audienceLoaded, audienceConfig, yearLevels, sections, courseId],
  );
  const visibleSections = useMemo(
    () => {
      if (!audienceLoaded || !audienceConfig || audienceConfig.mode === 'legacy') return [];
      if (audienceConfig.mode === 'all') {
        return sections.filter((item) => (!courseId || item.course_id === courseId) && (!yearLevelId || item.year_level_id === yearLevelId));
      }
      const eligibleSectionIds = new Set(audienceConfig.groups
        .filter((group) => (!courseId || group.courseId === courseId) && (!yearLevelId || group.yearLevelId === yearLevelId))
        .map((group) => group.sectionId));
      return sections.filter((item) => eligibleSectionIds.has(item.id));
    },
    [audienceLoaded, audienceConfig, sections, courseId, yearLevelId],
  );

  const refresh = async () => {
    if (!selectedEventId) return;
    const result = await getEventAttendanceSummary(selectedEventId, { courseId, yearLevelId, sectionId, status: status || undefined }, session);
    setSummary(result.data); setMessage(result.error);
  };

  const mark = async (studentId: string, nextStatus: 'present' | 'absent' | 'late' | 'excused') => {
    setMessage(null);
    const result = summary?.students.find((student) => student.id === studentId)?.status === nextStatus
      ? await clearEventAttendance(selectedEventId!, studentId)
      : await recordEventAttendance(selectedEventId!, studentId, nextStatus);
    if (result.error) { setMessage(result.error); return; }
    await refresh();
  };

  const exportReport = async () => {
    if (!activeEvent || !selectedEventId || !summary || summaryError || exporting) return;
    setExporting(true);
    setExportFeedback(null);
    try {
      const filters = { courseId, yearLevelId, sectionId, status, search };
      const records: AttendanceExportRecord[] = [];
      let offset = 0;
      let expectedCount: number | null = null;
      const pageSize = 500;

      do {
        const result = await getEventAttendanceExportPage(selectedEventId, filters, offset, pageSize, session);
        if (result.error || !result.data) throw new Error(result.error ?? 'Could not load attendance records.');
        if (expectedCount !== null && result.data.totalCount !== expectedCount) {
          throw new Error('Attendance records changed during export. Please try again.');
        }
        expectedCount = result.data.totalCount;
        if (result.data.records.length === 0 && offset < expectedCount) {
          throw new Error('The attendance export stopped before all records were received. Please try again.');
        }
        records.push(...result.data.records);
        offset += result.data.records.length;
        if (offset < expectedCount && result.data.records.length !== pageSize) {
          throw new Error('The attendance export returned an incomplete page. Please try again.');
        }
      } while (expectedCount !== null && offset < expectedCount);

      const attendanceIds = new Set(records.map((record) => record.attendance_id));
      if (attendanceIds.size !== records.length || records.length !== expectedCount) {
        throw new Error('The attendance export contained duplicate or missing records. Please try again.');
      }

      const eligibleStudentIds = new Set(
        summary.students
          .filter((student) => student.attendance_id !== null)
          .map((student) => student.id),
      );
      const eligibleRecords = records.filter((record) => eligibleStudentIds.has(record.student_id));

      if (eligibleRecords.length === 0) {
        setExportFeedback({ message: 'No attendance records match the selected event and filters.', error: false });
        return;
      }

      const csv = buildAttendanceCsv(eligibleRecords);
      const exportDate = formatCsvDatePH(new Date().toISOString());
      const filename = buildAttendanceFilename(activeEvent.title, exportDate);
      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        if (!FileSystem.cacheDirectory) throw new Error('Temporary file storage is unavailable on this device.');
        if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device.');
        const uri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Share attendance report' });
      }
      setExportFeedback({ message: `Exported ${eligibleRecords.length} records to ${filename}.`, error: false });
    } catch (error: unknown) {
      setExportFeedback({ message: errorMessage(error), error: true });
    } finally {
      setExporting(false);
    }
  };

  const activeEvent = events.find((event) => event.id === selectedEventId);

  return (
    <View style={styles.container}>
      <MotionPressable
        style={({ pressed }) => [styles.sectionHeader, pressed && styles.sectionHeaderPressed]}
        onPress={() => {
          animateLayoutChange(reduceMotion);
          const nextExpanded = !isExpanded;
          if (onExpandedChange) onExpandedChange(nextExpanded);
          else setInternalExpanded(nextExpanded);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
      >
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>Event Attendance</Text>
          {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
        </View>
        <View style={styles.chevronCircle}>
          <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.primaryLight} />
        </View>
      </MotionPressable>
      {isExpanded && <View style={styles.expandedContent}>
      {!events.length && <Text style={styles.empty}>No authorized events available.</Text>}
      {events.length > 0 && <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {events.map((event) => <MotionPressable key={event.id} style={[styles.chip, event.id === selectedEventId && styles.chipActive]} onPress={() => setSelectedEventId(event.id)}><Text style={[styles.chipText, event.id === selectedEventId && styles.chipTextActive]}>{event.title}</Text></MotionPressable>)}
      </ScrollView>
      {activeEvent?.event_code && <Text style={styles.eventMeta}>{activeEvent.event_code}</Text>}
      {audienceLoaded && audienceError && <Text style={styles.error}>{audienceError}</Text>}
      {audienceLoaded && audienceConfig?.mode === 'legacy' && <Text style={styles.error}>No saved participant groups exist for this event. Configure its eligible groups in Edit Event before managing attendance.</Text>}
      <View style={styles.filters}>
        <Filter title="Course" label="All courses" value={courseId} options={visibleCourses.map((item) => ({ id: item.id, label: item.code }))} onChange={(value) => { setCourseId(value); setYearLevelId(''); setSectionId(''); }} />
        <Filter title="Year level" label="All year levels" value={yearLevelId} options={visibleYearLevels.map((item) => ({ id: item.id, label: item.name }))} onChange={(value) => { setYearLevelId(value); setSectionId(''); }} />
        <Filter title="Section" label="All sections" value={sectionId} options={visibleSections.map((item) => ({ id: item.id, label: item.section_name }))} onChange={setSectionId} />
        <Filter title="Attendance status" label="All statuses" value={status} options={[{ id: 'present', label: 'Present' }, { id: 'absent', label: 'Absent' }, { id: 'late', label: 'Late' }, { id: 'excused', label: 'Excused' }]} onChange={setStatus} />
      </View>
      <AppTextInput inputStyle={styles.search} value={search} onChangeText={setSearch} placeholder="Search name or student number" />
      {loading ? <ActivityIndicator color={COLORS.primary} /> : summaryError ? (
        <View style={styles.summaryError}>
          <Text style={styles.error}>{summaryError}</Text>
          <MotionPressable
            style={styles.summaryRetryButton}
            onPress={() => setSummaryRetry((attempt) => attempt + 1)}
            accessibilityRole="button"
          >
            <Text style={styles.summaryRetryText}>Retry attendance</Text>
          </MotionPressable>
        </View>
      ) : summary && <>
        <View style={styles.summaryRow}>
          <Metric label="Eligible" value={summary.total} />
          <Metric label="Present" value={summary.present} />
          <Metric label="Absent" value={summary.absent} />
          <Metric label="Late" value={summary.late} />
          <Metric label="Excused" value={summary.excused} />
          <Metric label="Pending" value={summary.pending} />
        </View>
        <Text style={styles.completion}>{summary.total ? `${Math.round(((summary.total - summary.pending) / summary.total) * 100)}% complete` : '0% complete'}</Text>
        <Text style={styles.exportSummary} accessibilityLiveRegion="polite">
          {activeEvent?.title ?? 'Selected event'} · {loading ? 'Loading matching records…' : exportCount === null ? 'Matching record count unavailable' : `${exportCount} records match the selected filters`}
        </Text>
        <View style={styles.exportActions}>
          <AppButton
            title={exporting ? 'Preparing report...' : exportCount === 0 ? 'No records to export' : 'Export Attendance CSV'}
            icon="download-outline"
            onPress={exportReport}
            disabled={exporting || loading || !summary || !!summaryError || exportCount === 0}
            loading={exporting}
            loadingTitle="Preparing report..."
            compact
          />
          <AppButton
            title={correctionsLoading ? 'Loading correction history...' : corrections === null ? 'View Correction History' : 'Refresh Correction History'}
            icon="time-outline"
            onPress={() => { void loadCorrections(); }}
            disabled={correctionsLoading}
            loading={correctionsLoading}
            compact
          />
        </View>
        {correctionsError && <Text style={styles.error}>{correctionsError}</Text>}
        {corrections && (
          <View style={styles.correctionHistory}>
            <Text style={styles.correctionTitle}>Attendance correction history</Text>
            {corrections.length === 0
              ? <Text style={styles.exportSummary}>No corrections recorded for this event.</Text>
              : corrections.map((correction) => (
                <View key={correction.id} style={styles.correctionRow}>
                  <Text style={styles.correctionText}>
                    {correction.previousStatus ?? 'No record'} → {correction.newStatus ?? 'Removed'} · Student {correction.studentId.slice(0, 8)}
                  </Text>
                  <Text style={styles.exportSummary}>
                    {new Date(correction.createdAt).toLocaleString()} · Actor {correction.actorId?.slice(0, 8) ?? 'System'}
                  </Text>
                </View>
              ))}
          </View>
        )}
        {exporting && <ActivityIndicator color={COLORS.primary} style={styles.exportLoader} />}
        {exportFeedback && <Text style={[styles.exportFeedback, exportFeedback.error && styles.error]} accessibilityLiveRegion="polite">{exportFeedback.message}</Text>}
        {message && <Text style={styles.error}>{message}</Text>}
        {visibleStudents.map((student) => <View style={styles.studentCard} key={student.id}>
          <View style={styles.studentInfo}>
            <Text style={styles.studentName}>{student.full_name || 'Unnamed student'}</Text>
            <Text style={styles.studentMeta}>{student.display_id || student.email}</Text>
            <Text style={styles.studentGroup}>{[student.course_code, student.year_level_name, student.section_name || student.section_code].filter(Boolean).join(' · ') || 'Academic group not assigned'}</Text>
          </View>
          <View style={styles.studentStatus}>
            <StatusBadge status={student.status ?? 'pending'} />
          </View>
          <View style={styles.statusRow}>{(['present', 'absent', 'late', 'excused'] as const).map((item) => <MotionPressable key={item} style={[styles.statusButton, student.status === item && styles.statusButtonActive]} onPress={() => mark(student.id, item)} accessibilityRole="button" accessibilityState={{ selected: student.status === item }}><Text style={[styles.statusButtonText, student.status === item && styles.statusButtonTextActive]}>{item[0].toUpperCase() + item.slice(1)}</Text></MotionPressable>)}</View>
        </View>)}
        {!visibleStudents.length && <Text style={styles.empty}>No students match these filters.</Text>}
      </>}
      </>}
      </View>}
    </View>
  );
}

function Filter({ title, label, value, options, onChange }: { title: string; label: string; value: string; options: { id: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <MotionPressable
          style={({ pressed }) => [styles.filterChip, !value && styles.filterChipActive, pressed && styles.filterChipPressed]}
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityState={{ selected: !value }}
        >
          <Text style={[styles.filterText, !value && styles.filterTextActive]}>{label}</Text>
        </MotionPressable>
        {options.map((option) => {
          const selected = value === option.id;
          return (
            <MotionPressable
              key={option.id}
              style={({ pressed }) => [styles.filterChip, selected && styles.filterChipActive, pressed && styles.filterChipPressed]}
              onPress={() => onChange(option.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.filterText, selected && styles.filterTextActive]}>{option.label}</Text>
            </MotionPressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Please try again.';
}

const styles = StyleSheet.create({
  container: { marginTop: 2, marginBottom: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 58, paddingHorizontal: 14, paddingVertical: 10 },
  sectionHeaderPressed: { backgroundColor: COLORS.surface },
  sectionHeaderText: { flex: 1, marginRight: 12 },
  chevronCircle: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, borderColor: `${COLORS.primary}44`, backgroundColor: `${COLORS.primary}12`, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700', fontFamily: FONTS.bold },
  sectionDescription: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16, fontFamily: FONTS.regular, marginTop: 4 },
  expandedContent: { borderTopWidth: 1, borderTopColor: COLORS.border, padding: 14 },
  chips: { gap: 8, paddingBottom: 8 },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 7 },
  chipActive: { backgroundColor: COLORS.primaryButtonStart, borderColor: COLORS.primaryButtonStart },
  chipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', fontFamily: FONTS.semiBold },
  chipTextActive: { color: COLORS.textOnPrimary },
  eventMeta: { color: COLORS.primary, fontSize: 12, fontFamily: FONTS.medium, marginBottom: 8 },
  filters: { gap: 8, marginTop: 2 },
  filterGroup: { gap: 2 },
  filterLabel: { color: COLORS.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '600', fontFamily: FONTS.semiBold, letterSpacing: 0.45, textTransform: 'uppercase' },
  filterRow: { gap: 6, paddingVertical: 3, paddingRight: 2 },
  filterChip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 7, minHeight: 34, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 5, backgroundColor: COLORS.surfaceRaised },
  filterChipActive: { backgroundColor: `${COLORS.primary}18`, borderColor: `${COLORS.primary}AA` },
  filterChipPressed: { opacity: 0.72 },
  filterText: { color: COLORS.textSecondary, fontSize: 11, fontFamily: FONTS.medium, lineHeight: 16 },
  filterTextActive: { color: COLORS.primary, fontFamily: FONTS.semiBold },
  search: { backgroundColor: COLORS.surfaceRaised, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 8, fontFamily: FONTS.regular },
  exportSummary: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, fontFamily: FONTS.regular, marginTop: 12, marginBottom: 4 },
  exportActions: { gap: 5 },
  correctionHistory: { marginTop: 12, padding: 10, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, backgroundColor: COLORS.surfaceRaised },
  correctionTitle: { color: COLORS.textPrimary, fontSize: 13, fontFamily: FONTS.semiBold, marginBottom: 6 },
  correctionRow: { paddingVertical: 7, borderTopWidth: 1, borderTopColor: COLORS.border },
  correctionText: { color: COLORS.textPrimary, fontSize: 12, lineHeight: 17, fontFamily: FONTS.medium },
  exportLoader: { marginTop: 8 },
  exportFeedback: { color: COLORS.success, fontSize: 12, fontFamily: FONTS.medium, lineHeight: 18, marginTop: 8 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metric: { flexGrow: 1, flexBasis: '30%', minWidth: 0, backgroundColor: COLORS.surfaceRaised, borderRadius: 8, padding: 8 },
  metricValue: { color: COLORS.primary, fontSize: 17, fontWeight: '700', fontFamily: FONTS.bold },
  metricLabel: { color: COLORS.textSecondary, fontSize: 10, fontFamily: FONTS.medium, marginTop: 2 },
  completion: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, marginTop: 8 },
  studentCard: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 8 },
  studentInfo: { flex: 1 },
  studentName: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: FONTS.bold, lineHeight: 18 },
  studentMeta: { color: COLORS.textSecondary, fontSize: 11, fontFamily: FONTS.regular, marginTop: 3, lineHeight: 15 },
  studentGroup: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '500', fontFamily: FONTS.medium, marginTop: 4, lineHeight: 15 },
  studentStatus: { alignSelf: 'flex-start', marginTop: 8 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  statusButton: { flex: 1, minWidth: 68, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 6 },
  statusButtonActive: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}20` },
  statusButtonText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600', fontFamily: FONTS.semiBold, textTransform: 'capitalize' },
  statusButtonTextActive: { color: COLORS.primary },
  error: { color: COLORS.danger, fontSize: 12, fontFamily: FONTS.medium, marginTop: 6 },
  summaryError: { alignItems: 'center', marginTop: 12 },
  summaryRetryButton: { minHeight: 40, justifyContent: 'center', marginTop: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, backgroundColor: COLORS.surface },
  summaryRetryText: { color: COLORS.primaryLight, fontSize: 12, fontFamily: FONTS.semiBold },
  empty: { color: COLORS.textSecondary, textAlign: 'center', fontFamily: FONTS.regular, marginVertical: 16 },
});
