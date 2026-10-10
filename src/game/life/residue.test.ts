import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import { BODY_STATE, ENTITY, RESIDUE, type ReadonlyWorldTruth } from "../../sim/index.ts";
import { cultivationEfficiencyOf, residueProcess, takeEssence } from "./residue.ts";

const who = "agent:1" as AgentId;
const place = { hex: 0 } as never;
const clock = { day: 86400, year: 86400 * 360, moons: [] } as never;
const cause = { kind: "state", entity: who, key: "x" } as never;

function truthWith(load?: number): ReadonlyWorldTruth {
  return {
    get: (t: { name: string }, id: unknown) =>
      t.name === RESIDUE.name && load !== undefined
        ? { load, at: 0 }
        : t.name === ENTITY.name
          ? { endedAt: undefined }
          : t.name === BODY_STATE.name
            ? { death: null }
            : undefined,
    ids: (t: { name: string }) => (t.name === RESIDUE.name && load !== undefined ? [who] : []),
  } as unknown as ReadonlyWorldTruth;
}

const run = (p: ReturnType<typeof residueProcess>, truth: ReadonlyWorldTruth) =>
  p.run({
    now: 86400 * 10,
    window: 86400,
    truth,
    rng: Rng.root(7).fork("residue"),
  } as never);

describe("residuo cableado", () => {
  it("la ingesta pura no deja fila y la impura suma el residuo", () => {
    const pure = takeEssence(
      truthWith(),
      who,
      { essence: 5, purity: 1, good: "pill" },
      {},
      0,
      place,
      cause,
    );
    expect(pure.changes).toEqual([]);
    const dirty = takeEssence(
      truthWith(2),
      who,
      { essence: 5, purity: 0.6, good: "pill" },
      {},
      0,
      place,
      cause,
    );
    expect(dirty.changes).toHaveLength(1);
    expect((dirty.changes[0] as { value: { load: number } }).value.load).toBeCloseTo(4);
    expect(dirty.events).toEqual([]);
  });

  it("la sobrecarga solo se evalúa con overload y deja evento con causa", () => {
    const off = takeEssence(truthWith(), who, { essence: 100, good: "pill" }, {}, 0, place, cause);
    expect(off.overload).toBeUndefined();
    const on = takeEssence(
      truthWith(),
      who,
      { essence: 100, good: "pill" },
      { overload: true },
      0,
      place,
      cause,
    );
    expect(on.overload?.stage).toBe("fatal");
    expect(on.events[0]?.kind).toBe("body.overload");
    expect(on.events[0]?.causes).toEqual([cause]);
  });

  it("la eficiencia baja con la carga; sin fila es 1", () => {
    expect(cultivationEfficiencyOf(truthWith(), who)).toBe(1);
    expect(cultivationEfficiencyOf(truthWith(10), who)).toBeLessThan(1);
  });

  it("el proceso purga cada día y borra la fila vacía", () => {
    const p = residueProcess({ clock, placeOf: () => place });
    const r = run(p, truthWith(5));
    expect(r.changes).toHaveLength(1);
    expect(run(p, truthWith(1e-9)).changes?.[0]).toMatchObject({ op: "delete" });
  });

  it("la desviación es determinista y deja evento con causa", () => {
    const p = residueProcess({
      clock,
      placeOf: () => place,
      deviation: true,
      stabilityOf: () => 0,
    });
    const a = run(p, truthWith(100));
    const b = run(p, truthWith(100));
    expect(a).toEqual(b);
    const none = residueProcess({ clock, placeOf: () => place });
    expect(run(none, truthWith(100)).events ?? []).toEqual([]);
  });
});
