// Técnicas de ataque (novel3-technique-core): todo o nada, conservación de lo gastado, alcance,
// control y contragolpe; deterministas.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EventId, Rng } from "../../core/index.ts";
import { type AttackArt, type CastInput, castArt } from "./index.ts";

const art: AttackArt = {
  id: "palm",
  shape: "projectile",
  cost: 10,
  range: 12,
  power: 0.6,
  difficulty: 0.5,
  wound: "blunt",
};
const cast = (o: Partial<CastInput> & { seed?: number } = {}) =>
  castArt({
    art,
    qi: 30,
    control: 0.8,
    distance: 4,
    evade: 0,
    rng: Rng.root(o.seed ?? 1),
    cause: "e1" as EventId,
    at: 0,
    ...o,
  });
const many = (o: Partial<CastInput>, n = 200) =>
  Array.from({ length: n }, (_, seed) => cast({ ...o, seed }));

describe("técnicas de ataque (novel3-technique-core)", () => {
  it("es determinista", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e6 }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        (seed, d) => {
          expect(cast({ seed, distance: d })).toEqual(cast({ seed, distance: d }));
        },
      ),
    );
  });

  it("sin el qi entero no sale ni gasta; con él gasta el costo pase lo que pase", () => {
    expect(cast({ qi: 9.9 })).toEqual({ outcome: "no_qi", spent: 0, backlash: 0 });
    for (const c of many({ distance: 15, control: 0.3 })) expect(c.spent).toBe(art.cost);
  });

  it("muy lejos se apaga; cerca pega más fuerte que en el borde", () => {
    for (const c of many({ distance: 19 }, 50)) expect(c.outcome).toBe("faded");
    const force = (d: number) => {
      const hits = many({ distance: d }).flatMap((c) => (c.blow ? [c.blow.force] : []));
      return hits.reduce((a, b) => a + b, 0) / Math.max(1, hits.length);
    };
    expect(force(2)).toBeGreaterThan(force(16));
    const blow = many({}).find((c) => c.blow)?.blow;
    expect(blow).toMatchObject({ kind: "blunt", cause: "e1", at: 0 });
  });

  it("con control alto llega más, y un blanco rápido se corre", () => {
    const hits = (o: Partial<CastInput>) => many(o).filter((c) => c.outcome === "hit").length;
    expect(hits({ control: 0.9 })).toBeGreaterThan(hits({ control: 0.2 }));
    expect(hits({ evade: 0.6 })).toBeLessThan(hits({ evade: 0 }));
  });

  it("con control de sobra no hay contragolpe; con poco, a veces daña los meridianos", () => {
    for (const c of many({ control: 0.6 })) expect(c.backlash).toBe(0);
    const bad = many({ control: 0 });
    expect(bad.some((c) => c.backlash > 0)).toBe(true);
    for (const c of bad) expect(c.backlash).toBeLessThanOrEqual(0.15);
  });
});
