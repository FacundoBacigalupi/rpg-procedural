import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  atMercyOf,
  BODY_STATE,
  checkInvariants,
  LOCATION,
  PERSON,
  YIELD_WINDOW,
  YIELDED,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { offenseOf } from "./deeds.ts";
import { FIGHT_STATE, livePause, PAUSE_WINDOW } from "./fight.ts";
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

/** Una pelea del personaje contra alguien de su casa, parados en el mismo lugar. */
function brawl(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const me = life.player;
  const house = w.truth.get(PERSON, me)?.household;
  const other = living(w.truth).find(
    (id) => id !== me && w.truth.get(PERSON, id)?.household === house,
  ) as AgentId;
  const here = w.truth.get(LOCATION, me);
  if (here) w.truth.set(LOCATION, other, here);
  const report = life.turn(strikePlan(me, other), 1);
  return { life, w, me, other, report };
}

describe("el golpe del personaje es una pelea", () => {
  const run = brawl(3);

  it("deja el evento de la pelea con causa en el golpe, heridas a los dos lados y el ledger sano", () => {
    const fight = run.report.events.find((e) => e.kind === "combat.fight");
    expect(fight).toBeDefined();
    expect(fight?.actors).toEqual([run.me, run.other]);
    const strike = run.report.events.find((e) => e.kind === "action.strike");
    expect(fight?.causes).toEqual([{ kind: "event", event: strike?.id }]);
    const hurt = [run.me, run.other].map(
      (id) => run.w.truth.get(BODY_STATE, id)?.wounds.length ?? 0,
    );
    expect((hurt[0] ?? 0) + (hurt[1] ?? 0)).toBeGreaterThan(0);
    expect(run.report.to - run.report.from).toBeGreaterThan(1);
    expect(checkInvariants({ truth: run.w.truth, log: run.w.log, ledger: run.w.ledger })).toEqual(
      [],
    );
  }, 120_000);

  it("es determinista", () => {
    expect(brawl(3).life.hash()).toEqual(run.life.hash());
  }, 120_000);
});

const sparePlan = (actor: AgentId, target: AgentId): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "spare", args: [{ role: "target", entity: target }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("rematar o perdonar a quien se rindió", () => {
  // Busca una pelea que termine con el rival rendido (depende del seed; el hallazgo es determinista).
  function yielded() {
    for (let seed = 1; seed <= 12; seed++) {
      const run = brawl(seed);
      if (run.w.truth.get(YIELDED, run.other)?.to === run.me) return { ...run, seed };
    }
    throw new Error("ningún seed terminó con alguien rendido");
  }

  it("la pelea deja al rendido a merced del vencedor", () => {
    const run = yielded();
    const y = run.w.truth.get(YIELDED, run.other);
    expect(y?.to).toBe(run.me);
    expect(atMercyOf(y, run.me, run.report.to)).toBe(true);
    expect(atMercyOf(y, run.other, run.report.to)).toBe(false);
    expect(atMercyOf(y, run.me, (y?.at ?? 0) + YIELD_WINDOW + 1)).toBe(false);
  }, 240_000);

  it("perdonar lo suelta y queda como evento", () => {
    const run = yielded();
    const wounds = run.w.truth.get(BODY_STATE, run.other)?.wounds.length;
    const report = run.life.turn(sparePlan(run.me, run.other), 1);
    expect(run.w.truth.get(YIELDED, run.other)).toBeUndefined();
    expect(report.events.find((e) => e.kind === "combat.spare")?.actors).toEqual([
      run.me,
      run.other,
    ]);
    expect(run.w.truth.get(BODY_STATE, run.other)?.wounds.length).toBe(wounds);
  }, 240_000);

  it("rematar es un golpe que no se defiende, con su evento y su delito", () => {
    const run = yielded();
    const before = run.w.truth.get(BODY_STATE, run.other)?.wounds.length ?? 0;
    const report = run.life.turn(strikePlan(run.me, run.other), 1);
    const finish = report.events.find((e) => e.kind === "combat.finish");
    if (finish) {
      expect(report.events.some((e) => e.kind === "combat.fight")).toBe(false);
      expect(run.w.truth.get(YIELDED, run.other)).toBeUndefined();
      expect(run.w.truth.get(BODY_STATE, run.other)?.wounds.length ?? 0).toBeGreaterThan(before);
      expect(offenseOf(finish)?.kind).toBe("assault");
    } else {
      // Dudó (el nervio frena el golpe): sigue a su merced y no hubo pelea nueva.
      expect(run.w.truth.get(YIELDED, run.other)?.to).toBe(run.me);
    }
    expect(checkInvariants({ truth: run.w.truth, log: run.w.log, ledger: run.w.ledger })).toEqual(
      [],
    );
  }, 240_000);
});

describe("pausas de la pelea del personaje", () => {
  /** Una pelea que se pausa en el primer turno, si alguna de las semillas probadas lo hace. */
  function pausedBrawl() {
    for (let seed = 1; seed <= 8; seed++) {
      const run = brawl(seed);
      const fight = run.report.events.find((e) => e.kind === "combat.fight");
      if ((fight?.data as { paused?: string } | null)?.paused) return { ...run, seed, fight };
    }
    return null;
  }

  it("se pausa cuando nota una herida, queda guardada y retomarla sigue la misma pelea", () => {
    const run = pausedBrawl();
    expect(run).not.toBeNull();
    if (!run) return;
    const saved = run.w.truth.get(FIGHT_STATE, run.me);
    expect(saved?.foe).toBe(run.other);
    // La pelea no terminó: nadie quedó a merced ni cayó.
    expect(run.w.truth.get(YIELDED, run.other)).toBeUndefined();
    const again = run.life.turn(strikePlan(run.me, run.other), 1);
    const next = again.events.find((e) => e.kind === "combat.fight");
    expect(next).toBeDefined();
    // La pelea que retoma cita la que arrancó como causa de sus heridas.
    expect(saved?.event).toBeDefined();
    const still = run.w.truth.get(FIGHT_STATE, run.me);
    if (!(next?.data as { paused?: string } | null)?.paused) expect(still).toBeUndefined();
    expect(checkInvariants({ truth: run.w.truth, log: run.w.log, ledger: run.w.ledger })).toEqual(
      [],
    );
  }, 240_000);

  it("una pelea que ya enfrió no se retoma: pasa el tiempo y arranca otra", () => {
    const run = pausedBrawl();
    if (!run) return;
    const saved = run.w.truth.get(FIGHT_STATE, run.me);
    expect(saved).toBeDefined();
    if (!saved) return;
    expect(livePause(run.w.truth, run.me, run.other, saved.snapshot.next)).toBeDefined();
    expect(
      livePause(run.w.truth, run.me, run.other, saved.snapshot.next + PAUSE_WINDOW + 1),
    ).toBeUndefined();
    expect(livePause(run.w.truth, run.me, run.me, saved.snapshot.next)).toBeUndefined();
  }, 240_000);
});
