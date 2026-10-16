import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK as clock,
  EventLog,
  externalAccount,
  holderAccount,
  IdAllocator,
  Ledger,
  ledgerUnit,
  loadContent,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  BODY_PLANS,
  BODY_STATE,
  ENTITY,
  FRESH_CURSOR,
  type GoodDef,
  INNATE,
  LOCATION,
  type LocalMap,
  newBody,
  PERSON,
  PLACE,
  Scheduler,
  SKILLS,
  SkillCatalog,
  TRAITS,
  WorldTruth,
} from "../../sim/index.ts";
import { actProcess, PLAN_STATE, planKey } from "./act.ts";

// Auditoría (perfil2-personal-resource-claims): el servicio económico reserva cantidades del
// ledger. Un objeto con identidad (ItemId) no vive en el ledger: `take` solo mueve `Holding`
// (unidad, cantidad), así que dos actores que van por la misma espada no entran en ninguna
// contienda; el ítem queda intacto y ambos fracasan por `no_means`. Hueco medido, no implementado.
const files = [
  "content/actions/core.json",
  "content/skills/core.json",
  "content/traits/human.json",
  "content/body-plans/human.json",
];
const content = loadContent(
  [ACTIONS, SKILLS, TRAITS, BODY_PLANS],
  files.map((file) => ({
    kind: file.split("/")[1] as string,
    file,
    data: JSON.parse(readFileSync(file, "utf8")),
  })),
);
const actions = content.all(ACTIONS).map((a) => (a.id === "take" ? { ...a, ease: 100 } : a));
const catalog = new ActionCatalog(actions),
  skills = new SkillCatalog(content.all(SKILLS), actions);
const good = ledgerUnit("good:gleanings");
const field = makeId("place", 1);
const place = { kind: "place", place: field } as const;
const sword = makeId("item", 1);
const map: LocalMap = {
  cell: makeId("cell", 1),
  lonDeg: 0,
  neighbors: [[]],
  crossSeconds: [1],
  forest: [false],
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

function world() {
  const truth = new WorldTruth(),
    log = new EventLog();
  log.append({
    id: makeId("event", 1),
    tick: 0,
    kind: "seed",
    actors: [],
    place,
    data: {},
    emissions: {},
    causes: [{ kind: "seed" }],
    resolution: "local",
  });
  const body = content.all(BODY_PLANS)[0];
  if (!body) throw new Error("sin cuerpo");
  truth.set(ENTITY, sword, { id: sword, createdAt: 0, originEventId: makeId("event", 1) });
  truth.set(LOCATION, sword, { hex: 0 });
  for (const n of [1, 2]) {
    const actor = makeId("agent", n);
    truth.set(ENTITY, actor, { id: actor, createdAt: 0, originEventId: makeId("event", 1) });
    truth.setRaw(PERSON.name, actor, {
      sex: "male",
      born: -30 * clock.year,
      household: makeId("household", n),
    });
    truth.set(BODY_STATE, actor, newBody(body, 55, 0));
    truth.set(INNATE, actor, Object.fromEntries(content.all(TRAITS).map((t) => [t.id, t.mean])));
    truth.set(LOCATION, actor, { hex: 0 });
    truth.set(PLAN_STATE, actor, {
      seq: 1,
      done: false,
      cursor: FRESH_CURSOR,
      lastBelieved: null,
      steps: [],
      plan: {
        actor,
        source: "utility",
        root: { kind: "do", verb: "take", args: [{ role: "what", text: "espada" }], manner: [] },
        manner: [],
        causes: [],
      },
    });
  }
  truth.setRaw(PLACE.name, field, { name: "campo", kind: "fields", hexes: [0] });
  const ledger = new Ledger({ externals: { seed: [good] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      {
        from: externalAccount("seed"),
        to: holderAccount(makeId("agent", 3)),
        unit: good,
        amount: 5,
      },
    ],
  });
  const scheduler = new Scheduler({
    truth,
    log,
    ledger,
    clock,
    rng: Rng.root(7),
    ids: new IdAllocator({ event: 2, agent: 4, item: 2 }),
    resolution: "local",
    processes: [
      actProcess({
        economicBatch: true,
        serialEconomicVerbs: ["take"],
        map,
        spaces: { spaces: [], edges: [] },
        catalog,
        skills,
        traits: content.all(TRAITS),
        bodyPlans: content.all(BODY_PLANS),
        goods: [
          { id: "gleanings", name: "espigueo", form: "good", priceCopperPerKg: 6 },
        ] as GoodDef[],
        foods: [],
        recipes: [],
        statuses: [],
        clock,
        seed: 7,
        player: makeId("agent", 99),
      }),
    ],
  });
  for (const n of [1, 2])
    scheduler.schedule({
      at: clock.day / 2,
      phase: "act",
      process: "life.act",
      scope: makeId("agent", n),
      reason: { kind: "state", entity: makeId("agent", n), key: planKey(1) },
    });
  return { truth, log, ledger, scheduler };
}

describe("auditoría: objetos con identidad fuera del servicio de cantidades", () => {
  it("dos take de la misma espada fracasan sin claim ni contienda y el ítem no se mueve", () => {
    const w = world();
    const before = w.truth.get(LOCATION, sword);
    const journal = w.ledger.journal().length;
    w.scheduler.advanceTo(clock.day / 2);
    const takes = w.log.all().filter((e) => e.kind === "action.take");
    expect(takes).toHaveLength(2);
    for (const t of takes) {
      expect(t.outcome).toBe("failure");
      expect(t.data).toMatchObject({ failure: "no_means", effect: { got: [] } });
    }
    expect(w.truth.get(LOCATION, sword)).toEqual(before);
    expect(w.ledger.journal()).toHaveLength(journal);
    expect(w.ledger.audit()).toEqual([]);
  });
  it("el ítem no tiene cuenta en el ledger: nada reserva su titularidad", () => {
    const w = world();
    w.scheduler.advanceTo(clock.day / 2);
    expect(w.ledger.holdings(holderAccount(place))).toEqual([]);
    expect(w.ledger.holdings(holderAccount(makeId("agent", 1)))).toEqual([]);
    expect(w.ledger.holdings(holderAccount(makeId("agent", 2)))).toEqual([]);
  });
});
