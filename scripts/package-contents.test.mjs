// @vitest-environment node
// Guards the npm tarball: the bundled agent docs must ship, contributor files
// must not, and llms.txt must link shipped files relatively. Runs in CI through
// `pnpm test:coverage`; it needs no build because it only checks non-dist paths.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const [report] = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
const packed = new Set(report.files.map((file) => file.path));
const links = [...readFileSync("llms.txt", "utf8").matchAll(/\]\(([^)]+)\)/g)].map(
  (match) => match[1],
);

describe("npm tarball", () => {
  it.each([
    "package.json",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "llms.txt",
    "docs/API.md",
    "src/test.ts",
  ])("ships %s", (path) => {
    expect(packed.has(path)).toBe(true);
  });

  it("ships no contributor, test, or internal files", () => {
    const leaked = [...packed].filter(
      (path) =>
        /^(AGENTS|CLAUDE|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY)\.md$/.test(path) ||
        /^(example|scripts|\.github|coverage)\//.test(path) ||
        /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
        (path.startsWith("docs/") && path !== "docs/API.md"),
    );
    expect(leaked).toEqual([]);
  });

  it("resolves every relative llms.txt link inside the tarball", () => {
    const relative = links.filter((link) => !/^(?:https?:|#)/.test(link));
    expect(relative.length).toBeGreaterThan(0);
    for (const link of relative) {
      expect(link.startsWith("./"), link).toBe(true);
      expect(packed.has(link.slice(2).split("#")[0]), link).toBe(true);
    }
  });

  it("links shipped files relatively, not by a repository URL", () => {
    const repoBlob = /^https:\/\/github\.com\/vllnt\/convex-notifications\/blob\/[^/]+\/(.+)$/;
    const shippedByUrl = links
      .map((link) => repoBlob.exec(link)?.[1]?.split("#")[0])
      .filter((path) => path !== undefined && packed.has(path));
    expect(shippedByUrl).toEqual([]);
  });
});
