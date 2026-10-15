// Reservorios desde la ecología (body-health §6, living-world §8 «enfermedades de fauna»): una
// población silvestre de la celda (ratas, ciervos, una bestia) o un agua quieta (pantano) guarda un
// patógeno. La prevalencia sigue a la población real de `ECOLOGY` con `reservoirStep` (se sostiene
// sobre el tamaño crítico y se apaga bajo él, con retardo), y quien está ese día al aire libre donde
// vive el reservorio (monte para los animales, los hexes del agua) o convive con él en casa
// (comensales) tira `spillSeed`. Las semillas salen por `ExposureOptions.arrivals` con el
// reservorio como causa; el contagio entre personas lo sigue haciendo `life.exposure`.
// Opt-in: sin huéspedes declarados no hay proceso, filas, RNG ni eventos.

import type { AgentId, CauseRef, EntityRef, Rng, Tick } from "../../core/index.ts";
import {
  BODY_STATE,
  ECOLOGY,
  ENTITY,
  INFECTION,
  isImmune,
  LOCATION,
  type LocalMap,
  type PathogenDef,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type Reservoir,
  reservoirStep,
  setComponent,
  table,
} from "../../sim/index.ts";
import { type PathogenSeed, spillSeed } from "./exposure.ts";

export const RESERVOIR_PROCESS = "life.reservoir";

/** Un huésped del patógeno en la celda de la aldea (declarado por el escenario o el perfil). */
export interface ReservoirHost {
  /** Clave estable (RNG, fila y causa). */
  readonly id: string;
  readonly def: PathogenDef;
  readonly kind: "animal" | "water";
  /** Animal: el linaje de `ECOLOGY` que lo guarda; su conteo es la población del reservorio. */
  readonly lineage?: string;
  /** Agua: el tamaño fijo del reservorio (no hay población que corra). */
  readonly volume?: number;
  /** Población mínima para que se sostenga solo. */
  readonly criticalSize: number;
  /** Contacto 0-1 de quien pasa el día al aire libre donde vive (monte o `hexes`). */
  readonly wildContact: number;
  /** Contacto 0-1 de los demás (comensales: ratas en las casas); default 0. */
  readonly homeContact?: number;
  /** Agua: los hexes donde se toca; animal: default los hexes de monte del mapa. */
  readonly hexes?: readonly number[];
  /** Cómo se lo nombra en la ficha del patógeno. */
  readonly label?: string;
}

/** Estado de un reservorio: la prevalencia que arrastra y la población del último día. */
export interface ReservoirRow {
  readonly id: string;
  readonly population: number;
  readonly prevalence: number;
}

/** Una fila en la entidad de la ecología de la aldea con todos los reservorios. */
export interface ReservoirState {
  readonly hosts: readonly ReservoirRow[];
}

export const RESERVOIR = table<ReservoirState>("life.reservoir");

export interface ReservoirOptions {
  readonly hosts: readonly ReservoirHost[];
  readonly dayTicks: number;
}

/** La población del reservorio hoy: el conteo del linaje en la celda o el volumen fijo del agua. */
export function hostPopulation(host: ReservoirHost, truth: ReadonlyWorldTruth): number {
  if (host.kind === "water") return Math.max(0, host.volume ?? 0);
  const [id] = truth.ids(ECOLOGY);
  const eco = id === undefined ? undefined : truth.get(ECOLOGY, id);
  const pop = eco?.cell.populations.find((p) => p.lineage === host.lineage);
  return Math.max(0, pop?.count ?? 0);
}

function asReservoir(host: ReservoirHost, row: ReservoirRow): Reservoir {
  return {
    pathogen: host.def.id,
    kind: host.kind,
    population: row.population,
    prevalence: row.prevalence,
    criticalSize: host.criticalSize,
  };
}

/**
 * La prevalencia de cada reservorio avanza un tramo con la población real de la celda. Escribe solo
 * si algo cambió; sin ecología anotada no hay dónde guardar la fila y no hace nada. No toca las
 * poblaciones (la epizootia que las baja es un ítem aparte).
 */
