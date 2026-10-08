import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  COMMUNITY_CULTURE,
  CULTURE_TRAITS,
  CULTURES,
  checkInvariants,
  cultureProblems,
  dominantVariant,
  ENTITY,
  FOODS,
  STATUSES,
  TENURES,
  traitParam,
  villageCulture,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";

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

describe("el contenido de la cultura", () => {
  it("la cultura de la aldea cierra contra sus rasgos", () => {
    const traits = content.all(CULTURE_TRAITS);
    for (const c of content.all(CULTURES)) expect(cultureProblems(c, traits), c.id).toEqual([]);
  });

  it("los estatus y las tenencias nombran una cultura que existe", () => {
    const cultures = new Set(content.all(CULTURES).map((c) => c.id));
    for (const s of content.all(STATUSES)) expect(cultures.has(s.culture), s.id).toBe(true);
    for (const t of content.all(TENURES)) expect(cultures.has(t.culture), t.id).toBe(true);
  });

  it("los requisitos de comida de cada rasgo existen", () => {
    const foods = new Set(content.all(FOODS).map((f) => f.id));
    for (const t of content.all(CULTURE_TRAITS)) {
      for (const f of t.requiresFoods) expect(foods.has(f), `${t.id} pide ${f}`).toBe(true);
    }
  });
});

describe("la cultura de la aldea inicial", () => {
  const w = Life.create(7, content).world;
  const culture = villageCulture(w.truth);

  it("hay una cultura con un rasgo por cada uno que declara y todos con origen", () => {
    expect(culture).toBeDefined();
    const def = content.all(CULTURES).find((c) => c.id === "village");
    expect(Object.keys(culture?.prevalence ?? {}).sort()).toEqual(
      (def?.traits ?? []).map((t) => t.trait).sort(),
    );
    for (const p of Object.values(culture?.prevalence ?? {})) {
      expect(p.because.length).toBeGreaterThan(0);
      const sum = Object.values(p.variants).reduce((s, x) => s + x, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it("sale de un evento con causa en la fundación", () => {
    const e = culture ? w.log.get(culture.originEventId) : undefined;
    expect(e?.kind).toBe("culture.seeded");
    expect(e?.causes.length).toBeGreaterThan(0);
    expect(w.truth.ids(COMMUNITY_CULTURE).length).toBe(1);
    expect(w.truth.get(ENTITY, w.truth.ids(COMMUNITY_CULTURE)[0] as never)).toBeDefined();
  });

  it("los lectores ven la variante dominante y los números del rasgo", () => {
    expect(dominantVariant(culture, "etiquette.address")).toBe("by_rank");
    expect(dominantVariant(culture, "funeral.rite")).toBe("burial");
    expect(dominantVariant(culture, "no.existe")).toBeUndefined();
    expect(traitParam(culture, "funeral.mourning", "days", 0)).toBe(30);
    expect(traitParam(undefined, "funeral.mourning", "days", 7)).toBe(7);
  });

  it("es determinista y no rompe los invariantes", () => {
    const again = villageCulture(Life.create(7, content).world.truth);
    expect(again).toEqual(culture);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 30_000);
});
