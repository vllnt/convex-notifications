import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { Notifications } from "../../src/client";

/**
 * Host-app wrappers. The host owns auth: resolve identity here, then pass opaque
 * `subjectRef`s, a `type` tag, and opaque `payload` into the client. Time is
 * server-sourced inside the component — there is no `now` override to pass.
 */
const inbox = new Notifications<{ actor: string } | string | number>(
  components.notifications,
);

/** A second client on the named `alerts` mount — proves mount-safe isolation. */
const alerts = new Notifications(components.alerts);

/**
 * A strict client that validates the payload against a host parser and caps
 * fan-out low — proves the `payloadValidator` boundary and the `maxFanOut` cap.
 */
const strictInbox = new Notifications<{ actor: string }>(
  components.notifications,
  {
    maxFanOut: 2,
    payloadValidator: (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as { actor?: unknown }).actor !== "string"
      ) {
        throw new Error("invalid payload: expected { actor: string }");
      }
      return value as { actor: string };
    },
  },
);

const notificationView = v.object({
  notificationId: v.string(),
  subjectRef: v.string(),
  type: v.string(),
  payload: v.optional(v.any()),
  readAt: v.optional(v.number()),
  createdAt: v.number(),
});

const paginated = v.object({
  page: v.array(notificationView),
  isDone: v.boolean(),
  continueCursor: v.string(),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(
    v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()),
  ),
});

export const deliver = mutation({
  args: {
    subjectRefs: v.array(v.string()),
    type: v.string(),
    payload: v.optional(v.any()),
  },
  returns: v.object({ notificationIds: v.array(v.string()) }),
  handler: (ctx, a) => inbox.deliver(ctx, a.subjectRefs, a.type, a.payload),
});

export const deliverOne = mutation({
  args: { subjectRef: v.string(), type: v.string(), payload: v.optional(v.any()) },
  returns: v.object({ notificationIds: v.array(v.string()) }),
  handler: (ctx, a) => inbox.deliver(ctx, a.subjectRef, a.type, a.payload),
});

export const markRead = mutation({
  args: { notificationId: v.string() },
  returns: v.null(),
  handler: (ctx, a) => inbox.markRead(ctx, a.notificationId),
});

export const markAllRead = mutation({
  args: { subjectRef: v.string(), batch: v.optional(v.number()) },
  returns: v.number(),
  handler: (ctx, a) => inbox.markAllRead(ctx, a.subjectRef, { batch: a.batch }),
});

export const get = query({
  args: { notificationId: v.string() },
  returns: v.union(v.null(), notificationView),
  handler: (ctx, a) => inbox.get(ctx, a.notificationId),
});

export const list = query({
  args: {
    subjectRef: v.string(),
    unreadOnly: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginated,
  handler: (ctx, a) =>
    inbox.list(ctx, a.subjectRef, a.paginationOpts, {
      unreadOnly: a.unreadOnly,
    }),
});

export const unreadCount = query({
  args: { subjectRef: v.string() },
  returns: v.number(),
  handler: (ctx, a) => inbox.unreadCount(ctx, a.subjectRef),
});

export const purge = mutation({
  args: { before: v.optional(v.number()), batch: v.optional(v.number()) },
  returns: v.number(),
  handler: (ctx, a) => inbox.purge(ctx, { before: a.before, batch: a.batch }),
});

/** Named-mount variants — prove a second instance is independent. */
export const deliverAlert = mutation({
  args: { subjectRef: v.string(), type: v.string() },
  returns: v.object({ notificationIds: v.array(v.string()) }),
  handler: (ctx, a) => alerts.deliver(ctx, a.subjectRef, a.type),
});

export const unreadCountAlert = query({
  args: { subjectRef: v.string() },
  returns: v.number(),
  handler: (ctx, a) => alerts.unreadCount(ctx, a.subjectRef),
});

export const purgeAlert = mutation({
  args: {},
  returns: v.number(),
  handler: (ctx) => alerts.purge(ctx),
});

/** Strict-client variants — exercise the payload validator and the fan-out cap. */
export const deliverStrict = mutation({
  args: { subjectRefs: v.array(v.string()), payload: v.any() },
  returns: v.object({ notificationIds: v.array(v.string()) }),
  handler: (ctx, a) => strictInbox.deliver(ctx, a.subjectRefs, "mention", a.payload),
});

export const getStrict = query({
  args: { notificationId: v.string() },
  returns: v.union(v.null(), notificationView),
  handler: (ctx, a) => strictInbox.get(ctx, a.notificationId),
});

/**
 * Host-side preference helper — writes the host's own `prefs` table, completely
 * outside the component's sandbox, proving host/component table isolation.
 */
export const setPref = mutation({
  args: { subjectRef: v.string(), channel: v.string() },
  returns: v.null(),
  handler: async (ctx, { subjectRef, channel }) => {
    await ctx.db.insert("prefs", { subjectRef, channel });
    return null;
  },
});

export const getPref = query({
  args: { subjectRef: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { subjectRef }) => {
    const row = await ctx.db
      .query("prefs")
      .withIndex("by_subject", (q) => q.eq("subjectRef", subjectRef))
      .unique();
    return row?.channel ?? null;
  },
});
