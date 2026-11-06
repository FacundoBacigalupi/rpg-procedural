import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, HOUR, loadContent } from "../../core/index.ts";
import {
  ABSORBED_EVENT,
  type ActionPlan,
  BODY_STATE,
  BREAKTHROUGH_EVENT,
  CULTIVATION_LAW,
  CULTIVATION_STATE,
  CULTIVATION_TECHNIQUE,
  QI_TAKEN,
  SECT,
  SENSED_QI_EVENT,
  TALENT,
  vesselCapacity,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { playerView } from "./view.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const meditate = (me: AgentId, hours: number, verb = "meditate"): ActionPlan => ({
  actor: me,
  source: "player",
  root: {
    kind: "do",
    verb,
    args: [{ role: "for", seconds: hours * HOUR }],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: me, key: "intent" }],
});

/**
 * Un turno con el cuerpo como al empezar: meditar días enteros sin comer ni beber mata (y es lo que
 * debe pasar), pero acá se mira el cultivo.
 */
function freshTurn(life: Life, plan: ActionPlan, seq: number): void {
  const w = life.world;
  const body = w.truth.get(BODY_STATE, life.player);
  life.turn(plan, seq);
  if (body) w.truth.set(BODY_STATE, life.player, body);
}

/** Una vida con cultivo en la que el personaje tiene (o no) raíz, descansado y comido. */
function lifeWith(content: ReturnType<typeof loadContent>, rooted: boolean): Life {
  const life = Life.create(3, content, { cultivation: true });
  const w = life.world;
  const me = life.player;
  const t = w.truth.get(TALENT, me);
  if (!t) throw new Error("sin talento");
  const innate = rooted
    ? { ...t.innate, spirit_root: 3, root_wood: 3, root_fire: -1, comprehension: 0.7 }
    : { ...t.innate, spirit_root: -3 };
  w.truth.set(TALENT, me, { ...t, innate });
  const body = w.truth.get(BODY_STATE, me);
  if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });
  return life;
}

