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
  type ProcessContext,
  type ProcessResult,
  WorldTruth,
} from "../../sim/index.ts";
import { NPC_MET } from "./npc-encounters.ts";
import { NPC_TRACES } from "./npc-traces.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
import {
  MAX_HEARD,
  NPC_HEARD,
  npcWarningsProcess,
  TELL_CHANCE,
  WARNED_EVENT,
} from "./npc-warnings.ts";

const me = makeId("agent", 1);
const other = makeId("agent", 2);
const player = makeId("agent", 99);
const site = { kind: "place", place: "place:1" as PlaceId } satisfies PlaceRef;

function world(opts: { otherHex?: number; met?: boolean; seen?: number } = {}) {
  const truth = new WorldTruth();
  const base = (id: AgentId): EntityBase => ({
    id,
    originEventId: makeId("event", 1),
    createdAt: 0,
  });
  for (const id of [me, other]) {
    truth.set(ENTITY, id, base(id));
    truth.set(LOCATION, id, { hex: id === me ? 5 : (opts.otherHex ?? 5) });
  }
  truth.set(NPC_JOURNEY, me, { place: "place:7", since: 100, decision: "d" });
  if (opts.met !== false) truth.set(NPC_MET, me, { since: 100, met: [other] });
  truth.set(NPC_TRACES, other, {
    since: 50,
    looked: [],
    seen: Array.from({ length: opts.seen ?? 2 }, (_, i) => ({
      hex: 40 + i,
      kind: "footprints" as const,
      estAgeHours: 6 + i,
      at: 10,
    })),
  });
  return truth;
}

function run(truth: WorldTruth, now = 3600, seed = 1): ProcessResult {
  return npcWarningsProcess({ player, placeOf: () => site }).run({
    now,
    window: 3600,
    windowIndex: 1,
    scope: me,
    resolution: "local",
    phase: "perceive",
    truth,
    ledger: undefined,
    rng: Rng.root(seed),
    item: undefined,
    recent: [],
    newId() {
      throw new Error("no crea entidades");
    },
  } as unknown as ProcessContext);
}

function apply(truth: WorldTruth, out: ProcessResult) {
  for (const c of out.changes ?? []) {
    if (c.op === "delete") truth.deleteRaw(c.table, c.id);
    else if (c.op === "set") truth.setRaw(c.table, c.id, c.value);
  }
}

/** Primer instante en que la tirada de contar sale, para no depender de un seed afortunado. */
function tellingTime(): number {
  for (let h = 1; h < 200; h++) {
    if (run(world(), h * 3600).events?.length) return h * 3600;
  }
  throw new Error("nunca cuenta");
}

describe("life.npc_warnings", () => {
  it("quien vio rastros se los cuenta al que tiene al lado, como oídas con su origen", () => {
    const truth = world();
    const now = tellingTime();
    const out = run(truth, now);
    expect(out.events?.[0]).toMatchObject({
      kind: WARNED_EVENT,
      actors: [other, me],
      data: { hex: 5, told: 2 },
      causes: [{ kind: "state", entity: other, key: "life.npc_traces" }],
    });
    apply(truth, out);
    const book = truth.get(NPC_HEARD, me);
    expect(book?.told).toEqual([other]);
    expect(book?.heard.map((h) => [h.hex, h.from])).toEqual([
      [40, other],
      [41, other],
    ]);
    // No toca su propio libro de rastros ni el del otro.
    expect(truth.get(NPC_TRACES, me)).toBeUndefined();
  });

  it("una sola vez por persona y viaje; viaje nuevo, otra vez", () => {
    const truth = world();
    const now = tellingTime();
    apply(truth, run(truth, now));
    for (let h = 1; h < 50; h++) expect(run(truth, now + h * 3600).events ?? []).toEqual([]);
    truth.set(NPC_JOURNEY, me, { place: "place:7", since: 9000, decision: "d2" });
    truth.set(NPC_MET, me, { since: 9000, met: [other] });
    let again = false;
    for (let h = 1; h < 200 && !again; h++) again = (run(truth, h * 3600).events ?? []).length > 0;
    expect(again).toBe(true);
  });

  it("si ya no están en el mismo hex, o no se cruzaron, o no vio nada, no cuenta", () => {
    for (let h = 1; h < 60; h++) {
      expect(run(world({ otherHex: 6 }), h * 3600)).toEqual({});
      expect(run(world({ met: false }), h * 3600)).toEqual({});
      expect(run(world({ seen: 0 }), h * 3600)).toEqual({});
    }
  });

  it("la tirada es determinista y cuenta cerca de TELL_CHANCE de las veces", () => {
    let n = 0;
    const total = 400;
    for (let h = 1; h <= total; h++) {
      const a = run(world(), h * 3600);
      expect(run(world(), h * 3600)).toEqual(a);
      if (a.events?.length) n++;
    }
    expect(Math.abs(n / total - TELL_CHANCE)).toBeLessThan(0.1);
  });

  it("lo que guarda de oídas tiene tope, y el viaje terminado limpia el libro", () => {
    const truth = world({ seen: MAX_HEARD + 4 });
    apply(truth, run(truth, tellingTime()));
    expect((truth.get(NPC_HEARD, me)?.heard.length ?? 0) <= MAX_HEARD).toBe(true);
    truth.deleteRaw(NPC_JOURNEY.name, me);
    apply(truth, run(truth));
    expect(truth.get(NPC_HEARD, me)).toBeUndefined();
  });
});
