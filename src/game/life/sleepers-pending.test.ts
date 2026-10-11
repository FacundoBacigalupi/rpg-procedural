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
  assignPendingFact,
  BODY_PLANS,
  BODY_STATE,
  type BodyPlanDef,
  ENTITY,
  newBody,
  PENDING_FACTS,
  PERSON,
  type PendingFact,
  type ProcessContext,
  type ProcessResult,
  WorldTruth,
} from "../../sim/index.ts";
import { ASLEEP, catchUpProcess, PENDING_APPLIED_EVENT } from "./sleepers.ts";

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
const home = "household:1";
const DAY = EARTHLIKE_CLOCK.day;
const site = { kind: "place", place: "place:1" as PlaceId } satisfies PlaceRef;
const raid = makeId("event", 7);

function world() {
  const truth = new WorldTruth();
  truth.set(ENTITY, me, {
    id: me,
    originEventId: makeId("event", 1),
    createdAt: 0,
  } satisfies EntityBase);
  truth.set(PERSON, me, { born: -30 * 365 * DAY, household: home, sex: "male" } as never);
  truth.set(BODY_STATE, me, newBody(plan, 60, 0));
  truth.set(ASLEEP, me, { since: 0 as Tick, lastAdvanced: 0 as Tick });
  const ledger = new Ledger({ externals: { seed: ["good:grain"], eaten: ["good:grain"] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      {
        unit: ledgerUnit("good:grain"),
        from: externalAccount("seed"),
        to: holderAccount(home as unknown as HolderRef),
        amount: 100_000,
      },
    ],
  });
  return { truth, ledger };
}

function run(truth: WorldTruth, ledger: Ledger, now: Tick, who: AgentId = me): ProcessResult {
  return catchUpProcess({
    plans: [plan],
    clock: EARTHLIKE_CLOCK,
    lonDeg: 0,
    ration: { unit: "good:grain", kcalPerGram: 3.6, waterPerGram: 0.1 },
    player: makeId("agent", 99),
    placeOf: () => site,
  }).run({
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

function settle(truth: WorldTruth, out: ProcessResult) {
  for (const c of out.changes ?? []) {
    if (c.op === "delete") truth.deleteRaw(c.table, c.id);
    else if (c.op === "set") truth.setRaw(c.table, c.id, c.value);
  }
}

const hit = (at: number, force = 0.3): PendingFact => ({
  kind: "blow",
  at: at as Tick,
  cause: raid,
  blow: { kind: "cut", force, zone: "left_arm", dirt: 0.5 },
});

describe("off-4: hechos pendientes de los agregados", () => {
  it("solo se anota a quien duerme; si no, quien lo asigna lo aplica por su camino", () => {
    const { truth } = world();
    expect(assignPendingFact(truth, me, hit(100))).toBeDefined();
    truth.deleteRaw(ASLEEP.name, me);
    expect(assignPendingFact(truth, me, hit(100))).toBeUndefined();
  });

  it("al despertar la herida está, con la causa del agregado, y el pendiente se consume", () => {
    const { truth, ledger } = world();
    const change = assignPendingFact(truth, me, hit(DAY));
    if (change?.op === "set") truth.setRaw(change.table, change.id, change.value);
    const out = run(truth, ledger, (3 * DAY) as Tick);
    const applied = out.events?.filter((e) => e.kind === PENDING_APPLIED_EVENT) ?? [];
    expect(applied).toHaveLength(1);
    expect(applied[0]?.causes).toEqual([{ kind: "event", event: raid }]);
    settle(truth, out);
    const body = truth.get(BODY_STATE, me);
    expect(body?.updatedAt).toBe(3 * DAY);
    expect(body?.wounds.some((w) => w.zone === "left_arm" && w.cause === raid)).toBe(true);
    expect(truth.get(PENDING_FACTS, me)).toBeUndefined();
  });

  it("un hecho futuro espera; los vencidos se aplican en orden", () => {
    const { truth, ledger } = world();
    for (const f of [hit(5 * DAY), hit(2 * DAY), hit(DAY)]) {
      const c = assignPendingFact(truth, me, f);
      if (c?.op === "set") truth.setRaw(c.table, c.id, c.value);
    }
    const out = run(truth, ledger, (3 * DAY) as Tick);
    settle(truth, out);
    expect(truth.get(BODY_STATE, me)?.wounds).toHaveLength(2);
    expect(truth.get(PENDING_FACTS, me)?.map((f) => f.at)).toEqual([5 * DAY]);
  });

  it("un golpe mortal cierra la entidad con la causa del hecho", () => {
    const { truth, ledger } = world();
    const c = assignPendingFact(truth, me, {
      ...hit(DAY),
      blow: { kind: "cut", force: 1, zone: "head", dirt: 0.5 },
    });
    if (c?.op === "set") truth.setRaw(c.table, c.id, c.value);
    const out = run(truth, ledger, (2 * DAY) as Tick);
    const died = out.events?.find((e) => e.kind === "body.died");
    expect(died?.causes).toEqual([{ kind: "event", event: raid }]);
    expect(out.changes?.some((x) => x.table === ENTITY.name)).toBe(true);
    settle(truth, out);
    expect(truth.get(BODY_STATE, me)?.death).not.toBeNull();
  });

  it("es determinista: dos corridas dan lo mismo", () => {
    const go = () => {
      const { truth, ledger } = world();
      const c = assignPendingFact(truth, me, hit(DAY));
      if (c?.op === "set") truth.setRaw(c.table, c.id, c.value);
      return JSON.stringify(run(truth, ledger, (3 * DAY) as Tick));
    };
    expect(go()).toBe(go());
  });
});
