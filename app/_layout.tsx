import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as NavigationBar from 'expo-navigation-bar';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
const Inter_400Regular = require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf') as number;
const Inter_500Medium = require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf') as number;
const Inter_600SemiBold = require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf') as number;
const Inter_700Bold = require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf') as number;
const Inter_800ExtraBold = require('@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf') as number;
import { COLORS } from '@/constants/colors';
import { initializeAuth } from '@/lib/auth';
import AnimatedBackground from '@/components/AnimatedBackground';

void SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
  console.warn('Could not keep the splash screen visible while fonts load.', error);
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  const [rootLayoutReady, setRootLayoutReady] = useState(false);

  useEffect(() => {
    const stopAuth = initializeAuth();
    if (Platform.OS === 'android') void NavigationBar.setButtonStyleAsync('light');
    return stopAuth;
  }, []);

  useEffect(() => {
    if (fontError) throw fontError;
    if (!fontsLoaded || !rootLayoutReady) return;
    void SplashScreen.hideAsync().catch((error: unknown) => {
      console.warn('Could not hide the splash screen after the app layout was ready.', error);
    });
  }, [fontsLoaded, fontError, rootLayoutReady]);

  if (fontError) throw fontError;
  if (!fontsLoaded) return null;

  return (
    <View style={styles.root} onLayout={() => setRootLayoutReady(true)}>
      <AnimatedBackground />
      <StatusBar style="light" backgroundColor={COLORS.background} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" options={{ animation: 'fade', animationDuration: 220 }} />
        <Stack.Screen name="register" options={{ animation: 'fade', animationDuration: 220 }} />
        <Stack.Screen name="forgot-password" options={{ animation: 'fade', animationDuration: 220 }} />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade', animationDuration: 220 }} />
        <Stack.Screen name="event-edit" />
        <Stack.Screen name="create-event-modal" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
});
