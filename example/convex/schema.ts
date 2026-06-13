import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The example host app's own table. It is host-side state living entirely
 * outside the component's sandboxed `notifications` table — used to prove the
 * component never reaches into host tables (and the host never into the
 * component's, except through the exported client). Here it models a host-owned
 * per-subject channel preference, which the spec keeps in the host layer.
 */
export default defineSchema({
  prefs: defineTable({
    subjectRef: v.string(),
    channel: v.string(),
  }).index("by_subject", ["subjectRef"]),
});
