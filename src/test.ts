import type { TestConvex } from "convex-test";
import schema from "./component/schema";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register this component with a `convex-test` instance so consuming apps can
 * test integration: `import { register } from "@vllnt/convex-notifications/test"`.
 */
export function register(
  t: TestConvex<typeof schema>,
  name = "notifications",
): void {
  t.registerComponent(name, schema, modules);
}
