import { StyleSheet, Text, View } from 'react-native';

import { COLORS, RADII } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';

export type StatusKind = 'open' | 'closed' | 'present' | 'late' | 'absent' | 'excused' | 'pending' | 'active' | 'inactive' | 'archived';

type Props = {
  status: StatusKind;
  label?: string;
  shape?: 'pill' | 'rounded' | 'subtle';
};

const STATUS_COLORS: Record<StatusKind, string> = {
  open: COLORS.statusOpen,
  closed: COLORS.statusClosed,
  present: COLORS.statusPresent,
  late: COLORS.statusLate,
  absent: COLORS.statusAbsent,
  excused: COLORS.primary,
  active: COLORS.statusPresent,
  inactive: COLORS.statusClosed,
  archived: COLORS.statusClosed,
  pending: COLORS.warning,
};

export default function StatusBadge({ status, label, shape = 'pill' }: Props) {
  const color = STATUS_COLORS[status];
  return (
    <View
      style={[
        styles.badge,
        shape === 'rounded' && styles.roundedBadge,
        shape === 'subtle' && styles.subtleBadge,
        {
          borderColor: `${color}${shape === 'subtle' ? '33' : '55'}`,
          backgroundColor: `${color}${shape === 'subtle' ? '10' : '14'}`,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${label ?? status} status`}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label ?? status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: RADII.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  roundedBadge: { borderRadius: 6 },
  subtleBadge: { minHeight: 24, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 11, fontFamily: FONTS.semiBold, textTransform: 'capitalize' },
});
