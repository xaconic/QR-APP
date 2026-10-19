# Acadence — Smart Attendance System

> **Target:** First-year students | **Expo SDK:** 54 | **Expo Go:** 54.0.8

---

## PREREQUISITES

| Tool | Download | Verify |
|---|---|---|
| Node.js (LTS) | https://nodejs.org/en | `node --version` |
| VS Code | https://code.visualstudio.com | (open it) |
| Expo Go 54.0.8 | Play Store → "Expo Go" | (version in app settings) |

---

## STEP 1 — Create the App

```powershell
cd D:\Acadence
npx create-expo-app@latest acadence

# When prompted, select "SDK 54"
# Wait for npm install (~2 min)
```

---

## STEP 2 — Install Matching Versions

The default install may need these fixed versions that match Expo Go 54.0.8:

```powershell
npm install expo@~54.0.35 react@19.1.0 react-native@0.81.5 expo-router@~6.0.24 @expo/vector-icons@^15.0.3 expo-linking@~8.0.12 expo-constants@~18.0.13 expo-font@~14.0.12 expo-status-bar@~3.0.9 expo-splash-screen@~31.0.13 react-native-screens@~4.16.0 react-native-safe-area-context@~5.6.0 react-native-gesture-handler@~2.28.0 react-native-reanimated@~4.1.1 react-dom@19.1.0 react-native-web@~0.21.0 @types/react@~19.1.0 typescript@~5.9.2 --legacy-peer-deps
```

---

## STEP 3 — Start

```powershell
npx expo start
```

Scan QR code with Expo Go. Or press `W` for web.

## Supabase database setup

`supabase/schema.sql` is the bootstrap schema, not the final security state by
itself. On a **disposable, empty development project**, apply that file once,
then apply every file in `supabase/migrations/` in ascending filename order.
Do not expose the app to users between those steps: later migrations establish
the scoped RLS policies, role controls, and RPC authorization. Existing
installations should use the unapplied migrations only; back up the database
and review the migration SQL before applying it. Never run a reset or
destructive test against production.

Migration `20261047000000_schedule_ended_event_attendance_finalization.sql`
requires the `pg_cron` extension to be available and enabled in the Supabase
project. Verify that the `finalize-ended-event-attendance` job exists and runs
after deployment. Event timestamps are stored as `timestamptz`; event inputs
should use the `Asia/Manila` local time when entered by campus users, while
database comparisons use absolute instants. Attendance CSV dates are formatted
for the Philippines.

Migration `20261052000000_enable_rotating_attendance_qr.sql` changes event
check-in to server-issued QR tokens that refresh every 15 seconds and expire
after 30 seconds. Coordinate its deployment with the matching app version:
after the migration, older clients that submit permanent event codes can no
longer check in. Static event-code QR images are rejected. Rotating codes
deter old screenshots but cannot fully prevent live forwarding.

Migration `20261053000000_add_event_context_to_student_attendance_history.sql`
extends the authenticated student-history RPC with the event's scheduled time,
stable event ID, and explicit attendance-finalization state. The student
dashboard uses only finalized outcomes for attendance rates; active check-ins
remain visible in history but are not treated as finalized absences. A
successful in-app check-in notifies the mounted history screen to reload its
student-scoped records and refresh the dashboard immediately.

Migration `20261058000000_enable_app_data_realtime.sql` adds the app's
user-facing event, attendance, profile, eligibility, and academic catalog
tables to Supabase Realtime. The app treats these notifications as cache
invalidations and reloads authoritative records through its existing
authorized queries. Apply this migration to each Supabase project for live
cross-device updates; focused screens also reload on open and reconnect.

Migration `20261059000000_align_attendance_export_with_roster.sql` limits
administrator and teacher attendance exports to active students in the event's
current eligible roster. The attendance manager also derives its matching
record count from the roster summary it already loaded, avoiding a second
network request for the count.

Migration `20261060000000_allow_own_profile_name_update_rpc.sql` lets an
authenticated user, including an administrator, update only their own profile
name through a narrowly scoped database function. Apply it to each Supabase
project before using the matching app version.

Migration `20261061000000_add_teacher_signup_requests.sql` adds Student and
Teacher choices during registration. Teacher applicants remain student-role
accounts until an administrator approves their pending request in Registered
Users. Apply it before deploying the matching app version.

Migration `20261062000000_include_late_time_in_student_history.sql` includes
the event's late cutoff in student attendance history, so students can see
when check-ins begin counting as late. Apply it before deploying the matching
app version.

Permanent user deletion from the administrator dashboard requires
`20261050000000_add_admin_user_deletion.sql` to be applied to the Supabase
project. It uses an admin-authorized database function and cannot delete the
currently signed-in administrator or the last active administrator.

The project’s complete database state is the bootstrap schema plus all
migrations. Keep the schema bootstrap and migration chain under review together
when changing policies or RPCs.

---

## TROUBLESHOOTING

| Problem | Solution |
|---|---|
| npm install fails | Use `npm install --legacy-peer-deps` |
| App crashes in Expo Go | Make sure all versions match STEP 2 exactly |
| QR won't scan | Phone + computer on same WiFi |
| White screen | Wait 10s, or shake → Reload |
| TypeScript errors | Run `npx tsc --noEmit` |
| Type check | Run `npm run typecheck` |
| Unit tests | Run `npm test` (Node.js with TypeScript type stripping support, such as Node 24) |
