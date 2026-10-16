import { describe, expect, it } from "vitest";
import {
  type AgentId,
  EventLog,
  IdAllocator,
  makeId,
  type SettlementId,
} from "../../core/index.ts";
import { COMMUNITY_ACCENT, ENTITY, PLACE, WorldTruth } from "../../sim/index.ts";
import { personNative } from "./npc-greeting-speech.ts";
import { languagesOf, originOf, PERSON_ORIGIN } from "./person-origin.ts";
import {
  arriveFrom,
  immersionLevel,
  seedNeighborCommunities,
  seedPlayerOrigin,
} from "./seed-origins.ts";

const village = makeId("settlement", 1) as SettlementId;
const founders = makeId("event", 1);
const place = { kind: "settlement", settlement: village } as const;
const walker = makeId("agent", 7) as AgentId;

function world(count: number) {
  const truth = new WorldTruth();
  const ids = new IdAllocator({ settlement: 2, event: 2 });
  const log = new EventLog();
  log.append({
    id: founders,
    tick: 0,
    kind: "settlement.founded",
    actors: [],
    place,
    data: {},
    emissions: null,
    causes: [{ kind: "seed" }],
    resolution: "history",
  } as never);
  truth.set(PLACE, village, { kind: "village", hexes: [0] } as never);
  const base = { seed: 7, place, now: 0, foundersEvent: founders, language: "village.hills" };
  const home = seedNeighborCommunities(truth, ids, log, { ...base, count: 1 });
  // La aldea misma, sembrada como en create.ts, a modo de comparación.
  truth.set(
    COMMUNITY_ACCENT,
    village,
    truth.get(COMMUNITY_ACCENT, home[0] as SettlementId) as never,
  );
  const neighbors = seedNeighborCommunities(truth, ids, log, { ...base, count });
  return { truth, neighbors, log };
}

describe("seed-origins", () => {
  it("siembra vecinas con ficha, acento propio y eventos; es determinista", () => {
    const a = world(2);
    const b = world(2);
    expect(a.neighbors).toHaveLength(2);
    for (const n of a.neighbors) {
      expect(a.truth.has(ENTITY, n)).toBe(true);
      expect(a.truth.get(COMMUNITY_ACCENT, n)?.language).toBe("village.hills");
    }
    expect(a.truth.get(COMMUNITY_ACCENT, a.neighbors[0] as SettlementId)?.accent).not.toEqual(
      a.truth.get(COMMUNITY_ACCENT, a.neighbors[1] as SettlementId)?.accent,
    );
    expect(a.truth.rows()).toEqual(b.truth.rows());
  });

  it("count 0 no siembra nada", () => {
    const { truth, neighbors } = world(0);
    expect(neighbors).toEqual([]);
    expect(truth.ids(PERSON_ORIGIN)).toEqual([]);
  });

  it("quien llega de una vecina tiene su fila y su acento nativo", () => {
    const { truth, neighbors } = world(2);
    const from = neighbors[1] as SettlementId;
    expect(arriveFrom(truth, walker, from, village, 3)).toBe(true);
    expect(originOf(truth, walker)).toBe(from);
    expect(personNative(truth, walker)?.accent).toEqual(truth.get(COMMUNITY_ACCENT, from)?.accent);
    expect(languagesOf(truth, walker)).toEqual([{ language: "village.hills", level: 1 }]);
  });

  it("sin acento sembrado no inventa un origen", () => {
    const { truth } = world(1);
    expect(arriveFrom(truth, walker, makeId("settlement", 99) as SettlementId, village, 1)).toBe(
      false,
    );
    expect(truth.has(PERSON_ORIGIN, walker)).toBe(false);
  });

  it("el nivel por inmersión crece con los años y tiene techo", () => {
    expect(immersionLevel(0)).toBe(0);
    expect(immersionLevel(3)).toBeCloseTo(0.45);
    expect(immersionLevel(60)).toBe(0.9);
  });

  it("el personaje: nacer o entrar a una edad no deja fila; llegar sí", () => {
    const { truth, neighbors } = world(1);
    expect(seedPlayerOrigin(truth, walker, { kind: "born" }, neighbors, village)).toBe(false);
    expect(seedPlayerOrigin(truth, walker, { kind: "age" }, neighbors, village)).toBe(false);
    expect(truth.has(PERSON_ORIGIN, walker)).toBe(false);
    expect(
      seedPlayerOrigin(
        truth,
        walker,
        { kind: "arrived", from: 0, yearsHere: 1 },
        neighbors,
        village,
      ),
    ).toBe(true);
    expect(originOf(truth, walker)).toBe(neighbors[0]);
    expect(
      seedPlayerOrigin(
        truth,
        walker,
        { kind: "arrived", from: 5, yearsHere: 1 },
        neighbors,
        village,
      ),
    ).toBe(false);
  });
});
