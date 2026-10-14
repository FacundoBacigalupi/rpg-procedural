// Arma la vida real (player-loop §1-§2, Fase 1): el planeta, la aldea con su gente de la
// pre-corrida, el personaje que sale de ella, y cada sistema sembrado (cuerpos, habilidades,
// lugares, ubicaciones). Todo sale del seed y del contenido; el mismo seed da la misma vida.

import {
  type AgentId,
  type Content,
  EARTHLIKE_CLOCK,
  type EventId,
  EventLog,
  externalAccount,
  type HolderRef,
  type HouseholdId,
  holderAccount,
  IdAllocator,
  Ledger,
  type LedgerConfig,
  type LedgerUnit,
  ledgerUnit,
  makeId,
  type PlaceRef,
  Rng,
  type Seed,
  type SettlementId,
  type Transfer,
} from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  ADDRESSES,
  assignStatuses,
  BODY_PLANS,
  BUILDING_TYPES,
  type ChosenTaste,
  CONCEPTS,
  COOKED,
  COPPER,
  CULTURE_TRAITS,
  CULTURES,
  type CultureDef,
  DEBRIS_SINK,
  DEMOGRAPHY,
  DIETS,
  DIVINATION_CONCERNS,
  DIVINATION_METHODS,
  DOCTRINES,
  dailyProductivity,
  dayOf,
  EATEN,
  ECOLOGY,
  ENTITY,
  ETIQUETTE,
  FOODS,
  GATHERED_SOURCE,
  GOODS,
  generateLanguage,
  goodUnit,
  HABITS_CONTENT,
  HARVEST,
  HARVEST_GOOD,
  type Household,
  harvestSeason,
  houseKey,
  initialCell,
  LANGUAGES,
  type Language,
  LIFE_STAGES,
  LINEAGES,
  LOCATION,
  type LocalMap,
  liveSettlementSpaces,
  MATERIALS,
  NUTRIENT_PROFILES,
  PARCEL_SOIL,
  PERSON,
  type Person,
  PLACE,
  PLANS,
  type PlaceFeature,
  type PlaceToName,
  PRESSURE_CURVES,
  pickTrajectory,
  RECIPES,
  REGISTERS,
  RELATION_BONDS,
  RELATION_DIMS,
  RELIGIONS,
  ROTTED,
  resolveTastes,
  SCHEMAS,
  SKILLS,
  SkillCatalog,
  SMOKE_SINK,
  SOIL,
  SOIL_START,
  SPEECH_LINES,
  STATUSES,
  type StatusDef,
  seedBodies,
  seedCommunityAccent,
  seedCulture,
  seedMinds,
  seedParcels,
  seedPeopleCulture,
  seedPeopleReligion,
  seedPersonNames,
  seedPlaceNames,
  seedRelations,
  seedReligion,
  seedSettlement,
  seedSkills,
  seedStatus,
  seedTastes,
  seedVillage,
  settlementUnits,
  startingParcel,
  TABOOS,
  TASTES,
  type TasteDef,
  type TasteSpec,
  TENURES,
  type TemperamentSpec,
  TRADE_RECIPES,
  TRAITS,
  TRAJECTORIES,
  type Trait,
  temperamentFit,
  VALUES,
  VILLAGE_SEPARATION,
  type VillagePopulation,
  validateTemperament,
  villagePopulation,
  WAGES_SINK,
  WORK_TYPES,
  WORKSHOP,
  WORKSHOP_WASTE,
  WorldTruth,
} from "../../sim/index.ts";
import {
  BIOMES,
  generatePlanet,
  type LocalTerrain,
  type Planet,
  type PlanetOptions,
  type VillageSite,
  villageSite,
} from "../../worldgen/index.ts";
import type { ConverseForm } from "./converse.ts";
import type { ViewCues } from "./cue-local.ts";
import { ecologyHexes } from "./ecology.ts";
import { checkInventory, INVENTORY_BELIEF } from "./inventory-belief.ts";
import { larderNeeded } from "./larder.ts";
import type { UsuryOptions } from "./loans.ts";
import { localMapOf } from "./map.ts";
import type { HouseholdNeeds } from "./moldgossip.ts";
import type { PawnLots, PawnOpenOptions, PawnWantOptions } from "./pawn.ts";
import { type ResidueConfig, residueExternals } from "./residue.ts";
import { ROUTINE } from "./routine.ts";
import type { SpeakActsOptions } from "./speakacts.ts";
import type { TakeBelievedOptions } from "./takeillicit.ts";
import { TRADE_START_BATCHES, tradeOfHousehold } from "./trades.ts";
import { deriveUsury, eyeByPerception } from "./usuryderive.ts";
import { hexKindsFromTerrain, type WaterSourcesConfig } from "./waterSources.ts";
import { type LifeParts, type LifeWorld, lifeWorld, PLAYER } from "./world.ts";

/** Lo que se pide del personaje en modo novela: se busca entre los nacimientos (game-modes §2.2). */
export interface BirthQuery {
  readonly sex?: "female" | "male";
  readonly position?: "holder" | "common" | "dependent";
  /** Rangos por eje de temperamento: pesan en la búsqueda (paso 1, §2.2), no la cortan. */
  readonly temperament?: TemperamentSpec;
}

