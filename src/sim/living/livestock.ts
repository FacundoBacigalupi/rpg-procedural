// El ganado de la aldea (livestock-herd, living-world §12 «Ganado como bien vivo»): perros,
// gallinas y bueyes como entidades con identidad (`animal:n`), dueño y origen. Los traen los hogares
// cuando levantan la casa: un evento por hogar causado por el de construcción, y cada animal nace
// de ese evento. Viven en el patio de la casa (el hex abierto, sin espacio).
//
// Envejecen, mueren y paren (livestock-life, `livestockLifeProcess`): la muerte por edad sube con
// los años (sin hambre ni enfermedad todavía), y la hembra madura con un macho a mano (de la casa o
// de la aldea, según la especie) pare una camada con origen en ella. Mientras no coman
// (livestock-feed), el tope de animales por casa hace las veces de lo que el patio puede mantener.
// El cuerpo muerto queda para el hogar dueño como carne y piel cruda (livestock-carcass,
// `carcassYield`): lotes del ledger que entran desde `CARCASS_SOURCE` con el evento de la muerte.
//
// Lo que dan en vida (livestock-yield, `livestockYieldProcess`): por ahora los huevos de las
// gallinas, unidades enteras que cada hembra adulta pone con una chance diaria y entran a la comida
// del hogar desde `LAID_SOURCE`. Sin estaciones ni comida todavía: ponen igual en invierno.

import {
  type AnimalId,
  type BuildingId,
  contentId,
  type Duration,
  defineContent,
  type EventId,
  type EventLog,
  externalAccount,
  type HouseholdId,
  holderAccount,
  type IdAllocator,
  type LedgerUnit,
  ledgerUnit,
  pow,
  Rng,
  type SettlementId,
  type Tick,
  z,
} from "../../core/index.ts";
import type { Sex } from "../family/index.ts";
import {
  createEntity,
  deleteComponent,
  draftEvent,
  type EventDraft,
  endEntity,
  type PostingDraft,
  type ProcessDef,
  type StateChange,
  setComponent,
} from "../scheduler/index.ts";
import { BUILDING } from "../settlements/index.ts";
import {
  ENTITY,
  LOCATION,
  type ReadonlyWorldTruth,
  table,
  type WorldTruth,
} from "../world/index.ts";

/** Cómo se reproduce una especie (livestock-life); sin esto no pare (el buey, castrado). */
export const BreedingDef = z.strictObject({
  /** Desde qué edad pare o cubre (años). */
  maturityYears: z.number().positive(),
  /** Cuántas camadas por año tiene una hembra madura con macho a mano. */
  littersPerYear: z.number().positive(),
  /** Cuántas crías por camada: entre el mínimo y el máximo. */
  litter: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  /** Dónde busca macho: en la misma casa (las gallinas y su gallo) o en toda la aldea (los perros). */
  mate: z.enum(["household", "settlement"]),
  /** Cuántos de la especie mantiene una casa: más allá, no se crían (hasta que coman, livestock-feed). */
  maxPerHousehold: z.number().int().min(1),
});
export type BreedingDef = z.infer<typeof BreedingDef>;

/** Algo que el animal da en vida (livestock-yield): los huevos de la gallina. */
export const YieldDef = z.strictObject({
  /** El bien (`content/goods`). */
  good: contentId,
  /** Gramos de una unidad (un huevo). */
  unitGrams: z.number().int().min(1),
  /** Cuántas unidades por año da un animal que puede (sin calibrar). */
  perYear: z.number().positive(),
  /** Qué sexo lo da (las gallinas, no el gallo); sin esto, ambos. */
  sex: z.enum(["female", "male"]).optional(),
  /** Desde qué edad (años). */
  minAgeYears: z.number().min(0).default(0),
});
export type YieldDef = z.infer<typeof YieldDef>;

