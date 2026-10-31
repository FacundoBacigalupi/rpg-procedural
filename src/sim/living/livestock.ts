// El ganado de la aldea (livestock-herd, living-world §12 «Ganado como bien vivo»): perros,
// gallinas y bueyes como entidades con identidad (`animal:n`), dueño y origen. Los traen los hogares
// cuando levantan la casa: un evento por hogar causado por el de construcción, y cada animal nace
// de ese evento. Viven en el patio de la casa (el hex abierto, sin espacio).
//
// Envejecen, mueren y paren (livestock-life, `livestockLifeProcess`): la muerte por edad sube con
// los años (y con el hambre, abajo; sin enfermedad todavía), y la hembra madura con un macho a mano
// (de la casa o de la aldea, según la especie) pare una camada con origen en ella. El tope de
// animales por casa hace las veces de lo que el patio puede mantener.
// El cuerpo muerto queda para el hogar dueño como carne y piel cruda (livestock-carcass,
// `carcassYield`): lotes del ledger que entran desde `CARCASS_SOURCE` con el evento de la muerte.
//
// Lo que dan en vida (livestock-yield, `livestockYieldProcess`): por ahora los huevos de las
// gallinas, unidades enteras que cada hembra adulta pone con una chance diaria y entran a la comida
// del hogar desde `LAID_SOURCE`. Con `daylightHours` (livestock-yield-season) ponen menos con los
// días cortos (`daylightFactor`); con `tempC` y `hunger` (livestock-yield-feed), también con frío
// (`coldFactor`) y si pasan hambre (`hungerFactor`).
//
// Comen (livestock-feed, `livestockFeedProcess`): cada día la ración que da la casa (`feed`: gramos
// por día de un adulto, de las categorías de comida que acepta, en orden) sale de la cuenta del
// hogar dueño al sumidero `FED_SINK`. Lo que falta sube el hambre (`ANIMAL_HUNGER`, de 0 a 1 en
// `starveDays` sin comer nada), lo que come la baja al mismo ritmo; con hambre muere más
// (flaqueza), no pare si pasa de la mitad y muere de hambre al llegar a 1.
//
// Pastan (livestock-feed-pasture, `graze`): con `pasture`, lo que crece al alcance de la aldea (una
// parte `pasture.share` de la producción de la celda, `ECOLOGY.cell.productivity`) cubre hasta
// `graze.share` de la ración de cada animal que pasta o escarba, repartido entre todos según lo que
// piden (`graze.kgPerDay`); la casa pone el resto. Lo pastado queda en `GRAZED` y la ecología lo
// descuenta de lo que comen los herbívoros del monte al día siguiente.
//
// Leche (livestock-yield-milk, `lactationDays`): la hembra que parió da leche los días que siguen
// (`LACTATING`, que escribe `livestockLifeProcess` con `lactation`); sin cría reciente no da. Las
// especies lecheras llegan con su propia opción de vida (`optIn`, `herdSpecies`).

import {
  type AgentId,
  type AnimalId,
  type BuildingId,
  contentId,
  type Duration,
  defineContent,
  type EventId,
  type EventLog,
  exp,
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
import { PERSON, type Sex } from "../family/index.ts";
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
import { ECOLOGY } from "./ecology.ts";

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
  /** Cuántos de la especie mantiene una casa: más allá, no se crían (el patio no da para más). */
  maxPerHousehold: z.number().int().min(1),
});
export type BreedingDef = z.infer<typeof BreedingDef>;

/**
 * Lo que la casa le da de comer (livestock-feed): la ración de un adulto por día y qué categorías de
 * comida del hogar acepta, en orden de preferencia. Lo que pasta por su cuenta no entra acá.
 */
export const FeedDef = z.strictObject({
  gramsPerDay: z.number().positive(),
  categories: z.array(z.string().min(1)).min(1),
  /** Días sin comer nada hasta morir de hambre (y los mismos, comiendo todo, para reponerse). */
  starveDays: z.number().positive().default(20),
  /**
   * Lo que pasta o escarba (livestock-feed-pasture): con pasto de sobra cubre `share` de la ración
   * comiendo `kgPerDay` kg de planta un adulto; sin esto, todo sale de la casa.
   */
  graze: z
    .strictObject({ share: z.number().min(0).max(1), kgPerDay: z.number().positive() })
    .optional(),
});
export type FeedDef = z.infer<typeof FeedDef>;

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
  /**
   * Horas de luz bajo las que da lo mínimo y desde las que da todo (livestock-yield-season: la
   * gallina pone con días largos); sin esto, la luz no importa.
   */
  daylightHours: z.tuple([z.number().min(0), z.number().max(24)]).optional(),
  /** Qué parte da con los días más cortos (la gallina en invierno pone poco, no nada). */
  daylightFloor: z.number().min(0).max(1).default(0),
  /**
   * Temperatura media del día (°C) bajo la que da lo mínimo y desde la que da todo
   * (livestock-yield-feed: con frío la gallina gasta en calentarse); sin esto, el frío no importa.
   */
  coldC: z.tuple([z.number(), z.number()]).optional(),
  /** Qué parte da con el frío más fuerte. */
  coldFloor: z.number().min(0).max(1).default(0),
  /**
   * Hambre (`ANIMAL_HUNGER`, 0-1) en la que deja de dar; baja lineal desde 0 (livestock-yield-feed).
   * Sin esto, el hambre no la frena.
   */
  hungerStop: z.number().positive().max(1).optional(),
  /**
   * Días después de parir en que lo da (livestock-yield-milk: la leche); sin esto, lo da sin parir.
   * Sin `LACTATING` (cría reciente), no lo da.
   */
  lactationDays: z.number().int().positive().optional(),
  /**
   * La curva de lactancia (livestock-milk-curve, curva de Wood `t^shape · e^(−shape·t/peakDay)`):
   * sube después del parto, llega al pico el día `peakDay` y baja; cada unidad pesa lo que dice la
   * curva en ese día, con media 1 en los `lactationDays` (lo de la temporada no cambia).
   */
  lactationCurve: z
    .strictObject({
      peakDay: z.number().positive(),
      shape: z.number().positive().default(0.3),
    })
    .optional(),
  /**
   * Lo que mama la cría (livestock-milk-suckle): los primeros `days` días después de parir, cada
   * cría viva se toma `sharePerYoung` de lo que da la madre (la casa recibe el resto).
   * `fosterPerDay` (livestock-milk-foster): la chance por día de que otra madre de la casa acepte
   * a una huérfana (se divide por uno más las crías que ya amamanta); sin esto, nunca.
   */
  suckle: z
    .strictObject({
      days: z.number().int().positive(),
      sharePerYoung: z.number().min(0).max(1),
      fosterPerDay: z.number().min(0).max(1).optional(),
    })
    .optional(),
  /**
   * El ordeñe (livestock-milk-work): alguien del hogar ordeña `headPerHour` por hora; lo que no se
   * ordeña no llega a la casa y la que pasa `dryAfterDays` días seguidos sin ordeñar se seca.
   */
  milking: z
    .strictObject({
      headPerHour: z.number().positive(),
      dryAfterDays: z.number().int().positive(),
    })
    .optional(),
  /**
   * La esquila (livestock-milk-culture-sheep-shear): con `shear` en el proceso, en vez de un día al
   * azar se esquila el primer día con media de `warmC` °C o más, pasados `intervalDays` desde la
   * última (`SHORN`; sin fila, desde que nació); da la lana que creció (`unitGrams` por año, hasta
   * un año).
   */
  shear: z
    .strictObject({
      warmC: z.number(),
      intervalDays: z.number().int().positive().default(300),
    })
    .optional(),
});
export type YieldDef = z.infer<typeof YieldDef>;

