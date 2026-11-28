// Packs the package, installs the tarball in a throwaway consumer on the lowest
// supported peer (convex 1.45.0), and proves what a host app relies on: the
// shipped docs, runtime imports, a type check of every entry point, and a
// host-schema convex-test run through `register(t)`. Run after `pnpm build`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = process.cwd();
const { name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "notifications-consumer-"));

const run = (command, args, cwd = temporary) => {
  execFileSync(command, args, { cwd, stdio: "inherit" });
};
const write = (path, content) => {
  const file = join(temporary, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content.trimStart());
};
const tsc = (...args) => {
  run("pnpm", ["exec", "tsc", "--noEmit", "--strict", "--target", "ES2022", ...args]);
};

// A host app: its own table, functions that call the component through the
// client, and a convex-test run that mounts the component with `register(t)`.
// `_generated/api.ts` stands in for Convex codegen, which needs a deployment.
const host = {
  "convex/schema.ts": `
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  prefs: defineTable({ subjectRef: v.string(), channel: v.string() }),
});
`,
  "convex/_generated/api.ts": `
import type { ComponentApi } from "${name}/_generated/component";
import { anyApi, componentsGeneric, type ApiFromModules, type FilterApi, type FunctionReference } from "convex/server";
import type * as inbox from "../inbox.js";

type FullApi = ApiFromModules<{ inbox: typeof inbox }>;
export const api = anyApi as unknown as FilterApi<FullApi, FunctionReference<"query" | "mutation", "public">>;
export const components = componentsGeneric() as unknown as { notifications: ComponentApi<"notifications"> };
`,
  "convex/inbox.ts": `
import { Notifications } from "${name}";
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api.js";

const inbox = new Notifications(components.notifications);

export const deliver = mutationGeneric({
  args: { subjectRef: v.string() },
  returns: v.object({ notificationIds: v.array(v.string()) }),
  handler: (ctx, { subjectRef }) => inbox.deliver(ctx, subjectRef, "mention", { actor: "u9" }),
});

export const unreadCount = queryGeneric({
  args: { subjectRef: v.string() },
  returns: v.number(),
  handler: (ctx, { subjectRef }) => inbox.unreadCount(ctx, subjectRef),
});

export const types = queryGeneric({
  args: { subjectRef: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, { subjectRef }) => {
    const { page } = await inbox.list(ctx, subjectRef, { cursor: null, numItems: 10 });
    return page.map((row) => row.type);
  },
});
`,
  "convex/inbox.test.ts": `
/// <reference types="vite/client" />
import { register } from "${name}/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

test("a host convex-test instance mounts the component with register(t)", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  register(t);
  const { notificationIds } = await t.mutation(api.inbox.deliver, { subjectRef: "u1" });
  expect(notificationIds).toHaveLength(1);
  expect(await t.query(api.inbox.unreadCount, { subjectRef: "u1" })).toBe(1);
  expect(await t.query(api.inbox.types, { subjectRef: "u1" })).toEqual(["mention"]);
});
`,
  "vitest.config.mts": `
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "edge-runtime", server: { deps: { inline: ["convex-test"] } } },
});
`,
  // Every entry point a consumer imports, so a broken export map fails the type check.
  "consumer.ts": `
import { Notifications } from "${name}";
import type { ComponentApi } from "${name}/_generated/component";
import type { ComponentApi as ComponentApiJs } from "${name}/_generated/component.js";
import config from "${name}/convex.config";
import configJs from "${name}/convex.config.js";
import { defineApp } from "convex/server";

declare const component: ComponentApi;
declare const componentJs: ComponentApiJs;
const app = defineApp();
app.use(config);
app.use(configJs, { name: "alerts" });
void new Notifications(component);
void new Notifications(componentJs);
`,
};

try {
  run("pnpm", ["pack", "--pack-destination", temporary], root);
  const tarball = readdirSync(temporary).find((file) => file.endsWith(".tgz"));
  if (tarball === undefined) throw new Error("pnpm pack produced no tarball");
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({ private: true, type: "module", pnpm: { ignoredBuiltDependencies: ["esbuild"] } }),
  );
  // pnpm 11 reads the build-script policy from the workspace file, pnpm 10 from package.json.
  writeFileSync(join(temporary, "pnpm-workspace.yaml"), "allowBuilds:\n  esbuild: false\n");
  run("pnpm", [
    "add",
    join(temporary, tarball),
    "convex@1.45.0",
    "typescript@npm:@typescript/typescript6@6.0.2",
    "convex-test@0.0.71",
    "vitest@5.1.1",
    "vite@8.3.8",
    "@edge-runtime/vm@5.0.0",
    "esbuild@0.27.0",
  ]);

  const installed = join(temporary, "node_modules", name);
  const missing = ["README.md", "CHANGELOG.md", "LICENSE", "llms.txt", "docs/API.md"].filter(
    (file) => !existsSync(join(installed, file)),
  );
  if (missing.length > 0) throw new Error(`installed package is missing ${missing.join(", ")}`);

  // Entry points with runtime code. `./_generated/component*` are type-only and
  // `./test` is TypeScript source for Vitest; both are covered below.
  // The main entry imports in plain Node.
  run("node", [
    "--input-type=module",
    "-e",
    `import { Notifications } from "${name}"; if (typeof Notifications !== "function") throw new Error("missing Notifications");`,
  ]);
  // `./convex.config*` cannot load in plain Node: @convex-dev/batch-worker (pinned
  // by @convex-dev/aggregate) has an extension-less relative import Node rejects,
  // and `component.use(aggregate)` needs Convex's bundler. Bundle them with
  // esbuild, as Convex does on deploy; a missing file or default export fails it.
  write(
    "config-entry.mjs",
    `
import config from "${name}/convex.config";
import configJs from "${name}/convex.config.js";
export { config, configJs };
`,
  );
  run("pnpm", ["exec", "esbuild", "config-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--log-level=warning", "--outfile=config-bundle.mjs"]);

  for (const [path, content] of Object.entries(host)) write(path, content);
  const files = Object.keys(host).filter((path) => path.endsWith(".ts"));
  tsc("--module", "ESNext", "--moduleResolution", "Bundler", "--types", "vite/client", ...files);
  tsc("--module", "NodeNext", "--moduleResolution", "NodeNext", "consumer.ts");
  run("pnpm", ["exec", "vitest", "run"]);
  console.log(`OK    ${name}: tarball installs, type-checks and runs on convex@1.45.0`);
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
