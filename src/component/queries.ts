import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import { notificationView } from "./validators";
import type { Doc } from "./_generated/dataModel";

/** Project a stored notification row to its public view (drops internal fields). */
function view(row: Doc<"notifications">) {
  return {
    notificationId: row.notificationId,
    subjectRef: row.subjectRef,
    type: row.type,
    payload: row.payload,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/** The current notification for `notificationId`, or `null` if none is held. */
export const get = query({
  args: { notificationId: v.string() },
  returns: v.union(v.null(), notificationView),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("notifications")
      .withIndex("by_notification_id", (q) => q.eq("notificationId", args.notificationId))
      .unique();
    return row === null ? null : view(row);
  },
});

/**
 * Page a subject's inbox, newest first. With `unreadOnly` set, only unread
 * notifications are returned via the `by_subject_read_created` index
 * (`read == false`); otherwise the whole inbox is paged via `by_subject_created`.
 * Takes the standard Convex `paginationOpts` and returns the standard paginated
 * envelope (`page`, `isDone`, `continueCursor`) so the host renders an inbox
 * reactively. A read for one subject never spans another subject's rows — the
 * index is subject-bounded.
 */
export const list = query({
  args: {
    subjectRef: v.string(),
    unreadOnly: v.boolean(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(notificationView),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal("SplitRecommended"),
        v.literal("SplitRequired"),
        v.null(),
      ),
    ),
  }),
  handler: async (ctx, args) => {
    const result = args.unreadOnly
      ? await ctx.db
          .query("notifications")
          .withIndex("by_subject_read_created", (q) =>
            q.eq("subjectRef", args.subjectRef).eq("read", false),
          )
          .order("desc")
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("notifications")
          .withIndex("by_subject_created", (q) =>
            q.eq("subjectRef", args.subjectRef),
          )
          .order("desc")
          .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(view) };
  },
});

/**
 * Count a subject's unread notifications via the `by_subject_read_created` index
 * (`read == false`). Subject-bounded — never counts another subject's rows. The
 * count walks the unread slice, so a host that expects very large unread inboxes
 * pairs this with `@convex-dev/aggregate`; for ordinary inboxes the index scan is
 * cheap.
 */
export const unreadCount = query({
  args: { subjectRef: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_subject_read_created", (q) =>
        q.eq("subjectRef", args.subjectRef).eq("read", false),
      )
      .collect();
    return unread.length;
  },
});
