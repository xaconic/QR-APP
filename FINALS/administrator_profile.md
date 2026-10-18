# QR-ATT — Implement Administrator Profile

Implement the Administrator Profile in my existing QR-ATT application.

**Prerequisite:** The Administrator role has already been implemented.

## Objective

Extend the existing profile system to support administrators while preserving student and teacher profiles.

## Requirements

1. Inspect the current profile screen, profile service, authentication state, and database schema.
2. Display the administrator's full name, email address, Administrator role badge, and user ID.
3. Allow administrators to edit their display name.
4. Reuse the existing profile screen patterns, shared components, centralized color constants, and dark theme.
5. Save profile changes to Supabase and show loading, success, and error feedback.
6. Prevent profile editing from changing a user's role or administrator privileges.
7. Enforce profile access and update permissions through appropriate RLS policies.
8. Preserve existing student and teacher profile functionality.
9. Reuse the existing profile service instead of creating duplicate profile files.
10. Follow the current Expo Router structure and TypeScript conventions.

## Testing

Verify that:
- Administrators can view and update their display names.
- The correct role badge is displayed.
- Students and teachers retain their existing profile behavior.
- Profile updates cannot modify roles or privileged fields.
- Unauthorized profile access is rejected.

## Scope Restrictions

Implement only the Administrator Profile. Do not implement Event Status or the Edit Event Interface.

Do not redesign unrelated screens or refactor unrelated files.

## Final Report

List changed files, any database changes, tests actually performed, and remaining limitations.

Inspect the existing code and implement the feature directly.

## Implementation Status

Administrator profiles use the shared profile screen and profile service. The administrator role badge, email, user ID, and display-name editing follow the existing dark-theme profile patterns. Role and privileged fields remain protected by database trigger/RLS rules. Active/deactivated account tracking is included in `supabase/migrations/20261013000002_add_admin_management_rpc.sql`.

`npx tsc --noEmit` passed. Remote Supabase behavior depends on applying the migrations.
