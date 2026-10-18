const listeners = new Set<() => void>();

export function subscribeToAttendanceHistoryUpdates(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyAttendanceHistoryUpdated() {
  for (const listener of listeners) listener();
}
