// Perfil opt-in para medir los sistemas ya cableados (player-loop §1, simulation §7).
import type { LifeOptions } from "./create.ts";

/**
 * Opciones independientes del seed y serializables. Desde `life-3` es lo que la CLI/web guardan en `setup.life` de una vida nueva (`--profile basic` las omite); no cambia los defaults de `Life.create`.
 * Todos los flags de estado pueden cambiar hashes: guardar este objeto en `setup.life`.
 * `births` aumenta población, tablas y log; metas, rumores y viajes retienen más estado.
 * `sleepers` reduce llamadas, pero su catch-up no corporal todavía no está completo.
 * Estable en perfil2d (3 seeds x 2 años, 0 problemas); sin jugador real medido (perfil5).
 *
 * Exclusiones: birth/playerAge/tastes/frequency son elecciones de partida, runProbe es
 * instrumentación; loanSeeds/enforcement/usury/interestNorm y pawn necesitan entidades,
 * garantías o proveedores propios del escenario. consumables y sus opciones de ansia
 * requieren definiciones físicas de sustancias (todavía no hay catálogo de contenido),
 * por lo que el perfil no inventa drogas ni dosis. viewCues necesita callbacks y
 * residue necesita una fuente real de Essence para tener efecto. Las variantes con
 * callbacks/Map de waterSources/loanBondage no entran al JSON.
 * loanBondage/contagion/workout quedan configurados, pero sin `loanSeeds` no se
 * crean préstamos de cosecha: medir el perfil no certifica cobertura de esos casos.
 * Por lo mismo contagio/exposición/medicina/workout/sustancias/nutrición dan 0 llamadas
 * efectivas aquí (sin deuda sembrada, portador, sanador, dosis ni comida registrada): el
 * escenario `full-profile-focus` (tools/sim/full-profile-focus.ts) los siembra con seed fijo.
 */
export const FULL_PROFILE = {
  famine: { staple: "grain" },
  migration: { staple: "grain" },
  rumorGrievance: true,
  persistGoalLayers: true,
  debtKnowledge: true,
  persistImmediateGoals: true,
  closeGoalsOnDeath: true,
  recognizeGoalCompletion: true,
  recognizeGoalProgress: true,
  meaningPressure: true,
  craftGoals: true,
  scam: true,
  relationDecay: true,
  waterSources: { open: "river", netDrink: true, rainFromWeather: true },
  loanBondage: { wagePerDay: 2, upkeepPerDay: 1, maxDays: 180, ransom: true, skillWage: true },
  loanBondageAbuse: { reputationCost: 0.1 },
  swapMaterials: true,
  moldHintsFromCatalog: true,
  tradeView: { misread: { chance: 0.1 }, people: true },
  marks: true,
  marksExpose: true,
  marksGossip: true,
  marksReach: true,
  loanContagion: "coin:copper",
  loanContagionEffects: { rateMarkup: 0.05 },
  loanWorkout: true,
  hire: { unit: "coin:copper", baseWage: 2 },
  healthCulture: true,
  cravingCues: true,
  cueLocal: true,
  npcMove: true,
  idlePlayerRoutine: true,
  sleepers: { near: 0, food: "grain" },
  npcVerbs: ["gather", "trade", "give", "speak", "take", "move", "work"],
  npcTemplates: { work: "fieldwork" },
  npcJourneyDays: 30,
  npcTransit: true,
  npcProvisions: { good: "grain", grams: 3000 },
  npcWater: { liters: 2 },
  npcInterrupt: true,
  npcEncounters: true,
  npcNightRest: true,
  npcPace: "careful",
  npcFootwear: true,
  npcFootSores: true,
  npcFootwearMend: true,
  npcCloak: true,
  npcCloakMend: true,
  npcForecast: true,
  npcRainForecast: true,
  npcFieldWatering: true,
  npcFieldSowing: true,
  npcFieldShared: true,
  npcSowSeed: true,
  npcStrain: true,
  conception: true,
  births: true,
  speakActs: { minFamiliarity: 0.3, quietSeconds: 86400, weight: 0.4, chance: 0.9 },
  takeBelieved: { minConfidence: 0.5, perDeed: 0.1, maxPenalty: 0.8 },
  // Sin consumibles nadie decide `move`: sin recados no hay viajes de NPC ni lejanos que dormir.
  errands: { kinds: ["fields", "forest", "water"], chance: 0.15, weight: 0.5, minAgeYears: 10 },
} satisfies LifeOptions;

export interface LifeDependencyIssue {
  readonly option: keyof LifeOptions;
  readonly requires: string;
  readonly message: string;
}

