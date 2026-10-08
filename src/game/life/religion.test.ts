import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  COMMUNITY_RELIGION,
  checkInvariants,
  DOCTRINES,
  GOODS,
  practicesOfKind,
  RELIGIONS,
  religionProblems,
  tabooOnGood,
  villageCulture,
  villageReligion,
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

describe("el contenido de la religión", () => {
  it("cada religión cierra consigo misma y nombra doctrinas y bienes que existen", () => {
    const doctrines = new Set(content.all(DOCTRINES).map((d) => d.id));
    const goods = new Set(content.all(GOODS).map((g) => g.id));
    for (const r of content.all(RELIGIONS)) {
      expect(religionProblems(r), r.id).toEqual([]);
      for (const d of r.doctrines) expect(doctrines.has(d), `${r.id}: ${d}`).toBe(true);
      for (const p of r.practices) for (const g of p.goods) expect(goods.has(g), p.id).toBe(true);
    }
  });

  it("detecta una ofrenda a un ser que no está", () => {
    const [r] = content.all(RELIGIONS);
    if (!r) throw new Error("sin religión");
    const rota = {
      ...r,
      practices: [
        ...r.practices,
        { ...r.practices[0], id: "x", to: "nadie" },
        { ...r.practices[0], id: "y", to: undefined },
      ],
    } as typeof r;
    const problems = religionProblems(rota);
    expect(problems.some((p) => p.includes("nadie"))).toBe(true);
    expect(problems.some((p) => p.includes("no dice a quién"))).toBe(true);
  });
});

describe("la religión de la aldea inicial", () => {
  const w = Life.create(7, content).world;
  const religion = villageReligion(w.truth);

  it("hay una religión popular con ancestros, una fiesta y tabúes", () => {
    expect(religion?.kind).toBe("folk");
    expect(religion?.exclusive).toBe(false);
    expect(practicesOfKind(religion, "festival").length).toBeGreaterThan(0);
    expect(practicesOfKind(religion, "taboo").length).toBeGreaterThan(0);
    expect(religion?.sacredBeings.some((b) => b.kind === "ancestors")).toBe(true);
    expect(tabooOnGood(religion, "grain")?.id).toBe("no-first-sheaf");
    expect(tabooOnGood(religion, "copper")).toBeUndefined();
    expect(tabooOnGood(undefined, "grain")).toBeUndefined();
  });

  it("la fiesta apunta a un rasgo que la cultura de la aldea tiene", () => {
    const culture = villageCulture(w.truth);
    const withTrait = (religion?.practices ?? []).filter((p) => p.trait);
    expect(withTrait.length).toBeGreaterThan(0);
    for (const p of withTrait) {
      expect(culture?.prevalence[p.trait as string], p.id).toBeDefined();
    }
  });

  it("sale de un evento con causa en la fundación y no crea nada en el mundo", () => {
    const e = religion ? w.log.get(religion.originEventId) : undefined;
    expect(e?.kind).toBe("religion.seeded");
    expect(e?.causes.length).toBeGreaterThan(0);
    expect(w.truth.ids(COMMUNITY_RELIGION).length).toBe(1);
    // Ningún ser venerado tiene del otro lado a nadie: la creencia no vuelve verdad nada.
    for (const b of religion?.sacredBeings ?? []) expect(b.truth).toBe("none");
  });

  it("es determinista y no rompe los invariantes", () => {
    expect(villageReligion(Life.create(7, content).world.truth)).toEqual(religion);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 30_000);
});
