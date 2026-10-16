// Sembrar filas reales de `PERSON_ORIGIN` (language §5 y §12, `npc-b2b4c2b3a1`): comunidades
// vecinas con su acento y quienes llegan de ellas (viajeros, migrantes, el personaje que entra de
// afuera). Todo opt-in: sin comunidades vecinas no hay filas y todos son de la aldea (lo de siempre).
//
// Una vecina habla la lengua de la aldea con otro acento (un dialecto: deriva propia desde la
// misma madre, más generaciones de separación) o la lengua que se le pase; el extranjero que llega
// habla la suya con nivel 1 y la de la aldea según los años que lleva cerca. Lenguas distintas
// de verdad esperan contenido (`npc-b2b4c2b3a1b`).

import type {
  AgentId,
  EventId,
  EventLog,
  IdAllocator,
  PlaceRef,
  Seed,
  SettlementId,
  Tick,
} from "../../core/index.ts";
import { COMMUNITY_ACCENT, ENTITY, seedCommunityAccent, type WorldTruth } from "../../sim/index.ts";
import { type SpokenLanguage, setPersonOrigin } from "./person-origin.ts";

/** Generaciones de separación de una comunidad vecina respecto de la madre (sin calibrar). */
export const NEIGHBOR_SEPARATION = 14;
/** Años cerca de la aldea para dominar su lengua del todo (sin calibrar). */
export const YEARS_TO_LEARN = 6;
/** Techo del nivel que se alcanza solo conviviendo, sin estudiar (sin calibrar). */
export const IMMERSION_CAP = 0.9;

export interface NeighborInput {
  readonly seed: Seed;
  readonly place: PlaceRef;
  readonly now: Tick;
  readonly foundersEvent: EventId;
  /** La lengua que hablan (la de la aldea, salvo que haya contenido para otra). */
  readonly language: string;
  /** Cuántas comunidades vecinas sembrar. */
  readonly count: number;
}

/** Siembra `count` comunidades vecinas con su ficha y su acento; devuelve sus ids en orden. */
export function seedNeighborCommunities(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: NeighborInput,
): SettlementId[] {
  const out: SettlementId[] = [];
  for (let i = 0; i < input.count; i++) {
    const id = ids.next("settlement") as SettlementId;
    truth.set(ENTITY, id, { id, originEventId: input.foundersEvent, createdAt: 0 });
    seedCommunityAccent(truth, ids, log, {
      seed: input.seed,
      settlement: id,
      place: input.place,
      now: input.now,
      foundersEvent: input.foundersEvent,
      language: input.language,
      generations: NEIGHBOR_SEPARATION + 2 * i,
    });
    out.push(id);
  }
  return out;
}

/** El nivel que alcanza en una lengua quien lleva `years` años cerca de quienes la hablan. */
export function immersionLevel(years: number): number {
  return Math.max(0, Math.min(IMMERSION_CAP, (IMMERSION_CAP * years) / YEARS_TO_LEARN));
}

/**
 * Anota que `who` viene de `community`: habla su lengua nativa y, si lleva `yearsHere` cerca de la
 * aldea, la de ella en la medida de la inmersión (solo si es otra lengua). No hace nada si la
 * comunidad no tiene acento sembrado: no se inventa un origen que no existe.
 */
export function arriveFrom(
  truth: WorldTruth,
  who: AgentId,
  community: SettlementId,
  village: SettlementId | undefined,
  yearsHere: number,
): boolean {
  const own = truth.get(COMMUNITY_ACCENT, community);
  if (!own) return false;
  const home = village === undefined ? undefined : truth.get(COMMUNITY_ACCENT, village);
  const learned: SpokenLanguage[] =
    home && home.language !== own.language && yearsHere > 0
      ? [{ language: home.language, level: immersionLevel(yearsHere) }]
      : [];
  setPersonOrigin(truth, who, { origin: community, learned });
  return true;
}

/** Cómo entra el personaje (player-loop §2) y, si viene de afuera, de dónde y hace cuánto. */
export type PlayerEntry =
  | { readonly kind: "born" }
  | { readonly kind: "age" }
  | { readonly kind: "arrived"; readonly from: number; readonly yearsHere: number };

/**
 * El origen del personaje según el modo de entrada: nacer o entrar a una edad es criarse en la
 * aldea (sin fila); llegar de afuera es de la vecina `from` (índice en `neighbors`) con sus años.
 */
export function seedPlayerOrigin(
  truth: WorldTruth,
  player: AgentId,
  entry: PlayerEntry,
  neighbors: readonly SettlementId[],
  village: SettlementId | undefined,
): boolean {
  if (entry.kind !== "arrived") return false;
  const community = neighbors[entry.from];
  if (community === undefined) return false;
  return arriveFrom(truth, player, community, village, entry.yearsHere);
}
