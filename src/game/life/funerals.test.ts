import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type HolderRef,
  holderAccount,
  IdAllocator,
  ledgerUnit,
  loadContent,
  makeId,
} from "../../core/index.ts";
import { LifeStore, openSqlite } from "../../persistence/index.ts";
import {
  BODY_STATE,
  type Body,
  checkInvariants,
  ENTITY,
  type EventDraft,
  FACE,
  type GoodDef,
  PERSON,
  PERSON_CULTURE,
  type PostingDraft,
  type ProcessContext,
  type StateChange,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import type { LifeOptions } from "./create.ts";
import { FUNERALS, resolveFunerals, validateFuneralOptions } from "./funerals.ts";
import { Life } from "./life.ts";
import { LOANS } from "./loans.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    return [
      {
        kind: relative(root, dir).split("\\").join("/"),
        file: path,
        data: JSON.parse(readFileSync(path, "utf8")),
      },
    ];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const copper = ledgerUnit("coin:copper");
const account = (home: string) => holderAccount(home as unknown as HolderRef);
const _account = (home: string) => holderAccount(home as unknown as HolderRef);
const DAY = 86400;

function fixture(credit = true) {
  const life = Life.create(10, content);
  const w = life.world;
  const home = w.truth.get(PERSON, life.player)?.household;
  const alive = [...w.truth.ids(PERSON)].filter(
    (id) => w.truth.get(ENTITY, id)?.endedAt === undefined,
  );
  const dead = alive.find(
    (id) => id !== life.player && w.truth.get(PERSON, id)?.household === home,
  );
  const provider = alive.find((id) => w.truth.get(PERSON, id)?.household !== home);
  if (!home || !dead || !provider) throw new Error("faltan familia o proveedor");
  const person = w.truth.get(PERSON, provider);
  if (!person) throw new Error("falta proveedor");
  // Reservas finitas ya existentes: se concentra el cobre real del hogar en el prestamista.
  const organizer = alive
    .filter((id) => id !== dead && w.truth.get(PERSON, id)?.household === home)
    .sort()[0];
  if (!organizer) throw new Error("falta organizador");
  const existing = w.ledger.balance(holderAccount(organizer as AgentId), copper);
  const cause = w.log.all().at(-1);
  if (!cause || existing <= 0) throw new Error("falta cobre");
  w.ledger.post({
    tick: life.now,
    eventId: cause.id,
    transfers: [
      {
        unit: copper,
        from: holderAccount(organizer as AgentId),
        to: holderAccount(provider as AgentId),
        amount: existing,
      },
    ],
  });
  for (const id of alive.filter((id) => w.truth.get(PERSON, id)?.household === home)) {
    const culture = w.truth.get(PERSON_CULTURE, id);
    const rite = culture?.holdings["funeral.rite"];
    if (!culture || !rite) throw new Error("falta costumbre funeraria");
    w.truth.set(PERSON_CULTURE, id, {
      ...culture,
      holdings: {
        ...culture.holdings,
        "funeral.rite": { ...rite, variant: "burial", shown: "burial", strength: 1 },
      },
    });
  }
  const options: LifeOptions = {
    funerals: {
      since: life.now,
      provider: provider as AgentId,
      ...(credit ? { lender: provider as AgentId } : {}),
      fee: 100,
      rate: 0.2,
      termDays: 10,
      unsecuredLimit: 100,
      materials: [{ good: "grain", amount: 10 }],
    },
  };
  const body = w.truth.get(BODY_STATE, dead) as Body;
  w.truth.set(BODY_STATE, dead, {
    ...body,
    death: { cause: "brain_trauma", at: life.now },
  } as Body);
  const enabled = Life.resume(10, content, { ...life.state(), ids: w.ids }, options, life.anchor);
  return { life: enabled, dead, options, home };
}

