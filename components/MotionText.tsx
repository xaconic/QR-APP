import { forwardRef, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  type TextProps,
} from 'react-native';

import { MOTION } from '@/constants/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

const AnimatedText = Animated.createAnimatedComponent(Text);

const MotionText = forwardRef<Text, TextProps>(function MotionText(props, ref) {
  const colorProgress = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();
  const flattened = StyleSheet.flatten(props.style);
  const color = typeof flattened?.color === 'string' ? flattened.color : undefined;
  const previousColor = useRef<string | undefined>(undefined);
  const animatedColor = previousColor.current !== undefined
    && color !== undefined
    && previousColor.current !== color
    ? colorProgress.interpolate({ inputRange: [0, 1], outputRange: [previousColor.current, color] })
    : color;

  useEffect(() => {
    const changed = previousColor.current !== undefined
      && color !== undefined
      && previousColor.current !== color;
    previousColor.current = color;
    if (!changed) return;
    colorProgress.stopAnimation();
    if (reduceMotion !== false) {
      colorProgress.setValue(1);
      return;
    }
    colorProgress.setValue(0);
    Animated.timing(colorProgress, {
      toValue: 1,
      duration: MOTION.stateDuration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [color, colorProgress, reduceMotion]);

  const style = animatedColor === undefined
    ? flattened
    : { ...flattened, color: animatedColor };

  return <AnimatedText {...props} ref={ref} style={style} />;
});

MotionText.displayName = 'MotionText';

export default MotionText;
