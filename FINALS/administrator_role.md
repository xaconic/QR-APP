    # QR-ATT — Implement Administrator Role

    Act as a senior React Native and Supabase developer. Implement the Administrator role in my existing QR-ATT application.

    **Tech stack:** Expo SDK 54, React Native, TypeScript, Expo Router, Supabase.

    ## Objective

    Add a third user role, `admin`, alongside the existing `student` and `teacher` roles without breaking existing functionality.

    ## Instructions

    1. Inspect the existing authentication system, profile schema, navigation, role checks, and Supabase RLS policies before making changes.
    2. Update the existing role system to support `admin`.
    3. Create a dedicated Administrator dashboard using the existing dark theme and UI components.
    4. Allow authorized administrators to view registered users, events, and attendance summaries using existing database services where possible.
    5. Add appropriate navigation and protect administrator screens.
    6. Keep student and teacher permissions and workflows functional.
    7. Update Supabase schema constraints and RLS policies as needed.
    8. Prevent public registration from assigning the `admin` role.
    9. Prevent users from promoting themselves by editing their profile or sending direct database requests.
    10. Use a trusted administrative process to assign the first administrator. Document the setup procedure without exposing credentials.
    11. Avoid duplicate service files, unnecessary dependencies, and unrelated refactoring.

    ## Security Requirements

    - Never trust a role supplied by the client as proof of authorization.
    - Enforce administrator permissions through Supabase RLS or trusted server-side logic.
    - Ensure administrators can access only the operations explicitly authorized for their role.
    - Do not weaken existing database security policies.

    ## Testing

    Verify, where possible:
    - Administrators can access the dashboard.
    - Students and teachers cannot access admin-only operations.
    - Public registration cannot create administrator accounts.
    - Users cannot modify their own role to become administrators.
    - Existing login, registration, and logout continue working.

    ## Scope Restrictions

    Implement only the Administrator role and its initial dashboard. Do not implement the Administrator Profile, Event Status, or Edit Event Interface yet.

    Preserve existing working features. Do not claim tests passed unless they were actually executed.

    ## Final Report

    Summarize the files changed, database migrations required, administrator setup instructions, security changes, tests performed, and anything that remains unverified.

    Start by inspecting the project, then implement the feature. Do not stop after producing a plan.

## Implementation Status

Implemented in the current QR-ATT application.

- Added the `admin` role and protected Administrator navigation.
- Added the Administrator dashboard with users, events, attendance summaries, search, profile-name editing, and reversible user deactivation.
- Added database-side RPC authorization and last-active-administrator protection.
- Public registration still supports only Student and Teacher.

Relevant files include `app/(tabs)/admin.tsx`, `app/(tabs)/_layout.tsx`, `lib/admin.ts`, `lib/profiles.ts`, `supabase/schema.sql`, and `supabase/migrations/20261013000002_add_admin_management_rpc.sql`.

`npx tsc --noEmit` and the Expo web export passed. Supabase migrations must be applied to the target project before remote administrator operations work.
