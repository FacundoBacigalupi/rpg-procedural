import { describe, expect, it } from "vitest";
import {
  type CauseRef,
  type EntityBase,
  type EntityRef,
  type Event,
  EventLog,
  externalAccount,
  holderAccount,
  Ledger,
  ledgerUnit,
  makeId,
} from "../../core/index.ts";
import { checkInvariants, ENTITY, table, WorldTruth } from "./index.ts";

const E = (n: number) => makeId("event", n);
const A1 = makeId("agent", 1);
const A2 = makeId("agent", 2);
const S1 = makeId("settlement", 1);
const COIN = ledgerUnit("coin");
const MINT = externalAccount("mint");
const BODY = table<{ hp: number }>("body");

function ev(n: number, tick: number, causes: CauseRef[], actors: EntityRef[] = [A1]): Event {
  return {
    id: E(n),
    tick,
    kind: "test",
    actors,
    place: { kind: "settlement", settlement: S1 },
    data: null,
    emissions: {},
    causes,
    resolution: "local",
  };
}

/** Un mundo sano: la génesis crea la aldea, un nacimiento crea a A1, que cobra una moneda. */
function healthy() {
  const log = EventLog.from([
    ev(1, 0, [{ kind: "seed" }], []),
    ev(2, 10, [{ kind: "state", entity: S1, key: "population" }], [S1]),
    ev(3, 20, [{ kind: "event", event: E(2) }]),
  ]);
  const truth = new WorldTruth();
  truth.set(ENTITY, S1, { id: S1, originEventId: E(1), createdAt: 0 });
  truth.set(ENTITY, A1, { id: A1, originEventId: E(2), createdAt: 10 });
  truth.set(BODY, A1, { hp: 3 });
  const ledger = new Ledger({ externals: { mint: ["coin"] } });
  ledger.post({
    tick: 20,
    eventId: E(3),
    transfers: [{ unit: COIN, from: MINT, to: holderAccount(A1), amount: 5 }],
  });
  return { truth, log, ledger };
}

describe("checkInvariants", () => {
  it("un mundo sano no tiene violaciones", () => {
    expect(checkInvariants(healthy())).toEqual([]);
  });

  it("detecta una entidad huérfana", () => {
    const w = healthy();
    w.truth.set(ENTITY, A2, { id: A2, originEventId: E(99), createdAt: 10 });
    expect(checkInvariants(w)).toEqual([expect.stringContaining("huérfana")]);
  });

  it("detecta una ficha creada en otro tick que su origen, o con id ajeno", () => {
    const w = healthy();
    w.truth.set(ENTITY, A2, { id: A1, originEventId: E(2), createdAt: 11 });
    expect(checkInvariants(w)).toHaveLength(2);
  });

  it("detecta componentes sin ficha", () => {
    const w = healthy();
    w.truth.set(BODY, A2, { hp: 1 });
    expect(checkInvariants(w)).toEqual([expect.stringContaining("body/agent:2")]);
  });

  it("revisa el fin de una entidad", () => {
    const end = (over: Partial<EntityBase>) => {
      const w = healthy();
      w.truth.set(ENTITY, A1, { id: A1, originEventId: E(2), createdAt: 10, ...over });
      return checkInvariants(w);
    };
    expect(end({ endedAt: 20, endEventId: E(3) })).toEqual([]);
    expect(end({ endedAt: 20 })).toHaveLength(1);
    expect(end({ endedAt: 21, endEventId: E(3) })).toHaveLength(1);
    expect(end({ endedAt: 20, endEventId: E(7) })).toHaveLength(1);
  });

  it("detecta actores y causas de estado que no existen o todavía no existían", () => {
    const w = healthy();
    w.log.append(ev(4, 30, [{ kind: "state", entity: A2, key: "mind" }], [A2]));
    expect(checkInvariants(w)).toHaveLength(2);
    const v = healthy();
    v.truth.set(ENTITY, A2, { id: A2, originEventId: E(3), createdAt: 20 });
    v.log.append(ev(4, 15, [{ kind: "seed" }], [A2]));
    expect(checkInvariants(v)).toEqual([expect.stringContaining("todavía no existía")]);
  });

  it("detecta asientos sin su evento", () => {
    const w = healthy();
    w.ledger.post({
      tick: 20,
      eventId: E(8),
      transfers: [{ unit: COIN, from: holderAccount(A1), to: MINT, amount: 1 }],
    });
    w.ledger.post({
      tick: 21,
      eventId: E(3),
      transfers: [{ unit: COIN, from: holderAccount(A1), to: MINT, amount: 1 }],
    });
    expect(checkInvariants(w)).toHaveLength(2);
  });
});
