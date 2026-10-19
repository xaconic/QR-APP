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

### Rotating Attendance QR Codes

- Teachers and administrators request a short-lived check-in token for an event through the `issue_event_checkin_token` Supabase function.
- The generated QR payload contains the event code and token; the display requests a fresh token every 15 seconds.
- Each token expires 30 seconds after the database issues it. The QR display uses the returned expiry timestamp to show the remaining time and hides an expired code.
- When a student scans the QR, the app validates the payload format and sends the event code and token to the `register_attendance` Supabase function.
- The database verifies that the token belongs to the event and has not expired, then checks student eligibility, event availability and time rules before recording attendance.
- Duplicate attendance is rejected by the database, and the app shows a specific result for expired codes, closed events, and duplicate check-ins.
- Token validity and attendance recording require an internet connection. Because each token expires after 30 seconds but refreshes every 15 seconds, the previous token can remain valid briefly after the QR display updates; tokens are not single-use.

## Added Dependencies

- `expo-image-picker`
- `expo-file-system`
- `expo-media-library`
- `expo-sharing`

## Validation

- `npx tsc --noEmit` passed.
- `npx expo export --platform web` passed.
- Native gallery save requires a development/standalone build; Expo Go uses share-sheet fallback.
