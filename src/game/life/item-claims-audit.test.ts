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
  ITEM_HOLD,
  type ItemRight,
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
import { optInParts } from "./create.ts";

// Auditoría (perfil2-personal-resource-claims; invertida en perfil2-item-claims-take-audit con itemClaims): el servicio económico reserva cantidades del
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
const actions = content
  .all(ACTIONS)
  .map((a) => (a.id === "take" || a.id === "give" ? { ...a, ease: 100 } : a));
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

function world(itemClaims = false, gift = false, rights: ItemRight[] = []) {
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
  if (gift) truth.set(ITEM_HOLD, sword, { possession: makeId("agent", 1), rights });
  else truth.set(LOCATION, sword, { hex: 0 });
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
        root: {
          kind: "do",
          verb: gift ? "give" : "take",
          args: gift
            ? [
                { role: "what", entity: sword },
                { role: "to", entity: makeId("agent", 2) },
              ]
            : [itemClaims ? { role: "what", entity: sword } : { role: "what", text: "espada" }],
          manner: [],
        },
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
        ...(itemClaims ? { itemClaims: true } : {}),
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
  for (const n of gift ? [1] : [1, 2])
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

describe("claims de ítems (opt-in itemClaims)", () => {
  const run = () => {
    const w = world(true);
    w.scheduler.advanceTo(clock.day / 2);
    return w;
  };
  const takes = (w: ReturnType<typeof world>) =>
    w.log.all().filter((e) => e.kind === "action.take");

  it("dos planes reales sobre una espada: exactamente un ganador y fracaso explícito del otro", () => {
    for (const seed of [7]) {
      const w = run();
      const claimedOf = (e: { data: unknown }) =>
        (e.data as { effect: { claimed: boolean } }).effect.claimed;
      const win = takes(w).filter(claimedOf);
      const lose = takes(w).filter((e) => !claimedOf(e));
      expect(takes(w)).toHaveLength(2);
      expect(win).toHaveLength(1);
      expect(lose).toHaveLength(1);
      expect(lose?.[0]?.data).toMatchObject({ failure: "lost_race", effect: { claimed: false } });
      const contest = w.log.all().find((e) => e.kind === "contest");
      expect(lose?.[0]?.causes).toContainEqual({ kind: "event", event: contest?.id });
      const holder = win?.[0]?.actors[0];
      expect(w.truth.get(ITEM_HOLD, sword)?.possession).toBe(holder);
      expect(w.truth.get(LOCATION, sword)).toBeUndefined();
      expect(seed).toBe(7);
    }
  });

  it("conserva origen, ledger y avanza el plan del perdedor", () => {
    const w = world(true);
    const origin = w.truth.get(ENTITY, sword);
    const journal = w.ledger.journal().length;
    w.scheduler.advanceTo(clock.day / 2);
    expect(w.truth.get(ENTITY, sword)).toEqual(origin);
    expect(w.ledger.journal()).toHaveLength(journal);
    expect(w.ledger.audit()).toEqual([]);
    for (const n of [1, 2]) {
      const plan = w.truth.get(PLAN_STATE, makeId("agent", n));
      expect(plan?.steps.length).toBe(1);
    }
  });

  it("es determinista", () => {
    const a = run();
    const b = run();
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.truth.get(ITEM_HOLD, sword)).toEqual(b.truth.get(ITEM_HOLD, sword));
  });
});

describe("entrega de ítems (give, opt-in itemClaims)", () => {
  it("entrega la posesión física al receptor y deja los derechos donde estaban", () => {
    const w = world(true, true);
    const origin = w.truth.get(ENTITY, sword);
    w.scheduler.advanceTo(clock.day / 2);
    const gives = w.log.all().filter((e) => e.kind === "action.give");
    expect(gives).toHaveLength(1);
    expect(gives[0]?.data).toMatchObject({ effect: { item: sword, delivered: true } });
    expect(w.truth.get(ITEM_HOLD, sword)).toEqual({
      possession: makeId("agent", 2),
      rights: [],
    });
    expect(w.truth.get(LOCATION, sword)).toBeUndefined();
    expect(w.truth.get(ENTITY, sword)).toEqual(origin);
    expect(w.ledger.audit()).toEqual([]);
  });
  const origin = makeId("event", 1);
  const ownership: ItemRight = {
    key: "ownership",
    holder: makeId("agent", 1),
    incidents: ["possess", "use", "alienate"],
    tenure: "personal",
    record: { kind: "custom", witnesses: [], event: origin },
    norm: "village",
    originEventId: origin,
    share: 0.5,
    encumbrances: [],
  };
  const kept: ItemRight = { ...ownership, key: "coowner", holder: makeId("agent", 3) };
  it("dona el haz del que da, con la cuota y el evento de la entrega; el ajeno queda", () => {
    const w = world(true, true, [ownership, kept]);
    w.scheduler.advanceTo(clock.day / 2);
    const give = w.log.all().find((e) => e.kind === "action.give");
    const hold = w.truth.get(ITEM_HOLD, sword);
    expect(hold?.possession).toBe(makeId("agent", 2));
    expect(hold?.rights[0]).toMatchObject({
      holder: makeId("agent", 2),
      share: 0.5,
      record: { kind: "custom", event: give?.id },
    });
    expect(hold?.rights[1]).toEqual(kept);
  });
  it("una carga que impide enajenar: entrega la posesión pero no el haz", () => {
    const encumbered = { ...ownership, encumbrances: [{ key: "lien", originEventId: origin }] };
    const w = world(true, true, [encumbered]);
    w.scheduler.advanceTo(clock.day / 2);
    expect(w.truth.get(ITEM_HOLD, sword)).toEqual({
      possession: makeId("agent", 2),
      rights: [encumbered],
    });
  });
  it("sin alienate no dona", () => {
    const loan = { ...ownership, incidents: ["possess" as const, "use" as const] };
    const w = world(true, true, [loan]);
    w.scheduler.advanceTo(clock.day / 2);
    expect(w.truth.get(ITEM_HOLD, sword)?.rights).toEqual([loan]);
    expect(w.truth.get(ITEM_HOLD, sword)?.possession).toBe(makeId("agent", 2));
  });
  it("es determinista", () => {
    const run = () => {
      const w = world(true, true, [ownership, kept]);
      w.scheduler.advanceTo(clock.day / 2);
      return w;
    };
    expect(run().log.all()).toEqual(run().log.all());
  });
});

describe("itemClaims como opción de la vida", () => {
  it("apagado por defecto: sin la opción no hay parte nueva", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ itemClaims: false })).toEqual({});
    expect(optInParts({ itemClaims: true })).toEqual({ itemClaims: true });
  });
});
