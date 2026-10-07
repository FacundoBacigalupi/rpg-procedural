import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Corre Biome con la config del repo sobre fixtures escritos en las rutas que importan
// (src/core, src/sim, src/game...) dentro de una carpeta temporal, sin ensuciar src/.

const root = join(import.meta.dirname, "..");
const biome = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");

const fixtures: Record<string, string> = {};
const pure = ["core", "worldgen", "sim"];
const forbidden = {
  random: "export const a = Math.random();",
  exp: "export const a = Math.exp(1);",
  atan2: "export const a = Math.atan2(1, 2);",
  power: "export const a = 2 ** 0.5;",
  date: "export const a = Date.now();",
  performance: "export const a = performance.now();",
  process: "export const a = process.env;",
};
for (const layer of pure) {
  for (const [name, code] of Object.entries(forbidden)) {
    fixtures[`src/${layer}/x/${name}.ts`] = code;
  }
}
fixtures["src/sim/x/exact.ts"] =
  "export const a = Math.sqrt(2) + Math.floor(1.5) + Math.abs(-1) + Math.imul(3, 5);";
fixtures["src/sim/x/shadowed.ts"] =
  "const Date = 1;\nexport const a = { process: 2 }.process + Date;";
fixtures["src/game/x/impure.ts"] = "export const a = Date.now() + Math.random();";
fixtures["src/core/x/exp.test.ts"] = "export const a = Math.exp(1);";

let errorsByFile: Map<string, string[]>;
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rpg-lint-"));
  const config = JSON.parse(readFileSync(join(root, "biome.json"), "utf8"));
  delete config.$schema;
  delete config.vcs;
  delete config.files;
  writeFileSync(join(dir, "biome.json"), JSON.stringify(config));
  cpSync(join(root, "lint"), join(dir, "lint"), { recursive: true });
  cpSync(join(root, ".editorconfig"), join(dir, ".editorconfig"));
  for (const [path, code] of Object.entries(fixtures)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), `${code}\n`);
  }
  const run = spawnSync(process.execPath, [biome, "lint", "--reporter=json", "."], {
    cwd: dir,
    encoding: "utf8",
  });
  const report = JSON.parse(run.stdout) as {
    diagnostics: { category: string; severity: string; location?: { path?: string } }[];
  };
  errorsByFile = new Map();
  for (const d of report.diagnostics) {
    const determinism = d.category === "plugin" || d.category === "lint/style/noRestrictedGlobals";
    if (d.severity !== "error" || !determinism || !d.location?.path) continue;
    const path = d.location.path.replaceAll("\\", "/");
    errorsByFile.set(path, [...(errorsByFile.get(path) ?? []), d.category]);
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("reglas de determinismo (lint/determinism.grit y noRestrictedGlobals)", () => {
  for (const layer of pure) {
    for (const [name, code] of Object.entries(forbidden)) {
      it(`${layer} rechaza: ${code}`, () => {
        expect(errorsByFile.get(`src/${layer}/x/${name}.ts`)?.length).toBe(1);
      });
    }
  }

  it("permite la aritmética exacta de IEEE y la raíz cuadrada", () => {
    expect(errorsByFile.get("src/sim/x/exact.ts")).toBeUndefined();
  });

  it("no confunde nombres locales ni propiedades con los globales", () => {
    expect(errorsByFile.get("src/sim/x/shadowed.ts")).toBeUndefined();
  });

  it("fuera del código puro y en los tests se permiten", () => {
    expect(errorsByFile.get("src/game/x/impure.ts")).toBeUndefined();
    expect(errorsByFile.get("src/core/x/exp.test.ts")).toBeUndefined();
  });
});
