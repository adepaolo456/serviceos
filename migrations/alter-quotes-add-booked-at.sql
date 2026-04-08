-- Add booked_at timestamp for tracking when a quote was atomically
-- converted into a booking via public.service.ts:createBooking.
--
-- Additive, idempotent, safe for all tenants. Existing rows (including
-- historical 'converted' quotes from before this migration) will have
-- booked_at = NULL. The hosted quote page renders the "Booked on [date]"
-- line conditionally, so historical converted quotes will show the
-- "Booking confirmed" banner without a date line — graceful degradation,
-- no data backfill required.
--
-- Run this manually in the Supabase SQL editor BEFORE deploying the API
-- code that references the column (production uses synchronize: false).

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ NULL;
