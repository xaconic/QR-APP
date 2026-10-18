import { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import MotionPressable from '@/components/MotionPressable';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { animateLayoutChange } from '@/lib/motion';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { assignEventStaff, assignStudent, archiveAcademicSection, archiveCourse, createAcademicLevel, createAcademicSection, createCourse, createYearLevel, getAcademicLevels, getAcademicSections, getCourses, getYearLevels, setCourseYearLevels, updateCourse, type AcademicLevel, type AcademicSection, type Course, type YearLevel } from '@/lib/academic';

type User = { id: string; display_id: string | null; full_name: string | null; role: string; academic_level_id: string | null; course_id: string | null; year_level_id: string | null; section_id: string | null };
type EventChoice = { id: string; title: string };

function confirmAcademicAction(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

export default function AcademicManagement({
  users,
  events,
  setupExpanded,
  onSetupExpandedChange,
  activeCoursesExpanded,
  onActiveCoursesExpandedChange,
  activeSectionsExpanded,
  onActiveSectionsExpandedChange,
}: {
  users: User[];
  events: EventChoice[];
  setupExpanded: boolean;
  onSetupExpandedChange: (expanded: boolean) => void;
  activeCoursesExpanded: boolean;
  onActiveCoursesExpandedChange: (expanded: boolean) => void;
  activeSectionsExpanded: boolean;
  onActiveSectionsExpandedChange: (expanded: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [courses, setCourses] = useState<Course[]>([]);
  const [levels, setLevels] = useState<AcademicLevel[]>([]);
  const [years, setYears] = useState<YearLevel[]>([]);
  const [sections, setSections] = useState<AcademicSection[]>([]);
  const [courseCode, setCourseCode] = useState('');
  const [courseName, setCourseName] = useState('');
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [levelCode, setLevelCode] = useState('');
  const [levelName, setLevelName] = useState('');
  const [yearName, setYearName] = useState('');
  const [sectionCode, setSectionCode] = useState('');
  const [sectionName, setSectionName] = useState('');
  const [academicYear, setAcademicYear] = useState('2026-2027');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedAcademicLevel, setSelectedAcademicLevel] = useState('');
  const [mappedYears, setMappedYears] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [selectedEvent, setSelectedEvent] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const reload = async () => {
    const [l, c, y, s] = await Promise.all([getAcademicLevels(), getCourses(), getYearLevels(), getAcademicSections()]);
    setLevels(l); setCourses(c); setYears(y); setSections(s);
  };
  useEffect(() => { reload(); }, []);

  const action = async (fn: () => Promise<{ error: string | null }>, success: string) => {
    const result = await fn(); setMessage(result.error ?? success); if (!result.error) await reload();
  };

  const handleAssignStudent = async () => {
    setAssignmentMessage(null);
    setAssignmentError(null);
    const section = sections.find((item) => item.id === selectedSection);
    const result = await assignStudent(selectedStudent, selectedCourse, selectedYear, selectedSection, section?.academic_year ?? academicYear);
    if (result.error) {
      setAssignmentError(result.error);
      setMessage(result.error);
      return;
    }
    setAssignmentMessage('Student successfully assigned.');
    setMessage('Student assigned.');
    await reload();
  };

  return <View style={styles.container}>
    <MotionPressable
      style={styles.setupHeader}
      onPress={() => {
        animateLayoutChange(reduceMotion);
        onSetupExpandedChange(!setupExpanded);
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: setupExpanded }}
    >
      <View style={styles.setupHeaderText}>
        <Text style={styles.title}>Academic Setup</Text>
        <Text style={styles.help}>Manage catalogs, valid course groups, and student assignments.</Text>
      </View>
      <View style={styles.chevronCircle}>
        <Ionicons name={setupExpanded ? 'chevron-up' : 'chevron-down'} size={17} color={COLORS.primaryLight} />
      </View>
    </MotionPressable>
    {setupExpanded && <>
    <Text style={styles.subTitle}>Add Academic Level</Text>
    <Text style={styles.fieldHint}>Enter a short code and its display name, e.g. SHS / Senior High School.</Text>
    <View style={styles.row}>
      <TextInput style={styles.input} value={levelCode} onChangeText={setLevelCode} placeholder="Code (SHS)" placeholderTextColor={COLORS.textSecondary} accessibilityLabel="Academic level code, for example SHS" autoCapitalize="characters" />
      <TextInput style={styles.inputWide} value={levelName} onChangeText={setLevelName} placeholder="Level name" placeholderTextColor={COLORS.textSecondary} accessibilityLabel="Academic level name, for example Senior High School" />
    </View>
    <Button title="Add Academic Level" onPress={() => action(() => createAcademicLevel(levelCode, levelName, levels.length + 1), 'Academic level added.')} />
    <Text style={styles.subTitle}>Add Course</Text>
    <Picker label="Academic level" value={selectedAcademicLevel} options={levels.map((item) => ({ id: item.id, label: item.name }))} onChange={setSelectedAcademicLevel} />
    <View style={styles.row}>
      <TextInput style={styles.input} value={courseCode} onChangeText={setCourseCode} placeholder="Code (BSIT)" placeholderTextColor={COLORS.textSecondary} accessibilityLabel="Course or strand code, for example BSIT" autoCapitalize="characters" />
      <TextInput style={styles.inputWide} value={courseName} onChangeText={setCourseName} placeholder="Course or strand name" placeholderTextColor={COLORS.textSecondary} accessibilityLabel="Course or strand display name" />
    </View>
    <Button title={editingCourseId ? 'Save Course' : 'Add Course'} onPress={() => action(() => editingCourseId ? updateCourse(editingCourseId, courseCode, courseName) : createCourse(courseCode, courseName, selectedAcademicLevel), editingCourseId ? 'Course updated.' : 'Course added.')} />
    <ExpandableHeader title="Active Courses" count={courses.length} expanded={activeCoursesExpanded} onPress={() => onActiveCoursesExpandedChange(!activeCoursesExpanded)} />
    {activeCoursesExpanded && (courses.length
      ? courses.map((course) => <View style={styles.sectionRow} key={course.id}><Text style={styles.sectionText}>{course.code} · {course.name}</Text><MotionPressable onPress={() => { setEditingCourseId(course.id); setCourseCode(course.code); setCourseName(course.name); setSelectedAcademicLevel(course.academic_level_id ?? ''); }}><Text style={styles.archive}>Edit</Text></MotionPressable><MotionPressable onPress={() => confirmAcademicAction('Archive program?', 'Existing student and attendance history will be preserved.', 'Archive', () => { void action(() => archiveCourse(course.id), 'Program archived.'); })}><Text style={styles.archive}>Archive</Text></MotionPressable></View>)
      : <Text style={styles.emptySections}>No active courses.</Text>)}
    <Text style={styles.subTitle}>Add Year Level</Text>
    <View style={styles.row}><TextInput style={styles.inputWide} value={yearName} onChangeText={setYearName} placeholder="Year level (e.g. 1st Year)" placeholderTextColor={COLORS.textSecondary} accessibilityLabel="Year level name, for example 1st Year" /><Button title="Add" inline onPress={() => action(() => createYearLevel(yearName, years.length + 1), 'Year level added.')} /></View>
    <Text style={styles.subTitle}>Add Section / Block</Text>
    <Picker label="Course" value={selectedCourse} options={courses.map((item) => ({ id: item.id, label: item.code }))} onChange={setSelectedCourse} />
    <Picker label="Year level" value={selectedYear} options={years.map((item) => ({ id: item.id, label: item.name }))} onChange={setSelectedYear} />
    <Text style={styles.label}>Configure applicable year levels for selected course</Text>
    <View style={styles.chips}>{years.map((year) => <MotionPressable key={year.id} style={[styles.chip, mappedYears.includes(year.id) && styles.chipActive]} onPress={() => setMappedYears((current) => current.includes(year.id) ? current.filter((id) => id !== year.id) : [...current, year.id])}><Text style={styles.chipText}>{year.name}</Text></MotionPressable>)}</View>
    <Button title="Save Program Year Levels" onPress={() => action(() => setCourseYearLevels(selectedCourse, mappedYears), 'Program year levels saved.')} />
    <View style={styles.row}>
      <TextInput style={styles.input} value={sectionCode} onChangeText={setSectionCode} placeholder="Code (A)" placeholderTextColor={COLORS.textSecondary} accessibilityLabel="Section or block code, for example A" autoCapitalize="characters" />
      <TextInput style={styles.inputWide} value={sectionName} onChangeText={setSectionName} placeholder="Name (Block A)" placeholderTextColor={COLORS.textSecondary} accessibilityLabel="Section or block display name, for example Block A" />
    </View>
    <TextInput style={styles.inputFull} value={academicYear} onChangeText={setAcademicYear} placeholder="Academic year (e.g. 2026-2027)" placeholderTextColor={COLORS.textSecondary} accessibilityLabel="Academic year, for example 2026-2027" />
    <Button title="Add Section" onPress={() => action(() => createAcademicSection({ courseId: selectedCourse, yearLevelId: selectedYear, code: sectionCode, name: sectionName, academicYear }), 'Section added.')} />
    <Text style={styles.subTitle}>Assign Student</Text>
    <Picker label="Student" value={selectedStudent} options={users.filter((item) => item.role === 'student').map((item) => ({ id: item.id, label: `${item.display_id ?? ''} ${item.full_name ?? item.id}` }))} onChange={setSelectedStudent} />
    <Picker label="Course" value={selectedCourse} options={courses.map((item) => ({ id: item.id, label: item.code }))} onChange={setSelectedCourse} />
    <Picker label="Year level" value={selectedYear} options={years.map((item) => ({ id: item.id, label: item.name }))} onChange={setSelectedYear} />
    <Picker label="Section" value={selectedSection} options={sections.filter((item) => item.course_id === selectedCourse && item.year_level_id === selectedYear).map((item) => ({ id: item.id, label: item.section_name }))} onChange={setSelectedSection} />
    <Button title="Assign Student" onPress={handleAssignStudent} />
    {assignmentMessage && <Text style={styles.successMessage}>✓ {assignmentMessage}</Text>}
    {assignmentError && <Text style={styles.errorMessage}>{assignmentError}</Text>}
    <Text style={styles.subTitle}>Authorize Teacher for Event</Text>
    <Picker label="Event" value={selectedEvent} options={events.map((item) => ({ id: item.id, label: item.title }))} onChange={setSelectedEvent} />
    <Picker label="Teacher" value={selectedTeacher} options={users.filter((item) => item.role === 'teacher').map((item) => ({ id: item.id, label: `${item.display_id ?? ''} ${item.full_name ?? item.id}` }))} onChange={setSelectedTeacher} />
    <Button title="Authorize Teacher" onPress={() => action(() => assignEventStaff(selectedEvent, selectedTeacher), 'Teacher authorized for event.')} />
    {message && <Text style={styles.message}>{message}</Text>}
    <ExpandableHeader title="Active Sections" count={sections.length} expanded={activeSectionsExpanded} onPress={() => onActiveSectionsExpandedChange(!activeSectionsExpanded)} />
    {activeSectionsExpanded && (sections.length
      ? sections.map((section) => <View style={styles.sectionRow} key={section.id}><Text style={styles.sectionText}>{section.section_name} · {section.section_code} · {section.academic_year}</Text><MotionPressable onPress={() => confirmAcademicAction('Archive section?', 'Historical attendance will be preserved.', 'Archive', () => { void action(() => archiveAcademicSection(section.id), 'Section archived.'); })}><Text style={styles.archive}>Archive</Text></MotionPressable></View>)
      : <Text style={styles.emptySections}>No active sections.</Text>)}
    </>}
  </View>;
}

export function AcademicPicker({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.id === value);
  const filteredOptions = options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()));
  const close = () => {
    setVisible(false);
    setSearch('');
  };

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <MotionPressable
        style={styles.dropdown}
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? 'Not selected'}`}
        accessibilityHint={`Choose ${label.toLowerCase()}`}
      >
        <Text style={[styles.dropdownValue, !selected && styles.dropdownPlaceholder]} numberOfLines={1}>
          {selected?.label ?? `Select ${label.toLowerCase()}`}
        </Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.primaryLight} />
      </MotionPressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.pickerBackdrop}>
          <MotionPressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close selection list" />
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select {label.toLowerCase()}</Text>
              <MotionPressable onPress={close} accessibilityRole="button" accessibilityLabel="Close selection list">
                <Ionicons name="close" size={24} color={COLORS.textSecondary} />
              </MotionPressable>
            </View>
            {options.length > 5 && (
              <TextInput
                style={styles.pickerSearch}
                value={search}
                onChangeText={setSearch}
                placeholder={`Search ${label.toLowerCase()}`}
                placeholderTextColor={COLORS.textSecondary}
                accessibilityLabel={`Search ${label.toLowerCase()} options`}
              />
            )}
            {value && (
              <MotionPressable style={styles.pickerOption} onPress={() => { onChange(''); close(); }}>
                <Text style={styles.clearSelection}>Clear selection</Text>
              </MotionPressable>
            )}
            <FlatList
              data={filteredOptions}
              keyExtractor={(option) => option.id}
              keyboardShouldPersistTaps="handled"
              style={styles.pickerList}
              renderItem={({ item }) => (
                <MotionPressable
                  style={styles.pickerOption}
                  onPress={() => { onChange(item.id); close(); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.id === value }}
                >
                  <Text style={[styles.pickerOptionText, item.id === value && styles.pickerOptionSelected]}>{item.label}</Text>
                  {item.id === value && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
                </MotionPressable>
              )}
              ListEmptyComponent={<Text style={styles.emptySections}>No matching options.</Text>}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const Picker = AcademicPicker;

function ExpandableHeader({ title, count, expanded, onPress }: { title: string; count: number; expanded: boolean; onPress: () => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <MotionPressable
      style={styles.activeSectionsHeader}
      onPress={() => {
        animateLayoutChange(reduceMotion);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
    >
      <Text style={styles.activeSectionsTitle}>{title}</Text>
      <Text style={styles.activeSectionsMeta}>{count} · {expanded ? 'Hide' : 'Show'}</Text>
      <View style={styles.chevronCircle}>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.primaryLight} />
      </View>
    </MotionPressable>
  );
}
function Button({ title, onPress, inline = false }: { title: string; onPress: () => void; inline?: boolean }) { return <MotionPressable style={[styles.button, inline && styles.inlineButton]} onPress={onPress}><Text style={styles.buttonText}>{title}</Text></MotionPressable>; }

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  setupHeader: { flexDirection: 'row', alignItems: 'center' },
  setupHeaderText: { flex: 1, marginRight: 12 },
  chevronCircle: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, borderColor: `${COLORS.primary}44`, backgroundColor: `${COLORS.primary}12`, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700', fontFamily: FONTS.bold },
  help: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, marginTop: 4 },
  subTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700', fontFamily: FONTS.bold, marginTop: 18, marginBottom: 8 },
  fieldHint: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, lineHeight: 17, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  input: { flex: 1, minHeight: 44, backgroundColor: COLORS.surfaceRaised, color: COLORS.textPrimary, fontFamily: FONTS.regular, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 },
  inputWide: { flex: 2, minHeight: 44, backgroundColor: COLORS.surfaceRaised, color: COLORS.textPrimary, fontFamily: FONTS.regular, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 },
  inputFull: { minHeight: 44, backgroundColor: COLORS.surfaceRaised, color: COLORS.textPrimary, fontFamily: FONTS.regular, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9, marginTop: 8 },
  button: { minHeight: 44, justifyContent: 'center', backgroundColor: COLORS.primaryButtonStart, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center', marginTop: 8 },
  inlineButton: { marginTop: 0, alignSelf: 'stretch' },
  buttonText: { color: COLORS.textOnPrimary, fontWeight: '600', fontFamily: FONTS.semiBold, fontSize: 13 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.medium, marginTop: 8, marginBottom: 6 },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, marginBottom: 4 },
  dropdownValue: { color: COLORS.textPrimary, fontSize: 12, fontFamily: FONTS.medium, flex: 1, marginRight: 8 },
  dropdownPlaceholder: { color: COLORS.textSecondary },
  pickerBackdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, backgroundColor: COLORS.backdrop },
  pickerCard: { maxHeight: '80%', backgroundColor: COLORS.card, borderRadius: 12, padding: 14 },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  pickerTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', fontFamily: FONTS.bold, flex: 1 },
  pickerSearch: { minHeight: 44, backgroundColor: COLORS.surfaceRaised, color: COLORS.textPrimary, fontFamily: FONTS.regular, borderWidth: 1, borderColor: COLORS.border, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 10, marginBottom: 10 },
  pickerList: { flexShrink: 1 },
  pickerOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 10, paddingHorizontal: 6 },
  pickerOptionText: { color: COLORS.textPrimary, fontSize: 13, fontFamily: FONTS.regular, flex: 1, marginRight: 8 },
  pickerOptionSelected: { color: COLORS.primary, fontWeight: '700' },
  clearSelection: { color: COLORS.danger, fontSize: 13, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  chipActive: { backgroundColor: `${COLORS.primary}33`, borderColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: 11 },
  message: { color: COLORS.primary, fontSize: 12, marginTop: 9 },
  successMessage: { color: COLORS.success, fontSize: 12, fontWeight: '700', fontFamily: FONTS.bold, marginTop: 8, textAlign: 'center' },
  errorMessage: { color: COLORS.danger, fontSize: 12, marginTop: 8, textAlign: 'center' },
  activeSectionsHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 44, marginTop: 18, paddingVertical: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  activeSectionsTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700', flex: 1 },
  activeSectionsMeta: { color: COLORS.textSecondary, fontSize: 12, marginRight: 8 },
  emptySections: { color: COLORS.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surfaceRaised, borderColor: COLORS.border, borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 8 },
  sectionText: { color: COLORS.textPrimary, fontSize: 12, flex: 1 },
  archive: { color: COLORS.danger, fontSize: 11, fontWeight: '700', marginLeft: 8 },
});