export function reservoirProcess(o: ReservoirOptions): ProcessDef {
  return {
    id: RESERVOIR_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [ECOLOGY.name, RESERVOIR.name],
    writes: [RESERVOIR.name],
    run(ctx) {
      if (o.hosts.length === 0) return {};
      const [id] = ctx.truth.ids(ECOLOGY);
      if (id === undefined) return {};
      const days = Math.max(1, ctx.window) / o.dayTicks;
      const prev = ctx.truth.get(RESERVOIR, id);
      const hosts = o.hosts.map((h): ReservoirRow => {
        const before = prev?.hosts.find((r) => r.id === h.id);
        const population = hostPopulation(h, ctx.truth);
        const next = reservoirStep(
          asReservoir(h, { id: h.id, population, prevalence: before?.prevalence ?? 0 }),
          days,
        );
        return { id: h.id, population, prevalence: next.prevalence };
      });
      const same =
        prev !== undefined &&
        prev.hosts.length === hosts.length &&
        prev.hosts.every(
          (r, i) =>
            r.id === hosts[i]?.id &&
            r.population === hosts[i]?.population &&
            r.prevalence === hosts[i]?.prevalence,
        );
      if (same) return {};
      return { changes: [setComponent(RESERVOIR, id, { hosts })] };
    },
  };
}

/** Contacto de `who` con el reservorio hoy, por dónde está (foto de `LOCATION`). */
export function reservoirContact(
  host: ReservoirHost,
  truth: ReadonlyWorldTruth,
  who: EntityRef,
  map: LocalMap,
): number {
  const home = Math.max(0, Math.min(1, host.homeContact ?? 0));
  const loc = truth.get(LOCATION, who as never);
  if (!loc || loc.space !== undefined) return home;
  const wild = host.hexes ? host.hexes.includes(loc.hex) : map.forest[loc.hex] === true;
  return wild ? Math.max(home, Math.min(1, Math.max(0, host.wildContact))) : home;
}

/**
 * Semillas del día (pura salvo la tirada con clave): cada persona viva con contacto con un
 * reservorio activo tira `spillSeed` por un día; las inmunes o ya infectadas de ese patógeno no
 * tiran. La causa es el estado del reservorio en la entidad de la ecología. Orden estable por id.
 */
export function reservoirSeeds(
  rng: Rng,
  truth: ReadonlyWorldTruth,
  now: Tick,
  hosts: readonly ReservoirHost[],
  map: LocalMap,
): PathogenSeed[] {
  if (hosts.length === 0) return [];
  const [eco] = truth.ids(ECOLOGY);
  if (eco === undefined) return [];
  const state = truth.get(RESERVOIR, eco);
  if (!state) return [];
  const active = hosts.flatMap((h) => {
    const row = state.hosts.find((r) => r.id === h.id);
    return row && row.prevalence > 0 ? [{ h, row }] : [];
  });
  if (active.length === 0) return [];
  const out: PathogenSeed[] = [];
  const people = [...truth.ids(PERSON)]
    .filter((id) => truth.get(ENTITY, id)?.endedAt === undefined && truth.has(BODY_STATE, id))
    .sort();
  const day = rng.fork("reservoir", now);
  for (const id of people) {
    const inf = truth.get(INFECTION, id);
    for (const { h, row } of active) {
      if (out.some((s) => s.carrier === id && s.def.id === h.def.id)) continue;
      if (inf?.infections.some((i) => i.pathogen === h.def.id)) continue;
      if (inf && isImmune(inf.immunities, h.def.id, now)) continue;
      const contact = reservoirContact(h, truth, id, map);
      if (contact <= 0) continue;
      const cause: CauseRef = { kind: "state", entity: eco, key: `reservoir:${h.id}` };
      const seed = spillSeed(day.fork(h.id), asReservoir(h, row), h.def, contact, 1, {
        carrier: id as AgentId,
        from: now,
        cause,
      });
      if (seed) {
        out.push({
          ...seed,
          ...(h.label ? { source: `${seed.source} (${h.label})` } : {}),
          perCarrier: true,
        });
      }
    }
  }
  return out;
}
