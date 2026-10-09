// Interpretación (npc-psychology §3, Fase 2): el mismo evento marca distinto a cada uno. Recibe lo
// que la persona vivió (su papel y qué tan grave fue para ella, nunca la verdad entera) y devuelve
// los estímulos formativos que `form` aplica, más a quién culpa. Es pura y determinista:
// temperamento + esquemas + el evento. Lo ya esperado pesa menos (quien cree que el mundo es
// peligroso se sorprende menos de que le peguen) y lo que confirma lo que cree pesa más.
//
// Hoy interpreta peleas y la muerte de un familiar; el hambre, la crianza y el resto de los
// eventos llegan con los ítems siguientes. Las emociones quedan fuera de este paso; los cambios
// de relación (`relationshipDeltas`) de peleas, remates y perdones salen de `fightDeltas` y afines.

import type { AgentId } from "../../core/index.ts";
import type { Innate } from "../family/index.ts";
import type { Deltas } from "../relations/index.ts";
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

/** Cuánto del dolor de una pérdida quita un consuelo pleno (rito, velorio, compañía; a consuelo 1). */
export const RITE_RELIEF = 0.4;

/**
 * Cómo vive la muerte de alguien quien lo quería (0 = nada, 1 = lo más cercano). `comfort` (0-1) es
 * el consuelo del rito que lo acompañó (`comfortOf` de religión): alivia la intensidad, no la borra.
 */
export function appraiseLoss(closeness: number, comfort = 0): Appraised[] {
  const c = clamp01(closeness);
  if (c <= 0) return [];
  const relief = 1 - RITE_RELIEF * clamp01(comfort);
  return [
    {
      stimulus: { theme: "loss", intensity: round((LOSS_FLOOR + LOSS_SPAN * c) * relief) },
      blame: null,
    },
  ];
}

/** Piso de la culpa que cuenta como estímulo (por debajo es una incomodidad, no una marca). */
export const GUILT_MIN = 0.05;

/**
 * Cómo vive haber roto lo que creía prohibido quien lo rompió (npc-psychology §11, religion §7).
 * `guilt` (0-1) es la intensidad de `guiltAfter` de religión (pesada por su fe y si lo vieron): el
 * mundo no castiga el tabú, lo castiga lo que él cree. Se culpa a sí mismo: `blame` es null.
 */
export function appraiseGuilt(guilt: number): Appraised[] {
  const g = clamp01(guilt);
  if (g < GUILT_MIN) return [];
  return [{ stimulus: { theme: "guilt", intensity: round(g) }, blame: null }];
}

/** Fracción de la grasa de referencia por debajo de la cual el hambre ya es carencia prolongada. */
export const HARDSHIP_FAT_START = 0.7;
/** Cuánto más abajo llega la intensidad plena (la reserva de grasa casi agotada). */
export const HARDSHIP_FAT_SPAN = 0.5;
/** Edad vivida (años) hasta la que la crianza forma: después la casa deja de criar. */
export const REARING_AGE = 12;
/** Peso de cada insumo del cuidado de quien cría (calidez, cariño por el chico, penuria de la casa). */
export const CARE_WARMTH = 0.5;
export const CARE_AFFECTION = 0.4;
export const CARE_STRAIN = 0.6;
export const CARE_BASE = 0.1;
/** Cuánto vale el cuidado de alguien que no es de la sangre del chico, contra el de un padre. */
export const CARE_STRANGER = 0.6;
/** Cuidado de un chico que no tiene a nadie en la casa que lo críe. */
export const CARE_ABANDONED = -0.8;
/** Chance por temporada de mano dura: base y lo que suman la audacia, la frialdad y la penuria. */
export const HARSH_BASE = 0.05;
export const HARSH_BOLD = 0.1;
export const HARSH_COLD = 0.1;
export const HARSH_STRAIN = 0.3;
export const HARSH_MAX = 0.6;
/** Fuerza del golpe (0-1) de una mano dura de gravedad 1; la gravedad la escala. */
export const HARSH_FORCE = 0.5;
/** Dónde pega quien corrige: brazos, piernas y torso, nunca la cabeza ni el cuello. */
export const HARSH_ZONES = [
  "left_arm",
  "right_arm",
  "left_leg",
  "right_leg",
  "chest",
  "abdomen",
] as const;

