// Perfil opt-in para medir los sistemas ya cableados (player-loop §1, simulation §7).
import type { LifeOptions } from "./create.ts";

/**
 * Opciones independientes del seed y serializables. Desde `life-3` es lo que la CLI/web guardan en `setup.life` de una vida nueva (`--profile basic` las omite); no cambia los defaults de `Life.create`.
 * Todos los flags de estado pueden cambiar hashes: guardar este objeto en `setup.life`.
 * `births` aumenta población, tablas y log; metas, rumores y viajes retienen más estado.
 * `sleepers` reduce llamadas, pero su catch-up no corporal todavía no está completo.
 * Estable en perfil2d (3 seeds x 2 años, 0 problemas); sin jugador real medido (perfil5).
 * `itemClaims` y `householdTools` entraron en play-refs-objects-source-enable (2 seeds x 1 año: 0
 * problemas, mismo tiempo por año y ninguna métrica del batch movida más de 5 %).
 *
 * Exclusiones: birth/playerAge/tastes/frequency son elecciones de partida, runProbe y runClock son
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
  npcCobbler: true,
  npcCloak: true,
  npcCloakMend: true,
  npcForecast: true,
  npcRainForecast: true,
  npcFieldWatering: true,
  npcFieldSowing: true,
  npcFieldShared: true,
  npcSowSeed: true,
  npcStrain: true,
  npcExhaustion: true,
  conception: true,
  births: true,
  speakActs: { minFamiliarity: 0.3, quietSeconds: 86400, weight: 0.4, chance: 0.9 },
  takeBelieved: { minConfidence: 0.5, perDeed: 0.1, maxPenalty: 0.8 },
  // Cosas con identidad (play-refs-objects-source-enable): las de cada casa y su toma disputada.
  itemClaims: true,
  householdTools: true,
  squareBench: true,
  villageLivestock: true,
  livestockLife: true,
  livestockYield: true,
  livestockSeason: true,
  livestockYieldFeed: true,
  livestockDraft: true,
  livestockDraftCost: true,
  livestockDraftFatigue: true,
  livestockDraftRest: true,
  livestockDraftRestChoice: true,
  livestockDraftRestPress: true,
  livestockDraftRestBelief: true,
  livestockDraftRestNpcLarder: true,
  livestockDraftRestSeason: true,
  livestockSlaughter: true,
  livestockSlaughterRefs: true,
  livestockGift: true,
  livestockSteal: true,
  livestockSell: true,
  livestockSellHousehold: true,
  livestockSellBarter: true,
  livestockTan: true,
  livestockCheese: true,
  npcCobblerLocalLeather: true,
  livestockPredators: true,
  livestockGuard: true,
  livestockPen: true,
  livestockHeir: true,
  livestockTerrain: true,
  livestockSheep: true,
  livestockCow: true,
  livestockShear: true,
  livestockPasture: true,
  livestockDairy: true,
  livestockMilkCurve: true,
  livestockMilkWork: true,
  livestockMilkHours: true,
  livestockMilkAway: true,
  livestockMilkHand: true,
  livestockMilkSelf: true,
  livestockSuckle: true,
  livestockOrphan: true,
  livestockFoster: true,
  livestockFosterHelp: true,
  livestockGestation: true,
  livestockLookSkill: true,
  livestockHeat: true,
  livestockFeed: true,
  villageShrine: true,
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
    ["gradualGrowth", "adultGrowth"],
    ["livestockLife", "villageLivestock"],
    ["livestockYield", "villageLivestock"],
    ["livestockSeason", "livestockYield"],
    ["livestockYieldFeed", "livestockYield"],
    ["livestockDraft", "villageLivestock"],
    ["livestockDraftCost", "livestockDraft"],
    ["livestockDraftCost", "livestockFeed"],
    ["livestockDraftFatigue", "livestockDraft"],
    ["livestockDraftRest", "livestockDraftFatigue"],
    ["livestockDraftRestChoice", "livestockDraftRest"],
    ["livestockDraftRestPress", "livestockDraftRestChoice"],
    ["livestockDraftRestBelief", "livestockDraftRestPress"],
    ["livestockDraftRestNpcLarder", "livestockDraftRestBelief"],
    ["livestockDraftRestSeason", "livestockDraftRestChoice"],
    ["livestockSlaughter", "livestockLife"],
    ["livestockSlaughterRefs", "livestockSlaughter"],
    ["livestockGift", "livestockSlaughter"],
    ["livestockSteal", "livestockSlaughter"],
    ["livestockSell", "livestockSlaughter"],
    ["livestockSellHousehold", "livestockSell"],
    ["livestockSellBarter", "livestockSellHousehold"],
    ["livestockTan", "livestockLife"],
    ["livestockCheese", "livestockDairy"],
    ["livestockCheese", "livestockYield"],
    ["livestockPredators", "villageLivestock"],
    ["livestockGuard", "livestockPredators"],
    ["livestockPen", "livestockPredators"],
    ["livestockHeir", "villageLivestock"],
    ["livestockTerrain", "villageLivestock"],
    ["livestockSheep", "villageLivestock"],
    ["livestockCow", "livestockDairy"],
    ["livestockShear", "livestockSheep"],
    ["livestockShear", "livestockYield"],
    ["livestockPasture", "livestockFeed"],
    ["livestockDairy", "villageLivestock"],
    ["livestockMilkCurve", "livestockDairy"],
    ["livestockMilkCurve", "livestockYield"],
    ["livestockMilkWork", "livestockDairy"],
    ["livestockMilkWork", "livestockLife"],
    ["livestockMilkWork", "livestockYield"],
    ["livestockMilkHours", "livestockMilkWork"],
    ["livestockMilkAway", "livestockMilkHours"],
    ["livestockMilkHand", "livestockMilkWork"],
    ["livestockMilkHand", "livestockSlaughter"],
    ["livestockMilkSelf", "livestockMilkHand"],
    ["livestockMilkSelf", "livestockMilkHours"],
    ["livestockSuckle", "livestockDairy"],
    ["livestockSuckle", "livestockLife"],
    ["livestockSuckle", "livestockYield"],
    ["livestockOrphan", "livestockSuckle"],
    ["livestockOrphan", "livestockFeed"],
    ["livestockFoster", "livestockSuckle"],
    ["livestockFosterHelp", "livestockFoster"],
    ["livestockGestation", "livestockLife"],
    ["livestockLookSkill", "livestockGestation"],
    ["livestockHeat", "livestockGestation"],
    ["livestockFeed", "villageLivestock"],
    ["livestockManure", "livestockFeed"],
    ["livestockManure", "fieldManure"],
    ["nutritionNeeds", "eatenNutrition"],
    ["lendBorrowed", "borrowCraving"],
    ["repayDoses", "consumables"],
    ["cueLocal", "cravingCues"],
    ["objectCues", "cravingCues"],
    ["objectCues", "cueLocal"],
    ["objectCues", "consumables"],
    ["viewCues", "objectCues"],
    ["groundCues", "objectCues"],
    ["npcTemplates", "npcVerbs"],
    ["npcJourneyDays", "npcVerbs"],
    ["npcInterrupt", "npcVerbs"],
    ["npcResumeReevaluate", "npcInterrupt"],
    ["npcTransit", "npcJourneyDays"],
    ["npcProvisions", "npcJourneyDays"],
    ["npcWater", "npcJourneyDays"],
    ["npcEncounters", "npcJourneyDays"],
    ["npcTraces", "npcEncounters"],
    ["npcNightRest", "npcJourneyDays"],
    ["npcPace", "npcJourneyDays"],
    ["npcFootSores", "npcFootwear"],
    ["npcFootwearMend", "npcFootwear"],
    ["npcCobbler", "npcFootwearMend"],
    ["npcCobblerHides", "npcCobbler"],
    ["npcCobblerLocalLeather", "npcCobbler"],
    ["npcRoadMend", "npcFootwearMend"],
    ["npcRoadStops", "npcRoadMend"],
    ["npcRoadStops", "npcNightRest"],
    ["npcRoadCobbler", "npcRoadMend"],
    ["npcRoadCobbler", "npcCobbler"],
    ["npcCloak", "npcJourneyDays"],
    ["npcCloakMend", "npcCloak"],
    ["npcForecast", "npcCloak"],
    ["npcRainForecast", "npcForecast"],
    ["npcFieldWatering", "npcRainForecast"],
    ["npcFieldSowing", "npcFieldWatering"],
    ["npcFieldShared", "npcFieldWatering"],
    ["npcSowSeed", "npcFieldSowing"],
    ["npcStrain", "npcPace"],
    ["npcExhaustion", "npcStrain"],
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
  for (const key of Object.keys(options.npcTemplates ?? {}).sort()) {
    // `move@water`: la plantilla de un verbo según la clase de su objetivo.
    const verb = key.split("@")[0] ?? key;
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

// --- Grupos (novel-flags-groups-core) ---
// El perfil son decenas de flags; para elegir una vida alcanza con pocos interruptores. Cada flag del
// perfil está en exactamente un grupo (lo que no se nombra abajo es de `village`); `cultivation` y
// `tech` quedan fuera del perfil, como antes.

export const LIFE_GROUPS = [
  "village",
  "people",
  "npcs",
  "economy",
  "body",
  "livestock",
  "cultivation",
  "tech",
] as const;
export type LifeGroup = (typeof LIFE_GROUPS)[number];

/** Los grupos que forman el perfil completo. */
export const PROFILE_GROUPS: readonly LifeGroup[] = [
  "village",
  "people",
  "npcs",
  "economy",
  "body",
  "livestock",
];

