import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let preference: boolean | null = null;
let initialized = false;
let eventObserved = false;
const listeners = new Set<() => void>();

function updatePreference(value: boolean) {
  if (preference === value) return;
  preference = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!initialized) {
    initialized = true;
    AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      eventObserved = true;
      updatePreference(enabled);
    });
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!eventObserved) updatePreference(enabled);
    }).catch((error: unknown) => {
      console.warn('Unable to read the reduced-motion preference; animations remain disabled.', error);
    });
  }

  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return preference;
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
