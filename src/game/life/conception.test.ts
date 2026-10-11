import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlaceRef } from "../../core/index.ts";
import {
  type AgentId,
  type ContentSource,
  EARTHLIKE_CLOCK,
  type EntityRef,
  type EventId,
  loadContent,
  Rng,
} from "../../core/index.ts";
import {
  checkInvariants,
  ENTITY,
  PERSON,
  type ProcessContext,
  type StateChange,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import {
  CONCEPTION_PROCESS,
  conceptionProcess,
  dailyConceptionChance,
  PREGNANCY,
  pregnancyLabors,
} from "./conception.ts";
import { optInParts } from "./create.ts";
import { Life } from "./life.ts";
import { LABOR, laborProcess } from "./midwife.ts";

const DAY = EARTHLIKE_CLOCK.day;
const YEAR = EARTHLIKE_CLOCK.year;
const wife = "agent:1" as AgentId;
const husband = "agent:2" as AgentId;
const place = { kind: "cell", cell: "cell:1" } as unknown as PlaceRef;

function couple(over: { husbandAlive?: boolean; wifeAge?: number } = {}): WorldTruth {
  const t = new WorldTruth();
  const born = -(over.wifeAge ?? 25) * YEAR;
  for (const [id, sex, spouse, b] of [
    [wife, "female", husband, born],
    [husband, "male", wife, -30 * YEAR],
  ] as const) {
    t.set(
      ENTITY,
      id as EntityRef,
      {
        id,
        originEventId: "event:1" as EventId,
        createdAt: 0,
        ...(id === husband && over.husbandAlive === false ? { endedAt: 5 } : {}),
      } as never,
    );
    t.set(
      PERSON,
      id as EntityRef,
      {
        sex,
        born: b,
        mother: null,
        father: null,
        household: "household:1",
        spouse,
      } as never,
    );
  }
  return t;
}

const demography = { fertility: [{ fromAge: 0, rate: 1 }] };
const process = conceptionProcess({
  clock: EARTHLIKE_CLOCK,
  demography,
  placeOf: () => place,
});
const run = (truth: WorldTruth, now = 10 * DAY) =>
  process.run({ truth, now, rng: Rng.root(1) } as unknown as ProcessContext);
const rows = (changes: readonly StateChange[] | undefined) =>
  (changes ?? []).filter((c) => (c as { table?: string }).table === PREGNANCY.name);

describe("concepción (puro)", () => {
  it("apagada por defecto: sin la opción no pasa nada al mundo", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ conception: false })).toEqual({});
    expect(optInParts({ conception: true, conceptionRateScale: 2 })).toEqual({
      conception: true,
      conceptionRateScale: 2,
    });
  });

  it("la probabilidad diaria acumula la anual y se acota", () => {
    expect(dailyConceptionChance(0, 365)).toBe(0);
    expect(dailyConceptionChance(1, 365)).toBe(1);
    const d = dailyConceptionChance(0.3, 365);
    expect(1 - (1 - d) ** 365).toBeCloseTo(0.3, 10);
    expect(dailyConceptionChance(0.3, 0)).toBe(0);
  });

  it("una casada con el marido vivo concibe: embarazo con causa, fecha de parto y el primer parto", () => {
    const r = run(couple());
    expect(r.events?.map((e) => e.kind)).toEqual(["family.conception"]);
    expect(r.events?.[0]?.actors).toEqual([wife, husband]);
    expect(r.events?.[0]?.causes.length).toBeGreaterThan(0);
    const [row] = rows(r.changes) as unknown as { value: Record<string, unknown> }[];
    expect(row?.value).toMatchObject({ father: husband, parity: 1, conceivedAt: 10 * DAY });
    expect(row?.value["dueAt"]).toBe(10 * DAY + 280 * DAY);
  });

  it("sin marido vivo, sin fecundidad o ya embarazada no concibe", () => {
    expect(run(couple({ husbandAlive: false })).events ?? []).toEqual([]);
    const none = conceptionProcess({
      clock: EARTHLIKE_CLOCK,
      demography: { fertility: [{ fromAge: 0, rate: 0 }] },
      placeOf: () => place,
    });
    expect(
      none.run({ truth: couple(), now: DAY, rng: Rng.root(1) } as unknown as ProcessContext)
        .events ?? [],
    ).toEqual([]);
    const pregnant = couple();
    pregnant.set(PREGNANCY, wife as unknown as EntityRef, {
      father: husband,
      conceivedAt: 0,
      dueAt: 280 * DAY,
      parity: 1,
      originEventId: "event:1",
    });
    expect(run(pregnant, 20 * DAY).events ?? []).toEqual([]);
  });

  it("después del parto espera un tiempo y la próxima es el segundo hijo", () => {
    const t = couple();
    t.set(PREGNANCY, wife as unknown as EntityRef, {
      father: husband,
      conceivedAt: 0,
      dueAt: 280 * DAY,
      parity: 1,
      originEventId: "event:1",
    });
    t.set(LABOR, wife as unknown as EntityRef, {
      dueAt: 280 * DAY,
      at: 281 * DAY,
      midwife: null,
      called: false,
      believedRisk: 0,
      complication: false,
      motherDied: false,
      infantDied: false,
      fever: false,
      paid: 0,
      cause: "event:2",
    });
    expect(run(t, 300 * DAY).events ?? []).toEqual([]);
    const later = run(t, 281 * DAY + 400 * DAY);
    const [row] = rows(later.changes) as unknown as { value: Record<string, unknown> }[];
    expect(row?.value["parity"]).toBe(2);
  });

  it("su parto sale de cuenta como un Labor y `life.labor` lo resuelve con una fila LABOR", () => {
    const t = couple();
    t.set(PREGNANCY, wife as unknown as EntityRef, {
      father: husband,
      conceivedAt: 0,
      dueAt: 280 * DAY,
      parity: 2,
      originEventId: "event:1",
    });
    expect(pregnancyLabors(t)).toEqual([{ mother: wife, dueAt: 280 * DAY, parity: 2 }]);
    const labor = laborProcess({
      clock: EARTHLIKE_CLOCK,
      labors: [],
      more: { reads: [PREGNANCY.name], of: pregnancyLabors },
      placeOf: () => place,
    });
    const before = labor.run({
      truth: t,
      now: 100 * DAY,
      rng: Rng.root(1),
    } as unknown as ProcessContext);
    expect(before.events ?? []).toEqual([]);
    const out = labor.run({
      truth: t,
      now: 281 * DAY,
      rng: Rng.root(1),
    } as unknown as ProcessContext);
    expect(out.events?.[0]?.kind).toBe("body.labor");
    expect((out.changes ?? []).some((c) => (c as { table?: string }).table === LABOR.name)).toBe(
      true,
    );
    expect(process.id).toBe(CONCEPTION_PROCESS);
  });
});

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

describe("concepción en la vida (opt-in)", () => {
  it("las casadas fecundas conciben con causa, el embarazo cita su evento y el ledger cuadra", () => {
    const life = Life.create(7, content, {
      frequency: 8,
      conception: true,
      conceptionRateScale: 20,
    });
    const w = life.world;
    life.advanceTo(life.now + 120 * DAY);
    const conceptions = w.log.all().filter((e) => e.kind === "family.conception");
    expect(conceptions.length).toBeGreaterThan(0);
    for (const e of conceptions) {
      expect(e.causes.length).toBeGreaterThan(0);
      const mother = e.actors[0] as AgentId;
      const row = w.truth.get(PREGNANCY, mother as unknown as EntityRef);
      expect(row?.originEventId).toBeDefined();
      expect(w.log.get(row?.originEventId as EventId)?.kind).toBe("family.conception");
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 400_000);
});