const PEOPLE_KEYS: readonly (keyof LifeOptions)[] = [
  "rumorGrievance",
  "persistGoalLayers",
  "persistImmediateGoals",
  "closeGoalsOnDeath",
  "recognizeGoalCompletion",
  "recognizeGoalProgress",
  "meaningPressure",
  "craftGoals",
  "relationDecay",
  "speakActs",
  "conception",
  "births",
];
const ECONOMY_KEYS: readonly (keyof LifeOptions)[] = [
  "debtKnowledge",
  "scam",
  "loanBondage",
  "loanBondageAbuse",
  "swapMaterials",
  "moldHintsFromCatalog",
  "tradeView",
  "marks",
  "marksExpose",
  "marksGossip",
  "marksReach",
  "loanContagion",
  "loanContagionEffects",
  "loanWorkout",
  "hire",
  "takeBelieved",
];
const BODY_KEYS: readonly (keyof LifeOptions)[] = [
  "waterSources",
  "healthCulture",
  "cravingCues",
  "cueLocal",
];

/** El grupo de un flag: por lista o por prefijo; lo demás es de la aldea. */
export function lifeGroupOf(key: keyof LifeOptions): LifeGroup {
  if (key === "cultivation" || key === "sectSeatRegion" || key === "playerTrek")
    return "cultivation";
  if (key === "mortalTech") return "tech";
  if (PEOPLE_KEYS.includes(key)) return "people";
  if (ECONOMY_KEYS.includes(key)) return "economy";
  if (BODY_KEYS.includes(key)) return "body";
  if (key.startsWith("livestock") || key === "villageLivestock" || key === "npcCobblerLocalLeather")
    return "livestock";
  if (key.startsWith("npc") || key === "sleepers" || key === "errands") return "npcs";
  return "village";
}

