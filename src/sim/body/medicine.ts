// Medicina mortal (body-health §6 y §11, parte pura): diagnóstico por síntomas observables como
// creencia (con error y sesgo cultural), remedios con efecto acotado sobre el curso de una
// infección (ventana, dosis, el placebo solo consuela), cuarentena como menos dosis de exposición
// y parto con o sin partera como función de entradas. La habilidad del médico entra como número
// 0-1 en todas. Sin estado: el azar sale de un `Rng` con clave que pone el llamador.

import { logistic, type Rng } from "../../core/index.ts";
import type { PathogenDef, Shared } from "./disease.ts";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// --- Diagnóstico -----------------------------------------------------------------------------

/** Lo que se ve, se huele o se toca: id de síntoma → intensidad 0-1 (fiebre, manchas, pulso...). */
export type SignSet = Readonly<Record<string, number>>;

/** Una condición como la entiende una escuela médica (puede no coincidir con la ley del mundo). */
export interface ConditionModel {
  readonly id: string;
  /** Qué síntomas espera ver, con peso 0-1. */
  readonly signature: Readonly<Record<string, number>>;
  /** Sesgo cultural: cuánto se tiende a pensar en ella de entrada (-1 a 1). */
  readonly prior: number;
}

export interface DiagnosisBelief {
  readonly condition: string;
  /** 0-1: qué tan segura queda la creencia (no es la chance de acertar). */
  readonly confidence: number;
  /** Las otras opciones que quedaron cerca, de mayor a menor. */
  readonly alternatives: readonly string[];
}

/**
 * Cuánto encaja lo observado con la firma de una condición (0-1, sin sesgo ni ruido): promedio
 * de cuánto de lo esperado se ve y cuánto de lo visto explica la condición.
 */
export function signFit(signs: SignSet, model: ConditionModel): number {
  let hit = 0;
  let expected = 0;
  let explained = 0;
  let total = 0;
  for (const [s, w] of Object.entries(model.signature)) {
    expected += w;
    hit += w * clamp01(signs[s] ?? 0);
  }
  for (const [s, v] of Object.entries(signs)) {
    total += clamp01(v);
    if (model.signature[s] !== undefined) explained += clamp01(v);
  }
  if (expected <= 0 || total <= 0) return 0;
  return 0.5 * (hit / expected) + 0.5 * (explained / total);
}

/**
 * Diagnostica: cada candidata puntúa por ajuste + sesgo cultural + ruido que baja con la
 * habilidad (`skill` 0-1) y con la atención (`care` 0-1: tiempo y examen). Gasta un `float` por
 * candidata. Devuelve null si no hay candidatas.
 */
export function diagnose(
  signs: SignSet,
  models: readonly ConditionModel[],
  skill: number,
  care: number,
  rng: Rng,
): DiagnosisBelief | null {
  if (models.length === 0) return null;
  const noiseAmp = 0.6 * (1 - 0.7 * clamp01(skill) - 0.25 * clamp01(care));
  const scored = models.map((m) => {
    const u = rng.float();
    const prior = 0.3 * m.prior * (1 - 0.5 * clamp01(skill));
    return { id: m.id, score: signFit(signs, m) + prior + (u - 0.5) * 2 * noiseAmp };
  });
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const top = scored[0];
  if (!top) return null;
  const second = scored[1];
  const gap = second ? top.score - second.score : top.score;
  return {
    condition: top.id,
    confidence: clamp01(logistic(4 * top.score - 1) * (0.5 + 0.5 * clamp01(gap * 3))),
    alternatives: scored
      .slice(1)
      .filter((s) => top.score - s.score < 0.25)
      .map((s) => s.id),
  };
}

// --- Remedios --------------------------------------------------------------------------------

export interface RemedyDef {
  readonly id: string;
  /** Patógenos sobre los que actúa de verdad (vacío: charlatanería, solo placebo). */
  readonly targets: readonly string[];
  /** Horas desde la toma hasta que empieza a hacer efecto, hasta el pico y hasta que se acaba. */
  readonly onsetHours: number;
  readonly peakHours: number;
  readonly endHours: number;
  /** Efecto máximo sobre el curso (0-1) a dosis óptima en pleno pico. */
  readonly potency: number;
  /** Dosis (en unidades del remedio) con el mejor efecto y a partir de la cual daña. */
  readonly optimalDose: number;
  readonly toxicDose: number;
  /** Consuelo percibido (0-1): baja el malestar, nunca la carga del patógeno. */
  readonly placebo: number;
}

