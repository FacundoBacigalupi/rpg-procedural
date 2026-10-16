import { describe, expect, it } from "vitest";
import {
  type Event,
  type EventId,
  externalAccount,
  type HolderRef,
  holderAccount,
  Ledger,
  ledgerUnit,
  makeId,
  Rng,
  type Tick,
} from "../../core/index.ts";
import { ENTITY, PERSON, type SchemerView, WorldTruth } from "../../sim/index.ts";
import { offenseOf } from "./deeds.ts";
import { type SchemeSeed, type SchemeTraces, schemesProcess } from "./schemes.ts";

const a = (n: number) => makeId("agent", n);
const COIN = ledgerUnit("coin:copper");
const H = (h: string) => holderAccount(h as unknown as HolderRef);

const greedy: SchemerView = {
  motiveStrength: 1,
  motive: "greed",
  boldness: 1,
  warmth: 0,
  honor: 0,
  fear: 0,
  intellect: 0.5,
  believedTargetStrength: 0,
  believedLoot: 1,
  believedWitnesses: 0,
  affinity: 0,
};
const seed: SchemeSeed = {
  key: "s1",
  owner: a(1),
  target: a(2),
  motive: "greed",
  origin: makeId("event", 5),
  startDay: 0,
};

function robbery(traces?: SchemeTraces) {
  const truth = new WorldTruth();
  for (const n of [1, 2]) {
    truth.set(ENTITY, a(n), { id: a(n), originEventId: makeId("event", 1), createdAt: 0 } as never);
    truth.set(PERSON, a(n), { household: `h${n}` } as never);
  }
  const ledger = new Ledger({ externals: { seed: [COIN] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [{ unit: COIN, from: externalAccount("seed"), to: H("h2"), amount: 100 }],
  });
  const p = schemesProcess({
    seeds: [seed],
    view: () => greedy,
    placeOf: () => ({ kind: "cell" }) as never,
    day: 10,
    loot: { unit: COIN, fraction: 0.5 },
    ...(traces ? { traces } : {}),
  });
  let n = 100;
  let recent: { id: unknown; kind: string }[] = [];
  const steps: Event[] = [];
  for (let d = 0; d < 12; d++) {
    let sn = 0;
    const r = p.run({
      truth,
      ledger,
      now: d * 10,
      recent,
      rng: Rng.root(7),
      newId: () => makeId("scheme", ++sn),
    } as never);
    for (const c of r.changes ?? []) {
      const x = c as unknown as { table: string; id: never; value: unknown };
      truth.setRaw(x.table, x.id, x.value);
    }
    const ids = (r.events ?? []).map(() => makeId("event", ++n));
    recent = (r.events ?? []).map((e, i) => ({ ...e, id: ids[i] }) as never);
    for (const po of r.postings ?? []) {
      const i = Number(String(po.event).replace("event:~", ""));
      ledger.post({ tick: d * 10, eventId: ids[i] as EventId, transfers: po.transfers });
    }
    for (const [i, e] of (r.events ?? []).entries())
      if (e.kind === "scheme.step")
        steps.push({ ...e, id: ids[i] as EventId, tick: (d * 10) as Tick } as unknown as Event);
  }
  return steps;
}

describe("life.schemes: huellas del robo (F1b-2b-3)", () => {
  it("sin traces ningun paso emite nada (nadie lo ve)", () => {
    for (const s of robbery()) expect(s.emissions).toEqual({});
  });

  it("con traces solo el take que se llevo algo emite, y deeds lo lee como robo", () => {
    const steps = robbery({ sight: 0.6, sound: 0.2 });
    const loud = steps.filter((s) => (s.emissions as { sight?: number }).sight !== undefined);
    expect(loud).toHaveLength(1);
    const take = loud[0] as Event;
    expect((take.data as { stepKind: string }).stepKind).toBe("take");
    expect(take.emissions).toEqual({ sight: 0.6, sound: 0.2 });
    expect(offenseOf(take)).toMatchObject({ kind: "theft", by: a(1), victim: a(2), noticedBy: [] });
    for (const s of steps.filter((x) => x !== take)) expect(offenseOf(s)).toBeNull();
  });

  it("el blanco nota la falta solo con notice, y deeds lo anota sin saber quien fue", () => {
    const t = { sight: 0.6, sound: 0.2 };
    const none = robbery(t).find((s) => (s.data as { taken?: number }).taken);
    expect(((none as Event).data as { missed?: boolean }).missed).toBeUndefined();
    expect(offenseOf(none as Event)?.missedBy).toBeUndefined();
    const sure = robbery({ ...t, notice: 1 }).find((s) => (s.data as { taken?: number }).taken);
    expect(((sure as Event).data as { missed?: boolean }).missed).toBe(true);
    expect(offenseOf(sure as Event)).toMatchObject({ kind: "theft", missedBy: [a(2)] });
    const never = robbery({ ...t, notice: 0 }).find((s) => (s.data as { taken?: number }).taken);
    expect(((never as Event).data as { missed?: boolean }).missed).toBeUndefined();
    expect((sure as Event).emissions).toEqual({ sight: 0.6, sound: 0.2 });
  });

  it("es determinista", () => {
    const t = { sight: 0.6, sound: 0.2 };
    expect(JSON.stringify(robbery(t))).toBe(JSON.stringify(robbery(t)));
  });
});
