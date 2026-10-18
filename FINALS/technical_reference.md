# QR-ATT technical reference

## Architecture

QR-ATT is an Expo SDK 54 React Native/TypeScript application using Expo Router for navigation, Supabase Auth for sessions, PostgreSQL for persisted data, RLS for row access, and security-definer RPCs for operations that must validate roles or event eligibility in the database.

The main client layers are:

- `app/(tabs)/_layout.tsx`: role-aware tab navigation and the centered event-create action.
- `lib/auth.ts`: registration, sign-in, sign-out, session restoration, and auth-state notification.
- `lib/profiles.ts`: role/profile loading.
- `lib/events.ts`: event creation, transactional event editing, status changes, discovery, and QR event data.
- `lib/academic.ts`: catalogs, event audience configuration, attendance summaries, and manual attendance actions.
- `components/EventAudiencePicker.tsx`: reusable All Students/Selected Groups configuration.
- `components/EventAttendanceManager.tsx`: event-specific filters, eligible roster, counts, and manual status changes.
- `supabase/migrations/20261043000000_finalize_event_eligibility_security.sql`: final event authorization, exact audience matching, historical roster reporting, and student discovery RPC.

## Roles and authorization

- Students can update permitted personal fields, view their own history, view eligible events, and call `register_attendance` through the QR scanner.
- Teachers can create events, manage owned events, and manage events assigned through `event_staff` when `can_manage` is true.
- Administrators can manage all events and use the administrative RPCs for users, catalogs, assignments, and event repair.

Role checks in the UI control navigation only. The database checks `auth.uid()`, active profile state, role, event ownership, and event-staff assignments in RPCs such as `is_event_manager`, `create_event_with_audience`, `update_event_with_audience`, `set_event_status`, and `get_event_attendance_summary`.

## Event and attendance flow

1. A Teacher or Administrator presses the centered `+` button.
2. `CreateEventTab.save` validates required fields and calls `createEvent` in `lib/events.ts`.
3. `create_event_with_audience_details` delegates to `create_event_with_audience`, inserts the event with the authenticated user as `created_by`, validates complete groups, and stores optional venue/description fields.
4. `createEvent` retrieves the saved audience configuration before reporting success.
5. `EventQRCode` renders the signed application payload and supports saving/sharing the QR image.
6. A student scans in `app/(tabs)/scan.tsx`; `registerAttendance` parses the payload and calls `register_attendance`.
7. The database checks authentication, student status, event status/time, exact audience membership, and the `(student_id,event_id)` uniqueness rule.
8. An authorized manager opens `EventAttendanceManager`, which loads the saved event audience and derives only its valid course/year/section filters.
9. Manual status buttons call `record_event_attendance` or `clear_event_attendance`.
10. The event owner or administrator closes the event with `set_event_status`; closed events reject QR submissions.

## Eligibility rules

`events.audience_mode` is explicitly `all`, `groups`, or `legacy`. `legacy` means the configuration is missing/ambiguous and is never treated as All Students. Restricted events use complete `event_audience` rows containing course, year level, and section IDs. The attendance summary uses `student_is_in_event_roster`, including historical academic assignments where available, so reassignment does not erase historical reporting.

The client keeps complete saved groups in `EventAudienceConfig.groups`; it does not reconstruct unrelated combinations from independent global lists. Parent filter changes clear dependent selections, and the database applies the same audience rule to QR and manual attendance operations.

## Event-driven examples

| Event | Handler | Action | Result |
| --- | --- | --- | --- |
| Login button press | `handleLogin` in `app/login.tsx` | Calls `signIn` | Auth session is stored and the user enters protected tabs. |
| Registration submit | `handleRegister` in `app/register.tsx` | Calls `signUp` with academic IDs | Supabase Auth and the profile trigger validate/save the account. |
| Create Event press | `save` in `app/(tabs)/create-event.tsx` | Calls `createEvent` | Event and audience are persisted and the QR result appears. |
| QR detected | `handleBarcodeScanned` in `app/(tabs)/scan.tsx` | Calls `processData` and `registerAttendance` | Valid eligible attendance is recorded once, or an error is shown. |
| Attendance status press | `mark` in `EventAttendanceManager` | Calls `recordEventAttendance`/`clearEventAttendance` | Authorized managers update or unmark a roster entry. |
| Close event press | `handleStatusChange` in `app/(tabs)/teacher.tsx` or `changeStatus` in `app/(tabs)/admin.tsx` | Calls `setEventStatus` | The event closes and new QR submissions are rejected. |
| Logout press | `handleSignOut` in `app/(tabs)/profile.tsx` | Calls `signOut` | Auth state clears and protected navigation ends. |

## Troubleshooting

- A restricted event showing no roster means its `audience_mode` is `legacy`; an Administrator must open Edit Event and save a verified participant configuration.
- A Teacher unable to manage an assigned event means the `event_staff` row or `can_manage` value is missing.
- A newly created event that cannot verify its audience means the final Supabase migration has not been applied.
- Closed, expired, duplicate, invalid, or ineligible QR scans are rejected by `register_attendance`; inspect the returned message rather than bypassing the RPC.

Apply the Supabase migrations in order before testing real accounts. This workspace has TypeScript and diff validation available, but no live Supabase migration or multi-account RLS test was executed from this environment.
