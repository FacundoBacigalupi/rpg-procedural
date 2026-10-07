import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type Event,
  type HolderRef,
  holderAccount,
  loadContent,
  makeId,
  Rng,
} from "../../core/index.ts";
import { GAME_CONTENT_KINDS } from "../../game/index.ts";
import {
  characterPanel,
  fixedInterrupt,
  inventoryPanel,
  Life,
  living,
  PERCEPTS,
  perceiveEvents,
  remember,
} from "../../game/life/index.ts";
import { parseCommand } from "../../llm/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  bodySigns,
  checkInvariants,
  LOCATION,
  PERSON,
  planFromDraft,
} from "../../sim/index.ts";

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

function planOf(life: Life, text: string): ActionPlan {
  const draft = parseCommand(text, life.world.catalog);
  if (!draft) throw new Error(`la gramática no entiende: ${text}`);
  const r = planFromDraft(draft, {
    actor: life.player,
    source: "player",
    catalog: life.world.catalog,
    known: [],
    clock: life.world.clock,
    causes: [{ kind: "state", entity: life.player, key: "intent" }],
  });
  if (r.kind !== "plan") throw new Error(`no es un plan: ${JSON.stringify(r)}`);
  return r.plan;
}

describe("el turno real", () => {
  it("esperar una hora avanza el mundo, deja un paso con autopercepción y es determinista", () => {
    const run = () => {
      const life = Life.create(7, content);
      const report = life.turn(planOf(life, "espero una hora"), 1);
      return { life, report };
    };
    const a = run();
    expect(a.report.over).toBe(false);
    expect(a.report.steps.map((s) => s.verb)).toEqual(["wait"]);
    expect(a.report.to - a.report.from).toBeGreaterThanOrEqual(3000);
    expect(checkInvariants({ truth: a.life.world.truth, log: a.life.world.log })).toEqual([]);
    expect(run().life.hash()).toEqual(a.life.hash());
  }, 120_000);

  it("comer de la despensa de la casa pasa por el cuerpo y el ledger", () => {
    const life = Life.create(7, content);
    const report = life.turn(planOf(life, "como"), 1);
    expect(report.steps.map((s) => s.verb)).toEqual(["eat"]);
    const effect = report.steps[0]?.self.effect;
    expect(effect).toMatchObject({ kind: "eat" });
    expect((effect as { kcal: number }).kcal).toBeGreaterThan(0);
    expect(checkInvariants({ truth: life.world.truth, log: life.world.log })).toEqual([]);
  }, 120_000);
});

describe("la aldea vive y el turno se corta por lo que el personaje percibe", () => {
  it("la gente sigue su rutina: come de la despensa, duerme de noche y no se muere de hambre", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const me = w.truth.get(PERSON, life.player);
    if (!me) throw new Error("sin persona");
    const larder = () =>
      w.ledger
        .holdings(holderAccount(me.household as unknown as HolderRef))
        .reduce((s, h) => s + h.amount, 0);
    const before = larder();
    life.advanceTo(life.now + 3 * w.clock.day);
    const ate = w.log.all().filter((e) => e.kind === "routine.ate");
    expect(ate.length).toBeGreaterThan(0);
    expect(ate.some((e) => e.actors.includes(life.player))).toBe(false);
    expect(larder()).toBeLessThan(before);
    const plan = w.plans[0];
    if (!plan) throw new Error("sin plan corporal");
    for (const id of living(w.truth)) {
      if (id === life.player) continue;
      const body = w.truth.get(BODY_STATE, id);
      if (!body) throw new Error("sin cuerpo");
      expect(bodySigns(plan, body).general).not.toContain("parched");
      expect(body.sleepDebt).toBeLessThan(8);
    }
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 120_000);

  it("un signo grave nuevo del cuerpo corta una espera larga", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const body = w.truth.get(BODY_STATE, life.player);
    if (!body) throw new Error("sin cuerpo");
    // Le falta casi lo justo para quedar reseco: tiene sed pero todavía no le alarma.
    w.truth.set(BODY_STATE, life.player, { ...body, water: 0.055 * body.massKg });
    const report = life.turn(planOf(life, "espero diez días"), 1);
    expect(report.interrupted).toBe(true);
    expect(report.interrupt).toMatchObject({ kind: "body_alarm" });
    expect(report.interrupt?.signs).toContain("parched");
    expect(report.to - report.from).toBeLessThan(w.clock.day);
  }, 120_000);

  it("la muerte de su madre lo corta si la ve, y no si pasa lejos", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const mother = w.truth.get(PERSON, life.player)?.mother;
    if (!mother) return; // el seed 7 da un personaje con madre; si cambia, el caso no aplica
    const died = (): Event => ({
      id: makeId("event", 999_999),
      tick: life.now,
      kind: "body.died",
      actors: [mother],
      place: { kind: "cell", cell: w.map.cell },
      data: { cause: "sepsis" },
      emissions: { sight: 0.5, sound: 0.1 },
      causes: [{ kind: "state", entity: mother, key: "body" }],
      resolution: "local",
    });
    const here = w.truth.get(LOCATION, life.player);
    if (!here) throw new Error("sin lugar");
    // Lo que el personaje percibió del paso queda guardado y de ahí lee la interrupción.
    const witness = (e: Event) => {
      w.truth.set(PERCEPTS, life.player, { recent: [] });
      const seen = perceiveEvents(
        { player: life.player, map: w.map, spaces: w.spaces, clock: w.clock },
        w.truth,
        [e],
        Rng.root(w.seed).fork("test"),
      );
      w.truth.set(PERCEPTS, life.player, remember(w.truth, life.player, seen));
    };
    w.truth.set(LOCATION, mother, here);
    witness(died());
    expect(fixedInterrupt(w, [died()], new Set())).toMatchObject({
      kind: "death_seen",
      who: mother,
    });
    const far = w.map.neighbors.findIndex(
      (_, hex) => hex !== here.hex && !w.map.neighbors[here.hex]?.includes(hex),
    );
    w.truth.set(LOCATION, mother, { hex: far });
    witness(died());
    expect(fixedInterrupt(w, [died()], new Set())).toBeNull();
  }, 120_000);

  it("un golpe de otro siempre lo siente", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const other = living(w.truth).find((id) => id !== life.player) as AgentId;
    const strike: Event = {
      id: makeId("event", 999_998),
      tick: life.now,
      kind: "action.strike",
      actors: [other, life.player],
      place: { kind: "cell", cell: w.map.cell },
      data: null,
      emissions: { sight: 0, sound: 0 },
      causes: [{ kind: "state", entity: other, key: "plan.1" }],
      resolution: "local",
    };
    expect(fixedInterrupt(w, [strike], new Set())).toMatchObject({ kind: "attacked", who: other });
  }, 120_000);

  it("los paneles no muestran números de la verdad", () => {
    const life = Life.create(7, content);
    life.turn(planOf(life, "como"), 1);
    const character = characterPanel(life.world);
    const { ageYears, ...rest } = character;
    expect(Number.isInteger(ageYears)).toBe(true);
    expect(JSON.stringify(rest)).not.toMatch(/\d/);
    const inventory = inventoryPanel(life.world);
    expect(inventory.larder.length).toBeGreaterThan(0);
    expect(JSON.stringify(inventory)).not.toMatch(/\d/);
  }, 120_000);
});
