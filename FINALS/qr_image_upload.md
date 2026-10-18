# QR-ATT — Implement QR Image Upload and Scanning

## Objective

Allow users to choose a QR image from the device gallery and process it through the existing QR and attendance workflow.

## Implemented Features

- Added an **Upload QR Image** action to the Scan screen.
- Uses `expo-image-picker` for gallery selection.
- Uses the existing Expo Camera `scanFromURLAsync()` QR decoder.
- Sends decoded text through the existing `parseQRPayload()` and `registerAttendance()` services.
- Does not create attendance directly from an uploaded image.
- Handles canceled selection, unreadable images, missing QR codes, malformed payloads, closed events, duplicate attendance, time-window failures, and Supabase errors.
- Camera scanning remains available for eligible student accounts.

## Files

- `app/(tabs)/scan.tsx`
- `lib/attendance.ts`
- `lib/qr.ts`
- `app.json`
- `package.json`

## Dependencies

Added `expo-image-picker`. No separate QR decoder was added because `expo-camera` already provides native image-URI QR decoding for Expo SDK 54.

## Security

Uploaded QR images use the same parser, authenticated user, database attendance RPC, status checks, time checks, and duplicate constraint as camera scans.

## Verification

TypeScript and Expo web export checks passed. Native gallery decoding still requires device/runtime verification.