export interface LifeOptions {
  /** El personaje pedido (modo novela); sin él, sale de la pre-corrida como en el realista. */
  readonly birth?: BirthQuery;
  /** Menos celdas para los tests (frecuencia de la grilla); por defecto la del planeta real. */
  readonly frequency?: number;
  /** Entre qué edades sale el personaje de la pre-corrida (player-loop §2). */
  readonly playerAge?: { readonly min: number; readonly max: number };
  /** Gustos pedidos del personaje (modo novela): se fijan sobre los que el mundo le generó. */
  readonly tastes?: readonly TasteSpec[];
  /** Opt-in: presión de escasez y su descarga (`life.famine`); apagado por defecto. */
  readonly famine?: LifeParts["famine"];
  /** Opt-in: hogares que deciden irse por la hambruna (`life.migration`); apagado por defecto. */
  readonly migration?: LifeParts["migration"];
  /** Opt-in: el agravio que llega por rumor mueve la relación del tercero; apagado por defecto. */
  readonly rumorGrievance?: boolean;
  /**
   * Solo el replay de un guardado de motor anterior a `life-4` lo enciende: un registro de paso por
   * cada fallo repetido en `PlanState.steps` (desde `life-4` se compactan; cambia el estado y los hashes).
   */
  readonly verboseSteps?: boolean;
  /**
   * Solo el replay de un guardado de motor anterior a `life-5` lo enciende: esperar de noche no
   * duerme (desde `life-5` sí; cambia el cuerpo de quien espera y los hashes).
   */
  readonly waitAwake?: boolean;
  /**
   * Solo el replay de un guardado de motor anterior a `life-6` lo enciende: nadie bebe ni come por
   * quien espera (desde `life-6` la rutina mínima del hogar atiende lo chico durante una espera).
   */
  readonly waitUntended?: boolean;
  /**
   * Solo el replay de un guardado de motor anterior a `life-7` lo enciende: quien espera no lleva
   * odre (desde `life-7` bebe de él lejos del agua y lo llena donde la hay).
   */
  readonly waitNoSkin?: boolean;
  /**
   * Solo el replay de un guardado de motor anterior a `life-8` lo enciende: la deuda de sueño no
   * satura (desde `life-8` los microsueños la frenan en 72 h).
   */
  readonly sleepUncapped?: boolean;
  /**
   * Solo el replay de un guardado de motor anterior a `life-9` lo enciende: todo tropezón del
   * personaje es una caída con la cabeza al peso de un brazo (desde `life-9` solo cae de verdad
   * quien tira bajo el margen parcial, y la cabeza pesa 8 %).
   */
  readonly legacyFalls?: boolean;
  /**
   * Solo el replay de un guardado de motor anterior a `life-10` lo enciende: `tend` trata solo la
   * herida más grave y nunca entablilla (desde `life-10` mira todas y elige vendar, limpiar o entablillar).
   */
  readonly legacyTend?: boolean;
  /**
   * Solo el replay de un guardado de motor anterior a `life-11` lo enciende: el `resume` de un
   * tramo de camino queda encendido y el plan repite el `move` (ver `ActOptions.legacyResume`).
   */
  readonly legacyResume?: boolean;
  /**
   * Solo el replay de un guardado de motor anterior a `life-12` lo enciende: quien espera come
   * únicamente puertas adentro (ver `RoutineOptions.waitEatVillage`).
   */
  readonly waitEatHomeOnly?: boolean;
  /**
   * Solo el replay de un guardado de motor anterior a `life-13` lo enciende: nadie le da de beber al
   * inconsciente (ver `RoutineOptions.careWater`).
   */
  readonly legacyNoCare?: boolean;
  /**
   * Solo el replay de un guardado de motor anterior a `life-14` lo enciende: apaga `npcFootSores` aunque
   * el perfil lo traiga (el perfil completo lo enciende desde `life-14`).
   */
  readonly legacyNoFootSores?: boolean;
  /**
   * Persiste los objetivos largos, medianos y cortos del NPC (`life.goals` y eventos `npc.goal`).
   * Encendido por defecto desde `life-2` (cambia hashes y el replay desde el seed de vidas guardadas
   * con `life-1`: ver `upgradeVersions`); `false` vuelve al comportamiento anterior.
   */
  readonly persistGoalLayers?: boolean;
  /** Opt-in: las partes recuerdan los préstamos y pagos que participan directamente. */
  readonly debtKnowledge?: boolean;
  /** Opt-in: persiste la capa inmediata desde señales con causa; apagado por defecto. */
  readonly persistImmediateGoals?: boolean;
  /** Opt-in: cierra las metas persistidas cuando el NPC muere; apagado por defecto. */
  readonly closeGoalsOnDeath?: boolean;
  /** Opt-in: cierra venganzas cuando el NPC cree muerto al blanco y conserva la causa; apagado. */
  readonly recognizeGoalCompletion?: boolean;
  /** Opt-in: cierra saldar una deuda desde los pagos propios recordados (con `debtKnowledge`); apagado. */
  readonly recognizeGoalProgress?: boolean;
  /** Opt-in: el vacío por venganza cumplida presiona la necesidad lenta `meaning`; apagado. */
  readonly meaningPressure?: boolean;
  /** Opt-in: registro de práctica propio y metas de oficio/estudio (con `persistGoalLayers`); apagado. */
  readonly craftGoals?: boolean;
  /** Opt-in: estafa de calidad en el trato (el vendedor infla por temperamento y necesidad); apagado por defecto. */
  readonly scam?: boolean;
  /** Opt-in bajo `scam`: unidad del relleno que el vendedor mezcla en el lote; apagado por defecto. */
  readonly scamFiller?: LedgerUnit;
  /** Opt-in: fuentes de agua; si no trae `hexKinds`, salen del terreno local (`hexKindsFromTerrain`). */
  readonly waterSources?: WaterSourcesConfig;
  /** Opt-in: la confianza de RELATIONS en los préstamos se lee con decaimiento (`relationDecay`). */
  readonly relationDecay?: boolean;
  /** Opt-in: préstamos de cosecha decididos de antemano (`LifeParts.loanSeeds`); sin semillas no hay préstamos. */
  readonly loanSeeds?: LifeParts["loanSeeds"];
  /** Opt-in: ejecutores de los préstamos (`LifeParts.loanEnforcement`). */
  readonly loanEnforcement?: LifeParts["loanEnforcement"];
  /** Opt-in (con `loanSeeds`): usura disfrazada y caso comunitario (`LifeParts.loanUsury`). */
  readonly loanUsury?: LifeParts["loanUsury"];
  /**
   * Opt-in (con `loanSeeds`): siembra el rasgo `norms.interest` en la cultura de la aldea (con estos pesos por
   * variante) y deriva `loanUsury` de él (`deriveUsury`: prohíbe `forbidden` por firmeza, disfraces por lo que
   * el hogar tiene en el ledger, tasación por la percepción). El rasgo no está en la cultura `village`, así que
   * sin esta opción la siembra (y los hashes) no cambian. Un `loanUsury` explícito manda.
   */
  readonly interestNorm?: {
    readonly variants: Readonly<Record<string, number>>;
    readonly because?: string;
    readonly prohibitedVariants?: readonly string[];
    readonly wagePerDay?: number;
    readonly tolerance?: number;
    /** El caso comunitario que juzga la usura sospechada (`UsuryOptions.communityCase`); sin él solo hay sospecha. */
    readonly communityCase?: NonNullable<UsuryOptions["communityCase"]>;
  };
  /** Opt-in: la mora de los préstamos abre una servidumbre por deudas (`LifeParts.loanBondage`); apagado por defecto. */
  readonly loanBondage?: Omit<NonNullable<LifeParts["loanBondage"]>, "skillWage"> & {
    /** `true`: el jornal sale del mejor oficio del deudor (`skillWageOf`); o una función propia. */
    readonly skillWage?: true | NonNullable<LifeParts["loanBondage"]>["skillWage"];
  };
  /** Opt-in (con `loanBondage`): el acreedor abusa según su temperamento, necesidad y la cultura (`LifeParts.loanBondageAbuse`); apagado por defecto. */
  readonly loanBondageAbuse?: LifeParts["loanBondageAbuse"];
  /** Opt-in: la reconstrucción «distinta» puede cambiar de material; apagado por defecto. */
  readonly swapMaterials?: boolean;
  /** Opt-in: el chisme de moldes mueve la decisión con precios del catálogo (`LifeParts.moldHintsFromCatalog`); apagado por defecto. */
  readonly moldHintsFromCatalog?: boolean;
  /** Opt-in: necesidades del hogar de las que sale `moldHints.tradeWant` (`tradeWantFromNeeds`); apagado por defecto. */
  readonly tradeNeeds?: HouseholdNeeds;
  /** Opt-in: vista de oficios (`TRADE_VIEW`); con `misread`/`people` además cree oficios equivocados / anota personas. Apagado por defecto. */
  readonly tradeView?: LifeParts["tradeView"];
  /** Opt-in: los lotes comerciados llevan la marca del vendedor y el comprador la verifica (`life.marks`). Apagado por defecto. */
  readonly marks?: boolean;
  /** Opt-in (con `marks` y `scam`): la marca falsa descubierta al repasarla dispara `scam.discovered` contra el falsificador. */
  readonly marksExpose?: boolean;
  /** Opt-in (con `marks` y `marksExpose`): rumor `fraud` sobre el falsificador y reparación del marcador copiado. */
  readonly marksGossip?: boolean;
  /** Opt-in (con `marksGossip`): el rumor `fraud` llega también a gente de otros lugares. */
  readonly marksReach?: boolean;
  /** Opt-in: contagio de quiebras sobre los préstamos, en esta unidad de deuda (`life.contagion`). Apagado por defecto. */
  readonly loanContagion?: string;
  /** Opt-in (con `loanContagion`): efectos del contagio (fama del quebrado y tasa más alta de los acreedores arrastrados). */
  readonly loanContagionEffects?: LifeParts["loanContagionEffects"];
  /** Opt-in (con `loanContagion`): el acreedor del hogar caído renegocia o ejecuta la garantía (`life.workout`). */
  readonly loanWorkout?: boolean;
  /** Opt-in: casa de empeño (`life.pawn`): el dueño recupera la prenda pagando o el lote pasa a la casa al vencer; apagado por defecto. */
  readonly pawn?: {
    readonly unit: string;
    readonly lots: PawnLots;
    readonly open?: PawnOpenOptions;
    /** Opt-in (con `open` y `moldHints`): el NPC en apuro empeña por decisión (`decide` `pawnWant` + `life.pawn_decide`). */
    readonly want?: PawnWantOptions;
  };
  /** Opt-in: el verbo `hire` se ejecuta (`LifeParts.hire`); apagado por defecto. */
  readonly hire?: LifeParts["hire"];
  /** Opt-in: el fiado por hambre (`life.borrow`) baja el límite según lo que el vecino CREE del apuro del hogar que pide (`LifeParts.creditHeed`); apagado por defecto. */
  readonly creditHeed?: LifeParts["creditHeed"];
  /** Opt-in: la cultura de la aldea suma `beliefs.contagion` y `kinship.head` (los lee `patientDecides.cultureTraits`); apagado por defecto (cambia el hash de la vida). */
  readonly healthCulture?: boolean;
  /** Opt-in: fuentes explícitas de patógenos con portador (`LifeParts.pathogenSeeds`); sin ellas `life.exposure` no tiene foco. */
  readonly pathogenSeeds?: LifeParts["pathogenSeeds"];
  /** Opt-in: sanadores explícitos que diagnostican y tratan (`LifeParts.healers`); sin ellos `life.medicine` no hace nada. */
  readonly healers?: LifeParts["healers"];
  /** Opt-in: dosis explícitas de sustancias (`LifeParts.substanceDoses`). */
  readonly substanceDoses?: LifeParts["substanceDoses"];
  /** Opt-in: lo comido de verdad alimenta las reservas de nutrientes (`LifeParts.eatenNutrition`). */
  readonly eatenNutrition?: boolean;
  /** Opt-in: residuo de lo ingerido con `Essence` (pureza, purga diaria, desviación, sobrecarga) (`LifeParts.residue`); apagado por defecto. */
  readonly residue?: LifeParts["residue"];
  /** Opt-in: sustancias consumibles (`LifeParts.consumables`); los paneles de la sesión leen de acá los bienes de las señales por objeto. */
  readonly consumables?: LifeParts["consumables"];
  /** Opt-in (con `consumables`): el ansia empuja a comprar la sustancia (`LifeParts.buyCraving`). */
  readonly buyCraving?: LifeParts["buyCraving"];
  /** Opt-in (con `consumables`): sin con quién comprar, el ansia empuja a recolectar (`LifeParts.gatherCraving`). */
  readonly gatherCraving?: LifeParts["gatherCraving"];
  /** Opt-in (con `consumables` y `moldHintsFromCatalog`): pedir la sustancia a quien se cree que la tiene (`LifeParts.borrowCraving`). */
  readonly borrowCraving?: LifeParts["borrowCraving"];
  /** Opt-in (con `borrowCraving`): el prestamista decide y pasa una dosis (`LifeParts.lendBorrowed`). */
  readonly lendBorrowed?: boolean;
  /** Opt-in (con `consumables`): devolver la dosis prestada en especie (`LifeParts.repayDoses`). */
  readonly repayDoses?: boolean;
  /** Opt-in: señales de ansia aprendidas (`LifeParts.cravingCues`). */
  readonly cravingCues?: boolean;
  /** Opt-in (con `cravingCues`): las señales leen a quién cree presente y el huso (`LifeParts.cueLocal`). */
  readonly cueLocal?: boolean;
  /** Opt-in (con `cravingCues`, `cueLocal` y `consumables`): señal por objeto (`LifeParts.objectCues`). */
  readonly objectCues?: boolean;
  /** Opt-in: la decisión `move` hacia un lugar se ejecuta en la rutina (`LifeParts.npcMove`); apagado. */
  readonly npcMove?: boolean;
  /** Opt-in: el personaje sin plan sigue la rutina del hogar (`LifeParts.idlePlayerRoutine`); para corridas sin jugador. */
  readonly idlePlayerRoutine?: boolean;
  /** Opt-in: los lejanos y sin vínculo se duermen y se ponen al día por tramos (`LifeParts.sleepers`); apagado. */
  readonly sleepers?: { readonly near: number; readonly food: string };
  /** Solo medición (`LifeParts.runProbe`): no entra al estado ni al hash. */
  readonly runProbe?: (process: string, changes: number, events: number) => void;
  /** Opt-in: verbos de la decisión que el NPC ejecuta como plan (`LifeParts.npcVerbs`); apagado. */
  readonly npcVerbs?: readonly string[];
  /** Opt-in (con `npcVerbs`): verbo -> plantilla de `content/plans/` (`LifeParts.npcTemplates`), p. ej. `work` -> `fieldwork`. */
  readonly npcTemplates?: Readonly<Record<string, string>>;
  /** Opt-in (con `npcVerbs` con `move`): el viaje del NPC sigue hasta N días (`LifeParts.npcJourneyDays`). */
  readonly npcJourneyDays?: number;
  /** Opt-in (con `npcJourneyDays`): el NPC en viaje pasa por los hexes del camino (`LifeParts.npcTransit`). */
  readonly npcTransit?: boolean;
  /** Opt-in (con `npcJourneyDays`): el viajero lleva provisiones de la despensa y come en el camino (`LifeParts.npcProvisions`). */
  readonly npcProvisions?: LifeParts["npcProvisions"];
  /** Opt-in (con `npcJourneyDays`): el viajero sale con un odre y bebe en el camino cuando siente sed (`LifeParts.npcWater`). */
  readonly npcWater?: LifeParts["npcWater"];
  /** Opt-in (con `npcVerbs`): un signo grave nuevo del cuerpo corta el plan del NPC y deja el resultado parcial (`LifeParts.npcInterrupt`). */
  readonly npcInterrupt?: boolean;
  /** Opt-in (con `npcJourneyDays`): el viajero se cruza con quien comparte su hex (`LifeParts.npcEncounters`). */
  readonly npcEncounters?: boolean;
  /** Opt-in (con `npcJourneyDays`): de noche el viajero para y duerme (`LifeParts.npcNightRest`). */
  readonly npcNightRest?: boolean;
  /** Opt-in (con `npcJourneyDays`): el ritmo del viaje del NPC (`LifeParts.npcPace`). */
  readonly npcPace?: "careful" | "fast";
  /** Opt-in: el calzado de quien camina se gasta con la marcha y gastado cuesta más caminar (`LifeParts.npcFootwear`); apagado. */
  readonly npcFootwear?: boolean;
  /** Opt-in (con `npcFootwear`): el calzado destrozado abre llagas en la pierna al caminar (`LifeParts.npcFootSores`); apagado. */
  readonly npcFootSores?: boolean;
  /** Opt-in: las casadas concibe con la fecundidad de su edad y el embarazo llega al parto con partera (`LifeParts.conception`); apagado. */
  readonly conception?: boolean;
  /** Con `conception`: multiplica la fecundidad (por defecto 1). */
  readonly conceptionRateScale?: number;
  /** Con `conception`: días de embarazo (por defecto 280). */
  readonly conceptionGestationDays?: number;
  /** Opt-in (con `conception`): el niño que no murió en el parto nace como persona (`LifeParts.births`); apagado. */
  readonly births?: boolean;
  /** Opt-in: `speak` con acto declarado desde afecto y familiaridad (`LifeParts.speakActs`); apagado. */
  readonly speakActs?: SpeakActsOptions;
  /** Opt-in (con `moldHintsFromCatalog`): `take` sobre bienes que cree que tiene un conocido (`LifeParts.takeBelieved`); apagado. */
  readonly takeBelieved?: TakeBelievedOptions;
  /** Opt-in: candidatas `move` hacia lugares de otro hex (`LifeParts.errands`); apagado. */
  readonly errands?: LifeParts["errands"];
  /** Opt-in (con `objectCues`): también ve lo que llevan los presentes y los puestos del lugar (`LifeParts.viewCues`). */
  readonly viewCues?: ViewCues;
}

