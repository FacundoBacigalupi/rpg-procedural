import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityBase,
  loadContent,
  makeId,
  type PlaceId,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  ENTITY,
  hexPath,
  LOCATION,
  PERSON,
  PLACE,
  type ProcessContext,
  type ProcessResult,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import {
  CAMP_HOURS,
  NPC_TRACES,
  NPC_TRAIL,
  npcTracesProcess,
  TRACE_SEEN_EVENT,
  TRAIL_KEEP_HOURS,
  traceKind,
} from "./npc-traces.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
import { living } from "./world.ts";

const HOUR = 3600;
const me = makeId("agent", 1);
const other = makeId("agent", 2);
const player = makeId("agent", 99);
const site = { kind: "place", place: "place:1" as PlaceId } satisfies PlaceRef;

function world(opts: {
  trail?: { from: number; last: number };
  otherHex?: number;
  trip?: boolean;
}) {
  const truth = new WorldTruth();
  const base = (id: AgentId): EntityBase => ({
    id,
    originEventId: makeId("event", 1),
    createdAt: 0,
  });
  for (const id of [me, other]) truth.set(ENTITY, id, base(id));
  truth.set(LOCATION, me, { hex: 5 });
  truth.set(LOCATION, other, { hex: opts.otherHex ?? 6 });
  if (opts.trip !== false) {
    truth.set(NPC_JOURNEY, me, { place: "place:7", since: 100, decision: "d" });
  }
  if (opts.trail) truth.set(NPC_TRAIL, other, { steps: [{ hex: 5, ...opts.trail }] });
  return truth;
}

