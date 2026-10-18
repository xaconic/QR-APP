# QR-ATT Administrator Profile Plan

## Scope

Plan the Administrator Profile only. The existing Administrator role is assumed to be deployed. This plan does not implement Event Status, Edit Event, administrator role management, or unrelated refactoring.

## Current-state inspection

- `app/(tabs)/profile.tsx` is the shared profile screen for all roles. It loads the signed-in user’s profile with `useFocusEffect`, displays name/email/user ID, supports inline display-name editing, and signs out through the existing auth flow.
- The screen already renders an Administrator badge when `profile.role === 'admin'`.
- `lib/profiles.ts` is the active profile service. `Role` already includes `student | teacher | admin`; `updateProfile()` currently accepts only `{ full_name?: string }`, which is the correct boundary for preventing role edits from the client.
- `lib/profile.ts` is a duplicate/orphan profile service. Do not add Administrator Profile logic there or create another profile service.
- `lib/auth.ts` exposes the current Supabase session/user through `useAuth()` and is already used by the profile screen.
- Supabase RLS currently allows a user to select their own profile and update their own profile, while the Administrator migration adds administrator-wide read access and blocks non-admin assignment of the `admin` role. The Administrator Profile should continue using the owner-only update path and must not broaden it.
- The shared screen uses `COLORS`, existing inline-edit styles, `Pressable`, `Alert`, and `AppButton`; those patterns should be retained.

## Planned changes

### 1. Profile screen behavior

- Keep the existing shared `ProfileScreen`; do not create a separate administrator route or duplicate screen.
- Confirm that an administrator sees:
  - editable full name;
  - email address from the authenticated Supabase user/profile;
  - `Administrator` role badge;
  - immutable user ID.
- Preserve the existing Student and Teacher rendering and editing behavior.
- Keep role and user ID as display-only values. No input, state update, or service call should accept role, email, ID, or privilege fields as editable profile data.

### 2. Loading, success, and error feedback

- Preserve the existing profile-loading lifecycle and add an explicit loading state for profile retrieval if needed, without changing the navigation flow.
- While saving, disable the Save control and show its existing `Saving...` state.
- On a successful display-name update, show a lightweight success message/alert, update the local profile state, and exit edit mode.
- On failure, retain the existing error alert and leave edit mode active so the user can retry.
- Guard against updating state after an unmounted screen if the profile request or save request completes late.

### 3. Profile service boundary

- Reuse `lib/profiles.ts` and keep `updateProfile()` limited to `full_name`.
- Continue scoping updates by the authenticated user’s ID, while treating RLS—not a client-side role check—as the authorization boundary.
- Do not add an `admin` parameter, role update helper, service-role key, or administrator-only client privilege.

### 4. Supabase RLS review

- Verify the deployed policies match the Administrator migration:
  - users can select their own profile;
  - administrators can read profiles required by the existing admin dashboard;
  - users can update only their own permitted profile data;
  - non-admin users cannot set their role to `admin` through direct database requests;
  - no policy grants users permission to update role, ID, email, or other privileged fields.
- If the deployed database differs, add only the minimal migration needed to enforce the above. Do not weaken existing policies or expose all profiles to ordinary users.
- Confirm the profile update request changes only `full_name`; database-level protection must remain effective even if a modified client sends extra columns.

## Expected files

- `app/(tabs)/profile.tsx` — only if feedback, lifecycle guards, or administrator display behavior needs adjustment.
- `lib/profiles.ts` — only if the existing full-name update contract needs a narrowly scoped improvement; do not create another profile service.
- `supabase/migrations/<timestamp>_administrator_profile.sql` — only if deployed RLS needs a corrective migration.
- `FINALS/administrator_profile_plan.md` — this plan.

## Verification plan

Run only after implementation:

1. Run `npx tsc --noEmit`.
2. Build/export the Expo app and confirm the profile route bundles.
3. As an administrator, load Profile, verify the Administrator badge, edit the name, save it, and confirm success feedback and persistence after revisiting the screen.
4. As a student and teacher, verify their existing profile badge, name editing, email, user ID, and sign-out behavior remain unchanged.
5. Attempt direct profile updates containing `role`, `email`, `id`, or another privileged field as a normal authenticated user; verify RLS rejects unauthorized changes and the role remains unchanged.
6. Attempt to read another user’s profile as a student/teacher; verify RLS rejects or returns no unauthorized row.
7. Record any Supabase integration or device/emulator checks that cannot be run locally as unverified.

## Limitations and non-goals

- No administrator profile-management screen for other users.
- No role assignment or role removal UI.
- No Event Status or Edit Event Interface.
- No changes to authentication, student/teacher navigation, or unrelated services.

## Implementation Status

Implemented through the shared profile screen and profile service. Administrator badges and permitted display-name updates are supported while role and privileged fields remain protected. See `administrator_profile.md` for details.
