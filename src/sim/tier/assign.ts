// Asignación de tier de agente (simulation §4.2, §5): pura, sin mundo. Dado quién está
// materializado, dónde, qué tan importante es y quién tiene vínculo con el jugador, decide el tier
// 1-4 con histéresis (se entra a tier 3 con un umbral y se sale con otro más bajo), cupos de tier 3
// por región y en el mundo, y tier 4 que nunca baja. El tier 0 (anónimo) no pasa por acá: no es un
// registro. Contabilidad del motor: nada del mundo lee estos números.

import type { AgentId, Tick } from "../../core/index.ts";
import { type StateChange, setComponent } from "../scheduler/index.ts";
import { type ReadonlyWorldTruth, table } from "../world/index.ts";

export type EngineTier = 1 | 2 | 3 | 4;

/** Las dimensiones del puntaje de importancia (§5); cada una normalizada a 0..1 por quien las calcula. */
export interface ImportanceInputs {
  readonly power: number;
  readonly office: number;
  readonly longevity: number;
  readonly centrality: number;
  readonly activity: number;
  readonly uniqueness: number;
}

export type ImportanceWeights = Readonly<Record<keyof ImportanceInputs, number>>;

export const DEFAULT_IMPORTANCE_WEIGHTS: ImportanceWeights = {
  power: 3,
  office: 2.5,
  longevity: 0.5,
  centrality: 1.5,
  activity: 1.5,
  uniqueness: 2,
};

export function importanceScore(
  inputs: ImportanceInputs,
  weights: ImportanceWeights = DEFAULT_IMPORTANCE_WEIGHTS,
): number {
  let total = 0;
  for (const key of Object.keys(weights) as (keyof ImportanceInputs)[]) {
    total += weights[key] * Math.max(0, Math.min(1, inputs[key]));
  }
  return total;
}

export interface TierConfig {
  /** Puntaje para entrar a tier 3. */
  readonly enter: number;
  /** Puntaje por debajo del cual un tier 3 sale (menor que `enter`: histéresis). */
  readonly exit: number;
  /** Máximo de tier 3 por región. */
  readonly perRegion: number;
  /** Máximo de tier 3 en el mundo. */
  readonly world: number;
}

export const DEFAULT_TIER_CONFIG: TierConfig = { enter: 5, exit: 3.5, perRegion: 8, world: 64 };

export interface TierCandidate {
  readonly id: AgentId;
  readonly region: string;
  /** Está en una zona scene o local (tier 2 si no es 3 ni 4). */
  readonly inActiveZone: boolean;
  /** Es el jugador o tiene con él un vínculo significativo (tier 4). */
  readonly bonded: boolean;
  readonly importance: number;
  /** El tier que tenía (si lo tenía). */
  readonly previous?: EngineTier;
}

/**
 * Tier de cada candidato. Determinista: los empates de puntaje se rompen por id. Los que pasan el
 * cupo de tier 3 bajan a 2 (si están en zona activa) o a 1.
 */
export function assignTiers(
  candidates: readonly TierCandidate[],
  config: TierConfig = DEFAULT_TIER_CONFIG,
): Map<AgentId, EngineTier> {
  const out = new Map<AgentId, EngineTier>();
  const wants: TierCandidate[] = [];
  for (const c of candidates) {
    if (c.bonded || c.previous === 4) {
      out.set(c.id, 4);
      continue;
    }
    const keep = c.previous === 3 && c.importance >= config.exit;
    if (keep || c.importance >= config.enter) wants.push(c);
    else out.set(c.id, c.inActiveZone ? 2 : 1);
  }
  wants.sort((a, b) => b.importance - a.importance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const perRegion = new Map<string, number>();
  let inWorld = 0;
  for (const c of wants) {
    const n = perRegion.get(c.region) ?? 0;
    if (inWorld < config.world && n < config.perRegion) {
      out.set(c.id, 3);
      perRegion.set(c.region, n + 1);
      inWorld++;
    } else out.set(c.id, c.inActiveZone ? 2 : 1);
  }
  return out;
}

export interface TierRecord {
  readonly tier: EngineTier;
  readonly since: Tick;
  readonly importance: number;
}

export const TIER = table<TierRecord>("sim.tier");

/** Los cambios de registro para lo que cambió de tier (o no tenía). Puro; no cablea al mundo. */
export function tierChanges(
  truth: ReadonlyWorldTruth,
  assigned: ReadonlyMap<AgentId, EngineTier>,
  importance: ReadonlyMap<AgentId, number>,
  now: Tick,
): StateChange[] {
  const changes: StateChange[] = [];
  const ids = [...assigned.keys()].sort();
  for (const id of ids) {
    const tier = assigned.get(id) as EngineTier;
    const prev = truth.get(TIER, id);
    if (prev?.tier === tier) continue;
    changes.push(setComponent(TIER, id, { tier, since: now, importance: importance.get(id) ?? 0 }));
  }
  return changes;
}
