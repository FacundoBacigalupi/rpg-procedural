// Carnear un animal de la casa (livestock-slaughter): el jugador nombra la especie («carneo la
// cabra») y se elige, en orden canónico, uno vivo de su hogar que esté en su mismo hex. Lo que deja
// el cuerpo (`carcassYield`) entra a la despensa del hogar desde `CARCASS_SOURCE`, como cuando
// muere de viejo; el animal termina. Solo los de su casa: tomar el ajeno es robo (livestock-tenure).
// Regalarlo (livestock-tenure-gift): «le doy la gallina a Lin» elige igual el animal (la especie
// tiene que estar nombrada) y, si sale bien, pasa a ser del hogar del otro y de su casa. Robarlo
// (livestock-tenure-theft): «tomo la gallina» con una ajena al lado se la lleva a su casa, y
// `deeds.ts` lo cuenta como robo al hogar dueño. Venderlo o comprarlo (livestock-tenure-sell):
// «le vendo la cabra a Lin» o «le compro la oveja a Lin» con `trade` elige igual el animal (de su
// casa o de la del otro), con un precio que sale de lo que deja su cuerpo y un recargo por vivo.

import {
  type AgentId,
  type AnimalId,
  type BuildingId,
  compareStrings,
  type Duration,
  type EventId,
  externalAccount,
  type HolderRef,
  type HouseholdId,
  type LedgerUnit,
  ledgerUnit,
  type Tick,
} from "../../core/index.ts";
import {
  ANIMAL,
  ANIMAL_HUNGER,
  BUILDING,
  CARCASS_SOURCE,
  carcassYield,
  DRAFT_FATIGUE,
  deleteComponent,
  ENTITY,
  endEntity,
  type GoodDef,
  LACTATING,
  type LivestockDef,
  LOCATION,
  PERSON,
  type ReadonlyWorldTruth,
  type ResolveInput,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";
import { type AnimalMark, animalMarksOf } from "./animal-marks.ts";

export interface SlaughterOptions {
  readonly species: readonly LivestockDef[];
  /** Duración del año (ticks). */
  readonly year: Duration;
  /**
   * Opt-in (livestock-slaughter-refs): las palabras que dicen algo del animal («la vieja», «el
   * cabrito», «la flaca», «la que da de mamar», «el macho») eligen uno al que se le note eso
   * (`animalMarksOf`, sexo); si ninguno encaja, no hay a cuál. Sin esto, solo la especie.
   */
  readonly refs?: boolean;
  /** Opt-in (livestock-tenure-gift): «dar» un animal de la casa lo pasa al hogar de quien lo recibe. */
  readonly gift?: boolean;
  /** Opt-in (livestock-tenure-theft): «tomar» el animal ajeno que tiene al lado se lo lleva a su casa. */
  readonly steal?: boolean;
  /** Opt-in (livestock-tenure-sell): `trade` nombrando un animal lo vende o lo compra por cobre. */
  readonly sell?: boolean;
  /** Opt-in (livestock-tenure-sell-household, con `sell`): el cobre lo junta toda la casa del que compra (`householdPayers`). */
  readonly sellHousehold?: boolean;
  /** Opt-in (livestock-tenure-sell-barter, con `sellHousehold`): lo que falta de cobre la casa lo pone en bienes (`householdBarter`). */
  readonly sellBarter?: boolean;
}

/** Palabras que dicen algo de un animal en particular (livestock-slaughter-refs). */
const QUALIFIERS: Readonly<Record<string, AnimalMark | "male" | "female">> = {
  cria: "young",
  crias: "young",
  cabrito: "young",
  cabritos: "young",
  pollito: "young",
  pollitos: "young",
  cachorro: "young",
  ternero: "young",
  joven: "young",
  chico: "young",
  chica: "young",
  viejo: "old",
  vieja: "old",
  viejos: "old",
  viejas: "old",
  flaco: "thin",
  flaca: "thin",
  consumido: "starving",
  consumida: "starving",
  parida: "nursing",
  lechera: "nursing",
  mamar: "nursing",
  amamanta: "nursing",
  macho: "male",
  gallo: "male",
  hembra: "female",
  perra: "female",
};

/** Pura: si al animal se le nota `q` (el consumido también está flaco). */
function fits(q: AnimalMark | "male" | "female", sex: string, marks: readonly AnimalMark[]) {
  if (q === "male" || q === "female") return sex === q;
  if (q === "thin") return marks.includes("thin") || marks.includes("starving");
  return marks.includes(q);
}

/** Las tablas que lee `slaughterTargetOf` (para declararlas en el proceso). */
export const SLAUGHTER_READS = [
  ANIMAL.name,
  ENTITY.name,
  PERSON.name,
  LOCATION.name,
  ANIMAL_HUNGER.name,
  LACTATING.name,
  DRAFT_FATIGUE.name,
] as const;

/** Las tablas que escribe `slaughterChanges`. */
export const SLAUGHTER_WRITES = [
  ENTITY.name,
  LOCATION.name,
  ANIMAL_HUNGER.name,
  LACTATING.name,
  DRAFT_FATIGUE.name,
] as const;

/** Palabras que no nombran especie: sin otra, sirve cualquier animal de la casa. */
const VAGUE = new Set([
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "mi",
  "mis",
  "nuestro",
  "nuestra",
  "animal",
  "bicho",
]);

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Pura: el animal vivo del hogar de `me`, en su hex, cuya especie nombra `text` (sin texto, el primero
 * que haya; con `mustName`, solo si nombra una especie). Sin uno así, nada.
 */
function animalOf(
  truth: ReadonlyWorldTruth,
  me: string,
  text: string | undefined,
  now: Tick,
  o: SlaughterOptions,
  mustName = false,
  others: boolean | HouseholdId = false,
): { id: AnimalId; def: LivestockDef; bornAt: Tick; household: string } | undefined {
  const household = truth.get(PERSON, me as never)?.household;
  const hex = truth.get(LOCATION, me as never)?.hex;
  if (household === undefined || hex === undefined) return undefined;
  const words = new Set(
    fold(text ?? "")
      .split(/[^a-zñ]+/)
      .filter((w) => w.length > 0),
  );
  const named = (def: LivestockDef) => {
    const name = fold(def.name);
    return words.has(name) || words.has(`${name}s`) || words.has(`${name}es`);
  };
  const byId = new Map(o.species.map((s) => [s.id, s]));
  const anyNamed = o.species.some(named);
  const wanted =
    o.refs === true
      ? [...words].flatMap((w) => {
          const q = QUALIFIERS[w];
          return q === undefined ? [] : [q];
        })
      : [];
  // Nombró algo que no es una especie de la casa («el cerdo»): no hay a cuál.
  const vague = [...words].every((w) => VAGUE.has(w) || (o.refs === true && w in QUALIFIERS));
  if (!anyNamed && (!vague || mustName)) return undefined;
  for (const id of [...truth.ids(ANIMAL)].sort(compareStrings) as AnimalId[]) {
    const a = truth.get(ANIMAL, id);
    if (!a) continue;
    if (typeof others === "string" ? a.owner !== others : (a.owner === household) === others) {
      continue;
    }
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    if (truth.get(LOCATION, id)?.hex !== hex) continue;
    const def = byId.get(a.species);
    if (def === undefined || (anyNamed && !named(def))) continue;
    if (wanted.length > 0) {
      const marks = animalMarksOf(truth, id, a.bornAt, def, now, o.year);
      if (!wanted.every((q) => fits(q, a.sex, marks))) continue;
    }
    return { id, def, bornAt: a.bornAt, household: a.owner };
  }
  return undefined;
}

/**
 * Pura: el animal de su casa que nombra `text` (`animalOf`), con la despensa adonde va y lo que
 * deja. Sin uno así, nada.
 */
export function slaughterTargetOf(
  truth: ReadonlyWorldTruth,
  me: string,
  text: string | undefined,
  now: Tick,
  o: SlaughterOptions,
): NonNullable<ResolveInput["slaughterTarget"]> | undefined {
  const t = animalOf(truth, me, text, now, o);
  if (t === undefined) return undefined;
  const yields: { unit: LedgerUnit; grams: number }[] = carcassYield(
    t.def,
    (now - t.bornAt) / o.year,
  ).map((y) => ({ unit: ledgerUnit(`good:${y.good}`), grams: y.grams }));
  return {
    animal: t.id,
    holder: t.household as unknown as HolderRef,
    source: externalAccount(CARCASS_SOURCE),
    yields,
  };
}

/** El animal que se regala y adónde va: el hogar de quien lo recibe y su primera casa. */
export interface AnimalGift {
  readonly animal: AnimalId;
  readonly household: HouseholdId;
  readonly home: BuildingId;
}

/**
 * Pura (livestock-tenure-gift): el animal de su casa que nombra `text` (la especie tiene que estar
 * dicha) para dárselo a `to`, si `to` vive, está en su hex y es de otro hogar con casa. Sin eso, nada.
 */
export function giftTargetOf(
  truth: ReadonlyWorldTruth,
  me: string,
  to: string | undefined,
  text: string | undefined,
  now: Tick,
  o: SlaughterOptions,
): AnimalGift | undefined {
  if (to === undefined || truth.get(ENTITY, to as never)?.endedAt !== undefined) return undefined;
  const theirs = truth.get(PERSON, to as never)?.household;
  const mine = truth.get(PERSON, me as never)?.household;
  if (theirs === undefined || theirs === mine) return undefined;
  if (truth.get(LOCATION, to as never)?.hex !== truth.get(LOCATION, me as never)?.hex) {
    return undefined;
  }
  const home = homeOf(truth, theirs);
  if (home === undefined) return undefined;
  const t = animalOf(truth, me, text, now, o, true);
  return t === undefined ? undefined : { animal: t.id, household: theirs, home };
}

/** La primera casa en pie del hogar. */
function homeOf(truth: ReadonlyWorldTruth, h: HouseholdId): BuildingId | undefined {
  return ([...truth.ids(BUILDING)].sort(compareStrings) as BuildingId[]).find(
    (b) => truth.get(BUILDING, b)?.household === h && truth.get(ENTITY, b)?.endedAt === undefined,
  );
}

/** El animal ajeno que se roba: adónde va (su hogar y su casa) y a quién se le roba. */
export interface AnimalTheft extends AnimalGift {
  /** El primero vivo (por id) del hogar dueño: la víctima del robo. */
  readonly victim: AgentId;
}

/**
 * Pura (livestock-tenure-theft): el animal vivo de otro hogar, en su hex, cuya especie nombra
 * `text`, si el hogar dueño tiene a alguien vivo y el suyo, casa. Sin eso, nada.
 */
export function theftTargetOf(
  truth: ReadonlyWorldTruth,
  me: string,
  text: string | undefined,
  now: Tick,
  o: SlaughterOptions,
): AnimalTheft | undefined {
  const mine = truth.get(PERSON, me as never)?.household;
  const home = mine === undefined ? undefined : homeOf(truth, mine);
  if (mine === undefined || home === undefined) return undefined;
  const t = animalOf(truth, me, text, now, o, true, true);
  if (t === undefined) return undefined;
  const victim = ([...truth.ids(PERSON)].sort(compareStrings) as AgentId[]).find(
    (p) =>
      truth.get(PERSON, p)?.household === t.household &&
      truth.get(ENTITY, p)?.endedAt === undefined,
  );
  return victim === undefined ? undefined : { animal: t.id, household: mine, home, victim };
}

/** Lo que vale vivo un animal sobre lo que dejaría su cuerpo (cría, leche, lana, trabajo; sin calibrar). */
export const LIVE_FACTOR = 1.5;

/** Pura: el precio en cobre de un animal de `ageYears`: lo que valen su carne y su piel por `LIVE_FACTOR`. */
export function animalPrice(
  def: LivestockDef,
  ageYears: number,
  goods: readonly GoodDef[],
): number {
  const perKg = new Map(goods.map((g) => [g.id, g.priceCopperPerKg ?? 0] as const));
  const carcass = carcassYield(def, ageYears).reduce(
    (sum, y) => sum + (y.grams / 1000) * (perKg.get(y.good) ?? 0),
    0,
  );
  return Math.max(1, Math.round(carcass * LIVE_FACTOR));
}

/** El animal que se vende o se compra en un trato: adónde va si se cierra y en cuánto. */
export interface AnimalSale extends AnimalGift {
  readonly name: string;
  readonly direction: "buy" | "sell";
  readonly price: number;
  /** El comprador que no es el actor lo quiere: su casa no tiene ya el tope de la especie. */
  readonly wants: boolean;
  /** El vendedor que no es el actor lo larga: a su casa le queda otro de la especie. */
  readonly spare: boolean;
}

/** Posesivos que dicen de quién es el animal del trato. */
const THEIRS = new Set(["su", "sus", "suya", "suyo", "suyas", "suyos"]);
const MINE = new Set(["mi", "mis", "nuestra", "nuestro", "nuestras", "nuestros"]);

/** Pura: cuántos vivos de `species` tiene el hogar `h`, sin contar `except`. */
function herdCount(
  truth: ReadonlyWorldTruth,
  h: string,
  species: string,
  except: AnimalId,
): number {
  let n = 0;
  for (const id of truth.ids(ANIMAL) as AnimalId[]) {
    const a = truth.get(ANIMAL, id);
    if (id === except || a?.owner !== h || a.species !== species) continue;
    if (truth.get(ENTITY, id)?.endedAt === undefined) n++;
  }
  return n;
}

/**
 * Pura (livestock-tenure-sell): el animal que nombra `text` (la especie tiene que estar dicha) en
 * un trato con `other`, vivo, en su hex y de otro hogar: si la casa de `me` tiene uno de esos lo
 * vende; si no, le compra uno de la casa del otro. Va a la primera casa del que compra; sin casa,
 * nada.
 */
export function animalSaleOf(
  truth: ReadonlyWorldTruth,
  me: string,
  other: string | undefined,
  text: string | undefined,
  now: Tick,
  goods: readonly GoodDef[],
  o: SlaughterOptions,
): AnimalSale | undefined {
  if (other === undefined || truth.get(ENTITY, other as never)?.endedAt !== undefined) {
    return undefined;
  }
  const theirs = truth.get(PERSON, other as never)?.household;
  const mine = truth.get(PERSON, me as never)?.household;
  if (theirs === undefined || mine === undefined || theirs === mine) return undefined;
  if (truth.get(LOCATION, other as never)?.hex !== truth.get(LOCATION, me as never)?.hex) {
    return undefined;
  }
  // «su cabra» es la del otro (se compra) y «mi cabra», la propia (se vende); sin seña, la propia si hay.
  const words = new Set(fold(text ?? "").split(/[^a-zñ]+/));
  const side = [...THEIRS].some((w) => words.has(w))
    ? "buy"
    : [...MINE].some((w) => words.has(w))
      ? "sell"
      : undefined;
  const own = side === "buy" ? undefined : animalOf(truth, me, text, now, o, true);
  const t = own ?? (side === "sell" ? undefined : animalOf(truth, me, text, now, o, true, theirs));
  if (t === undefined) return undefined;
  const direction = own !== undefined ? "sell" : "buy";
  const buyer = direction === "sell" ? theirs : mine;
  const home = homeOf(truth, buyer);
  if (home === undefined) return undefined;
  const max = t.def.breeding?.maxPerHousehold ?? Number.POSITIVE_INFINITY;
  return {
    animal: t.id,
    household: buyer,
    home,
    name: t.def.name,
    direction,
    price: animalPrice(t.def, (now - t.bornAt) / o.year, goods),
    wants: direction === "buy" || herdCount(truth, theirs, t.def.id, t.id) < max,
    spare: direction === "sell" || herdCount(truth, theirs, t.def.id, t.id) > 0,
  };
}

/** Pura: el animal regalado pasa a ser del otro hogar y de su casa. */
export function giftChanges(truth: ReadonlyWorldTruth, g: AnimalGift): StateChange[] {
  const a = truth.get(ANIMAL, g.animal);
  return a ? [setComponent(ANIMAL, g.animal, { ...a, owner: g.household, home: g.home })] : [];
}

/** Pura: lo que cambia al carnear `animal`: termina con `event` y se borran sus filas de vida. */
export function slaughterChanges(
  truth: ReadonlyWorldTruth,
  animal: AnimalId,
  event: EventId,
  now: Tick,
): StateChange[] {
  const base = truth.get(ENTITY, animal);
  if (!base) return [];
  const changes: StateChange[] = [endEntity(base, event, now), deleteComponent(LOCATION, animal)];
  if (truth.get(ANIMAL_HUNGER, animal)) changes.push(deleteComponent(ANIMAL_HUNGER, animal));
  if (truth.get(LACTATING, animal)) changes.push(deleteComponent(LACTATING, animal));
  if (truth.get(DRAFT_FATIGUE, animal)) changes.push(deleteComponent(DRAFT_FATIGUE, animal));
  return changes;
}

/**
 * Pura (livestock-tenure-sell-household): de quiénes sale el cobre de una compra de `buyer`: él
 * primero, después la bolsa del hogar y los demás vivos del hogar por id, solo los que tienen.
 */
export function householdPayers(
  truth: ReadonlyWorldTruth,
  buyer: AgentId,
  copperOf: (holder: HolderRef) => number,
): { holder: HolderRef; copper: number }[] {
  const h = truth.get(PERSON, buyer)?.household;
  const others = (truth.ids(PERSON) as AgentId[])
    .filter(
      (id) =>
        id !== buyer &&
        h !== undefined &&
        truth.get(PERSON, id)?.household === h &&
        truth.get(ENTITY, id)?.endedAt === undefined,
    )
    .sort(compareStrings);
  const holders = [buyer, ...(h === undefined ? [] : [h]), ...others] as unknown as HolderRef[];
  return holders
    .map((holder) => ({ holder, copper: Math.max(0, Math.floor(copperOf(holder))) }))
    .filter((p) => p.copper > 0);
}

/**
 * Pura (livestock-tenure-sell-barter): lo que la casa de `buyer` puede poner en bienes cuando el
 * cobre no alcanza: cada bien con precio que tiene la bolsa del hogar, con lo que vale (al precio de
 * referencia) y cuántos gramos por cobre; del que más vale al que menos, y por id.
 */
export function householdBarter(
  truth: ReadonlyWorldTruth,
  buyer: AgentId,
  holdings: (holder: HolderRef) => readonly { unit: LedgerUnit; amount: number }[],
  goods: readonly GoodDef[],
): { holder: HolderRef; copper: number; unit: LedgerUnit; gramsPerCopper: number }[] {
  const h = truth.get(PERSON, buyer)?.household as unknown as HolderRef | undefined;
  if (h === undefined) return [];
  const price = new Map(
    goods
      .filter((g) => g.form === "good" && (g.priceCopperPerKg ?? 0) > 0)
      .map((g) => [`good:${g.id}`, g.priceCopperPerKg as number]),
  );
  return holdings(h)
    .flatMap((r) => {
      const p = price.get(r.unit as string);
      if (p === undefined) return [];
      const gramsPerCopper = 1000 / p;
      const copper = Math.floor(r.amount / gramsPerCopper);
      return copper > 0 ? [{ holder: h, copper, unit: r.unit, gramsPerCopper }] : [];
    })
    .sort((a, b) => b.copper - a.copper || compareStrings(a.unit, b.unit));
}
