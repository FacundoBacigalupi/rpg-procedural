import { describe, expect, it } from "vitest";
import {
  type AgentId,
  externalAccount,
  type HolderRef,
  holderAccount,
  Ledger,
  ledgerUnit,
  Rng,
} from "../../core/index.ts";
import {
  BODY_STATE,
  ENTITY,
  pillOf,
  RESIDUE,
  type ReadonlyWorldTruth,
  receiveEssenceLot,
} from "../../sim/index.ts";
import {
  cultivationEfficiencyOf,
  ESSENCE_UNIT,
  RESIDUE_PURGED,
  residueExternals,
  residueProcess,
  takeEssence,
} from "./residue.ts";

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

  it("con ledger, el residuo es Essence del cuerpo: entra por la fuente y sale al sumidero", () => {
    const cfg = { ledger: true } as const;
    const unit = ledgerUnit(ESSENCE_UNIT);
    const ledger = new Ledger({ externals: residueExternals(cfg) });
    const account = holderAccount(who as unknown as HolderRef);
    const take = takeEssence(
      truthWith(),
      who,
      { essence: 10, purity: 0.5, good: "pill" },
      cfg,
      0,
      place,
      { kind: "event", event: "e:1" as never },
    );
    expect(take.postings).toHaveLength(1);
    ledger.post({
      tick: 0,
      eventId: "e:1" as never,
      transfers: [...(take.postings[0]?.transfers ?? [])],
    });
    expect(ledger.balance(account, unit)).toBe(5000);
    expect(ledger.total(unit)).toBe(5000);

    const p = residueProcess({ clock, placeOf: () => place, ...cfg });
    const r = p.run({
      now: 86400 * 10,
      window: 86400,
      truth: truthWith(5),
      ledger,
      rng: Rng.root(7).fork("residue"),
    } as never);
    const change = r.changes?.[0] as unknown as { value: { load: number } };
    const after = change.value.load;
    expect(r.events?.[0]?.kind).toBe("body.purged");
    for (const [i, post] of (r.postings ?? []).entries()) {
      ledger.post({ tick: 1, eventId: `e:${i + 2}` as never, transfers: [...post.transfers] });
    }
    expect(ledger.balance(account, unit)).toBe(Math.round(after * 1000));
    expect(ledger.balance(externalAccount(RESIDUE_PURGED), unit)).toBe(
      5000 - Math.round(after * 1000),
    );
  });

  it("sin ledger no hay asientos ni externals", () => {
    expect(residueExternals({})).toEqual({});
    const r = residueProcess({ clock, placeOf: () => place }).run({
      now: 86400 * 10,
      window: 86400,
      truth: truthWith(5),
      rng: Rng.root(7).fork("residue"),
    } as never);
    expect(r.postings).toBeUndefined();
  });

  it("la alquimia escribe esencia y pureza por lote; la calidad baja la pureza", () => {
    const spec = { essence: 2, purity: 0.9 };
    expect(pillOf(undefined, 1)).toBeUndefined();
    expect(pillOf(spec, 1)?.purity).toBeCloseTo(0.9);
    expect(pillOf(spec, 0)?.purity).toBeCloseTo(0.45);
    const lots = receiveEssenceLot(undefined, "good:pill", 0, 10, 2, 0.9);
    const mixed = receiveEssenceLot(lots, "good:pill", 10, 10, 4, 0.5);
    expect(mixed["good:pill"]?.essence).toBeCloseTo(3);
    expect(mixed["good:pill"]?.purity).toBeCloseTo((0.9 * 2 + 0.5 * 4) / 6);
  });
});
