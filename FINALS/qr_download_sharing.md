# QR-ATT — Implement QR Code Download and Sharing

## Objective

Allow authorized teachers and administrators to save or share event QR codes without changing attendance data.

## Implemented Features

- Added reusable `components/EventQRCode.tsx`.
- Generates QR values with the existing version 1 `buildQRPayload()` function.
- Added Save QR Code action.
- Added Share QR Code action.
- Creates a PNG file in the app cache using `react-native-qrcode-svg` and Expo FileSystem.
- Uses Expo Media Library for direct gallery saving in native development/standalone builds.
- Uses Expo Sharing for native sharing.
- In Expo Go, Save QR Code falls back to the native share sheet because Expo Go cannot provide the required full media-library access.
- Added image/media permission configuration in `app.json`.

## Authorized Access

- Teachers can access QR controls for events they own.
- Administrators can access QR controls for authorized events.
- Students can scan QR codes but cannot access event-management QR controls.
- Saving or sharing never records attendance.

## Files

- `components/EventQRCode.tsx`
- `app/(tabs)/index.tsx`
- `app/(tabs)/teacher.tsx`
- `app/(tabs)/admin.tsx`
- `app.json`
- `package.json`

## Dependencies

Added `expo-file-system`, `expo-media-library`, and `expo-sharing`. These are Expo SDK 54-compatible native modules.

## Verification and Limitation

`npx tsc --noEmit` and Expo web export passed. Direct gallery saving requires a native development or standalone build. It cannot be fully enabled inside Expo Go. The Android native build was attempted but encountered an existing React Native Worklets/NDK linker issue before installation.
