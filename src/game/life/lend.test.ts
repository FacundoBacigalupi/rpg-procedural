import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  CREDIT,
  ENTITY,
  LOCATION,
  lend,
  PERSON,
  type ProcessContext,
  type StateChange,
  WorldTruth,
} from "../../sim/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { LEND_LOG, lendProcess, repayDoseProcess } from "./lend.ts";
import { MOLD_RUMORS } from "./moldgossip.ts";

const me = "agent:1" as AgentId;
const him = "agent:2" as AgentId;
const place = { kind: "cell", cell: "cell:1" } as never;
const day = 86400;
const loc = { hex: 3 } as never;

function world(): WorldTruth {
  const t = new WorldTruth();
  for (const [id, home] of [
    [me, "household:1"],
    [him, "household:2"],
  ] as const) {
    t.set(
      ENTITY,
      id as EntityRef,
      { id, originEventId: "event:1" as EventId, createdAt: 0 } as never,
    );
    t.set(PERSON, id as EntityRef, { household: home } as never);
    t.set(LOCATION, id as EntityRef, loc);
  }
  t.set(NPC_DECISION, me, {
    at: 100,
    id: `speak:${him}+borrow:amapola`,
    verb: "speak",
    target: him,
    utility: 1,
    options: 3,
  } as never);
  t.set(MOLD_RUMORS, me, {
    items: [
      {
        rumor: { mold: "attr", about: him, attr: "has", value: "amapola" },
        confidence: 0.8,
        hops: 1,
        heardAt: 0,
        teller: null,
      },
    ],
    told: [],
  } as never);
  return t;
}

const process = lendProcess({
  goods: [{ id: "poppy", name: "amapola", form: "good" }] as never,
  dims: [
    { id: "trust", baseline: 1 },
    { id: "affection", baseline: 1 },
  ] as never,
  bonds: [],
  day,
  player: "agent:99" as AgentId,
  placeOf: () => place,
});

function run(truth: WorldTruth, stock: number, now = 200) {
  const ctx = {
    now,
    scope: me,
    truth,
    ledger: { balance: () => stock },
    rng: Rng.root(1),
  } as unknown as ProcessContext;
  return process.run(ctx);
}

const written = (changes: readonly StateChange[] | undefined, name: string) =>
  (changes ?? []).some((c) => (c as { table?: string }).table === name);

describe("life.lend (pedir prestada la sustancia)", () => {
  it("si el prestamista la tiene y accede: pasa una dosis por el ledger y abre el fiado", () => {
    const r = run(world(), 3);
    expect(r.events?.map((e) => e.kind)).toEqual(["household.borrowed"]);
    const ev = r.events?.[0];
    expect(ev?.actors).toEqual([him, me]);
    expect(ev?.causes.length).toBeGreaterThan(0);
    expect(ev?.data).toMatchObject({
      credit: { grams: 1 },
      from: "household:2",
      to: "household:1",
    });
    const t = r.postings?.[0]?.transfers[0];
    expect(t?.amount).toBe(1);
    expect(written(r.changes, LEND_LOG.name)).toBe(true);
  });

  it("si no la tiene en realidad: nada se mueve y el rumor pierde confianza", () => {
    const truth = world();
    const r = run(truth, 0);
    expect(r.events?.map((e) => e.kind)).toEqual(["substance.borrow_missed"]);
    expect(r.postings ?? []).toEqual([]);
    const change = (r.changes ?? []).find(
      (c) => (c as { table?: string }).table === MOLD_RUMORS.name,
    ) as { value?: { items: { confidence: number }[] } } | undefined;
    // 0.8 * 0.25 = 0.2: sigue en el libro pero mucho más débil.
    expect(change?.value?.items[0]?.confidence).toBeCloseTo(0.2, 6);
  });

  it("un pedido por día", () => {
    const truth = world();
    truth.set(LEND_LOG, me, { at: 150 });
    expect(run(truth, 3, 200)).toEqual({});
    truth.set(NPC_DECISION, me, {
      at: 150 + day - 10,
      id: `speak:${him}+borrow:amapola`,
      verb: "speak",
      utility: 1,
      options: 3,
    } as never);
    expect(run(truth, 3, 150 + day).events?.length).toBe(1);
  });
});

describe("life.repay_dose (devolver la dosis prestada)", () => {
  const goods = [{ id: "poppy", name: "amapola", form: "good" }] as never;
  const unit = "good:poppy" as never;
  const repay = repayDoseProcess({
    goods,
    substances: ["poppy"],
    player: "agent:99" as AgentId,
    placeOf: () => place,
  });
  function runRepay(stock: number) {
    const truth = world();
    truth.set(CREDIT, "commitment:1" as never, lend(him, me, unit, 1, 0, day));
    const ctx = {
      now: 500,
      scope: "household:1",
      truth,
      ledger: { balance: () => stock },
      rng: Rng.root(1),
    } as unknown as ProcessContext;
    return repay.run(ctx);
  }

  it("con la dosis en su despensa la devuelve al hogar del prestamista", () => {
    const r = runRepay(2);
    expect(r.events?.map((e) => e.kind)).toEqual(["household.repaid"]);
    expect(r.events?.[0]?.actors).toEqual([me, him]);
    expect(r.events?.[0]?.causes.length).toBeGreaterThan(0);
    const t = r.postings?.[0]?.transfers[0];
    expect(t?.amount).toBe(1);
    expect(t?.to).toContain("household:2");
  });

  it("sin la dosis no devuelve nada (el vencimiento hace la mora)", () => {
    expect(runRepay(0)).toEqual({});
  });
});
