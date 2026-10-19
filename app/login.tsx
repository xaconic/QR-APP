import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import MotionPressable from '@/components/MotionPressable';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppTextInput from '@/components/AppTextInput';
import Header from '@/components/Header';
import { COLORS, FONT_SIZES, RADII, SPACING } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { clearLocalSession, signIn, useAuth } from '@/lib/auth';
import { getProfileWithError, type Role } from '@/lib/profiles';

const ROLE_OPTIONS: Array<{ role: Role; label: string }> = [
  { role: 'student', label: 'Student' },
  { role: 'teacher', label: 'Teacher' },
  { role: 'admin', label: 'Admin' },
];

function getSignInErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'Email or password is incorrect.';
  if (normalized.includes('email not confirmed')) return 'Please verify your email before signing in.';
  if (normalized.includes('too many requests')) return 'Too many attempts. Please wait a moment and try again.';
  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'The sign-in request timed out. Check your connection and try again.';
  }
  if (normalized.includes('fetch') || normalized.includes('network')) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  return 'Sign in failed. Please check your details and try again.';
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const router = useRouter();
  const { session, loading: sessionLoading } = useAuth();
  const params = useLocalSearchParams<{ signupSuccess?: string }>();
  const scrollViewRef = useRef<ScrollView>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const isSubmitting = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<Role>('student');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [allowSessionRedirect, setAllowSessionRedirect] = useState(true);
  const [rememberMe, setRememberMe] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const compact = keyboardVisible || height - insets.top - insets.bottom < 700 || width < 360;
  const canSubmit = !!email.trim() && !!password && !loading && !sessionLoading && !session;

  useEffect(() => {
    if (!sessionLoading && !loading && allowSessionRedirect && session) router.replace('/(tabs)');
  }, [allowSessionRedirect, loading, router, session, sessionLoading]);

  useEffect(() => {
    const showListener = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideListener = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  useEffect(() => {
    if (!keyboardVisible || focusedField !== 'password') return;
    const frame = requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [focusedField, keyboardVisible]);

  useEffect(() => {
    if (!error) return;
    const frame = requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [error]);

  const handleLogin = async () => {
    if (sessionLoading || session || isSubmitting.current) return;
    setError(null);
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setError('Enter your password.');
      passwordRef.current?.focus();
      return;
    }

    isSubmitting.current = true;
    setAllowSessionRedirect(false);
    setLoading(true);
    let sessionNeedsCleanup = false;
    try {
      const { data, error: authError } = await signIn(normalizedEmail, password, rememberMe);
      if (authError) {
        console.error('Supabase sign-in failed.', {
          message: authError.message,
          status: authError.status,
          code: authError.code,
        });
        setAllowSessionRedirect(true);
        setError(getSignInErrorMessage(authError.message));
        return;
      }
      if (!data.session) {
        setAllowSessionRedirect(true);
        setError('Unable to start a session. Please try again.');
        return;
      }

      sessionNeedsCleanup = true;
      const { profile, error: profileError } = await getProfileWithError(
        data.session.user.id,
        data.session.access_token,
      );
      if (!profile || !profile.is_active) {
        const profileMessage = profileError
          ? 'We signed you in, but could not load your account details. Check your connection and try again.'
          : !profile
          ? 'We could not find your Acadence profile. Please contact your administrator.'
          : 'This account is inactive. Please contact your administrator.';
        if (profileError) console.error('Unable to load the signed-in account profile.', profileError);
        try {
          await clearLocalSession();
          sessionNeedsCleanup = false;
        } catch (signOutError: unknown) {
          console.error('Unable to sign out after login verification failed.', signOutError);
          setError('Your account could not be verified and sign-out failed. Please try again.');
          return;
        }
        setError(profileMessage);
        return;
      }
      if (profile.role !== selectedRole) {
        await clearLocalSession();
        sessionNeedsCleanup = false;
        const selectedRoleLabel = ROLE_OPTIONS.find((option) => option.role === selectedRole)?.label ?? selectedRole;
        const accountRoleLabel = ROLE_OPTIONS.find((option) => option.role === profile.role)?.label ?? profile.role;
        setError(`This account is registered as ${accountRoleLabel}, not ${selectedRoleLabel}. Select ${accountRoleLabel} to sign in.`);
        return;
      }
      setSelectedRole(profile.role);
      sessionNeedsCleanup = false;
      router.replace('/(tabs)');
    } catch (err: unknown) {
      if (sessionNeedsCleanup) {
        try {
          await clearLocalSession();
        } catch (cleanupError: unknown) {
          console.error('Unable to clear the unverified local session.', cleanupError);
          setError('Your account could not be verified and sign-out failed. Please try again.');
          return;
        }
      }
      setAllowSessionRedirect(true);
      console.error('Sign-in could not be completed.', err);
      setError(err instanceof Error
        ? getSignInErrorMessage(err.message)
        : 'Unable to verify your account right now. Please check your connection and try again.');
    } finally {
      isSubmitting.current = false;
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingHorizontal: width < 360 ? SPACING.md : SPACING.lg, paddingBottom: insets.bottom + (compact ? SPACING.lg : SPACING.xl + SPACING.sm) },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <View style={[styles.headerContainer, compact && styles.headerContainerCompact]}>
              <Header
                title="Acadence"
                topSpacing={0}
                logoWidth={Math.min(compact ? 140 : 184, width - SPACING.xxl * 2)}
              />
            </View>

            <Text style={[styles.eyebrow, compact && styles.eyebrowCompact]} accessibilityLiveRegion="polite">
              {selectedRole.toUpperCase()} PORTAL
            </Text>
            <Text style={[styles.title, compact && styles.titleCompact]}>Welcome back</Text>
            <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>
              Sign in to manage your attendance.
            </Text>

            {params.signupSuccess ? (
              <View style={styles.successBanner}>
                <Ionicons name="checkmark-circle-outline" size={19} color={COLORS.success} />
                <Text style={styles.successMessage}>{params.signupSuccess}</Text>
              </View>
            ) : null}

            <View style={[styles.authCard, compact && styles.authCardCompact]}>
              <Text style={[styles.roleLabel, compact && styles.roleLabelCompact]}>Continue as</Text>
              <View style={[styles.roleGroup, compact && styles.roleGroupCompact]} accessibilityRole="radiogroup">
                {ROLE_OPTIONS.map(({ role, label }) => {
                  const selected = selectedRole === role;
                  return (
                    <Pressable
                      key={role}
                      style={({ pressed }) => [
                        styles.roleOption,
                        compact && styles.roleOptionCompact,
                        selected && styles.roleOptionSelected,
                        pressed && !loading && styles.roleOptionPressed,
                      ]}
                      onPress={() => { setSelectedRole(role); setError(null); }}
                      disabled={loading}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: loading }}
                    >
                      <Text style={[styles.roleOptionText, selected && styles.roleOptionTextSelected]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View>
                <Text style={styles.label}>Email</Text>
                <View style={[styles.inputShell, compact && styles.inputShellCompact, focusedField === 'email' && styles.inputShellFocused]}>
                  <Ionicons
                    name="mail-outline"
                    size={18}
                    color={focusedField === 'email' ? COLORS.primary : COLORS.textMuted}
                  />
                  <AppTextInput
                    ref={emailRef}
                    containerStyle={styles.inputContainer}
                    inputStyle={[styles.input, compact && styles.inputCompact]}
                    value={email}
                    onChangeText={(value) => { setEmail(value); setError(null); }}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    placeholder="you@school.edu"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    autoComplete="email"
                    selectionColor={COLORS.primary}
                    returnKeyType="next"
                    editable={!loading}
                    accessibilityLabel="Email address"
                  />
                </View>

                <Text style={[styles.label, styles.passwordLabel, compact && styles.passwordLabelCompact]}>Password</Text>
                <View style={[styles.inputShell, compact && styles.inputShellCompact, focusedField === 'password' && styles.inputShellFocused]}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={18}
                    color={focusedField === 'password' ? COLORS.primary : COLORS.textMuted}
                  />
                  <AppTextInput
                    ref={passwordRef}
                    containerStyle={styles.inputContainer}
                    inputStyle={[styles.input, compact && styles.inputCompact]}
                    value={password}
                    onChangeText={(value) => { setPassword(value); setError(null); }}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    onSubmitEditing={handleLogin}
                    placeholder="Enter your password"
                    secureTextEntry={!showPassword}
                    textContentType="password"
                    autoComplete="current-password"
                    selectionColor={COLORS.primary}
                    returnKeyType="go"
                    editable={!loading}
                    accessibilityLabel="Password"
                  />
                  <MotionPressable
                    style={styles.visibilityButton}
                    onPress={() => setShowPassword((visible) => !visible)}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={19}
                      color={COLORS.textSecondary}
                    />
                  </MotionPressable>
                </View>

                {error && (
                  <Text
                    style={styles.error}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                  >
                    {error}
                  </Text>
                )}

                <View style={styles.accountActions}>
                  <MotionPressable
                    style={styles.rememberAction}
                    onPress={() => setRememberMe((value) => !value)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: rememberMe }}
                  >
                    <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                      {rememberMe && <Ionicons name="checkmark" size={14} color={COLORS.textOnPrimary} />}
                    </View>
                    <Text style={styles.rememberText}>Remember me</Text>
                  </MotionPressable>
                  <MotionPressable
                    onPress={() => router.push('/forgot-password')}
                    accessibilityRole="link"
                    hitSlop={8}
                  >
                    <Text style={styles.forgotText}>Forgot password?</Text>
                  </MotionPressable>
                </View>

                <MotionPressable
                  style={({ pressed }) => [
                    styles.submitButton,
                    compact && styles.submitButtonCompact,
                    !canSubmit && !loading && styles.submitButtonDisabled,
                    pressed && canSubmit && styles.submitButtonPressed,
                  ]}
                  onPress={handleLogin}
                  disabled={!canSubmit}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canSubmit, busy: loading }}
                >
                  <GradientFill variant="button" />
                  {loading ? (
                    <>
                      <ActivityIndicator size="small" color={COLORS.textOnPrimary} />
                      <Text style={styles.submitText}>Signing in...</Text>
                    </>
                  ) : (
                    <Text style={styles.submitText}>Sign In</Text>
                  )}
                </MotionPressable>
              </View>

              <MotionPressable
                onPress={() => router.push('/register')}
                accessibilityRole="link"
              >
                <Text style={[styles.link, compact && styles.linkCompact]}>
                  Don&apos;t have an account? <Text style={styles.linkEmphasis}>Sign up</Text>
                </Text>
              </MotionPressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function GradientFill({ variant }: { variant: 'role' | 'button' }) {
  const id = variant === 'role' ? 'loginRoleGradient' : 'loginButtonGradient';
  return (
    <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
      <Defs>
        <SvgLinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0" stopColor={COLORS.primaryButtonStart} stopOpacity="1" />
          <Stop offset="1" stopColor={COLORS.primaryDark} stopOpacity="1" />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={variant === 'role' ? 12 : 14} fill={`url(#${id})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  keyboardView: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.sm,
  },
  content: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  headerContainer: { alignItems: 'center', marginBottom: 4 },
  headerContainerCompact: { marginBottom: 0 },
  eyebrow: {
    alignSelf: 'center',
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    backgroundColor: `${COLORS.primaryDark}55`,
    color: COLORS.primaryLight,
    fontSize: 12,
    letterSpacing: 1.2,
    fontFamily: FONTS.bold,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  eyebrowCompact: { marginBottom: SPACING.sm, paddingVertical: 5 },
  title: {
    fontSize: 28,
    lineHeight: 33,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  titleCompact: { fontSize: 25, lineHeight: 30 },
  subtitle: {
    fontSize: 14,
    lineHeight: 19,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  subtitleCompact: { marginBottom: SPACING.lg },
  authCard: {
    paddingHorizontal: 17,
    paddingTop: 17,
    paddingBottom: 8,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 17,
    shadowColor: COLORS.primaryDark,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 5,
  },
  authCardCompact: { paddingHorizontal: 14, paddingTop: 14 },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    marginBottom: 14,
    borderRadius: 12,
    backgroundColor: `${COLORS.success}14`,
    borderWidth: 1,
    borderColor: `${COLORS.success}35`,
  },
  successMessage: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.textPrimary,
    fontFamily: FONTS.medium,
  },
  roleLabel: {
    fontSize: 14,
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
    marginBottom: 10,
  },
  roleLabelCompact: { marginBottom: 6 },
  roleGroup: {
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    marginBottom: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  roleGroupCompact: { marginBottom: 10 },
  roleOption: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 48,
    backgroundColor: COLORS.surfaceRaised,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  roleOptionCompact: { minHeight: 42 },
  roleOptionSelected: { backgroundColor: COLORS.primaryDark },
  roleOptionPressed: { opacity: 0.78 },
  roleOptionText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    textAlign: 'center',
  },
  roleOptionTextSelected: { color: COLORS.textOnPrimary },
  label: {
    fontSize: FONT_SIZES.caption,
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
    marginBottom: 5,
  },
  inputShell: {
    minHeight: 51,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceRaised,
  },
  inputShellFocused: { borderColor: COLORS.primary },
  inputShellCompact: { minHeight: 46 },
  inputContainer: { flex: 1 },
  input: {
    minHeight: 50,
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 10,
    backgroundColor: 'transparent',
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.body,
    fontFamily: FONTS.regular,
  },
  inputCompact: { minHeight: 44, paddingVertical: 7 },
  passwordLabel: { marginTop: 15 },
  passwordLabelCompact: { marginTop: 9 },
  visibilityButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  error: {
    fontSize: FONT_SIZES.caption,
    lineHeight: 17,
    color: COLORS.danger,
    marginTop: 10,
    marginBottom: 2,
    fontFamily: FONTS.medium,
  },
  accountActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 34,
    marginTop: 8,
  },
  rememberAction: { flexDirection: 'row', alignItems: 'center', minHeight: 34 },
  checkbox: {
    width: 21,
    height: 21,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  checkboxChecked: { backgroundColor: COLORS.primaryButtonStart, borderColor: COLORS.primaryButtonStart },
  rememberText: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.medium },
  forgotText: { color: COLORS.primaryLight, fontSize: 12, fontFamily: FONTS.semiBold },
  submitButton: {
    minHeight: 55,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: COLORS.primaryDark,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: COLORS.primaryDark,
    shadowOpacity: 0.38,
    shadowRadius: 10,
    elevation: 4,
  },
  submitButtonCompact: { minHeight: 48 },
  submitButtonDisabled: {
    opacity: 0.82,
  },
  submitButtonPressed: { opacity: 0.86 },
  submitText: {
    color: COLORS.textOnPrimary,
    fontSize: FONT_SIZES.body,
    fontFamily: FONTS.semiBold,
  },
  link: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    fontFamily: FONTS.medium,
    paddingTop: 12,
    paddingBottom: 4,
  },
  linkCompact: { paddingTop: 8, paddingBottom: 0 },
  linkEmphasis: { color: COLORS.primary, fontFamily: FONTS.semiBold, fontWeight: '600' },
});
