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
  TRACE,
  traceStrength,
  worstDeed,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { offenseOf } from "./deeds.ts";
import { Life } from "./life.ts";
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
