# QR-ATT — Features Added

## Implemented Features

### Home Event Discovery

- Browse active Supabase events from Home.
- Search by title or event code.
- Filter All, Open, Closed, and My Attendance events.
- View event details, venue, description, status, and attendance state.
- Use role-appropriate event and scanner actions.

### QR Image Upload and Scanning

- Select QR images from the device gallery.
- Decode images using Expo Camera.
- Reuse the existing QR parser and attendance registration service.
- Preserve closed-event, time-window, duplicate, and authorization checks.

### QR Code Download and Sharing

- Save authorized event QR codes as PNG images in native builds.
- Share QR code images through the native share interface.
- Preserve the existing QR payload format.
- Keep students restricted to scanning rather than event management.

## Added Dependencies

- `expo-image-picker`
- `expo-file-system`
- `expo-media-library`
- `expo-sharing`

## Validation

- `npx tsc --noEmit` passed.
- `npx expo export --platform web` passed.
- Native gallery save requires a development/standalone build; Expo Go uses share-sheet fallback.
