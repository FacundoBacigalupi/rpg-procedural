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
import { watchingProjectionProcess } from "./watching-project.ts";

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
const actions = content
  .all(ACTIONS)
  .map((a) => (["take", "gather", "consult"].includes(a.id) ? { ...a, ease: 100 } : a));
const catalog = new ActionCatalog(actions),
  skills = new SkillCatalog(content.all(SKILLS), actions);
const good = ledgerUnit("good:gleanings");
const field = makeId("place", 1);
const place = { kind: "place", place: field } as const;
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

function world(
  verb: "take" | "gather",
  batch = true,
  reverse = false,
  explicitFrom = false,
  single = false,
  caught = false,
  consultation = false,
) {
  const stockUnit = consultation ? ledgerUnit("coin:copper") : good;
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
  for (const n of explicitFrom || consultation ? [1, 2, 3] : [1, 2]) {
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
    if (n === 3) continue;
    truth.set(PLAN_STATE, actor, {
      seq: 1,
      done: false,
      cursor: FRESH_CURSOR,
      lastBelieved: null,
      steps: [],
      plan: {
        actor,
        source: "utility",
        root: {
          kind: "do",
          verb: consultation && n === 2 ? "consult" : verb,
          args: consultation
            ? n === 2
              ? [
                  { role: "with", entity: makeId("agent", 3) },
                  { role: "about", text: "mi futuro" },
                ]
              : [
                  { role: "what", text: "copper" },
                  { role: "from", entity: makeId("agent", 2) },
                ]
            : [
                { role: "what", text: "espigueo" },
                ...(explicitFrom ? [{ role: "from", entity: makeId("agent", 3) }] : []),
              ],
          manner: [],
        },
        manner: [],
        causes: [],
      },
    });
  }
  truth.setRaw(PLACE.name, field, { name: "campo", kind: "fields", hexes: [0] });
  const ledger = new Ledger({ externals: { seed: [stockUnit, good] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      {
        from: externalAccount("seed"),
        to: holderAccount(
          consultation ? makeId("agent", 2) : explicitFrom ? makeId("agent", 3) : place,
        ),
        unit: stockUnit,
        amount: consultation ? 1 : 100,
      },
      ...(consultation
        ? [
            {
              from: externalAccount("seed"),
              to: holderAccount(makeId("agent", 2)),
              unit: good,
              amount: 1,
            },
          ]
        : []),
    ],
  });
  const scheduler = new Scheduler({
    truth,
    log,
    ledger,
    clock,
    rng: Rng.root(7),
    ids: new IdAllocator({ event: 2, agent: explicitFrom ? 4 : 3 }),
    resolution: "local",
    processes: [
      actProcess({
        economicBatch: true,
        projectWatchExposures: true,
        serialEconomicVerbs: batch ? ["take", "gather", "consult"] : ["trade", "give"],
        map,
        spaces: { spaces: [], edges: [] },
        catalog: caught
          ? new ActionCatalog(actions.map((a) => (a.id === "take" ? { ...a, ease: -100 } : a)))
          : catalog,
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
      watchingProjectionProcess({ catalog: skills, clock }),
    ],
  });
  for (const n of single ? [consultation ? 2 : 1] : reverse ? [2, 1] : [1, 2])
    scheduler.schedule({
      at: clock.day / 2,
      phase: "act",
      process: "life.act",
      scope: makeId("agent", n),
      reason: { kind: "state", entity: makeId("agent", n), key: planKey(1) },
    });
  return { truth, log, ledger, scheduler };
}

describe("servicio opt-in de stock público fungible", () => {
  it("consult sin servicio intenta pagar una moneda que otro plan tomó", () => {
    const w = world("take", false, false, false, false, false, true);
    expect(() => w.scheduler.advanceTo(clock.day / 2)).toThrow();
  });
  it("consult reserva el bolsillo restante y conserva ambas agendas", () => {
    const w = world("take", true, false, false, false, false, true);
    w.scheduler.advanceTo(clock.day / 2);
    const coin = ledgerUnit("coin:copper");
    expect(w.log.all().find((e) => e.kind === "action.take")?.data).toMatchObject({
      effect: { got: [{ amount: 1 }] },
    });
    expect(w.ledger.balance(holderAccount(makeId("agent", 1)), coin)).toBe(1);
    expect(w.ledger.balance(holderAccount(makeId("agent", 2)), coin)).toBe(0);
    expect(w.ledger.balance(holderAccount(makeId("agent", 3)), coin)).toBe(0);
    expect(w.ledger.total(coin)).toBe(1);
    expect(w.ledger.audit()).toEqual([]);
    expect(w.log.all().find((e) => e.kind === "action.consult")?.data).toMatchObject({
      failure: "no_means",
      effect: { delivered: false, paid: null },
    });
    expect(w.scheduler.state().queue).toHaveLength(2);
    const reversed = world("take", true, true, false, false, false, true);
    reversed.scheduler.advanceTo(clock.day / 2);
    expect(w.truth.rows()).toEqual(reversed.truth.rows());
    expect(w.log.all()).toEqual(reversed.log.all());
    expect(w.ledger.journal()).toEqual(reversed.ledger.journal());
    w.scheduler.advanceTo(clock.day / 2 + 4 * 3600);
    for (const n of [1, 2]) expect(w.truth.get(PLAN_STATE, makeId("agent", n))?.done).toBe(true);
  });
  it("consult aislada conserva resolución, pago, RNG y agenda legacy", () => {
    const opted = world("take", true, false, false, true, false, true);
    const legacy = world("take", false, false, false, true, false, true);
    opted.scheduler.advanceTo(clock.day / 2);
    legacy.scheduler.advanceTo(clock.day / 2);
    expect(opted.log.all().find((e) => e.kind === "action.consult")?.data).toMatchObject({
      effect: { delivered: true, paid: { unit: "coin:copper", amount: 1 } },
    });
    expect(opted.truth.rows()).toEqual(legacy.truth.rows());
    expect(opted.log.all()).toEqual(legacy.log.all());
    expect(opted.ledger.journal()).toEqual(legacy.ledger.journal());
    expect(opted.scheduler.state()).toEqual(legacy.scheduler.state());
  });
  it.each(["take", "gather"] as const)("reproduce doble débito de %s sin servicio", (verb) => {
    const w = world(verb, false);
    expect(() => w.scheduler.advanceTo(clock.day / 2)).toThrow();
    expect(w.log.all().filter((e) => e.kind === `action.${verb}`)).toHaveLength(2);
  });
  it.each(["take", "gather"] as const)(
    "%s conserva bienes y ambas agendas al agotarse el stock",
    (verb) => {
      const w = world(verb);
      expect(() => w.scheduler.advanceTo(clock.day / 2)).not.toThrow();
      expect(w.ledger.balance(holderAccount(place), good)).toBe(0);
      expect(w.ledger.balance(holderAccount(makeId("agent", 1)), good)).toBe(100);
      expect(w.ledger.balance(holderAccount(makeId("agent", 2)), good)).toBe(0);
      expect(w.scheduler.state().queue).toHaveLength(2);
      expect(w.ledger.total(good)).toBe(100);
      expect(w.ledger.audit()).toEqual([]);
      const other = world(verb, true, true);
      other.scheduler.advanceTo(clock.day / 2);
      expect(w.truth.rows()).toEqual(other.truth.rows());
      expect(w.log.all()).toEqual(other.log.all());
      expect(w.ledger.journal()).toEqual(other.ledger.journal());
      if (verb === "gather" || verb === "take")
        expect(
          w.log.all().find((e) => e.kind === `action.${verb}` && e.actors[0] === makeId("agent", 2))
            ?.outcome,
        ).toBe("failure");
      if (verb === "take") {
        expect(
          w.log.all().find((e) => e.kind === "action.take" && e.actors[0] === makeId("agent", 2))
            ?.data,
        ).toMatchObject({ failure: "no_means" });
        expect(w.truth.get(PLAN_STATE, makeId("agent", 2))?.lastBelieved).toBe("failure");
      }
      w.scheduler.advanceTo(clock.day / 2 + 4 * 3600);
      expect(w.truth.get(PLAN_STATE, makeId("agent", 1))?.done).toBe(true);
      expect(w.truth.get(PLAN_STATE, makeId("agent", 2))?.done).toBe(true);
    },
  );
  it("reproduce doble débito de dos take personales sin reserva compartida", () => {
    const w = world("take", false, false, true);
    expect(() => w.scheduler.advanceTo(clock.day / 2)).toThrow();
    expect(w.log.all().filter((e) => e.kind === "action.take")).toHaveLength(2);
    expect(w.ledger.balance(holderAccount(makeId("agent", 3)), good)).toBe(0);
  });
  it("dos take del mismo bolsillo conservan oposición, stock y agenda", () => {
    const w = world("take", true, false, true);
    w.scheduler.advanceTo(clock.day / 2);
    const actions = w.log.all().filter((e) => e.kind === "action.take");
    expect(actions).toHaveLength(2);
    expect(actions[0]?.data).toMatchObject({
      effect: { from: makeId("agent", 3), got: [{ unit: good, amount: 100 }] },
    });
    expect(actions[1]?.outcome).toBe("failure");
    expect(actions[1]?.data).toMatchObject({ failure: "no_means", effect: { got: [] } });
    expect(w.truth.get(PLAN_STATE, makeId("agent", 2))?.lastBelieved).toBe("failure");
    expect(w.ledger.total(good)).toBe(100);
    expect(w.ledger.audit()).toEqual([]);
    expect(w.scheduler.state().queue).toHaveLength(2);
    w.scheduler.advanceTo(clock.day / 2 + 4 * 3600);
    expect(w.truth.get(PLAN_STATE, makeId("agent", 1))?.done).toBe(true);
    expect(w.truth.get(PLAN_STATE, makeId("agent", 2))?.done).toBe(true);
  });
  it("un take personal aislado conserva exactamente RNG, oposición y consecuencias anteriores", () => {
    const opted = world("take", true, false, true, true),
      legacy = world("take", false, false, true, true);
    opted.scheduler.advanceTo(clock.day / 2);
    legacy.scheduler.advanceTo(clock.day / 2);
    expect(opted.truth.rows()).toEqual(legacy.truth.rows());
    expect(opted.log.all()).toEqual(legacy.log.all());
    expect(opted.ledger.journal()).toEqual(legacy.ledger.journal());
    expect(opted.scheduler.state()).toEqual(legacy.scheduler.state());
  });
  it("la reserva conserva la captura por la víctima en una oposición perdida", () => {
    const opted = world("take", true, false, true, true, true),
      legacy = world("take", false, false, true, true, true);
    opted.scheduler.advanceTo(clock.day / 2);
    legacy.scheduler.advanceTo(clock.day / 2);
    expect(opted.log.all().find((e) => e.kind === "action.take")?.data).toMatchObject({
      noticedBy: [makeId("agent", 3)],
    });
    expect(opted.ledger.balance(holderAccount(makeId("agent", 3)), good)).toBe(100);
    expect(opted.truth.rows()).toEqual(legacy.truth.rows());
    expect(opted.log.all()).toEqual(legacy.log.all());
    expect(opted.ledger.journal()).toEqual(legacy.ledger.journal());
    expect(opted.scheduler.state()).toEqual(legacy.scheduler.state());
  });
});
