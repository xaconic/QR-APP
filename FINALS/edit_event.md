# QR-ATT — Implement Edit Event Interface

Implement an Edit Event Interface in my existing QR-ATT application.

**Prerequisites:** The Administrator role and Event Status features have already been implemented.

## Objective

Allow authorized teachers and administrators to edit existing events while preserving event relationships, attendance records, and QR attendance functionality.

## Editable Fields

Support the following fields when available in the schema:

- Event title.
- Event code.
- Event date.
- Start time.
- End time.
- Venue.
- Description.
- Event status, including Open and Closed.

If venue or description fields are missing, add them using a documented, safe database migration.

## Interface Requirements

1. Inspect the existing event creation form, event service, date/time pickers, QR generation, and navigation.
2. Add an Edit button to appropriate event views.
3. Prepopulate the form with the selected event's current values.
4. Reuse existing form components and UI patterns.
5. Validate required fields, event-code uniqueness, and date/time combinations.
6. Save updates to Supabase.
7. Display loading indicators and success or error feedback.
8. Prevent duplicate submissions while saving.
9. Provide a Cancel action that discards unsaved changes.
10. Preserve the existing dark theme and Expo Router conventions.

## Authorization and Data Integrity

- Teachers may edit only events they are authorized to manage.
- Administrators may edit events according to their permissions.
- Students must not edit events.
- Enforce authorization through RLS or trusted server-side logic, not only frontend button visibility.
- Preserve existing attendance records when events are edited.
- Handle event-code changes carefully because existing QR codes may contain the old event code.
- Ensure edits cannot bypass closed-event attendance restrictions.
- Avoid unnecessary changes to unrelated database tables or application features.

## Testing

Verify:
- Existing values load correctly into the form.
- Valid updates are saved.
- Invalid input is rejected.
- Duplicate event codes are handled correctly.
- Unauthorized updates are rejected.
- Existing attendance records remain intact.
- QR scanning and closed-event restrictions continue working.

## Scope Restrictions

Implement only the Edit Event Interface and its required database integration. Do not rebuild existing event creation or other screens.

Document any SQL migration required for venue, description, or other missing fields.

## Final Report

Summarize changed files, database changes, authorization rules, testing results, and any remaining setup requirements.

Inspect the existing code and implement the feature directly. Do not stop after producing a plan.

## Implementation Status

Implemented. Added shared `components/EventEditor.tsx`, UUID-based `app/event-edit.tsx`, teacher/admin Edit controls, title/code/date/time/venue/description/status fields, validation, loading and cancel behavior, the trusted `update_event()` RPC, and `event_code_aliases` so old QR codes remain usable after code changes.

Relevant migration: `supabase/migrations/20261013000001_add_editable_event_fields_and_update_rpc.sql`. `npx tsc --noEmit` and Expo web export passed; the migration must be applied before remote Supabase testing.