function run(truth: WorldTruth, now: number, who: AgentId = me, seed = 1): ProcessResult {
  return npcTracesProcess({ player, placeOf: () => site }).run({
    now,
    window: HOUR,
    windowIndex: 1,
    scope: who,
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

/** Una semilla donde la tirada de notar sale (o no), para fijar el caso. */
function seedWhere(notice: boolean): number {
  for (let s = 1; s < 200; s++) {
    const t = world({ trail: { from: 0, last: 0 } });
    const out = run(t, 10 * HOUR, me, s);
    if ((out.events?.length ?? 0) > 0 === notice) return s;
  }
  throw new Error("sin semilla");
}

describe("life.npc_traces", () => {
  it("quien viaja deja su paso: tramo continuo por hex, y lo viejo se olvida", () => {
    const truth = world({});
    apply(truth, run(truth, 1000));
    apply(truth, run(truth, 1000 + HOUR));
    expect(truth.get(NPC_TRAIL, me)?.steps).toEqual([{ hex: 5, from: 1000, last: 1000 + HOUR }]);
    truth.set(LOCATION, me, { hex: 6 });
    apply(truth, run(truth, 1000 + 2 * HOUR));
    expect(truth.get(NPC_TRAIL, me)?.steps).toHaveLength(2);
    apply(truth, run(truth, 1000 + (TRAIL_KEEP_HOURS + 5) * HOUR));
    expect(truth.get(NPC_TRAIL, me)?.steps.map((s) => s.hex)).toEqual([6]);
  });

  it("quien pasó y ya no está se nota como creencia, sin saber quién y con la edad estimada", () => {
    const seed = seedWhere(true);
    const truth = world({ trail: { from: 0, last: 0 } });
    const out = run(truth, 10 * HOUR, me, seed);
    expect(out.events).toHaveLength(1);
    expect(out.events?.[0]).toMatchObject({
      kind: TRACE_SEEN_EVENT,
      actors: [me],
      data: { hex: 5, trace: "footprints" },
    });
    apply(truth, out);
    const book = truth.get(NPC_TRACES, me);
    expect(book?.seen).toHaveLength(1);
    expect(book?.seen[0]).not.toHaveProperty("who");
    expect(JSON.stringify(book)).not.toContain(other);
    expect(book?.seen[0]?.estAgeHours).toBeGreaterThanOrEqual(1);
    expect(book?.seen[0]?.estAgeHours).not.toBe(0);
    // Una sola mirada por rastro.
    expect(run(truth, 11 * HOUR, me, seed).events ?? []).toEqual([]);
  });

  it("mirar y no notar también cuenta como mirada; sin rastro de otro no hay nada", () => {
    const seed = seedWhere(false);
    const truth = world({ trail: { from: 0, last: 0 } });
    const out = run(truth, 10 * HOUR, me, seed);
    expect(out.events ?? []).toEqual([]);
    apply(truth, out);
    expect(truth.get(NPC_TRACES, me)?.looked).toEqual(["5:0"]);
    expect(truth.get(NPC_TRACES, me)?.seen).toEqual([]);
    const none = world({});
    apply(none, run(none, 10 * HOUR));
    expect(none.get(NPC_TRACES, me)).toBeUndefined();
  });

  it("quien sigue ahí es un encuentro, no un rastro; lo recién pasado tampoco", () => {
    const here = world({ trail: { from: 0, last: 9 * HOUR }, otherHex: 5 });
    expect(run(here, 10 * HOUR).events ?? []).toEqual([]);
    const fresh = world({ trail: { from: 9 * HOUR, last: 9 * HOUR + 1800 } });
    expect(run(fresh, 10 * HOUR).events ?? []).toEqual([]);
  });

  it("la noche en un hex deja resto de fogata", () => {
    expect(traceKind({ hex: 5, from: 0, last: CAMP_HOURS * HOUR })).toBe("campfire");
    expect(traceKind({ hex: 5, from: 0, last: HOUR })).toBe("footprints");
  });

  it("sin viaje la libreta se limpia, el personaje no deja ni nota, y es determinista", () => {
    const truth = world({ trail: { from: 0, last: 0 } });
    truth.set(NPC_TRACES, me, { since: 100, looked: [], seen: [] });
    truth.deleteRaw(NPC_JOURNEY.name, me);
    apply(truth, run(truth, 10 * HOUR));
    expect(truth.get(NPC_TRACES, me)).toBeUndefined();
    expect(run(world({ trail: { from: 0, last: 0 } }), 10 * HOUR, player)).toEqual({});
    const seed = seedWhere(true);
    const a = run(world({ trail: { from: 0, last: 0 } }), 10 * HOUR, me, seed);
    const b = run(world({ trail: { from: 0, last: 0 } }), 10 * HOUR, me, seed);
    expect(a).toEqual(b);
  });
});

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("en una vida con el proceso encendido", () => {
  it("el viajero deja su rastro en el camino, determinista", () => {
    const all = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const trail = () => {
      const life = Life.create(7, all, {
        npcVerbs: ["move"],
        npcJourneyDays: 6,
        npcTransit: true,
        npcEncounters: true,
        npcTraces: true,
      });
      const w = life.world;
      const npc = living(w.truth).find(
        (x) =>
          x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
      ) as AgentId;
      const place = w.truth.ids(PLACE)[0] as string;
      const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
      let from = hexes[0] as number;
      for (let i = 0; i < 4; i++) {
        from =
          (w.map.neighbors[from] ?? []).find(
            (n) => !hexes.includes(n) && hexPath(w.map, n, hexes[0] as number).length > i,
          ) ?? from;
      }
      w.truth.set(LOCATION, npc, { hex: from });
      w.truth.set(NPC_DECISION, npc, {
        at: life.now,
        id: `move:${place}+toward:agent:99`,
        verb: "move",
        target: place,
        utility: 1,
        options: 2,
      } as never);
      life.advanceTo(life.now + 4 * 3600);
      return JSON.stringify(w.truth.get(NPC_TRAIL, npc));
    };
    const a = trail();
    expect(a).toContain('"hex"');
    expect(trail()).toBe(a);
  }, 240_000);
});
