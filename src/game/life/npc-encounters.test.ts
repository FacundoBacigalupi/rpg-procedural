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
  CROSSED_EVENT,
  MAX_CROSSINGS_PER_PASS,
  NPC_MET,
  npcEncountersProcess,
} from "./npc-encounters.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
import { living } from "./world.ts";

const me = makeId("agent", 1);
const player = makeId("agent", 99);
const site = { kind: "place", place: "place:1" as PlaceId } satisfies PlaceRef;
const agent = (n: number) => makeId("agent", n);

function world(others: { id: AgentId; hex: number; dead?: boolean }[], hex = 5) {
  const truth = new WorldTruth();
  const base = (id: AgentId, dead?: boolean): EntityBase => ({
    id,
    originEventId: makeId("event", 1),
    createdAt: 0,
    ...(dead ? { endedAt: 10 } : {}),
  });
  truth.set(ENTITY, me, base(me));
  truth.set(LOCATION, me, { hex });
  truth.set(NPC_JOURNEY, me, { place: "place:7", since: 100, decision: "d" });
  for (const o of others) {
    truth.set(ENTITY, o.id, base(o.id, o.dead));
    truth.set(LOCATION, o.id, { hex: o.hex });
  }
  return truth;
}

function run(truth: WorldTruth, who: AgentId = me): ProcessResult {
  return npcEncountersProcess({ player, placeOf: () => site }).run({
    now: 3600,
    window: 3600,
    windowIndex: 1,
    scope: who,
    resolution: "local",
    phase: "perceive",
    truth,
    ledger: undefined,
    rng: Rng.root(1),
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

describe("life.npc_encounters", () => {
  it("se cruza con quien comparte el hex, con causa en la posición de ambos", () => {
    const truth = world([
      { id: agent(2), hex: 5 },
      { id: agent(3), hex: 6 },
      { id: agent(4), hex: 5, dead: true },
    ]);
    const out = run(truth);
    expect(out.events).toHaveLength(1);
    expect(out.events?.[0]).toMatchObject({
      kind: CROSSED_EVENT,
      actors: [me, agent(2)],
      data: { hex: 5, journey: "place:7" },
      causes: [
        { kind: "state", entity: me, key: "location" },
        { kind: "state", entity: agent(2), key: "location" },
      ],
    });
  });

  it("no se cruza dos veces con la misma persona en el viaje; viaje nuevo, otra vez", () => {
    const truth = world([{ id: agent(2), hex: 5 }]);
    apply(truth, run(truth));
    expect(truth.get(NPC_MET, me)).toEqual({ since: 100, met: [agent(2)] });
    expect(run(truth)).toEqual({});
    truth.set(NPC_JOURNEY, me, { place: "place:7", since: 9000, decision: "d2" });
    expect(run(truth).events).toHaveLength(1);
  });

  it("sin viaje no hay cruce y el registro se limpia; el personaje no viaja por esto", () => {
    const truth = world([{ id: agent(2), hex: 5 }]);
    apply(truth, run(truth));
    truth.deleteRaw(NPC_JOURNEY.name, me);
    const out = run(truth);
    expect(out.events ?? []).toEqual([]);
    apply(truth, out);
    expect(truth.get(NPC_MET, me)).toBeUndefined();
    expect(run(world([{ id: agent(2), hex: 5 }]), player)).toEqual({});
  });

  it("una plaza llena no inunda: tope por pasada, el resto en la siguiente", () => {
    const crowd = Array.from({ length: MAX_CROSSINGS_PER_PASS + 2 }, (_, i) => ({
      id: agent(10 + i),
      hex: 5,
    }));
    const truth = world(crowd);
    const first = run(truth);
    expect(first.events).toHaveLength(MAX_CROSSINGS_PER_PASS);
    apply(truth, first);
    expect(run(truth).events).toHaveLength(2);
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
  it("el viajero se cruza con quien está parado en su hex y queda dicho", () => {
    const all = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(7, all, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcTransit: true,
      npcEncounters: true,
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
    // El personaje queda parado donde sale el viajero.
    w.truth.set(LOCATION, npc, { hex: from });
    w.truth.set(LOCATION, life.player, { hex: from });
    w.truth.set(NPC_DECISION, npc, {
      at: life.now,
      id: `move:${place}+toward:agent:99`,
      verb: "move",
      target: place,
      utility: 1,
      options: 2,
    } as never);
    life.advanceTo(life.now + 4 * 3600);
    const crossed = w.log.all().filter((e) => e.kind === CROSSED_EVENT && e.actors[0] === npc);
    expect(crossed.some((e) => e.actors[1] === life.player)).toBe(true);
    expect(crossed.filter((e) => e.actors[1] === life.player)).toHaveLength(1);
  }, 240_000);
});
