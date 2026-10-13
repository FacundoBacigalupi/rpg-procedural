import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  EARTHLIKE_CLOCK,
  type EntityBase,
  type EventId,
  externalAccount,
  type HolderRef,
  holderAccount,
  Ledger,
  ledgerUnit,
  loadContent,
  makeId,
  type PlaceId,
  type PlaceRef,
  Rng,
  type Tick,
} from "../../core/index.ts";
import {
  BODY_PLANS,
  BODY_STATE,
  type BodyPlanDef,
  ENTITY,
  FRESH_CURSOR,
  LOCATION,
  type LocalMap,
  newBody,
  PERSON,
  type ProcessContext,
  type ProcessResult,
  WorldTruth,
} from "../../sim/index.ts";
import { PLAN_STATE } from "./act.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
import {
  ASLEEP,
  CAUGHT_UP_EVENT,
  catchUpProcess,
  hexesWithin,
  sleepPolicyProcess,
  sleepWant,
  sleepWorkPending,
} from "./sleepers.ts";

const content = loadContent(
  [BODY_PLANS],
  [
    {
      kind: "body-plans",
      file: "b.json",
      data: JSON.parse(readFileSync("content/body-plans/human.json", "utf8")),
    },
  ],
);
const plan = content.all(BODY_PLANS)[0] as BodyPlanDef;
const me = makeId("agent", 1);
const mate = makeId("agent", 2);
const player = makeId("agent", 99);
const home = "household:1";
const grain = ledgerUnit("good:grain");
const site = { kind: "place", place: "place:1" as PlaceId } satisfies PlaceRef;
const DAY = EARTHLIKE_CLOCK.day;

const options = {
  plans: [plan],
  clock: EARTHLIKE_CLOCK,
  lonDeg: 0,
  ration: { unit: "good:grain", kcalPerGram: 3.6, waterPerGram: 0.1 },
  player,
  placeOf: () => site,
};

function setup(stock: number, withMate = false) {
  const truth = new WorldTruth();
  const people = withMate ? [me, mate] : [me];
  for (const id of people) {
    truth.set(ENTITY, id, {
      id,
      originEventId: makeId("event", 1),
      createdAt: 0,
    } satisfies EntityBase);
    truth.set(PERSON, id, { born: -30 * 365 * DAY, household: home, sex: "male" } as never);
  }
  truth.set(BODY_STATE, me, newBody(plan, 60, 0));
  truth.set(ASLEEP, me, { since: 0 as Tick, lastAdvanced: 0 as Tick });
  const ledger = new Ledger({ externals: { seed: ["good:grain"], eaten: ["good:grain"] } });
  const larder = holderAccount(home as unknown as HolderRef);
  if (stock > 0) {
    ledger.post({
      tick: 0,
      eventId: makeId("event", 1),
      transfers: [{ unit: grain, from: externalAccount("seed"), to: larder, amount: stock }],
    });
  }
  return { truth, ledger, larder };
}

function run(truth: WorldTruth, ledger: Ledger, now: Tick, who: AgentId = me): ProcessResult {
  return catchUpProcess(options).run({
    now,
    window: DAY,
    windowIndex: 1,
    scope: who,
    resolution: "local",
    phase: "decide",
    truth,
    ledger,
    rng: Rng.root(1),
    item: undefined,
    recent: [],
    newId() {
      throw new Error("no crea entidades");
    },
  } as unknown as ProcessContext);
}

/** Lo que dice el resumen de la puesta al día: comidas y gramos. */
function summaryOf(out: ProcessResult): { meals: number; grams: number } {
  const e = out.events?.find((x) => x.kind === CAUGHT_UP_EVENT);
  if (!e) throw new Error("sin resumen de puesta al día");
  return e.data as { meals: number; grams: number };
}

/** Asienta lo que devolvió el proceso, como lo haría el scheduler. */
function settle(truth: WorldTruth, ledger: Ledger, out: ProcessResult, tick: Tick) {
  for (const c of out.changes ?? []) {
    if (c.op === "delete") truth.deleteRaw(c.table, c.id);
    else if (c.op === "set") truth.setRaw(c.table, c.id, c.value);
  }
  let n = 100;
  for (const p of out.postings ?? []) {
    const eventId = `event:${n++}` as EventId;
    ledger.post({ tick, eventId, transfers: p.transfers });
  }
}

