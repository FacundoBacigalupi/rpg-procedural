import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type Event,
  type EventId,
  loadContent,
  type Tick,
} from "../../core/index.ts";
import {
  type ActionPlan,
  checkInvariants,
  ENTITY,
  KNOWN_DEEDS,
  LOCATION,
  notoriety,
  PERSON,
  rainBetween,
  TRACE,
  type Trace,
  traceStrength,
  traceVisible,
  worstDeed,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { offenseOf } from "./deeds.ts";
import { Life } from "./life.ts";
import { playerView } from "./view.ts";
import { living } from "./world.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

const strikePlan = (actor: AgentId, target: AgentId): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "strike", args: [{ role: "target", entity: target }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

/** El personaje le pega a un vecino de otra casa, con otros dos vecinos parados al lado. */
function assault(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const me = life.player;
  const home = w.truth.get(PERSON, me)?.household;
  const strangers = living(w.truth).filter((id) => w.truth.get(PERSON, id)?.household !== home);
  const target = strangers[0] as AgentId;
  const onlookers = strangers.slice(1, 3);
  const here = w.truth.get(LOCATION, me);
  if (here) for (const id of [target, ...onlookers]) w.truth.set(LOCATION, id, here);
  const report = life.turn(strikePlan(me, target), 1);
  return { life, w, me, target, onlookers, report };
}

const fakeEvent = (kind: string, actors: string[], data: unknown): Event =>
  ({
    id: "event:1" as EventId,
    tick: 0 as Tick,
    kind,
    actors,
    data,
    causes: [],
  }) as unknown as Event;

describe("qué es un delito", () => {
  it("agarrar lo que otro lleva encima es robo; lo del lugar, no", () => {
    const taken = (from: string) =>
      fakeEvent("action.take", ["agent:1"], {
        effect: { kind: "take", from, got: [{ unit: "good:grain", amount: 100 }] },
        noticedBy: [],
      });
    expect(offenseOf(taken("agent:2"))).toMatchObject({
      kind: "theft",
      by: "agent:1",
      victim: "agent:2",
    });
    expect(offenseOf(taken("place:3"))).toBeNull();
    expect(offenseOf(taken("agent:1"))).toBeNull();
  });

  it("sin nada en la mano no hubo robo, y una pelea es agresión de quien pegó primero", () => {
    expect(
      offenseOf(
        fakeEvent("action.take", ["agent:1"], {
          effect: { kind: "take", from: "agent:2", got: [] },
        }),
      ),
    ).toBeNull();
    expect(offenseOf(fakeEvent("combat.fight", ["agent:1", "agent:2"], {}))).toMatchObject({
      kind: "assault",
      by: "agent:1",
      victim: "agent:2",
    });
  });
});

describe("la aldea se entera de una pelea", () => {
  const run = assault(10);

  it("el golpeado sabe quién fue y la aldea sabe algo de él", () => {
    const deed = worstDeed(run.w.truth.get(KNOWN_DEEDS, run.target), run.me);
    expect(deed).toMatchObject({ kind: "assault", by: run.me, victim: run.target, via: "saw" });
    const knowers = living(run.w.truth)
      .filter((id) => id !== run.me)
      .map((id) => run.w.truth.get(KNOWN_DEEDS, id));
    expect(notoriety(knowers, run.me)).toBeGreaterThan(0);
  }, 120_000);

  it("lo que se sabe de oídas viene de una casa donde alguien lo vio u oyó y reconoció a quien fue", () => {
    const home = (id: AgentId) => run.w.truth.get(PERSON, id)?.household;
    for (const id of living(run.w.truth)) {
      for (const d of run.w.truth.get(KNOWN_DEEDS, id)?.deeds ?? []) {
        if (d.via !== "told") continue;
        const source = living(run.w.truth).some(
          (o) =>
            home(o) === home(id) &&
            run.w.truth
              .get(KNOWN_DEEDS, o)
              ?.deeds.some((x) => x.event === d.event && x.via !== "told" && x.by !== null),
        );
        expect(source).toBe(true);
      }
    }
  }, 120_000);

  it("deja sangre en el lugar con el evento de la pelea como origen, y se borra con las horas", () => {
    const fight = run.report.events.find((e) => e.kind === "combat.fight");
    const blood = run.w.truth.ids(TRACE).map((id) => ({ id, t: run.w.truth.get(TRACE, id) }));
    const hurt = blood.filter((b) => b.t?.event === fight?.id);
    expect(hurt.length).toBe(1);
    const trace = hurt[0]?.t;
    if (!trace || !hurt[0]) throw new Error("sin huella");
    expect(run.w.truth.get(ENTITY, hurt[0].id)?.originEventId).toBe(fight?.id);
    expect(traceStrength(trace, trace.made + 3 * 86_400)).toBeLessThan(trace.strength / 3);
  }, 120_000);

  it("conserva el ledger y es determinista", () => {
    expect(checkInvariants({ truth: run.w.truth, log: run.w.log, ledger: run.w.ledger })).toEqual(
      [],
    );
    expect(assault(10).life.hash()).toEqual(run.life.hash());
  }, 120_000);
});

describe("la lluvia lava la sangre de una pelea a la intemperie", () => {
  /** La pelea en el campo (sin `space`), con la mancha hecha `ago` segundos antes de «ahora». */
  function fightOutdoors(seed: number, ago: number) {
    const life = Life.create(seed, content);
    const w = life.world;
    const me = life.player;
    const home = w.truth.get(PERSON, me)?.household;
    const target = living(w.truth).find((id) => w.truth.get(PERSON, id)?.household !== home);
    const here = w.truth.get(LOCATION, me);
    if (!target || !here) throw new Error("sin vecino o sin lugar");
    const spot = { hex: here.hex };
    w.truth.set(LOCATION, me, spot);
    w.truth.set(LOCATION, target, spot);
    life.turn(strikePlan(me, target as AgentId), 1);
    const id = w.truth.ids(TRACE).find((t) => w.truth.get(TRACE, t)?.kind === "blood");
    const trace = id === undefined ? undefined : w.truth.get(TRACE, id);
    if (id === undefined || !trace) throw new Error("la pelea no dejó sangre");
    w.truth.set(TRACE, id, { ...trace, strength: 1, made: (w.scheduler.now - ago) as Tick });
    return { w, bloodSeen: () => playerView(w, []).scene.marks.some((m) => m.kind === "blood") };
  }

  /** Cuánto atrás hay que poner la mancha para que haya llovido encima y sin lluvia aún se vea. */
  function rainyAgo(seed: number): number {
    const probe = Life.create(seed, content).world;
    const now = probe.scheduler.now;
    const t = { kind: "blood", strength: 1, made: 0 as Tick, at: { hex: 0 } } as Trace;
    for (let h = 1; h <= 96; h++) {
      const ago = h * 3600;
      const made = (now - ago) as Tick;
      const rain = rainBetween(probe.map, probe.clock, probe.seed, made, now);
      if (traceVisible({ ...t, made }, now) && !traceVisible({ ...t, made }, now, rain)) return ago;
    }
    throw new Error("en esa seed no llovió lo suficiente en los primeros 4 días");
  }

  const SEED = 10;

  it("con la misma edad, la mancha de afuera se ve en seco y se borra si llovió encima", () => {
    const ago = rainyAgo(SEED);
    const dry = fightOutdoors(SEED, 0);
    expect(dry.bloodSeen()).toBe(true);
    expect(fightOutdoors(SEED, ago).bloodSeen()).toBe(false);
  }, 240_000);
});