/** Cómo vive el hambre prolongada quien la pasa (`fatRatio`: grasa que le queda / la de referencia). */
export function appraiseHardship(fatRatio: number, mind: Mind): Appraised[] {
  const depletion = clamp01((HARDSHIP_FAT_START - fatRatio) / HARDSHIP_FAT_SPAN);
  if (depletion < 0.1) return [];
  const damped = depletion * (1 - EXPECTED_DAMPING * strength(mind, "world_is_dangerous"));
  return [{ stimulus: { theme: "hardship", intensity: round(clamp01(damped)) }, blame: null }];
}

/** Cuánto cuida alguien a un chico (-1 a 1): su calidez, su cariño por él y cuánto aprieta la casa. */
export function careOf(warmth: number, affection: number, strain: number): number {
  const x = CARE_WARMTH * warmth + CARE_AFFECTION * affection - CARE_STRAIN * clamp01(strain);
  return Math.min(1, Math.max(-1, x + CARE_BASE));
}

/** Chance de mano dura en una temporada de quien cría: más en el audaz, el frío y la casa apretada. */
export function harshChance(boldness: number, warmth: number, strain: number): number {
  const x =
    HARSH_BASE +
    HARSH_BOLD * Math.max(0, boldness) +
    HARSH_COLD * Math.max(0, -warmth) +
    HARSH_STRAIN * clamp01(strain);
  return Math.min(HARSH_MAX, Math.max(0, x));
}

export interface RearingFacts {
  /** Quién crió al chico esta temporada (null: nadie en la casa). */
  readonly caregiver: AgentId | null;
  /** Cuánto lo cuidó (-1 a 1, de `careOf`). */
  readonly care: number;
  /** Gravedad (0-1) de la mano dura de esa temporada (0: ninguna). */
  readonly harsh: number;
}

/** Cómo vive un chico la crianza de una temporada: cuidado o abandono, y la mano dura si hubo. */
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

/** Cambios de relación de una pelea: lo que `me` siente por el rival según lo que vivió. */
export const FIGHT_RESENTMENT = 0.6;
export const FIGHT_FEAR = 0.5;
export const FIGHT_DISTRUST = 0.5;
export const FIGHT_COLD = 0.4;
/** Contacto: cada pelea, perdón o remate sostiene un poco la familiaridad. */
export const FIGHT_FAMILIARITY = 0.05;
/** El remate a quien se rindió pesa esta fracción de una herida máxima, en las cuatro dimensiones. */
export const FINISH_SHOCK = 0.9;
/** Lo que deja ser perdonado: gratitud y alivio. */
export const SPARED_GRATITUDE = 0.4;
export const SPARED_RELIEF = 0.15;

function rounded(d: Deltas): Deltas {
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, round(v as number)]));
}

/** Cómo cambia lo que `me` siente por `foe` tras una pelea (pura; los esquemas y la audacia filtran). */
export function fightDeltas(facts: FightFacts, mind: Mind, innate: Innate): Deltas {
  const w = clamp01(facts.worst);
  const bold = 1 - 0.5 * Math.max(0, innate["boldness"] ?? 0);
  if (facts.role === "aggressor") {
    // Quien perdió aprende a respetar y a temer; quien ganó apenas se mueve.
    if (!facts.standing) {
      return rounded({
        familiarity: FIGHT_FAMILIARITY,
        respect: 0.1,
        fear: 0.2 * bold,
        resentment: 0.1,
      });
    }
    return rounded({ familiarity: FIGHT_FAMILIARITY, affection: -0.1 * w * (facts.kin ? 2 : 1) });
  }
  if (w <= 0) return rounded({ familiarity: FIGHT_FAMILIARITY });
  const wary = 1 - EXPECTED_DAMPING * strength(mind, "people_are_untrustworthy");
  const kin = facts.kin ? 1.5 : 1;
  return rounded({
    familiarity: FIGHT_FAMILIARITY,
    resentment: 0.15 + FIGHT_RESENTMENT * w,
    trust: -(0.1 + FIGHT_DISTRUST * w) * wary * kin,
    affection: -(0.1 + FIGHT_COLD * w) * kin,
    fear: (0.1 + FIGHT_FEAR * w) * bold * (facts.standing ? 0.5 : 1),
  });
}