/** Dependencias de cableado; no comprueba contenido, saldos ni estabilidad del escenario. */
export function validateLifeDependencies(options: LifeOptions): readonly LifeDependencyIssue[] {
  const issues: LifeDependencyIssue[] = [];
  const enabled = (key: keyof LifeOptions): boolean => {
    const value = options[key];
    return value !== undefined && value !== false && (!Array.isArray(value) || value.length > 0);
  };
  const require = (option: keyof LifeOptions, dependency: keyof LifeOptions) => {
    if (enabled(option) && !enabled(dependency)) {
      issues.push({ option, requires: dependency, message: `${option} requiere ${dependency}` });
    }
  };
  const dependencies: readonly (readonly [keyof LifeOptions, keyof LifeOptions])[] = [
    ["births", "conception"],
    ["conceptionRateScale", "conception"],
    ["conceptionGestationDays", "conception"],
    ["scamFiller", "scam"],
    ["loanBondageAbuse", "loanBondage"],
    ["loanContagionEffects", "loanContagion"],
    ["loanWorkout", "loanContagion"],
    ["marksExpose", "marks"],
    ["marksExpose", "scam"],
    ["marksGossip", "marksExpose"],
    ["marksGossip", "marks"],
    ["marksReach", "marksGossip"],
    ["recognizeGoalProgress", "debtKnowledge"],
    ["tradeNeeds", "moldHintsFromCatalog"],
    ["takeBelieved", "moldHintsFromCatalog"],
    ["buyCraving", "consumables"],
    ["gatherCraving", "consumables"],
    ["borrowCraving", "consumables"],
    ["borrowCraving", "moldHintsFromCatalog"],
    ["lendBorrowed", "borrowCraving"],
    ["repayDoses", "consumables"],
    ["cueLocal", "cravingCues"],
    ["objectCues", "cravingCues"],
    ["objectCues", "cueLocal"],
    ["objectCues", "consumables"],
    ["viewCues", "objectCues"],
    ["npcTemplates", "npcVerbs"],
    ["npcJourneyDays", "npcVerbs"],
    ["npcInterrupt", "npcVerbs"],
    ["npcTransit", "npcJourneyDays"],
    ["npcProvisions", "npcJourneyDays"],
    ["npcWater", "npcJourneyDays"],
    ["npcEncounters", "npcJourneyDays"],
    ["npcNightRest", "npcJourneyDays"],
    ["npcPace", "npcJourneyDays"],
    ["npcFootSores", "npcFootwear"],
    ["npcFootwearMend", "npcFootwear"],
    ["npcCloak", "npcJourneyDays"],
    ["npcCloakMend", "npcCloak"],
    ["npcForecast", "npcCloak"],
    ["npcRainForecast", "npcForecast"],
    ["npcFieldWatering", "npcRainForecast"],
    ["npcFieldSowing", "npcFieldWatering"],
    ["npcFieldShared", "npcFieldWatering"],
    ["npcSowSeed", "npcFieldSowing"],
    ["npcStrain", "npcPace"],
  ];
  for (const [option, dependency] of dependencies) require(option, dependency);
  // Las capas largas están encendidas por default en life-2; omitirlas no es apagarlas.
  if (options.craftGoals && options.persistGoalLayers === false) {
    issues.push({
      option: "craftGoals",
      requires: "persistGoalLayers",
      message: "craftGoals requiere persistGoalLayers",
    });
  }
  if (enabled("npcJourneyDays") && !options.npcVerbs?.includes("move")) {
    issues.push({
      option: "npcJourneyDays",
      requires: "npcVerbs.move",
      message: "npcJourneyDays requiere move en npcVerbs",
    });
  }
  for (const verb of Object.keys(options.npcTemplates ?? {}).sort()) {
    if (!options.npcVerbs?.includes(verb)) {
      issues.push({
        option: "npcTemplates",
        requires: `npcVerbs.${verb}`,
        message: `la plantilla de ${verb} requiere ese verbo en npcVerbs`,
      });
    }
  }
  if (options.pawn?.want && !options.pawn.open) {
    issues.push({ option: "pawn", requires: "pawn.open", message: "pawn.want requiere pawn.open" });
  }
  if (options.pawn?.want && !options.moldHintsFromCatalog) {
    issues.push({
      option: "pawn",
      requires: "moldHintsFromCatalog",
      message: "pawn.want requiere moldHintsFromCatalog",
    });
  }
  return issues;
}

export function assertLifeDependencies(options: LifeOptions): void {
  const issues = validateLifeDependencies(options);
  if (issues.length > 0) throw new Error(issues.map((issue) => issue.message).join("; "));
}
