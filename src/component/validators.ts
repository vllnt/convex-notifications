import { v } from "convex/values";

/**
 * Opaque host-owned data carried on a notification — its `payload`. The
 * component never inspects it; it is last-resort arbitrary data, aliased here
 * rather than left bare in function signatures. The host narrows it at the
 * {@link Notifications} client boundary via an optional `payloadValidator`
 * parser.
 *
 * This is the single documented `v.any()` escape hatch in the component; the
 * lint rule `convex-rules/no-bare-v-any` is satisfied by routing every arbitrary
 * host payload through this alias instead of a bare `v.any()`.
 */
export const jsonValue = v.any();

/**
 * Public projection of a notification returned by {@link get} / {@link list}.
 * `payload` is opaque host data; `readAt` is the absolute ms timestamp the
 * notification was marked read, absent while unread.
 */
export const notificationView = v.object({
  notificationId: v.string(),
  subjectRef: v.string(),
  type: v.string(),
  payload: v.optional(jsonValue),
  readAt: v.optional(v.number()),
  createdAt: v.number(),
});
