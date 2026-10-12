import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  EARTHLIKE_CLOCK,
  EventLog,
  externalAccount,
  holderAccount,
  IdAllocator,
  Ledger,
  ledgerUnit,
  loadContent,
  makeId,
  Rng,
  type Tick,
} from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  BODY_PLANS,
  BODY_STATE,
  checkInvariants,
  ENTITY,
  FOODS,
  GOODS,
  HOUSEHOLD,
  INNATE,
  LOCATION,
  type LocalMap,
  newBody,
  PERSON,
  PLACE,
  planFromDraft,
  Scheduler,
  SKILLS,
  SkillCatalog,
  TRAITS,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { actProcess, PLAN_STATE } from "./act.ts";
import { NPC_DECISION } from "./decide.ts";
import { NPC_JOURNEY, npcVerbsProcess } from "./npc-verbs.ts";
import { FULL_PROFILE } from "./profile.ts";
import { ASLEEP, sleepPolicyProcess, sleepWorkPending } from "./sleepers.ts";
import { transitProcess } from "./transit.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path, root);
    return entry.name.endsWith(".json")
      ? [
          {
            kind: relative(root, dir).split("\\").join("/"),
            file: path,
            data: JSON.parse(readFileSync(path, "utf8")),
          },
        ]
      : [];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const clock = EARTHLIKE_CLOCK;
const actor = makeId("agent", 1);
const player = makeId("agent", 2);
const home = makeId("household", 1);
const destination = makeId("place", 1);
const grain = ledgerUnit("good:grain");
const map: LocalMap = {
  cell: makeId("cell", 1),
  lonDeg: 0,
  neighbors: [[1], [0, 2], [1, 3], [2, 4], [3]],
  crossSeconds: [6 * 3600, 6 * 3600, 6 * 3600, 6 * 3600, 6 * 3600],
  forest: [false, false, false, false, false],
  climate: {
    cell: "cell:1",
    latDeg: 0,
    axialTiltDeg: 23,
    annualMeanC: 20,
    seasonalRangeC: 5,
    annualPrecipMm: 800,
    windEast: 1,
    windNorth: 0,
  },
};

function directedJourney() {
  const truth = new WorldTruth();
  const log = new EventLog();
  log.append({
    id: makeId("event", 1),
    tick: 0,
    kind: "test.journey_setup",
    actors: [],
    place: { kind: "cell", cell: map.cell },
    causes: [{ kind: "seed" }],
    data: {},
    emissions: {},
    resolution: "local",
  });
  for (const id of [actor, player, home, destination])
    truth.set(ENTITY, id, { id, createdAt: 0, originEventId: makeId("event", 1) });
  truth.set(HOUSEHOLD, home, { settlement: makeId("settlement", 1), members: [actor] });
  truth.set(PERSON, actor, {
    sex: "male",
    born: (-25 * clock.year) as Tick,
    mother: null,
    father: null,
    spouse: null,
    household: home,
  });
  truth.set(LOCATION, actor, { hex: 0 });
  truth.set(LOCATION, player, { hex: 0 });
  truth.set(PLACE, destination, { kind: "village", hexes: [4] });
  const bodyPlan = content.all(BODY_PLANS)[0];
  if (!bodyPlan) throw new Error("sin plan corporal");
  truth.set(BODY_STATE, actor, newBody(bodyPlan, 55, 0));
  truth.set(
    INNATE,
    actor,
    Object.fromEntries(content.all(TRAITS).map((trait) => [trait.id, trait.mean])),
  );
  const catalog = new ActionCatalog(content.all(ACTIONS));
  const skills = new SkillCatalog(content.all(SKILLS), content.all(ACTIONS));
  const validated = planFromDraft(
    {
      kind: "act",
      plan: {
        kind: "do",
        verb: "move",
        args: [
          { role: "to", ref: { text: "otra aldea", kind: "place", features: ["otra aldea"] } },
        ],
      },
    },
    {
      actor,
      source: "utility",
      catalog,
      clock,
      causes: [{ kind: "event", event: makeId("event", 1) }],
      here: 0,
      known: [
        {
          ref: destination,
          kind: "place",
          names: ["otra aldea"],
          features: [],
          relations: [],
          present: false,
          hexes: [4],
          via: [],
        },
      ],
    },
  );
  if (validated.kind !== "plan") throw new Error("destino no validado");
  truth.set(NPC_DECISION, actor, {
    at: 0,
    id: `move:${destination}`,
    verb: "move",
    target: destination,
    utility: 1,
    options: 1,
  });
  const ledger = new Ledger({ externals: { seed: [grain], eaten: [grain] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      { unit: grain, from: externalAccount("seed"), to: holderAccount(home), amount: 10_000 },
    ],
  });
  const food = content.all(GOODS).find((good) => good.id === FULL_PROFILE.npcProvisions.good);
  if (!food) throw new Error("sin provisión del perfil");
  const scheduler = new Scheduler({
    rng: Rng.root(7),
    clock,
    truth,
    log,
    ledger,
    ids: new IdAllocator({ event: 2 }),
    resolution: "local",
    scopes: () => [actor],
    processes: [
      npcVerbsProcess({
        catalog,
        verbs: FULL_PROFILE.npcVerbs,
        day: clock.day,
        player,
        journeyDays: FULL_PROFILE.npcJourneyDays,
        transit: true,
        pace: FULL_PROFILE.npcPace,
        sleepers: true,
        nightRest: { clock, lonDeg: 0 },
        placeOf: () => ({ kind: "cell", cell: map.cell }),
        provisions: {
          unit: grain,
          name: food.name,
          grams: FULL_PROFILE.npcProvisions.grams,
          clock,
          lonDeg: 0,
        },
      }),
      actProcess({
        map,
        spaces: { spaces: [], edges: [] },
        catalog,
        skills,
        traits: content.all(TRAITS),
        bodyPlans: content.all(BODY_PLANS),
        goods: content.all(GOODS),
        foods: content.all(FOODS),
        recipes: [],
        statuses: [],
        clock,
        seed: 7,
        player,
        effortByManner: true,
        footwear: true,
      }),
      transitProcess({ map, player }),
      sleepPolicyProcess({
        player,
        map,
        near: FULL_PROFILE.sleepers.near,
        bonded: () => false,
        important: () => false,
        pending: sleepWorkPending,
      }),
    ],
  });
  return { truth, log, ledger, scheduler, validated };
}

