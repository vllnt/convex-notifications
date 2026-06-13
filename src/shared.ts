/** Shared constants used by both `client/` and `component/`. */

export const COMPONENT_NAME = "notifications";

/**
 * Default retention (ms) for read notifications before the purge cron sweeps
 * them: 30 days. Bounds unbounded growth of a subject's inbox while leaving a
 * generous window to surface recently-read items. Unread notifications are
 * never removed by the retention sweep. A host that wants a different window
 * drives `purge` from its own scheduler with an explicit `before` cutoff.
 */
export const DEFAULT_RETENTION_MS = 2_592_000_000;

/** Default page size for a `purge` pass before the sweep self-reschedules. */
export const DEFAULT_PURGE_BATCH = 200;

/**
 * Default hard cap on how many `subjectRef`s a single `deliver` fan-out may
 * target. Bounds the write amplification of one mutation (Convex caps writes
 * per transaction); a host fanning out wider batches its own calls. Override
 * per-client with `maxFanOut`.
 */
export const DEFAULT_MAX_FANOUT = 256;
