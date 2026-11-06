import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, HOUR, loadContent } from "../../core/index.ts";
import {
  ABSORBED_EVENT,
  type ActionPlan,
  BODY_STATE,
  CULTIVATION_LAW,
  CULTIVATION_STATE,
  QI_TAKEN,
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

const meditate = (me: AgentId, hours: number): ActionPlan => ({
  actor: me,
  source: "player",
  root: {
    kind: "do",
    verb: "meditate",
    args: [{ role: "for", seconds: hours * HOUR }],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: me, key: "intent" }],
});

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
      life.turn(meditate(me, 12), seq++);
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

  it("es determinista: dos corridas iguales dan el mismo hash", () => {
    const run = () => {
      const life = lifeWith(content, true);
      life.turn(meditate(life.player, 4), 1);
      return life.hash().total;
    };
    expect(run()).toBe(run());
  }, 240_000);
});
