/** Shared constants used by both `client/` and `component/`. */

export const COMPONENT_NAME = "notifications";

/**
 * Default retention (ms) for read notifications before the purge cron sweeps
 * them: 30 days. Bounds unbounded growth of a subject's inbox while leaving a
 * generous window to surface recently-read items. Unread notifications are
 * never removed by the retention sweep. A host can purge read rows sooner by
 * calling `purge` with a later `before` cutoff; the built-in cron still applies
 * this window every 24 hours, so read rows are deleted within about a day of
 * passing it.
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

/** Absolute write-amplification ceiling enforced even when a client overrides the default. */
export const MAX_FANOUT = 500;

/** Maximum rows mutated by one maintenance transaction. */
export const MAX_PURGE_BATCH = 500;
