import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import { mutation } from "./_generated/server";
import { jsonValue } from "./validators";

/**
 * Deliver one notification to each of `subjectRefs` — the directed-inbox
 * fan-out. Every recipient gets its own freshly-minted `notificationId`
 * (component-generated via `crypto.randomUUID()`; the host names the recipient,
 * not the row) inserted unread (`read: false`) with `createdAt` stamped from the
 * server clock (`Date.now()` inside the handler — never caller-supplied). The
 * host owns the meaning of `type` and the opaque `payload`.
 *
 * `subjectRefs` must be non-empty and within `maxFanOut`; an empty list throws
 * `ConvexError({ code: "EMPTY_FANOUT" })` and an over-cap list throws
 * `ConvexError({ code: "FANOUT_TOO_LARGE" })` so a runaway fan-out can never
 * silently amplify one mutation past the transaction write budget.
 *
 * @returns the minted `notificationId`s, one per recipient, in `subjectRefs`
 *   order.
 */
export const deliver = mutation({
  args: {
    subjectRefs: v.array(v.string()),
    type: v.string(),
    payload: v.optional(jsonValue),
    maxFanOut: v.number(),
  },
  returns: v.object({ notificationIds: v.array(v.string()) }),
  handler: async (ctx, args) => {
    if (args.subjectRefs.length === 0) {
      throw new ConvexError({
        code: "EMPTY_FANOUT",
        message: "deliver requires at least one subjectRef",
      });
    }
    if (args.subjectRefs.length > args.maxFanOut) {
      throw new ConvexError({
        code: "FANOUT_TOO_LARGE",
        message: `deliver fan-out of ${args.subjectRefs.length} exceeds maxFanOut ${args.maxFanOut}`,
      });
    }

    const now = Date.now();
    const notificationIds: string[] = [];
    for (const subjectRef of args.subjectRefs) {
      const notificationId = crypto.randomUUID();
      await ctx.db.insert("notifications", {
        notificationId,
        subjectRef,
        type: args.type,
        payload: args.payload,
        read: false,
        createdAt: now,
      });
      notificationIds.push(notificationId);
    }
    return { notificationIds };
  },
});

/**
 * Mark one notification read, stamping `readAt` from the server clock. Marking
 * an already-read notification is a no-op (idempotent) so a double-tap or a
 * replayed client call never churns the timestamp.
 *
 * @throws `ConvexError({ code: "NOT_FOUND" })` when no notification has
 *   `notificationId`.
 */
export const markRead = mutation({
  args: { notificationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("notifications")
      .withIndex("by_notification_id", (q) => q.eq("notificationId", args.notificationId))
      .unique();
    if (row === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: `notification "${args.notificationId}" not found`,
      });
    }
    if (row.read) {
      return null;
    }
    await ctx.db.patch(row._id, { read: true, readAt: Date.now() });
    return null;
  },
});

/**
 * Mark every unread notification for `subjectRef` read in bounded batches,
 * oldest first via the `by_subject_read_created` index (the unread slice is
 * `read == false`). Stamps each `readAt` from one server-clock read so a single
 * mark-all pass shares a timestamp. If a full batch was marked there may be more,
 * so the pass self-reschedules through `ctx.scheduler` until the unread tail is
 * clean. Idempotent — an already-empty unread inbox marks nothing.
 *
 * @returns the count marked in this pass.
 */
export const markAllRead = mutation({
  args: { subjectRef: v.string(), batch: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_subject_read_created", (q) =>
        q.eq("subjectRef", args.subjectRef).eq("read", false),
      )
      .take(args.batch);

    for (const row of unread) {
      await ctx.db.patch(row._id, { read: true, readAt: now });
    }

    if (unread.length === args.batch) {
      await ctx.scheduler.runAfter(0, api.mutations.markAllRead, {
        subjectRef: args.subjectRef,
        batch: args.batch,
      });
    }
    return unread.length;
  },
});

/**
 * Delete up to `batch` **read** notifications whose `createdAt < before`, oldest
 * first across all subjects via the `by_read_created` index. `before` defaults
 * to the server clock when omitted. Unread notifications are never purged. If a
 * full batch was removed there may be more, so the sweep self-reschedules through
 * `ctx.scheduler` until the read tail is clean. Idempotent — only ever removes
 * already-read, past-retention rows. The built-in daily cron drives this
 * automatically.
 */
export const purge = mutation({
  args: { before: v.optional(v.number()), batch: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const before = args.before ?? Date.now();

    const stale = await ctx.db
      .query("notifications")
      .withIndex("by_read_created", (q) =>
        q.eq("read", true).lt("createdAt", before),
      )
      .take(args.batch);

    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    const removed = stale.length;

    if (removed === args.batch) {
      await ctx.scheduler.runAfter(0, api.mutations.purge, {
        before,
        batch: args.batch,
      });
    }
    return removed;
  },
});
