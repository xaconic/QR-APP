import { forwardRef } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { COLORS, RADII, SPACING } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';

type Props = TextInputProps & {
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

const AppTextInput = forwardRef<TextInput, Props>(function AppTextInput(
  { error, containerStyle, inputStyle, ...inputProps },
  ref,
) {
  return (
    <View style={containerStyle}>
      <TextInput
        ref={ref}
        {...inputProps}
        placeholderTextColor={inputProps.placeholderTextColor ?? COLORS.textMuted}
        style={[styles.input, inputStyle, error && styles.inputError]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
});

export default AppTextInput;

const styles = StyleSheet.create({
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 15,
    fontFamily: FONTS.regular,
  },
  inputError: { borderColor: COLORS.danger },
  error: { marginTop: 5, color: COLORS.danger, fontSize: 12, fontFamily: FONTS.medium },
});
