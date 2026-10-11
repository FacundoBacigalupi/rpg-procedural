// Medición de las capas de objetivos (f3e): corre la misma vida con y sin `persistGoalLayers` y
// compara hash, eventos que no son `npc.goal` (las decisiones no deben cambiar: las capas siempre
// empujan por `layerDrives`) y cuánto pesa el empuje de las capas frente al del núcleo.
// Sirve para decidir con evidencia `LAYER_PULL` y si la persistencia puede ser el defecto.

import type { Content, Seed } from "../../core/index.ts";
import {
  defaultGameSetup,
  GOAL_EVENT,
  Life,
  type LifeSetup,
  NPC_GOALS,
  optionsOf,
} from "../../game/index.ts";
import { ENTITY, GOAL_PULL, type Goal, LAYER_PULL } from "../../sim/index.ts";
import { type MetricSummary, summarizeFlat } from "./batch.ts";

/** Empuje total a los valores de un conjunto de objetivos, separado entre núcleo y capas. */
export function pushOf(
  goals: readonly Goal[],
  pull: Readonly<Record<"long" | "medium" | "short", number>> = LAYER_PULL,
): { core: number; layers: number } {
  let core = 0;
  let layers = 0;
  for (const g of goals) {
    if (g.kind !== "pursue" || g.value === undefined) continue;
    if (g.layer === "long" || g.layer === "medium" || g.layer === "short")
      layers += pull[g.layer] * g.weight;
    else if (g.layer === "core") core += GOAL_PULL * g.weight;
  }
  return { core, layers };
}

export interface LayerRun {
  readonly hash: string;
  readonly events: number;
  readonly goalEvents: number;
  readonly otherEventsByKind: Readonly<Record<string, number>>;
  /** NPC vivos con capas persistidas y empuje medio de capas contra el del núcleo. */
  readonly agentsWithLayers: number;
  readonly layerRows: number;
  readonly layerShare: number;
}

export function measureLayerRun(
  seed: Seed,
  content: Content,
  setup: LifeSetup,
  years: number,
  persist: boolean,
): LayerRun {
  const life = Life.create(seed, content, {
    ...optionsOf(setup),
    ...(persist ? { persistGoalLayers: true } : {}),
  });
  const w = life.world;
  life.advanceTo(life.now + Math.round(years * w.clock.year));
  const byKind: Record<string, number> = {};
  let goalEvents = 0;
  for (const e of w.log.all()) {
    if (e.kind === GOAL_EVENT) goalEvents++;
    else byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  }
  let agents = 0;
  let rows = 0;
  let shares = 0;
  for (const id of w.truth.ids(NPC_GOALS)) {
    if (w.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const items = w.truth.get(NPC_GOALS, id)?.items ?? [];
    const layered = items.filter(
      (g) => g.layer === "long" || g.layer === "medium" || g.layer === "short",
    );
    if (layered.length === 0) continue;
    const { core, layers } = pushOf(items);
    agents++;
    rows += layered.length;
    shares += core + layers > 0 ? layers / (core + layers) : 0;
  }
  const sorted = Object.fromEntries(Object.entries(byKind).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    hash: JSON.stringify(life.hash()),
    events: w.log.all().length,
    goalEvents,
    otherEventsByKind: sorted,
    agentsWithLayers: agents,
    layerRows: rows,
    layerShare: agents > 0 ? shares / agents : 0,
  };
}

export interface LayerSeedReport {
  readonly seed: Seed;
  readonly off: LayerRun;
  readonly on: LayerRun;
  readonly sameHash: boolean;
  /** Las decisiones (todo evento salvo `npc.goal`) son iguales con y sin persistencia. */
  readonly sameDecisions: boolean;
}

export function measureLayerSeed(
  seed: Seed,
  content: Content,
  years: number,
  frequency?: number,
): LayerSeedReport {
  const setup: LifeSetup = {
    game: defaultGameSetup("realistic"),
    ...(frequency === undefined ? {} : { frequency }),
  };
  const off = measureLayerRun(seed, content, setup, years, false);
  const on = measureLayerRun(seed, content, setup, years, true);
  return {
    seed,
    off,
    on,
    sameHash: off.hash === on.hash,
    sameDecisions: JSON.stringify(off.otherEventsByKind) === JSON.stringify(on.otherEventsByKind),
  };
}

export function measureLayers(
  seeds: readonly Seed[],
  content: Content,
  years: number,
  frequency?: number,
): {
  readonly reports: readonly LayerSeedReport[];
  readonly summary: Readonly<Record<string, MetricSummary>>;
} {
  const reports = seeds.map((s) => measureLayerSeed(s, content, years, frequency));
  const summary = summarizeFlat(
    reports.map((r) => ({
      sameHash: r.sameHash ? 1 : 0,
      sameDecisions: r.sameDecisions ? 1 : 0,
      goalEvents: r.on.goalEvents,
      eventsOff: r.off.events,
      eventsOn: r.on.events,
      agentsWithLayers: r.on.agentsWithLayers,
      layerRows: r.on.layerRows,
      layerShare: r.on.layerShare,
    })),
  );
  return { reports, summary };
}
