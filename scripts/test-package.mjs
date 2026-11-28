// Packs the package, installs the tarball in a throwaway consumer on the lowest
// supported peer (convex 1.45.0), and proves what a host app relies on: the
// shipped docs and their contract (scripts/check-documentation.mjs), runtime
// imports, a type check of every entry point, and the README examples
// type-checked and run (a host convex-test through `register(t)`).
// Run after `pnpm build`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkDocumentation, convexHost, writeHost } from "./check-documentation.mjs";

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
// Type-check with both supported compiler majors, using the consumer's own
// binaries so a TypeScript on PATH (for example this repo's) is never picked up.
const tsc = (...args) => {
  for (const binary of ["tsc", "tsc6"]) {
    run(join(temporary, "node_modules", ".bin", binary), ["--noEmit", "--strict", "--target", "ES2022", ...args]);
  }
};

// Every entry point a consumer imports, so a broken export map fails the type
// check (both module resolutions). Host behaviour is proven by the README
// examples, which run below against the installed package.
const host = {
  "consumer.ts": `
import { Notifications } from "${name}";
import { register } from "${name}/test";
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
void register;
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
  // The repo's 7-day release-age gate; pnpm 10 reads it only from the workspace file.
  writeFileSync(join(temporary, "pnpm-workspace.yaml"), "allowBuilds:\n  esbuild: false\nminimumReleaseAge: 10080\n");
  run("pnpm", [
    "add",
    join(temporary, tarball),
    "convex@1.45.0",
    "typescript@7.0.2",
    "@typescript/typescript6@6.0.2",
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
  const files = Object.keys(host);
  tsc("--module", "ESNext", "--moduleResolution", "Bundler", "--types", "vite/client", ...files);
  tsc("--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "vite/client", ...files);

  // The docs contract on what consumers receive, then the README examples in a
  // stub Convex host: type-checked with both compilers and module resolutions,
  // and its test example run with the README's own vitest.config.mts.
  // `--skipLibCheck`, as in a Convex app's tsconfig: the `vitest` and
  // `vitest/config` typings need @types/node and a newer lib than ES2022,
  // which a host need not have.
  // It skips only `.d.ts` files: the README files and the shipped `./test`
  // source are still checked, and the entry points above are checked without it.
  // DOCS_LINKS=offline (the publish gate) skips fetching external links, so a
  // linked site's outage cannot block a release; CI still fetches them.
  const network = process.env.DOCS_LINKS !== "offline";
  if (!network) console.log("SKIP  external links not fetched (DOCS_LINKS=offline); CI checks them");
  const examples = await checkDocumentation(installed, temporary, { network });
  const hostFiles = writeHost(temporary, convexHost(installed, examples), examples);
  tsc("--module", "ESNext", "--moduleResolution", "Bundler", "--types", "vite/client", "--skipLibCheck", ...hostFiles);
  tsc("--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "vite/client", "--skipLibCheck", ...hostFiles);
  run("pnpm", ["exec", "vitest", "run"]);
  console.log(`OK    ${name}: tarball installs, type-checks and runs on convex@1.45.0`);
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
