import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { COLORS, RADII } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { MOTION } from '@/constants/motion';
import MotionPressable from '@/components/MotionPressable';

type Props = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  theme?: 'primary' | 'card';
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
  loading?: boolean;
  loadingTitle?: string;
};

export default function AppButton({ title, icon, theme, onPress, disabled = false, compact = false, loading = false, loadingTitle = 'Loading...' }: Props) {
  const isDisabled = disabled || loading;
  const primary = theme === 'primary';
  const card = theme === 'card';
  const iconColor = primary ? COLORS.textOnPrimary : COLORS.textSecondary;
  return (
    <View style={[styles.buttonOuter, compact && styles.buttonOuterCompact]}>
      <MotionPressable
        pressScale={compact ? MOTION.compactScale : MOTION.buttonScale}
        style={({ pressed }) => [
          primary ? styles.primaryButton : card ? styles.cardButton : styles.secondaryButton,
          compact && styles.compactButton,
          pressed && styles.pressed,
          isDisabled && styles.disabled,
        ]}
        onPress={onPress}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        android_ripple={{ color: primary ? `${COLORS.textOnPrimary}33` : `${COLORS.primary}22` }}
      >
        {loading
          ? <ActivityIndicator size="small" color={iconColor} style={styles.icon} />
          : <Ionicons name={icon} size={compact ? 18 : 21} color={iconColor} style={styles.icon} />}
        <Text style={[primary ? styles.primaryLabel : styles.secondaryLabel, compact && styles.compactLabel]}>
          {loading ? loadingTitle : title}
        </Text>
      </MotionPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  buttonOuter: { width: '100%', marginTop: 12, marginBottom: 2 },
  buttonOuterCompact: { marginTop: 3, marginBottom: 0 },
  compactButton: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 12, borderRadius: RADII.sm },
  primaryButton: {
    minHeight: 48,
    borderRadius: RADII.sm,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    backgroundColor: COLORS.primaryButtonStart,
    borderWidth: 1,
    borderColor: COLORS.primaryButtonStart,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: RADII.sm,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardButton: {
    minHeight: 48,
    borderRadius: RADII.sm,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  icon: { paddingRight: 8 },
  primaryLabel: { fontSize: 15, fontWeight: '600', fontFamily: FONTS.semiBold, color: COLORS.textOnPrimary },
  secondaryLabel: { fontSize: 15, fontWeight: '600', fontFamily: FONTS.semiBold, color: COLORS.textPrimary },
  compactLabel: { fontSize: 14 },
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.5 },
});
