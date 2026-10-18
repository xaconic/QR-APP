# QR-ATT — Edit Event Interface Implementation Plan

## Objective

Add an authorized Edit Event Interface to the existing QR-ATT application. The feature must preserve event IDs, attendance rows, event status enforcement, and QR attendance behavior while allowing teachers and administrators to update supported event fields.

This plan is scoped to edit-event UI and its required database integration. Existing creation, scanning, attendance history, and administrator functionality should be reused rather than rebuilt.

## Current repository findings

- Event creation and the teacher event list are implemented in `app/(tabs)/teacher.tsx`.
- Event reads, creation, and status mutation are implemented in `lib/events.ts`.
- The existing event model currently contains `id`, `event_code`, `title`, `start_time`, `end_time`, `created_by`, `created_at`, and `status`.
- The current QR payload remains version 1 and identifies an event by `event_code`; it does not contain status.
- Teacher events appear in the Teacher tab and teacher attendance summaries in `app/(tabs)/history.tsx`.
- Administrator event cards appear in `app/(tabs)/admin.tsx`.
- The current status RPC is intentionally narrow and only updates `events.status`; it should remain available for quick Open/Closed controls.
- There is no existing venue or description field in the event schema.
- There is no dedicated event detail/edit route yet.

## Proposed user experience

### Entry points

Add an Edit control to each teacher-owned event card and each administrator event card. Students must not receive an Edit control or an edit route they can use successfully.

Use a shared editor implementation so teacher and administrator screens have the same fields, validation, loading state, and error handling. The likely structure is:

- `components/EventEditor.tsx` — reusable form and field layout.
- `app/event-edit.tsx` or an equivalent Expo Router screen — receives the event ID and loads the event.
- `lib/events.ts` — fetch and save services.
- Existing teacher/admin cards — navigate to the editor with the selected event ID.

If the project’s current tab layout makes a standalone route awkward, use a controlled modal/editor panel from the existing screen. Do not duplicate the form separately in teacher and admin screens.

### Form fields

Prepopulate the selected event with:

- Event title — required.
- Event code — required and normalized using the same safe text rules as event creation.
- Event date — derived from the existing start/end timestamps.
- Start time — required when the existing event uses a start time.
- End time — required when the existing event uses an end time.
- Venue — optional after migration.
- Description — optional after migration.
- Status — Open or Closed.

Reuse the existing `@react-native-community/datetimepicker` behavior from the teacher creation screen. Preserve the existing dark theme, `COLORS`, and `AppButton` conventions.

### Form actions

- Save disables the form, prevents duplicate submissions, validates locally, calls the trusted update RPC, shows success feedback, refreshes the originating event list, and returns to the previous screen.
- Cancel discards unsaved changes and returns without calling Supabase.
- Display loading indicators while loading and saving.
- Keep the selected event ID in navigation state; never use the editable event code as the record identity.

## Validation rules

Client validation should provide fast feedback, while the database function remains authoritative.

- Title and event code must be non-empty after trimming.
- Event code must pass the existing safe character and length rules.
- Start must be before end when both are present.
- Reject invalid or unparseable date/time values.
- Preserve nullable start/end behavior only if the existing schema and creation rules allow it.
- Reject duplicate event codes with a clear message such as `That event code is already in use.`
- Accept only `open` or `closed` for status.
- Do not allow an edit to change `id`, `created_by`, `created_at`, attendance rows, or unrelated profile data.

## Database migration

Create a migration such as:

`supabase/migrations/<timestamp>_add_editable_event_fields_and_update_rpc.sql`

### 1. Add optional fields

If absent, add `venue text` and `description text`.

Do not recreate the `events` table. Do not alter event IDs or attendance foreign keys. Use bounded application validation for text length; optionally add database checks if consistent with existing conventions.

Update `supabase/schema.sql` so fresh installations contain the same fields.

### 2. Preserve old QR codes when event codes change

The current QR format stores `event_code`, so changing the primary event code would otherwise make previously printed QR codes unusable.

Add `public.event_code_aliases` with:

- `event_id uuid not null references public.events(id) on delete cascade`
- `event_code text primary key`
- `created_at timestamptz not null default now()`
- protection against an alias colliding with a current `events.event_code`

When an event code changes, the trusted update function should preserve the old code as an alias before writing the new code. Attendance registration should resolve the current event code, then the alias table. The event’s current database title, status, and time window remain authoritative.