/** Curva de la ventana: 0 antes del inicio, sube al pico, baja hasta el fin. */
export function windowCurve(def: RemedyDef, hoursSinceDose: number): number {
  const h = hoursSinceDose;
  if (h <= def.onsetHours || h >= def.endHours) return 0;
  if (h < def.peakHours)
    return (h - def.onsetHours) / Math.max(1e-6, def.peakHours - def.onsetHours);
  return (def.endHours - h) / Math.max(1e-6, def.endHours - def.peakHours);
}

/** Factor de dosis: sube hasta la óptima (saturando) y de ahí cae a 0 en la dosis tóxica. */
export function doseFactor(def: RemedyDef, dose: number): number {
  if (dose <= 0) return 0;
  if (dose <= def.optimalDose) {
    const r = dose / def.optimalDose;
    return 2 * r - r * r;
  }
  const over = (dose - def.optimalDose) / Math.max(1e-6, def.toxicDose - def.optimalDose);
  return clamp01(1 - over);
}

/** Daño del remedio por pasarse de dosis (0-1; 0 hasta la óptima, 1 en la tóxica o más). */
export function remedyHarm(def: RemedyDef, dose: number): number {
  if (dose <= def.optimalDose) return 0;
  return clamp01((dose - def.optimalDose) / Math.max(1e-6, def.toxicDose - def.optimalDose));
}

export interface RemedyGiven {
  readonly remedy: RemedyDef;
  readonly dose: number;
  /** Cuántas horas pasaron desde la toma. */
  readonly hoursSinceDose: number;
  /** Cuántas horas de curso llevaba el enfermo al tomarla (0: antes de los síntomas). */
  readonly courseHoursAtDose: number;
  /** Habilidad de quien lo preparó o lo dio (0-1): pesa la preparación y la dosis. */
  readonly skill: number;
}

/**
 * Efecto real sobre un patógeno (0-1). Cero si el remedio no es para ese patógeno, sea cual sea
 * el placebo. Empezar tarde en el curso lo recorta; la habilidad desvía la dosis efectiva.
 */
export function remedyEffect(p: PathogenDef, g: RemedyGiven): number {
  if (!g.remedy.targets.includes(p.id)) return 0;
  const lateness = clamp01(g.courseHoursAtDose / Math.max(1, p.courseHours));
  const prep = 0.6 + 0.4 * clamp01(g.skill);
  const eff = g.dose * prep;
  return clamp01(
    g.remedy.potency *
      windowCurve(g.remedy, g.hoursSinceDose) *
      doseFactor(g.remedy, eff) *
      (1 - 0.6 * lateness),
  );
}

/** Consuelo (0-1) que siente el paciente: pequeño, acotado y sin relación con el patógeno. */
export function placeboComfort(g: RemedyGiven, belief: number): number {
  return clamp01(
    g.remedy.placebo * clamp01(belief) * Math.min(1, windowCurve(g.remedy, g.hoursSinceDose) + 0.3),
  );
}

export interface TreatedCourse {
  /** Multiplicador de las horas de curso (1: igual; menos: se acorta). */
  readonly courseFactor: number;
  /** Multiplicador de la letalidad del curso (1: igual). */
  readonly lethalityFactor: number;
}

/** Cómo cambia el curso con un efecto acumulado `effect` (0-1). Acotado: nunca cura de golpe. */
export function treatedCourse(effect: number): TreatedCourse {
  const e = clamp01(effect);
  return { courseFactor: 1 - 0.4 * e, lethalityFactor: 1 - 0.7 * e };
}

/** Nueva chance de que el curso sea fatal (0-1) con ese efecto y el daño del remedio. */
export function treatedFatalChance(
  p: PathogenDef,
  frailty: number,
  effect: number,
  harm: number,
): number {
  const base = clamp01(p.lethality * (0.5 + frailty));
  return clamp01(
    base * treatedCourse(effect).lethalityFactor + 0.3 * clamp01(harm) * (0.5 + frailty),
  );
}

/** Riesgo de infección de una herida (0-1) según cuidado: limpieza, vendaje y habilidad. */
export function woundInfectionRisk(
  base: number,
  cleaned: boolean,
  bandaged: boolean,
  skill: number,
): number {
  const s = clamp01(skill);
  const factor = (cleaned ? 0.55 - 0.2 * s : 1) * (bandaged ? 0.85 : 1);
  return clamp01(base * factor);
}

// --- Cuarentena ------------------------------------------------------------------------------

