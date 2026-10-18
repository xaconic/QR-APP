# QR-ATT — Implement Event Status

Implement event status management in my existing QR-ATT application.

**Prerequisite:** The Administrator role has already been implemented.

**Objective:** Allow authorized teachers and administrators to open and close events, while preventing attendance registration for closed events.

## Requirements

1. Inspect the existing events schema, event service, teacher screen, QR payload format, attendance registration function, and Supabase RLS policies.
2. Add an event status field supporting `Open` and `Closed`.
3. Set new events to `Open` by default.
4. Safely migrate existing events without deleting or resetting existing attendance data.
5. Display event status clearly in relevant event cards and detail views.
6. Allow authorized teachers to manage their own events and administrators to manage events according to their permissions.
7. Prevent students from changing event status.
8. Provide clear feedback when an event is closed.
9. Preserve existing QR scanning, event creation, and attendance history functionality.

## Security Requirements

A closed event must not accept new attendance records, even if someone bypasses the frontend.

Implement appropriate database-side enforcement using a secure database function or another suitable server-side mechanism.

Validate the authenticated student's identity, event existence, event status, and applicable attendance rules before inserting attendance.

Preserve the existing duplicate attendance constraint.

Review RLS policies carefully. Do not weaken security or introduce unrestricted privileged database functions.

## Testing

Verify:
- New events default to Open.
- Authorized users can close events.
- Unauthorized users cannot modify event status.
- Attendance succeeds for eligible students when an event is Open.
- Attendance is rejected when an event is Closed.
- Duplicate attendance remains prevented.
- Existing event and attendance records remain intact.

## Scope Restrictions

Implement Event Status and closed-event enforcement only. Do not implement the Edit Event Interface yet.

Document the SQL migration and any manual Supabase setup required.

## Final Report

List files changed, SQL changes, security enforcement, tests performed, and anything not verified.

Inspect the existing implementation, then implement and test the feature.

## Implementation Status

Implemented. Events support `open` and `closed` statuses; teachers manage owned events, administrators manage authorized events, and `register_attendance()` rejects closed events inside Supabase. The QR payload remains version 1 and does not embed status. The existing unique attendance constraint remains unchanged.

Relevant files include `lib/events.ts`, `lib/attendance.ts`, `app/(tabs)/teacher.tsx`, `app/(tabs)/admin.tsx`, `supabase/schema.sql`, and the status/attendance migration. TypeScript and Expo web export checks passed; live Supabase RLS testing requires applying the migrations.
