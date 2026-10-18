import { Image, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';

export default function BrandedSplashScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.brandGroup}>
        <Image
          source={require('../assets/images/splash-branding.png')}
          style={styles.branding}
          resizeMode="contain"
          accessible
          accessibilityLabel="Acadence, Smart Attendance System"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  brandGroup: { alignItems: 'center' },
  branding: { width: 115, height: 105},
  subtitle: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.medium,
    fontSize: 14,
    marginTop: -4,
  },
});
