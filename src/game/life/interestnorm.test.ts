import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { CULTURE_TRAITS, CULTURES, cultureProblems } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { withInterestNorm } from "./create.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

describe("norms.interest", () => {
  const village = content.all(CULTURES).find((c) => c.id === "village");
  if (!village) throw new Error("falta village");

  it("sin la opción la cultura es la misma (los hashes no cambian)", () => {
    expect(withInterestNorm(village, {})).toBe(village);
  });

  it("con la opción siembra el rasgo y la cultura sigue siendo válida", () => {
    const c = withInterestNorm(village, { interestNorm: { variants: { forbidden: 3, free: 1 } } });
    expect(c.traits.at(-1)?.trait).toBe("norms.interest");
    expect(cultureProblems(c, content.all(CULTURE_TRAITS))).toEqual([]);
  });
});
