import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MotionPressable from '@/components/MotionPressable';
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { getAcademicSections, getCourses, getYearLevels, type AcademicSection, type Course, type EventAudienceScope, type YearLevel } from '@/lib/academic';

type Props = {
  mode: 'all' | 'groups';
  onModeChange: (mode: 'all' | 'groups') => void;
  scope: EventAudienceScope;
  onScopeChange: (scope: EventAudienceScope) => void;
  disabled?: boolean;
  compact?: boolean;
};

export default function EventAudiencePicker({ mode, onModeChange, scope, onScopeChange, disabled = false, compact = false }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [years, setYears] = useState<YearLevel[]>([]);
  const [sections, setSections] = useState<AcademicSection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getCourses(), getYearLevels(), getAcademicSections()]).then(([nextCourses, nextYears, nextSections]) => {
      setCourses(nextCourses); setYears(nextYears); setSections(nextSections);
    }).finally(() => setLoading(false));
  }, []);

  const visibleYears = useMemo(() => years.filter((year) => sections.some((section) => scope.courseIds.includes(section.course_id) && section.year_level_id === year.id)), [years, sections, scope.courseIds]);
  const visibleSections = useMemo(() => sections.filter((section) => scope.courseIds.includes(section.course_id) && scope.yearLevelIds.includes(section.year_level_id)), [sections, scope.courseIds, scope.yearLevelIds]);
  const sectionOptions = useMemo(() => {
    const grouped = new Map<string, string[]>();
    visibleSections.forEach((section) => grouped.set(section.section_name, [...(grouped.get(section.section_name) ?? []), section.id]));
    return Array.from(grouped, ([label, ids]) => ({ label, ids }));
  }, [visibleSections]);
  const update = (next: Partial<EventAudienceScope>) => onScopeChange({ ...scope, ...next });
  const toggle = (items: string[], id: string) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id];

  return <View style={[styles.box, compact && styles.compactBox]}>
    {!compact && <>
      <View style={styles.heading}>
        <View style={styles.headingIcon}><Ionicons name="people-outline" size={17} color={COLORS.primary} /></View>
        <Text style={styles.label}>Eligible Participants</Text>
      </View>
      <Text style={styles.hint}>Choose All Students or select the exact course, year level, and section groups.</Text>
    </>}
    <View style={[styles.modeRow, compact && styles.compactModeRow]}>
      <Chip label="All Students" active={mode === 'all'} disabled={disabled} onPress={() => onModeChange('all')} segmented />
      <Chip label="Selected Groups" active={mode === 'groups'} disabled={disabled} onPress={() => onModeChange('groups')} segmented />
    </View>
    {mode === 'groups' && <>
      <GroupRow disabled={disabled} label="Course / Strand" actions={[{ label: 'Select all', onPress: () => update({ courseIds: courses.map((item) => item.id) }) }, { label: 'Clear', onPress: () => update({ courseIds: [], yearLevelIds: [], sectionIds: [] }) }]}>
        {courses.map((item) => <Chip key={item.id} label={item.code} active={scope.courseIds.includes(item.id)} disabled={disabled} onPress={() => update({ courseIds: toggle(scope.courseIds, item.id), yearLevelIds: [], sectionIds: [] })} />)}
      </GroupRow>
      <GroupRow disabled={disabled} label="Year Level" actions={[{ label: 'Select all', onPress: () => update({ yearLevelIds: visibleYears.map((item) => item.id), sectionIds: [] }) }, { label: 'Clear', onPress: () => update({ yearLevelIds: [], sectionIds: [] }) }]}>
        {visibleYears.map((item) => <Chip key={item.id} label={item.name} active={scope.yearLevelIds.includes(item.id)} disabled={disabled} onPress={() => update({ yearLevelIds: toggle(scope.yearLevelIds, item.id), sectionIds: [] })} />)}
      </GroupRow>
      <GroupRow disabled={disabled} label="Section / Block" actions={[{ label: 'Select all', onPress: () => update({ sectionIds: visibleSections.map((item) => item.id) }) }, { label: 'Clear', onPress: () => update({ sectionIds: [] }) }]}>
        {sectionOptions.map((option) => {
          const active = option.ids.every((id) => scope.sectionIds.includes(id));
          return <Chip key={option.label} label={option.label} active={active} disabled={disabled} onPress={() => update({ sectionIds: toggleMany(scope.sectionIds, option.ids) })} />;
        })}
      </GroupRow>
      {!scope.courseIds.length && <Text style={styles.hint}>Select a course first.</Text>}
      {!!scope.courseIds.length && !scope.yearLevelIds.length && <Text style={styles.hint}>Select a year level to choose sections.</Text>}
    </>}
    {loading && <ActivityIndicator color={COLORS.primary} />}
  </View>;
}

function GroupRow({ label, actions = [], children, disabled = false }: { label: string; actions?: { label: string; onPress: () => void }[]; children: React.ReactNode; disabled?: boolean }) {
  return <View style={styles.group}><View style={styles.groupHeader}><Text style={styles.subLabel}>{label}</Text>{actions.map((action) => <MotionPressable key={action.label} onPress={action.onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => pressed && !disabled ? styles.actionPressed : undefined}><Text style={styles.action}>{action.label}</Text></MotionPressable>)}</View><View style={styles.chips}>{children}</View></View>;
}

function Chip({ label, active, onPress, disabled, segmented = false }: { label: string; active: boolean; onPress: () => void; disabled?: boolean; segmented?: boolean }) {
  return <MotionPressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[segmented ? styles.modeChip : styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}><Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{label}</Text></MotionPressable>;
}

function toggleMany(items: string[], ids: string[]) {
  const hasAll = ids.every((id) => items.includes(id));
  return hasAll ? items.filter((item) => !ids.includes(item)) : Array.from(new Set([...items, ...ids]));
}

const styles = StyleSheet.create({
  box: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 6 },
  compactBox: { backgroundColor: 'transparent', borderWidth: 0, borderRadius: 0, padding: 0, marginTop: 0 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  headingIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: `${COLORS.primary}18`, alignItems: 'center', justifyContent: 'center' },
  label: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: FONTS.bold },
  hint: { color: COLORS.textSecondary, fontSize: 11, fontFamily: FONTS.regular, marginTop: 5, lineHeight: 16 },
  modeRow: { flexDirection: 'row', gap: 5, marginTop: 10, padding: 4, borderRadius: 9, backgroundColor: COLORS.card },
  compactModeRow: { marginTop: 0 },
  group: { marginTop: 12 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 26 },
  subLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700', fontFamily: FONTS.bold, flex: 1 },
  action: { color: COLORS.primary, fontSize: 11, fontWeight: '700', fontFamily: FONTS.semiBold, paddingVertical: 5, paddingHorizontal: 2 },
  actionPressed: { opacity: 0.65 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 5 },
  chip: { minHeight: 36, maxWidth: '100%', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: COLORS.background },
  modeChip: { flex: 1, minHeight: 38, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 7, paddingHorizontal: 6, backgroundColor: 'transparent' },
  chipActive: { backgroundColor: COLORS.primaryButtonStart, borderColor: COLORS.primaryButtonStart },
  chipDisabled: { opacity: 0.5 },
  chipText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600', fontFamily: FONTS.medium },
  chipTextActive: { color: COLORS.textOnPrimary, fontFamily: FONTS.semiBold },
});