If the product owner instead chooses to invalidate old QR codes, show an explicit warning before save. The preferred implementation is alias preservation because it keeps existing printed QR codes working.

### 3. Add a trusted update function

Create a narrowly scoped function such as:

`public.update_event(p_event_id uuid, p_event_code text, p_title text, p_start_time timestamptz, p_end_time timestamptz, p_venue text, p_description text, p_status text)`

Use `plpgsql`, `security definer`, and `set search_path = public`. Validate authentication, status, event existence, teacher ownership, administrator authorization, role rejection, text lengths, date order, and duplicate codes.

Update only supported event columns. Do not accept arbitrary column names or SQL fragments. Do not accept client-supplied creator/student identities.

For code changes, preserve the previous code in `event_code_aliases` in the same transaction. Return only the updated event representation needed by the UI.

### 4. RLS and grants

- Keep authenticated event reads unchanged.
- Remove any direct authenticated event-update path that could bypass authorization.
- Revoke direct event update privileges from `authenticated` if granted.
- Revoke function execution from `public`; grant it only to `authenticated`.
- Prefer resolving aliases inside the attendance function so clients do not need direct alias access.
- Preserve attendance insert restrictions and closed-event enforcement in `register_attendance()`.
- Keep the existing unique attendance constraint unchanged.

## Service-layer changes

Extend `lib/events.ts` with an expanded `CloudEvent`, an `EventEditInput` type, `getEventById(eventId)`, and `updateEvent(eventId, input)`. Reuse safe input normalization and map errors for unauthorized updates, missing events, duplicate codes, invalid dates, invalid status, and alias failures.

The service must call the trusted update RPC. It must not call `.from('events').update()` from the client.

Update `lib/admin.ts`, `lib/attendance.ts`, teacher queries, and summary types to include venue, description, and status where needed. Do not modify `lib/qr.ts` to embed status.

## Teacher and administrator integration

### Teacher

In `app/(tabs)/teacher.tsx`, add Edit to each owned event card, navigate with the stable event UUID, refresh after save, and preserve the existing Create Event QR form and status buttons. After a code change, show a notice that old QR codes remain valid through aliases.

### Administrator

In `app/(tabs)/admin.tsx`, add Edit to each event card, use the same editor and update RPC, allow only database-authorized events, refresh dashboard data after save, and leave attendance summaries and user data unchanged.

### History and QR behavior

Include venue/description only where event details are already displayed. Do not alter student attendance history semantics. Existing QR scans must resolve current database status and time window. A closed event remains rejected by the database for both old and new QR codes. An event-code change must not silently create a new event.

## Testing plan

- Existing values load correctly, including null venue/description.
- Valid updates save; Cancel leaves the database unchanged.
- Save disables controls and prevents duplicate requests.
- Empty title/code, unsafe code, invalid dates, and end-before-start are rejected.
- Duplicate codes are handled clearly.
- Owning teachers can edit only their events.
- Administrators can edit authorized events.
- Students and unauthorized users are rejected through direct RPC calls.
- Event UUID, attendance IDs, and attendance counts remain unchanged.
- Old QR codes continue working after code changes through aliases.
- New QR codes use the new code.
- Closed events reject old and new QR codes.
- Unknown codes never create events.
- Run `npx tsc --noEmit` and the available Expo build/export check.
- Apply and verify the migration in a test Supabase project before emulator testing.

## Expected files

- `supabase/migrations/<timestamp>_add_editable_event_fields_and_update_rpc.sql`
- `supabase/schema.sql`
- `lib/events.ts`
- `lib/admin.ts`
- `lib/attendance.ts` if summaries/types need new fields
- `components/EventEditor.tsx` or the chosen shared editor component
- `app/event-edit.tsx` or the selected Expo Router editor route
- `app/(tabs)/teacher.tsx`
- `app/(tabs)/admin.tsx`
- `app/(tabs)/history.tsx` only if event details need the new fields
- `lib/qr.ts` only for type compatibility; do not add status to QR payloads

## Remaining decisions before implementation

- Confirm that old QR codes should remain valid after code changes; alias preservation is recommended.
- Confirm whether venue and description should appear in cards/history or only in the editor/detail view.
- Confirm whether nullable start/end values remain supported.
- Confirm standalone Expo Router route versus modal editor presentation.

## Implementation Status

Implemented with the shared `EventEditor`, UUID-based editor route, trusted update RPC, and event-code aliases that preserve old QR codes. See `edit_event.md` for the implementation summary and verification notes.

