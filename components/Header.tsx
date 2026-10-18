import { Image, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';

type Props = { title: string; topSpacing?: number; logoWidth?: number };

export default function Header({ title, topSpacing = 14, logoWidth = 172 }: Props) {
  const markWidth = Math.min(92, Math.max(72, logoWidth * 0.5));
  return (
    <View style={[styles.container, { paddingTop: topSpacing }]}>
      <View
        style={[styles.markFrame, { width: markWidth, height: markWidth * 0.72 }]}
        accessibilityLabel={`${title} logo`}
        accessible
      >
        <Image
          source={require('../assets/images/acadence-mark.png')}
          style={{ width: markWidth, height: markWidth * (781 / 849) }}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.wordmark}>
        <Text style={styles.wordmarkLight}>Acaden</Text>
        <Text style={styles.wordmarkBlue}>ce</Text>
      </Text>
      <View style={styles.captionRow}>
        <View style={styles.captionLine} />
        <Text style={styles.caption}>Smart Attendance System</Text>
        <View style={styles.captionLine} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  markFrame: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  wordmark: {
    marginTop: -1,
    color: COLORS.textPrimary,
    fontSize: 28,
    lineHeight: 31,
    letterSpacing: -1.2,
    fontFamily: FONTS.extraBold,
  },
  wordmarkLight: { color: COLORS.textPrimary },
  wordmarkBlue: { color: COLORS.primary },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  captionLine: {
    width: 22,
    height: 1,
    backgroundColor: `${COLORS.textSecondary}88`,
    marginHorizontal: 8,
  },
  caption: {
    color: COLORS.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.15,
    fontFamily: FONTS.medium,
  },
});
