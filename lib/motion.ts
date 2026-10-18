import { LayoutAnimation, Platform } from 'react-native';

import { MOTION } from '@/constants/motion';

export function animateLayoutChange(reduceMotion: boolean | null) {
  if (Platform.OS === 'web' || reduceMotion !== false) return;

  LayoutAnimation.configureNext({
    duration: MOTION.accordionDuration,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}
