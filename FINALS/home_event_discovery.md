# QR-ATT — Implement Home Event Discovery

## Objective

Allow authenticated users to browse real school events from the Home tab without bypassing existing role and attendance rules.

## Implemented Features

- Loads active events from Supabase through `getDiscoveryEvents()`.
- Displays title, event code, date/time, venue, description, and Open/Closed status.
- Supports title/code search.
- Supports All Events, Open, Closed, and student My Attendance filters.
- Shows event details in a modal.
- Students can open the existing scanner for eligible open events.
- Teachers can manage their own events.
- Administrators can manage events according to existing authorization.
- Uses `FlatList`, loading states, empty states, pull-to-refresh, and the existing dark theme.

## Files

- `app/(tabs)/index.tsx`
- `lib/events.ts`
- `components/EventQRCode.tsx`

## Security

Event reads continue through Supabase authenticated access. Management actions still use the existing event authorization rules and trusted update RPC. Attendance is not recorded from event browsing.

## Verification

`npx tsc --noEmit` and `npx expo export --platform web` passed. Live event loading depends on the configured Supabase project and applied migrations.
