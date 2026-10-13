// perfil3-idle-scopes: la guardia de alcance de cada proceso solo descarta lo que `run` dejaba
// en `{}` (equivalencia), y las guardias dicen que sí cuando hay algo que hacer.
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type EntityBase,
  makeId,
  type PlaceId,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  ENTITY,
  LOCATION,
  PERSON,
  type ProcessContext,
  type ProcessDef,
  WorldTruth,
} from "../../sim/index.ts";
import { NPC_MET, npcEncountersProcess } from "./npc-encounters.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
import { pitchProcess } from "./pitch.ts";
import { transitProcess } from "./transit.ts";
import { TRANSIT } from "./transit-state.ts";

const me = makeId("agent", 1);
const other = makeId("agent", 2);
const player = makeId("agent", 99);
const site = { kind: "place", place: "place:1" as PlaceId } satisfies PlaceRef;

function base(id: AgentId): EntityBase {
  return { id, originEventId: makeId("event", 1), createdAt: 0 };
}

function ctx(truth: WorldTruth, scope: AgentId): ProcessContext {
  return {
    now: 1000,
    window: 3600,
    windowIndex: 1,
    scope,
    resolution: "local",
    phase: "decide",
    truth,
    ledger: undefined,
    rng: Rng.root(1).fork("t"),
    item: undefined,
    recent: [],
    newId: () => {
      throw new Error("no");
    },
  };
}

const map = { crossSeconds: [10, 10, 10], cell: 0 } as never;
const pitchDef = (): ProcessDef =>
  pitchProcess({
    catalog: { verb: () => undefined } as never,
    goods: [],
    lines: [],
    player,
    day: 86400,
    placeOf: () => site,
  });

function world(extra: (t: WorldTruth) => void) {
  const t = new WorldTruth();
  for (const id of [me, other, player]) t.set(ENTITY, id, base(id));
  t.set(LOCATION, me, { hex: 5 });
  t.set(LOCATION, other, { hex: 5 });
  t.set(LOCATION, player, { hex: 9 });
  extra(t);
  return t;
}

describe("guardias de alcance ociosas", () => {
  it("transit: sin viaje ni registro no corre (y su run daba {}); con cualquiera de los dos, sí", () => {
    const def = transitProcess({ map, player });
    const idle = world(() => {});
    expect(def.scopeGuard?.(idle, me)).toBe(false);
    expect(def.run(ctx(idle, me))).toEqual({});
    const trip = world((t) =>
      t.set(NPC_JOURNEY, me, { place: "place:7", since: 1, decision: "d" }),
    );
    expect(def.scopeGuard?.(trip, me)).toBe(true);
    const rec = world((t) => t.set(TRANSIT, me, { seen: 5, at: 1 }));
    expect(def.scopeGuard?.(rec, me)).toBe(true);
    expect(def.run(ctx(rec, me)).changes?.length).toBeGreaterThan(0);
  });

  it("encuentros: sin viaje ni libreta no corre (y su run daba {}); la libreta sola se limpia", () => {
    const def = npcEncountersProcess({ player, placeOf: () => site });
    const idle = world(() => {});
    expect(def.scopeGuard?.(idle, me)).toBe(false);
    expect(def.run(ctx(idle, me))).toEqual({});
    const book = world((t) => t.set(NPC_MET, me, { since: 1, met: [] }));
    expect(def.scopeGuard?.(book, me)).toBe(true);
    expect(def.run(ctx(book, me)).changes?.length).toBe(1);
    const trip = world((t) =>
      t.set(NPC_JOURNEY, me, { place: "place:7", since: 1, decision: "d" }),
    );
    expect(def.scopeGuard?.(trip, me)).toBe(true);
  });

  it("pitch: solo quien comparte hex y espacio con el personaje; los demás daban {}", () => {
    const def = pitchDef();
    const apart = world((t) => t.set(PERSON, me, { household: "household:1" } as never));
    expect(def.scopeGuard?.(apart, me)).toBe(false);
    expect(def.run(ctx(apart, me))).toEqual({});
    const together = world((t) => t.set(LOCATION, me, { hex: 9 }));
    expect(def.scopeGuard?.(together, me)).toBe(true);
    const otherSpace = world((t) => {
      t.set(LOCATION, me, { hex: 9, space: "space:1" as never });
    });
    expect(def.scopeGuard?.(otherSpace, me)).toBe(false);
  });
});
