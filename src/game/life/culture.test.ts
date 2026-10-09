import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  COMMUNITY_ACCENT,
  COMMUNITY_CULTURE,
  CULTURE_TRAITS,
  CULTURES,
  checkInvariants,
  communityAccents,
  cultureProblems,
  dominantVariant,
  ENTITY,
  FOODS,
  languageRootAccent,
  PERSON,
  PERSON_CULTURE,
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

  it("la aldea tiene su acento, derivado del de la lengua madre y con evento de origen", () => {
    const [id] = w.truth.ids(COMMUNITY_ACCENT);
    const row = id === undefined ? undefined : w.truth.get(COMMUNITY_ACCENT, id);
    expect(row).toBeDefined();
    expect(w.log.get(row?.originEventId as never)?.kind).toBe("language.accent_seeded");
    expect(row?.parent).toEqual(languageRootAccent(7, row?.language as string));
    expect(row?.accent).not.toEqual(row?.parent);
    expect(communityAccents(w.truth).length).toBe(1);
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

describe("la cultura de cada persona", () => {
  const w = Life.create(7, content).world;
  const people = w.truth.ids(PERSON) as AgentId[];

  it("cada persona de la aldea sigue una variante por rasgo, con la misma lista que la comunidad", () => {
    const traits = Object.keys(villageCulture(w.truth)?.prevalence ?? {}).sort();
    expect(people.length).toBeGreaterThan(0);
    for (const id of people) {
      const pc = w.truth.get(PERSON_CULTURE, id);
      expect(Object.keys(pc?.holdings ?? {}).sort(), id).toEqual(traits);
      expect(w.log.get(pc?.originEventId as never)?.kind).toBe("culture.people_seeded");
    }
  });

  it("lo que sigue cada uno es una variante que la comunidad conoce", () => {
    const community = villageCulture(w.truth);
    for (const id of people) {
      for (const [t, h] of Object.entries(w.truth.get(PERSON_CULTURE, id)?.holdings ?? {})) {
        expect(community?.prevalence[t]?.variants[h.variant], `${id} ${t}`).toBeGreaterThan(0);
      }
    }
  });

  it("los hijos que copiaron nombran a un padre como de quien aprendieron", () => {
    let vertical = 0;
    for (const id of people) {
      const rec = w.truth.get(PERSON, id);
      const parents = [rec?.mother, rec?.father].filter((p): p is AgentId => !!p);
      for (const h of Object.values(w.truth.get(PERSON_CULTURE, id)?.holdings ?? {})) {
        if (h.mode === "vertical") {
          vertical++;
          expect(parents).toContain(h.learnedFrom[0]);
        } else {
          expect(h.mode).toBe("born");
          expect(h.learnedFrom).toEqual([]);
        }
      }
    }
    expect(vertical).toBeGreaterThan(0);
  });

  it("es determinista", () => {
    const again = Life.create(7, content).world;
    for (const id of people) {
      expect(again.truth.get(PERSON_CULTURE, id)).toEqual(w.truth.get(PERSON_CULTURE, id));
    }
  }, 30_000);
});
