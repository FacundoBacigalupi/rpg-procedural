// Interpretaci√≥n (npc-psychology ¬ß3, Fase 2): el mismo evento marca distinto a cada uno. Recibe lo
// que la persona vivi√≥ (su papel y qu√© tan grave fue para ella, nunca la verdad entera) y devuelve
// los est√≠mulos formativos que `form` aplica, m√°s a qui√©n culpa. Es pura y determinista:
// temperamento + esquemas + el evento. Lo ya esperado pesa menos (quien cree que el mundo es
// peligroso se sorprende menos de que le peguen) y lo que confirma lo que cree pesa m√°s.
//
// Hoy interpreta peleas y la muerte de un familiar; el hambre, la crianza y el resto de los
// eventos llegan con los √≠tems siguientes. Las emociones y los cambios de relaci√≥n
// (`relationshipDeltas`) quedan fuera de este paso.

import type { AgentId } from "../../core/index.ts";
import type { Innate } from "../family/index.ts";
import type { FormativeStimulus, Mind } from "./mind.ts";

export interface Appraised {
  readonly stimulus: FormativeStimulus;
  /** A qui√©n atribuye lo que le pas√≥ (null si a nadie). */
  readonly blame: AgentId | null;
}

/** Cu√°nto baja la intensidad de lo que el esquema correspondiente ya esperaba (a fuerza 1). */
export const EXPECTED_DAMPING = 0.25;
/** Cu√°nto baja la intensidad un temperamento audaz, que lo toma como desaf√≠o (a audacia 1). */
export const BOLD_DAMPING = 0.2;
/** Piso de la intensidad de una pelea en la que hubo herida, y lo que suma la gravedad. */
export const FIGHT_FLOOR = 0.2;
export const FIGHT_SPAN = 0.8;
/** La traici√≥n de alguien de la casa pesa esta fracci√≥n de la herida. */
export const BETRAYAL_SHARE = 0.6;
/** Fuerza de `strength_is_worth` desde la que ganar o perder una pelea ense√±a algo. */
export const PRIDE_MIN = 0.4;
/** Intensidad de una p√©rdida: piso y lo que suma la cercan√≠a con quien se fue. */
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
  /** Gravedad (0-1) de la peor herida que me hicieron (v√≠ctima) o que hice (agresor). */
  readonly worst: number;
  /** Si termin√© de pie (sin huir, rendirme ni caer). */
  readonly standing: boolean;
  /** Si el rival es de mi casa o de mi sangre. */
  readonly kin: boolean;
}

