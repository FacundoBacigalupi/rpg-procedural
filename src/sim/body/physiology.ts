// La fisiología del tier 3 (body-health §2, §4, §5, §8): el cuerpo avanza por pasos chicos con
// fórmulas cerradas. Sangra según la presión y coagula; pierde agua y quema glucógeno, después
// grasa, después músculo; se cansa y debe sueño; cada herida pasa por sus etapas con la infección
// creciendo contra lo que el cuerpo limpia, y la infección que se descontrola pasa a la sangre.
// No tira nada: lo único al azar de una herida (cuán virulento es lo que entró) se tiró al
// herirse. Devuelve lo que pasó (se infectó, cerró, cayó, murió) con sus causas.
//
// Calibración (body-health, Decisiones 2026-10-05): perder 15% de sangre no se nota, 30% da
// palidez y sed, 40% confusión y caída, 50% mata; una herida grave sin tratar mata a ~1 de cada 3
// (sobre todo por infección); una leve y limpia casi nunca. Los tests lo comprueban.

import { type AgentId, type CauseRef, exp, type Tick } from "../../core/index.ts";
import type { BodyPlanDef } from "./plan.ts";
import {
  type Activity,
  type Body,
  bloodVolume,
  type DeathCause,
  type Scar,
  type Wound,
  type WoundStage,
} from "./state.ts";

/** Multiplicadores de cada actividad: gasto de energía, pérdida de agua y fatiga por hora. */
export const ACTIVITY_LOAD: Readonly<
  Record<Activity, { readonly kcal: number; readonly water: number; readonly fatigue: number }>
> = {
  sleep: { kcal: 0.9, water: 0.8, fatigue: -0.2 },
  rest: { kcal: 1.2, water: 1, fatigue: -0.1 },
  light: { kcal: 1.7, water: 1.3, fatigue: 0.03 },
  moderate: { kcal: 2.4, water: 1.8, fatigue: 0.08 },
  heavy: { kcal: 3.4, water: 2.8, fatigue: 0.15 },
};

/** Fracción de sangre que mata, que tumba y que marea. */
export const BLOOD_DEATH = 0.5;
export const BLOOD_FAINT = 0.6;
export const BLOOD_DAZED = 0.7;
/** Lo que se repone de sangre por hora, comido y con agua (≈10% por día). */
const BLOOD_REGEN = 0.004;
/** Horas que tarda en bajar a 1/e el sangrado de una herida que coagula sola. */
const CLOT_TAU = { venous: 0.5, arterial: 6, internal: 3 };
/** Cuánto deja pasar una venda o un torniquete. */
const BANDAGE_PASS = 0.25;
/** Lo que el cuerpo limpia de infección por hora, con las defensas enteras. */
export const CLEARANCE = 0.1;
/** Arriba de esto la herida está infectada; abajo de `INFECTION_SETTLED` dejó de estarlo. */
export const INFECTED = 0.25;
const INFECTION_SETTLED = 0.05;
/** Cuánto pasa a la sangre por hora de lo que la herida tiene arriba de `SEPSIS_FLOOR`. */
const SEPSIS_IN = 0.018;
const SEPSIS_FLOOR = 0.15;
const SEPSIS_OUT = 0.004;
/** Lo que recupera el músculo por hora comiendo (y lo que cuesta en kcal, por fracción). */
const MUSCLE_REGEN = 0.003;
/** Gravedad desde la que una herida deja cicatriz. */
export const SCAR_SEVERITY = 0.3;
/** Horas que una herida sigue fresca. */
const FRESH_HOURS = 2;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export type Happening =
  | { readonly kind: "infected" | "healed"; readonly at: Tick; readonly wound: Wound }
  | { readonly kind: "collapsed" | "came_to"; readonly at: Tick; readonly causes: CauseRef[] }
  | {
      readonly kind: "died";
      readonly at: Tick;
      readonly cause: DeathCause;
      readonly causes: CauseRef[];
    };

/** Las defensas, 0-1: bajan con hambre, cansancio y sueño debido; no con la infección misma. */
export function immunity(body: Body): number {
  const fed = body.glycogen > 0 || body.fat > 0 ? 1 : 0.5;
  const sleep = body.sleepDebt > 24 ? 0.8 : 1;
  return fed * sleep * (1 - 0.3 * body.fatigue) * (0.6 + 0.4 * body.muscle);
}

/** Cuán favorable es la herida para lo que entró: la profunda más que la superficial. */
const depth = (w: Wound) => 0.3 + w.severity;

