/**
 * Jest setupFiles hook — runs BEFORE any test module loads.
 *
 * Sets test-only env vars that need to be in place before module-init
 * code captures them. The Sentry scrubber reads SENTRY_HASH_SALT at
 * module load (per Phase 1A spec — salt is read once, never re-read);
 * this hook ensures a deterministic test salt is in place before the
 * scrubber module loads.
 *
 * NEVER hardcode the production salt here. The string below is a
 * test-only deterministic value.
 */

if (!process.env.SENTRY_HASH_SALT) {
  process.env.SENTRY_HASH_SALT = 'test-salt-deterministic-not-prod';
}
