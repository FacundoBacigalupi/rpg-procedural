// Sucesión ecológica y fuego (living-world §9) para un parche (una etapa): la vegetación avanza por
// etapas, cada disturbio la devuelve a una anterior, el combustible sube cada año sin fuego y el riesgo
// de incendio crece con él, la sequía y la chispa. Puro: el hazard sale como número, el RNG elige afuera.

export type SuccessionStage =
  | "bare"
  | "pioneer"
  | "grass_shrub"
  | "young_forest"
  | "mature_forest"
  | "old_growth";

const ORDER: readonly SuccessionStage[] = [
  "bare",
  "pioneer",
  "grass_shrub",
  "young_forest",
  "mature_forest",
  "old_growth",
];

export interface Trajectory {
  readonly id: string;
  /** Etapa final del bioma: la estepa se queda en pastizal, el clima húmedo llega a bosque viejo. */
  readonly climax: SuccessionStage;
  /** Años que dura cada etapa en condiciones medias (la de `bare` es la espera de que se forme suelo). */
  readonly years: Readonly<Record<SuccessionStage, number>>;
}

export type DisturbanceKind =
  | "fire"
  | "felling"
  | "plough"
  | "grazing"
  | "flood"
  | "ash"
  | "storm"
  | "pest";

export interface PatchVegetation {
  readonly stage: SuccessionStage;
  /** Años en la etapa actual (la edad de la vegetación: datación por árboles sobre una ruina). */
  readonly stageAge: number;
  /** Combustible 0-1 acumulado: hojarasca, madera muerta, pasto seco. */
  readonly fuel: number;
  readonly trajectory: Trajectory;
}

export interface SuccessionConditions {
  /** Multiplicador de velocidad por clima y suelo (1 = medio, 0.3 = frío y pobre). */
  readonly vigor: number;
  /** Semillas cerca: 1 con bosque vecino, ~0.2 en una ladera entera sin bosque cerca. */
  readonly seedSource: number;
  /** Hay suelo formado (secundaria) o es roca desnuda (primaria, espera siglos). */
  readonly soilDepth: number;
}

/** Años de combustible que llenan el parche sin fuego ni pastoreo. */
export const FUEL_FILL_YEARS = 40;

function rank(s: SuccessionStage): number {
  return ORDER.indexOf(s);
}

/** Avanza `years` años: pasa de etapa cuando cumple los años (alargados por poco vigor o pocas semillas). */
export function advanceSuccession(
  p: PatchVegetation,
  c: SuccessionConditions,
  years: number,
): PatchVegetation {
  let stage = p.stage;
  let age = p.stageAge + Math.max(0, years);
  const climax = rank(p.trajectory.climax);
  for (;;) {
    if (rank(stage) >= climax) break;
    // Sobre roca desnuda sin suelo la sucesión espera a que el suelo se forme.
    if (stage === "bare" && c.soilDepth <= 0) break;
    const seed = stage === "bare" || stage === "pioneer" ? 1 : Math.max(0.1, c.seedSource);
    const need = p.trajectory.years[stage] / Math.max(0.05, c.vigor * seed);
    if (age < need) break;
    age -= need;
    stage = ORDER[rank(stage) + 1] as SuccessionStage;
  }
  if (rank(stage) >= climax) age = Math.max(age, 0);
  const fuel = Math.min(1, p.fuel + years / FUEL_FILL_YEARS);
  return { ...p, stage, stageAge: age, fuel };
}

/** A qué etapa vuelve cada disturbio y cuánto combustible deja (en proporción de lo que había). */
const DISTURBANCE: Readonly<Record<DisturbanceKind, { drop: number; fuelKept: number }>> = {
  fire: { drop: 2, fuelKept: 0.05 },
  felling: { drop: 3, fuelKept: 0.5 },
  plough: { drop: 5, fuelKept: 0 },
  grazing: { drop: 0, fuelKept: 0.7 },
  flood: { drop: 2, fuelKept: 0.3 },
  ash: { drop: 4, fuelKept: 0.1 },
  storm: { drop: 1, fuelKept: 1.4 },
  pest: { drop: 1, fuelKept: 1.3 },
};

/** Un disturbio resetea parte de la vegetación a una etapa anterior; el evento que lo registra lo emite quien llama. */
export function disturb(p: PatchVegetation, kind: DisturbanceKind): PatchVegetation {
  const d = DISTURBANCE[kind];
  const stage = ORDER[Math.max(0, rank(p.stage) - d.drop)] as SuccessionStage;
  return {
    ...p,
    stage,
    stageAge: stage === p.stage ? p.stageAge : 0,
    fuel: Math.min(1, p.fuel * d.fuelKept),
  };
}

/**
 * Hazard de incendio por día: crece con el combustible (de forma convexa: un bosque sin fuego en un siglo
 * arde entero, uno que se quema seguido arde poco), con la sequía y con la chispa (rayo, quema, campamento).
 * `spark` en eventos esperados por día en el parche; `dryness` 0-1.
 */
export function fireHazard(p: PatchVegetation, dryness: number, spark: number): number {
  const stageFuel = p.stage === "bare" ? 0 : p.stage === "pioneer" ? 0.4 : 1;
  const dry = Math.min(1, Math.max(0, dryness));
  const load = p.fuel * p.fuel * stageFuel;
  return Math.min(1, Math.max(0, spark) * load * dry * dry);
}

/** Cobertura de combustible que baja con quemas chicas o pastoreo: menos fuego grande después. */
export function burnOff(
  p: PatchVegetation,
  kind: "controlled" | "grazing",
  share: number,
): PatchVegetation {
  const keep = kind === "controlled" ? 1 - 0.8 * share : 1 - 0.3 * share;
  return { ...p, fuel: Math.max(0, p.fuel * keep) };
}

/** Un campo abandonado: la sucesión secundaria arranca en pastizal con el suelo que quedó. */
export function abandonedField(trajectory: Trajectory): PatchVegetation {
  return { stage: "pioneer", stageAge: 0, fuel: 0.05, trajectory };
}

/** Edad mínima del abandono que dice la etapa (años desde el campo): la edad del bosque sobre una ruina. */
export function minAgeSinceAbandonment(p: PatchVegetation): number {
  let total = p.stageAge;
  for (let i = 1; i < rank(p.stage); i++) total += p.trajectory.years[ORDER[i] as SuccessionStage];
  return total;
}

/** Fracción de la superficie que da qi de madera: solo el bosque viejo cuenta como fuente (planet-gen §5). */
export function woodQiShare(p: PatchVegetation): number {
  return p.stage === "old_growth" ? 1 : p.stage === "mature_forest" ? 0.25 : 0;
}
