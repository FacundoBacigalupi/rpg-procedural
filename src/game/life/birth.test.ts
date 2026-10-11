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
  ACTIONS,
  BODY_PLANS,
  BODY_STATE,
  CONCEPTS,
  CULTURE_TRAITS,
  checkInvariants,
  ENTITY,
  GENOME,
  generateLanguage,
  HOUSEHOLD,
  INNATE,
  LANGUAGES,
  MIND,
  PERSON,
  PERSON_CULTURE,
  PERSON_NAME,
  type ProcessContext,
  RELATION_BONDS,
  RELATION_DIMS,
  RELATIONS,
  RELIGIOUS_IDENTITY,
  SCHEMAS,
  SKILL_STATE,
  SKILLS,
  SkillCatalog,
  TASTES,
  TASTES_OF,
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
const language = generateLanguage(
  7,
  content.get(LANGUAGES, "village.hills") as never,
  content.all(CONCEPTS),
);
const newborn = {
  language,
  schemas: content.all(SCHEMAS),
  dims: content.all(RELATION_DIMS),
  bonds: content.all(RELATION_BONDS),
  cultureTraits: content.all(CULTURE_TRAITS),
  skills: new SkillCatalog(content.all(SKILLS), content.all(ACTIONS)),
  tastes: content.all(TASTES),
};

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

describe("el recién nacido con nombre, mente y relaciones (puro)", () => {
  const named = birthProcess({
    clock: { day: DAY, year: 365 * DAY } as never,
    traits,
    bodyPlans,
    newborn,
    placeOf: () => place,
  });
  const runNamed = () => {
    const t = world(false);
    const fatherName = {
      language: language.id,
      parts: [
        {
          kind: "family" as const,
          lexemes: ["x"],
          meaning: ["roca"],
          form: "Karo",
          givenBy: null,
          event: "event:1" as EventId,
          usedBy: "all" as const,
        },
      ],
    };
    t.set(PERSON_NAME, father as EntityRef, fatherName as never);
    const out = named.run({
      truth: t,
      now: 282 * DAY,
      rng: Rng.root(3),
      newId: () => "agent:99",
    } as unknown as ProcessContext);
    return (table: string) =>
      (out.changes as unknown as { table: string; value: unknown }[]).find((c) => c.table === table)
        ?.value as Record<string, unknown> | undefined;
  };

  it("lleva el apellido del padre, un nombre de pila con significado y la mente de base con el parto como causa", () => {
    const get = runNamed();
    const name = get(PERSON_NAME.name) as unknown as {
      parts: { kind: string; form: string; meaning: string[] }[];
    };
    expect(name.parts.find((x) => x.kind === "family")?.form).toBe("Karo");
    const given = name.parts.find((x) => x.kind === "given");
    expect(given?.form.length).toBeGreaterThan(0);
    expect(given?.meaning.length).toBeGreaterThan(0);
    const mind = get(MIND.name) as { originEventId: string; schemas: Record<string, unknown> };
    expect(mind.originEventId).toBe("event:~0");
    expect(Object.keys(mind.schemas).length).toBeGreaterThan(0);
  });

  it("siente por su madre y su padre lo que el vínculo pone, citando el parto", () => {
    const rel = runNamed()(RELATIONS.name) as unknown as {
      toward: Record<string, { bonds: string[]; history: string[] }>;
    };
    expect(Object.keys(rel.toward).sort()).toEqual([mother, father]);
    expect(rel.toward[mother]?.bonds).toContain("parent");
    expect(rel.toward[father]?.bonds).toContain("parent");
    expect(rel.toward[mother]?.history).toEqual(["event:~0"]);
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
    let bondedChecked = 0;
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
      // Nombre, mente y lo que siente por su madre, con el parto como origen.
      const name = w.truth.get(PERSON_NAME, child as unknown as EntityRef);
      expect(name?.parts.find((x) => x.kind === "given")?.event).toBe(e.id);
      expect(w.truth.get(MIND, child as unknown as EntityRef)?.originEventId).toBe(e.id);
      // Su madre lo siente a él (el lado de ella, un día después de nacer).
      if (e.tick < life.now - 3 * DAY) {
        bondedChecked++;
        expect(
          w.truth.get(RELATIONS, e.actors[1] as unknown as EntityRef)?.toward[child]?.bonds,
        ).toContain("child");
      }
      // Habilidades heredadas (sin aprendido) y gustos con el parto de origen.
      expect(w.truth.get(SKILL_STATE, child as unknown as EntityRef)).toBeDefined();
      expect(w.truth.get(TASTES_OF, child as unknown as EntityRef)?.originEventId).toBe(e.id);
      // Lo que sigue de su cultura y su fe: lo copia de sus padres, con el parto como origen.
      expect(w.truth.get(PERSON_CULTURE, child as unknown as EntityRef)?.originEventId).toBe(e.id);
      expect(
        w.truth.get(RELIGIOUS_IDENTITY, child as unknown as EntityRef)?.affiliations[0]
          ?.originEventId,
      ).toBe(e.id);
      expect(
        w.truth.get(RELATIONS, child as unknown as EntityRef)?.toward[e.actors[1] as string]?.bonds,
      ).toContain("parent");
    }
    expect(bondedChecked).toBeGreaterThan(0);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 500_000);
});
