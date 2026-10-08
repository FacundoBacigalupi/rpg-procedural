// Interpretación (npc-psychology §3, Fase 2): el mismo evento marca distinto a cada uno. Recibe lo
// que la persona vivió (su papel y qué tan grave fue para ella, nunca la verdad entera) y devuelve
// los estímulos formativos que `form` aplica, más a quién culpa. Es pura y determinista:
// temperamento + esquemas + el evento. Lo ya esperado pesa menos (quien cree que el mundo es
// peligroso se sorprende menos de que le peguen) y lo que confirma lo que cree pesa más.
//
// Hoy interpreta peleas y la muerte de un familiar; el hambre, la crianza y el resto de los
// eventos llegan con los ítems siguientes. Las emociones y los cambios de relación
// (`relationshipDeltas`) quedan fuera de este paso.

import type { AgentId } from "../../core/index.ts";
import type { Innate } from "../family/index.ts";
import type { FormativeStimulus, Mind } from "./mind.ts";

export interface Appraised {
  readonly stimulus: FormativeStimulus;
  /** A quién atribuye lo que le pasó (null si a nadie). */
  readonly blame: AgentId | null;
}

/** Cuánto baja la intensidad de lo que el esquema correspondiente ya esperaba (a fuerza 1). */
export const EXPECTED_DAMPING = 0.25;
/** Cuánto baja la intensidad un temperamento audaz, que lo toma como desafío (a audacia 1). */
export const BOLD_DAMPING = 0.2;
/** Piso de la intensidad de una pelea en la que hubo herida, y lo que suma la gravedad. */
export const FIGHT_FLOOR = 0.2;
export const FIGHT_SPAN = 0.8;
/** La traición de alguien de la casa pesa esta fracción de la herida. */
export const BETRAYAL_SHARE = 0.6;
/** Fuerza de `strength_is_worth` desde la que ganar o perder una pelea enseña algo. */
export const PRIDE_MIN = 0.4;
/** Intensidad de una pérdida: piso y lo que suma la cercanía con quien se fue. */
export const LOSS_FLOOR = 0.25;
export const LOSS_SPAN = 0.75;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const strength = (mind: Mind, schema: string) => mind.schemas[schema]?.strength ?? 0;

export interface FightFacts {
  /** Mi papel en la pelea. */
  readonly role: "victim" | "aggressor";
  /** El rival. */
  readonly foe: AgentId;
  /** Gravedad (0-1) de la peor herida que me hicieron (víctima) o que hice (agresor). */
  readonly worst: number;
  /** Si terminé de pie (sin huir, rendirme ni caer). */
  readonly standing: boolean;
  /** Si el rival es de mi casa o de mi sangre. */
  readonly kin: boolean;
}

/** Cómo vive una pelea quien la peleó. */
export function appraiseFight(facts: FightFacts, mind: Mind, innate: Innate): Appraised[] {
  const worst = clamp01(facts.worst);
  if (facts.role === "aggressor") {
    // Solo le enseña algo a quien se mide por su fuerza: ganó (éxito) o perdió (fracaso).
    const pride = strength(mind, "strength_is_worth");
    if (pride < PRIDE_MIN) return [];
    if (facts.standing) {
      if (worst <= 0) return [];
      return [
        {
          stimulus: { theme: "success", intensity: round(clamp01(0.15 + 0.3 * worst)) },
          blame: null,
        },
      ];
    }
    return [{ stimulus: { theme: "failure", intensity: round(0.4 * pride) }, blame: facts.foe }];
  }
  if (worst <= 0) return [];
  const damped = (own: number, schema: string) =>
    clamp01(own * (1 - EXPECTED_DAMPING * strength(mind, schema)));
  const bold = 1 - BOLD_DAMPING * Math.max(0, innate["boldness"] ?? 0);
  const hurt = clamp01(FIGHT_FLOOR + FIGHT_SPAN * worst);
  const out: Appraised[] = [
    {
      stimulus: { theme: "violence", intensity: round(damped(hurt, "world_is_dangerous") * bold) },
      blame: facts.foe,
    },
  ];
  if (facts.kin) {
    out.push({
      stimulus: {
        theme: "betrayal",
        intensity: round(damped(hurt * BETRAYAL_SHARE, "people_are_untrustworthy") * bold),
      },
      blame: facts.foe,
    });
  }
  return out;
}

/** Cómo vive la muerte de alguien quien lo quería (0 = nada, 1 = lo más cercano). */
export function appraiseLoss(closeness: number): Appraised[] {
  const c = clamp01(closeness);
  if (c <= 0) return [];
  return [
    { stimulus: { theme: "loss", intensity: round(LOSS_FLOOR + LOSS_SPAN * c) }, blame: null },
  ];
}