/** La cultura con el rasgo `norms.interest` sembrado, solo si se pidió (`interestNorm`); si no, la misma. */
export function withInterestNorm(culture: CultureDef, options: LifeOptions): CultureDef {
  const n = options.interestNorm;
  if (!n || culture.traits.some((t) => t.trait === INTEREST_TRAIT)) return culture;
  return {
    ...culture,
    traits: [
      ...culture.traits,
      {
        trait: INTEREST_TRAIT,
        variants: { ...n.variants },
        params: {},
        origin: "adaptation",
        because:
          n.because ?? "quien prestaba de más se quedó con las tierras y no volvió a tener vecinos",
      },
    ],
  };
}

const INTEREST_TRAIT = "norms.interest";

/**
 * `UsuryOptions` derivadas del mundo (`deriveUsury`) si se pidió `interestNorm` y no hay `loanUsury`
 * explícito: lo que el hogar prestamista tiene a mano sale de sus bienes (`good:*`) en el ledger vivo.
 */
export function derivedLoanUsury(
  options: LifeOptions,
  content: Content,
  ledger: Ledger,
): UsuryOptions | undefined {
  const n = options.interestNorm;
  if (!n || options.loanUsury) return undefined;
  const traits: readonly Trait[] = content.all(TRAITS);
  return deriveUsury({
    traitId: INTEREST_TRAIT,
    prohibitedVariants: n.prohibitedVariants ?? ["forbidden"],
    goodsHeld: (_truth, home, balances) =>
      (balances ?? ledger)
        .holdings(holderAccount(home as unknown as HolderRef))
        .filter((h) => String(h.unit).startsWith("good:"))
        .reduce((sum, h) => sum + h.amount, 0),
    ...(n.wagePerDay !== undefined ? { wagePerDay: n.wagePerDay } : {}),
    ...(n.tolerance !== undefined ? { tolerance: n.tolerance } : {}),
    ...(n.communityCase ? { communityCase: n.communityCase } : {}),
    eyeOf: eyeByPerception(traits),
  });
}