describe("meditar (novel-cult-meditate)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("con raíz, meditando horas siente el qi una vez, causado por una meditación", () => {
    const life = lifeWith(content, true);
    const w = life.world;
    const me = life.player;
    const from = life.now;
    for (let seq = 1; seq <= 8; seq++) {
      life.turn(meditate(me, 4), seq);
      if (w.truth.get(CULTIVATION_STATE, me)?.sensed) break;
    }
    const state = w.truth.get(CULTIVATION_STATE, me);
    expect(state?.hours).toBeGreaterThan(0);
    expect(state?.sensed).toBeDefined();
    const sensed = w.log.all().filter((e) => e.kind === SENSED_QI_EVENT && e.actors[0] === me);
    expect(sensed).toHaveLength(1);
    const cause = sensed[0]?.causes.find((c) => c.kind === "event");
    const origin = cause?.kind === "event" ? w.log.get(cause.event) : undefined;
    expect(origin?.kind).toBe("action.meditate");
    expect(origin?.id).toBe(state?.sensed?.event);
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("sensed_qi");
    // Seguir meditando no lo vuelve a sentir por primera vez.
    life.turn(meditate(me, 4), 99);
    expect(w.log.all().filter((e) => e.kind === SENSED_QI_EVENT)).toHaveLength(1);
  }, 240_000);

  it("con la técnica de una secta, la misma meditación rinde su factor (novel-cult-school)", () => {
    const plain = lifeWith(content, true);
    const taught = lifeWith(content, true);
    const org = taught.world.truth.ids(SECT)[0];
    if (!org) throw new Error("sin secta");
    taught.world.truth.set(CULTIVATION_TECHNIQUE, taught.player, {
      org,
      name: "el método",
      factor: 1.5,
      learnedAt: taught.now,
    });
    plain.turn(meditate(plain.player, 2), 1);
    taught.turn(meditate(taught.player, 2), 1);
    const a = plain.world.truth.get(CULTIVATION_STATE, plain.player)?.sensitivity ?? 0;
    const b = taught.world.truth.get(CULTIVATION_STATE, taught.player)?.sensitivity ?? 0;
    expect(a).toBeGreaterThan(0);
    expect(b / a).toBeCloseTo(1.5, 2);
  }, 240_000);

  it("sin raíz suma horas pero la sensibilidad no se mueve: no pasa nada", () => {
    const life = lifeWith(content, false);
    const w = life.world;
    const me = life.player;
    for (let seq = 1; seq <= 4; seq++) life.turn(meditate(me, 6), seq);
    const state = w.truth.get(CULTIVATION_STATE, me);
    expect(state?.hours).toBeGreaterThan(0);
    expect(state?.sensitivity).toBe(0);
    expect(w.log.all().some((e) => e.kind === SENSED_QI_EVENT)).toBe(false);
  }, 240_000);

  it("ya sintiéndolo, meditar llena el recipiente con qi de la celda, hasta la capacidad", () => {
    const life = lifeWith(content, true);
    const w = life.world;
    const me = life.player;
    let seq = 1;
    for (; seq <= 8 && !w.truth.get(CULTIVATION_STATE, me)?.sensed; seq++) {
      life.turn(meditate(me, 4), seq);
    }
    expect(w.truth.get(CULTIVATION_STATE, me)?.sensed).toBeDefined();
    const plane = w.truth.ids(CULTIVATION_LAW)[0];
    const law = plane ? w.truth.get(CULTIVATION_LAW, plane) : undefined;
    if (!plane || !law) throw new Error("sin ley");
    const capacity = vesselCapacity(law);
    const from = life.now;
    for (let i = 0; i < 12 && (w.truth.get(CULTIVATION_STATE, me)?.qi ?? 0) < capacity; i++) {
      freshTurn(life, meditate(me, 12), seq++);
    }
    const state = w.truth.get(CULTIVATION_STATE, me);
    expect(state?.qi ?? 0).toBeGreaterThan(0);
    expect(state?.qi ?? 0).toBeLessThanOrEqual(capacity);
    expect(state?.purity ?? 0).toBeGreaterThan(0);
    // Conservación: todo lo que hay en los recipientes salió de la celda.
    const vessels = w.truth
      .ids(CULTIVATION_STATE)
      .reduce((s, id) => s + (w.truth.get(CULTIVATION_STATE, id)?.qi ?? 0), 0);
    expect(w.truth.get(QI_TAKEN, plane)?.drawn).toBeCloseTo(vessels, 3);
    const absorbed = w.log.all().filter((e) => e.kind === ABSORBED_EVENT && e.actors[0] === me);
    expect(absorbed.length).toBeGreaterThan(0);
    expect(absorbed[0]?.causes.some((c) => c.kind === "event")).toBe(true);
    const cues = playerView(w, [], { heardSince: from }).self.cues;
    expect(cues.some((c) => c.startsWith("qi_"))).toBe(true);
  }, 480_000);

  it("lleno, intenta la ruptura: el resultado nace de la tirada y el qi se conserva", () => {
    const life = lifeWith(content, true);
    const w = life.world;
    const me = life.player;
    const plane = w.truth.ids(CULTIVATION_LAW)[0];
    const law = plane ? w.truth.get(CULTIVATION_LAW, plane) : undefined;
    if (!plane || !law) throw new Error("sin ley");
    let seq = 1;
    // Sin sentir el qi no hay nada que empujar.
    life.turn(meditate(me, 1, "breakthrough"), seq++);
    expect(w.log.all().some((e) => e.kind === BREAKTHROUGH_EVENT)).toBe(false);
    for (
      let i = 0;
      i < 24 && (w.truth.get(CULTIVATION_STATE, me)?.qi ?? 0) < vesselCapacity(law);
      i++
    ) {
      freshTurn(life, meditate(me, 12), seq++);
    }
    const from = life.now;
    for (let i = 0; i < 6 && (w.truth.get(CULTIVATION_STATE, me)?.stage ?? 0) === 0; i++) {
      freshTurn(life, meditate(me, 1, "breakthrough"), seq++);
    }
    const breaks = w.log.all().filter((e) => e.kind === BREAKTHROUGH_EVENT && e.actors[0] === me);
    expect(breaks.length).toBeGreaterThan(0);
    const cause = breaks[0]?.causes.find((c) => c.kind === "event");
    expect(cause?.kind === "event" ? w.log.get(cause.event)?.kind : undefined).toBe(
      "action.breakthrough",
    );
    const cues = playerView(w, [], { heardSince: from }).self.cues;
    expect(cues.some((c) => c.startsWith("break_"))).toBe(true);
    const state = w.truth.get(CULTIVATION_STATE, me);
    if ((state?.stage ?? 0) > 0) expect(state?.foundation ?? 0).toBeGreaterThan(0);
    const vessels = w.truth
      .ids(CULTIVATION_STATE)
      .reduce((s, id) => s + (w.truth.get(CULTIVATION_STATE, id)?.qi ?? 0), 0);
    expect(w.truth.get(QI_TAKEN, plane)?.drawn).toBeCloseTo(vessels, 3);
  }, 600_000);

  it("es determinista: dos corridas iguales dan el mismo hash", () => {
    const run = () => {
      const life = lifeWith(content, true);
      life.turn(meditate(life.player, 4), 1);
      return life.hash().total;
    };
    expect(run()).toBe(run());
  }, 240_000);
});
