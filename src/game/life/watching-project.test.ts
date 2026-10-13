import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK,
  EventLog,
  IdAllocator,
  loadContent,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  ACTIONS,
  BODY_PLANS,
  BODY_STATE,
  ENTITY,
  INNATE,
  LOCATION,
  newBody,
  OPINIONS,
  opinionKey,
  PERSON,
  PLANS,
  type ProcessDef,
  Scheduler,
  SKILL_STATE,
  SKILLS,
  SkillCatalog,
  type Skills,
  type SpaceGraph,
  setComponent,
  TRAITS,
  table,
  WorldTruth,
} from "../../sim/index.ts";
import {
  collectWatchExposures,
  foldWatchExposures,
  type WatchExposure,
  type WatchInput,
  watchersLearn,
} from "./watching.ts";
import { watchingProjectionProcess } from "./watching-project.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS, BODY_PLANS],
  [
    { kind: "actions", file: "a.json", data: json("content/actions/core.json") },
    { kind: "skills", file: "s.json", data: json("content/skills/core.json") },
    { kind: "traits", file: "t.json", data: json("content/traits/human.json") },
    { kind: "body-plans", file: "b.json", data: json("content/body-plans/human.json") },
  ],
);
const catalog = new SkillCatalog(content.all(SKILLS), content.all(ACTIONS));
const observer = makeId("agent", 3);
const first = makeId("agent", 1);
const second = makeId("agent", 2);
const place = { kind: "cell", cell: makeId("cell", 1) } as const;
const DAY = EARTHLIKE_CLOCK.day;
const exposure = (doer = first, verb = "strike"): WatchExposure => ({
  observer,
  doer,
  verb,
  seen: 0.9,
  doerLevel: 0.8,
  seconds: 3600,
  at: DAY,
  student: { z: {}, capabilities: {}, ageYears: 25 },
  opinionNoise: 0,
});

function project(exposures: readonly WatchExposure[], selfSkills?: Skills) {
  const truth = new WorldTruth();
  const log = new EventLog();
  const actor: ProcessDef = {
    id: "life.synthetic_act",
    system: "life",
    scope: "world",
    phase: "act",
    cadence: { local: "day" },
    representation: "individual",
    reads: [],
    writes: [SKILL_STATE.name],
    run: () => ({
      ...(selfSkills === undefined
        ? {}
        : { changes: [setComponent(SKILL_STATE, observer, selfSkills)] }),
      events: exposures.map((cue) => ({
        kind: `action.${cue.verb}`,
        actors: [cue.doer],
        place,
        data: { watchExposures: [cue] },
        emissions: {},
        causes: [{ kind: "seed" as const }],
      })),
    }),
  };
  const scheduler = new Scheduler({
    rng: Rng.root(7),
    clock: EARTHLIKE_CLOCK,
    truth,
    log,
    ids: new IdAllocator(),
    resolution: "local",
    processes: [actor, watchingProjectionProcess({ catalog, clock: EARTHLIKE_CLOCK })],
  });
  scheduler.advanceTo(DAY);
  return truth;
}

describe("proyección única de aprendizaje observado después de act", () => {
  it("dos tipos de acción conservan las dos habilidades y opiniones del mismo observador", () => {
    const truth = project([exposure(first, "strike"), exposure(second, "work")]);
    const strike = catalog.forVerb("strike");
    const work = catalog.forVerb("work");
    if (!strike || !work) throw new Error("catálogo incompleto");
    expect(strike.skill.id).not.toBe(work.skill.id);
    expect(
      truth.get(SKILL_STATE, observer)?.[strike.skill.id]?.facets.reading?.level,
    ).toBeGreaterThan(0);
    expect(
      truth.get(SKILL_STATE, observer)?.[work.skill.id]?.facets.reading?.level,
    ).toBeGreaterThan(0);
    expect(Object.keys(truth.get(OPINIONS, observer) ?? {}).sort()).toEqual(
      [opinionKey(first, strike.skill.id), opinionKey(second, work.skill.id)].sort(),
    );
  });

  it("dos gestos de la misma habilidad acumulan lectura y observaciones", () => {
    const one = project([exposure()]);
    const two = project([exposure(), exposure()]);
    const skill = catalog.forVerb("strike")?.skill.id as string;
    expect(two.get(SKILL_STATE, observer)?.[skill]?.facets.reading?.level).toBeGreaterThan(
      one.get(SKILL_STATE, observer)?.[skill]?.facets.reading?.level ?? 0,
    );
    expect(two.get(OPINIONS, observer)?.[opinionKey(first, skill)]?.samples).toBe(2);
    expect(project([exposure(), exposure()]).get(SKILL_STATE, observer)).toEqual(
      two.get(SKILL_STATE, observer),
    );
  });

  it("conserva el aprendizaje propio asentado en act al sumar lo que miró", () => {
    const skill = catalog.forVerb("strike")?.skill.id as string;
    const self: Skills = {
      [skill]: { facets: { execution: { level: 0.2, peak: 0.2 } }, hours: 10, lastPracticed: DAY },
    };
    const truth = project([exposure()], self);
    expect(truth.get(SKILL_STATE, observer)?.[skill]?.hours).toBe(10);
    expect(truth.get(SKILL_STATE, observer)?.[skill]?.lastPracticed).toBe(DAY);
    expect(truth.get(SKILL_STATE, observer)?.[skill]?.facets.reading?.level).toBeGreaterThan(0);
    expect(
      truth.get(SKILL_STATE, observer)?.[skill]?.facets.execution?.level,
    ).toBeGreaterThanOrEqual(0.2);
  });

  it("sin exposición no escribe tablas ni genera eventos nuevos", () => {
    const truth = project([]);
    expect(truth.ids(SKILL_STATE)).toEqual([]);
    expect(truth.ids(OPINIONS)).toEqual([]);
  });

  it("una acción que pierde la contienda no deja aprendizaje ni opinión", () => {
    const truth = new WorldTruth();
    const log = new EventLog();
    const resource = table<{ holder: string }>("watch_test.resource");
    truth.set(resource, observer, { holder: "none" });
    const actor = (id: string, doer: typeof first, initiative: number): ProcessDef => ({
      id,
      system: "life",
      scope: "world",
      phase: "act",
      cadence: { local: "day" },
      representation: "individual",
      reads: [],
      writes: [resource.name],
      run: () => ({
        changes: [setComponent(resource, observer, { holder: doer })],
        contest: { actor: doer, initiative, place },
        events: [
          {
            kind: "action.strike",
            actors: [doer],
            place,
            data: { watchExposures: [exposure(doer)] },
            emissions: {},
            causes: [{ kind: "seed" }],
          },
        ],
      }),
    });
    const scheduler = new Scheduler({
      rng: Rng.root(7),
      clock: EARTHLIKE_CLOCK,
      truth,
      log,
      ids: new IdAllocator(),
      resolution: "local",
      processes: [
        actor("life.winner", first, 1000),
        actor("life.loser", second, -1000),
        watchingProjectionProcess({ catalog, clock: EARTHLIKE_CLOCK }),
      ],
    });
    scheduler.advanceTo(DAY);
    const skill = catalog.forVerb("strike")?.skill.id as string;
    expect(log.all().filter((e) => e.kind === "action.strike")).toHaveLength(1);
    expect(truth.get(OPINIONS, observer)?.[opinionKey(first, skill)]?.samples).toBe(1);
    expect(truth.get(OPINIONS, observer)?.[opinionKey(second, skill)]).toBeUndefined();
  });
});