/** C√≥mo vive una pelea quien la pele√≥. */
export function appraiseFight(facts: FightFacts, mind: Mind, innate: Innate): Appraised[] {
  const worst = clamp01(facts.worst);
  if (facts.role === "aggressor") {
    // Solo le ense√±a algo a quien se mide por su fuerza: gan√≥ (√©xito) o perdi√≥ (fracaso).
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

/** C√≥mo vive la muerte de alguien quien lo quer√≠a (0 = nada, 1 = lo m√°s cercano). */
export function appraiseLoss(closeness: number): Appraised[] {
  const c = clamp01(closeness);
  if (c <= 0) return [];
  return [
    { stimulus: { theme: "loss", intensity: round(LOSS_FLOOR + LOSS_SPAN * c) }, blame: null },
  ];
}

/** FracciÛn de la grasa de referencia por debajo de la cual el hambre ya es carencia prolongada. */
export const HARDSHIP_FAT_START = 0.7;
/** Cu·nto m·s abajo llega la intensidad plena (la reserva de grasa casi agotada). */
export const HARDSHIP_FAT_SPAN = 0.5;
/** Edad vivida (aÒos) hasta la que la crianza forma: despuÈs la casa deja de criar. */
export const REARING_AGE = 12;
/** Peso de cada insumo del cuidado de quien crÌa (calidez, cariÒo por el chico, penuria de la casa). */
export const CARE_WARMTH = 0.5;
export const CARE_AFFECTION = 0.4;
export const CARE_STRAIN = 0.6;
export const CARE_BASE = 0.1;
/** Cu·nto vale el cuidado de alguien que no es de la sangre del chico, contra el de un padre. */
export const CARE_STRANGER = 0.6;
/** Cuidado de un chico que no tiene a nadie en la casa que lo crÌe. */
export const CARE_ABANDONED = -0.8;
/** Chance por temporada de mano dura: base y lo que suman la audacia, la frialdad y la penuria. */
export const HARSH_BASE = 0.05;
export const HARSH_BOLD = 0.1;
export const HARSH_COLD = 0.1;
export const HARSH_STRAIN = 0.3;
export const HARSH_MAX = 0.6;

/** CÛmo vive el hambre prolongada quien la pasa (`fatRatio`: grasa que le queda / la de referencia). */
export function appraiseHardship(fatRatio: number, mind: Mind): Appraised[] {
  const depletion = clamp01((HARDSHIP_FAT_START - fatRatio) / HARDSHIP_FAT_SPAN);
  if (depletion < 0.1) return [];
  const damped = depletion * (1 - EXPECTED_DAMPING * strength(mind, "world_is_dangerous"));
  return [{ stimulus: { theme: "hardship", intensity: round(clamp01(damped)) }, blame: null }];
}

/** Cu·nto cuida alguien a un chico (-1 a 1): su calidez, su cariÒo por Èl y cu·nto aprieta la casa. */
export function careOf(warmth: number, affection: number, strain: number): number {
  const x = CARE_WARMTH * warmth + CARE_AFFECTION * affection - CARE_STRAIN * clamp01(strain);
  return Math.min(1, Math.max(-1, x + CARE_BASE));
}

/** Chance de mano dura en una temporada de quien crÌa: m·s en el audaz, el frÌo y la casa apretada. */
export function harshChance(boldness: number, warmth: number, strain: number): number {
  const x =
    HARSH_BASE +
    HARSH_BOLD * Math.max(0, boldness) +
    HARSH_COLD * Math.max(0, -warmth) +
    HARSH_STRAIN * clamp01(strain);
  return Math.min(HARSH_MAX, Math.max(0, x));
}

export interface RearingFacts {
  /** QuiÈn criÛ al chico esta temporada (null: nadie en la casa). */
  readonly caregiver: AgentId | null;
  /** Cu·nto lo cuidÛ (-1 a 1, de `careOf`). */
  readonly care: number;
  /** Gravedad (0-1) de la mano dura de esa temporada (0: ninguna). */
  readonly harsh: number;
}

/** CÛmo vive un chico la crianza de una temporada: cuidado o abandono, y la mano dura si hubo. */
export function appraiseRearing(facts: RearingFacts, mind: Mind, innate: Innate): Appraised[] {
  const out: Appraised[] = [];
  const care = Math.min(1, Math.max(-1, facts.care));
  if (care >= 0.2) {
    out.push({ stimulus: { theme: "care", intensity: round(0.6 * care) }, blame: null });
  } else if (care <= -0.2) {
    const felt = -care * (1 - EXPECTED_DAMPING * strength(mind, "people_are_untrustworthy"));
    out.push({ stimulus: { theme: "neglect", intensity: round(clamp01(felt)) }, blame: null });
  }
  const harsh = clamp01(facts.harsh);
  if (harsh > 0) {
    const bold = 1 - BOLD_DAMPING * Math.max(0, innate["boldness"] ?? 0);
    const hurt = clamp01(FIGHT_FLOOR + FIGHT_SPAN * harsh);
    const damped = clamp01(hurt * (1 - EXPECTED_DAMPING * strength(mind, "world_is_dangerous")));
    out.push({
      stimulus: { theme: "violence", intensity: round(damped * bold) },
      blame: facts.caregiver,
    });
  }
  return out;
}
