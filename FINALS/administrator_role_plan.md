# Administrator Role Implementation Plan

## Scope

Add the `admin` role and an initial read-only Administrator dashboard to the Expo Router/Supabase QR-ATT app. The dashboard will show registered-user counts/list data, events, and attendance summaries. Administrator Profile, Event Status, and Edit Event UI are explicitly out of scope.

## Current-state findings

- Authentication is email/password Supabase Auth in `lib/auth.ts`; the app redirects authenticated users to `app/(tabs)`.
- Registration exposes only `student` and `teacher` in `app/register.tsx`, but the client currently updates `profiles.role` after sign-up.
- The canonical profile service used by screens is `lib/profiles.ts`; `lib/profile.ts` is an identical orphan and should not be duplicated or expanded.
- `Role` is currently `student | teacher` in both profile service copies. Teacher access is checked inside `app/(tabs)/teacher.tsx`; the Teacher tab is currently declared for every user.
- The database schema is a single `supabase/schema.sql` file. `profiles.role` has a two-value check constraint. Existing profile self-update RLS allows a user to submit any role value accepted by the constraint, so it must be tightened before adding `admin`.
- Events are readable by authenticated users, and attendance is readable by the student or by the teacher who owns the event. The current event insert policy checks ownership but not teacher role.
- Existing dark-theme primitives are `COLORS`, `Header`, and `AppButton`; the new dashboard should reuse them.

## Planned implementation

1. **Role model and registration**
   - Extend the canonical `Role` type and all role unions to include `admin`.
   - Keep the public registration selector limited to Student and Teacher; do not add an Administrator option.
   - Ensure sign-up accepts only `student | teacher` profile metadata and never sends `admin` from the public form.
   - Remove the client-facing ability to request `admin` through profile update types.

2. **Supabase migration and RLS**
   - Add a migration file under `supabase/migrations/` rather than relying only on edits to the bootstrap schema. Update the bootstrap `supabase/schema.sql` consistently for fresh environments.
   - Expand the role check constraint to `student`, `teacher`, and `admin`, preserving the default of `student`.
   - Add a narrowly scoped `public.is_admin()` `SECURITY DEFINER` helper with a fixed `search_path` for RLS checks, avoiding client-trusted role claims.
   - Allow administrators to select profiles, events, and attendance needed by the dashboard.
   - Restrict profile self-updates so a non-admin cannot set their row to `admin`; keep display-name updates and existing student/teacher registration behavior working.
   - Restrict event insertion to profiles whose database role is `teacher` (preserving teacher event creation and preventing student direct inserts). Do not grant administrators event mutation permission in this initial scope.
   - Keep existing student-owned attendance and teacher-owned-event attendance permissions; add only the administrator read path.
   - Include idempotent policy/constraint replacement and document that the migration must be applied before testing the dashboard.

3. **Trusted first-admin setup**
   - Document a one-time Supabase Dashboard SQL Editor/service-role procedure: create or identify the account through the normal Auth flow, then set that user’s profile role to `admin` using a trusted operator context.
   - Do not put an email, password, service-role key, or other credential in source control or documentation.
   - State that the SQL Editor/service-role operation is the trusted assignment boundary; the mobile client and anon/authenticated API must not be used to bootstrap the first administrator.

   Example procedure after applying the migration (replace the placeholder with the intended account’s UUID; do not commit the UUID or credentials):

   ```sql
   update public.profiles
   set role = 'admin', updated_at = now()
   where id = '<trusted-auth-user-uuid>';
   ```

   Verify the target UUID in Supabase Auth before running the statement, then sign in through the normal app flow. Keep this SQL in the operator’s secure environment and use the Supabase SQL Editor or another trusted server-side connection, never the mobile client.

4. **Admin data services**
   - Extend `lib/profiles.ts` with an administrator-only data shape/query for registered users, relying on RLS for authorization rather than trusting a caller-supplied role.
   - Add narrowly scoped read helpers for all events and attendance summary data, reusing existing event/attendance types where practical and avoiding duplicate service modules.
   - Return safe empty/error states to the UI and avoid exposing credentials or service-role access in the app.

5. **Navigation and dashboard**
   - Add `app/(tabs)/admin.tsx` with a protected role check that loads the signed-in user’s profile from Supabase before rendering data.
   - Add a conditional Administrator tab/link using the existing dark navigation styling. Non-admin users may not render or use the admin content; direct route attempts must show an unauthorized state and no privileged query can succeed because of RLS.
   - Build the initial dashboard from existing components/styles: summary cards for user/event/attendance totals and read-only sections for registered users, events, and attendance summaries.
   - Keep student home, scan, history, profile, and teacher event workflows unchanged except for necessary role-aware type/gate updates.

6. **Verification**
   - Run TypeScript/Expo checks available in the repository and inspect the generated route/type behavior.
   - Test the migration/RLS with an admin, student, and teacher session where Supabase credentials/environment permit: admin reads succeed; student/teacher admin reads fail; profile self-promotion fails; student event insertion fails; teacher event insertion still succeeds.
   - Exercise login, registration for both public roles, logout, teacher event creation, student scanning/history, and unauthorized admin route access.
   - Report any checks that cannot run locally as unverified rather than claiming success.

## Expected files

- `administrator_role_plan.md` — this plan and implementation notes.
- `supabase/migrations/<timestamp>_add_admin_role.sql` — deployable role/RLS changes.
- `supabase/schema.sql` — matching fresh-install schema/policies.
- `lib/auth.ts`, `lib/profiles.ts`, and role-aware existing screens — role typing and safe registration/update boundaries.
- `lib/admin.ts` or narrowly scoped additions to existing services — administrator read queries only, with no duplicate generic services.
- `app/(tabs)/admin.tsx` and `app/(tabs)/_layout.tsx` — protected dashboard and navigation.

## Non-goals

No Administrator Profile, Event Status workflow, Edit Event interface, credential management, bulk user role-management UI, unrelated dependency cleanup, or broad refactoring.

## Implementation Status

Implemented. The Administrator dashboard, protected navigation, user management, event management, attendance summaries, and database-side authorization are now in place. See `administrator_role.md` for the implementation summary and verification notes.