/**
 * Lo que está encendido por defecto desde `life-2` y se apaga con `false`: por ahora las capas de
 * objetivos persistidas. Va antes de `optInParts`, que solo lleva lo que se pidió.
 */
export function defaultParts(options: LifeOptions): Pick<LifeParts, "persistGoalLayers"> {
  return options.persistGoalLayers === false ? {} : { persistGoalLayers: true };
}

/** Los procesos opt-in que la configuración de la vida pasa al mundo (vacío si no pide ninguno). */
export function optInParts(
  options: LifeOptions,
  terrain?: Pick<LocalTerrain, "sea" | "lake" | "water">,
): Pick<
  LifeParts,
  | "famine"
  | "migration"
  | "rumorGrievance"
  | "verboseSteps"
  | "waitAwake"
  | "waitUntended"
  | "waitNoSkin"
  | "sleepUncapped"
  | "legacyFalls"
  | "legacyTend"
  | "legacyResume"
  | "waitEatHomeOnly"
  | "legacyNoCare"
  | "persistGoalLayers"
  | "debtKnowledge"
  | "persistImmediateGoals"
  | "closeGoalsOnDeath"
  | "recognizeGoalCompletion"
  | "recognizeGoalProgress"
  | "meaningPressure"
  | "craftGoals"
  | "scam"
  | "scamFiller"
  | "waterSources"
  | "relationDecay"
  | "loanSeeds"
  | "loanEnforcement"
  | "loanUsury"
  | "loanBondage"
  | "loanBondageAbuse"
  | "loanBondageSkillWage"
  | "swapMaterials"
  | "moldHintsFromCatalog"
  | "tradeView"
  | "marks"
  | "marksExpose"
  | "marksGossip"
  | "marksReach"
  | "loanContagion"
  | "loanContagionEffects"
  | "loanWorkout"
  | "pawn"
  | "hire"
  | "npcMove"
  | "idlePlayerRoutine"
  | "sleepers"
  | "runProbe"
  | "npcVerbs"
  | "npcInterrupt"
  | "npcEncounters"
  | "npcTemplates"
  | "npcJourneyDays"
  | "npcTransit"
  | "npcProvisions"
  | "npcWater"
  | "npcNightRest"
  | "npcPace"
  | "npcFootwear"
  | "npcFootSores"
  | "conception"
  | "conceptionRateScale"
  | "conceptionGestationDays"
  | "births"
  | "speakActs"
  | "takeBelieved"
  | "errands"
  | "creditHeed"
  | "residue"
  | "pathogenSeeds"
  | "healers"
  | "substanceDoses"
  | "eatenNutrition"
  | "consumables"
  | "buyCraving"
  | "gatherCraving"
  | "borrowCraving"
  | "lendBorrowed"
  | "repayDoses"
  | "cravingCues"
  | "cueLocal"
  | "objectCues"
  | "viewCues"
  | "tradeNeeds"
