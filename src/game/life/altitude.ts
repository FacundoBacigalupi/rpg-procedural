// Aclimatación a la altura cableada a la vida (body-health §7): cada día la aclimatación de cada
// persona vive en `ACCLIMATIZATION` (aparte del `Body`) y se mueve con la altitud de donde está
// (`stepAcclimatization`). Opt-in: no está en la aldea por defecto, así que no hay filas, ni RNG
// ni muertes. Los efectos (`altitudeEnduranceFactor`, `altitudeSickness`) los lee quien los use.

import type { AgentId, PlanetClock } from "../../core/index.ts";
import {
  ACCLIMATIZATION,
  BODY_STATE,
  ENTITY,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  stepAcclimatization,
} from "../../sim/index.ts";

export const ALTITUDE_PROCESS = "life.altitude";

export interface AltitudeOptions {
  readonly clock: PlanetClock;
  /** Altitud (m) de quien está. */
  readonly altitudeOf: (truth: ReadonlyWorldTruth, who: AgentId) => number;
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
    reads: [PERSON.name, ENTITY.name, BODY_STATE.name, ACCLIMATIZATION.name],
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
