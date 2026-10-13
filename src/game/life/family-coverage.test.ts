import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  EARTHLIKE_CLOCK,
  EventLog,
  externalAccount,
  holderAccount,
  IdAllocator,
  Ledger,
  ledgerUnit,
  loadContent,
  makeId,
  Rng,
  type Tick,
} from "../../core/index.ts";
import {
  ACTIONS,
  BODY_PLANS,
  BODY_STATE,
  CONCEPTS,
  CULTURE_TRAITS,
  CULTURES,
  checkInvariants,
  DEMOGRAPHY,
  DOCTRINES,
  ENTITY,
  founderGenome,
  GENOME,
  generateLanguage,
  HOUSEHOLD,
  INNATE,
  LANGUAGES,
  LOCATION,
  MIND,
  PERSON,
  PERSON_CULTURE,
  PERSON_NAME,
  RELATION_BONDS,
  RELATION_DIMS,
  RELATIONS,
  RELIGIONS,
  RELIGIOUS_IDENTITY,
  SCHEMAS,
  Scheduler,
  SELF_IMAGES,
  SKILL_STATE,
  SKILLS,
  SkillCatalog,
  seedAffiliation,
  seedCulture,
  seedPersonCulture,
  seedReligion,
  TASTES,
  TASTES_OF,
  TRAITS,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { birthProcess, newbornBondsProcess } from "./birth.ts";
import { conceptionProcess, GESTATION_DAYS, PREGNANCY, pregnancyLabors } from "./conception.ts";
import { LABOR, laborProcess } from "./midwife.ts";
import { FULL_PROFILE } from "./profile.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path, root);
    return entry.name.endsWith(".json")
      ? [
          {
            kind: relative(root, dir).split("\\").join("/"),
            file: path,
            data: JSON.parse(readFileSync(path, "utf8")),
          },
        ]
      : [];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const clock = EARTHLIKE_CLOCK;
// Esta seed concibe el primer día con la curva normal; no se modifica la probabilidad ni el parto.
const SEED = 3390;
const mother = makeId("agent", 1);
const father = makeId("agent", 2);
const home = makeId("household", 1);
const settlement = makeId("settlement", 1);
const place = { kind: "settlement", settlement } as const;
const seedEvent = makeId("event", 1);
const coin = ledgerUnit("coin:copper");
const languageDef = content.get(LANGUAGES, "village.hills");
if (!languageDef) throw new Error("sin lengua de la aldea");
const language = generateLanguage(SEED, languageDef, content.all(CONCEPTS));

function fertileFamily() {
  if (!FULL_PROFILE.conception || !FULL_PROFILE.births)
    throw new Error("perfil sin familia activa");
  const truth = new WorldTruth();
  const ids = new IdAllocator({ event: 2, agent: 3 });
  const log = new EventLog();
  log.append({
    id: seedEvent,
    tick: 0,
    kind: "test.family_setup",
    actors: [],
    place,
    causes: [{ kind: "seed" }],
    data: {},
    emissions: {},
    resolution: "local",
  });
  for (const id of [mother, father, home, settlement])
    truth.set(ENTITY, id, { id, createdAt: 0, originEventId: seedEvent });
  truth.set(HOUSEHOLD, home, { settlement, members: [mother, father] });
  const traits = content.all(TRAITS);
  const plan = content.all(BODY_PLANS)[0];
  const cultureDef = content.all(CULTURES)[0];
  const religionDef = content.all(RELIGIONS)[0];
  const demography = content.get(DEMOGRAPHY, "human.preindustrial-village");
  if (!plan || !cultureDef || !religionDef || !demography)
    throw new Error("contenido familiar incompleto");
  const culture = seedCulture(truth, ids, log, {
    settlement,
    place,
    now: 0,
    foundersEvent: seedEvent,
    culture: cultureDef,
    traits: content.all(CULTURE_TRAITS),
  });
  const religion = seedReligion(truth, ids, log, {
    settlement,
    place,
    now: 0,
    foundersEvent: seedEvent,
    religion: religionDef,
    doctrines: content.all(DOCTRINES),
  });
  for (const [id, sex, spouse, age] of [
    [mother, "female", father, 25],
    [father, "male", mother, 30],
  ] as const) {
    truth.set(PERSON, id, {
      sex,
      spouse,
      household: home,
      mother: null,
      father: null,
      born: (-age * clock.year) as Tick,
    });
    truth.set(GENOME, id, founderGenome(traits, Rng.root(SEED).fork("founder", id), seedEvent));
    truth.set(INNATE, id, Object.fromEntries(traits.map((trait) => [trait.id, trait.mean])));
    truth.set(LOCATION, id, { hex: 0 });
    truth.set(
      PERSON_CULTURE,
      id,
      seedPersonCulture(
        {
          community: culture,
          traits: content.all(CULTURE_TRAITS),
          parents: [],
          since: 0,
          originEventId: seedEvent,
        },
        Rng.root(SEED).fork("culture", id),
      ),
    );
    truth.set(RELIGIOUS_IDENTITY, id, {
      affiliations: [
        seedAffiliation(
          { religion, parents: [], learnedFrom: [], since: 0, originEventId: seedEvent },
          Rng.root(SEED).fork("faith", id),
        ),
      ],
      doubts: [],
    });
  }
  truth.set(PERSON_NAME, father, {
    language: language.id,
    parts: [
      {
        kind: "family",
        lexemes: ["rock"],
        meaning: ["roca"],
        form: "Karo",
        givenBy: null,
        event: seedEvent,
        usedBy: "all",
      },
    ],
  });
  const ledger = new Ledger({ externals: { seed: [coin] } });
  ledger.post({
    tick: 0,
    eventId: seedEvent,
    transfers: [
      { unit: coin, from: externalAccount("seed"), to: holderAccount(home), amount: 100 },
    ],
  });
  const scheduler = new Scheduler({
    rng: Rng.root(SEED),
    clock,
    truth,
    ids,
    log,
    ledger,
    resolution: "local",
    processes: [
      conceptionProcess({ clock, demography, placeOf: () => place }),
      laborProcess({
        clock,
        labors: [],
        more: { reads: [PREGNANCY.name], of: pregnancyLabors },
        placeOf: () => place,
      }),
      birthProcess({
        clock,
        traits,
        bodyPlans: [plan],
        placeOf: () => place,
        newborn: {
          language,
          schemas: content.all(SCHEMAS),
          dims: content.all(RELATION_DIMS),
          bonds: content.all(RELATION_BONDS),
          cultureTraits: content.all(CULTURE_TRAITS),
          skills: new SkillCatalog(content.all(SKILLS), content.all(ACTIONS)),
          tastes: content.all(TASTES),
        },
      }),
      newbornBondsProcess({ dims: content.all(RELATION_DIMS), bonds: content.all(RELATION_BONDS) }),
    ],
  });
  return { truth, log, ledger, scheduler };
}

describe("cobertura familiar dirigida con curva y gestación normales", () => {
  it("concibe, resuelve el parto y origina al hijo con nombre, mente y parentesco", () => {
    const w = fertileFamily();
    expect(FULL_PROFILE).not.toHaveProperty("conceptionRateScale");
    expect(FULL_PROFILE).not.toHaveProperty("conceptionGestationDays");
    w.scheduler.advanceTo(clock.day);
    const conceived = w.log.all().find((event) => event.kind === "family.conception");
    expect(conceived?.tick).toBe(clock.day);
    const pregnancy = w.truth.get(PREGNANCY, mother);
    expect(pregnancy?.originEventId).toBe(conceived?.id);
    expect((pregnancy?.dueAt ?? 0) - (pregnancy?.conceivedAt ?? 0)).toBe(
      GESTATION_DAYS * clock.day,
    );
    w.scheduler.advanceTo(GESTATION_DAYS * clock.day);
    expect(w.log.all().some((event) => event.kind === "family.birth")).toBe(false);
    expect(w.truth.ids(PERSON)).toHaveLength(2);
    w.scheduler.advanceTo((GESTATION_DAYS + 3) * clock.day);
    const labors = w.log.all().filter((event) => event.kind === "body.labor");
    const births = w.log.all().filter((event) => event.kind === "family.birth");
    expect(labors).toHaveLength(1);
    expect(births).toHaveLength(1);
    const birth = births[0];
    if (!birth) throw new Error("sin nacimiento");
    const child = birth.actors[0];
    if (!child) throw new Error("sin hijo");
    expect(birth.causes).toEqual([{ kind: "event", event: labors[0]?.id }]);
    expect(w.truth.get(LABOR, mother)?.cause).toBe(labors[0]?.id);
    expect(w.truth.ids(PERSON)).toHaveLength(3);
    expect(w.truth.get(PERSON, child)).toMatchObject({
      mother,
      father,
      household: home,
      born: (GESTATION_DAYS + 2) * clock.day,
    });
    expect(w.truth.get(ENTITY, child)?.originEventId).toBe(birth.id);
    expect(w.truth.get(GENOME, child)?.parents).toEqual([mother, father]);
    expect(w.truth.get(GENOME, child)?.originEventId).toBe(birth.id);
    expect(w.truth.get(BODY_STATE, child)?.massKg).toBeGreaterThan(0);
    const name = w.truth.get(PERSON_NAME, child);
    expect(name?.parts.find((part) => part.kind === "family")?.form).toBe("Karo");
    expect(name?.parts.find((part) => part.kind === "given")?.meaning.length).toBeGreaterThan(0);
    expect(name?.parts.find((part) => part.kind === "given")?.event).toBe(birth.id);
    expect(w.truth.get(MIND, child)?.originEventId).toBe(birth.id);
    expect(w.truth.get(HOUSEHOLD, home)?.members).toEqual([mother, father, child]);
    for (const parent of [mother, father]) {
      expect(w.truth.get(RELATIONS, child)?.toward[parent]?.bonds).toContain("parent");
      expect(w.truth.get(RELATIONS, parent)?.toward[child]?.bonds).toContain("child");
    }
    expect(w.truth.get(PERSON_CULTURE, child)?.originEventId).toBe(birth.id);
    expect(Object.keys(w.truth.get(PERSON_CULTURE, child)?.holdings ?? {}).length).toBeGreaterThan(
      0,
    );
    expect(w.truth.get(RELIGIOUS_IDENTITY, child)?.affiliations[0]?.originEventId).toBe(birth.id);
    expect(w.truth.get(SKILL_STATE, child)).toBeDefined();
    expect(w.truth.get(SELF_IMAGES, child)).toBeDefined();
    expect(w.truth.get(TASTES_OF, child)?.originEventId).toBe(birth.id);
    const rows = w.truth.rows();
    const entries = w.ledger.journal().slice();
    w.scheduler.advanceTo((GESTATION_DAYS + 4) * clock.day);
    expect(w.truth.rows()).toEqual(rows);
    expect(w.ledger.journal()).toEqual(entries);
    expect(w.ledger.balance(holderAccount(home), coin)).toBe(100);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  });

  it("seed y pareja iguales repiten las filas, los nombres, los eventos y el ledger", () => {
    const a = fertileFamily();
    const b = fertileFamily();
    for (const w of [a, b]) w.scheduler.advanceTo((GESTATION_DAYS + 4) * clock.day);
    expect(a.truth.rows()).toEqual(b.truth.rows());
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.ledger.journal()).toEqual(b.ledger.journal());
  });
});
