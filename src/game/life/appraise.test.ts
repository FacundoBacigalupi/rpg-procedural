import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EventId, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  appraiseFight,
  appraiseLoss,
  BODY_STATE,
  type Body,
  checkInvariants,
  LOCATION,
  MIND,
  type Mind,
  PERSON,
  SCHEMAS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
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

const EVENT = 1 as unknown as EventId;
const FOE = "agent:9" as AgentId;
const calm = { reactivity: 0, sociability: 0, curiosity: 0, control: 0, warmth: 0, boldness: 0 };
const mindWith = (strengths: Record<string, number>): Mind => ({
  schemas: Object.fromEntries(
    content.all(SCHEMAS).map((s) => [s.id, { strength: strengths[s.id] ?? 0, causes: [] }]),
  ),
  formative: [],
  originEventId: EVENT,
});
const hurt = { role: "victim", foe: FOE, worst: 0.7, standing: false, kin: false } as const;
const intensityOf = (items: ReturnType<typeof appraiseFight>, theme: string) =>
  items.find((a) => a.stimulus.theme === theme)?.stimulus.intensity ?? 0;

describe("interpretar una pelea", () => {
  it("el golpeado la vive como violencia y culpa a quien le pegó", () => {
    const [a] = appraiseFight(hurt, mindWith({}), calm);
    expect(a?.stimulus.theme).toBe("violence");
    expect(a?.blame).toBe(FOE);
  });

  it("lo ya esperado pesa menos y el audaz lo toma como desafío", () => {
    const naive = intensityOf(appraiseFight(hurt, mindWith({}), calm), "violence");
    const expecting = intensityOf(
      appraiseFight(hurt, mindWith({ world_is_dangerous: 1 }), calm),
      "violence",
    );
    const bold = intensityOf(
      appraiseFight(hurt, mindWith({}), { ...calm, boldness: 1 }),
      "violence",
    );
    expect(expecting).toBeLessThan(naive);
    expect(bold).toBeLessThan(naive);
  });

  it("una herida más grave marca más", () => {
    const light = intensityOf(
      appraiseFight({ ...hurt, worst: 0.1 }, mindWith({}), calm),
      "violence",
    );
    const grave = intensityOf(
      appraiseFight({ ...hurt, worst: 0.9 }, mindWith({}), calm),
      "violence",
    );
    expect(grave).toBeGreaterThan(light);
  });

  it("que le pegue uno de la casa suma traición, y el que ya desconfía la siente menos", () => {
    const kin = { ...hurt, kin: true };
    const naive = intensityOf(appraiseFight(kin, mindWith({}), calm), "betrayal");
    expect(naive).toBeGreaterThan(0);
    expect(intensityOf(appraiseFight(hurt, mindWith({}), calm), "betrayal")).toBe(0);
    const wary = intensityOf(
      appraiseFight(kin, mindWith({ people_are_untrustworthy: 1 }), calm),
      "betrayal",
    );
    expect(wary).toBeLessThan(naive);
  });

  it("sin herida no hay nada que interpretar", () => {
    expect(appraiseFight({ ...hurt, worst: 0 }, mindWith({}), calm)).toEqual([]);
  });

  it("quien pega solo aprende algo si se mide por su fuerza: gana o pierde", () => {
    const hit = { role: "aggressor", foe: FOE, worst: 0.6, standing: true, kin: false } as const;
    expect(appraiseFight(hit, mindWith({ strength_is_worth: 0.1 }), calm)).toEqual([]);
    expect(appraiseFight(hit, mindWith({ strength_is_worth: 0.8 }), calm)[0]?.stimulus.theme).toBe(
      "success",
    );
    const lost = { ...hit, standing: false };
    const [a] = appraiseFight(lost, mindWith({ strength_is_worth: 0.8 }), calm);
    expect(a?.stimulus.theme).toBe("failure");
    expect(a?.blame).toBe(FOE);
  });
});

