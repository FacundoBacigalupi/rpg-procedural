import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  ENTITY,
  LOCATION,
  type MoldRumor,
  type ProcessContext,
  type ReadonlyWorldTruth,
  WorldTruth,
} from "../../sim/index.ts";
import { NPC_DECISION } from "./decide.ts";
import {
  type PawnWantOptions,
  pawnAppraisal,
  pawnDistress,
  pawnWantMood,
  pawnWants,
} from "./pawn.ts";
import { PAWN_LOG, pawnDecideProcess } from "./pawndecide.ts";

const me = "agent:1" as AgentId;
const him = "agent:2" as AgentId;
const day = 86400;
const want: PawnWantOptions = {
  minDistress: 0.3,
  weight: 1,
  cash: "cobre",
  minValue: 50,
  valueOf: (u) => (u === "good:ring" ? 40 : undefined),
};
const has = (about: string, value: string, confidence: number) => ({
  rumor: { mold: "attr", about, attr: "has", value } as MoldRumor,
  confidence,
});
const pocket = [
  { unit: "good:ring", name: "anillo", amount: 2 },
  { unit: "good:copper", name: "cobre", amount: 5 },
];

describe("empeñar por decisión: parte pura", () => {
  it("sin apuro, sin lote valioso o sin rumor de efectivo no hay empeño", () => {
    const rumors = [has(him, "cobre", 0.8)];
    const known = new Set([him as string]);
    expect(pawnWants(0.1, pocket, rumors, known, want)).toEqual([]);
    expect(pawnWants(0.8, [{ ...pocket[0], amount: 1 } as never], rumors, known, want)).toEqual([]);
    expect(pawnWants(0.8, pocket, [has(him, "oro", 0.9)], known, want)).toEqual([]);
    expect(pawnWants(0.8, pocket, rumors, new Set(), want)).toEqual([]);
  });
  it("elige el lote creído valioso y al que cree con efectivo; el cobre no es prenda", () => {
    const w = pawnWants(0.8, pocket, [has(him, "cobre", 0.8)], new Set([him as string]), want);
    expect(w).toEqual([
      { broker: him, unit: "good:ring", name: "anillo", grams: 2, value: 80, confidence: 0.8 },
    ]);
    expect(pawnWantMood(0.5, 0.8, want)).toBe(0.4);
    expect(pawnDistress(0.2, 250, want)).toBe(1);
  });
  it("la tasación con error se desvía según el ojo y es determinista", () => {
    const truth = {} as ReadonlyWorldTruth;
    const blind = pawnAppraisal({ prices: { ring: 10 }, error: 0.5, eyeOf: () => 0 });
    const sharp = pawnAppraisal({ prices: { ring: 10 }, error: 0.5, eyeOf: () => 1 });
    expect(sharp(truth, him, "ring", 4, Rng.root(1))).toBe(40);
    const a = blind(truth, him, "ring", 4, Rng.root(1));
    expect(a).toBe(blind(truth, him, "ring", 4, Rng.root(1)));
    expect(a).not.toBe(40);
    expect(Math.abs(a - 40)).toBeLessThanOrEqual(20);
  });
});

function world(): WorldTruth {
  const t = new WorldTruth();
  for (const id of [me, him]) {
    t.set(
      ENTITY,
      id as EntityRef,
      { id, originEventId: "event:1" as EventId, createdAt: 0 } as never,
    );
    t.set(LOCATION, id as EntityRef, { hex: 3 } as never);
  }
  t.set(NPC_DECISION, me, {
    at: 100,
    id: `give:${him}+pawn:anillo`,
    verb: "give",
    target: him,
    utility: 1,
    options: 3,
  } as never);
  return t;
}
const proc = pawnDecideProcess({
  goods: [{ id: "ring", name: "anillo", form: "good" }] as never,
  day,
  player: "agent:99" as AgentId,
  placeOf: () => ({ kind: "cell", cell: "cell:1" }) as never,
});
const run = (t: WorldTruth, held: number) =>
  proc.run({
    now: 200,
    scope: me,
    truth: t,
    ledger: { balance: () => held },
    rng: Rng.root(1),
  } as unknown as ProcessContext);

describe("life.pawn_decide", () => {
  it("entrega el lote en prenda con el evento del verbo y pasa por el ledger", () => {
    const r = run(world(), 2);
    const ev = r.events?.[0];
    expect(ev?.kind).toBe("action.give");
    expect(ev?.actors).toEqual([me, him]);
    expect(ev?.data).toMatchObject({
      manner: ["pawn"],
      effect: { kind: "give", to: him, good: "good:ring", grams: 2 },
    });
    expect(ev?.causes.length).toBeGreaterThan(0);
    expect(r.postings?.[0]?.transfers[0]?.amount).toBe(2);
  });
  it("sin el lote, con otra decisión, lejos o ya intentado hoy, no hace nada", () => {
    expect(run(world(), 0)).toEqual({});
    const far = world();
    far.set(LOCATION, him as EntityRef, { hex: 9 } as never);
    expect(run(far, 2)).toEqual({});
    const done = world();
    done.set(PAWN_LOG, me, { at: 150 });
    expect(run(done, 2)).toEqual({});
    const other = world();
    other.set(NPC_DECISION, me, { at: 100, id: "gather:", verb: "gather" } as never);
    expect(run(other, 2)).toEqual({});
  });
});
