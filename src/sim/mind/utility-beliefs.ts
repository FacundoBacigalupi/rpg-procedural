// Los insumos creídos de la utilidad (npc-psychology §5, §7): el ánimo del momento y lo que el NPC
// cree de cada otro salen de su memoria y de lo que percibió, no de un número supuesto. El miedo
// es el de las memorias que dolieron (intensidad × saliencia ya decaída); la soledad, las horas
// desde que estuvo con alguien que le importa; la necesidad ajena, de lo que vio de su cuerpo; el
// peligro ajeno, de su miedo a esa persona, de lo que le hizo y de lo que la vio hacer. Puro.

import type { AgentId, Tick } from "../../core/index.ts";
import { type Memories, salienceAt } from "./memory.ts";
import type { MoodInput } from "./utility-inputs.ts";
import type { OtherBelief } from "./utility-social.ts";

const HOUR = 3600;

/** Cuánta necesidad creída se le supone a quien no se sabe cómo está (sin calibrar). */
export const ASSUMED_NEED = 0.2;
/** Valencia desde la que una memoria cuenta como compañía grata. */
export const WARM_VALENCE = 0.2;
/** Los tipos de evento que dicen cómo está el cuerpo del otro (su necesidad), no qué hizo. */
export const BODY_EVENT_PREFIX = "body.";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const r = (x: number) => Math.round(x * 1e6) / 1e6;

/** Lo que dolió de una memoria, 0-1: intensidad × saliencia de hoy × cuánto fue negativa. */
function sting(m: Memories["items"][number], now: Tick): number {
  return clamp01(m.intensity * salienceAt(m, now) * Math.max(0, -m.valence));
}

export interface MoodSources {
  readonly memories: Memories | undefined;
  readonly now: Tick;
  /** Le importa (afecto, parentesco): decide de quién cuenta la compañía. */
  readonly cares: (who: AgentId) => boolean;
  /** Hay alguien que le importa en el mismo lugar ahora. */
  readonly withCompany: boolean;
}

/** El ánimo desde la memoria: el miedo de lo reciente y las horas desde la última compañía. */
export function moodFrom(s: MoodSources): MoodInput {
  let fear = 0;
  let lastWarm: Tick | undefined;
  for (const m of s.memories?.items ?? []) {
    fear = Math.max(fear, sting(m, s.now));
    if (m.valence >= WARM_VALENCE && m.perceived.with.some(s.cares)) {
      if (lastWarm === undefined || m.at > lastWarm) lastWarm = m.at;
    }
  }
  const aloneHours =
    s.withCompany || lastWarm === undefined ? 0 : Math.max(0, (s.now - lastWarm) / HOUR);
  return { fear: r(fear), aloneHours: r(aloneHours) };
}

export interface OtherSources {
  readonly who: AgentId;
  readonly memories: Memories | undefined;
  readonly now: Tick;
  /** La dimensión `fear` de la relación (su miedo a esa persona). */
  readonly relFear: number;
  /** Cuánto la cree peligrosa por lo que la vio hacer (0-1), si la vio. */
  readonly seenHarm?: number;
  /** Cuánta fe le tiene a lo que cree de ella (viva, dónde está). */
  readonly confidence: number;
}

/** Lo que cree de otro: necesidad y peligro desde la memoria, con el supuesto solo sin pruebas. */
export function otherBeliefFrom(s: OtherSources): OtherBelief {
  let need = 0;
  let threat = Math.max(0, s.relFear, s.seenHarm ?? 0);
  let evidence = false;
  for (const m of s.memories?.items ?? []) {
    if (!m.perceived.with.includes(s.who)) continue;
    const pain = sting(m, s.now);
    if (m.perceived.kind.startsWith(BODY_EVENT_PREFIX)) {
      evidence = true;
      need = Math.max(need, clamp01(m.intensity * salienceAt(m, s.now) * Math.abs(m.valence)));
    } else threat = Math.max(threat, pain);
  }
  return {
    need: r(evidence ? need : ASSUMED_NEED),
    threat: r(clamp01(threat)),
    confidence: s.confidence,
  };
}
