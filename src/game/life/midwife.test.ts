import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId, HolderRef } from "../../core/index.ts";
import { holderAccount, Rng } from "../../core/index.ts";
import {
  birthRisk,
  ENTITY,
  PERSON,
  type ProcessContext,
  SKILL_STATE,
  WorldTruth,
} from "../../sim/index.ts";
import { healerFee } from "./medicine.ts";
import { LABOR, type Labor, laborProcess } from "./midwife.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };
const mother = "agent:1" as AgentId;
const docA = "agent:2" as AgentId;
const docB = "agent:3" as AgentId;
const place = { kind: "cell", cell: "cell:1" } as never;
const unit = "unit:coin" as never;

function world(): WorldTruth {
  const t = new WorldTruth();
  const lvl = (v: number) => ({ level: v, peak: v });
  for (const id of [mother, docA, docB]) {
    t.set(
      ENTITY,
      id as EntityRef,
      { id, originEventId: "event:1" as EventId, createdAt: 0 } as never,
    );
  }
  t.set(PERSON, mother as EntityRef, { born: -clock.year * 17 } as never);
  for (const [id, v] of [
    [docA, 0.4],
    [docB, 0.9],
  ] as const) {
    t.set(SKILL_STATE, id as EntityRef, {
      medicine: {
        facets: { execution: lvl(v), knowledge: lvl(v), judgment: lvl(v) },
        hours: 100,
        lastPracticed: null,
      },
    });
  }
  return t;
}

function ctx(truth: WorldTruth, now: number, purse = 0): ProcessContext {
  let n = 0;
  return {
    now,
    window: clock.day,
    truth,
    rng: Rng.root(1),
    newId: (k: string) => `${k}:~${n++}`,
    ledger: {
      balance: (acc: string) => (acc === holderAccount(mother as unknown as HolderRef) ? purse : 0),
      holdings: () => [],
    },
  } as unknown as ProcessContext;
}

const labor: Labor = { mother, dueAt: clock.day, difficulty: 0.6, parity: 0 };

describe("life.labor", () => {
  it("sin partos sembrados no hace nada; antes de la hora tampoco", () => {
    expect(
      laborProcess({ clock, labors: [], placeOf: () => place }).run(ctx(world(), 5 * clock.day)),
    ).toEqual({});
    const p = laborProcess({
      clock,
      labors: [{ ...labor, dueAt: 9 * clock.day }],
      placeOf: () => place,
    });
    expect(p.run(ctx(world(), 2 * clock.day))).toEqual({});
  });

  it("el hogar llama a la partera mejor creída; determinista y con causas", () => {
    const p = laborProcess({
      clock,
      labors: [labor],
      fee: { unit, base: 10, renownOf: (_t, _m, h) => (h === docA ? 0.9 : 0.2) },
      placeOf: () => place,
    });
    const out = p.run(ctx(world(), 2 * clock.day, 100));
    const ev = out.events?.[0];
    expect(ev?.kind).toBe("body.labor");
    expect(ev?.actors[1]).toBe(docA);
    expect(ev?.causes[0]).toMatchObject({ kind: "state" });
    const tr = out.postings?.[0]?.transfers[0];
    expect(tr?.amount).toBe(Math.round(healerFee(10, 0.4, 0.9)));
    expect(out.changes?.some((c) => c.table === LABOR.name)).toBe(true);
    expect(p.run(ctx(world(), 2 * clock.day, 100))).toEqual(out);
  });

  it("sin bolsa asiste igual sin cobro; con riesgo bajo creído no la llama", () => {
    const asked = laborProcess({ clock, labors: [labor], placeOf: () => place }).run(
      ctx(world(), 2 * clock.day),
    );
    expect(asked.events?.[0]?.data).toMatchObject({ called: true });
    expect(asked.events?.[0]?.actors[1]).toBe(docB);
    expect(asked.postings).toBeUndefined();
    const easy = laborProcess({
      clock,
      labors: [{ mother, dueAt: clock.day, difficulty: 0, parity: 3, nutrition: 1, health: 1 }],
      callAbove: 0.9,
      placeOf: () => place,
    }).run(ctx(world(), 2 * clock.day));
    expect(easy.events?.[0]?.data).toMatchObject({ called: false });
    expect(easy.events?.[0]?.actors).toEqual([mother]);
  });

  it("la partera baja el riesgo (puro) y no se repite un parto ya resuelto", () => {
    const base = {
      motherAgeYears: 17,
      nutrition: 0.7,
      health: 0.7,
      parity: 0,
      hygiene: 0.5,
      supplies: 0.3,
      difficulty: 0.6,
    };
    const none = birthRisk({ ...base, midwifeSkill: null });
    const skilled = birthRisk({ ...base, midwifeSkill: 0.9 });
    expect(skilled.complication).toBeLessThan(none.complication);
    expect(skilled.maternalDeathIfComplication).toBeLessThan(none.maternalDeathIfComplication);
    const t = world();
    const p = laborProcess({ clock, labors: [labor], placeOf: () => place });
    const out = p.run(ctx(t, 2 * clock.day));
    const row = out.changes?.find((c) => c.table === LABOR.name);
    expect(row).toBeDefined();
    t.set(LABOR, mother as EntityRef, { dueAt: labor.dueAt } as never);
    expect(p.run(ctx(t, 3 * clock.day))).toEqual({});
  });
});