/** Lo que siente por quien lo remató el que se había rendido. */
export function finishDeltas(): Deltas {
  const s = FINISH_SHOCK;
  return rounded({
    familiarity: FIGHT_FAMILIARITY,
    resentment: 0.6 * s,
    trust: -0.6 * s,
    affection: -0.5 * s,
    fear: 0.7 * s,
  });
}

/** Lo que siente por quien lo perdonó el que se había rendido, y quien perdona por el perdonado. */
export function spareDeltas(role: "spared" | "sparer"): Deltas {
  if (role === "sparer") return rounded({ familiarity: FIGHT_FAMILIARITY, respect: 0.05 });
  return rounded({
    familiarity: FIGHT_FAMILIARITY,
    gratitude: SPARED_GRATITUDE,
    trust: 0.1,
    respect: 0.1,
    fear: -SPARED_RELIEF,
    resentment: -SPARED_RELIEF,
  });
}

/** Trato y ayuda: lo que deja dar, comerciar, cuidar, fiar y devolver en cada parte. */
export const GIFT_GRATITUDE = 0.5;
export const GIFT_TRUST = 0.15;
export const GIFT_AFFECTION = 0.1;
/** Gramos de un regalo que cuentan como «grande» (a esa cantidad o más, el efecto es pleno). */
export const GIFT_FULL_GRAMS = 1000;
/** Un trato pareja suma confianza; la ventaja de un lado (`edge`, hasta 0,3) enoja al otro. */
export const TRADE_TRUST = 0.05;
export const TRADE_SOUR = 1.5;
/** Curar bien agradece y acerca; el que depende de otro para curarse lo siente. */
export const TEND_GRATITUDE = 0.6;
export const TEND_TRUST = 0.2;
export const TEND_AFFECTION = 0.15;
export const TEND_DEPENDENCY = 0.1;
/** Fiar: el que recibe agradece y depende; el que fía confía lo que arriesga. */
export const LEND_GRATITUDE = 0.3;
export const LEND_DEPENDENCY = 0.1;
export const LEND_TRUST = 0.08;
/** Pagar una deuda: la confianza que gana el acreedor y el alivio del deudor. */
export const REPAID_TRUST = 0.2;
export const REPAID_RELIEF = 0.1;
/** No pagar a tiempo: lo que pierde el acreedor en confianza y gana en resentimiento. */
export const DEFAULT_RESENTMENT = 0.35;
export const DEFAULT_TRUST = 0.3;

const share = (grams: number) => clamp01(grams / GIFT_FULL_GRAMS);

/**
 * Cambios por un `give`. `repayment` si lo dado saldaba una deuda: agradecer menos (era suyo) y
 * confiar más. Quien da no gana gratitud; sí un poco de cariño por el que ayudó.
 */
export function giveDeltas(role: "giver" | "receiver", grams: number, repayment = false): Deltas {
  const s = 0.3 + 0.7 * share(grams);
  if (role === "giver") {
    return rounded({
      familiarity: FIGHT_FAMILIARITY,
      affection: repayment ? 0 : GIFT_AFFECTION * s,
    });
  }
  return rounded({
    familiarity: FIGHT_FAMILIARITY,
    gratitude: GIFT_GRATITUDE * s * (repayment ? 0.3 : 1),
    trust: GIFT_TRUST * s * (repayment ? 2 : 1),
    affection: GIFT_AFFECTION * s * (repayment ? 0.5 : 1),
  });
}