> {
  return {
    ...(options.waterSources
      ? {
          waterSources:
            options.waterSources.hexKinds || !terrain
              ? options.waterSources
              : { ...options.waterSources, hexKinds: hexKindsFromTerrain(terrain) },
        }
      : {}),
    ...(options.relationDecay ? { relationDecay: true } : {}),
    ...(options.loanBondage
      ? (() => {
          const { skillWage, ...terms } = options.loanBondage;
          return {
            loanBondage:
              skillWage === undefined || skillWage === true ? terms : { ...terms, skillWage },
            ...(skillWage === true ? { loanBondageSkillWage: true } : {}),
          };
        })()
      : {}),
    ...(options.loanBondage && options.loanBondageAbuse
      ? { loanBondageAbuse: options.loanBondageAbuse }
      : {}),
    ...(options.loanSeeds ? { loanSeeds: options.loanSeeds } : {}),
    ...(options.loanEnforcement ? { loanEnforcement: options.loanEnforcement } : {}),
    ...(options.loanUsury ? { loanUsury: options.loanUsury } : {}),
    ...(options.famine ? { famine: options.famine } : {}),
    ...(options.migration ? { migration: options.migration } : {}),
    ...(options.rumorGrievance ? { rumorGrievance: true } : {}),
    ...(options.verboseSteps ? { verboseSteps: true } : {}),
    ...(options.waitAwake ? { waitAwake: true } : {}),
    ...(options.waitUntended ? { waitUntended: true } : {}),
    ...(options.waitNoSkin ? { waitNoSkin: true } : {}),
    ...(options.sleepUncapped ? { sleepUncapped: true } : {}),
    ...(options.legacyFalls ? { legacyFalls: true } : {}),
    ...(options.legacyTend ? { legacyTend: true } : {}),
    ...(options.legacyResume ? { legacyResume: true } : {}),
    ...(options.waitEatHomeOnly ? { waitEatHomeOnly: true } : {}),
    ...(options.legacyNoCare ? { legacyNoCare: true } : {}),
    ...(options.persistGoalLayers ? { persistGoalLayers: true } : {}),
    ...(options.debtKnowledge ? { debtKnowledge: true } : {}),
    ...(options.persistImmediateGoals ? { persistImmediateGoals: true } : {}),
    ...(options.closeGoalsOnDeath ? { closeGoalsOnDeath: true } : {}),
    ...(options.recognizeGoalCompletion ? { recognizeGoalCompletion: true } : {}),
    ...(options.recognizeGoalProgress ? { recognizeGoalProgress: true } : {}),
    ...(options.meaningPressure ? { meaningPressure: true } : {}),
    ...(options.craftGoals ? { craftGoals: true } : {}),
    ...(options.scam ? { scam: true } : {}),
    ...(options.scam && options.scamFiller ? { scamFiller: options.scamFiller } : {}),
    ...(options.swapMaterials ? { swapMaterials: true } : {}),
    ...(options.moldHintsFromCatalog ? { moldHintsFromCatalog: true } : {}),
    ...(options.tradeView ? { tradeView: options.tradeView } : {}),
    ...(options.marks ? { marks: true } : {}),
    ...(options.marksExpose ? { marksExpose: true } : {}),
    ...(options.marksGossip ? { marksGossip: true } : {}),
    ...(options.marksReach ? { marksReach: true } : {}),
    ...(options.loanContagion ? { loanContagion: options.loanContagion } : {}),
    ...(options.loanContagionEffects ? { loanContagionEffects: options.loanContagionEffects } : {}),
    ...(options.loanWorkout ? { loanWorkout: true } : {}),
    ...(options.pawn ? { pawn: options.pawn } : {}),
    ...(options.hire ? { hire: options.hire } : {}),
    ...(options.creditHeed ? { creditHeed: options.creditHeed } : {}),
    ...(options.npcMove ? { npcMove: true } : {}),
    ...(options.idlePlayerRoutine ? { idlePlayerRoutine: true } : {}),
    ...(options.sleepers ? { sleepers: options.sleepers } : {}),
    ...(options.runProbe ? { runProbe: options.runProbe } : {}),
    ...(options.npcVerbs && options.npcVerbs.length > 0 ? { npcVerbs: options.npcVerbs } : {}),
    ...(options.npcInterrupt ? { npcInterrupt: true } : {}),
    ...(options.npcEncounters ? { npcEncounters: true } : {}),
    ...(options.npcTemplates ? { npcTemplates: options.npcTemplates } : {}),
    ...(options.npcJourneyDays !== undefined ? { npcJourneyDays: options.npcJourneyDays } : {}),
    ...(options.npcTransit ? { npcTransit: true } : {}),
    ...(options.npcProvisions ? { npcProvisions: options.npcProvisions } : {}),
    ...(options.npcWater ? { npcWater: options.npcWater } : {}),
    ...(options.npcNightRest ? { npcNightRest: true } : {}),
    ...(options.npcPace ? { npcPace: options.npcPace } : {}),
    ...(options.npcFootwear ? { npcFootwear: true } : {}),
    ...(options.npcFootSores && !options.legacyNoFootSores ? { npcFootSores: true } : {}),
    ...(options.conception ? { conception: true } : {}),
    ...(options.conception && options.births ? { births: true } : {}),
    ...(options.conception && options.conceptionGestationDays !== undefined
      ? { conceptionGestationDays: options.conceptionGestationDays }
      : {}),
    ...(options.conception && options.conceptionRateScale !== undefined
      ? { conceptionRateScale: options.conceptionRateScale }
      : {}),
    ...(options.speakActs ? { speakActs: options.speakActs } : {}),
    ...(options.takeBelieved ? { takeBelieved: options.takeBelieved } : {}),
    ...(options.errands ? { errands: options.errands } : {}),
    ...(options.residue ? { residue: options.residue } : {}),
    ...(options.pathogenSeeds ? { pathogenSeeds: options.pathogenSeeds } : {}),
    ...(options.healers ? { healers: options.healers } : {}),
    ...(options.substanceDoses ? { substanceDoses: options.substanceDoses } : {}),
    ...(options.eatenNutrition ? { eatenNutrition: true } : {}),
    ...(options.consumables ? { consumables: options.consumables } : {}),
    ...(options.buyCraving ? { buyCraving: options.buyCraving } : {}),
    ...(options.gatherCraving ? { gatherCraving: options.gatherCraving } : {}),
    ...(options.borrowCraving ? { borrowCraving: options.borrowCraving } : {}),
    ...(options.lendBorrowed ? { lendBorrowed: true } : {}),
    ...(options.repayDoses ? { repayDoses: true } : {}),
    ...(options.cravingCues ? { cravingCues: true } : {}),
    ...(options.cueLocal ? { cueLocal: true } : {}),
    ...(options.objectCues ? { objectCues: true } : {}),
    ...(options.viewCues ? { viewCues: options.viewCues } : {}),
    ...(options.tradeNeeds ? { tradeNeeds: options.tradeNeeds } : {}),
  };
}

/**
 * Los gustos pedidos contra el catálogo de gustos del contenido (dominio -> objetos). Lo que el
 * mundo no conoce o se contradice no se ignora en silencio: falla con la razón (game-modes §2.4).
 * El origen es el evento de fundación hasta que exista la concepción condicionada (ROADMAP).
 */
export function chosenTastesOf(
  specs: readonly TasteSpec[],
  defs: readonly TasteDef[],
  origin: EventId,
): ChosenTaste[] {
  if (specs.length === 0) return [];
  const catalog = new Map<string, Set<string>>();
  for (const d of defs) {
    const items = catalog.get(d.domain) ?? new Set<string>();
    items.add(d.id);
    catalog.set(d.domain, items);
  }
  const { tastes, rejected } = resolveTastes(specs, catalog, origin);
  if (rejected.length > 0) {
    throw new Error(`gustos pedidos inválidos: ${rejected.map((r) => r.reason).join("; ")}`);
  }
  return tastes;
}

/** Lo que no cambia en la vida: sale del seed y del contenido, no se guarda. */
/** Monedas de cobre por persona al empezar (de la economía previa a la corrida; economy §2). */
export const COINS_PER_PERSON = 40;

export interface LifeTerrain {
  /** Dónde pasan los eventos de la aldea. */
  readonly village: PlaceRef;
  readonly planet: Planet;
  readonly site: VillageSite;
  readonly map: LocalMap;
  readonly population: VillagePopulation;
}

function required<T>(x: T | undefined, what: string): T {
  if (x === undefined) throw new Error(`falta contenido: ${what}`);
  return x;
}

/** Las condiciones duras de una búsqueda de nacimiento (la edad la pone `playerAge`). */
function birthFilter(q: BirthQuery, defs: readonly StatusDef[]) {
  return (p: Person, alive: readonly Household[]): boolean => {
    if (q.sex !== undefined && p.sex !== q.sex) return false;
    if (q.position === undefined) return true;
    const seats = alive.map((h) => ({ id: h.id, members: h.members.length, since: h.since }));
    const status = assignStatuses(seats, defs).get(p.household)?.status;
    return defs.find((d) => d.id === status)?.role === q.position;
  };
}