/**
 * El tiro (livestock-yield-draft): el animal adulto tira del arado y la hora de campo de quien lo
 * usa rinde `fieldRate` veces; sirve a `workers` personas a la vez y con hambre `hungerStop` no tira.
 * Los días de campo come `workFeedFactor` veces su ración (livestock-draft-cost).
 */
export const DraftDef = z.strictObject({
  fieldRate: z.number().min(1),
  workers: z.number().int().min(1).default(1),
  minAgeYears: z.number().min(0).default(0),
  hungerStop: z.number().positive().max(1).default(0.5),
  workFeedFactor: z.number().min(1).default(1),
  /**
   * El cansancio (livestock-draft-fatigue): las horas por día que tira sin cansarse, cuánto del
   * cansancio se va (y se acerca al de hoy) por día, y desde cuántas horas en el día no tira más.
   * `restAbove` (livestock-draft-rest): desde qué cansancio el hogar lo descansa al llegar a
   * `hoursPerDay`, en vez de seguir hasta el tope; sin esto, sigue.
   */
  fatigue: z
    .strictObject({
      hoursPerDay: z.number().positive(),
      recoveryPerDay: z.number().min(0).max(1),
      maxHoursPerDay: z.number().positive(),
      restAbove: z.number().min(0).max(1).optional(),
    })
    .optional(),
});
export type DraftDef = z.infer<typeof DraftDef>;

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
  /**
   * Entre qué edades (años) están los que hay en la casa al empezar (livestock-herd-ages: el buey de
   * la casa ya tira); sin esto, entre 0 y las tres quintas partes de su vida.
   */
  herdAgeYears: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  /** Qué parte son hembras (las gallinas: casi todas). */
  femaleShare: z.number().min(0).max(1),
  /** Cómo se reproduce (livestock-life); sin esto, no pare. */
  breeding: BreedingDef.optional(),
  /** Qué deja el cuerpo muerto (livestock-carcass). */
  carcass: CarcassDef.optional(),
  /** Lo que da en vida (livestock-yield). */
  yields: z.array(YieldDef).optional(),
  /** Lo que le da de comer la casa (livestock-feed); sin esto, no come de la casa. */
  feed: FeedDef.optional(),
  /** Si tira del arado (livestock-yield-draft); sin esto, no. */
  draft: DraftDef.optional(),
  /**
   * Si cuida la casa (livestock-predators-dog): el adulto comido espanta con chance `repel` al
   * depredador que viene por otro animal del mismo hogar; sin esto, no cuida.
   */
  guard: z
    .strictObject({
      repel: z.number().min(0).max(1),
      minAgeYears: z.number().min(0).default(0),
      hungerStop: z.number().positive().max(1).default(0.5),
    })
    .optional(),
  /**
   * Lo que la ataja el corral cerrado de noche (livestock-predators-pen), 0-1: chance de que el
   * depredador que viene por este animal no pueda entrar si su casa tiene patio y alguien vivo que
   * lo cierre; sin esto, el patio no lo guarda.
   */
  pen: z.number().min(0).max(1).optional(),
  /**
   * Qué casas lo tienen según la tierra (livestock-milk-culture-terrain): la chance de que una casa
   * lo traiga es `base + rough · (parte quebrada de la tierra de alrededor)`, entre 0 y 1 (la cabra
   * en la loma, el buey en el llano); sin esto, lo tienen todas.
   */
  keeps: z
    .strictObject({ base: z.number().min(0).max(1), rough: z.number().min(-1).max(1) })
    .optional(),
  /** Lo expuesto que está a los depredadores que bajan (livestock-predators), 0-1: peso al elegir presa. */
  exposure: z.number().min(0).max(1).default(1),
  /**
   * La opción de vida que trae a la especie (livestock-yield-milk: `dairy`, las lecheras;
   * livestock-milk-culture-species: `sheep`, las ovejas; livestock-milk-culture-cow: `cow`, la
   * vaca lechera); sin esto, llega con el ganado de siempre.
   */
  optIn: z.enum(["dairy", "sheep", "cow"]).optional(),
});
export type LivestockDef = z.infer<typeof LivestockDef>;
export const LIVESTOCK = defineContent("livestock", LivestockDef);

/** Pura: las especies que tiene la aldea con las opciones `optIns` (las de siempre, más esas). */
export function herdSpecies(
  all: readonly LivestockDef[],
  optIns: ReadonlySet<string>,
): LivestockDef[] {
  return all.filter((s) => s.optIn === undefined || optIns.has(s.optIn));
}

