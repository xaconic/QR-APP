QR-ATT — Selected Feature Improvements
1. Administrator Role
Add a third user role, admin, alongside the existing student and teacher roles.
Requirements:
- Allow administrators to log in using the existing authentication system.
- Give administrators access to a dedicated admin dashboard.
- Allow administrators to view and manage users, events, and attendance records.
- Restrict administrator features to authorized admin accounts.
- Update Supabase RLS policies to enforce administrator permissions securely.
- Do not allow users to register themselves as administrators.

2. Administrator Profile
Implement an administrator profile using the existing profile system.
Requirements:
- Display the administrator's full name, email, role, and user ID.
- Allow administrators to edit their display name.
- Display an Administrator role badge.
- Reuse the existing profile components, authentication, and dark theme.
- Ensure administrators cannot change their own role through profile editing.

3. Event Status
Add a status field to events so teachers and administrators can control attendance availability.
Requirements:
- Support at least two statuses: Open and Closed.
- Set newly created events to Open by default.
- Allow authorized teachers and administrators to close events.
- Display the current status on event cards and event details.
- Prevent students from recording attendance for closed events.
- Enforce the closed-event restriction through secure database logic, not only frontend checks.
- Handle existing database records safely when introducing the status field.

4. Edit Event Interface
Create an interface for teachers and administrators to edit existing events.
Requirements:
- Provide an Edit button for authorized users.
- Allow editing the event title, event code, date, start time, end time, venue, description, and status where applicable.
- Prepopulate the form with the event's existing values.
- Validate required fields, event codes, and date/time combinations.
- Save changes to Supabase and display loading, success, and error feedback.
- Prevent unauthorized users from editing events they do not manage.
- Ensure changes do not unintentionally invalidate existing attendance records or QR codes.
- Reuse the existing UI components, color palette, navigation, and coding conventions.
Implementation Guidelines
- Inspect the existing project before making changes.
- Preserve existing login, registration, QR scanning, attendance history, and other working features.
- Update the database schema and RLS policies where necessary.
- Use the existing Supabase integration and TypeScript types.
- Keep the implementation compatible with Expo SDK 54 and the existing Expo Router structure.
- Avoid duplicating profile services or introducing unnecessary dependencies.
- Test role permissions, event editing, status changes, and attendance rejection for closed events.
- Document any required Supabase SQL migrations and setup steps.
Completion Criteria
The improvements are complete when:
1. An authorized administrator can access the admin dashboard and profile.
2. Administrator permissions are enforced at the database level.
3. Teachers and administrators can manage event status and edit authorized events.
4. Students cannot record attendance for closed events.
5. Existing attendance records and core application features continue to work.

## Additional Features Implemented

1. **Home Event Discovery** — real event browsing, search, status filters, attendance filter, event details, pull-to-refresh, and role-aware actions.
2. **QR Image Upload** — gallery selection and QR decoding through the existing Expo Camera decoder, followed by the existing attendance workflow.
3. **QR Download and Sharing** — authorized QR displays can generate PNG files, share them natively, and save them directly in a native development/standalone build.

Separate documentation is provided in `home_event_discovery.md`, `qr_image_upload.md`, and `qr_download_sharing.md`.