/**
 * La carga de infección después de `h` horas: dI/dt = v·I·(1 − I) − c·I en forma cerrada, así un
 * paso largo da lo mismo que muchos cortos y es monótona en la carga inicial.
 */
export function infectionAfter(i0: number, v: number, c: number, h: number): number {
  if (i0 <= 0) return 0;
  const r = v - c;
  if (Math.abs(r) < 1e-12) return i0 / (1 + v * i0 * h);
  const e = exp(r * h);
  return clamp((r * i0 * e) / (r + v * i0 * (e - 1)), 0, 1);
}

/** Días que tarda en cerrar una herida limpia, con el cuerpo bien. */
export function healingDays(w: Wound): number {
  return 2 + 20 * w.severity + (w.fracture ? (w.splinted ? 25 : 45) : 0);
}

function deathCauses(body: Body, entity: AgentId, cause: DeathCause): CauseRef[] {
  const ev = (ws: readonly Wound[]): CauseRef[] => {
    const out: CauseRef[] = [];
    for (const w of ws) {
      if (!out.some((c) => c.kind === "event" && c.event === w.cause)) {
        out.push({ kind: "event", event: w.cause });
      }
    }
    return out;
  };
  const open = body.wounds.filter((w) => w.stage !== "healed");
  switch (cause) {
    case "exsanguination": {
      const bleeding = open.filter((w) => w.bleeding > 0 || w.internal > 0);
      return ev(bleeding.length > 0 ? bleeding : open);
    }
    case "sepsis": {
      const infected = open.filter((w) => w.infection >= SEPSIS_FLOOR);
      return ev(infected.length > 0 ? infected : open);
    }
    case "brain_trauma":
      return ev(open.filter((w) => w.zone === "head"));
    case "dehydration":
      return [{ kind: "state", entity, key: "body.water" }];
    case "starvation":
      return [{ kind: "state", entity, key: "body.food" }];
  }
}

function consciousnessOf(plan: BodyPlanDef, body: Body, at: Tick): Body["consciousness"] {
  const lethalWater = plan.physiology.lethalDehydration * body.massKg;
  if (body.stunnedUntil !== null && at < body.stunnedUntil) return "unconscious";
  if (body.blood <= BLOOD_FAINT || body.water >= 0.85 * lethalWater || body.sepsis >= 0.85) {
    return "unconscious";
  }
  if (
    body.blood <= BLOOD_DAZED ||
    body.water >= 0.6 * lethalWater ||
    body.sepsis >= 0.5 ||
    body.sleepDebt >= 40 ||
    body.muscle <= 0.15
  ) {
    return "dazed";
  }
  return "alert";
}

function deathOf(plan: BodyPlanDef, body: Body): DeathCause | null {
  if (body.blood <= BLOOD_DEATH) return "exsanguination";
  if (body.sepsis >= 1) return "sepsis";
  if (body.water >= plan.physiology.lethalDehydration * body.massKg) return "dehydration";
  if (body.muscle <= 0) return "starvation";
  return null;
}

