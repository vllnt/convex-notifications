import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

/**
 * Default sweep cadence and page size for the built-in purge cron. The cron is
 * the component's own self-healing safety net — a host that wants a different
 * cadence drives `purge` from its own scheduler instead (the client exposes it).
 * Convex cron definitions are static per deployment, so cadence is a documented
 * module constant rather than a mount-time option; the page size bounds each
 * sweep and `purge` self-reschedules until the read tail is clean.
 */
export const PURGE_INTERVAL = { hours: 24 } as const;

/** Rows deleted per `purge` pass before the sweep self-reschedules. */
export const PURGE_BATCH = 200;

const crons = cronJobs();

crons.interval("notifications:purge", PURGE_INTERVAL, api.mutations.purge, {
  batch: PURGE_BATCH,
});

export default crons;
