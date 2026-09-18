import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { getProfile } from '@/lib/profiles';
import {
  getAttendanceHistory,
  getTeacherEventSummary,
  type AttendanceRecord,
  type TeacherEventSummary,
} from '@/lib/attendance';

export default function HistoryScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [teacherSummaries, setTeacherSummaries] = useState<TeacherEventSummary[]>([]);
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    const profile = await getProfile(user.id);
    const currentRole = profile?.role ?? 'student';
    setRole(currentRole);

    if (currentRole === 'teacher') {
      const summaries = await getTeacherEventSummary(user.id);
      setTeacherSummaries(summaries);
      setRecords([]);
      setLoading(false);
      return;
    }

    const rows = await getAttendanceHistory(user.id);
    setRecords(rows);
    setTeacherSummaries([]);
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  if (role === 'teacher') {
    return (
      <View style={[styles.container, { paddingTop: 24 + insets.top }]}>
        <Text style={styles.title}>Teacher Attendance</Text>

        {loading ? (
          <Text style={styles.subtitle}>Loading teacher attendance...</Text>
        ) : teacherSummaries.length === 0 ? (
          <Text style={styles.subtitle}>
            No events yet. Create an event from the Teacher tab to see attendance.
          </Text>
        ) : (
          <FlatList
            data={teacherSummaries}
            keyExtractor={(item) => item.eventId}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.eventTitle}>{item.title}</Text>
                <View style={styles.row}>
                  <Text style={styles.badge}>{item.attendeeCount}</Text>
                  <Text style={styles.eventMeta}>{item.eventCode}</Text>
                </View>
                <Text style={styles.eventMeta}>Students checked in</Text>
              </View>
            )}
          />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: 24 + insets.top }]}>
      <Text style={styles.title}>Attendance History</Text>

      {loading ? (
        <Text style={styles.subtitle}>Loading records...</Text>
      ) : records.length === 0 ? (
        <Text style={styles.subtitle}>
          No records yet. Scan a QR code to register your attendance.
        </Text>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.eventTitle}>{item.eventTitle}</Text>
              <Text style={styles.eventMeta}>{item.eventId}</Text>
              <Text style={styles.eventMeta}>{formatDate(item.scannedAt)}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function shortId(id: string) {
  return id ? `…${id.slice(-8)}` : 'unknown';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 32,
  },
  list: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  eventMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  badge: {
    backgroundColor: '#EAF7EE',
    color: '#137B3C',
    fontWeight: '700',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
    fontSize: 12,
  },
  attendeeRow: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
});