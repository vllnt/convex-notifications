import aggregate from "@convex-dev/aggregate/convex.config";
import { defineComponent } from "convex/server";

const component = defineComponent("notifications");
component.use(aggregate);

export default component;