/**
 * Pura (livestock-milk-culture-terrain): la chance de que una casa tenga la especie con
 * `roughShare` (0-1) de tierra quebrada alrededor; sin `keeps`, 1.
 */
export function keepChance(def: LivestockDef, roughShare: number): number {
  if (def.keeps === undefined) return 1;
  return Math.min(1, Math.max(0, def.keeps.base + def.keeps.rough * roughShare));
}

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

/** El hambre de un animal (livestock-feed): de 0 (comido) a 1 (muere); sin fila, comido. */
export interface AnimalHunger {
  readonly level: number;
}

export const ANIMAL_HUNGER = table<AnimalHunger>("living.animal_hunger");

/** La hembra que parió (livestock-yield-milk): desde cuándo da de mamar; sin fila, no. */
export interface Lactating {
  readonly since: Tick;
  /** Las crías de ese parto (livestock-milk-suckle, con `suckle`): las que maman. */
  readonly young?: readonly AnimalId[];
  /** Días seguidos que dio sin que nadie la ordeñara (livestock-milk-work); sin esto, 0. */
  readonly missed?: number;
}

export const LACTATING = table<Lactating>("living.lactating");

/** El animal esquilado (livestock-milk-culture-sheep-shear): cuándo fue la última esquila. */
export interface Shorn {
  readonly at: Tick;
}

export const SHORN = table<Shorn>("living.shorn");

/**
 * Pura (livestock-milk-culture-sheep-shear): qué parte del vellón de un año tiene el animal
 * esquilado hace `days` días: crece parejo hasta el año.
 */
export function fleeceShare(days: number): number {
  return Math.min(1, Math.max(0, days / 365));
}

/** Lo que pastó el ganado de la aldea el último día (livestock-feed-pasture), en la entidad de la ecología. */
export interface Grazed {
  /** Kg de planta por día que el ganado sacó de la celda. */
  readonly kgPerDay: number;
}
export const GRAZED = table<Grazed>("living.grazed");

/** Parte de la producción de la celda que crece al alcance del ganado de la aldea (sin calibrar). */
export const LIVESTOCK_PASTURE_SHARE = 0.02;

/**
 * Pura: qué parte (0-1) de lo que piden los que pastan cubre el pasto: `availableKg / demandKg`
 * hasta 1; sin demanda, 0.
 */
export function pastureCover(availableKg: number, demandKg: number): number {
  if (demandKg <= 0 || availableKg <= 0) return 0;
  return Math.min(1, availableKg / demandKg);
}

