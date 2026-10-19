import QRCode from 'react-native-qrcode-svg';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { useAuth } from '@/lib/auth';
import { getRotatingCheckinToken } from '@/lib/attendance';
import { buildQRPayload } from '@/lib/qr';

type Props = {
  event: { id: string; event_code: string; title: string };
  compact?: boolean;
};

const TOKEN_REFRESH_MS = 15_000;

export default function EventQRCode({ event, compact = false }: Props) {
  const { session } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let requestInProgress = false;
    const refreshToken = async () => {
      if (requestInProgress) return;
      requestInProgress = true;
      const result = await getRotatingCheckinToken(event.id, session);
      requestInProgress = false;
      if (!active) return;
      if (result.error || !result.token || !result.expiresAt) {
        setError(result.error ?? 'Could not load a check-in QR code.');
        return;
      }
      setToken(result.token);
      setExpiresAt(Date.parse(result.expiresAt));
      setError(null);
    };

    void refreshToken();
    const refreshTimer = setInterval(() => { void refreshToken(); }, TOKEN_REFRESH_MS);
    const clockTimer = setInterval(() => setNow(Date.now()), 1000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshToken();
    });

    return () => {
      active = false;
      clearInterval(refreshTimer);
      clearInterval(clockTimer);
      appStateSubscription.remove();
    };
  }, [event.id, session]);

  const isExpired = !expiresAt || expiresAt <= now;
  const remainingSeconds = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
  const payload = token && !isExpired
    ? buildQRPayload({ eventId: event.event_code, token })
    : null;

  return <View style={[styles.container, compact && styles.compactContainer]}>
    {payload
      ? <View style={[styles.qrBox, compact && styles.compactQrBox]}><QRCode value={payload} size={compact ? 176 : 210} quietZone={compact ? 8 : 12} /></View>
      : <View style={[styles.qrPlaceholder, compact && styles.compactQrBox]}>
          {error && isExpired
            ? <Text style={styles.error}>{error}</Text>
            : <ActivityIndicator color={COLORS.primary} />}
        </View>}
    <Text style={styles.hint} accessibilityLiveRegion="polite">
      {payload
        ? `Refreshes every 15s · ${remainingSeconds}s remaining`
        : error ?? 'Loading your live check-in QR...'}
    </Text>
    <Text style={styles.warning}>Keep this screen open during check-in. Screenshots expire, but live sharing may still work.</Text>
  </View>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', marginTop: 10, gap: 6 },
  compactContainer: { marginTop: 12, width: '100%' },
  qrBox: { backgroundColor: '#FFF', padding: 12, borderRadius: 12 },
  compactQrBox: { padding: 9, borderRadius: 14 },
  qrPlaceholder: { backgroundColor: '#FFF', padding: 12, borderRadius: 12, width: 234, height: 234, alignItems: 'center', justifyContent: 'center' },
  hint: { color: COLORS.textSecondary, textAlign: 'center', fontSize: 12, fontFamily: FONTS.medium, lineHeight: 17 },
  warning: { color: COLORS.textMuted, textAlign: 'center', fontSize: 11, fontFamily: FONTS.regular, lineHeight: 15 },
  error: { color: COLORS.danger, textAlign: 'center', fontSize: 13, fontFamily: FONTS.medium },
});