/** Un paso de `h` horas que termina en `at`. */
function step(
  plan: BodyPlanDef,
  body: Body,
  h: number,
  at: Tick,
  out: Happening[],
  ambientC: number,
): Body {
  const ph = plan.physiology;
  const load = ACTIVITY_LOAD[body.activity];
  const scale = body.massKg / ph.refMassKg;
  const immune = immunity(body);

  // Sangre: lo que sale depende de la presión, que cae con lo perdido.
  const pressure = clamp((body.blood - 0.3) / 0.7, 0, 1);
  let lost = 0;
  let fever = 0;
  let sepsisIn = 0;
  const wounds: Wound[] = [];
  const scars: Scar[] = [...body.scars];
  for (const w0 of body.wounds) {
    if (w0.stage === "healed") {
      wounds.push(w0);
      continue;
    }
    const pass = w0.bandaged ? BANDAGE_PASS : 1;
    const tau = (w0.arterial ? CLOT_TAU.arterial : CLOT_TAU.venous) * (w0.bandaged ? 0.5 : 1);
    // Lo perdido en el paso: la integral del sangrado que decae, a la presión de ahora.
    const outFlow = w0.bleeding * pass * tau * (1 - exp(-h / tau));
    const inFlow = w0.internal * CLOT_TAU.internal * (1 - exp(-h / CLOT_TAU.internal));
    lost += pressure * (outFlow + inFlow);
    const bleeding = w0.bleeding * exp(-h / tau);
    const internal = w0.internal * exp(-h / CLOT_TAU.internal);

    // Infección contra defensas; la que se descontrola pasa a la sangre y da fiebre.
    const growth = w0.virulence * depth(w0) * (1 - w0.repair);
    const infection = infectionAfter(w0.infection, growth, CLEARANCE * immune, h);
    const mean = (w0.infection + infection) / 2;
    fever = Math.max(fever, mean);
    sepsisIn += SEPSIS_IN * Math.max(0, mean - SEPSIS_FLOOR) * (0.5 + w0.severity);

    // Cierra más lento con infección, hambre o esfuerzo; con mucha infección no cierra.
    const fed = body.glycogen > 0 || body.fat > 0 ? 1 : 0.3;
    const effort = body.activity === "moderate" || body.activity === "heavy" ? 0.7 : 1;
    const days = healingDays(w0);
    const repair = clamp(
      w0.repair + (h / (24 * days)) * Math.max(0, 1 - 3 * mean) * fed * effort,
      0,
      1,
    );

    let stage: WoundStage = w0.stage;
    if (repair >= 1) stage = "healed";
    else if (infection >= INFECTED || (stage === "infected" && infection >= INFECTION_SETTLED)) {
      stage = "infected";
    } else if ((at - w0.at) / 3600 < FRESH_HOURS) stage = "fresh";
    else stage = repair >= 0.3 ? "healing" : "inflamed";

    const w: Wound =
      stage === "healed"
        ? { ...w0, stage, repair: 1, bleeding: 0, internal: 0, infection: 0 }
        : {
            ...w0,
            stage,
            repair,
            bleeding: bleeding < 0.002 ? 0 : bleeding,
            internal: internal < 0.002 ? 0 : internal,
            infection,
          };
    if (stage === "infected" && w0.stage !== "infected")
      out.push({ kind: "infected", at, wound: w });
    if (stage === "healed") {
      out.push({ kind: "healed", at, wound: w });
      // Lo que llegó al músculo deja marca (body-health §4, secuelas).
      if (w.severity >= SCAR_SEVERITY) {
        scars.push({ zone: w.zone, kind: w.kind, severity: w.severity, at, cause: w.cause });
      }
    }
    wounds.push(w);
  }

  // Agua y energía: la fiebre las gasta más rápido. El agua va a la medida de la masa (un bebé
  // de 4 kg no pierde los 2,4 L del adulto: se moría de sed en una noche).
  // El calor da sed y el frío da hambre (weather §5; con ropa de aldea, sin abrigo especial).
  const heat = 1 + HEAT_WATER * Math.max(0, ambientC - COMFORT_HIGH_C);
  const chill = 1 + COLD_KCAL * Math.max(0, COMFORT_LOW_C - ambientC);
  const water =
    body.water +
    (ph.waterPerDay / 24) *
      (body.massKg / ph.refMassKg) *
      load.water *
      h *
      (1 + 0.5 * fever) *
      heat;
  let need = (ph.kcalPerKgDay / 24) * body.massKg * load.kcal * h * (1 + 0.2 * fever) * chill;
  let glycogen = body.glycogen;
  let fat = body.fat;
  let muscle = body.muscle;
  const fromGlycogen = Math.min(glycogen, need);
  glycogen -= fromGlycogen;
  need -= fromGlycogen;
  const fromFat = Math.min(fat, need);
  fat -= fromFat;
  need -= fromFat;
  const muscleKcal = ph.muscleKcal * scale;
  if (need > 0) muscle = Math.max(0, muscle - need / muscleKcal);
  else if (muscle < 1 && glycogen > 0) {
    // Comido, el músculo perdido vuelve, y cuesta lo que cuesta.
    const gain = Math.min(1 - muscle, MUSCLE_REGEN * h, glycogen / muscleKcal);
    muscle += gain;
    glycogen -= gain * muscleKcal;
  }

  const fed = glycogen > 0 || fat > 0;
  let blood = body.blood - lost / bloodVolume(plan, body);
  if (blood < 1 && fed && water < 0.05 * body.massKg) blood = Math.min(1, blood + BLOOD_REGEN * h);

  const rate = load.fatigue;
  const fatigue = clamp(
    body.fatigue + rate * h * (rate > 0 ? (body.glycogen > 0 ? 1 : 1.5) : fed ? 1 : 0.5),
    0,
    1,
  );
  const sleepDebt =
    body.activity === "sleep" ? Math.max(0, body.sleepDebt - (2 / 3) * h) : body.sleepDebt + h / 3;
  const sepsis = clamp(body.sepsis + (sepsisIn - SEPSIS_OUT * immune * body.sepsis) * h, 0, 1);

  return {
    ...body,
    blood,
    water,
    glycogen,
    fat,
    muscle,
    fatigue,
    sleepDebt,
    sepsis,
    wounds,
    scars,
    updatedAt: at,
  };
}