/** Qué deja el cuerpo muerto (livestock-carcass); sin esto no deja nada que se guarde. */
export const CarcassDef = z.strictObject({
  /** El bien de la carne (`content/goods`) y qué parte de la masa viva es carne. */
  meat: contentId.optional(),
  meatShare: z.number().min(0).max(1).default(0),
  /** El bien de la piel cruda y qué parte de la masa viva es piel. */
  hide: contentId.optional(),
  hideShare: z.number().min(0).max(1).default(0),
});
export type CarcassDef = z.infer<typeof CarcassDef>;

export const LivestockDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  /** Lo que se ve (perception §3): la silueta que pinta la escena y nombra el narrador. */
  shape: z.string().min(1),
  /** Masa de un adulto (kg). */
  massKg: z.number().positive(),
  /** Vida típica (años): de ella sale la edad de los que llegan con la casa. */
  lifespanYears: z.number().positive(),
  /** Cuántos trae cada hogar que lo tiene. */
  count: z.number().int().min(1),
  /** Desde cuántos miembros lo tiene un hogar (el buey, en las casas grandes). */
  minMembers: z.number().int().min(1).optional(),
  /** Qué parte son hembras (las gallinas: casi todas). */
  femaleShare: z.number().min(0).max(1),
  /** Cómo se reproduce (livestock-life); sin esto, no pare. */
  breeding: BreedingDef.optional(),
  /** Qué deja el cuerpo muerto (livestock-carcass). */
  carcass: CarcassDef.optional(),
  /** Lo que da en vida (livestock-yield). */
  yields: z.array(YieldDef).optional(),
});
export type LivestockDef = z.infer<typeof LivestockDef>;
export const LIVESTOCK = defineContent("livestock", LivestockDef);

/** Un animal de la casa: de qué especie es, su sexo, cuándo nació y de quién es. */
export interface AnimalRecord {
  readonly species: string;
  readonly sex: Sex;
  readonly bornAt: Tick;
  /** El hogar dueño (la tenencia formal queda para property). */
  readonly owner: HouseholdId;
  /** La casa en cuyo patio vive. */
  readonly home: BuildingId;
}

export const ANIMAL = table<AnimalRecord>("living.animal");

export interface SeedLivestockInput {
  readonly seed: number;
  readonly settlement: SettlementId;
  readonly species: readonly LivestockDef[];
  /** Cuántos viven en cada hogar (los que no están no tienen casa que poblar). */
  readonly members: ReadonlyMap<string, number>;
  /** Duración del año (ticks), para la edad de los que llegan. */
  readonly yearTicks: number;
}

/** Siembra el ganado de cada casa viva del asentamiento. Devuelve cuántos animales creó. */
export function seedLivestock(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedLivestockInput,
): number {
  if (input.species.length === 0) return 0;
  const species = [...input.species].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const root = Rng.root(input.seed);
  let made = 0;
  for (const id of [...truth.ids(BUILDING)].sort() as BuildingId[]) {
    const b = truth.get(BUILDING, id);
    const household = b?.household;
    if (!b || household === undefined || b.settlement !== input.settlement) continue;
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const members = input.members.get(household) ?? 0;
    if (members === 0) continue;
    const kept = species.filter((s) => (s.minMembers ?? 1) <= members);
    if (kept.length === 0) continue;
    const at: Tick = truth.get(ENTITY, id)?.createdAt ?? 0;
    const event: EventId = ids.next("event");
    log.append({
      id: event,
      tick: at,
      kind: "settlement.livestock_brought",
      data: { building: id, household, species: kept.map((s) => s.id) },
      causes: [{ kind: "event", event: b.builtBy }],
      actors: [],
      place: { kind: "settlement", settlement: input.settlement },
      emissions: null,
      resolution: "history",
    });
    for (const s of kept) {
      for (let n = 0; n < s.count; n++) {
        const animal: AnimalId = ids.next("animal");
        const r = root.fork("living", "animal", animal).stream();
        const sex: Sex = r.float() < s.femaleShare ? "female" : "male";
        // Llegan jóvenes o adultos: hasta las tres quintas partes de su vida.
        const age = Math.floor(r.float() * 0.6 * s.lifespanYears * input.yearTicks);
        truth.set(ENTITY, animal, { id: animal, originEventId: event, createdAt: at });
        truth.set(ANIMAL, animal, {
          species: s.id,
          sex,
          bornAt: at - age,
          owner: household as HouseholdId,
          home: id,
        });
        truth.set(LOCATION, animal, { hex: b.hex });
        made++;
      }
    }
  }
  return made;
}

