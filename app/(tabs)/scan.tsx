import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from '@/components/AppButton';
import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { useAuth } from '@/lib/auth';
import { registerAttendance } from '@/lib/attendance';
import { getProfile, type Role } from '@/lib/profiles';

export default function ScanScreen() {
  const { user, session } = useAuth();
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState<Role | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);

  useEffect(() => {
    let active = true;
    if (!user) { setRole(null); setRoleLoading(false); return () => { active = false; }; }
    getProfile(user.id, session?.access_token).then((profile) => { if (active) { setRole(profile?.role ?? null); setRoleLoading(false); } });
    return () => { active = false; };
  }, [session?.access_token, user]);

  const processData = async (data: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setScanned(true);
    setProcessing(true);
    try {
      const result = await registerAttendance(data);
      setMessage(result.message);
      setSuccess(result.success);
    } catch (error) {
      console.error('Attendance submission failed before a server response was received.', error);
      setSuccess(false);
      setMessage('Attendance could not be confirmed. Check your connection and try again.');
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  };

  if (roleLoading) return <View style={styles.container}><ActivityIndicator color={COLORS.primary} /></View>;
  if (role !== 'student') return <View style={styles.container}><Text style={styles.title}>Students Only</Text><Text style={styles.subtitle}>Only student accounts can scan event QR codes for attendance.</Text></View>;

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Camera Permission Needed</Text>
        <Text style={styles.subtitle}>
          We need access to your camera to scan QR codes.
        </Text>
        <AppButton
          theme="primary"
          title="Grant Permission"
          icon="camera"
          onPress={requestPermission}
        />
      </View>
    );
  }

  const handleBarcodeScanned = ({ data }: { data: string }) => { if (!processing) void processData(data); };

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
      />

      <View style={[styles.overlay, { bottom: Math.max(insets.bottom, 16) + 12 }]}>
        <Text style={styles.overlayText}>
          {processing ? 'Processing QR code...' : scanned ? 'QR Code detected!' : 'Point your camera at a QR code'}
        </Text>

        {scanned && message && (
          <Text
            style={[styles.scanResult, success ? styles.success : styles.error]}
          >
            {message}
          </Text>
        )}

        {scanned && (
          <AppButton
            theme="primary"
            title="Scan Again"
            icon="refresh"
            onPress={() => {
              setScanned(false);
              setMessage(null);
              setSuccess(false);
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  overlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    alignItems: 'center',
  },
  overlayText: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
    marginBottom: 6,
    textAlign: 'center',
  },
  scanResult: { fontSize: 14, textAlign: 'center', marginBottom: 8, fontWeight: '600', fontFamily: FONTS.semiBold },
  success: { color: COLORS.success },
  error: { color: COLORS.danger },
});
