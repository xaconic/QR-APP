import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  } from 'react-native';
import MotionPressable from '@/components/MotionPressable';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import AppButton from '@/components/AppButton';
import Header from '@/components/Header';
import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { signUp } from '@/lib/auth';
import { formatCourseLabel, getAcademicSections, getAcademicLevels, getCourses, getYearLevelsForCourse, type AcademicLevel, type AcademicSection, type Course, type YearLevel } from '@/lib/academic';

const KeyboardTextInput: any = TextInput;

function getRegistrationErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('already registered') || normalized.includes('already exists')) {
    return 'An account with this email may already exist. Try signing in instead.';
  }
  if (normalized.includes('password')) return 'Choose a password that meets the account requirements.';
  if (normalized.includes('invalid email')) return 'Enter a valid email address.';
  if (normalized.includes('too many requests')) return 'Too many attempts. Please wait a moment and try again.';
  if (normalized.includes('fetch') || normalized.includes('network')) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  return 'We couldn’t create your account. Check your details and try again.';
}

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const compact = height - insets.top - insets.bottom < 700 || width < 360;
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'fullName' | 'email' | 'password' | 'confirmPassword' | null>(null);
  const fullNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState(false);
  const [navigatingToSignIn, setNavigatingToSignIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [academicLevels, setAcademicLevels] = useState<AcademicLevel[]>([]);
  const [yearLevels, setYearLevels] = useState<YearLevel[]>([]);
  const [courseSections, setCourseSections] = useState<AcademicSection[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [yearLevelsLoading, setYearLevelsLoading] = useState(false);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [academicLevelId, setAcademicLevelId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [yearLevelId, setYearLevelId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const selectedAcademicLevel = academicLevels.find((item) => item.id === academicLevelId);
  const isSeniorHigh = selectedAcademicLevel?.code?.toUpperCase() === 'SHS'
    || selectedAcademicLevel?.name?.toLowerCase().includes('senior high');
  const programLabel = isSeniorHigh ? 'Strand' : 'Course';

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    Promise.all([getAcademicLevels(), getCourses()]).then(([loadedLevels, loadedCourses]) => {
      if (!active) return;
      setAcademicLevels(loadedLevels);
      setCourses(loadedCourses);
    }).catch(() => {
      if (active) setError('Unable to load academic options. Please try again.');
    }).finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setYearLevelId(null);
    setSectionId(null);
    if (!courseId) { setCourseSections([]); setSectionsLoading(false); return () => { active = false; }; }
    setSectionsLoading(true);
    getAcademicSections(courseId).then((loaded) => { if (active) setCourseSections(loaded); }).finally(() => { if (active) setSectionsLoading(false); });
    return () => { active = false; };
  }, [courseId]);

  useEffect(() => {
    let active = true;
    setYearLevelId(null);
    setSectionId(null);
    if (!courseId) { setYearLevels([]); setYearLevelsLoading(false); return () => { active = false; }; }
    setYearLevelsLoading(true);
    getYearLevelsForCourse(courseId).then((loaded) => { if (active) setYearLevels(loaded); }).finally(() => { if (active) setYearLevelsLoading(false); });
    return () => { active = false; };
  }, [courseId]);

  useEffect(() => {
    let active = true;
    if (!academicLevels.length) return () => { active = false; };
    return () => { active = false; };
  }, [academicLevels]);

  const handleRegister = async () => {
    setError(null);

    if (!fullName.trim()) {
      setError('Full name is required.');
      return;
    }

    if (!email.trim()) {
      setError('Email is required.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }

    if (!password) {
      setError('Password is required.');
      return;
    }

    if (!confirmPassword) {
      setError('Please confirm your password.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (!courseId || !yearLevelId || !sectionId) {
      setError('Course, year level, and section/block are required for students.');
      return;
    }

    const selectedCourse = courses.find((item) => item.id === courseId);
    const selectedLevel = academicLevels.find((item) => item.id === academicLevelId);
    if (!academicLevelId || !selectedCourse || selectedCourse.academic_level_id !== academicLevelId || !selectedLevel) {
      setError('Please select a valid academic level and program.');
      return;
    }

    setLoading(true);

    try {
      const { data, error: authError } = await signUp(email.trim(), password, {
        full_name: fullName.trim(),
        course_id: courseId,
        academic_level_id: academicLevelId,
        year_level_id: yearLevelId,
        section_id: sectionId,
      });

      if (authError) {
        setError(getRegistrationErrorMessage(authError.message));
      } else {
        setEmailConfirmationRequired(!data.session);
        setSuccess(true);
      }
    } catch (err: unknown) {
      console.error('Account registration failed before a Supabase response was received.', err);
      setError(err instanceof Error
        ? getRegistrationErrorMessage(err.message)
        : 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoToSignIn = () => {
    if (navigatingToSignIn) return;
    setNavigatingToSignIn(true);
    router.replace('/login');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            success && styles.successScrollContent,
            { paddingHorizontal: width < 360 ? 16 : 22, paddingBottom: insets.bottom + (success ? 16 : 28) },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
            <View style={[styles.headerContainer, (success || compact) && styles.successHeaderContainer]}>
              <Header title="Acadence" topSpacing={success || compact ? 0 : 14} logoWidth={compact ? 148 : 172} />
            </View>

            {success ? (
              <View style={styles.successContainer} accessibilityRole="summary">
                <View style={styles.successIcon}>
                  <Ionicons
                    name={emailConfirmationRequired ? 'mail-open-outline' : 'checkmark'}
                    size={32}
                    color={COLORS.success}
                  />
                </View>
                <Text style={styles.successEyebrow}>REGISTRATION COMPLETE</Text>
                <Text style={styles.successTitle}>
                  {emailConfirmationRequired ? 'Check your email' : 'Account created successfully'}
                </Text>
                <Text style={styles.successText}>
                  {emailConfirmationRequired
                    ? `If ${email} can be registered, we’ll send a verification link. Verify your email, then return here to sign in.`
                    : 'Your account is ready. Sign in with your email and password to continue.'}
                </Text>
                <MotionPressable
                  style={({ pressed }) => [
                    styles.successButton,
                    pressed && styles.successButtonPressed,
                    navigatingToSignIn && styles.successButtonDisabled,
                  ]}
                  onPress={handleGoToSignIn}
                  disabled={navigatingToSignIn}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: navigatingToSignIn, busy: navigatingToSignIn }}
                >
                  <Text style={styles.successButtonText}>
                    {navigatingToSignIn ? 'Opening Sign In...' : 'Go to Sign In'}
                  </Text>
                  {navigatingToSignIn
                    ? <ActivityIndicator size="small" color={COLORS.textOnPrimary} />
                    : <Ionicons name="arrow-forward" size={18} color={COLORS.textOnPrimary} />}
                </MotionPressable>
              </View>
            ) : (
              <>
              <View style={[styles.intro, compact && styles.introCompact]}>
                <Text style={styles.eyebrow}>STUDENT PORTAL</Text>
                <Text style={styles.title}>Create your account</Text>
                <Text style={styles.subtitle}>Set up your student profile to get started.</Text>
              </View>
              <View style={[styles.form, compact && styles.formCompact]}>
                <View style={styles.sectionHeading}>
                  <Text style={styles.sectionTitle}>Your details</Text>
                  <Text style={styles.sectionNote}>All fields are required</Text>
                </View>
                <Text style={styles.label}>Full Name</Text>
                <TextInput
                  style={[styles.input, compact && styles.inputCompact, focusedField === 'fullName' && styles.inputFocused]}
                  ref={fullNameRef}
                  value={fullName}
                  onChangeText={setFullName}
                  onFocus={() => setFocusedField('fullName')}
                  onBlur={() => setFocusedField(null)}
                  onSubmitEditing={() => emailRef.current?.focus()}
                  placeholder="Your full name"
                  placeholderTextColor={COLORS.textSecondary}
                  editable={!loading}
                  autoCapitalize="words"
                  autoComplete="name"
                  returnKeyType="next"
                  accessibilityLabel="Full name"
                />

                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={[styles.input, compact && styles.inputCompact, focusedField === 'email' && styles.inputFocused]}
                  ref={emailRef}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  placeholder="your.email@school.edu"
                  placeholderTextColor={COLORS.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  editable={!loading}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  accessibilityLabel="Email address"
                />

                <Text style={styles.label}>Password</Text>
                <View style={[styles.passwordField, focusedField === 'password' && styles.passwordFieldFocused]}>
                  <KeyboardTextInput
                    style={[styles.input, compact && styles.inputCompact, styles.passwordInput]}
                    ref={passwordRef}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="At least 6 characters"
                    placeholderTextColor={COLORS.textSecondary}
                    secureTextEntry={!showPassword}
                    editable={!loading}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="next"
                    onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                    onKeyDown={(event: any) => {
                      if (event.nativeEvent.key === 'Tab') {
                        event.preventDefault();
                        event.stopPropagation();
                        setTimeout(() => confirmPasswordRef.current?.focus(), 0);
                      }
                    }}
                    onKeyPress={(event: any) => {
                      if (event.nativeEvent.key === 'Tab') {
                        event.preventDefault();
                        event.stopPropagation();
                        confirmPasswordRef.current?.focus();
                      }
                    }}
                  />
                  <MotionPressable
                    style={styles.passwordToggle}
                    onPress={() => setShowPassword((visible) => !visible)}
                    disabled={loading}
                    accessible={false}
                    focusable={false}
                    tabIndex={-1}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color={COLORS.textSecondary} />
                  </MotionPressable>
                </View>

                <Text style={styles.label}>Confirm Password</Text>
                <View style={[styles.passwordField, focusedField === 'confirmPassword' && styles.passwordFieldFocused]}>
                  <TextInput
                    style={[styles.input, compact && styles.inputCompact, styles.passwordInput, confirmPassword.length > 0 && password !== confirmPassword && styles.inputError]}
                    ref={confirmPasswordRef}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    onFocus={() => setFocusedField('confirmPassword')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="Re-enter your password"
                    placeholderTextColor={COLORS.textSecondary}
                    secureTextEntry={!showConfirmPassword}
                    editable={!loading}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="done"
                    accessibilityLabel="Confirm password"
                  />
                  <MotionPressable
                    style={styles.passwordToggle}
                    onPress={() => setShowConfirmPassword((visible) => !visible)}
                    disabled={loading}
                    accessible={false}
                    focusable={false}
                    tabIndex={-1}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  >
                    <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color={COLORS.textSecondary} />
                  </MotionPressable>
                </View>
                {confirmPassword.length > 0 && password !== confirmPassword && (
                  <Text style={styles.fieldError}>Passwords do not match.</Text>
                )}

                <View>
                    <Text style={styles.label}>Academic Level</Text>
                    <OptionPicker
                      value={academicLevels.find((item) => item.id === academicLevelId)?.name ?? ''}
                      placeholder="Select academic level"
                      options={academicLevels.map((item) => ({ id: item.id, label: item.name }))}
                      selectedId={academicLevelId}
                      onSelect={(id) => {
                        setAcademicLevelId(id || null);
                        setCourseId(null);
                        setYearLevelId(null);
                        setSectionId(null);
                        setCourseSections([]);
                      }}
                      disabled={loading}
                      loading={catalogLoading}
                    />
                    <Text style={styles.label}>{programLabel}</Text>
                    <OptionPicker
                      key={academicLevelId ?? 'no-academic-level'}
                      value={(() => { const course = courses.find((item) => item.id === courseId); return course ? formatCourseLabel(course) : ''; })()}
                      placeholder={catalogLoading ? `Loading ${programLabel.toLowerCase()}s...` : `Select ${programLabel.toLowerCase()}`}
                      options={courses.filter((item) => item.academic_level_id === academicLevelId).map((item) => ({ id: item.id, label: formatCourseLabel(item) }))}
                      selectedId={courseId}
                      onSelect={setCourseId}
                      disabled={loading || !academicLevelId}
                      loading={catalogLoading}
                      searchable
                    />

                    <Text style={styles.label}>Year Level</Text>
                    <OptionPicker
                      value={yearLevels.find((item) => item.id === yearLevelId)?.name ?? ''}
                      placeholder={courseId ? 'Select year level' : 'Select a course first'}
                      options={yearLevels.map((item) => ({ id: item.id, label: item.name }))}
                      selectedId={yearLevelId}
                      onSelect={(id) => { setYearLevelId(id); setSectionId(null); }}
                      disabled={loading || !courseId}
                      loading={yearLevelsLoading}
                    />

                    <Text style={styles.label}>Section / Block</Text>
                    <OptionPicker
                      value={formatSectionName(courseSections.find((item) => item.id === sectionId)?.section_name ?? '')}
                      placeholder={yearLevelId ? 'Select section/block' : 'Select a year level first'}
                      options={courseSections.filter((item) => item.year_level_id === yearLevelId).map((item) => ({ id: item.id, label: `${formatSectionName(item.section_name)} (${item.academic_year})` }))}
                      selectedId={sectionId}
                      onSelect={setSectionId}
                      disabled={loading || !yearLevelId}
                      loading={sectionsLoading}
                    />
                </View>

                {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}

                {loading ? (
                  <View style={styles.submitLoading}>
                    <ActivityIndicator size="small" color={COLORS.primary} />
                    <Text style={styles.submitLoadingText}>Creating account...</Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.registrationSubmitGap} />
                    <AppButton
                      theme="primary"
                      title="Create Account"
                      icon="person-add-outline"
                      onPress={handleRegister}
                    />
                  </>
                )}
              </View>
              </>
            )}

            {!success && (
              <MotionPressable
                onPress={() => router.replace('/login')}
                accessibilityRole="link"
              >
                <Text style={styles.link}>Already have an account? Sign In</Text>
              </MotionPressable>
            )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function formatSectionName(name: string) {
  return name.replace(/\s([1-5])$/, (_, number: string) => ` Block ${String.fromCharCode(64 + Number(number))}`);
}

function OptionPicker({
  value,
  placeholder,
  options,
  selectedId,
  onSelect,
  disabled = false,
  searchable = false,
  loading = false,
}: {
  value: string;
  placeholder: string;
  options: { id: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
  searchable?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const unavailable = disabled || loading;
  const [query, setQuery] = useState(value);
  const filteredOptions = options.filter((option) => !searchable || !query.trim() || option.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!searchable) setQuery(value);
  }, [value, searchable]);

  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);

  return (
    <View>
      {searchable && open && !unavailable ? (
        <View style={styles.selectShell}>
          <TextInput
            style={[styles.selectValue, styles.selectInput, unavailable && styles.selectDisabled]}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              if (selectedId && text !== value) onSelect('');
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            placeholderTextColor={COLORS.textSecondary}
            editable={!unavailable}
            autoFocus
            autoCapitalize="characters"
          />
          <MotionPressable
            style={[styles.clearButton, styles.dropdownCloseButton]}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={`Close ${placeholder}`}
            hitSlop={8}
          >
            <Ionicons name="chevron-up" size={20} color={COLORS.textSecondary} />
          </MotionPressable>
          {(selectedId || query) && (
            <MotionPressable
              style={styles.clearButton}
              onPress={() => { onSelect(''); setQuery(''); setOpen(false); }}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${placeholder}`}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={20} color={COLORS.textSecondary} />
            </MotionPressable>
          )}
        </View>
      ) : (
        <View style={styles.selectShell}>
          <MotionPressable style={[styles.selectValue, unavailable && styles.selectDisabled]} disabled={unavailable} onPress={() => setOpen((current) => !current)}>
            <Text style={value ? styles.selectText : styles.selectPlaceholder}>{value || placeholder}</Text>
          </MotionPressable>
          {selectedId && (
            <MotionPressable
              style={styles.clearButton}
              onPress={() => { onSelect(''); setQuery(''); setOpen(false); }}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${placeholder}`}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={20} color={COLORS.textSecondary} />
            </MotionPressable>
          )}
        </View>
      )}
      {loading && <ActivityIndicator style={styles.selectLoading} size="small" color={COLORS.primary} />}
      {!unavailable && open && filteredOptions.length > 0 && (
        <View style={styles.optionRow}>
          {filteredOptions.map((option) => (
            <MotionPressable key={option.id} style={[styles.optionChip, selectedId === option.id && styles.optionChipActive]} onPress={() => { const clearing = selectedId === option.id; onSelect(clearing ? '' : option.id); setQuery(''); setOpen(false); }}>
              <Text style={[styles.optionText, selectedId === option.id && styles.optionTextActive]}>{option.label}</Text>
            </MotionPressable>
          ))}
        </View>
      )}
      {!unavailable && open && !filteredOptions.length && <Text style={styles.noOptions}>No valid options available.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingBottom: 32,
  },
  successScrollContent: {
    justifyContent: 'center',
  },
  headerContainer: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 2,
  },
  successHeaderContainer: {
    marginTop: 0,
    marginBottom: 0,
  },
  intro: {
    marginBottom: 18,
  },
  introCompact: { marginBottom: 12 },
  eyebrow: {
    color: COLORS.primary,
    fontSize: 11,
    letterSpacing: 1.4,
    fontFamily: FONTS.bold,
    marginBottom: 7,
  },
  title: {
    fontSize: 27,
    lineHeight: 34,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  form: {
    marginBottom: 18,
    padding: 18,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
  },
  formCompact: { padding: 14, marginBottom: 12 },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontFamily: FONTS.semiBold,
  },
  sectionNote: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontFamily: FONTS.medium,
  },
  label: {
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    color: COLORS.textSecondary,
    marginBottom: 7,
    marginTop: 13,
  },
  catalogNote: { fontSize: 12, color: COLORS.warning, lineHeight: 17, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 13,
    minHeight: 50,
    paddingVertical: 11,
    fontSize: 14,
    color: COLORS.textPrimary,
    fontFamily: FONTS.regular,
  },
  inputFocused: { borderColor: COLORS.primary },
  inputCompact: { minHeight: 44, paddingVertical: 8 },
  inputError: { borderColor: COLORS.danger },
  fieldError: { color: COLORS.danger, fontSize: 12, fontFamily: FONTS.medium, marginTop: 5 },
  passwordField: { position: 'relative', justifyContent: 'center' },
  passwordFieldFocused: { borderRadius: 11, borderWidth: 1, borderColor: COLORS.primary },
  passwordInput: { paddingRight: 48 },
  passwordToggle: { position: 'absolute', right: 14, padding: 4 },
  selectValue: {
    backgroundColor: COLORS.surface,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 13,
    paddingVertical: 14,
    paddingRight: 44,
    minHeight: 50,
  },
  selectShell: { position: 'relative' },
  clearButton: { position: 'absolute', right: 14, top: 12, zIndex: 2, padding: 2 },
  dropdownCloseButton: { right: 42 },
  selectLoading: { position: 'absolute', right: 16, top: 13, zIndex: 2 },
  selectDisabled: { opacity: 0.55 },
  selectText: { color: COLORS.textPrimary, fontSize: 14, fontFamily: FONTS.regular },
  selectInput: { color: COLORS.textPrimary, fontSize: 14, fontFamily: FONTS.regular },
  selectPlaceholder: { color: COLORS.textMuted, fontSize: 14, fontFamily: FONTS.regular },
  optionRow: { gap: 6, marginTop: 4, padding: 6, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, backgroundColor: COLORS.card },
  optionChip: { width: '100%', borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: COLORS.surface },
  optionChipActive: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}18` },
  optionText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600', fontFamily: FONTS.semiBold },
  optionTextActive: { color: COLORS.primary },
  noOptions: { color: COLORS.textSecondary, fontSize: 12, marginTop: 8 },
  roleRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  roleChip: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  roleChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}14`,
  },
  roleChipText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '600',
    fontFamily: FONTS.semiBold,
  },
  roleChipTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  toggleButton: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, minHeight: 44, minWidth: 128, alignItems: 'center', backgroundColor: COLORS.surface },
  toggleButtonActive: { borderColor: COLORS.primaryButtonStart, backgroundColor: COLORS.primaryButtonStart },
  toggleText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', fontFamily: FONTS.bold },
  toggleTextActive: { color: COLORS.textOnPrimary },
  error: {
    fontSize: 13,
    color: COLORS.danger,
    fontFamily: FONTS.medium,
    textAlign: 'left',
    marginTop: 14,
    marginBottom: 6,
    lineHeight: 19,
    padding: 11,
    borderRadius: 10,
    backgroundColor: `${COLORS.danger}12`,
  },
  registrationSubmitGap: {
    height: 8,
  },
  loader: {
    marginVertical: 16,
  },
  link: {
    fontSize: 14,
    color: COLORS.primary,
    fontFamily: FONTS.semiBold,
    textAlign: 'center',
    fontWeight: '600',
    paddingVertical: 12,
  },
  successContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: 10,
    marginBottom: 10,
    paddingHorizontal: 22,
    paddingVertical: 26,
    backgroundColor: COLORS.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  successIcon: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    marginBottom: 20,
    backgroundColor: `${COLORS.success}18`,
    borderWidth: 1,
    borderColor: `${COLORS.success}44`,
  },
  successEyebrow: {
    color: COLORS.success,
    fontSize: 11,
    letterSpacing: 1.2,
    fontFamily: FONTS.bold,
    marginBottom: 9,
  },
  successTitle: {
    fontSize: 22,
    lineHeight: 29,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: 10,
  },
  successText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontFamily: FONTS.regular,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  successButton: {
    minHeight: 52,
    width: '100%',
    paddingHorizontal: 18,
    borderRadius: 13,
    backgroundColor: COLORS.primaryButtonStart,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 9,
  },
  successButtonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  successButtonDisabled: { opacity: 0.72 },
  successButtonText: {
    color: COLORS.textOnPrimary,
    fontSize: 15,
    fontFamily: FONTS.semiBold,
  },
  submitLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 18,
    minHeight: 50,
  },
  submitLoadingText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontFamily: FONTS.semiBold,
  },
});
