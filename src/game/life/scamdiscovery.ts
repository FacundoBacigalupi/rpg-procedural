// El descubrimiento de la estafa de calidad (economy §6): el comprador que pagó por un lote mejor
// de lo que es lo va usando, y cada día puede notar la diferencia (o un tasador, o su propio ojo).
// `life.act` deja cada trato inflado en `SCAM_DEALS` con el evento del trato; este proceso, único
// dueño de `SCAM_FOUND`, tira una vez por trato y día (RNG con clave: trato y día) con
// `discoveryChance` y, si lo descubre, emite `scam.discovered` con causa en el evento del trato.
// De ese evento sale lo demás: `life.appraise` baja la confianza del comprador en el vendedor
// (`scamAftermath`) y `life.deeds` lo anota como incumplimiento para que la fama del vendedor caiga.
// Opt-in (`LifeParts.scam`); apagado no existe ni corre.

import type { AgentId, Event, EventId, PlaceRef } from "../../core/index.ts";
import {
  discoveryChance,
  ENTITY,
  INNATE,
  type ProcessDef,
  pendingScams,
  type ReadonlyWorldTruth,
  SCAM_DEALS,
  SCAM_FOUND,
  type ScamAftermath,
  type StateChange,
  scamAftermath,
  setComponent,
} from "../../sim/index.ts";

export const SCAM_DISCOVERY_PROCESS = "life.scam_discovery";
export const SCAM_DISCOVERED = "scam.discovered";

export interface ScamDiscoveryOptions {
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Qué tan fino mira el comprador (0-1, ver `scamEyeOf`); sin dato, 0,5. */
  readonly eye?: (truth: ReadonlyWorldTruth, buyer: AgentId) => number;
  /** Días con el lote en uso por trato: el tiempo desde que lo compró. */
  readonly day: number;
}

/** Lo que dice `scam.discovered` en `data` (lo lee `life.appraise`). */
export interface ScamDiscoveredData extends ScamAftermath {
  readonly deal: EventId;
  readonly unit: string;
  readonly grams: number;
  readonly real: number;
  readonly believed: number;
}

/** Del evento `scam.discovered`: quién cayó (comprador), quién estafó y el agravio. */
export function discoveredBy(
  e: Event,
): { buyer: AgentId; seller: AgentId; data: ScamDiscoveredData } | null {
  if (e.kind !== SCAM_DISCOVERED) return null;
  const [seller, buyer] = e.actors as (AgentId | undefined)[];
  if (!seller || !buyer) return null;
  return { buyer, seller, data: e.data as ScamDiscoveredData };
}

export function scamDiscoveryProcess(o: ScamDiscoveryOptions): ProcessDef {
  return {
    id: SCAM_DISCOVERY_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "perceive",
    reads: [SCAM_DEALS.name, SCAM_FOUND.name, ENTITY.name, INNATE.name],
    writes: [SCAM_FOUND.name],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      const events = [];
      const buyers = [...(truth.ids(SCAM_DEALS) as AgentId[])].sort();
      for (const buyer of buyers) {
        if (truth.get(ENTITY, buyer)?.endedAt !== undefined) continue;
        const pending = pendingScams(truth.get(SCAM_DEALS, buyer), truth.get(SCAM_FOUND, buyer));
        const found: EventId[] = [];
        for (const d of pending) {
          if (ctx.now <= d.tick) continue;
          const used = (ctx.now - d.tick) / o.day;
          const p = discoveryChance(d.real, d.believed, o.eye?.(truth, buyer) ?? 0.5, used);
          if (p <= 0) continue;
          const rng = ctx.rng.fork("scam", d.event, ctx.windowIndex ?? ctx.now);
          if (!rng.chance(p)) continue;
          found.push(d.event);
          const after = scamAftermath(d.real, d.believed, d.trust);
          const data: ScamDiscoveredData = {
            ...after,
            deal: d.event,
            unit: d.unit,
            grams: d.grams,
            real: d.real,
            believed: d.believed,
          };
          events.push({
            kind: SCAM_DISCOVERED,
            actors: [d.seller, buyer],
            place: o.placeOf(truth, buyer),
            data,
            emissions: {},
            causes: [{ kind: "event" as const, event: d.event }],
          });
        }
        if (found.length > 0) {
          const before = truth.get(SCAM_FOUND, buyer)?.events ?? [];
          changes.push(
            setComponent(SCAM_FOUND, buyer, { events: [...before, ...found].slice(-32) }),
          );
        }
      }
      return events.length === 0 ? {} : { changes, events };
    },
  };
}