/**
 * Cambios por un `trade` cerrado. `edge` es la ventaja del actor sobre lo que el otro cree justo
 * (-0,3 a 0,3): si el actor sacó ventaja, el otro se siente estafado; si cedió, el otro lo valora.
 */
export function tradeDeltas(role: "actor" | "other", edge: number): Deltas {
  const e = Math.min(0.3, Math.max(-0.3, edge));
  if (role === "actor") {
    return rounded({
      familiarity: FIGHT_FAMILIARITY,
      trust: TRADE_TRUST,
      gratitude: Math.max(0, e) * 0.2,
    });
  }
  const sour = Math.max(0, e) * TRADE_SOUR;
  return rounded({
    familiarity: FIGHT_FAMILIARITY,
    trust: TRADE_TRUST - sour,
    resentment: sour * 0.8,
    gratitude: Math.max(0, -e) * 0.6,
  });
}

/** Cambios por cuidar a alguien (`tend`); `care` es cuán bien lo hizo (0-1). */
export function tendDeltas(role: "carer" | "cared", care: number): Deltas {
  const c = clamp01(care);
  if (c <= 0) return rounded({ familiarity: FIGHT_FAMILIARITY });
  if (role === "carer") {
    return rounded({ familiarity: FIGHT_FAMILIARITY, affection: TEND_AFFECTION * c });
  }
  return rounded({
    familiarity: FIGHT_FAMILIARITY,
    gratitude: TEND_GRATITUDE * c,
    trust: TEND_TRUST * c,
    affection: TEND_AFFECTION * c,
    dependency: TEND_DEPENDENCY * c,
  });
}

/** Contacto: una charla suma esta familiaridad a cada parte (con rendimiento decreciente). */
export const TALK_FAMILIARITY = 0.03;
/** Contacto: cada hora compartiendo un mismo lugar suma esta familiaridad (con rendimiento decreciente). */
export const COMPANY_FAMILIARITY = 0.004;

/** Lo que suma el contacto a una familiaridad ya `current` (0-1): cuanto más se conocen, menos rinde. */
export function contactGain(gain: number, current: number): number {
  return round(gain * (1 - clamp01(current)));
}

/** Cambios por un préstamo concedido (`household.borrowed`). */
export function lendDeltas(role: "lender" | "borrower"): Deltas {
  if (role === "lender") return rounded({ familiarity: FIGHT_FAMILIARITY, trust: LEND_TRUST });
  return rounded({
    familiarity: FIGHT_FAMILIARITY,
    gratitude: LEND_GRATITUDE,
    dependency: LEND_DEPENDENCY,
    trust: LEND_TRUST,
  });
}

/** Cambios por la devolución en especie de una deuda (`household.repaid`). */
export function repaidDeltas(role: "creditor" | "debtor"): Deltas {
  if (role === "creditor") return rounded({ familiarity: FIGHT_FAMILIARITY, trust: REPAID_TRUST });
  return rounded({
    familiarity: FIGHT_FAMILIARITY,
    dependency: -REPAID_RELIEF,
    trust: 0.05,
  });
}

/** Cambios cuando el deudor no pagó a tiempo (`law.default`): el acreedor lo siente; el deudor, poco. */
export function defaultDeltas(role: "creditor" | "debtor", mind: Mind, scale = 1): Deltas {
  if (role === "debtor") return rounded({ familiarity: FIGHT_FAMILIARITY, resentment: 0.05 });
  const wary = 1 - EXPECTED_DAMPING * strength(mind, "people_are_untrustworthy");
  return rounded({
    familiarity: FIGHT_FAMILIARITY,
    resentment: DEFAULT_RESENTMENT * scale,
    trust: -DEFAULT_TRUST * wary * scale,
  });
}