describe("cobertura dirigida de viaje con procesos reales y opciones del perfil", () => {
  it("abre, avanza, come y llega, conservando provisiones y causas", () => {
    const w = directedJourney();
    w.scheduler.advanceTo(3600);
    expect(w.truth.get(NPC_JOURNEY, actor)).toBeDefined();
    expect(w.ledger.balance(holderAccount(actor), grain)).toBe(FULL_PROFILE.npcProvisions.grams);
    let progressed = false;
    for (let hour = 2; hour <= 120; hour++) {
      w.scheduler.advanceTo(hour * 3600);
      const hex = w.truth.get(LOCATION, actor)?.hex;
      progressed ||= hex !== undefined && hex > 0;
      if (w.truth.get(NPC_JOURNEY, actor)) expect(w.truth.has(ASLEEP, actor)).toBe(false);
    }
    const journeyEvents = w.log.all().filter((e) => e.kind === "npc.journey");
    expect(journeyEvents.map((e) => (e.data as { what: string }).what)).toEqual([
      "started",
      "arrived",
    ]);
    expect(progressed).toBe(true);
    expect(w.truth.get(LOCATION, actor)?.hex).toBe(4);
    expect(w.truth.get(NPC_JOURNEY, actor)).toBeUndefined();
    expect(w.log.all().some((e) => e.kind === "action.eat")).toBe(true);
    expect(w.log.all().some((e) => e.kind === "action.rest")).toBe(true);
    expect(
      w.log
        .all()
        .filter((e) => e.kind === "action.move")
        .every((e) => (e.data as { manner?: string[] }).manner?.includes(FULL_PROFILE.npcPace)),
    ).toBe(true);
    expect(w.ledger.balance(holderAccount(actor), grain)).toBe(0);
    expect(w.ledger.total(grain) + w.ledger.balance(externalAccount("eaten"), grain)).toBe(10_000);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(w.truth.get(PLAN_STATE, actor)?.plan.root.kind).toBe("do");
  });

  it("la misma decisión validada y seed repiten eventos, filas y ledger", () => {
    const a = directedJourney();
    const b = directedJourney();
    a.scheduler.advanceTo(5 * clock.day);
    b.scheduler.advanceTo(5 * clock.day);
    expect(a.validated).toEqual(b.validated);
    expect(a.truth.rows()).toEqual(b.truth.rows());
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.ledger.journal()).toEqual(b.ledger.journal());
  });
});