export interface SeedLivestockInput {
  readonly seed: number;
  readonly settlement: SettlementId;
  readonly species: readonly LivestockDef[];
  /** Cuántos viven en cada hogar (los que no están no tienen casa que poblar). */
  readonly members: ReadonlyMap<string, number>;
  /** Duración del año (ticks), para la edad de los que llegan. */
  readonly yearTicks: number;
  /**
   * El comienzo de la vida: los animales que hay entonces en cada casa (los descendientes de los que
   * llegaron con ella), con la edad contada desde acá. Sin esto (motores anteriores a `life-56`),
   * la edad se cuenta desde que se levantó la casa y en una casa vieja mueren de viejos al empezar.
   */
  readonly now?: Tick;
  /** Motores anteriores a `life-57`: ignora `herdAgeYears` (todos entre 0 y 0,6 de su vida). */
  readonly legacyHerdAges?: boolean;
  /**
   * Opt-in (livestock-milk-culture-terrain): la parte quebrada (0-1) de la tierra de alrededor;
   * con esto, cada casa tira por cada especie con `keeps` si la tiene (`keepChance`).
   */
  readonly roughShare?: number;
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
    const rough = input.roughShare;
    const kept = species.filter(
      (s) =>
        (s.minMembers ?? 1) <= members &&
        (rough === undefined ||
          s.keeps === undefined ||
          root.fork("living", "herd", household, s.id).stream().float() < keepChance(s, rough)),
    );
    if (kept.length === 0) continue;
    const at: Tick = input.now ?? truth.get(ENTITY, id)?.createdAt ?? 0;
    const event: EventId = ids.next("event");
    log.append({
      id: event,
      tick: at,
      kind: "settlement.livestock_brought",
      data: { building: id, household, species: kept.map((s) => s.id) },
      causes: [
        { kind: "event", event: b.builtBy },
        ...(rough !== undefined && kept.some((s) => s.keeps !== undefined)
          ? [{ kind: "state" as const, entity: input.settlement, key: "land" }]
          : []),
      ],
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
        // Llegan jóvenes o adultos: hasta las tres quintas partes de su vida, o en las edades de su
        // función (`herdAgeYears`); la misma tirada en los dos casos.
        const [lo, hi] =
          s.herdAgeYears !== undefined && input.legacyHerdAges !== true
            ? s.herdAgeYears
            : [0, 0.6 * s.lifespanYears];
        const age = Math.floor((lo + r.float() * Math.max(0, hi - lo)) * input.yearTicks);
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

/** Cuánto multiplica el hambre plena la mortalidad de fondo y de vejez (flaqueza; sin calibrar). */
export const LIVESTOCK_HUNGER_FRAILTY = 4;

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
  /** Opt-in (livestock-yield-milk): la que pare queda en `LACTATING` si su especie da leche. */
  readonly lactation?: boolean;
  /** Opt-in (livestock-milk-suckle, con `lactation`): `LACTATING` guarda las crías del parto. */
  readonly suckle?: boolean;
  /**
   * Opt-in (livestock-milk-foster, con `suckle`): la cría huérfana en sus días de mamar puede ser
   * adoptada por otra madre de su especie y su casa que todavía amamanta (`suckle.fosterPerDay`,
   * menos cuantas más crías ya tiene); pasa a su `LACTATING.young` (evento `living.animal_fostered`).
   */
  readonly foster?: boolean;
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
    reads: [
      ANIMAL.name,
      ENTITY.name,
      BUILDING.name,
      LOCATION.name,
      ANIMAL_HUNGER.name,
      ...(o.lactation === true ? [LACTATING.name] : []),
    ],
    writes: [
      ANIMAL.name,
      ENTITY.name,
      LOCATION.name,
      ANIMAL_HUNGER.name,
      ...(o.lactation === true ? [LACTATING.name] : []),
    ],
    scopeGuard: (truth) => truth.ids(ANIMAL).length > 0,
    run(ctx) {
      const step = ctx.window > 0 ? ctx.window : 1;
      const hunger = (id: AnimalId) => ctx.truth.get(ANIMAL_HUNGER, id)?.level ?? 0;
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
      const mothersToday = new Set<AnimalId>();
      // Primero las muertes: quien muere hoy no pare ni cubre.
      for (const [id, a] of alive) {
        const def = byId.get(a.species);
        if (!def) continue;
        // Muere de hambre al llegar a 1; antes, el hambre lo hace más frágil.
        const h = hunger(id);
        const r = ctx.rng.fork("death", id).stream();
        const yearly = yearlyMortality(ageYears(a), def.lifespanYears);
        const starved = h >= 1;
        const frail = Math.min(1, yearly * (1 + LIVESTOCK_HUNGER_FRAILTY * h));
        if (!starved && r.float() >= stepChance(frail, step, o.year)) continue;
        const base = ctx.truth.get(ENTITY, id);
        if (!base) continue;
        const end = draftEvent(events.length);
        const cause = starved ? "hunger" : "age";
        events.push({
          kind: "living.animal_died",
          actors: [],
          place: { kind: "building", building: a.home },
          data: { animal: id, species: a.species, owner: a.owner, cause },
          causes: [
            { kind: "state", entity: id, key: cause },
            ...(h > 0 && !starved ? [{ kind: "state" as const, entity: id, key: "hunger" }] : []),
          ],
          emissions: null,
        });
        changes.push(endEntity(base, end, ctx.now), deleteComponent(LOCATION, id));
        if (ctx.truth.get(ANIMAL_HUNGER, id)) changes.push(deleteComponent(ANIMAL_HUNGER, id));
        if (o.lactation === true && ctx.truth.get(LACTATING, id)) {
          changes.push(deleteComponent(LACTATING, id));
        }
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
        // Una hembra con más de media hambre no queda preñada.
        if (hunger(id) > 0.5) continue;
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
        if (o.lactation === true && def?.yields?.some((y) => y.lactationDays !== undefined)) {
          changes.push(
            setComponent(LACTATING, id, {
              since: ctx.now,
              ...(o.suckle === true ? { young } : {}),
            }),
          );
        }
        count.set(key, (count.get(key) ?? 0) + size);
        mothersToday.add(id);
      }
      if (o.foster === true && o.suckle === true) {
        fosterOrphans(ctx, o.year, byId, alive, dead, mothersToday, events, changes);
      }
      if (events.length === 0) return {};
      return postings.length > 0 ? { events, changes, postings } : { events, changes };
    },
  };
}

/**
 * Las huérfanas (livestock-milk-foster): cada cría viva en sus días de mamar que ninguna madre viva
 * amamanta prueba, por id, con cada madre de su especie y su casa que amamanta dentro de sus días
 * (no la que murió o parió hoy); la acepta con `fosterPerDay / (1 + crías vivas que ya tiene)`.
 * Una madre adopta a lo sumo una por día.
 */
function fosterOrphans(
  ctx: { readonly truth: ReadonlyWorldTruth; readonly now: Tick; readonly rng: Rng },
  year: Duration,
  byId: ReadonlyMap<string, LivestockDef>,
  alive: readonly (readonly [AnimalId, AnimalRecord])[],
  dead: ReadonlySet<AnimalId>,
  mothersToday: ReadonlySet<AnimalId>,
  events: EventDraft[],
  changes: StateChange[],
): void {
  const suckleOf = (species: string) => byId.get(species)?.yields?.find((y) => y.suckle)?.suckle;
  const nursed = nursedYoung(ctx.truth, ctx.now, year, byId);
  for (const id of dead) {
    for (const k of ctx.truth.get(LACTATING, id)?.young ?? []) nursed.delete(k);
  }
  const mothers: { id: AnimalId; a: AnimalRecord; l: Lactating; young: AnimalId[] }[] = [];
  for (const [id, a] of alive) {
    const l = ctx.truth.get(LACTATING, id);
    const s = suckleOf(a.species);
    if (!l?.young || !s || dead.has(id) || mothersToday.has(id)) continue;
    if (((ctx.now - l.since) * 365) / year > s.days) continue;
    mothers.push({ id, a, l, young: [...l.young] });
  }
  if (mothers.length === 0) return;
  const living = new Set(alive.filter(([id]) => !dead.has(id)).map(([id]) => id));
  const adopted = new Set<AnimalId>();
  for (const [id, a] of alive) {
    const s = suckleOf(a.species);
    if (dead.has(id) || nursed.has(id) || !s?.fosterPerDay) continue;
    if (((ctx.now - a.bornAt) * 365) / year >= s.days) continue;
    for (const m of mothers) {
      if (adopted.has(m.id) || m.a.species !== a.species || m.a.owner !== a.owner) continue;
      const own = m.young.filter((k) => living.has(k)).length;
      const r = ctx.rng.fork("foster", id, m.id).stream();
      if (r.float() >= s.fosterPerDay / (1 + own)) continue;
      adopted.add(m.id);
      m.young.push(id);
      events.push({
        kind: "living.animal_fostered",
        actors: [],
        place: { kind: "building", building: m.a.home },
        data: { mother: m.id, young: id, species: a.species, owner: a.owner },
        causes: [
          { kind: "state", entity: id, key: "orphan" },
          { kind: "state", entity: m.id, key: "lactating" },
        ],
        emissions: null,
      });
      changes.push(setComponent(LACTATING, m.id, { ...m.l, young: m.young }));
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Comer de la casa (livestock-feed)

export const LIVESTOCK_FEED_PROCESS = "living.livestock_feed";
/** Adonde va lo que come el ganado de la casa (sale del ledger con el animal que lo comió). */
export const FED_SINK = "fed";

/** Pura: la ración de `step` ticks (día de `day` ticks): menos en las crías, como su cuerpo. */
export function feedRation(
  def: LivestockDef,
  ageYears: number,
  step: Duration,
  day: Duration,
): number {
  const f = def.feed;
  if (!f) return 0;
  return Math.round((f.gramsPerDay * grownShare(def, ageYears) * step) / day);
}

/** Pura: qué parte de un adulto come a su edad: lineal hasta la madurez desde un décimo. */
export function grownShare(def: LivestockDef, ageYears: number): number {
  return Math.min(1, Math.max(0.1, ageYears / (def.breeding?.maturityYears ?? 1)));
}

/**
 * Pura: el hambre tras `step` ticks comiendo la parte `fed` (0 a 1) de la ración: sube lo que falta
 * y baja lo que come, a razón de `starveDays` días de punta a punta; entre 0 y 1.
 */
export function nextHunger(
  level: number,
  fed: number,
  step: Duration,
  day: Duration,
  starveDays: number,
): number {
  const rate = step / day / starveDays;
  return Math.min(1, Math.max(0, level + (1 - fed) * rate - fed * rate));
}

export interface LivestockFeedOptions {
  readonly species: readonly LivestockDef[];
  /** Las comidas que puede haber en la casa, con su categoría (de `content/foods`). */
  readonly foods: readonly { readonly id: string; readonly category: string }[];
  /** Duración del año (ticks), para la edad. */
  readonly year: Duration;
  /** Duración del día (ticks), para la ración. */
  readonly day: Duration;
  /**
   * Opt-in (livestock-draft-cost): si `t` es un día de campo. Ese día el animal de tiro en edad
   * de tirar come `draft.workFeedFactor` veces su ración y su comida queda causada por el tiro.
   */
  readonly working?: (t: Tick) => boolean;
  /** Opt-in (livestock-feed-pasture): la parte de la producción de la celda al alcance del ganado. */
  readonly pasture?: { readonly share: number };
  /**
   * Opt-in (livestock-milk-orphan, con `LACTATING.young`): la cría en sus días de mamar no come de
   * la casa si su madre vive y la amamanta; huérfana, toma la leche de la casa (`suckle` de su
   * especie) y de lo sólido solo puede comer `ORPHAN_SOLID_SHARE` de su ración.
   */
  readonly orphan?: boolean;
}

/** Qué parte de su ración puede comer de lo sólido la cría huérfana en sus días de mamar. */
export const ORPHAN_SOLID_SHARE = 0.3;

/**
 * Pura (livestock-milk-orphan): las crías que maman hoy: las de `LACTATING.young` de cada madre viva
 * dentro de los `suckle.days` de su especie desde el parto.
 */
export function nursedYoung(
  truth: ReadonlyWorldTruth,
  now: Tick,
  year: Duration,
  byId: ReadonlyMap<string, LivestockDef>,
): Set<AnimalId> {
  const out = new Set<AnimalId>();
  for (const id of [...truth.ids(LACTATING)].sort() as AnimalId[]) {
    const l = truth.get(LACTATING, id);
    const a = truth.get(ANIMAL, id);
    if (!l?.young || !a || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const days = byId.get(a.species)?.yields?.find((y) => y.suckle)?.suckle?.days;
    if (days === undefined || ((now - l.since) * 365) / year > days) continue;
    for (const k of l.young) out.add(k);
  }
  return out;
}

/**
 * Cada día: cada animal vivo que come de la casa saca su ración de la cuenta del hogar dueño
 * (comidas de las categorías que acepta, en su orden; dentro de una categoría, por id) al
 * sumidero `FED_SINK`, en un evento `living.animal_fed` por hogar causado por el hambre de los que
 * comieron. Lo que no encuentra sube su hambre (`ANIMAL_HUNGER`). Los animales se sirven por id.
 */
export function livestockFeedProcess(o: LivestockFeedOptions): ProcessDef {
  const byId = new Map(o.species.map((s) => [s.id, s]));
  const byCategory = new Map<string, string[]>();
  for (const f of [...o.foods].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    byCategory.set(f.category, [...(byCategory.get(f.category) ?? []), f.id]);
  }
  return {
    id: LIVESTOCK_FEED_PROCESS,
    system: "living",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      ANIMAL.name,
      ENTITY.name,
      ANIMAL_HUNGER.name,
      ...(o.pasture ? [ECOLOGY.name] : []),
      ...(o.orphan === true ? [LACTATING.name] : []),
    ],
    writes: [ANIMAL_HUNGER.name, ...(o.pasture ? [GRAZED.name] : [])],
    scopeGuard: (truth) => truth.ids(ANIMAL).length > 0,
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const step = ctx.window > 0 ? ctx.window : 1;
      // El pasto: cuánto piden hoy los que pastan y qué parte cubre lo que crece a su alcance.
      const [ecoId] = o.pasture ? ctx.truth.ids(ECOLOGY) : [];
      const eco = ecoId === undefined ? undefined : ctx.truth.get(ECOLOGY, ecoId);
      let demandKg = 0;
      if (o.pasture && eco) {
        for (const id of [...ctx.truth.ids(ANIMAL)].sort() as AnimalId[]) {
          const a = ctx.truth.get(ANIMAL, id);
          const g = a ? byId.get(a.species)?.feed?.graze : undefined;
          if (!a || !g || ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
          const def = byId.get(a.species);
          if (!def) continue;
          demandKg += g.kgPerDay * grownShare(def, (ctx.now - a.bornAt) / o.year);
        }
      }
      const cover =
        o.pasture && eco ? pastureCover(eco.cell.productivity * o.pasture.share, demandKg) : 0;
      // Lo que queda hoy en cada hogar por bien (lo que se comió un animal no lo come el siguiente).
      const left = new Map<string, number>();
      const meal = new Map<
        string,
        { home: BuildingId; eaters: AnimalId[]; grams: Map<string, number> }
      >();
      const changes: StateChange[] = [];
      const working = o.working?.(ctx.now) === true;
      const pulling = new Set<AnimalId>();
      const grazers = new Set<AnimalId>();
      const nursed =
        o.orphan === true ? nursedYoung(ctx.truth, ctx.now, o.year, byId) : new Set<AnimalId>();
      // Saca hasta `max` gramos de `food` de la casa del animal; devuelve lo que sacó.
      const take = (a: AnimalRecord, id: AnimalId, food: string, max: number): number => {
        const key = `${a.owner}|${food}`;
        const have =
          left.get(key) ??
          Math.floor(ledger.balance(holderAccount(a.owner), ledgerUnit(`good:${food}`)));
        const got = Math.min(have, max);
        left.set(key, have - got);
        if (got <= 0) return 0;
        const m = meal.get(a.owner) ?? {
          home: a.home,
          eaters: [] as AnimalId[],
          grams: new Map(),
        };
        if (m.eaters.at(-1) !== id) m.eaters.push(id);
        m.grams.set(food, (m.grams.get(food) ?? 0) + got);
        meal.set(a.owner, m);
        return got;
      };
      for (const id of [...ctx.truth.ids(ANIMAL)].sort() as AnimalId[]) {
        const a = ctx.truth.get(ANIMAL, id);
        if (!a || ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const def = byId.get(a.species);
        const f = def?.feed;
        if (!def || !f) continue;
        const ageYears = (ctx.now - a.bornAt) / o.year;
        const pulls =
          working &&
          def.draft !== undefined &&
          def.draft.workFeedFactor > 1 &&
          ageYears >= def.draft.minAgeYears;
        const base = feedRation(def, ageYears, step, o.day);
        const full = pulls ? Math.round(base * (def.draft?.workFeedFactor ?? 1)) : base;
        if (full <= 0) continue;
        if (pulls) pulling.add(id);
        // La cría en sus días de mamar: con madre, la leche la cubre; huérfana, poco sólido.
        const milk =
          o.orphan === true ? def.yields?.find((y) => y.suckle !== undefined) : undefined;
        const suckling =
          milk?.suckle !== undefined && ageYears * 365 < milk.suckle.days ? milk : undefined;
        let need = full;
        if (suckling && nursed.has(id)) {
          need = 0;
        } else {
          let solid = suckling ? Math.round(full * ORPHAN_SOLID_SHARE) : full;
          if (suckling) need -= take(a, id, suckling.good, need);
          // Lo que cubre el pasto no sale de la casa.
          const grazed = f.graze ? Math.min(solid, Math.round(full * f.graze.share * cover)) : 0;
          if (grazed > 0) grazers.add(id);
          need -= Math.min(need, grazed);
          solid -= grazed;
          for (const cat of f.categories) {
            for (const food of byCategory.get(cat) ?? []) {
              const max = Math.min(need, solid);
              if (max <= 0) break;
              const got = take(a, id, food, max);
              need -= got;
              solid -= got;
            }
          }
        }
        const before = ctx.truth.get(ANIMAL_HUNGER, id)?.level ?? 0;
        const after = nextHunger(before, (full - need) / full, step, o.day, f.starveDays);
        if (after === before) continue;
        changes.push(
          after > 0
            ? setComponent(ANIMAL_HUNGER, id, { level: after })
            : deleteComponent(ANIMAL_HUNGER, id),
        );
      }
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      for (const owner of [...meal.keys()].sort()) {
        const m = meal.get(owner);
        if (!m) continue;
        const event = draftEvent(events.length);
        const foods = [...m.grams.keys()].sort();
        events.push({
          kind: "living.animal_fed",
          actors: [],
          place: { kind: "building", building: m.home },
          data: {
            owner,
            eaters: m.eaters,
            grams: Object.fromEntries(foods.map((g) => [g, m.grams.get(g) ?? 0])),
          },
          causes: [
            ...m.eaters.flatMap((id) => [
              { kind: "state" as const, entity: id, key: "hunger" },
              ...(pulling.has(id) ? [{ kind: "state" as const, entity: id, key: "draft" }] : []),
            ]),
            // Lo que puso la casa depende de cuánto pasto hubo.
            ...(ecoId !== undefined && m.eaters.some((id) => grazers.has(id))
              ? [{ kind: "state" as const, entity: ecoId as never, key: "pasture" }]
              : []),
          ],
          emissions: null,
        });
        postings.push({
          event,
          transfers: foods.map((g) => ({
            unit: ledgerUnit(`good:${g}`),
            from: holderAccount(owner as HouseholdId),
            to: externalAccount(FED_SINK),
            amount: m.grams.get(g) ?? 0,
          })),
        });
      }
      if (o.pasture && ecoId !== undefined) {
        const kgPerDay = demandKg * cover;
        const prev = ctx.truth.get(GRAZED, ecoId)?.kgPerDay;
        if (prev !== kgPerDay) changes.push(setComponent(GRAZED, ecoId, { kgPerDay }));
      }
      if (events.length === 0 && changes.length === 0) return {};
      return { events, changes, postings };
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

/**
 * Pura: qué parte de lo suyo da con `hours` horas de luz: todo desde el máximo de `daylightHours`,
 * el piso bajo el mínimo y lineal entre los dos; sin `daylightHours` o sin horas, todo.
 */
export function daylightFactor(y: YieldDef, hours: number | undefined): number {
  if (y.daylightHours === undefined || hours === undefined) return 1;
  const [lo, hi] = y.daylightHours;
  const x = hi > lo ? Math.min(1, Math.max(0, (hours - lo) / (hi - lo))) : hours >= hi ? 1 : 0;
  return y.daylightFloor + (1 - y.daylightFloor) * x;
}

/**
 * Pura: qué parte de lo suyo da con una media de `tempC` °C: todo desde el máximo de `coldC`, el
 * piso bajo el mínimo y lineal entre los dos; sin `coldC` o sin temperatura, todo.
 */
export function coldFactor(y: YieldDef, tempC: number | undefined): number {
  if (y.coldC === undefined || tempC === undefined) return 1;
  const [lo, hi] = y.coldC;
  const x = hi > lo ? Math.min(1, Math.max(0, (tempC - lo) / (hi - lo))) : tempC >= hi ? 1 : 0;
  return y.coldFloor + (1 - y.coldFloor) * x;
}

/**
 * Pura (livestock-milk-curve): cuánto pesa lo que da `day` días después de parir respecto de la
 * media de la temporada (`lactationCurve` sobre `lactationDays`). Sin curva, 1.
 */
export function lactationFactor(y: YieldDef, day: number): number {
  const c = y.lactationCurve;
  if (c === undefined || y.lactationDays === undefined) return 1;
  const wood = (t: number) => pow(t, c.shape) * exp((-c.shape * t) / c.peakDay);
  let sum = 0;
  for (let t = 1; t <= y.lactationDays; t++) sum += wood(t);
  const mean = sum / y.lactationDays;
  return mean > 0 ? wood(Math.max(1, day)) / mean : 1;
}

/** Pura: qué parte de lo suyo da con hambre `level` (0-1): baja lineal hasta 0 en `hungerStop`. */
export function hungerFactor(y: YieldDef, level: number): number {
  if (y.hungerStop === undefined || level <= 0) return 1;
  return Math.max(0, 1 - level / y.hungerStop);
}

export interface LivestockYieldOptions {
  readonly species: readonly LivestockDef[];
  /** Duración del año (ticks). */
  readonly year: Duration;
  /** Horas de luz del día en la aldea (livestock-yield-season); sin esto, la luz no importa. */
  readonly daylightHours?: (t: Tick) => number;
  /** Temperatura media del día en la aldea, °C (livestock-yield-feed); sin esto, el frío no importa. */
  readonly tempC?: (t: Tick) => number;
  /** Lee el hambre de cada animal (`ANIMAL_HUNGER`, livestock-yield-feed); sin esto, no la frena. */
  readonly hunger?: boolean;
  /** Lee `LACTATING` (livestock-yield-milk); sin esto, lo que pide parir no se da. */
  readonly lactation?: boolean;
  /** Opt-in (livestock-milk-curve, con `lactation`): lo que da pesa según `lactationFactor`. */
  readonly milkCurve?: boolean;
  /** Opt-in (livestock-milk-suckle, con `lactation`): las crías vivas se toman su parte (`sucklingShare`). */
  readonly suckle?: boolean;
  /**
   * Opt-in (livestock-milk-work, con `lactation`): lo que pide ordeñe (`YieldDef.milking`) llega a
   * la casa solo si alguien del hogar vivo y de `minAgeYears` o más tiene tiempo en sus
   * `MILKING_HOURS` de la mañana; si no, se pierde y cuenta para secarla.
   */
  readonly milking?: {
    readonly minAgeYears: number;
    /**
     * Opt-in (livestock-milk-hours): si la persona puede ordeñar hoy (en casa, el cuerpo le da);
     * sin esto, cuenta todo el que tiene la edad.
     */
    readonly can?: (truth: ReadonlyWorldTruth, id: AgentId) => boolean;
    /** Las tablas que lee `can`. */
    readonly reads?: readonly string[];
  };
  /**
   * Opt-in (livestock-milk-culture-sheep-shear): lo que tiene `YieldDef.shear` se esquila en su
   * temporada con la temperatura media del día en la aldea (°C), no un día al azar.
   */
  readonly shear?: { readonly tempC: (t: Tick) => number };
}

/** Horas de la mañana que cada uno del hogar puede dar al ordeñe. */
export const MILKING_HOURS = 1;

/**
 * Pura (livestock-milk-suckle): qué parte de lo que da la madre se toman sus `alive` crías vivas
 * `day` días después de parir: `sharePerYoung` cada una hasta todo, solo los primeros `suckle.days`.
 */
export function sucklingShare(y: YieldDef, day: number, alive: number): number {
  const s = y.suckle;
  if (s === undefined || alive <= 0 || day >= s.days) return 0;
  return Math.min(1, alive * s.sharePerYoung);
}

/**
 * Cada día: cada animal vivo que da algo (la gallina adulta, huevos) tiene una chance de dar una
 * unidad (`perYear` repartido en el año); lo de cada hogar y bien entra junto, en un evento
 * `living.animal_yield` causado por los animales que dieron, a la cuenta del hogar dueño.
 */
export function livestockYieldProcess(o: LivestockYieldOptions): ProcessDef {
  const byId = new Map(o.species.map((s) => [s.id, s]));
  // La curva por especie y bien, con los días de la temporada ya sumados una vez.
  const curves = new Map<YieldDef, number[]>();
  const curveAt = (y: YieldDef, day: number): number => {
    let c = curves.get(y);
    if (c === undefined) {
      c = Array.from({ length: (y.lactationDays ?? 0) + 1 }, (_, t) => lactationFactor(y, t));
      curves.set(y, c);
    }
    return c[Math.min(c.length - 1, Math.max(0, day))] ?? 1;
  };
  return {
    id: LIVESTOCK_YIELD_PROCESS,
    system: "living",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      ANIMAL.name,
      ENTITY.name,
      ...(o.hunger === true ? [ANIMAL_HUNGER.name] : []),
      ...(o.lactation === true ? [LACTATING.name] : []),
      ...(o.milking ? [PERSON.name, ...(o.milking.reads ?? [])] : []),
      ...(o.shear ? [SHORN.name] : []),
    ],
    writes: [
      ...(o.milking && o.lactation === true ? [LACTATING.name] : []),
      ...(o.shear ? [SHORN.name] : []),
    ],
    scopeGuard: (truth) => truth.ids(ANIMAL).length > 0,
    run(ctx) {
      const step = ctx.window > 0 ? ctx.window : 1;
      const changes: StateChange[] = [];
      // El ordeñe: quiénes de cada hogar pueden ordeñar y los minutos que les quedan hoy.
      const milkers = new Map<string, AgentId[]>();
      const minutes = new Map<string, number>();
      if (o.milking && o.lactation === true) {
        for (const p of [...ctx.truth.ids(PERSON)].sort() as AgentId[]) {
          const r = ctx.truth.get(PERSON, p);
          if (!r || ctx.truth.get(ENTITY, p)?.endedAt !== undefined) continue;
          if ((ctx.now - r.born) / o.year < o.milking.minAgeYears) continue;
          if (o.milking.can && !o.milking.can(ctx.truth, p)) continue;
          milkers.set(r.household, [...(milkers.get(r.household) ?? []), p]);
        }
        for (const [h, ps] of milkers) minutes.set(h, ps.length * MILKING_HOURS * 60);
      }
      const hours = o.daylightHours?.(ctx.now);
      const tempC = o.tempC?.(ctx.now);
      const warm = o.shear?.tempC(ctx.now);
      // hogar|bien -> animales que dieron hoy y gramos.
      const got = new Map<
        string,
        {
          owner: HouseholdId;
          home: BuildingId;
          good: string;
          from: AnimalId[];
          grams: number;
          suckled: number;
          lost: number;
          unmilked: AnimalId[];
          milkedMinutes: number;
        }
      >();
      for (const id of [...ctx.truth.ids(ANIMAL)].sort() as AnimalId[]) {
        const a = ctx.truth.get(ANIMAL, id);
        if (!a || ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const yields = byId.get(a.species)?.yields ?? [];
        const age = (ctx.now - a.bornAt) / o.year;
        const hunger = o.hunger === true ? (ctx.truth.get(ANIMAL_HUNGER, id)?.level ?? 0) : 0;
        yields.forEach((y, i) => {
          if ((y.sex !== undefined && y.sex !== a.sex) || age < y.minAgeYears) return;
          let weight = 1;
          let suckled = 0;
          let lact: Lactating | undefined;
          if (y.lactationDays !== undefined) {
            lact = o.lactation === true ? ctx.truth.get(LACTATING, id) : undefined;
            const since = lact?.since;
            if (since === undefined || ctx.now - since > (y.lactationDays * o.year) / 365) return;
            const day = Math.floor(((ctx.now - since) * 365) / o.year);
            if (o.milkCurve === true && y.lactationCurve !== undefined) weight = curveAt(y, day);
            if (o.suckle === true && lact?.young !== undefined) {
              const alive = lact.young.filter(
                (k) => ctx.truth.get(ENTITY, k)?.endedAt === undefined,
              ).length;
              suckled = sucklingShare(y, day, alive);
            }
          }
          if (y.shear !== undefined && warm !== undefined) {
            // La esquila: el primer día templado pasado el intervalo, con la lana que creció.
            if (warm < y.shear.warmC) return;
            const days = ((ctx.now - (ctx.truth.get(SHORN, id)?.at ?? a.bornAt)) * 365) / o.year;
            if (days < y.shear.intervalDays) return;
            // Con hambre el vellón sale ralo.
            weight = fleeceShare(days) * hungerFactor(y, hunger);
            changes.push(setComponent(SHORN, id, { at: ctx.now }));
          } else {
            const factor =
              daylightFactor(y, hours) * coldFactor(y, tempC) * hungerFactor(y, hunger);
            const chance = Math.min(1, (y.perYear * factor * step) / o.year);
            if (ctx.rng.fork("yield", id, i).float() >= chance) return;
          }
          const key = `${a.owner}|${y.good}`;
          const g = got.get(key) ?? {
            owner: a.owner,
            home: a.home,
            good: y.good,
            from: [],
            grams: 0,
            suckled: 0,
            lost: 0,
            unmilked: [],
            milkedMinutes: 0,
          };
          g.from.push(id);
          const all = Math.round(y.unitGrams * weight);
          const kept = Math.round(all * (1 - suckled));
          g.suckled += all - kept;
          got.set(key, g);
          const m = o.milking && lact ? y.milking : undefined;
          if (m && lact) {
            // Lo que mama la cría no pide ordeñe; lo de la casa sí.
            const cost = 60 / m.headPerHour;
            const left = minutes.get(a.owner) ?? 0;
            if (kept > 0 && left >= cost) {
              minutes.set(a.owner, left - cost);
              g.milkedMinutes += cost;
              if ((lact.missed ?? 0) > 0) {
                const { missed: _, ...rest } = lact;
                changes.push(setComponent(LACTATING, id, rest));
              }
            } else if (kept > 0) {
              g.lost += kept;
              g.unmilked.push(id);
              const missed = (lact.missed ?? 0) + 1;
              changes.push(
                missed >= m.dryAfterDays
                  ? deleteComponent(LACTATING, id)
                  : setComponent(LACTATING, id, { ...lact, missed }),
              );
              return;
            }
          }
          g.grams += kept;
        });
      }
      if (got.size === 0) return changes.length > 0 ? { changes } : {};
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      for (const key of [...got.keys()].sort()) {
        const g = got.get(key);
        if (!g) continue;
        const event = draftEvent(events.length);
        // Los que ordeñaron: los primeros del hogar, una hora cada uno.
        const milkedBy = (milkers.get(g.owner) ?? []).slice(
          0,
          Math.ceil(g.milkedMinutes / (MILKING_HOURS * 60) - 1e-9),
        );
        events.push({
          kind: "living.animal_yield",
          actors: milkedBy,
          place: { kind: "building", building: g.home },
          data: {
            owner: g.owner,
            good: g.good,
            grams: g.grams,
            from: g.from,
            ...(g.suckled > 0 ? { suckled: g.suckled } : {}),
            ...(milkedBy.length > 0 ? { milkedBy } : {}),
            ...(g.unmilked.length > 0 ? { unmilked: g.unmilked, lost: g.lost } : {}),
          },
          causes: g.from.map((id) => ({ kind: "state" as const, entity: id, key: "yield" })),
          emissions: null,
        });
        // Todo lo mamó la cría: hay evento (la madre dio) pero nada entra a la casa.
        if (g.grams <= 0) continue;
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
      return {
        events,
        ...(postings.length > 0 ? { postings } : {}),
        ...(changes.length > 0 ? { changes } : {}),
      };
    },
  };
}
