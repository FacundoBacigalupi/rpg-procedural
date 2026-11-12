// La tribulación cae (novel2-trib-gather, heaven-karma §5): `meditateProcess` junta las nubes y
// agenda este proceso para la hora en que caen; acá solo se emite la caída, a la vista y al oído de
// todos. La ruptura la resuelve `meditateProcess` al ver la caída (es quien escribe el estado de
// cultivo y la reserva de qi), devolviendo la energía a la reserva. Las olas llegan después.

import type { AgentId } from "../../core/index.ts";
import { type ProcessDef, TRIBULATION, TRIBULATION_STRIKES_EVENT } from "../../sim/index.ts";

export const TRIBULATION_PROCESS = "heaven.tribulation.strike";

export function tribulationProcess(): ProcessDef {
  return {
    id: TRIBULATION_PROCESS,
    system: "heaven",
    scope: "agent",
    cadence: {},
    representation: "individual",
    phase: "physics",
    reads: [TRIBULATION.name],
    writes: [],
    run(ctx) {
      if (ctx.scope === "world") return {};
      const who = ctx.scope as AgentId;
      const t = ctx.truth.get(TRIBULATION, who);
      // Ya resuelta (o nunca): nada que caiga. Antes de hora tampoco.
      if (!t || ctx.now < t.strikeAt) return {};
      return {
        events: [
          {
            kind: TRIBULATION_STRIKES_EVENT,
            actors: [who],
            place: t.place,
            data: { threshold: t.threshold, energy: t.energy, waves: 0 },
            emissions: { sight: 1, sound: 1 },
            causes: [
              { kind: "event", event: t.attempt },
              { kind: "state", entity: who, key: TRIBULATION.name },
            ],
          },
        ],
      };
    },
  };
}