/** El terreno y la pre-corrida de la aldea de este seed. */
export function lifeTerrain(seed: Seed, content: Content, options: LifeOptions = {}): LifeTerrain {
  const planetOptions: PlanetOptions = {
    seed,
    biomes: content.all(BIOMES),
    ...(options.frequency === undefined ? {} : { frequency: options.frequency }),
  };
  const planet = generatePlanet(planetOptions);
  const site = villageSite(planet);
  const query = options.birth;
  const hard = query !== undefined && (query.sex !== undefined || query.position !== undefined);
  const birth = hard ? birthFilter(query, content.all(STATUSES)) : undefined;
  const wish = query?.temperament;
  if (wish !== undefined) {
    const problems = validateTemperament(wish, content.all(TRAITS));
    if (problems.length > 0) {
      throw new Error(`temperamento pedido inválido: ${problems.join("; ")}`);
    }
  }
  const population = villagePopulation({
    seed,
    site,
    traits: content.all(TRAITS),
    demography: required(
      content.get(DEMOGRAPHY, "human.preindustrial-village"),
      "demography human.preindustrial-village",
    ),
    ...(options.playerAge === undefined ? {} : { playerAge: options.playerAge }),
    ...(birth ? { playerFits: birth } : {}),
    ...(wish && Object.keys(wish).length > 0
      ? { playerFit: (p: Person) => temperamentFit(p.innate, wish) }
      : {}),
  });
  const village: PlaceRef = { kind: "settlement", settlement: population.settlement };
  return { village, planet, site, map: localMapOf(planet, site), population };
}

/**
 * Insumos de arranque de los hogares con oficio (los mismos que `tradeOfHousehold` elige en la
 * corrida): unas tandas desde la fuente `seed`, poco a propósito.
 */
function tradeStock(pop: LifeTerrain["population"], seed: Seed, content: Content): Transfer[] {
  const recipes = content.all(TRADE_RECIPES);
  const goods = new Map(content.all(GOODS).map((g) => [g.id, g]));
  const born = new Map(pop.people.map((p) => [p.id, p.born]));
  const out: Transfer[] = [];
  for (const h of pop.households.filter((x) => x.end === null)) {
    const adults = h.members.filter(
      (m) => (pop.now - (born.get(m) ?? pop.now)) / EARTHLIKE_CLOCK.year >= ROUTINE.workAge,
    ).length;
    const r = tradeOfHousehold(seed, h.id, adults, recipes);
    if (!r) continue;
    for (const i of r.inputs) {
      const def = goods.get(i.good);
      if (!def) continue;
      out.push({
        unit: goodUnit(def),
        from: externalAccount("seed"),
        to: holderAccount(h.id),
        amount: i.amount * TRADE_START_BATCHES,
      });
    }
  }
  return out;
}

/** Los contadores de ids siguen a lo que ya existe, para que lo nuevo no choque. */
function idsAfter(truth: WorldTruth, log: EventLog): IdAllocator {
  const next: Record<string, number> = { event: log.lastNumber + 1 };
  for (const { id } of truth.rows().filter((r) => r.table === ENTITY.name)) {
    const [kind, n] = id.split(":");
    if (kind === undefined || n === undefined) continue;
    next[kind] = Math.max(next[kind] ?? 1, Number(n) + 1);
  }
  return new IdAllocator(next);
}

/**
 * Lo mínimo del terreno que hace falta para seguir una vida guardada: el mapa local, el hex de
 * la aldea, los hogares vivos al empezar (de ahí salen los espacios) y quién es el personaje.
 * Se guarda con la vida para que retomar no regenere el planeta; es JSON puro.
 */
export interface ResumeAnchor {
  readonly map: LocalMap;
  readonly hex: number;
  readonly households: readonly HouseholdId[];
  readonly player: AgentId;
  readonly village: PlaceRef;
}

export function anchorOf(terrain: LifeTerrain): ResumeAnchor {
  return {
    map: terrain.map,
    hex: terrain.site.hex,
    households: terrain.population.households.filter((h) => h.end === null).map((h) => h.id),
    player: terrain.population.player,
    village: terrain.village,
  };
}

/** La lengua de la aldea y su etiqueta de habla (se rehace igual del seed y del contenido). */
function villageForm(seed: Seed, content: Content, language?: Language): ConverseForm {
  const concepts = content.all(CONCEPTS);
  return {
    language:
      language ??
      generateLanguage(
        seed,
        required(content.get(LANGUAGES, "village.hills"), "lengua village.hills"),
        concepts,
      ),
    concepts,
    registers: content.all(REGISTERS),
    addresses: content.all(ADDRESSES),
    taboos: content.all(TABOOS),
    etiquette: content.all(ETIQUETTE),
    culture: "village",
  };
}

/** Lo derivado del seed y del contenido que no se guarda, sin tocar el planeta. */
export function resumeParts(
  seed: Seed,
  content: Content,
  anchor: ResumeAnchor,
): Pick<
  LifeParts,
  | "seed"
  | "clock"
  | "map"
  | "catalog"
  | "skills"
  | "traits"
  | "plans"
  | "foods"
  | "nutrientProfiles"
  | "diets"
  | "goods"
  | "demography"
  | "recipes"
  | "tradeRecipes"
  | "statuses"
  | "cultureTraits"
  | "speech"
  | "pressureCurves"
  | "schemas"
  | "values"
  | "stages"
  | "relationDims"
  | "relationBonds"
  | "habits"
  | "lineages"
  | "materials"
  | "trajectories"
  | "divinations"
  | "concerns"
  | "tastes"
  | "form"
> {
  return {
    seed,
    clock: EARTHLIKE_CLOCK,
    map: anchor.map,
    catalog: new ActionCatalog(content.all(ACTIONS), content.all(PLANS)),
    skills: new SkillCatalog(content.all(SKILLS), content.all(ACTIONS)),
    traits: content.all(TRAITS),
    plans: content.all(BODY_PLANS),
    foods: content.all(FOODS),
    nutrientProfiles: content.all(NUTRIENT_PROFILES),
    diets: content.all(DIETS),
    goods: content.all(GOODS),
    demography: required(
      content.get(DEMOGRAPHY, "human.preindustrial-village"),
      "demography human.preindustrial-village",
    ),
    materials: content.all(MATERIALS),
    recipes: content.all(RECIPES),
    tradeRecipes: content.all(TRADE_RECIPES),
    statuses: content.all(STATUSES),
    cultureTraits: content.all(CULTURE_TRAITS),
    speech: content.all(SPEECH_LINES),
    pressureCurves: content.all(PRESSURE_CURVES),
    schemas: content.all(SCHEMAS),
    values: content.all(VALUES),
    stages: content.all(LIFE_STAGES),
    relationDims: content.all(RELATION_DIMS),
    relationBonds: content.all(RELATION_BONDS),
    habits: content.all(HABITS_CONTENT),
    lineages: content.all(LINEAGES),
    trajectories: content.all(TRAJECTORIES),
    divinations: content.all(DIVINATION_METHODS),
    concerns: content.all(DIVINATION_CONCERNS),
    tastes: content.all(TASTES),
    form: villageForm(seed, content),
  };
}

