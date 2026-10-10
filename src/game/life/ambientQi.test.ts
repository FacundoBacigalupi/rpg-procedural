import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  altitudeEnv,
  ambientIntake,
  ambientQiC,
  BODY_STATE,
  ENTITY,
  LOCATION,
  PERSON,
  RESIDUE,
  type ReadonlyWorldTruth,
  relativeQi,
  TEMPERATE,
  TRAVEL_CELL,
} from "../../sim/index.ts";
import { ambientQiCOf, ambientRelative, essenceLevelOf } from "./ambientQi.ts";
import { residueProcess } from "./residue.ts";

const who = "agent:1" as AgentId;
const clock = { day: 86400, year: 86400 * 360, moons: [] } as never;
const place = { hex: 0 } as never;

function truthAt(travelCell?: number): ReadonlyWorldTruth {
  return {
    get: (t: { name: string }) =>
      t.name === LOCATION.name
        ? { hex: 0 }
        : t.name === TRAVEL_CELL.name && travelCell !== undefined
          ? { cell: travelCell }
          : t.name === ENTITY.name
            ? { endedAt: undefined }
            : t.name === BODY_STATE.name
              ? { death: null }
              : undefined,
    ids: (t: { name: string }) => (t.name === PERSON.name ? [who] : []),
  } as unknown as ReadonlyWorldTruth;
}

describe("ambientes de qi", () => {
  it("solo el qi sobre la referencia se siente; el frío enfría y el bajo no toca", () => {
    expect(ambientQiC(relativeQi(50, 100), -1)).toBe(0);
    expect(ambientQiC(relativeQi(200, 100), -1)).toBeLessThan(0);
    expect(ambientQiC(relativeQi(200, 100), 1)).toBeGreaterThan(0);
    expect(ambientQiC(relativeQi(200, 100), 0)).toBe(0);
    const env = altitudeEnv(TEMPERATE, 0, 0, ambientQiC(1, -1));
    expect(env.radiantC).toBeLessThan(TEMPERATE.radiantC);
  });

  it("la absorción crece con el exceso y es menos pura; sin exceso, nada", () => {
    expect(ambientIntake(-0.5, 10, 5).essence).toBe(0);
    const a = ambientIntake(1, 10, 1);
    const b = ambientIntake(2, 10, 1);
    expect(b.essence).toBeGreaterThan(a.essence);
    expect(b.purity).toBeLessThan(a.purity);
  });

  it("lee el campo de la celda del parche o de la celda recorrida", () => {
    const levels = [100, 400];
    const a = { levelOf: essenceLevelOf(levels, 0), reference: 100, temper: () => -1 };
    expect(ambientRelative(a, truthAt(), who)).toBe(0);
    expect(ambientRelative(a, truthAt(1), who)).toBe(3);
    expect(ambientQiCOf(a, truthAt(1), who)).toBeLessThan(0);
    expect(ambientQiCOf(a, truthAt(), who)).toBe(0);
  });

  it("el proceso deja residuo y evento con causa en qi alto; con ledger entra por la fuente; es determinista", () => {
    const levels = [100, 400];
    const ambient = { levelOf: essenceLevelOf(levels, 0), reference: 100 };
    const ctx = (truth: ReadonlyWorldTruth) =>
      ({ now: 86400 * 10, window: 86400, truth, rng: Rng.root(7).fork("residue") }) as never;
    const p = residueProcess({ clock, placeOf: () => place, ambient, ledger: true });
    const high = p.run(ctx(truthAt(1)));
    expect(high.changes?.[0]).toMatchObject({ op: "set", table: RESIDUE.name });
    expect(high.events?.[0]?.kind).toBe("body.ambient_absorbed");
    expect(high.events?.[0]?.causes).toHaveLength(1);
    expect(high.postings?.[0]?.transfers[0]?.amount).toBeGreaterThan(0);
    expect(JSON.stringify(p.run(ctx(truthAt(1))))).toBe(JSON.stringify(high));
    // En el hogar (qi igual a la referencia) y sin la opción: sin filas ni eventos.
    expect(p.run(ctx(truthAt())).changes ?? []).toHaveLength(0);
    const off = residueProcess({ clock, placeOf: () => place });
    expect(off.run(ctx(truthAt(1)))).toEqual({});
  });
});
