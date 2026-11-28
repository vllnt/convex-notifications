/// <reference types="vite/client" />
import aggregateTest from "@convex-dev/aggregate/test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Mounts the component (and its `aggregate` child) in a host app's
 * `convex-test` instance under `name` (default `"notifications"`, the name used
 * by `app.use(config)`): `import { register } from "@vllnt/convex-notifications/test"`.
 * Accepts `convexTest(hostSchema, modules)` for any host schema. Needs Vite's
 * `import.meta.glob`, so run it under Vitest.
 */
export function register<TSchema extends GenericSchema>(
  t: TestConvex<SchemaDefinition<TSchema, boolean>>,
  name = "notifications",
): void {
  t.registerComponent(name, schema, modules);
  t.registerComponent(`${name}/aggregate`, aggregateTest.schema, aggregateTest.modules);
}
