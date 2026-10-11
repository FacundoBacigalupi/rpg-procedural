import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  type EventId,
  loadContent,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  BODY_PLANS,
  BODY_STATE,
  checkInvariants,
  ENTITY,
  GENOME,
  HOUSEHOLD,
  INNATE,
  PERSON,
  type ProcessContext,
  TRAITS,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { BIRTH, birthProcess } from "./birth.ts";
import { PREGNANCY } from "./conception.ts";
import { optInParts } from "./create.ts";
import { Life } from "./life.ts";
import { LABOR } from "./midwife.ts";

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
const traits = content.all(TRAITS);
const bodyPlans = content.all(BODY_PLANS);

const DAY = 86_400;
const mother = "agent:1" as AgentId;
const father = "agent:2" as AgentId;
const place = { kind: "cell", cell: "cell:1" } as unknown as PlaceRef;
const genome = (v: number, id: AgentId) => ({
  species: traits[0]?.species ?? "human",
  additive: Object.fromEntries(traits.map((t) => [t.id, v])),
  parents: null,
  originEventId: "event:1" as EventId,
  id,
});

function world(infantDied: boolean): WorldTruth {
  const t = new WorldTruth();
  for (const [id, sex, g] of [
    [mother, "female", 0.4],
    [father, "male", -0.2],
  ] as const) {
    t.set(ENTITY, id as EntityRef, { id, originEventId: "event:1", createdAt: 0 } as never);
    t.set(
      PERSON,
      id as EntityRef,
      {
        sex,
        born: -9_000_000_000,
        mother: null,
        father: null,
        household: "household:1",
        spouse: id === mother ? father : mother,
      } as never,
    );
    t.set(GENOME, id as EntityRef, genome(g, id) as never);
  }
  t.set(
    HOUSEHOLD,
    "household:1" as EntityRef,
    {
      settlement: "settlement:1",
      members: [mother, father],
    } as never,
  );
  t.set(PREGNANCY, mother as EntityRef, {
    father,
    conceivedAt: 0,
    dueAt: 280 * DAY,
    parity: 1,
    originEventId: "event:1",
  });
  t.set(LABOR, mother as EntityRef, {
    dueAt: 280 * DAY,
    at: 281 * DAY,
    midwife: null,
    called: false,
    believedRisk: 0.1,
    complication: false,
    motherDied: false,
    infantDied,
    fever: false,
    paid: 0,
    cause: "event:7",
  });
  return t;
}

const process = birthProcess({
  clock: { day: DAY, year: 365 * DAY } as never,
  traits,
  bodyPlans,
  placeOf: () => place,
});
const run = (t: WorldTruth) =>
  process.run({
    truth: t,
    now: 282 * DAY,
    rng: Rng.root(3),
    newId: () => "agent:99",
  } as unknown as ProcessContext);
const tables = (changes: readonly unknown[] | undefined) =>
  (changes ?? []).map((c) => (c as { table: string }).table);

describe("nacer vivo (puro)", () => {
  it("apagado por defecto: sin la opción no pasa nada al mundo", () => {
    expect(optInParts({ births: true })).toEqual({});
    expect(optInParts({ conception: true, births: true })).toEqual({
      conception: true,
      births: true,
    });
  });

  it("un parto sin muerte del niño crea a la persona con el parto como causa y origen", () => {
    const r = run(world(false));
    expect(r.events?.map((e) => e.kind)).toEqual(["family.birth"]);
    const ev = r.events?.[0];
    expect(ev?.actors).toEqual(["agent:99", mother, father]);
    expect(ev?.causes).toEqual([{ kind: "event", event: "event:7" }]);
    expect(tables(r.changes)).toEqual(
      expect.arrayContaining([
        ENTITY.name,
        PERSON.name,
        GENOME.name,
        INNATE.name,
        BODY_STATE.name,
        BIRTH.name,
        HOUSEHOLD.name,
      ]),
    );
    const person = (r.changes ?? []).find(
      (c) => (c as { table: string }).table === PERSON.name,
    ) as unknown as { value: Record<string, unknown> };
    expect(person.value).toMatchObject({
      born: 282 * DAY,
      mother,
      father,
      household: "household:1",
      spouse: null,
    });
    const g = (r.changes ?? []).find(
      (c) => (c as { table: string }).table === GENOME.name,
    ) as unknown as { value: { parents: string[]; additive: Record<string, number> } };
    expect(g.value.parents).toEqual([mother, father]);
    // Hereda el promedio de los padres (0,1) más segregación, no el de uno solo.
    const h = (r.changes ?? []).find(
      (c) => (c as { table: string }).table === HOUSEHOLD.name,
    ) as unknown as { value: { members: string[] } };
    expect(h.value.members).toEqual([mother, father, "agent:99"]);
  });

  it("si el niño murió en el parto no nace nadie; ya nacido, no nace dos veces", () => {
    expect(run(world(true)).events ?? []).toEqual([]);
    const t = world(false);
    t.set(BIRTH, mother as EntityRef, { dueAt: 280 * DAY, child: "agent:50" as AgentId });
    expect(run(t).events ?? []).toEqual([]);
  });

  it("mismo seed, mismo hijo", () => {
    const a = JSON.stringify(run(world(false)).changes);
    expect(JSON.stringify(run(world(false)).changes)).toBe(a);
  });
});

describe("nacer vivo en la vida (opt-in)", () => {
  it("el embarazo llega al parto y el niño entra a la población con causa, ledger e invariantes limpios", () => {
    const life = Life.create(7, content, {
      frequency: 8,
      conception: true,
      births: true,
      conceptionRateScale: 20,
      conceptionGestationDays: 15,
    });
    const w = life.world;
    const before = w.truth.ids(PERSON).length;
    const t0 = life.now;
    life.advanceTo(t0 + 80 * DAY);
    // Los de la pre-corrida quedan en el registro: solo cuentan los nacidos después de empezar.
    const births = w.log.all().filter((e) => e.kind === "family.birth" && e.tick > t0);
    expect(births.length).toBeGreaterThan(0);
    expect(w.truth.ids(PERSON).length).toBe(before + births.length);
    for (const e of births) {
      const child = e.actors[0] as AgentId;
      const person = w.truth.get(PERSON, child as unknown as EntityRef);
      expect(person?.mother).toBe(e.actors[1]);
      expect(person?.father).toBe(e.actors[2]);
      expect(w.truth.get(ENTITY, child as unknown as EntityRef)?.originEventId).toBe(e.id);
      expect(w.truth.get(GENOME, child as unknown as EntityRef)?.parents).toEqual([
        e.actors[1],
        e.actors[2],
      ]);
      expect(w.truth.get(HOUSEHOLD, person?.household as unknown as EntityRef)?.members).toContain(
        child,
      );
      expect(e.causes.length).toBeGreaterThan(0);
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 500_000);
});
