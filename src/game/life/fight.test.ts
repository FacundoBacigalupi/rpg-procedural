import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  atMercyOf,
  BODY_STATE,
  CULTIVATION_STATE,
  checkInvariants,
  LOCATION,
  PERSON,
  RELATIONS,
  SKILL_STATE,
  YIELD_WINDOW,
  YIELDED,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { offenseOf } from "./deeds.ts";
import { FIGHT_STATE, fleeFirst, livePause, PAUSE_WINDOW } from "./fight.ts";
import { Life } from "./life.ts";
import { DEFAULT_SUGGESTIONS, suggestions } from "./suggest.ts";
import { fightForView } from "./view.ts";
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
function brawl(seed: number, stage?: number) {
  const life =
    stage === undefined
      ? Life.create(seed, content)
      : Life.create(seed, content, { cultivation: true });
  const w = life.world;
  const me = life.player;
  const house = w.truth.get(PERSON, me)?.household;
  const other = living(w.truth).find(
    (id) => id !== me && w.truth.get(PERSON, id)?.household === house,
  ) as AgentId;
  const here = w.truth.get(LOCATION, me);
  if (here) w.truth.set(LOCATION, other, here);
  if (stage !== undefined) {
    const was = w.truth.get(CULTIVATION_STATE, me) ?? { sensitivity: 1, hours: 0 };
    w.truth.set(CULTIVATION_STATE, me, { ...was, stage });
    w.truth.deleteRaw(CULTIVATION_STATE.name, other);
  }
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

describe("practicar (novel3-spar-act)", () => {
  const sparPlan = (actor: AgentId, target: AgentId): ActionPlan => ({
    actor,
    source: "player",
    root: {
      kind: "do",
      verb: "strike",
      args: [{ role: "target", entity: target }],
      manner: ["spar"],
    },
    manner: [],
    causes: [{ kind: "state", entity: actor, key: "intent" }],
  });
  /** Alguien de su casa, parado al lado; `stranger` borra lo que siente por el personaje. */
  function setUp(seed: number, stranger = false) {
    const life = Life.create(seed, content);
    const w = life.world;
    const me = life.player;
    const house = w.truth.get(PERSON, me)?.household;
    const other = living(w.truth).find(
      (id) => id !== me && w.truth.get(PERSON, id)?.household === house,
    ) as AgentId;
    const here = w.truth.get(LOCATION, me);
    if (here) w.truth.set(LOCATION, other, here);
    const rel = w.truth.get(RELATIONS, other);
    if (rel) {
      const toward = { ...rel.toward };
      const cur = toward[me];
      if (cur) {
        toward[me] = stranger
          ? { ...cur, dims: { ...cur.dims, familiarity: 0, affection: 0 } }
          : {
              ...cur,
              dims: { ...cur.dims, familiarity: Math.max(0.3, cur.dims.familiarity ?? 0) },
            };
      }
      w.truth.set(RELATIONS, other, { ...rel, toward });
    }
    return { life, w, me, other };
  }

  it("con alguien que lo conoce es práctica: su evento, sin rendidos ni delito, y se aprende", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { life, w, me, other } = setUp(seed);
      const skillsBefore = w.truth.get(SKILL_STATE, me);
      const report = life.turn(sparPlan(me, other), 1);
      const spar = report.events.find((e) => e.kind === "combat.spar");
      // Dudó (el nervio frena el golpe): no hubo práctica en este seed.
      if (!spar) continue;
      expect(report.events.some((e) => e.kind === "combat.fight")).toBe(false);
      expect(spar.actors).toEqual([me, other]);
      expect(w.truth.get(YIELDED, me)).toBeUndefined();
      expect(w.truth.get(YIELDED, other)).toBeUndefined();
      expect(offenseOf(spar)).toBeNull();
      expect(w.truth.get(SKILL_STATE, me)).not.toEqual(skillsBefore);
      for (const id of [me, other]) {
        for (const wound of w.truth.get(BODY_STATE, id)?.wounds ?? []) {
          expect(["head", "neck"]).not.toContain(wound.zone);
        }
      }
      expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
      return;
    }
    throw new Error("ningún seed practicó");
  }, 240_000);

  it("con un extraño no hay práctica: no quiere, y no hay golpe", () => {
    const { life, w, me, other } = setUp(1, true);
    const before = w.truth.get(BODY_STATE, other)?.wounds.length ?? 0;
    const report = life.turn(sparPlan(me, other), 1);
    expect(report.events.some((e) => e.kind === "combat.spar" || e.kind === "combat.fight")).toBe(
      false,
    );
    expect(w.truth.get(BODY_STATE, other)?.wounds.length ?? 0).toBe(before);
  }, 120_000);
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

  it("la pausa guarda por qué y para qué; la vista y las opciones la muestran (novel3-intent-panel)", () => {
    const run = pausedBrawl();
    expect(run).not.toBeNull();
    if (!run) return;
    const saved = run.w.truth.get(FIGHT_STATE, run.me);
    expect(["wounded", "foe_fleeing"]).toContain(saved?.reason);
    expect(saved?.intent).toBe("subdue");
    const view = fightForView(run.w);
    expect(view?.reason).toBe(saved?.reason);
    expect(view?.seconds).toBeGreaterThan(0);
    expect(view?.seconds).toBeLessThanOrEqual(PAUSE_WINDOW);
    expect(view?.who).not.toBe("alguien");
    const options = suggestions(run.w, DEFAULT_SUGGESTIONS).filter((s) => s.kind === "fight");
    expect(options.map((s) => s.fight?.manner ?? "on")).toEqual([
      "on",
      "kill",
      "drive_off",
      "escape",
    ]);
  }, 240_000);

  it("irse con la pelea en pausa es huir: primero la pelea con escape (novel3-intent-resolve-flee)", () => {
    const run = pausedBrawl();
    expect(run).not.toBeNull();
    if (!run) return;
    const saved = run.w.truth.get(FIGHT_STATE, run.me);
    if (!saved) throw new Error("sin pausa");
    const away: ActionPlan = {
      actor: run.me,
      source: "player",
      root: { kind: "do", verb: "move", args: [{ role: "to", entity: run.other }], manner: [] },
      manner: [],
      causes: [{ kind: "state", entity: run.me, key: "intent" }],
    };
    const now = saved.snapshot.next;
    const fled = fleeFirst(run.w.truth, run.me, now, away);
    expect(fled.root).toEqual({
      kind: "seq",
      steps: [
        {
          kind: "do",
          verb: "strike",
          args: [{ role: "target", entity: run.other }],
          manner: ["escape"],
        },
        away.root,
      ],
    });
    // Ya fría, u otra cosa que no sea irse: el plan queda como estaba.
    expect(fleeFirst(run.w.truth, run.me, now + PAUSE_WINDOW + 1, away)).toBe(away);
    const hit = strikePlan(run.me, run.other);
    expect(fleeFirst(run.w.truth, run.me, now, hit)).toBe(hit);
    // En el turno: el primer paso es la pelea que retoma.
    const report = run.life.turn(away, 2);
    expect(report.steps[0]?.verb).toBe("strike");
    expect(report.events.some((e) => e.kind === "combat.fight")).toBe(true);
    expect(checkInvariants({ truth: run.w.truth, log: run.w.log, ledger: run.w.ledger })).toEqual(
      [],
    );
  }, 240_000);

  it.each([
    ["yield", "target"],
    ["speak", "to"],
  ] as const)(
    "con la pelea en pausa, %s la corta con su evento (novel3-intent-resolve-talk)",
    (verb, role) => {
      const run = pausedBrawl();
      expect(run).not.toBeNull();
      if (!run) return;
      const saved = run.w.truth.get(FIGHT_STATE, run.me);
      if (!saved) throw new Error("sin pausa");
      const report = run.life.turn(
        {
          actor: run.me,
          source: "player",
          root: { kind: "do", verb, args: [{ role, entity: run.other }], manner: [] },
          manner: [],
          causes: [{ kind: "state", entity: run.me, key: "intent" }],
        },
        2,
      );
      const off = report.events.find((e) => e.kind === "combat.break_off");
      expect(off?.data).toEqual({ how: verb === "yield" ? "yield" : "talk" });
      expect(off?.actors).toEqual([run.me, run.other]);
      expect(off?.causes).toContainEqual({ kind: "event", event: saved.event });
      expect(run.w.truth.get(FIGHT_STATE, run.me)).toBeUndefined();
      const given = run.w.truth.get(YIELDED, run.me);
      if (verb === "yield") expect(given?.to).toBe(run.other);
      else expect(given).toBeUndefined();
      expect(report.events.some((e) => e.kind === "combat.fight")).toBe(false);
    },
    240_000,
  );

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

describe("pelear con el cuerpo refinado (novel3-refined-wire)", () => {
  it("con cultivo, el tramo del personaje entra a la pelea: el evento lo dice y el rival no lo sigue", () => {
    const run = brawl(3, 3);
    const fight = run.report.events.find((e) => e.kind === "combat.fight");
    expect((fight?.data as { stages?: Record<string, number> } | undefined)?.stages).toEqual({
      [run.me]: 3,
      [run.other]: 0,
    });
    const step = run.report.steps.find((r) => r.verb === "strike");
    const effect = step?.self.effect as { fight?: { blur?: string } } | undefined;
    expect(effect?.fight?.blur).toBe("me");
    expect(checkInvariants({ truth: run.w.truth, log: run.w.log, ledger: run.w.ledger })).toEqual(
      [],
    );
  }, 120_000);

  it("contra mortales, un cultivador de varios tramos sale entero más seguido que uno de cero", () => {
    let mortalHurt = 0;
    let refinedHurt = 0;
    for (const seed of [3, 4, 5]) {
      const a = brawl(seed, 0);
      const b = brawl(seed, 4);
      mortalHurt += a.w.truth.get(BODY_STATE, a.me)?.wounds.length ?? 0;
      refinedHurt += b.w.truth.get(BODY_STATE, b.me)?.wounds.length ?? 0;
    }
    expect(refinedHurt).toBeLessThanOrEqual(mortalHurt);
  }, 300_000);
});
