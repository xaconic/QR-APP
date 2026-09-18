import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/colors';

type Props = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  theme?: 'primary';
  onPress: () => void;
  disabled?: boolean;
};

export default function AppButton({ title, icon, theme, onPress, disabled = false }: Props) {
  if (theme === 'primary') {
    return (
      <View style={styles.buttonOuter}>
        <Pressable
          style={[styles.primaryButton, disabled && styles.disabled]}
          onPress={onPress}
          disabled={disabled}
        >
          <Ionicons
            name={icon}
            size={22}
            color={COLORS.textOnPrimary}
            style={styles.icon}
          />
          <Text style={styles.primaryLabel}>{title}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.buttonOuter}>
      <Pressable
        style={[styles.secondaryButton, disabled && styles.disabled]}
        onPress={onPress}
        disabled={disabled}
      >
        <Ionicons
          name={icon}
          size={22}
          color={COLORS.textSecondary}
          style={styles.icon}
        />
        <Text style={styles.secondaryLabel}>{title}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  buttonOuter: {
    width: '100%',
    marginTop: 18,
    marginBottom: 2,
  },
  primaryButton: {
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  secondaryButton: {
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  icon: { paddingRight: 10 },
  primaryLabel: { fontSize: 17, fontWeight: '700', color: COLORS.textOnPrimary },
  secondaryLabel: { fontSize: 17, fontWeight: '600', color: COLORS.textPrimary },
  disabled: { opacity: 0.5 },
});