describe("life.catch_up: el dormido se pone al día con la despensa", () => {
  it("come lo que comería, sale del ledger hacia eaten y todo cierra", () => {
    const { truth, ledger, larder } = setup(100_000);
    const out = run(truth, ledger, (3 * DAY) as Tick);
    const summary = out.events?.find((e) => e.kind === CAUGHT_UP_EVENT);
    expect(summary?.data).toMatchObject({ from: 0, to: 3 * DAY, meals: 9 });
    const grams = summaryOf(out).grams;
    expect(grams).toBeGreaterThan(0);
    expect(summary?.causes).toEqual([{ kind: "state", entity: me, key: "routine" }]);
    settle(truth, ledger, out, (3 * DAY) as Tick);
    expect(ledger.balance(larder, grain)).toBe(100_000 - grams);
    expect(ledger.balance(externalAccount("eaten"), grain)).toBe(grams);
    // Lo que salió de la despensa es exactamente lo que entró en `eaten`: nada se pierde ni se crea.
    expect(ledger.balance(larder, grain) + ledger.balance(externalAccount("eaten"), grain)).toBe(
      100_000,
    );
    expect(ledger.audit()).toEqual([]);
    expect(truth.get(BODY_STATE, me)?.updatedAt).toBe(3 * DAY);
    expect(truth.get(ASLEEP, me)).toEqual({ since: 0, lastAdvanced: 3 * DAY });
  });

  it("si la despensa no alcanza, come menos: no se inventa la comida ni queda en negativo", () => {
    const one = setup(100_000);
    const day = summaryOf(run(one.truth, one.ledger, DAY as Tick));
    const gramsPerMeal = day.grams / day.meals;
    const { truth, ledger, larder } = setup(Math.floor(gramsPerMeal * 2.5));
    const out = run(truth, ledger, (3 * DAY) as Tick);
    const data = summaryOf(out);
    expect(data.meals).toBe(2);
    settle(truth, ledger, out, (3 * DAY) as Tick);
    expect(ledger.balance(larder, grain)).toBeGreaterThanOrEqual(0);
    expect(ledger.audit()).toEqual([]);
    // Con otra boca en la casa, la ración se reparte: le toca la mitad.
    const shared = setup(Math.floor(gramsPerMeal * 2.5), true);
    const sharedOut = run(shared.truth, shared.ledger, (3 * DAY) as Tick);
    expect(summaryOf(sharedOut).meals).toBe(1);
  });

  it("sin comida en semanas muere con su causa y la entidad termina", () => {
    const { truth, ledger } = setup(0);
    const out = run(truth, ledger, (90 * DAY) as Tick);
    const died = out.events?.find((e) => e.kind === "body.died");
    expect(died?.data).toMatchObject({ cause: expect.any(String) });
    expect(out.postings ?? []).toEqual([]);
    settle(truth, ledger, out, (90 * DAY) as Tick);
    expect(truth.get(ENTITY, me)?.endedAt).toBeDefined();
    expect(ledger.audit()).toEqual([]);
  });

  it("sin registro, el personaje o ya al día, no hace nada", () => {
    const { truth, ledger } = setup(1000);
    truth.deleteRaw(ASLEEP.name, me);
    expect(run(truth, ledger, (3 * DAY) as Tick)).toEqual({});
    const other = setup(1000);
    expect(run(other.truth, other.ledger, 0 as Tick)).toEqual({});
    expect(run(other.truth, other.ledger, DAY as Tick, player)).toEqual({});
  });

  it("sin pedido de despertar espera al día; con pedido se pone al día ya y el registro se borra", () => {
    const { truth, ledger } = setup(100_000);
    // A las tres horas todavía no toca (cadencia gruesa).
    expect(run(truth, ledger, (3 * 3600) as Tick)).toEqual({});
    // Con el pedido, a las tres horas lo pone al día y lo despierta.
    truth.set(ASLEEP, me, { since: 0 as Tick, lastAdvanced: 0 as Tick, wake: true });
    const out = run(truth, ledger, (3 * 3600) as Tick);
    expect(summaryOf(out).meals).toBeGreaterThanOrEqual(0);
    settle(truth, ledger, out, (3 * 3600) as Tick);
    expect(truth.get(ASLEEP, me)).toBeUndefined();
    expect(truth.get(BODY_STATE, me)?.updatedAt).toBe(3 * 3600);
    expect(ledger.audit()).toEqual([]);
  });

  it("es determinista", () => {
    const a = setup(100_000);
    const b = setup(100_000);
    expect(run(a.truth, a.ledger, (5 * DAY) as Tick)).toEqual(
      run(b.truth, b.ledger, (5 * DAY) as Tick),
    );
  });
});

