import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { setSessionPersistence, supabase, supabaseSignUpClient } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

let globalSession: Session | null = null;
let globalUser: User | null = null;
let globalLoading = true;
let listeners: Set<() => void> = new Set();
let authInitializationId = 0;
const AUTH_RESTORE_TIMEOUT_MS = 8000;

function notify() {
  listeners.forEach((l) => l());
}

export function setAuth(session: Session | null) {
  globalSession = session;
  globalUser = session?.user ?? null;
  globalLoading = false;
  notify();
}

export function initializeAuth() {
  const initializationId = ++authInitializationId;
  let receivedAuthEvent = false;
  let restoreTimedOut = false;
  globalLoading = true;
  notify();
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (restoreTimedOut && event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
    receivedAuthEvent = true;
    setAuth(session);
  });

  const restoreTimeout = setTimeout(() => {
    if (initializationId !== authInitializationId || !globalLoading) return;
    restoreTimedOut = true;
    console.error('Authentication session restoration timed out. Continuing to the sign-in screen.');
    setAuth(null);
  }, AUTH_RESTORE_TIMEOUT_MS);

  supabase.auth.getSession().then(({ data: { session }, error }) => {
    clearTimeout(restoreTimeout);
    if (initializationId !== authInitializationId || receivedAuthEvent || restoreTimedOut) return;
    if (error) {
      console.error('Unable to restore the saved authentication session.', error);
      setAuth(null);
      return;
    }
    setAuth(session);
  }).catch((error: unknown) => {
    clearTimeout(restoreTimeout);
    if (initializationId !== authInitializationId || receivedAuthEvent || restoreTimedOut) return;
    console.error('Unable to restore the saved authentication session.', error);
    setAuth(null);
  });

  return () => {
    if (initializationId === authInitializationId) authInitializationId += 1;
    clearTimeout(restoreTimeout);
    subscription.unsubscribe();
  };
}

export function useAuth(): AuthState {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    forceRender((n) => n + 1);
    return () => { listeners.delete(listener); };
  }, []);

  return {
    session: globalSession,
    user: globalUser,
    loading: globalLoading,
  };
}

export type SignUpProfile = {
  full_name: string;
  academic_level_id: string;
  course_id: string;
  year_level_id: string;
  section_id: string;
};

export async function signUp(
  email: string,
  password: string,
  profile?: SignUpProfile
) {
  const { data, error } = await supabaseSignUpClient.auth.signUp({
    email,
    password,
    options: {
      data: profile ? {
        full_name: profile.full_name,
        role: 'student',
        academic_level_id: profile.academic_level_id,
        course_id: profile.course_id,
        year_level_id: profile.year_level_id,
        section_id: profile.section_id,
      } : undefined,
    },
  });

  return { data, error };
}

export async function signIn(email: string, password: string, rememberSession = false) {
  await setSessionPersistence(rememberSession);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error && data.session) {
    setAuth(data.session);
  }
  return { data, error };
}

export function getPasswordResetRedirectUrl() {
  const configuredRedirect = process.env.EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL?.trim();
  if (configuredRedirect) return configuredRedirect;
  // Keep the existing web Site URL (the project currently uses localhost:3000)
  // and let the root route forward recovery hashes to /reset-password. This
  // avoids requiring a second web redirect allow-list entry for local testing.
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return Linking.createURL('reset-password');
}

export async function resetPasswordForEmail(email: string, redirectTo = getPasswordResetRedirectUrl()) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return { data, error };
}

export async function updatePassword(password: string) {
  const { data, error } = await supabase.auth.updateUser({ password });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    await clearLocalSession();
    console.error('Remote sign-out failed; the local session was cleared.', {
      message: error.message,
      status: error.status,
      code: error.code,
    });
    throw error;
  }
  try {
    await setSessionPersistence(false);
  } finally {
    setAuth(null);
  }
}

export async function clearLocalSession() {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  try {
    await setSessionPersistence(false);
  } finally {
    setAuth(null);
  }
  if (error) throw error;
}