describe("funerales opt-in en la vida", () => {
  it("rechaza números inválidos antes de construir procesos", () => {
    const goods = [{ id: "grain", form: "good" }] as GoodDef[];
    const options = {
      since: 0,
      provider: makeId("agent", 4),
      fee: 10,
      rate: 0.2,
      termDays: 10,
      unsecuredLimit: 20,
      materials: [{ good: "grain", amount: 10 }],
    };
    for (const invalid of [
      { fee: Number.NaN },
      { since: Infinity },
      { termDays: 0 },
      { rate: -1 },
      { unsecuredLimit: 0.5 },
      { materials: [{ good: "grain", amount: -1 }] },
    ]) {
      expect(() => validateFuneralOptions({ ...options, ...invalid }, goods)).toThrow(TypeError);
    }
  });

  it("dos muertos comparten despensa sin duplicarla y acumulan la pérdida de cara", () => {
    const truth = new WorldTruth();
    const ids = [1, 2, 3, 4].map((n) => makeId("agent", n));
    const [organizer, dead, otherDead, provider] = ids as [AgentId, AgentId, AgentId, AgentId];
    for (const id of ids) {
      const n = ids.indexOf(id);
      truth.set(PERSON, id, { household: id === provider ? "provider" : "family" } as never);
      truth.set(ENTITY, id, {
        id,
        originEventId: makeId("event", 1),
        createdAt: 0,
        ...(id === dead || id === otherDead
          ? { endedAt: 1, endEventId: makeId("event", n + 10) }
          : {}),
      } as never);
    }
    truth.set(PERSON_CULTURE, organizer, {
      holdings: {
        "funeral.rite": {
          variant: "burial",
          strength: 0.1,
        },
      },
    } as never);
    const grain = ledgerUnit("good:grain");
    const balances = new Map<string, number>([
      [`${account("family")}|${grain}`, 15],
      [`${holderAccount(organizer)}|${grain}`, 3],
    ]);
    const events: EventDraft[] = [];
    const postings: PostingDraft[] = [];
    const changes: StateChange[] = [];
    const place = { kind: "cell", cell: makeId("cell", 1) } as const;
    const ctx = {
      truth,
      now: DAY,
      newId: () => {
        throw new Error("no debe reservar préstamo");
      },
    } as unknown as ProcessContext;
    resolveFunerals(
      ctx,
      {
        since: 0,
        provider,
        fee: 100,
        rate: 0.2,
        termDays: 10,
        unsecuredLimit: 0,
        materials: [{ good: "grain", amount: 10 }],
      },
      [
        { id: "grain", form: "good" },
        { id: "copper", form: "coin" },
      ] as GoodDef[],
      1,
      (a, u) => balances.get(`${a}|${u}`) ?? 0,
      (transfers) => {
        for (const t of transfers) {
          balances.set(
            `${t.from}|${t.unit}`,
            (balances.get(`${t.from}|${t.unit}`) ?? 0) - t.amount,
          );
          balances.set(`${t.to}|${t.unit}`, (balances.get(`${t.to}|${t.unit}`) ?? 0) + t.amount);
        }
      },
      events,
      postings,
      changes,
      (id) =>
        ({
          id,
          kind: "body.died",
          actors: [id === makeId("event", 11) ? dead : otherDead],
        }) as never,
      () => place,
      () => {
        throw new Error("no debe abrir préstamo");
      },
    );
    expect(events).toHaveLength(2);
    expect(balances.get(`${holderAccount(dead)}|${grain}`)).toBe(10);
    expect(balances.get(`${holderAccount(otherDead)}|${grain}`)).toBe(8);
    expect(balances.get(`${account("family")}|${grain}`)).toBe(0);
    const face = changes.filter((c) => c.table === FACE.name);
    expect(face).toHaveLength(1);
    const adjustment = face[0];
    if (adjustment?.op !== "set") throw new Error("falta ajuste de cara");
    expect((adjustment.value as { value: number }).value).toBeCloseTo(0.3, 12);
  });
  it("el scheduler abre deuda real, conserva ajuar y retoma desde SQLite sin repetir el gasto", () => {
    const { life, dead, options } = fixture();
    life.advanceTo(life.now + 2 * DAY);
    const held = life.world.log.all().filter((e) => e.kind === "funeral.held");
    expect(held).toHaveLength(1);
    const firstHeld = held[0];
    if (!firstHeld) throw new Error("falta funeral");
    expect((firstHeld.data as { principal: number }).principal).toBeGreaterThan(0);
    expect(
      life.world.ledger.balance(
        holderAccount(dead as unknown as HolderRef),
        ledgerUnit("good:grain"),
      ),
    ).toBe(10);
    expect(life.world.truth.get(FUNERALS, dead)).toBeDefined();
    expect(life.world.truth.ids(LOANS)).toHaveLength(1);
    const row = life.world.truth.get(LOANS, life.world.truth.ids(LOANS)[0] as never);
    const expense = held[0];
    if (!row || !expense) throw new Error("falta préstamo funerario");
    // Ingreso posterior real: una devolución del proveedor deja monedas para la cuota.
    life.world.ledger.post({
      tick: life.now,
      eventId: expense.id,
      transfers: [{ unit: copper, from: row.lenderAccount, to: row.borrowerAccount, amount: 20 }],
    });
    const db = openSqlite(":memory:");
    try {
      const store = LifeStore.open(db);
      store.save(life.state());
      const saved = store.load();
      const resumed = Life.resume(
        10,
        content,
        { ...saved, ids: new IdAllocator(saved.ids) },
        options,
        life.anchor,
      );
      expect(resumed.hash()).toEqual(life.hash());
      const until = life.now + DAY;
      life.advanceTo(until);
      resumed.advanceTo(until);
      expect(resumed.hash()).toEqual(life.hash());
      expect(resumed.world.log.all().filter((e) => e.kind === "funeral.held")).toHaveLength(1);
      expect(resumed.world.log.all().some((e) => e.kind === "credit.paid")).toBe(true);
      expect(resumed.world.ledger.audit()).toEqual([]);
      expect(checkInvariants({ truth: resumed.world.truth, log: resumed.world.log })).toEqual([]);
    } finally {
      db.close();
    }
  }, 120000);

  it("sin crédito el proveedor ve el déficit y la familia pierde cara", () => {
    const { life, home } = fixture(false);
    life.advanceTo(life.now + 2 * DAY);
    const held = life.world.log.all().find((e) => e.kind === "funeral.held");
    if (!held) throw new Error("falta funeral");
    expect((held.data as { dignified: boolean }).dignified).toBe(false);
    expect((held.data as { faceLoss: number }).faceLoss).toBeGreaterThan(0);
    const faces = life.world.truth
      .ids(FACE)
      .filter((id) => life.world.truth.get(PERSON, id)?.household === home);
    expect(faces.length).toBeGreaterThan(0);
    expect(life.world.truth.ids(LOANS)).toHaveLength(0);
    expect(life.world.ledger.audit()).toEqual([]);
  }, 120000);
});
