// Aclimatación a la altura cableada a la vida (body-health §7): cada día la aclimatación de cada
// persona vive en `ACCLIMATIZATION` (aparte del `Body`) y se mueve con la altitud de donde está
// (`stepAcclimatization`). Opt-in: no está en la aldea por defecto, así que no hay filas, ni RNG
// ni muertes. Los efectos (`altitudeEnduranceFactor`, `altitudeSickness`) los lee quien los use.

import type { AgentId, PlanetClock } from "../../core/index.ts";
import {
  ACCLIMATIZATION,
  adaptationRate,
  altitudeEnduranceFactor,
  BODY_STATE,
  type BodyCapabilities,
  ENTITY,
  GENOME,
  LOCATION,
  type LocalMap,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  stepAcclimatization,
} from "../../sim/index.ts";

export const ALTITUDE_PROCESS = "life.altitude";

/**
 * Altitud real (m) de quien está: la elevación del hex de planet-gen donde está (`LOCATION.hex`,
 * `LocalMap.elevationM`). Lectura simple y determinista; sin elevación en el mapa o sin lugar, 0.
 */
export function mapAltitudeOf(map: LocalMap): (truth: ReadonlyWorldTruth, who: AgentId) => number {
  return (truth, who) => {
    const hex = truth.get(LOCATION, who)?.hex;
    return hex === undefined ? 0 : (map.elevationM?.[hex] ?? 0);
  };
}

/** Las capacidades con la resistencia bajada por la altura y la aclimatación de quien está. */
export function applyAltitude(
  caps: BodyCapabilities,
  truth: ReadonlyWorldTruth,
  who: AgentId,
  altitudeOf: (truth: ReadonlyWorldTruth, who: AgentId) => number,
): BodyCapabilities {
  const factor = altitudeEnduranceFactor(
    altitudeOf(truth, who),
    truth.get(ACCLIMATIZATION, who)?.level ?? 0,
  );
  return factor >= 1 ? caps : { ...caps, endurance: caps.endurance * factor };
}

export interface AltitudeOptions {
  readonly clock: PlanetClock;
  /** Altitud (m) de quien está. */
  readonly altitudeOf: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  /** Opt-in: la tasa de aclimatación escala con el genoma (`constitution`), sin tocar el RNG. */
  readonly genomeAdaptation?: boolean | undefined;
}

/** Por debajo de este nivel no se guarda fila. */
const MIN_LEVEL = 0.005;

export function altitudeProcess(o: AltitudeOptions): ProcessDef {
  return {
    id: ALTITUDE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      PERSON.name,
      ENTITY.name,
      BODY_STATE.name,
      ACCLIMATIZATION.name,
      ...(o.genomeAdaptation ? [GENOME.name] : []),
    ],
    writes: [ACCLIMATIZATION.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const days = Math.max(1, Math.min(ctx.window, o.clock.day * 30) / o.clock.day);
      for (const id of ctx.truth.ids(PERSON)) {
        const body = ctx.truth.get(BODY_STATE, id);
        const base = ctx.truth.get(ENTITY, id);
        if (!body || !base || base.endedAt !== undefined || body.death) continue;
        const had = ctx.truth.get(ACCLIMATIZATION, id);
        const next = stepAcclimatization(
          had?.level ?? 0,
          o.altitudeOf(ctx.truth, id as AgentId),
          days,
          o.genomeAdaptation
            ? adaptationRate(ctx.truth.get(GENOME, id)?.additive["constitution"])
            : 1,
        );
        if (next > MIN_LEVEL) {
          if (!had || had.level !== next) {
            changes.push(setComponent(ACCLIMATIZATION, id, { level: next, at: ctx.now }));
          }
        } else if (had) {
          changes.push({ op: "delete", table: ACCLIMATIZATION.name, id });
        }
      }
      return changes.length > 0 ? { changes } : {};
    },
  };
}