/** Lo que trae cada grupo solo (sin las dependencias de otros grupos). */
export function groupOptions(group: LifeGroup): LifeOptions {
  if (group === "cultivation") return { cultivation: true, sectSeatRegion: true, playerTrek: true };
  if (group === "tech") return { mortalTech: true };
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(structuredClone(FULL_PROFILE))) {
    if (lifeGroupOf(key as keyof LifeOptions) === group) picked[key] = value;
  }
  return picked as LifeOptions;
}

/**
 * Las opciones de una vida con estos grupos, más los que piden sus dependencias de cableado (un flag
 * de un grupo que requiere uno de otro suma ese otro grupo). Devuelve también los grupos que quedaron.
 */
export function lifeGroupOptions(groups: readonly LifeGroup[]): {
  readonly groups: readonly LifeGroup[];
  readonly options: LifeOptions;
} {
  const chosen = new Set<LifeGroup>(groups);
  for (;;) {
    const options = Object.assign(
      {},
      ...LIFE_GROUPS.filter((g) => chosen.has(g)).map(groupOptions),
    ) as LifeOptions;
    const missing = validateLifeDependencies(options)
      .map((issue) => issue.requires)
      .filter((key): key is keyof LifeOptions => key in FULL_PROFILE)
      .map(lifeGroupOf)
      .filter((g) => !chosen.has(g));
    if (missing.length === 0) return { groups: LIFE_GROUPS.filter((g) => chosen.has(g)), options };
    for (const g of missing) chosen.add(g);
  }
}