describe("captura de percepción en el momento del acto", () => {
  const bodyPlan = content.all(BODY_PLANS)[0];
  if (!bodyPlan) throw new Error("plan corporal ausente");
  const spaces: SpaceGraph = {
    spaces: [
      {
        key: "near",
        kind: "square",
        hex: 0,
        area: 4,
        indoor: false,
        daylight: 1,
        lamp: 0,
        noise: 0,
        clearSight: 1,
      },
    ],
    edges: [],
  };
  const fixture = (): WatchInput => {
    const truth = new WorldTruth();
    for (const id of [first, second, observer]) {
      truth.set(ENTITY, id, { id, originEventId: "event:1", createdAt: 0 } as never);
      truth.set(PERSON, id, { sex: "male", born: -25 * EARTHLIKE_CLOCK.year } as never);
      truth.set(BODY_STATE, id, newBody(bodyPlan, 55, 0));
      truth.set(INNATE, id, {});
      truth.set(LOCATION, id, { hex: 0, space: "near" });
    }
    return {
      truth,
      catalog,
      traits: content.all(TRAITS),
      plans: new Map([[bodyPlan.id, bodyPlan]]),
      clock: EARTHLIKE_CLOCK,
      doer: first,
      verb: "strike",
      doerLevel: 0.8,
      hex: 0,
      light: 1,
      spaces,
      forest: [false],
      emissions: { sight: 1, sound: 1 },
      rng: Rng.root(7),
      seconds: 3600,
      now: DAY,
    };
  };
  it("excluye al actor, al rival y a quien duerme; las señales son JSON sin RNG", () => {
    const input = fixture();
    const truth = input.truth as WorldTruth;
    truth.set(BODY_STATE, second, { ...newBody(bodyPlan, 55, 0), activity: "sleep" });
    const cues = collectWatchExposures(input);
    expect(cues.map((cue) => cue.observer)).toEqual([observer]);
    expect(JSON.parse(JSON.stringify(cues))).toEqual(cues);
    expect(collectWatchExposures({ ...input, except: observer })).toEqual([]);
    expect(collectWatchExposures({ ...input, seconds: 0 })).toEqual([]);
    expect(collectWatchExposures({ ...input, verb: "ponder" })).toEqual([]);
  });
  it("el camino inmediato mantiene el mismo depósito que capturar y plegar una acción", () => {
    const input = fixture();
    const cues = collectWatchExposures(input);
    expect(cues.length).toBeGreaterThan(0);
    expect(watchersLearn(input)).toEqual(
      foldWatchExposures(input.truth, catalog, EARTHLIKE_CLOCK, cues),
    );
  });
  it("la proyección usa lo visto antes de los movimientos o el sueño posteriores", () => {
    const input = fixture();
    const cues = collectWatchExposures(input);
    expect(cues.some((cue) => cue.observer === observer)).toBe(true);
    const truth = input.truth as WorldTruth;
    truth.set(LOCATION, observer, { hex: 99 });
    truth.set(BODY_STATE, observer, { ...newBody(bodyPlan, 55, 0), activity: "sleep" });
    const changes = foldWatchExposures(truth, catalog, EARTHLIKE_CLOCK, cues);
    expect(changes.some((change) => change.id === observer && change.table === OPINIONS.name)).toBe(
      true,
    );
    expect(collectWatchExposures(input).some((cue) => cue.observer === observer)).toBe(false);
  });
});
