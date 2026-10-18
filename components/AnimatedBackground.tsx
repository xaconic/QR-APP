import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { COLORS } from '@/constants/colors';

const AnimatedView = Animated.View;

function createLoop(value: Animated.Value, duration: number, delay = 0) {
  return Animated.loop(
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(value, {
        toValue: 1,
        duration,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
      Animated.timing(value, {
        toValue: 0,
        duration,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    ]),
    { resetBeforeIteration: false },
  );
}

export default function AnimatedBackground() {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const glow = useRef(new Animated.Value(0)).current;
  const flow = useRef(new Animated.Value(0)).current;
  const loops = useRef<Animated.CompositeAnimation[]>([]);

  const stopAnimation = useCallback((reset = false) => {
    loops.current.forEach((loop) => loop.stop());
    loops.current = [];
    if (reset) {
      glow.setValue(0);
      flow.setValue(0);
    }
  }, [flow, glow]);

  const startAnimation = useCallback(() => {
    if (reduceMotion !== false || loops.current.length > 0) return;
    loops.current = [createLoop(glow, 18000), createLoop(flow, 24000, 1200)];
    loops.current.forEach((loop) => loop.start());
  }, [flow, glow, reduceMotion]);

  useEffect(() => {
    if (reduceMotion !== false) {
      stopAnimation(true);
      return;
    }

    if (AppState.currentState === 'active') startAnimation();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') startAnimation();
      else stopAnimation();
    });

    return () => {
      subscription.remove();
      stopAnimation();
    };
  }, [reduceMotion, startAnimation, stopAnimation]);

  const viewBox = `0 0 ${width} ${height}`;
  const curves = useMemo(() => ({
    upper: `M ${-width * 0.05} ${height * 0.27} C ${width * 0.12} ${height * 0.12}, ${width * 0.27} ${height * 0.05}, ${width * 0.48} ${-height * 0.02}`,
    lower: `M ${width * 0.42} ${height * 1.02} C ${width * 0.68} ${height * 0.94}, ${width * 0.86} ${height * 0.89}, ${width * 1.04} ${height * 0.73}`,
  }), [height, width]);

  const glowStyle = useMemo(() => ({
    opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.68, 0.94] }),
  }), [glow]);
  const flowStyle = useMemo(() => ({
    opacity: flow.interpolate({ inputRange: [0, 1], outputRange: [0.62, 0.92] }),
  }), [flow]);
  const upperDriftStyle = useMemo(() => ({
    transform: [
      { translateX: flow.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.018, width * 0.018] }) },
      { translateY: flow.interpolate({ inputRange: [0, 1], outputRange: [-height * 0.008, height * 0.008] }) },
    ],
  }), [flow, height, width]);
  const lowerDriftStyle = useMemo(() => ({
    transform: [
      { translateX: glow.interpolate({ inputRange: [0, 1], outputRange: [width * 0.014, -width * 0.014] }) },
      { translateY: glow.interpolate({ inputRange: [0, 1], outputRange: [height * 0.006, -height * 0.006] }) },
    ],
  }), [glow, height, width]);

  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no" style={styles.root}>
      <View style={styles.base} />

      <AnimatedView style={[styles.layer, glowStyle]}>
        <Svg width={width} height={height} viewBox={viewBox}>
          <Defs>
            <RadialGradient id="topAuroraGlow" cx="8%" cy="6%" rx="66%" ry="54%">
              <Stop offset="0" stopColor={COLORS.primary} stopOpacity="0.18" />
              <Stop offset="0.5" stopColor={COLORS.primaryDark} stopOpacity="0.065" />
              <Stop offset="1" stopColor={COLORS.background} stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id="bottomAuroraGlow" cx="100%" cy="100%" rx="72%" ry="48%">
              <Stop offset="0" stopColor={COLORS.primaryDark} stopOpacity="0.2" />
              <Stop offset="0.52" stopColor={COLORS.primary} stopOpacity="0.075" />
              <Stop offset="1" stopColor={COLORS.background} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Ellipse cx={width * 0.08} cy={height * 0.06} rx={width * 0.66} ry={height * 0.38} fill="url(#topAuroraGlow)" />
          <Ellipse cx={width} cy={height} rx={width * 0.7} ry={height * 0.34} fill="url(#bottomAuroraGlow)" />
        </Svg>
      </AnimatedView>

      <AnimatedView style={[styles.layer, flowStyle]}>
        <Svg width={width} height={height} viewBox={viewBox}>
          <Defs>
            <LinearGradient id="upperWave" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0" stopColor={COLORS.primaryLight} stopOpacity="0.74" />
              <Stop offset="0.48" stopColor={COLORS.primary} stopOpacity="0.56" />
              <Stop offset="1" stopColor={COLORS.primaryDark} stopOpacity="0.03" />
            </LinearGradient>
            <LinearGradient id="upperWaveShade" x1="0%" y1="0%" x2="100%" y2="80%">
              <Stop offset="0" stopColor={COLORS.primaryDark} stopOpacity="0.72" />
              <Stop offset="1" stopColor={COLORS.background} stopOpacity="0.04" />
            </LinearGradient>
            <LinearGradient id="lowerWave" x1="100%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0" stopColor={COLORS.primary} stopOpacity="0.08" />
              <Stop offset="0.54" stopColor={COLORS.primaryLight} stopOpacity="0.66" />
              <Stop offset="1" stopColor={COLORS.primary} stopOpacity="0.78" />
            </LinearGradient>
            <LinearGradient id="lowerWaveShade" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0" stopColor={COLORS.primaryDark} stopOpacity="0.06" />
              <Stop offset="1" stopColor={COLORS.primaryDark} stopOpacity="0.78" />
            </LinearGradient>
            <LinearGradient id="upperAuroraLine" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0" stopColor={COLORS.primaryDark} stopOpacity="0.05" />
              <Stop offset="0.44" stopColor={COLORS.primary} stopOpacity="0.2" />
              <Stop offset="1" stopColor={COLORS.primaryLight} stopOpacity="0.025" />
            </LinearGradient>
            <LinearGradient id="lowerAuroraLine" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0" stopColor={COLORS.primaryLight} stopOpacity="0.02" />
              <Stop offset="0.56" stopColor={COLORS.primary} stopOpacity="0.17" />
              <Stop offset="1" stopColor={COLORS.primaryDark} stopOpacity="0.07" />
            </LinearGradient>
          </Defs>
          <Path
            d={`M 0 0 L ${width * 0.43} 0 C ${width * 0.33} ${height * 0.045}, ${width * 0.25} ${height * 0.105}, ${width * 0.17} ${height * 0.16} C ${width * 0.1} ${height * 0.21}, ${width * 0.055} ${height * 0.255}, 0 ${height * 0.29} Z`}
            fill="url(#upperWave)"
          />
          <Path
            d={`M 0 ${height * 0.31} C ${width * 0.12} ${height * 0.24}, ${width * 0.145} ${height * 0.13}, ${width * 0.26} ${height * 0.075} C ${width * 0.32} ${height * 0.046}, ${width * 0.39} ${height * 0.028}, ${width * 0.47} 0 L 0 0 Z`}
            fill="url(#upperWaveShade)"
          />
          <Path
            d={`M ${width * 0.44} ${height} C ${width * 0.63} ${height * 0.95}, ${width * 0.78} ${height * 0.84}, ${width} ${height * 0.75} L ${width} ${height} Z`}
            fill="url(#lowerWave)"
          />
          <Path
            d={`M ${width * 0.35} ${height} C ${width * 0.57} ${height * 0.95}, ${width * 0.8} ${height * 0.92}, ${width} ${height * 0.83} L ${width} ${height} Z`}
            fill="url(#lowerWaveShade)"
          />
          <Path d={curves.upper} fill="none" stroke="url(#upperAuroraLine)" strokeWidth={2} />
          <Path d={curves.lower} fill="none" stroke="url(#lowerAuroraLine)" strokeWidth={2} />
        </Svg>
      </AnimatedView>

      <AnimatedView pointerEvents="none" style={[styles.layer, upperDriftStyle]}>
        <Svg width={width} height={height} viewBox={viewBox}>
          <Path
            d={`M 0 ${height * 0.02} C ${width * 0.09} ${height * 0.1}, ${width * 0.13} ${height * 0.17}, 0 ${height * 0.235} Z`}
            fill={COLORS.primaryLight}
            opacity={0.12}
          />
        </Svg>
      </AnimatedView>

      <AnimatedView pointerEvents="none" style={[styles.layer, lowerDriftStyle]}>
        <Svg width={width} height={height} viewBox={viewBox}>
          <Path
            d={`M ${width * 0.52} ${height} C ${width * 0.7} ${height * 0.94}, ${width * 0.86} ${height * 0.9}, ${width} ${height * 0.79} L ${width} ${height} Z`}
            fill={COLORS.primaryLight}
            opacity={0.14}
          />
        </Svg>
      </AnimatedView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  base: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.background },
  layer: { ...StyleSheet.absoluteFillObject },
});
