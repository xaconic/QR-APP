import { View, StyleSheet, Text } from 'react-native';
import { Link, Stack } from 'expo-router';

import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import MotionPressable from '@/components/MotionPressable';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops! Not Found' }} />
      <View style={styles.container}>
        <Text style={styles.title}>Page not found</Text>
        <Link href="/" asChild>
          <MotionPressable accessibilityRole="link">
            <Text style={styles.button}>Return to the app</Text>
          </MotionPressable>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { color: COLORS.textPrimary, fontFamily: FONTS.bold, fontSize: 22, marginBottom: 12 },
  button: { fontSize: 15, fontFamily: FONTS.semiBold, color: COLORS.primary, padding: 12 },
});