/** Las fuentes y sumideros que la vida declara (conservación: nada entra ni sale por otro lado). */
export function ledgerConfigOf(content: Content, residue?: ResidueConfig): LedgerConfig {
  const units = content.all(FOODS).map((f) => ledgerUnit(`good:${f.id}`));
  const tradeUnits = [
    ...new Set(
      content
        .all(TRADE_RECIPES)
        .flatMap((r) => [r.output.good, ...r.inputs.map((i) => i.good)])
        .map((g) => ledgerUnit(`good:${g}`)),
    ),
  ];
  return {
    externals: {
      [COOKED]: units,
      [EATEN]: units,
      [HARVEST]: [HARVEST_GOOD],
      [ROTTED]: [...units, ...tradeUnits.filter((u) => !units.includes(u))],
      seed: [
        ...units,
        ...tradeUnits.filter((u) => !units.includes(u)),
        COPPER,
        ...settlementUnits(content.all(MATERIALS)),
      ],
      [WORKSHOP]: tradeUnits,
      [WORKSHOP_WASTE]: tradeUnits,
      [GATHERED_SOURCE]: settlementUnits(content.all(MATERIALS)),
      [DEBRIS_SINK]: settlementUnits(content.all(MATERIALS)),
      [WAGES_SINK]: [COPPER],
      [SMOKE_SINK]: settlementUnits(content.all(MATERIALS)),
      ...residueExternals(residue),
    },
  };
}

/**
 * Migra el ledger de una vida guardada antes de que existieran algunas fuentes o sumideros
 * (`harvest`, `rotted`, ...): suma las unidades que faltan y rehace el ledger con el mismo diario,
 * así el saldo no cambia. Si ya declara todo, devuelve el mismo.
 */
export function withDeclaredExternals(
  ledger: Ledger,
  content: Content,
  residue?: ResidueConfig,
): Ledger {
  const have = ledger.config.externals;
  const merged: Record<string, string[]> = {};
  let changed = false;
  for (const [name, units] of Object.entries(ledgerConfigOf(content, residue).externals)) {
    const known = new Set(have[name] ?? []);
    const missing = units.filter((u) => !known.has(u));
    if (missing.length > 0) changed = true;
    merged[name] = [...(have[name] ?? []), ...missing];
  }
  for (const [name, units] of Object.entries(have)) merged[name] ??= [...units];
  return changed ? Ledger.fromJournal({ externals: merged }, ledger.journal()) : ledger;
}

