# QR-ATT Event Status Implementation Plan

## Implementation and deployment note

The implementation is provided in `supabase/migrations/20261015000000_add_event_status_and_secure_attendance.sql` and the matching fresh-install definitions in `supabase/schema.sql`. Apply the migration in the target Supabase SQL Editor (or through the project migration workflow) before testing the app. Verify the event status constraint, RPC grants, RLS policies, and existing event IDs/attendance counts in that project. Live Supabase behavior, emulator/device scanning, and RLS enforcement remain unverified until that deployment test is performed.

## Scope

Add authoritative `Open`/`Closed` event status management for teachers and administrators, and enforce closed-event attendance rejection in Supabase. Preserve existing event creation, QR scanning, attendance history, and attendance rows. The Edit Event Interface remains out of scope.

## Current-state findings

- `public.events` currently has no status column. Existing rows contain event identity, title, time window, creator, and creation timestamp.
- `lib/events.ts` creates/upserts events but does not set a status. `CloudEvent` also lacks status.
- `app/(tabs)/teacher.tsx` creates an event and renders its QR payload, but does not currently render a list or status control for previously created events.
- `lib/qr.ts` emits version-1 payloads containing event code, title, start, and end. Status is not in the payload; this is desirable because status must be read authoritatively from the database and cannot be trusted from a QR code.
- `lib/attendance.ts` currently performs client-side time checks, finds an event by code, creates a missing event from the QR payload, and directly inserts attendance. This direct insert path cannot enforce a closed status securely and must be replaced or routed through a database function.
- Current RLS permits authenticated users to insert their own attendance and permits event owners to update their own event rows. These policies are too broad for status management and closed-event enforcement.
- Current events are readable by authenticated users. Teacher event creation is restricted by the existing role-aware insert policy; administrator event reads are already covered by the authenticated read policy.
- Existing attendance is protected by `unique (student_id, event_id)` and must remain unchanged.

## Proposed design

### 1. Event status data model

- Add `status text not null default 'open'` to `public.events` with a check constraint allowing only `'open'` and `'closed'`.
- Treat `open` as the database value and display it as `Open`; treat `closed` as `Closed` in the UI.
- Add the status field to `CloudEvent`, event summary types, administrator event data, and any event card/detail view that displays event information.
- Preserve all existing event IDs, codes, timestamps, creators, and attendance rows. The migration should backfill existing events to `open` and should not delete, recreate, or reset events.
- Ensure fresh-install schema and the deployable migration use the same default and constraint.

### 2. Trusted status mutation

- Add a narrowly scoped `public.set_event_status(p_event_id uuid, p_status text)` `SECURITY DEFINER` function with `set search_path = public`.
- The function must validate:
  - the caller is authenticated;
  - the requested status is exactly `open` or `closed`;
  - the event exists;
  - a teacher may change status only for an event where `created_by = auth.uid()`;
  - an administrator may change status for any event permitted by the administrator role;
  - students and other users are rejected.
- The function must update only `events.status`, not event code, title, dates, creator, or any other field.
- Revoke broad function execution from `public` and grant execution only to `authenticated`; do not expose a service-role key or unrestricted privileged RPC.
- Replace the current broad authenticated event-update policy with a policy arrangement that prevents direct client updates from bypassing the status function. Event creation remains teacher-only.

### 3. Secure attendance registration

- Add a database-side `public.register_attendance(p_event_code text)` function, or an equivalently narrow server-side mechanism, that derives the student identity from `auth.uid()` rather than trusting a client-supplied student ID.
- The function must validate in the database:
  - an authenticated caller exists;
  - the caller is an eligible student according to the existing attendance rules;
  - the event code resolves to an existing event;
  - the event status is `open`;
  - the event’s start/end window permits attendance, if those fields are present;
  - the `(student_id, event_id)` duplicate rule remains enforced.
- Return a small success/result payload containing the event title or raise controlled errors that the client maps to clear messages such as `This event is closed.` and `Already registered for this event.`
- Remove the client fallback that creates arbitrary events during attendance registration. Unknown or deleted event codes should fail rather than create records without an authorized creator.
- Replace or remove the direct authenticated attendance insert policy/grant so a modified client cannot insert around the database function. Preserve student-owned attendance reads and teacher/admin attendance reads.
- Keep client-side QR parsing and optional time checks for responsiveness, but treat the database function as authoritative.

### 4. Services and QR compatibility