// ---------------------------------------------------------------------------------------------
// Envejecer, morir, parir (livestock-life)

export const LIVESTOCK_LIFE_PROCESS = "living.livestock_life";

/** Mortalidad anual de fondo de un animal sano (sin calibrar). */
export const LIVESTOCK_BASE_MORTALITY = 0.03;
/** Lo que suma la vejez a la mortalidad anual cuando llega a su vida típica (sin calibrar). */
export const LIVESTOCK_OLD_MORTALITY = 0.5;

/**
 * Pura: la probabilidad de morir en un año a la edad `ageYears` para una especie de vida típica
 * `lifespanYears`: un fondo chico más una vejez que crece con la quinta potencia de la edad
 * relativa (casi nada de joven, la mitad del año al llegar a su vida típica, segura más allá).
 */
export function yearlyMortality(ageYears: number, lifespanYears: number): number {
  const rel = Math.max(0, ageYears) / lifespanYears;
  return Math.min(1, LIVESTOCK_BASE_MORTALITY + LIVESTOCK_OLD_MORTALITY * pow(rel, 5));
}

/** Pura: de la probabilidad anual a la de un paso de `step` ticks en un año de `year` ticks. */
export function stepChance(yearly: number, step: Duration, year: Duration): number {
  if (yearly >= 1) return 1;
  return 1 - pow(1 - yearly, step / year);
}

/** De donde entra al ledger lo que deja un animal muerto (su cuerpo, que el ledger no llevaba). */
export const CARCASS_SOURCE = "carcass";

/** Las unidades del ledger que puede dejar el ganado muerto (para declarar `CARCASS_SOURCE`). */
export function carcassUnits(species: readonly LivestockDef[]): LedgerUnit[] {
  const goods = species.flatMap((s) => [s.carcass?.meat, s.carcass?.hide]);
  return [...new Set(goods.filter((g) => g !== undefined))]
    .sort()
    .map((g) => ledgerUnit(`good:${g}`));
}

/**
 * Pura: los gramos de cada bien que deja el cuerpo de un animal de `ageYears`: la masa adulta por
 * la parte de cada bien, menos en las crías (crecen hasta su madurez, o hasta el año sin ella;
 * nunca menos de un décimo). Sin `carcass`, nada.
 */
export function carcassYield(
  def: LivestockDef,
  ageYears: number,
): { good: string; grams: number }[] {
  const c = def.carcass;
  if (!c) return [];
  const grown = Math.min(1, Math.max(0.1, ageYears / (def.breeding?.maturityYears ?? 1)));
  const out: { good: string; grams: number }[] = [];
  for (const [good, share] of [
    [c.meat, c.meatShare],
    [c.hide, c.hideShare],
  ] as const) {
    const grams = Math.round(def.massKg * 1000 * share * grown);
    if (good !== undefined && grams > 0) out.push({ good, grams });
  }
  return out;
}

export interface LivestockLifeOptions {
  readonly species: readonly LivestockDef[];
  /** Duración del año (ticks). */
  readonly year: Duration;
}

/** El hogar y la aldea de un animal, para buscar macho. */
function settlementOf(truth: ReadonlyWorldTruth, a: AnimalRecord) {
  return truth.get(BUILDING, a.home)?.settlement;
}

/**
 * Cada día: cada animal vivo puede morir de viejo (evento `living.animal_died` causado por su edad),
 * y cada hembra madura con macho maduro a mano puede parir (evento `living.animal_born` causado
 * por la madre; las crías salen de ese evento, en la misma casa y del mismo dueño), sin pasar el
 * tope de la especie por casa. Lo de cada animal se tira con su propia rama del rng.
 */