export interface Quarantine {
  /** 0-1: cuánto se separa al enfermo de los demás (cuarto aparte, puerta cerrada). */
  readonly isolation: number;
  /** 0-1: cuánto se cumple de verdad. */
  readonly compliance: number;
  /** 0-1: el que lo cuida se lava y se cubre (baja el contacto del cuidador). */
  readonly caregiverHygiene: number;
  /** El agua del enfermo va aparte (baja la ruta de agua). */
  readonly separateWater: boolean;
}

/** Lo que comparten con el enfermo tras la cuarentena: menos horas, cercanía y toque. */
export function quarantinedShared(shared: Shared, q: Quarantine, isCaregiver: boolean): Shared {
  const cut = clamp01(q.isolation) * clamp01(q.compliance);
  if (isCaregiver) {
    const h = 1 - 0.6 * clamp01(q.caregiverHygiene);
    return {
      ...shared,
      touch: shared.touch * h,
      closeness: shared.closeness * (1 - 0.3 * clamp01(q.caregiverHygiene)),
    };
  }
  return {
    hours: shared.hours * (1 - cut),
    closeness: shared.closeness * (1 - 0.5 * cut),
    ventilation: shared.ventilation,
    waterDirt: q.separateWater ? shared.waterDirt * (1 - cut) : shared.waterDirt,
    touch: shared.touch * (1 - cut),
  };
}

// --- Parto -----------------------------------------------------------------------------------

export interface BirthInputs {
  readonly motherAgeYears: number;
  /** 0-1 (nutrición y salud de la madre). */
  readonly nutrition: number;
  readonly health: number;
  /** Partos previos. */
  readonly parity: number;
  /** Habilidad de la partera (0-1) o null si nadie asiste. */
  readonly midwifeSkill: number | null;
  /** 0-1: higiene del lugar (agua limpia, manos lavadas). */
  readonly hygiene: number;
  /** 0-1: instrumental e hierbas a mano (hemostáticos, tijeras limpias). */
  readonly supplies: number;
  /** 0-1: dificultad intrínseca (mala posición, mellizos; viene de la concepción). */
  readonly difficulty: number;
}

export interface BirthRisk {
  /** Complicación grave durante el parto. */
  readonly complication: number;
  /** Muerte de la madre dado que hay complicación (la partera la baja). */
  readonly maternalDeathIfComplication: number;
  /** Fiebre puerperal posterior (higiene). */
  readonly puerperalFever: number;
  /** Muerte del niño dado que hay complicación. */
  readonly infantDeathIfComplication: number;
}

/** Riesgos del parto como función de las entradas; todos entre 0 y 1. */
export function birthRisk(b: BirthInputs): BirthRisk {
  const age = b.motherAgeYears;
  const ageStress = age < 18 ? (18 - age) * 0.25 : age > 35 ? (age - 35) * 0.12 : 0;
  const frail = 1 - clamp01(b.nutrition) * 0.5 - clamp01(b.health) * 0.5;
  const firstBirth = b.parity === 0 ? 0.4 : 0;
  const x = -2.6 + ageStress + 1.4 * frail + firstBirth + 2 * clamp01(b.difficulty);
  const m = b.midwifeSkill;
  const assist = m === null ? 0 : 0.25 + 0.75 * clamp01(m);
  const complication = logistic(x - 0.5 * assist);
  const kit = clamp01(b.supplies);
  const maternal = clamp01(0.55 * (1 - 0.65 * assist - 0.2 * kit));
  const infant = clamp01(0.45 * (1 - 0.5 * assist - 0.1 * kit));
  const fever = clamp01(0.18 * (1 - clamp01(b.hygiene)) * (1 - 0.4 * assist) + 0.01);
  return {
    complication,
    maternalDeathIfComplication: maternal,
    puerperalFever: fever,
    infantDeathIfComplication: infant,
  };
}

export interface BirthOutcome {
  readonly complication: boolean;
  readonly motherDied: boolean;
  readonly infantDied: boolean;
  readonly fever: boolean;
}

/** Resuelve el parto con cuatro `float` fijos (misma clave, mismo resultado). */
export function resolveBirth(risk: BirthRisk, rng: Rng): BirthOutcome {
  const u = [rng.float(), rng.float(), rng.float(), rng.float()] as const;
  const complication = u[0] < risk.complication;
  const motherDied = complication && u[1] < risk.maternalDeathIfComplication;
  const infantDied = complication && u[2] < risk.infantDeathIfComplication;
  const fever = !motherDied && u[3] < risk.puerperalFever;
  return { complication, motherDied, infantDied, fever };
}
