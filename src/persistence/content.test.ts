import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentError, contentId, defineContent, z } from "../core/index.ts";
import { ACTIONS, CONTENT_KINDS, PARSER_EXAMPLES, PLANS, TRAITS } from "../sim/index.ts";
import { BIOMES } from "../worldgen/index.ts";
import { loadContentDir } from "./content.ts";

const HERBS = defineContent("herbs", z.strictObject({ id: contentId, potency: z.number() }));
const REALMS = defineContent(
  "families/xianxia/realms",
  z.strictObject({ id: contentId, needs: contentId.optional() }),
  (r) => (r.needs ? [{ kind: "herbs", id: r.needs, at: "needs" }] : []),
);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "rpg-content-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function errorsOf(root: string): readonly string[] {
  try {
    loadContentDir(root, [HERBS, REALMS]);
  } catch (e) {
    if (e instanceof ContentError) return e.problems;
    throw e;
  }
  return [];
}

describe("loadContentDir", () => {
  it("lee las carpetas anidadas como tipos e ignora lo que no es JSON", () => {
    const root = tree({
      "README.md": "# nada",
      "herbs/a.json": '[{"id":"ginseng","potency":3}]',
      "herbs/more/b.json": '[{"id":"lotus","potency":1}]',
      "families/xianxia/realms/r.json": '[{"id":"qi","needs":"lotus"}]',
    });
    const c = loadContentDir(root, [HERBS, REALMS]);
    expect(c.all(HERBS).map((h) => h.id)).toEqual(["ginseng", "lotus"]);
    expect(c.get(REALMS, "qi")).toEqual({ id: "qi", needs: "lotus" });
  });

  it("una referencia rota entre carpetas no carga", () => {
    const root = tree({
      "herbs/a.json": '[{"id":"ginseng","potency":3}]',
      "families/xianxia/realms/r.json": '[{"id":"qi","needs":"moly"}]',
    });
    expect(errorsOf(root)).toEqual(["families/xianxia/realms/qi.needs: herbs/moly no existe"]);
  });

  it("junta los JSON rotos con los errores de validación", () => {
    const root = tree({
      "herbs/a.json": "[{",
      "herbs/b.json": '[{"id":"lotus"}]',
    });
    const problems = errorsOf(root);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/herbs\/a\.json: JSON inválido/);
    expect(problems[1]).toMatch(/herbs\/b\.json\[0\]\.potency: /);
  });

  it("el content/ del repo carga y valida", () => {
    const c = loadContentDir("content", CONTENT_KINDS);
    expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.all(BIOMES).length).toBeGreaterThan(10);
    expect(c.all(TRAITS).length).toBeGreaterThan(10);
    expect(c.all(PARSER_EXAMPLES).length).toBeGreaterThan(0);
    expect(c.all(ACTIONS).map((a) => a.id)).toContain("take");
    expect(c.all(PLANS).map((p) => p.id)).toEqual(["steal"]);
  });
});
