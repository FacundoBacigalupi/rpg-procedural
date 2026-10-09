import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  EARTHLIKE_CLOCK,
  type EventId,
  loadContent,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  BODY_PLANS,
  BODY_STATE,
  type BodyPlanDef,
  ENTITY,
  INNATE,
  LIFE_STAGES,
  MIND,
  newBody,
  PERSON,
  PLANS,
  type ProcessContext,
  SCHEMAS,
  SKILLS,
  SkillCatalog,
  TRAITS,
  VALUES,
  WorldTruth,
} from "../../sim/index.ts";
import { DECIDED_EVENT, type DecideOptions, decideProcess, NPC_DECISION } from "./decide.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS, BODY_PLANS, VALUES, SCHEMAS, LIFE_STAGES],
  [
    { kind: "actions", file: "a.json", data: json("content/actions/core.json") },
    { kind: "skills", file: "s.json", data: json("content/skills/core.json") },
    { kind: "traits", file: "t.json", data: json("content/traits/human.json") },
    { kind: "plans", file: "p.json", data: json("content/plans/steal.json") },
    { kind: "body-plans", file: "b.json", data: json("content/body-plans/human.json") },
    { kind: "values", file: "v.json", data: json("content/values/human.json") },
    { kind: "schemas", file: "m.json", data: json("content/schemas/human.json") },
    { kind: "life-stages", file: "l.json", data: json("content/life-stages/human.json") },
  ],
);
const plan = content.all(BODY_PLANS)[0] as BodyPlanDef;
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const A = "agent:1" as AgentId;
const PLAYER = "agent:99" as AgentId;
const NONE = { kind: "none" } as unknown as PlaceRef;

const opts: DecideOptions = {
  clock: EARTHLIKE_CLOCK,
  catalog,
  skills: new SkillCatalog(content.all(SKILLS), content.all(ACTIONS)),
  traits: content.all(TRAITS),
  bodyPlans: [plan],
  values: content.all(VALUES),
  schemas: content.all(SCHEMAS),
  stages: content.all(LIFE_STAGES),
  dims: [],
  bonds: [],
  player: PLAYER,
  placeOf: () => NONE,
};

function world(water: number) {
  const truth = new WorldTruth();
  truth.set(ENTITY, A, { endedAt: undefined } as never);
  truth.set(PERSON, A, { born: 0, household: "h:1", sex: "male" } as never);
  truth.set(BODY_STATE, A, { ...newBody(plan, 60, 0), water });
  truth.set(MIND, A, { schemas: {}, formative: [], originEventId: "event:1" as EventId });
  truth.set(INNATE, A, {});
  return truth;
}

const ctx = (truth: WorldTruth, who: AgentId, now: number) =>
  ({
    scope: who,
    truth,
    now,
    window: 3600,
    rng: Rng.root(7),
  }) as unknown as ProcessContext;

describe("life.decide", () => {
  it("declara lo que lee y lo que escribe, en la fase decide", () => {
    const p = decideProcess(opts);
    expect(p.phase).toBe("decide");
    expect(p.writes).toEqual([NPC_DECISION.name]);
  });

  it("un NPC sediento registra su decisión y la emite una sola vez", () => {
    const p = decideProcess(opts);
    const truth = world(0.5);
    const out = p.run(ctx(truth, A, 1000)) as unknown as {
      changes?: unknown[];
      events?: { kind: string }[];
    };
    expect(out.changes?.length ?? 0).toBeGreaterThan(0);
    expect(out.events?.[0]?.kind).toBe(DECIDED_EVENT);
  });

  it("el personaje del jugador no decide", () => {
    const p = decideProcess(opts);
    expect(p.run(ctx(world(0), PLAYER, 1000))).toEqual({});
  });
});
