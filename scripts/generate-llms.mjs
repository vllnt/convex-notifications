import { existsSync, readFileSync } from "node:fs";

// Keep the legacy command as a read-only check of the maintained discovery index.
// llms.txt ships in the npm tarball, so local links are `./`-relative and resolve
// next to it in node_modules; scripts/package-contents.test.mjs checks they ship.
const index = readFileSync("llms.txt", "utf8");
if (!index.startsWith("# @vllnt/convex-notifications\n")) {
  throw new Error("llms.txt must start with the package heading");
}
if (!index.includes("(https://oss.vllnt.com/llms.txt)")) {
  throw new Error("llms.txt must link the ecosystem index https://oss.vllnt.com/llms.txt");
}
for (const [, target] of index.matchAll(/\]\(([^)]+)\)/g)) {
  if (/^(?:https?:|#)/.test(target)) continue;
  if (!target.startsWith("./")) {
    throw new Error(`llms.txt local links must start with "./": ${target}`);
  }
  if (!existsSync(target.split("#")[0])) {
    throw new Error(`Missing llms.txt link target: ${target}`);
  }
}
console.log("Validated maintained llms.txt (no files generated)");