describe("quién duerme y cuándo despierta", () => {
  // Una línea de diez hexes: 0-1-2-…-9.
  const line = {
    neighbors: Array.from({ length: 10 }, (_, i) => [i - 1, i + 1].filter((n) => n >= 0 && n < 10)),
    crossSeconds: Array.from({ length: 10 }, () => 1000),
  } as unknown as LocalMap;

  it("los hexes cerca del jugador se cuentan por pasos", () => {
    expect([...hexesWithin(line, 4, 0)]).toEqual([4]);
    expect([...hexesWithin(line, 4, 2)].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6]);
    expect([...hexesWithin(line, 0, 1)].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it("solo duerme quien está lejos, sin vínculo, sin importancia y sin nada pendiente", () => {
    const base = { nearPlayer: false, bondedToPlayer: false, important: false, pending: false };
    expect(sleepWant(base)).toBe(true);
    expect(sleepWant({ ...base, nearPlayer: true })).toBe(false);
    expect(sleepWant({ ...base, bondedToPlayer: true })).toBe(false);
    expect(sleepWant({ ...base, important: true })).toBe(false);
    expect(sleepWant({ ...base, pending: true })).toBe(false);
  });

  function policyWorld(npcHex: number) {
    const { truth } = setup(1000);
    truth.deleteRaw(ASLEEP.name, me);
    truth.set(ENTITY, player, {
      id: player,
      originEventId: makeId("event", 1),
      createdAt: 0,
    } satisfies EntityBase);
    truth.set(LOCATION, player, { hex: 0 });
    truth.set(LOCATION, me, { hex: npcHex });
    return truth;
  }
  function policy(
    truth: WorldTruth,
    extra: { bonded?: boolean; important?: boolean; pending?: boolean } = {},
  ): ProcessResult {
    return sleepPolicyProcess({
      player,
      map: line,
      near: 2,
      bonded: () => extra.bonded ?? false,
      important: () => extra.important ?? false,
      pending: (t, who) => extra.pending ?? sleepWorkPending(t, who),
    }).run({
      now: 7200,
      window: 3600,
      windowIndex: 1,
      scope: me,
      resolution: "local",
      phase: "perceive",
      truth,
      ledger: undefined,
      rng: Rng.root(1),
      item: undefined,
      recent: [],
      newId() {
        throw new Error("no crea entidades");
      },
    } as unknown as ProcessContext);
  }
  function put(truth: WorldTruth, out: ProcessResult) {
    for (const c of out.changes ?? []) if (c.op === "set") truth.setRaw(c.table, c.id, c.value);
  }

  it("lejos se registra dormido desde donde estaba su cuerpo; cerca o con vínculo, no", () => {
    const far = policyWorld(7);
    put(far, policy(far));
    expect(far.get(ASLEEP, me)).toEqual({ since: 7200, lastAdvanced: 0 });
    for (const extra of [{ bonded: true }, { important: true }, { pending: true }]) {
      const t = policyWorld(7);
      expect(policy(t, extra)).toEqual({});
    }
    expect(policy(policyWorld(2))).toEqual({});
  });

  it("un plan activo o viaje lejano exige trabajo individual hasta terminar", () => {
    const t = policyWorld(7);
    expect(sleepWorkPending(t, me)).toBe(false);
    t.set(PLAN_STATE, me, {
      seq: 1,
      plan: {
        actor: me,
        source: "player",
        root: { kind: "do", verb: "look", args: [], manner: [] },
        manner: [],
        causes: [],
      },
      cursor: FRESH_CURSOR,
      lastBelieved: null,
      steps: [],
      done: false,
    });
    expect(sleepWorkPending(t, me)).toBe(true);
    expect(policy(t)).toEqual({});
    const active = t.get(PLAN_STATE, me);
    if (!active) throw new Error("sin plan");
    t.set(PLAN_STATE, me, { ...active, done: true });
    expect(sleepWorkPending(t, me)).toBe(false);
    put(t, policy(t));
    expect(t.get(ASLEEP, me)).toBeDefined();
    t.set(NPC_JOURNEY, me, { place: "place:1", since: 7200, decision: "go" });
    expect(sleepWorkPending(t, me)).toBe(true);
    put(t, policy(t));
    expect(t.get(ASLEEP, me)?.wake).toBe(true);
    expect(t.get(PLAN_STATE, me)?.done).toBe(true);
    expect(t.get(NPC_JOURNEY, me)?.decision).toBe("go");
  });

  it("si el jugador se acerca pide despertar; si vuelve a alejarse, lo cancela", () => {
    const t = policyWorld(7);
    put(t, policy(t));
    t.set(LOCATION, me, { hex: 1 });
    put(t, policy(t));
    expect(t.get(ASLEEP, me)?.wake).toBe(true);
    // El pedido se repite sin escribir de nuevo.
    expect(policy(t)).toEqual({});
    t.set(LOCATION, me, { hex: 8 });
    put(t, policy(t));
    expect(t.get(ASLEEP, me)?.wake).toBe(false);
  });

  it("el personaje, un muerto o quien no tiene posición no se tocan", () => {
    const t = policyWorld(7);
    t.deleteRaw(LOCATION.name, me);
    expect(policy(t)).toEqual({});
    const dead = policyWorld(7);
    dead.set(ENTITY, me, { id: me, originEventId: makeId("event", 1), createdAt: 0, endedAt: 5 });
    expect(policy(dead)).toEqual({});
  });
});
