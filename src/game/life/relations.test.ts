import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EventId, loadContent } from "../../core/index.ts";
import {
  applyDeltas,
  checkInvariants,
  current,
  type DecayContext,
  DIMENSIONS,
  kinBonds,
  MIND,
  PERSON,
  RELATION_BONDS,
  RELATION_DIMS,
  RELATIONS,
  type Relationship,
  relationProblems,
  relationship,
  SCHEMAS,
  strangerDims,
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
const dims = content.all(RELATION_DIMS);
const bonds = content.all(RELATION_BONDS);
const DAY = 86_400;
const EVENT = 1 as unknown as EventId;
const EVENT2 = 2 as unknown as EventId;

const ctx = (strength = 0): DecayContext => ({ dims, bonds, schemaStrength: () => strength });
const stranger = (): Relationship => ({
  dims: strangerDims(dims),
  bonds: [],
  history: [],
  updated: 0,
});

describe("el contenido de las relaciones", () => {
  it("cierra con los esquemas y sus pisos", () => {
    const schemaIds = new Set(content.all(SCHEMAS).map((s) => s.id as string));
    expect(relationProblems(dims, bonds, schemaIds)).toEqual([]);
  });
});

describe("el decaimiento", () => {
  const angry: Relationship = {
    ...stranger(),
    dims: { ...strangerDims(dims), resentment: 0.8, familiarity: 0.8, affection: 0.6 },
  };

  it("la familiaridad cae sin contacto mucho más rápido que el resentimiento", () => {
    const later = current(angry, 120 * DAY, ctx());
    expect(later.dims.familiarity).toBeLessThan(0.8 * 0.3);
    expect(later.dims.resentment).toBeGreaterThan(0.8 * 0.7);
  });

  it("el que es de rencores guarda más el resentimiento", () => {
    const calm = current(angry, 700 * DAY, ctx(0)).dims.resentment;
    const grudge = current(angry, 700 * DAY, ctx(1)).dims.resentment;
    expect(grudge).toBeGreaterThan(calm);
  });

  it("un vínculo pone piso: los padres no se vuelven extraños", () => {
    const kin: Relationship = { ...angry, bonds: ["parent"] };
    const later = current(kin, 100 * 365 * DAY, ctx());
    expect(later.dims.familiarity).toBeGreaterThanOrEqual(0.5);
    expect(later.dims.affection).toBeGreaterThanOrEqual(0.1);
    expect(current(angry, 100 * 365 * DAY, ctx()).dims.familiarity).toBeLessThan(0.01);
  });

  it("leer en cualquier orden da lo mismo (perezoso y aditivo)", () => {
    const direct = current(angry, 90 * DAY, ctx());
    const steps = current(current(angry, 30 * DAY, ctx()), 90 * DAY, ctx());
    for (const d of DIMENSIONS) expect(steps.dims[d]).toBeCloseTo(direct.dims[d], 4);
  });

  it("nunca sale de rango, hagan lo que hagan los deltas", () => {
    const delta = fc.record(
      Object.fromEntries(DIMENSIONS.map((d) => [d, fc.double({ min: -3, max: 3, noNaN: true })])),
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(
        fc.array(delta, { maxLength: 8 }),
        fc.integer({ min: 0, max: 5000 }),
        (ds, days) => {
          let rel = stranger();
          for (const d of ds) rel = applyDeltas(rel, d, EVENT);
          rel = current(rel, days * DAY, ctx(0.5));
          for (const k of DIMENSIONS) {
            const v = rel.dims[k];
            const lo = k === "trust" || k === "respect" || k === "affection" ? -1 : 0;
            if (v < lo || v > 1) return false;
          }
          return true;
        },
      ),
    );
  });
});

describe("los cambios citan su evento", () => {
  it("applyDeltas suma, acota y registra la causa una vez", () => {
    let rel = applyDeltas(stranger(), { resentment: 0.4, trust: -0.5 }, EVENT);
    rel = applyDeltas(rel, { resentment: 0.9 }, EVENT);
    expect(rel.dims.resentment).toBe(1);
    expect(rel.dims.trust).toBeCloseTo(-0.45, 6);
    expect(rel.history).toEqual([EVENT]);
    expect(applyDeltas(rel, { fear: 0.1 }, EVENT2).history).toEqual([EVENT, EVENT2]);
  });

  it("un cambio nulo no deja rastro", () => {
    const rel = stranger();
    expect(applyDeltas(rel, { fear: 0 }, EVENT)).toBe(rel);
    expect(applyDeltas(rel, { fear: -0.5 }, EVENT)).toBe(rel);
  });
});

describe("las relaciones de la aldea", () => {
  const w = Life.create(7, content).world;
  const people = (w.truth.ids(PERSON) as AgentId[]).filter((id) => w.truth.get(MIND, id));
  const person = (id: AgentId) => w.truth.get(PERSON, id);
  const now = person(people[0] as AgentId)?.born ?? 0;

  it("el parentesco se ve desde los dos lados con vínculos que se corresponden", () => {
    const pairs = {
      parent: "child",
      child: "parent",
      grandparent: "grandchild",
      grandchild: "grandparent",
    };
    let seen = 0;
    for (const a of people) {
      for (const b of people) {
        const ab = kinBonds(a, b, person);
        const ba = kinBonds(b, a, person);
        for (const [x, y] of Object.entries(pairs)) {
          if (ab.includes(x)) {
            seen++;
            expect(ba, `${a}→${b} ${x}`).toContain(y);
          }
        }
        expect(ab.includes("sibling")).toBe(ba.includes("sibling"));
        expect(ab.includes("spouse")).toBe(ba.includes("spouse"));
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it("cada vínculo siembra una relación con causa, y los extraños no figuran", () => {
    let rows = 0;
    for (const a of people) {
      const rels = w.truth.get(RELATIONS, a);
      for (const b of people) {
        const bondsAB = kinBonds(a, b, person);
        const rel = rels?.toward[b];
        if (bondsAB.length === 0) {
          expect(rel, `${a}→${b}`).toBeUndefined();
          continue;
        }
        rows++;
        expect(rel?.bonds).toEqual(bondsAB);
        expect(rel?.history).toEqual([rels?.originEventId]);
        expect(rel?.dims.familiarity ?? 0).toBeGreaterThan(0.3);
      }
    }
    expect(rows).toBeGreaterThan(20);
  });

  it("son asimétricas: el hijo no siente por el padre lo que el padre por el hijo", () => {
    let checked = 0;
    for (const a of people) {
      for (const b of people) {
        if (!kinBonds(a, b, person).includes("parent")) continue;
        const up = relationship(w.truth.get(RELATIONS, a), b, now, ctx());
        const down = relationship(w.truth.get(RELATIONS, b), a, now, ctx());
        expect(up.dims.respect).not.toBe(down.dims.respect);
        expect(up.dims.dependency).toBeGreaterThan(down.dims.dependency - 1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("es determinista y no rompe invariantes", () => {
    const again = Life.create(7, content).world;
    for (const a of people)
      expect(again.truth.get(RELATIONS, a)).toEqual(w.truth.get(RELATIONS, a));
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 60_000);
});
