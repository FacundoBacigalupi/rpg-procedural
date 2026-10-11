import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type Event,
  type EventId,
  loadContent,
  makeId,
  type PlaceId,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  ACTIONS,
  PLANS,
  type ProcessContext,
  type ProcessResult,
  SKILLS,
  SkillCatalog,
  TRAITS,
  WorldTruth,
} from "../../sim/index.ts";
import { PRACTICE_LOG, PRACTICE_LOG_CAPACITY, practiceLogProcess } from "./practice-log.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS],
  [
    { kind: "traits", file: "t.json", data: json("content/traits/human.json") },
    { kind: "actions", file: "a.json", data: json("content/actions/core.json") },
    { kind: "skills", file: "s.json", data: json("content/skills/core.json") },
    { kind: "plans", file: "p.json", data: json("content/plans/steal.json") },
  ],
);
const skills = new SkillCatalog(content.all(SKILLS), content.all(ACTIONS));
const me = makeId("agent", 1);
const site = { kind: "place", place: "place:1" as PlaceId } satisfies PlaceRef;

const act = (n: number, verb: string, seconds: number, actor: AgentId = me): Event => ({
  id: makeId("event", n),
  tick: n * 100,
  kind: `action.${verb}`,
  actors: [actor],
  place: site,
  data: { verb, seconds },
  emissions: {},
  causes: [],
  resolution: "local",
});

function run(truth: WorldTruth, recent: readonly Event[]): ProcessResult {
  const ctx = {
    now: 1000,
    window: 0,
    windowIndex: undefined,
    scope: "world",
    resolution: "local",
    phase: "perceive",
    truth,
    ledger: undefined,
    rng: Rng.root(5),
    item: undefined,
    recent,
    newId() {
      throw new Error("no crea entidades");
    },
  } as unknown as ProcessContext;
  return practiceLogProcess({ skills }).run(ctx);
}

function apply(truth: WorldTruth, out: ProcessResult) {
  for (const c of out.changes ?? []) if (c.op === "set") truth.setRaw(c.table, c.id, c.value);
}

describe("life.practice_log", () => {
  it("anota solo acciones propias de verbos con habilidad, con su evento y las horas", () => {
    const truth = new WorldTruth();
    const out = run(truth, [
      act(1, "work", 7200),
      act(2, "wait", 3600),
      act(3, "work", 0),
      { ...act(4, "work", 3600), actors: ["place:1" as never] },
      { ...act(5, "work", 3600), kind: "body.died" },
    ]);
    apply(truth, out);
    const items = truth.get(PRACTICE_LOG, me)?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ event: makeId("event", 1), at: 100 });
    expect(items[0]?.hours).toBeGreaterThan(0);
    expect(run(new WorldTruth(), [act(9, "wait", 3600)])).toEqual({});
  });

  it("no repite un evento y conserva solo las sesiones más recientes", () => {
    const truth = new WorldTruth();
    apply(truth, run(truth, [act(1, "work", 3600)]));
    apply(truth, run(truth, [act(1, "work", 3600)]));
    expect(truth.get(PRACTICE_LOG, me)?.items).toHaveLength(1);
    const many = Array.from({ length: PRACTICE_LOG_CAPACITY + 5 }, (_, i) =>
      act(10 + i, "work", 3600),
    );
    apply(truth, run(truth, many));
    const items = truth.get(PRACTICE_LOG, me)?.items ?? [];
    expect(items).toHaveLength(PRACTICE_LOG_CAPACITY);
    expect(items[items.length - 1]?.event).toBe(many[many.length - 1]?.id as EventId);
  });
});