- Update `lib/events.ts` to include status and add read helpers that fetch status for teacher/admin event cards.
- Add a narrowly scoped `setEventStatus()` service that calls the trusted RPC and maps database errors to UI-safe messages.
- Update `lib/attendance.ts` so `registerAttendance()` parses the existing v1 QR payload, uses the event code, and calls the secure registration RPC. Do not add status to the QR payload; old and new QR codes should continue to resolve the current database status.
- Preserve the existing duplicate-attendance result handling and attendance history queries, adding status only where event display requires it.

### 5. Teacher and administrator UI

- In `app/(tabs)/teacher.tsx`, keep the current event creation form and QR generation intact. Add a compact list/status section for the teacher’s own events, with visible `Open`/`Closed` status and a control to close or reopen only their own events.
- Ensure status changes have loading/disabled states and clear success/error feedback. A closed event should communicate that scanning is no longer accepted.
- In `app/(tabs)/admin.tsx`, extend existing event cards with status and an administrator status control. The dashboard must call the same trusted status RPC; it must not update the table directly.
- If the existing history/event summary view displays event cards, include status there without changing student attendance history behavior.
- Reuse `COLORS`, `AppButton`, existing card styles, and the dark theme. Do not build the Edit Event Interface.

### 6. RLS and security review

- Keep event reads limited to authenticated users as currently configured.
- Keep event inserts limited to teachers creating events for themselves.
- Remove or narrow direct event updates so status changes go through the trusted function and students cannot update status.
- Remove direct attendance insertion for authenticated clients if the RPC is the sole insert path; retain only the necessary select policies.
- Ensure the status function and attendance function do not become unrestricted privileged functions: fixed search path, explicit input validation, explicit role/ownership checks, limited grants, and no arbitrary SQL inputs.
- Preserve the duplicate unique constraint and all existing attendance read restrictions.

## Migration and deployment plan

Create a migration such as `supabase/migrations/<timestamp>_add_event_status_and_secure_attendance.sql` that:

1. Adds the status column with default `open` and the check constraint.
2. Backfills any existing null status to `open` without touching attendance.
3. Creates the status mutation and secure attendance functions.
4. Replaces the overly broad event-update and attendance-insert policies/grants.
5. Grants only the required RPC execution privileges.
6. Leaves existing event and attendance records intact.

Update `supabase/schema.sql` to match fresh installations. Document applying the migration in Supabase SQL Editor and the need to verify the policies/functions in the target project before testing.

## Expected files

- `supabase/migrations/<timestamp>_add_event_status_and_secure_attendance.sql`
- `supabase/schema.sql`
- `lib/events.ts`
- `lib/attendance.ts`
- `lib/qr.ts` only if type compatibility requires a narrowly scoped adjustment; QR payload status should remain absent.
- `app/(tabs)/teacher.tsx`
- `app/(tabs)/admin.tsx`
- `app/(tabs)/history.tsx` only if existing event summaries need status labels.
- `FINALS/event_status_plan.md`

## Verification plan

Run after implementation:

1. Run `npx tsc --noEmit` and the available Expo build/export check.
2. Apply the migration to a test Supabase project and verify existing event IDs and attendance counts are unchanged; verify existing events are `open`.
3. Create a new teacher event and verify its stored status is `open` and its QR code remains scannable.
4. As the owning teacher, close and reopen the event; verify status is displayed and controls show loading/error feedback.
5. As an administrator, change status for an authorized event and verify the same result.
6. As a student, attempt status updates directly and through the app; verify both are rejected.
7. As an eligible student, register attendance for an open event and verify success.
8. Close the event, then attempt registration through the app and a direct RPC/API request; verify both are rejected by database-side status enforcement.
9. Attempt registration for an unknown event and verify it is rejected rather than creating an event.
10. Scan twice for an open event and verify the existing duplicate constraint/message remains effective.
11. Verify student attendance history, teacher summaries, admin dashboard reads, login, logout, and event creation continue working.
12. Record emulator/device and live Supabase checks that cannot be run locally as unverified.

## Non-goals and limitations

- No Edit Event Interface.
- No event deletion or bulk event management.
- No status embedded in or trusted from QR payloads.
- No weakening of event or attendance RLS.
- No claim of live RLS or Supabase behavior until the migration is applied and tested against the connected project.

## Implementation Status

Implemented. Open/Closed status, teacher and administrator controls, and closed-event enforcement in the attendance RPC are active. See `event_status.md` for the implemented files and verification notes.