describe("interpretar una pérdida", () => {
  it("pesa más cuanto más cercano era", () => {
    const near = appraiseLoss(0.9)[0]?.stimulus.intensity ?? 0;
    const far = appraiseLoss(0.2)[0]?.stimulus.intensity ?? 0;
    expect(near).toBeGreaterThan(far);
    expect(appraiseLoss(0.9)[0]?.stimulus.theme).toBe("loss");
    expect(appraiseLoss(0)).toEqual([]);
  });
});

const strikePlan = (actor: AgentId, target: AgentId): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "strike", args: [{ role: "target", entity: target }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("la aldea interpreta lo que vive", () => {
  it("el golpeado queda marcado por la pelea, con la pelea como causa", () => {
    const life = Life.create(10, content);
    const w = life.world;
    const me = life.player;
    const home = w.truth.get(PERSON, me)?.household;
    const target = living(w.truth).find(
      (id) => w.truth.get(PERSON, id)?.household !== home,
    ) as AgentId;
    const here = w.truth.get(LOCATION, me);
    if (here) w.truth.set(LOCATION, target, here);
    const before = w.truth.get(MIND, target) as Mind;
    const report = life.turn(strikePlan(me, target), 1);
    const fight = report.events.find((e) => e.kind === "combat.fight");
    expect(fight).toBeDefined();
    const after = w.truth.get(MIND, target) as Mind;
    const moved = Object.keys(after.schemas).filter(
      (k) => after.schemas[k]?.causes.at(-1) === fight?.id,
    );
    expect(moved.length).toBeGreaterThan(0);
    const dangerous = (m: Mind) => m.schemas["world_is_dangerous"]?.strength ?? 0;
    // Si le pegó de verdad, el mundo le parece más peligroso.
    const hits = (fight?.data as { hits?: { to?: string }[] } | null)?.hits ?? [];
    if (hits.some((h) => h.to === target)) {
      expect(dangerous(after)).toBeGreaterThan(dangerous(before));
    }
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 120_000);

  it("la casa de quien muere lo vive como pérdida; los de otra casa, no", () => {
    const life = Life.create(10, content);
    const w = life.world;
    const me = life.player;
    const home = w.truth.get(PERSON, me)?.household;
    const kin = living(w.truth).filter(
      (id) => id !== me && w.truth.get(PERSON, id)?.household === home,
    );
    const dead = kin[0];
    if (!dead) throw new Error("el personaje vive solo");
    const stranger = living(w.truth).find(
      (id) => w.truth.get(PERSON, id)?.household !== home,
    ) as AgentId;
    const body = w.truth.get(BODY_STATE, dead) as Body;
    w.truth.set(BODY_STATE, dead, {
      ...body,
      death: { cause: "brain_trauma", at: life.now },
    } as Body);
    const mine = w.truth.get(MIND, me) as Mind;
    const theirs = w.truth.get(MIND, stranger) as Mind;
    life.advanceTo(life.now + 2 * 86_400);
    const death = w.log.all().find((e) => e.kind === "body.died" && e.actors.includes(dead));
    expect(death).toBeDefined();
    const touched = (m: Mind) =>
      Object.values(m.schemas).some((h) => h.causes.at(-1) === death?.id);
    expect(touched(w.truth.get(MIND, me) as Mind)).toBe(true);
    expect(touched(w.truth.get(MIND, stranger) as Mind)).toBe(false);
    expect(w.truth.get(MIND, stranger)).toEqual(theirs);
    expect(w.truth.get(MIND, me)).not.toEqual(mine);
  }, 120_000);

  it("es determinista", () => {
    const run = () => {
      const life = Life.create(10, content);
      const me = life.player;
      const target = living(life.world.truth).find(
        (id) =>
          life.world.truth.get(PERSON, id)?.household !==
          life.world.truth.get(PERSON, me)?.household,
      ) as AgentId;
      life.turn(strikePlan(me, target), 1);
      return life.hash();
    };
    expect(run()).toEqual(run());
  }, 120_000);
});