/** Cuán largo puede ser un paso: corto mientras sangra, más largo con heridas abiertas. */
function stepSeconds(body: Body): number {
  if (body.wounds.some((w) => w.bleeding > 0 || w.internal > 0)) return 300;
  if (body.wounds.some((w) => w.stage !== "healed") || body.sepsis > 0) return 1800;
  return 3600;
}

/** Temperatura que siente el cuerpo (°C) a un tick: afuera con el tiempo del día, adentro amortiguada. */
export type AmbientTemp = (at: Tick) => number;
const COMFORT_LOW_C = 10;
const COMFORT_HIGH_C = 24;
const COMFORTABLE: AmbientTemp = () => 18;
/** Más agua por hora por cada grado sobre el confort (calibración abierta, Hito 1c). */
const HEAT_WATER = 0.03;
/** Más energía por hora por cada grado bajo el confort. */
const COLD_KCAL = 0.015;

/**
 * Lleva el cuerpo hasta `to`. Si muere en el camino se detiene ahí, con la causa fisiológica y la
 * cadena (las heridas que lo causaron, o el estado si fue hambre o sed).
 */
export function advanceBody(
  plan: BodyPlanDef,
  entity: AgentId,
  body: Body,
  to: Tick,
  ambient: AmbientTemp = COMFORTABLE,
): { body: Body; happenings: Happening[] } {
  const happenings: Happening[] = [];
  let b = body;
  while (b.death === null && b.updatedAt < to) {
    const at = Math.min(to, b.updatedAt + stepSeconds(b));
    b = step(plan, b, (at - b.updatedAt) / 3600, at, happenings, ambient(at));
    const consciousness = consciousnessOf(plan, b, at);
    if (consciousness !== b.consciousness) {
      const why = collapseCauses(plan, entity, b);
      if (consciousness === "unconscious") happenings.push({ kind: "collapsed", at, causes: why });
      else if (b.consciousness === "unconscious")
        happenings.push({ kind: "came_to", at, causes: why });
      b = {
        ...b,
        consciousness,
        stunnedUntil: consciousness === "unconscious" ? b.stunnedUntil : null,
      };
    }
    const cause = deathOf(plan, b);
    if (cause) {
      happenings.push({ kind: "died", at, cause, causes: deathCauses(b, entity, cause) });
      b = { ...b, death: { cause, at }, consciousness: "unconscious" };
    }
  }
  return { body: b, happenings };
}

/** Por qué cayó (o se levantó): lo más grave de lo que tiene ahora. */
function collapseCauses(plan: BodyPlanDef, entity: AgentId, body: Body): CauseRef[] {
  if (body.blood <= BLOOD_DAZED) return deathCauses(body, entity, "exsanguination");
  if (body.sepsis >= 0.5) return deathCauses(body, entity, "sepsis");
  if (body.water >= 0.6 * plan.physiology.lethalDehydration * body.massKg) {
    return deathCauses(body, entity, "dehydration");
  }
  if (body.stunnedUntil !== null) return deathCauses(body, entity, "brain_trauma");
  return [{ kind: "state", entity, key: "body" }];
}

/** Come y bebe: llena el glucógeno, lo que sobra va a grasa; el agua de más se orina. */
export function ingest(plan: BodyPlanDef, body: Body, kcal: number, waterL: number): Body {
  if (kcal < 0 || waterL < 0) throw new RangeError("no se come en negativo");
  const cap = plan.physiology.glycogenKcal * (body.massKg / plan.physiology.refMassKg);
  const toGlycogen = Math.min(kcal, Math.max(0, cap - body.glycogen));
  return {
    ...body,
    glycogen: body.glycogen + toGlycogen,
    fat: body.fat + 0.9 * (kcal - toGlycogen),
    water: Math.max(0, body.water - waterL),
  };
}

/** Lo que sigue haciendo el cuerpo (la acción en curso lo pone). */
export function setActivity(body: Body, activity: Activity): Body {
  return body.activity === activity ? body : { ...body, activity };
}
