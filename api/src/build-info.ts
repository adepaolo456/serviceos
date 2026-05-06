// arcY (2026-05-06): build-time SHA injection for /health endpoint.
// Vercel-build script overwrites this file's COMMIT_SHA value with the
// actual deploy SHA before `nest build` runs. The placeholder 'dev-local'
// is what local `nest start` returns. See api/package.json vercel-build
// script for the overwrite step.
//
// This is the single source of truth for the deployed commit SHA at runtime.
// Future surfaces (e.g., Sentry runtime release tagging — tracked at #121)
// should import from this module rather than reading process.env directly.

export const COMMIT_SHA = 'dev-local';
