import { router, Tabs, usePathname } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MotionPressable from '@/components/MotionPressable';
import { useAuth } from '@/lib/auth';
import { getProfileWithError, type Role } from '@/lib/profiles';
import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';

export default function TabLayout() {
    const { user, session, loading } = useAuth();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();
    const createSelected = pathname.includes('create-event');
    const [role, setRole] = useState<Role | null>(null);
    const canCreateEvent = role === 'teacher' || role === 'admin';

    useEffect(() => {
      setRole(null);
    }, [user?.id]);

    useEffect(() => {
      let active = true;
      if (loading) return () => { active = false; };
      if (!user || !session?.access_token) {
        setRole(null);
        router.replace('/login');
        return () => { active = false; };
      }
      getProfileWithError(user.id, session?.access_token).then(({ profile, error }) => {
        if (!active) return;
        if (error) console.error('Unable to load the account role for navigation.', error);
        setRole(profile?.is_active === false ? null : profile?.role ?? null);
      }).catch((error: unknown) => {
        if (!active) return;
        console.error('Unable to load the account role for navigation.', error);
        setRole(null);
      });
      return () => { active = false; };
    }, [loading, pathname, session?.access_token, user?.id]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: 'transparent' },
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textSecondary,
        headerStyle: { backgroundColor: COLORS.background },
        headerShadowVisible: false,
        headerTintColor: COLORS.textPrimary,
        tabBarHideOnKeyboard: true,
        tabBarStyle: { backgroundColor: COLORS.background, borderTopColor: COLORS.border, height: 58 + insets.bottom, paddingBottom: Math.max(insets.bottom, 6), paddingTop: 5 },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', fontFamily: FONTS.semiBold },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'grid' : 'grid-outline'}
              color={color}
              size={22}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          href: role === 'student' ? undefined : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'qr-code' : 'qr-code-outline'}
              color={color}
              size={22}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'time' : 'time-outline'}
              color={color}
              size={22}
            />
          ),
        }}
      />

      {canCreateEvent ? (
        <Tabs.Screen
          name="create-event"
          options={{
            title: '',
            tabBarLabel: () => null,
            tabBarButton: () => (
              <View style={styles.createTabSlot}>
                <MotionPressable
                  style={({ pressed }) => [styles.createTabButton, createSelected && styles.createTabSelected, pressed && styles.createTabPressed]}
                  onPress={() => {
                    if (createSelected) {
                      router.back();
                      return;
                    }
                    const params = {
                      returnTo: pathname.includes('history') ? '/history' : pathname.includes('profile') ? '/profile' : pathname.includes('teacher') ? '/teacher' : pathname.includes('admin') ? '/admin' : '/',
                      reset: String(Date.now()),
                    };
                    router.push({ pathname: '/create-event-modal', params });
                  }}
                  android_ripple={{ color: `${COLORS.textOnPrimary}33`, borderless: true }}
                >
                  <Ionicons name="add" color={COLORS.textOnPrimary} size={createSelected ? 33 : 30} />
                </MotionPressable>
              </View>
            ),
          }}
        />
      ) : (
        <Tabs.Screen name="create-event" options={{ href: null }} />
      )}

      <Tabs.Screen
      name="teacher"
      options={{
        title: 'Teacher',
        href: role === 'teacher' ? undefined : null,
        tabBarIcon: ({ color, focused }) => (
          <Ionicons
            name={focused ? 'briefcase' : 'briefcase-outline'}
            color={color}
            size={22}
          />
        ),
      }}
    />

      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          href: role === 'admin' ? undefined : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'} color={color} size={22} />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person-circle' : 'person-circle-outline'}
              color={color}
              size={22}
            />
          ),
        }}
      />

    </Tabs>
  );
}

const styles = StyleSheet.create({
  createTabSlot: {
    position: 'absolute',
    left: '50%',
    top: 0,
    width: 46,
    marginLeft: -23,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  createTabButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryButtonStart,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  createTabPressed: { opacity: 0.9 },
  createTabSelected: { backgroundColor: COLORS.surfaceRaised },
});
