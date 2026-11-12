import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  HOUR,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  BREAKTHROUGH_EVENT,
  CULTIVATION_LAW,
  CULTIVATION_STATE,
  CULTIVATION_TECHNIQUE,
  SECT_SCHOOL,
  TALENT,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const doFor = (me: AgentId, verb: string, hours: number): ActionPlan => ({
  actor: me,
  source: "player",
  root: { kind: "do", verb, args: [{ role: "for", seconds: hours * HOUR }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: me, key: "intent" }],
});

describe("el método cubre un tramo (novel2-method-school)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  /** Rompe desde la cima del primer reino con el método de `realm` y devuelve la ruptura. */
  const breakAtTop = (realm: number) => {
    const life = Life.create(3, content, { cultivation: true });
    const w = life.world;
    const me = life.player;
    const plane = w.truth.ids(CULTIVATION_LAW)[0];
    const law = plane ? w.truth.get(CULTIVATION_LAW, plane) : undefined;
    const org = w.truth.ids(SECT_SCHOOL)[0];
    const school = org ? w.truth.get(SECT_SCHOOL, org) : undefined;
    if (!law || !org || !school) throw new Error("sin ley o sin escuela");
    const method = school.methods?.[realm];
    if (!method) throw new Error("sin método");
    w.truth.set(CULTIVATION_TECHNIQUE, me, {
      org,
      name: method.name,
      factor: method.factor,
      learnedAt: life.now,
      realm,
    });
    const t = w.truth.get(TALENT, me);
    if (!t) throw new Error("sin talento");
    w.truth.set(TALENT, me, {
      ...t,
      innate: { ...t.innate, spirit_root: 3, root_wood: 3, comprehension: 0.7 },
    });
    const top = school.realms[0]?.to ?? 0;
    const threshold = law.paths[0]?.thresholds[top];
    if (!threshold) throw new Error("sin umbral");
    w.truth.set(CULTIVATION_STATE, me, {
      sensitivity: 2,
      hours: 500,
      sensed: { at: life.now, event: w.log.all()[0]?.id as EventId },
      stage: top,
      qi: threshold.capacity,
      purity: 1,
      foundation: 1,
    });
    const body = w.truth.get(BODY_STATE, me);
    life.turn(doFor(me, "breakthrough", 1), 1);
    // Si el umbral llama tribulación, la ruptura se resuelve cuando cae.
    for (let i = 2; i < 12 && !w.log.all().some((e) => e.kind === BREAKTHROUGH_EVENT); i++) {
      if (body) w.truth.set(BODY_STATE, me, body);
      life.turn(doFor(me, "wait", 1), i);
    }
    const b = w.log.all().find((e) => e.kind === BREAKTHROUGH_EVENT);
    if (!b) throw new Error("no rompió");
    return b.data as { blind?: boolean; prep: number };
  };

  it("con el de entrada, pasar al segundo reino va a ciegas; con el del segundo, no", () => {
    const blind = breakAtTop(0);
    const guided = breakAtTop(1);
    expect(blind.blind).toBe(true);
    expect(guided.blind).toBeUndefined();
    expect(blind.prep).toBeLessThan(guided.prep);
  }, 600_000);
});
