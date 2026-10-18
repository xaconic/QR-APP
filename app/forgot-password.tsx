import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppTextInput from '@/components/AppTextInput';
import Header from '@/components/Header';
import MotionPressable from '@/components/MotionPressable';
import { COLORS, SPACING } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { resetPasswordForEmail } from '@/lib/auth';

function getResetErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid email')) return 'Enter a valid email address.';
  if (normalized.includes('too many requests')) return 'Too many attempts. Please wait a moment and try again.';
  if (normalized.includes('fetch') || normalized.includes('network')) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  return 'We could not send the reset email. Please try again.';
}

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const compact = height - insets.top - insets.bottom < 700 || width < 360;
  const router = useRouter();
  const emailRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const normalizedEmail = email.trim();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      emailRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const { error: resetError } = await resetPasswordForEmail(normalizedEmail);
      if (resetError) {
        setError(getResetErrorMessage(resetError.message));
        return;
      }
      setSent(true);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error
        ? getResetErrorMessage(requestError.message)
        : 'Unable to send the reset email. Please try again.');
    } finally {
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
          contentContainerStyle={[styles.scrollContent, { paddingHorizontal: width < 360 ? SPACING.md : SPACING.lg, paddingBottom: insets.bottom + SPACING.lg }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Header title="Acadence" topSpacing={0} logoWidth={compact ? 145 : 170} />
          <View style={[styles.intro, compact && styles.introCompact]}>
            <Text style={styles.eyebrow}>ACCOUNT RECOVERY</Text>
            <Text style={styles.title}>Forgot your password?</Text>
            <Text style={styles.subtitle}>
              Enter your email and we&apos;ll send you a secure link to reset your password.
            </Text>
          </View>

          <View style={[styles.card, compact && styles.cardCompact]}>
            {sent ? (
              <View style={styles.successState}>
                <View style={styles.successIcon}>
                  <Ionicons name="mail-open-outline" size={28} color={COLORS.success} />
                </View>
                <Text style={styles.successTitle}>Check your email</Text>
                <Text style={styles.successText}>
                  If an account exists for {email.trim()}, a password reset link is on its way.
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.label}>Email</Text>
                <View style={[styles.inputShell, compact && styles.inputShellCompact]}>
                  <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} />
                  <AppTextInput
                    ref={emailRef}
                    containerStyle={styles.inputContainer}
                    inputStyle={[styles.input, compact && styles.inputCompact]}
                    value={email}
                    onChangeText={(value) => { setEmail(value); setError(null); }}
                    placeholder="you@school.edu"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    autoComplete="email"
                    returnKeyType="send"
                    onSubmitEditing={handleSubmit}
                    editable={!loading}
                    accessibilityLabel="Email address"
                  />
                </View>
                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                <MotionPressable
                  style={({ pressed }) => [styles.submitButton, pressed && styles.pressed, loading && styles.disabled]}
                  onPress={handleSubmit}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityState={{ busy: loading, disabled: loading }}
                >
                  {loading ? <ActivityIndicator color={COLORS.textOnPrimary} /> : <Ionicons name="mail-outline" size={19} color={COLORS.textOnPrimary} />}
                  <Text style={styles.submitText}>{loading ? 'Sending...' : 'Send reset link'}</Text>
                </MotionPressable>
              </>
            )}
            <MotionPressable style={styles.backButton} onPress={() => router.replace('/login')} accessibilityRole="link">
              <Ionicons name="arrow-back" size={16} color={COLORS.primary} />
              <Text style={styles.backText}>Back to Sign In</Text>
            </MotionPressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  keyboardView: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  intro: { alignItems: 'center', marginTop: 12, marginBottom: 18 },
  introCompact: { marginTop: 6, marginBottom: 12 },
  eyebrow: {
    color: COLORS.primaryLight,
    backgroundColor: `${COLORS.primaryDark}55`,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontSize: 11,
    letterSpacing: 1.1,
    fontFamily: FONTS.bold,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 25,
    lineHeight: 31,
    textAlign: 'center',
    fontFamily: FONTS.bold,
    marginTop: 10,
  },
  subtitle: {
    maxWidth: 330,
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    fontFamily: FONTS.regular,
    marginTop: 4,
  },
  card: {
    padding: 17,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    shadowColor: COLORS.primaryDark,
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  cardCompact: { padding: 14 },
  label: { color: COLORS.textPrimary, fontSize: 13, fontFamily: FONTS.semiBold, marginBottom: 6 },
  inputShell: {
    minHeight: 51,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceRaised,
  },
  inputShellCompact: { minHeight: 46 },
  inputContainer: { flex: 1 },
  input: {
    minHeight: 50,
    paddingHorizontal: 0,
    paddingVertical: 10,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: COLORS.textPrimary,
    fontSize: 14,
    fontFamily: FONTS.regular,
  },
  inputCompact: { minHeight: 44, paddingVertical: 7 },
  error: { color: COLORS.danger, fontSize: 12, lineHeight: 17, marginTop: 9, fontFamily: FONTS.medium },
  submitButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 15,
    borderRadius: 14,
    backgroundColor: COLORS.primaryButtonStart,
  },
  submitText: { color: COLORS.textOnPrimary, fontSize: 14, fontFamily: FONTS.semiBold },
  pressed: { opacity: 0.86 },
  disabled: { opacity: 0.7 },
  successState: { alignItems: 'center', paddingVertical: 8 },
  successIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${COLORS.success}18`,
    borderWidth: 1,
    borderColor: `${COLORS.success}45`,
  },
  successTitle: { color: COLORS.textPrimary, fontSize: 18, fontFamily: FONTS.bold, marginTop: 12 },
  successText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 5 },
  backButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, marginTop: 10 },
  backText: { color: COLORS.primary, fontSize: 13, fontFamily: FONTS.semiBold },
});
