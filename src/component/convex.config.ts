import aggregate from "@convex-dev/aggregate/convex.config";
import { defineComponent } from "convex/server";

/**
 * Component definition (it nests `@convex-dev/aggregate` for unread counts).
 * Mount it with `app.use(config)` in `convex/convex.config.ts`.
 */
const component = defineComponent("notifications");
component.use(aggregate);

export default component;
