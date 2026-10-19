import { Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth';
import BrandedSplashScreen from '@/components/BrandedSplashScreen';

const AUTH_RESTORE_FALLBACK_MS = 4000;

export default function Index() {
  const { session, loading } = useAuth();
  const [restoreFallbackElapsed, setRestoreFallbackElapsed] = useState(false);
  const browserRecoveryLink = Platform.OS === 'web'
    && typeof window !== 'undefined'
    && (window.location.hash.includes('access_token=') || window.location.search.includes('code='));

  useEffect(() => {
    const timeout = setTimeout(() => setRestoreFallbackElapsed(true), AUTH_RESTORE_FALLBACK_MS);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!browserRecoveryLink || typeof window === 'undefined') return;
    // Preserve the Supabase hash while moving the old root-level callback into
    // the dedicated reset screen. A normal router redirect can otherwise drop
    // the fragment before the recovery screen reads the tokens.
    window.location.replace(`/reset-password${window.location.hash}`);
  }, [browserRecoveryLink]);

  if (browserRecoveryLink) return null;
  if (loading && !restoreFallbackElapsed) return <BrandedSplashScreen />;
  return <Redirect href={!loading && session ? '/(tabs)' : '/login'} />;
}
