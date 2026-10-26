// El herrero de la aldea (use-tools-mend-smith, crafts, economy): al empezar la vida un adulto de la
// aldea es el herrero, de preferencia uno de un hogar que vive de herrar herramientas (el oficio
// `forge-tools`); toda la aldea sabe quién es y dónde está su fragua (la casa). Con él presente,
// quien le lleva una herramienta gastada se la hace reparar: le paga en cobre, el herrero pone el
// hierro de su hogar (el que también usa el oficio) y la herramienta recupera el metal comido según
// lo bueno que sea, que mejora con cada arreglo. Si su hogar no tenía hierro (no era del oficio), al
// elegirlo entra un lote desde la fuente `seed` con un evento que lo cita. Opt-in con
// `householdTools`; los replays anteriores a `life-52` no tienen herrero (`legacyNoSmith`).

import {
  type AgentId,
  type EventId,
  type EventLog,
  externalAccount,
  type HolderRef,
  holderAccount,
  type IdAllocator,
  type Ledger,
  type LedgerUnit,
  ledgerUnit,
  type PlaceRef,
  Rng,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import type { ReadonlyWorldTruth } from "../../sim/index.ts";
import { ENTITY, LOCATION, PERSON, table, type WorldTruth } from "../../sim/index.ts";

/** El herrero y qué tan bueno es (0 torpe, 1 maestro). Una fila por persona que lo fue. */
export interface Smith {
  readonly level: number;
}

export const SMITH = table<Smith>("life.smith");

export const SMITH_CHOSEN = "smith.chosen";
export const IRON_GOOD = "iron";
export const IRON_UNIT: LedgerUnit = ledgerUnit(`good:${IRON_GOOD}`);
/** El oficio de los hogares que ya viven del hierro. */
export const FORGE_TRADE = "forge-tools";
/** Edad mínima (años) para hacer de herrero. */
export const SMITH_MIN_AGE = 16;
/** Gramos de hierro con que arranca un herrero cuyo hogar no tenía (sin calibrar). */
export const SMITH_IRON_START = 2000;

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Nivel de arranque según un número de 0 a 1: ya sabe el oficio, más o menos. Puro. */
export function smithStartLevel(u: number): number {
  return round(0.3 + 0.4 * clamp01(u));
}

/** Nivel tras un arreglo: sube hacia el techo del oficio, cada vez menos. Puro. */
export function smithLevelAfterJob(level: number): number {
  const ceiling = 0.95;
  return round(Math.min(ceiling, level + (ceiling - level) * 0.03));
}

/** El herrero vivo (el primero por id), si hay. */
export function smithOf(truth: ReadonlyWorldTruth): AgentId | undefined {
  for (const id of [...truth.ids(SMITH)].sort()) {
    if (truth.get(PERSON, id) === undefined) continue;
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    return id as AgentId;
  }
  return undefined;
}

export interface SeedSmithInput {
  readonly seed: Seed;
  readonly player: AgentId;
  readonly now: Tick;
  readonly year: number;
  readonly place: PlaceRef;
  /** El evento que lo causa (la fundación de la aldea). */
  readonly cause: EventId;
  /** Los hogares que viven de herrar herramientas: de ahí sale el herrero si hay alguno. */
  readonly forgeHouseholds: ReadonlySet<string>;
}

/**
 * Elige al herrero de la aldea: entre los adultos vivos que no son el personaje, los de un hogar del
 * oficio si hay; de ellos, el de menor tirada (`fork("smith", id)`). Escribe `SMITH`, el evento
 * `smith.chosen` y, si su hogar no tenía hierro, el lote de arranque. Devuelve el elegido.
 */
export function seedSmith(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  ledger: Ledger,
  input: SeedSmithInput,
): AgentId | undefined {
  const rng = Rng.root(input.seed);
  const adults: AgentId[] = [];
  for (const id of [...truth.ids(PERSON)].sort() as AgentId[]) {
    if (id === input.player || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const p = truth.get(PERSON, id);
    if (!p || (input.now - p.born) / input.year < SMITH_MIN_AGE) continue;
    if (truth.get(LOCATION, id)?.space === undefined) continue;
    adults.push(id);
  }
  const trade = adults.filter((id) =>
    input.forgeHouseholds.has(truth.get(PERSON, id)?.household ?? ""),
  );
  let chosen: AgentId | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const id of trade.length > 0 ? trade : adults) {
    const u = rng.fork("smith", id).float();
    if (u < best) {
      best = u;
      chosen = id;
    }
  }
  if (chosen === undefined) return undefined;
  const household = truth.get(PERSON, chosen)?.household;
  const level = smithStartLevel(rng.fork("smith-level", chosen).float());
  const home = household === undefined ? undefined : holderAccount(household as HolderRef);
  const iron = home === undefined ? 0 : ledger.balance(home, IRON_UNIT);
  const event = ids.next("event");
  log.append({
    id: event,
    tick: input.now,
    kind: SMITH_CHOSEN,
    actors: [chosen],
    place: input.place,
    data: { level, ...(iron > 0 || home === undefined ? {} : { iron: SMITH_IRON_START }) },
    emissions: {},
    causes: [{ kind: "event", event: input.cause }],
    resolution: "local",
  });
  truth.set(SMITH, chosen, { level });
  if (iron <= 0 && home !== undefined) {
    ledger.post({
      tick: input.now,
      eventId: event,
      transfers: [
        { unit: IRON_UNIT, from: externalAccount("seed"), to: home, amount: SMITH_IRON_START },
      ],
    });
  }
  return chosen;
}
