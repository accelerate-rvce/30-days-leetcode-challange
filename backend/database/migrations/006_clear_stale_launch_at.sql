-- Migration 005 originally seeded a fixed launch timestamp that is now in the
-- past, leaving the countdown stuck on "launch window is open". Clear only the
-- exact seeded value so an admin-configured launch date is never overwritten.
delete from site_settings
where key = 'launch_at'
  and value = '"2026-10-18T12:30:00+00:00"'::jsonb;