export function livestockLifeProcess(o: LivestockLifeOptions): ProcessDef {
  const byId = new Map(o.species.map((s) => [s.id, s]));
  return {
    id: LIVESTOCK_LIFE_PROCESS,
    system: "living",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [ANIMAL.name, ENTITY.name, BUILDING.name, LOCATION.name],
    writes: [ANIMAL.name, ENTITY.name, LOCATION.name],
    scopeGuard: (truth) => truth.ids(ANIMAL).length > 0,
    run(ctx) {
      const step = ctx.window > 0 ? ctx.window : 1;
      const alive: [AnimalId, AnimalRecord][] = [];
      for (const id of [...ctx.truth.ids(ANIMAL)].sort() as AnimalId[]) {
        const a = ctx.truth.get(ANIMAL, id);
        if (a && ctx.truth.get(ENTITY, id)?.endedAt === undefined) alive.push([id, a]);
      }
      if (alive.length === 0) return {};
      const ageYears = (a: AnimalRecord) => (ctx.now - a.bornAt) / o.year;
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      const postings: PostingDraft[] = [];
      const dead = new Set<AnimalId>();
      // Primero las muertes: quien muere hoy no pare ni cubre.
      for (const [id, a] of alive) {
        const def = byId.get(a.species);
        if (!def) continue;
        const r = ctx.rng.fork("death", id).stream();
        if (r.float() >= stepChance(yearlyMortality(ageYears(a), def.lifespanYears), step, o.year))
          continue;
        const base = ctx.truth.get(ENTITY, id);
        if (!base) continue;
        const end = draftEvent(events.length);
        events.push({
          kind: "living.animal_died",
          actors: [],
          place: { kind: "building", building: a.home },
          data: { animal: id, species: a.species, owner: a.owner, cause: "age" },
          causes: [{ kind: "state", entity: id, key: "age" }],
          emissions: null,
        });
        changes.push(endEntity(base, end, ctx.now), deleteComponent(LOCATION, id));
        dead.add(id);
        // El cuerpo queda en la casa dueña como carne y piel.
        const transfers = carcassYield(def, ageYears(a)).map((y) => ({
          unit: ledgerUnit(`good:${y.good}`),
          from: externalAccount(CARCASS_SOURCE),
          to: holderAccount(a.owner),
          amount: y.grams,
        }));
        if (transfers.length > 0) postings.push({ event: end, transfers });
      }
      // Cuántos de cada especie hay por casa (para el tope) y qué machos maduros hay dónde.
      const count = new Map<string, number>();
      const males = new Set<string>();
      for (const [id, a] of alive) {
        if (dead.has(id)) continue;
        const key = `${a.owner}|${a.species}`;
        count.set(key, (count.get(key) ?? 0) + 1);
        const b = byId.get(a.species)?.breeding;
        if (a.sex === "male" && b && ageYears(a) >= b.maturityYears) {
          males.add(key);
          males.add(`${settlementOf(ctx.truth, a)}|${a.species}`);
        }
      }
      for (const [id, a] of alive) {
        const b = byId.get(a.species)?.breeding;
        if (dead.has(id) || a.sex !== "female" || !b || ageYears(a) < b.maturityYears) continue;
        const key = `${a.owner}|${a.species}`;
        const mate = b.mate === "household" ? key : `${settlementOf(ctx.truth, a)}|${a.species}`;
        if (!males.has(mate)) continue;
        const room = b.maxPerHousehold - (count.get(key) ?? 0);
        if (room <= 0) continue;
        const r = ctx.rng.fork("birth", id).stream();
        if (r.float() >= stepChance(Math.min(1, b.littersPerYear / 365), step, o.year / 365))
          continue;
        const [lo, hi] = b.litter;
        const size = Math.min(room, lo + Math.floor(r.float() * (hi - lo + 1)));
        const def = byId.get(a.species);
        const born = draftEvent(events.length);
        const hex = ctx.truth.get(LOCATION, id)?.hex ?? 0;
        const young: AnimalId[] = [];
        for (let n = 0; n < size; n++) {
          const child = ctx.newId("animal");
          young.push(child);
          const sex: Sex = r.float() < (def?.femaleShare ?? 0.5) ? "female" : "male";
          changes.push(
            createEntity(child, born, ctx.now),
            setComponent(ANIMAL, child, { ...a, sex, bornAt: ctx.now }),
            setComponent(LOCATION, child, { hex }),
          );
        }
        events.push({
          kind: "living.animal_born",
          actors: [],
          place: { kind: "building", building: a.home },
          data: { mother: id, species: a.species, owner: a.owner, young },
          causes: [{ kind: "state", entity: id, key: "pregnancy" }],
          emissions: null,
        });
        count.set(key, (count.get(key) ?? 0) + size);
      }
      if (events.length === 0) return {};
      return postings.length > 0 ? { events, changes, postings } : { events, changes };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Lo que dan en vida (livestock-yield)

export const LIVESTOCK_YIELD_PROCESS = "living.livestock_yield";
/** De donde entra al ledger lo que pone el ganado (lo que comen todavía no está en el ledger). */
export const LAID_SOURCE = "laid";

/** Las unidades del ledger que puede dar el ganado en vida (para declarar `LAID_SOURCE`). */
export function yieldUnits(species: readonly LivestockDef[]): LedgerUnit[] {
  const goods = species.flatMap((s) => (s.yields ?? []).map((y) => y.good));
  return [...new Set(goods)].sort().map((g) => ledgerUnit(`good:${g}`));
}

export interface LivestockYieldOptions {
  readonly species: readonly LivestockDef[];
  /** Duración del año (ticks). */
  readonly year: Duration;
}

/**
 * Cada día: cada animal vivo que da algo (la gallina adulta, huevos) tiene una chance de dar una
 * unidad (`perYear` repartido en el año); lo de cada hogar y bien entra junto, en un evento
 * `living.animal_yield` causado por los animales que dieron, a la cuenta del hogar dueño.
 */
export function livestockYieldProcess(o: LivestockYieldOptions): ProcessDef {
  const byId = new Map(o.species.map((s) => [s.id, s]));
  return {
    id: LIVESTOCK_YIELD_PROCESS,
    system: "living",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [ANIMAL.name, ENTITY.name],
    writes: [],
    scopeGuard: (truth) => truth.ids(ANIMAL).length > 0,
    run(ctx) {
      const step = ctx.window > 0 ? ctx.window : 1;
      // hogar|bien -> animales que dieron hoy y gramos.
      const got = new Map<
        string,
        { owner: HouseholdId; home: BuildingId; good: string; from: AnimalId[]; grams: number }
      >();
      for (const id of [...ctx.truth.ids(ANIMAL)].sort() as AnimalId[]) {
        const a = ctx.truth.get(ANIMAL, id);
        if (!a || ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const yields = byId.get(a.species)?.yields ?? [];
        const age = (ctx.now - a.bornAt) / o.year;
        yields.forEach((y, i) => {
          if ((y.sex !== undefined && y.sex !== a.sex) || age < y.minAgeYears) return;
          const chance = Math.min(1, (y.perYear * step) / o.year);
          if (ctx.rng.fork("yield", id, i).float() >= chance) return;
          const key = `${a.owner}|${y.good}`;
          const g = got.get(key) ?? {
            owner: a.owner,
            home: a.home,
            good: y.good,
            from: [],
            grams: 0,
          };
          g.from.push(id);
          g.grams += y.unitGrams;
          got.set(key, g);
        });
      }
      if (got.size === 0) return {};
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      for (const key of [...got.keys()].sort()) {
        const g = got.get(key);
        if (!g) continue;
        const event = draftEvent(events.length);
        events.push({
          kind: "living.animal_yield",
          actors: [],
          place: { kind: "building", building: g.home },
          data: { owner: g.owner, good: g.good, grams: g.grams, from: g.from },
          causes: g.from.map((id) => ({ kind: "state" as const, entity: id, key: "yield" })),
          emissions: null,
        });
        postings.push({
          event,
          transfers: [
            {
              unit: ledgerUnit(`good:${g.good}`),
              from: externalAccount(LAID_SOURCE),
              to: holderAccount(g.owner),
              amount: g.grams,
            },
          ],
        });
      }
      return { events, postings };
    },
  };
}