export function createLife(
  seed: Seed,
  content: Content,
  options: LifeOptions = {},
): { world: LifeWorld; terrain: LifeTerrain } {
  const terrain = lifeTerrain(seed, content, options);
  const { site, map, population: pop } = terrain;
  const traits: readonly Trait[] = content.all(TRAITS);
  const clock = EARTHLIKE_CLOCK;

  const truth = new WorldTruth();
  const log = EventLog.from(pop.events);
  seedVillage(truth, pop);
  truth.set(PLAYER, pop.player, { since: pop.now });

  // Los lugares con nombre salen de las anclas del sitio, con la causa que ya traen.
  const settlement = pop.settlement as SettlementId;
  truth.set(PLACE, settlement, { kind: "village", hexes: [site.hex] });
  truth.set(SOIL, settlement, { fertility: SOIL_START, seen: 0 });
  truth.set(PARCEL_SOIL, settlement, { soil: startingParcel(SOIL_START), seen: 0 });
  const trajectory = pickTrajectory(content.all(TRAJECTORIES), map.climate.annualPrecipMm);
  if (trajectory) {
    const hexes = ecologyHexes(map);
    const productivity = dailyProductivity({
      tempMeanC: map.climate.annualMeanC,
      annualPrecipMm: map.climate.annualPrecipMm,
      soilFertility: SOIL_START,
      hexes,
    });
    truth.set(ECOLOGY, settlement, {
      cell: initialCell(content.all(LINEAGES), {
        annualMeanC: map.climate.annualMeanC,
        annualPrecipMm: map.climate.annualPrecipMm,
        hexes,
        shelter: map.forest.filter(Boolean).length / Math.max(1, map.forest.length),
        productivity,
      }),
      forest: { stage: trajectory.climax, stageAge: 0, fuel: 0.5, trajectory },
      fireHazard: 0,
      day: 0,
      yearDays: 0,
    });
  }
  let place = 0;
  const named: PlaceToName[] = [];
  for (const a of site.anchors) {
    if (a.kind === "harbor") continue;
    const id = makeId("place", ++place);
    const hexes = a.kind === "water" ? [a.hex] : a.hexes;
    const kind = a.kind === "water" ? "water" : a.kind === "farmland" ? "fields" : "forest";
    truth.set(ENTITY, id, { id, originEventId: a.cause, createdAt: 0 });
    truth.set(PLACE, id, {
      kind,
      hexes,
      ...(a.kind === "water" ? { detail: a.source } : {}),
    });
    const feature: PlaceFeature =
      a.kind === "water" ? a.source : kind === "fields" ? "fields" : "forest";
    named.push({ id, feature, event: a.cause });
  }

  // La lengua de la aldea: sus nombres de gente y de lugar salen de su léxico (language §8, §9).
  const language = generateLanguage(
    seed,
    required(content.get(LANGUAGES, "village.hills"), "lengua village.hills"),
    content.all(CONCEPTS),
  );
  seedPersonNames(truth, language, seed);
  const main = named.find((p) => !["fields", "forest"].includes(p.feature)) ?? named[0];
  seedPlaceNames(truth, language, seed, [
    ...(main ? [{ id: settlement, feature: main.feature, event: pop.foundedEvent }] : []),
    ...named,
  ]);

  // Cada vivo empieza en su casa; el personaje también.
  for (const id of truth.ids(PERSON) as AgentId[]) {
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const household = truth.get(PERSON, id)?.household as HouseholdId;
    truth.set(LOCATION, id, { hex: site.hex, space: houseKey(household) });
  }

  const skills = new SkillCatalog(content.all(SKILLS), content.all(ACTIONS));
  const plans = content.all(BODY_PLANS);
  seedSkills(truth, skills, traits, pop.now, clock);
  seedBodies(
    truth,
    required(
      plans.find((p) => p.id === "human"),
      "body-plan human",
    ),
    traits,
    pop.now,
    clock,
  );

  const ids = idsAfter(truth, log);
  const foods = content.all(FOODS);
  const materials = content.all(MATERIALS);
  const ledger = new Ledger(ledgerConfigOf(content, options.residue));
  // La aldea como edificios con componentes, el pozo y los caminos (settlements §5, §8).
  seedSettlement(truth, ids, log, ledger, {
    seed,
    pop,
    site,
    map,
    content: { materials, buildings: content.all(BUILDING_TYPES), works: content.all(WORK_TYPES) },
  });
  const spaces = liveSettlementSpaces(
    truth,
    site.hex,
    [],
    new Map(materials.map((m) => [m.id, m])),
  );
  // Quién es quién: el estatus de cada hogar, con su causa; de él sale cuánto tenía al empezar.
  const statuses = content.all(STATUSES);
  const standing = seedStatus(truth, ids, log, {
    settlement,
    place: terrain.village,
    now: pop.now,
    households: pop.households,
    defs: statuses,
  });
  // La cultura de la aldea: qué hace la gente y por qué (culture §1, §3).
  const baseCulture = content.all(CULTURES).find((c) => c.id === "village");
  if (!baseCulture) throw new Error("falta contenido: cultura village");
  // Opt-in: suma las creencias de contagio y la norma del jefe del hogar (`village.health`).
  const healthCulture = options.healthCulture
    ? content.all(CULTURES).find((c) => c.id === "village.health")
    : undefined;
  if (options.healthCulture && !healthCulture) throw new Error("falta contenido: village.health");
  const healthy = healthCulture
    ? { ...baseCulture, traits: [...baseCulture.traits, ...healthCulture.traits] }
    : baseCulture;
  const culture = withInterestNorm(healthy, options);
  const community = seedCulture(truth, ids, log, {
    settlement,
    place: terrain.village,
    now: pop.now,
    foundersEvent: pop.foundersEvent,
    culture,
    traits: content.all(CULTURE_TRAITS),
  });
  // Cómo suena su habla: el acento de la lengua madre con la deriva de la separación (language §5).
  seedCommunityAccent(truth, ids, log, {
    seed,
    settlement,
    place: terrain.village,
    now: pop.now,
    foundersEvent: pop.foundersEvent,
    language: language.id,
    generations: VILLAGE_SEPARATION,
  });
  // Lo que cada uno sigue de ella: los hijos copian a sus padres (culture §4).
  seedPeopleCulture(truth, ids, log, {
    seed,
    now: pop.now,
    place: terrain.village,
    community,
    traits: content.all(CULTURE_TRAITS),
  });
  // La religión popular, parte de esa cultura: ancestros, el pozo, una fiesta, tabúes (religion §2, §6).
  const religion = content.all(RELIGIONS).find((r) => r.culture === culture.id);
  if (!religion) throw new Error("falta contenido: religión de la cultura village");
  const villageFaith = seedReligion(truth, ids, log, {
    settlement,
    place: terrain.village,
    now: pop.now,
    foundersEvent: pop.foundersEvent,
    religion,
    doctrines: content.all(DOCTRINES),
  });
  // Lo que cada uno cree y cumple de ella: los hijos siguen a sus padres (religion §1).
  seedPeopleReligion(truth, ids, log, {
    seed,
    now: pop.now,
    place: terrain.village,
    religion: villageFaith,
  });
  // Lo adquirido de cada mente: esquemas de base desde el temperamento (npc-psychology §1-§2).
  seedMinds(truth, ids, log, {
    seed,
    now: pop.now,
    place: terrain.village,
    foundersEvent: pop.foundersEvent,
    schemas: content.all(SCHEMAS),
    history: {
      people: pop.people,
      events: pop.events,
      yearTicks: clock.year,
      stages: content.all(LIFE_STAGES),
    },
  });
  // Qué le gusta y qué rechaza a cada uno: temperamento, cuerpo, cultura y lo conocido de chico (§16).
  const tasteDefs = content.all(TASTES);
  const chosenTastes = chosenTastesOf(options.tastes ?? [], tasteDefs, pop.foundersEvent);
  seedTastes(truth, ids, log, {
    seed,
    ...(chosenTastes.length > 0 ? { chosen: new Map([[pop.player, chosenTastes]]) } : {}),
    now: pop.now,
    place: terrain.village,
    foundersEvent: pop.foundersEvent,
    defs: tasteDefs,
    taboos: villageFaith.practices.filter((p) => p.kind === "taboo"),
  });
  // Lo que cada uno siente por su parentela y su casa (npc-psychology §6).
  seedRelations(truth, ids, log, {
    seed,
    now: pop.now,
    place: terrain.village,
    foundersEvent: pop.foundersEvent,
    dims: content.all(RELATION_DIMS),
    bonds: content.all(RELATION_BONDS),
  });
  // Quién tiene qué tierra, con sus testigos y lo que cada vecino cree (property §3, §9).
  seedParcels(truth, ids, log, {
    seed,
    pop,
    site,
    tenures: content.all(TENURES),
    standing,
  });
  const wealthOf = (h: HouseholdId): number => standing.get(h)?.wealth ?? 1;
  // Despensas de arranque: lo que cada hogar guardó de la última cosecha para llegar a la próxima
  // (`larderNeeded`: sus brazos en el campo contra sus bocas, día por día del año que viene).
  const season = harvestSeason(map.climate, clock, Rng.root(seed));
  const startDay = dayOf(clock, pop.now + Math.round((map.lonDeg / 360) * clock.day));
  const birthOf = new Map(pop.people.map((p) => [p.id, p.born]));
  const larderOf = (h: { members: readonly AgentId[]; id: HouseholdId }): number =>
    Math.round(
      larderNeeded(
        h.members.map((m) => (pop.now - (birthOf.get(m) ?? pop.now)) / clock.year),
        clock,
        season,
        startDay,
      ) * wealthOf(h.id),
    );
  const grain = ledgerUnit("good:grain");
  if (foods.some((f) => f.id === "grain")) {
    const stocked = ids.next("event");
    log.append({
      id: stocked,
      tick: pop.now,
      kind: "settlement.stocked",
      actors: [],
      place: terrain.village,
      data: null,
      emissions: {},
      causes: [{ kind: "event", event: pop.foundersEvent }],
      resolution: "local",
    });
    ledger.post({
      tick: pop.now,
      eventId: stocked,
      transfers: pop.households
        .filter((h) => h.end === null)
        .map((h) => ({
          unit: grain,
          from: externalAccount("seed"),
          to: holderAccount(h.id),
          amount: larderOf(h),
        }))
        .concat(
          pop.households
            .filter((h) => h.end === null)
            .flatMap((h) =>
              h.members.map((m) => ({
                unit: COPPER,
                from: externalAccount("seed"),
                to: holderAccount(m as unknown as HolderRef),
                amount: Math.round(COINS_PER_PERSON * wealthOf(h.id)),
              })),
            ),
        )
        .concat(tradeStock(pop, seed, content)),
    });
  }
  const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));

  const world = lifeWorld(
    {
      seed,
      clock,
      truth,
      ids,
      log,
      ledger,
      map,
      spaces,
      catalog,
      skills,
      traits,
      plans,
      foods,
      nutrientProfiles: content.all(NUTRIENT_PROFILES),
      diets: content.all(DIETS),
      goods: content.all(GOODS),
      demography: required(
        content.get(DEMOGRAPHY, "human.preindustrial-village"),
        "demography human.preindustrial-village",
      ),
      recipes: content.all(RECIPES),
      tradeRecipes: content.all(TRADE_RECIPES),
      statuses: content.all(STATUSES),
      cultureTraits: content.all(CULTURE_TRAITS),
      speech: content.all(SPEECH_LINES),
      pressureCurves: content.all(PRESSURE_CURVES),
      schemas: content.all(SCHEMAS),
      values: content.all(VALUES),
      stages: content.all(LIFE_STAGES),
      relationDims: content.all(RELATION_DIMS),
      relationBonds: content.all(RELATION_BONDS),
      habits: content.all(HABITS_CONTENT),
      lineages: content.all(LINEAGES),
      materials,
      trajectories: content.all(TRAJECTORIES),
      divinations: content.all(DIVINATION_METHODS),
      concerns: content.all(DIVINATION_CONCERNS),
      tastes: content.all(TASTES),
      form: villageForm(seed, content, language),
      ...defaultParts(options),
      ...optInParts(options, site.terrain),
      ...(() => {
        const u = derivedLoanUsury(options, content, ledger);
        return u ? { loanUsury: u } : {};
      })(),
    },
    pop.player,
    terrain.village,
    { now: pop.now, seq: 0, queue: [] },
  );
  const me = truth.get(PERSON, pop.player);
  if (me) {
    world.truth.set(
      INVENTORY_BELIEF,
      pop.player,
      checkInventory(
        world.ledger.holdings(holderAccount(pop.player as unknown as HolderRef)),
        world.ledger.holdings(holderAccount(me.household as unknown as HolderRef)),
        pop.now,
      ),
    );
  }
  return { world, terrain };
}
