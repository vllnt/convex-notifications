import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { jsonValue } from "./validators";

/**
 * Sandboxed table — one subject's directed inbox. A notification is addressed at
 * a host-opaque `subjectRef` (the recipient), tagged by `type`, and carries
 * opaque host `payload` (never inspected). `read` is a derived boolean stamped
 * at insert (`false`) and flipped on `markRead`; it backs the unread index and
 * count without a post-query `.filter()`. `readAt` records when it was read.
 *
 * Indexes:
 * - `by_notification_id` — direct lookup / markRead by the minted `notificationId`.
 * - `by_subject_created` — list a subject's whole inbox, newest first.
 * - `by_subject_read_created` — list unread (or read) for a subject, newest
 *   first, and count unread — the unread inbox is `read == false` on this index.
 * - `by_read_created` — global retention sweep: read rows past a `createdAt`
 *   cutoff, oldest first, across all subjects (the purge cron is not
 *   subject-bounded).
 */
export default defineSchema({
  notifications: defineTable({
    notificationId: v.string(),
    subjectRef: v.string(),
    type: v.string(),
    payload: v.optional(jsonValue),
    read: v.boolean(),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_notification_id", ["notificationId"])
    .index("by_subject_created", ["subjectRef", "createdAt"])
    .index("by_subject_read_created", ["subjectRef", "read", "createdAt"])
    .index("by_read_created", ["read", "createdAt"]),
});
