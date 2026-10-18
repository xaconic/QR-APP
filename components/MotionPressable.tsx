import { Children, forwardRef, isValidElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type PressableStateCallbackType,
  type TextProps,
  type View,
  type ViewStyle,
} from 'react-native';

import MotionText from '@/components/MotionText';
import { MOTION } from '@/constants/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type Props = PressableProps & {
  pressScale?: number;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const MotionPressable = forwardRef<View, Props>(function MotionPressable(
  {
    onPressIn,
    onPressOut,
    pressScale = MOTION.compactScale,
    style,
    children,
    ...props
  },
  ref,
) {
  const scale = useRef(new Animated.Value(1)).current;
  const colorProgress = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();
  const [interactionState, setInteractionState] = useState<PressableStateCallbackType>({ pressed: false });
  const previousColors = useRef<{ backgroundColor?: string; borderColor?: string } | null>(null);

  const animateScale = useCallback((toValue: number, duration: number) => {
    scale.stopAnimation();
    if (reduceMotion !== false) {
      scale.setValue(1);
      return;
    }
    Animated.timing(scale, {
      toValue,
      duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [reduceMotion, scale]);

  const resolved = typeof style === 'function' ? style(interactionState) : style;
  const flattened = StyleSheet.flatten(resolved);
  const transforms: ViewStyle['transform'] = Array.isArray(flattened?.transform) ? flattened.transform : [];
  const colors = {
    backgroundColor: typeof flattened?.backgroundColor === 'string' ? flattened.backgroundColor : undefined,
    borderColor: typeof flattened?.borderColor === 'string' ? flattened.borderColor : undefined,
  };
  const previous = previousColors.current;
  const backgroundColor = previous && previous.backgroundColor !== colors.backgroundColor
    ? colorProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [previous.backgroundColor ?? 'transparent', colors.backgroundColor ?? 'transparent'],
    })
    : colors.backgroundColor;
  const borderColor = previous && previous.borderColor !== colors.borderColor
    ? colorProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [previous.borderColor ?? 'transparent', colors.borderColor ?? 'transparent'],
    })
    : colors.borderColor;
  const animatedStyle = {
    ...flattened,
    backgroundColor,
    borderColor,
    transform: [...transforms, { scale }],
  };
  const animatedChildren = animateTextChildren(children, interactionState);

  useEffect(() => {
    const changed = previousColors.current !== null
      && (previousColors.current.backgroundColor !== colors.backgroundColor
        || previousColors.current.borderColor !== colors.borderColor);
    previousColors.current = colors;
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
  }, [colorProgress, colors.backgroundColor, colors.borderColor, reduceMotion]);

  return (
    <AnimatedPressable
      {...props}
      ref={ref}
      style={animatedStyle}
      onPressIn={(event) => {
        setInteractionState((current) => ({ ...current, pressed: true }));
        animateScale(pressScale, MOTION.pressInDuration);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setInteractionState((current) => ({ ...current, pressed: false }));
        animateScale(1, MOTION.pressOutDuration);
        onPressOut?.(event);
      }}
    >
      {animatedChildren}
    </AnimatedPressable>
  );
});

MotionPressable.displayName = 'MotionPressable';

export default MotionPressable;

function animateTextChildren(children: PressableProps['children'], state: PressableStateCallbackType): ReactNode {
  if (typeof children === 'function') return children(state);
  return Children.map(children, (child) => {
    if (!isValidElement<TextProps>(child) || child.type !== Text) return child;
    return <MotionText key={child.key} {...child.props} />;
  });
}
