// La vida en memoria: la verdad, el registro, el ledger y el scheduler con los procesos de la
// Fase 1, más lo derivado del seed y del contenido que no se guarda (mapa, espacios, catálogos).

import type {
  AgentId,
  EventLog,
  IdAllocator,
  Ledger,
  LedgerUnit,
  PlaceRef,
  PlanetClock,
  Seed,
} from "../../core/index.ts";
import { makeId, Rng } from "../../core/index.ts";
import {
  type ActionCatalog,
  type BodyPlanDef,
  type BondDef,
  bodyProcess,
  type ConcernWords,
  type DietDef,
  type DimensionDef,
  type DivinationMethodDef,
  type FoodDef,
  type GoodDef,
  type HabitDef,
  type LineageDef,
  LOCATION,
  type LocalMap,
  type MaterialDef,
  type NutrientProfileDef,
  type PressureCurve,
  type ReadonlyWorldTruth,
  type RecipeDef,
  Scheduler,
  type SchedulerState,
  type SchemaDef,
  type SkillCatalog,
  type SpaceGraph,
  type SpeechLine,
  type StageDef,
  type StatusDef,
  type TasteDef,
  type TradeRecipeDef,
  type Trait,
  type TraitDef,
  type TrajectoryDef,
  type ValueDef,
  type WorldTruth,
} from "../../sim/index.ts";
import { accentProcess } from "./accent.ts";
import { actProcess, type BoilOptions, type FilterOptions } from "./act.ts";
import { adultGrowthProcess } from "./adultGrowth.ts";
import {
  altitudeProcess,
  mapAltitudeOf,
  type TravelAltitude,
  travelAltitudeOf,
} from "./altitude.ts";
import { ambientOf } from "./ambient.ts";
import { appraiseProcess } from "./appraise.ts";
import { askAroundProcess } from "./askaround.ts";
import { bondageAbuseChance, craftSkillIds, skillWageOf } from "./bondagepolicy.ts";
import { borrowProcess, repayProcess } from "./borrow.ts";
import { personalPoolShareOf } from "./budget.ts";
import { companyProcess } from "./company.ts";
import { conscienceProcess } from "./conscience.ts";
import { contagionProcess } from "./contagion.ts";
import { type ConverseForm, converseProcess } from "./converse.ts";
import { arrearsProcess, creditProcess } from "./credit.ts";
import { decideProcess } from "./decide.ts";
import { deedsProcess } from "./deeds.ts";
import { consultProcess, divinersProcess, retoldProcess, visitsProcess } from "./divine.ts";
import { ecologyProcess } from "./ecology.ts";
import { exposureProcess, type PathogenSeed } from "./exposure.ts";
import { type FamineOptions, famineProcess } from "./famine.ts";
import { gatheringsFor } from "./gathering-provider.ts";
import { gossipProcess } from "./gossip.ts";
import { growthSequelaeProcess } from "./growthSequelae.ts";
import { intrusionProcess } from "./intrusion.ts";
import { inventoryProcess } from "./inventory-belief.ts";
import { keepProcess } from "./keep.ts";
import { knowingProcess } from "./knowing.ts";
import { lendProcess, repayDoseProcess } from "./lend.ts";
import { living } from "./living.ts";
import { type BondageTerms, type LoanSeed, loansProcess } from "./loans.ts";
import { lookingProcess } from "./looking.ts";
import { marketProcess } from "./market.ts";
import { marksProcess } from "./marks.ts";
import { type Healer, type HealerSchool, medicineProcess, type RemedyDose } from "./medicine.ts";
import { type MigrationOptions, migrationProcess } from "./migration.ts";
import {
  catalogMoldHints,
  type HouseholdNeeds,
  lookSiteOf,
  type MoldGossipOptions,
  type MoldHintOptions,
  moldGossipProcess,
  tradeWantFromNeeds,
} from "./moldgossip.ts";
import { neighborsProcess } from "./neighbors.ts";
import { nutritionProcess } from "./nutrition.ts";
import { observeProcess } from "./observe.ts";
import { perceiveProcess } from "./perceive.ts";
import { pitchProcess } from "./pitch.ts";
import { pledgeProcess } from "./pledges.ts";
import { ponderProcess } from "./ponder.ts";
import {
  type RentMarketOptions,
  type RentSeed,
  rentsProcess,
  sharecropHarvestProcess,
} from "./rents.ts";
import { routineProcess } from "./routine.ts";
import { fillerNoticeProcess, scamDiscoveryProcess } from "./scamdiscovery.ts";
import { forgeSkillOf, scamEyeOf, scamNeedOf, scamProviders, scamRefundOf } from "./scampolicy.ts";
import { sleepProcess } from "./sleep.ts";
import { soilProcess } from "./soil.ts";
import { householdsOf, spoilageProcess } from "./spoilage.ts";
import { standingProcess } from "./standing.ts";
import {
  type BorrowCravingOptions,
  type BuyCravingOptions,
  type ConsumableDef,
  type GatherCravingOptions,
  type SubstanceDose,
  substancesProcess,
} from "./substances.ts";
import { bornTaboosProcess, bornTaboosSettleProcess, heardWordsProcess } from "./taboos.ts";
import { testifyProcess } from "./testify.ts";
import { thermalProcess } from "./thermal.ts";
import { tradeChoiceProcess } from "./tradechoice.ts";
import { type TradeAssignment, tradesProcess } from "./trades.ts";
import { tradeViewProcess } from "./tradeview.ts";
import { upbringingProcess } from "./upbringing.ts";
import { upkeepProcess } from "./upkeep.ts";
import { resolveWaterSources, type WaterSourcesConfig, waterHooks } from "./waterSources.ts";
import { witnessingProcess } from "./witnessing.ts";
import { workoutProcess } from "./workout.ts";

export { living } from "./living.ts";
export { PLAYER } from "./player.ts";

export interface LifeWorld {
  readonly seed: Seed;
  readonly clock: PlanetClock;
  readonly truth: WorldTruth;
  readonly ids: IdAllocator;
  readonly log: EventLog;
  readonly ledger: Ledger;
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly catalog: ActionCatalog;
  readonly skills: SkillCatalog;
  readonly traits: readonly Trait[];
  readonly plans: readonly BodyPlanDef[];
  readonly foods: readonly FoodDef[];
  readonly goods: readonly GoodDef[];
  /** Los materiales de los edificios (settlements §5): sin ellos no corre el mantenimiento. */
  readonly materials?: readonly MaterialDef[];
  /** Fuentes explícitas de patógenos (body-health §6); sin ellas el contagio no hace nada. */
  readonly pathogenSeeds?: readonly PathogenSeed[];
  /** Sanadores explícitos (body-health §6): diagnostican y tratan a los enfermos; sin ellos no hacen nada. */
  readonly healers?: readonly Healer[];
  /** Escuela de sanadores desde las habilidades (`medicine`); sin ella solo cuentan los explícitos. */
  readonly healerSchool?: HealerSchool;
  /** Opt-in: los signos que ve el sanador salen del cuerpo real (`bodySigns`). */
  readonly healerRealSigns?: boolean;
  /** Opt-in: el sanador también ve los signos de las sustancias que el enfermo tiene encima. */
  readonly healerSubstanceSigns?: boolean;
  /** Opt-in: el sanador también ve los signos de la congelación. */
  readonly healerFrostbiteSigns?: boolean;
  /** Opt-in (con `frostbite`; con `frostbiteTreatment` se ejecuta): el sanador escribe el pedido de cuidado de la congelación. */
  readonly healerFrostbiteOrders?: boolean;
  /** Opt-in: el contagio usa reuniones con horas reales (fiesta del calendario, mercado); ver `gatheringsFor`. */
  readonly gatheringContact?: boolean;
  /** Opt-in (con `realAltitude`): el sanador también ve los signos del mal de altura. */
  readonly healerAltitudeSigns?: boolean;
  /** Opt-in (con `realAltitude`): la aclimatación escala con el genoma (`constitution`). */
  readonly altitudeGenome?: boolean;
  /** Remedio a unidad del ledger: darlo gasta un bien real (del sanador o del enfermo); sin existencias no se da. Sin esto, remedios sin costo. */
  readonly remedyStock?: Readonly<Record<string, string>>;
  /** Dosis explícitas de sustancias (body-health §9); sin ellas no hay nada que simular. */
  readonly substanceDoses?: readonly SubstanceDose[];
  /** Remedios con dosis real (remedio a sustancia): el tratamiento deja una dosis en `PERSON_SUBSTANCE`; sin esto, efecto fijo. */
  readonly remedyDoses?: Readonly<Record<string, RemedyDose>>;
  /** Perfiles de nutrientes por alimento y dieta de referencia (body-health §5); sin dieta no hay reservas. */
  readonly nutrientProfiles?: readonly NutrientProfileDef[];
  readonly diets?: readonly DietDef[];
  /** Lo comido de verdad alimenta las reservas (`MEALS`); apagado por defecto: la aldea no cambia. */
  readonly eatenNutrition?: boolean;
  /** Las carencias publicadas (`DEFICIENCY_EFFECTS`) frenan la curación y la defensa inmune del cuerpo; apagado por defecto. */
  readonly deficiencyEffects?: boolean;
  /** Con `deficiencyEffects`, `reopenWound` reabre heridas viejas (rng con clave); apagado por defecto. */
  readonly reopenWounds?: boolean;
  /**
   * Opt-in: las etapas de carencia (`NUTRITION`) suman señales a `bodySigns` en el panel, la vista,
   * las interrupciones, las sugerencias y los médicos; apagado por defecto: nada cambia.
   */
  readonly deficiencySigns?: boolean;
  /** Desnutrición proteica grave sostenida mata (causa `malnutrition`); apagado por defecto: sin muertes nuevas. */
  readonly malnutritionDeath?: boolean;
  /** Opt-in: el hambre infantil deja secuelas permanentes (`GROWTH_SEQUELAE`); apagado por defecto: sin filas. */
  readonly growthSequelae?: boolean;
  /** Opt-in: al cumplir 18 la masa del cuerpo se reconstruye con la talla final (genética y secuelas de hambre infantil); apagado por defecto: sin escrituras. */
  readonly adultGrowth?: boolean;
  /** Opt-in (con `adultGrowth`): los menores de 18 crecen un paso por año cumplido; apagado por defecto. */
  readonly gradualGrowth?: boolean;
  /** Opt-in: carencias (`vigor`, `oxygen`, `cognition`) y secuela cognitiva bajan las capacidades al decidir y actuar; apagado por defecto. */
  readonly nutritionCaps?: boolean;
  /**
   * Opt-in: altitud real del hex (`LocalMap.elevationM`): corre `life.altitude` (aclimatación en
   * `ACCLIMATIZATION`), el frío sigue el gradiente con la elevación y la resistencia de `decide`/`act`
   * baja con la altura. Apagado por defecto: la aldea no cambia, sin filas ni RNG.
   */
  readonly realAltitude?: boolean;
  /** Opt-in (con `realAltitude`): fuera del parche local la altitud sale de la elevación de la celda recorrida; sin esto, solo el parche. */
  readonly travelAltitude?: TravelAltitude;
  /** Opt-in: qué fuente bebe cada quien (pozo tratado en el sitio, fuente del hex fuera) con `drinkQuality`/`waterFor`; apagado: agua limpia/pozo como siempre. */
  readonly waterSources?: WaterSourcesConfig;
  /** Opt-in: `loansProcess` lee la confianza de RELATIONS con `current` (decaimiento al día); apagado: tal cual guardada. */
  readonly relationDecay?: boolean;
  /**
   * Opt-in: la congelación se acumula por parte (`FROSTBITE`), la necrosis amputa (`AMPUTATIONS`,
   * evento `body.amputated`) y manos y pies heridos bajan las capacidades de `decide`/`act`.
   * Apagado por defecto: la aldea no cambia, sin filas, RNG ni muertes.
   */
  readonly frostbite?: boolean;
  /** Opt-in: explorar a pie emite una mirada de paso que `moldGossip.fromLooking` lee; ver `ActOptions.glanceOnMove`. Apagado: nada cambia. */
  readonly glanceOnMove?: boolean;
  /** Opt-in: el núcleo (`THERMAL`) baja la destreza o deja inconsciente en `decide`, `act` y la pelea. Apagado: sin cambios. */
  readonly coreEffects?: boolean;
  /**
   * Opt-in (con `frostbite`): `life.thermal` consume la orden de `FROSTBITE_CARE` (recalentar y aislar
   * bajan la gravedad por hora; amputar quita la parte profunda antes de la gangrena). Apagado: nada cambia.
   */
  readonly frostbiteTreatment?: boolean;
  /** Opt-in (con `frostbiteTreatment`): sin orden de médico, cada uno se recalienta y aísla solo unas horas por día; la habilidad (su entrada en `healers`, 0 si no está) decide la intensidad. Apagado: nada cambia. */
  readonly frostbiteSelfCare?: boolean;
  /** Opt-in (con `frostbiteTreatment`): el cuidado gasta leña (y usa manta) del ledger; con `frostbiteSelfCare` la habilidad decide el acierto de la amputación. Ver `ThermalOptions.frostbiteSupplies`. Apagado: nada cambia. */
  readonly frostbiteSupplies?: {
    readonly fuelUnit: string;
    readonly fuelGramsPerHour: number;
    readonly sink?: string;
    readonly blanketUnit?: string;
    readonly unsuppliedInsulate?: number;
    /** Agua tibia: unidad y cantidad por hora de recalentado, insumo aparte de la leña (rinde lo mínimo de las dos). */
    readonly waterUnit?: string;
    readonly waterPerHour?: number;
    /** Desgaste de la manta: unidades que se gastan por hora de uso (fracción; se retiran al sumidero). */
    readonly blanketWearPerHour?: number;
  };
  /** Opt-in (con `frostbite`): la amputación deja `Scar` con `lost` en el `Body` (`body.physiology`) y baja capacidades por zona. Apagado: nada cambia. */
  readonly amputationScars?: boolean;
  /**
   * Opt-in: bienes que son sustancias de consumo (body-health §9): el verbo `consume` los toma
   * (`life.act`: gasta una unidad y suma una dosis con evento) y `life.decide` lo ofrece con
   * `serves: craving`. Apagado por defecto: sin candidata, filas, RNG ni muertes nuevas.
   */
  readonly consumables?: readonly ConsumableDef[];
  /** Opt-in (con `consumables`): el ansia empuja a comprar lo que se consume y no hay en la despensa (`life.decide`); apagado, sin candidata nueva. */
  readonly buyCraving?: BuyCravingOptions;
  /** Opt-in (con `consumables`): sin con quién comprar, el ansia empuja a recolectar la planta (`life.decide`); apagado, sin candidata nueva. */
  readonly gatherCraving?: GatherCravingOptions;
  /** Opt-in (con `consumables` y `moldHints`): sin comercio ni planta, pedir la sustancia a un conocido que se cree que la tiene (`life.decide`); apagado, sin candidata nueva. */
  readonly borrowCraving?: BorrowCravingOptions;
  /** Opt-in (con `borrowCraving`): el pedido se ejecuta (`life.lend`): el prestamista decide, pasa una dosis por el libro mayor y queda un fiado; si no la tenía, el rumor `has` se debilita. Apagado, el pedido no hace nada. */
  readonly lendBorrowed?: boolean;
  /** Opt-in (con `consumables`): el hogar que debe una sustancia y ya la tiene la devuelve en especie por el libro mayor (`life.repay_dose`); si no, el vencimiento la vuelve mora. Apagado, sin proceso. */
  readonly repayDoses?: boolean;
  /** Opt-in: bienes que al comerse dan una dosis (`amount` por gramo); ver `ActOptions.foodSubstances`. */
  readonly foodSubstances?: readonly ConsumableDef[];
  /** Opt-in: lo que se bebe lleva una sustancia (`amount` por litro); ver `ActOptions.drinkSubstance`. */
  readonly drinkSubstance?: ConsumableDef;
  /**
   * Opt-in: el verbo `boil` (body-health §5) quema combustible del ledger (declarar el sumidero
   * `burned` con esa unidad) y deja agua tratada que `waterSources` aplica al beber. Apagado por
   * defecto: sin filas, RNG ni eventos nuevos.
   */
  readonly boil?: BoilOptions;
  /** Opt-in: el verbo `filter` gasta material filtrante del ledger y deja agua filtrada; ver `ActOptions.filter`. */
  readonly filter?: FilterOptions;
  /**
   * Opt-in (con `boil`): los NPC con sed por encima de `minThirst` y sin agua tratada vigente
   * deciden hervir (`life.decide`) y `life.routine` lo cumple con la despensa. Apagado por defecto:
   * sin candidata, filas, RNG ni eventos nuevos.
   */
  readonly npcBoil?: { readonly minThirst: number; readonly weight: number };
  /** Opt-in: señales de ansia aprendidas (lugar, persona, hora) en `life.act` y `life.decide`; apagado, sin señales. */
  readonly cravingCues?: boolean;
  /** Opt-in (con `cravingCues`): `life.decide` lee a quién cree presente y el huso del lugar; ver `DecideOptions.cueLocal`. */
  readonly cueLocal?: boolean;
  /**
   * Opt-in: estafa de calidad en el trato (economy §6): quien vende infla según su temperamento y
   * su necesidad (hambre, deuda) y el comprador cotiza por lo que cree según cuánto confía.
   * Apagado por defecto: sin filas, RNG ni eventos nuevos.
   */
  readonly scam?: boolean;
  /** Opt-in bajo `scam`: unidad del relleno con que el vendedor mezcla el lote (ver `ActOptions.scam.filler`). */
  readonly scamFiller?: LedgerUnit;
  /** Opt-in: marcas en los lotes comerciados y verificación del comprador (`life.marks`). */
  readonly marks?: boolean;
  /** Opt-in (con `loanSeeds`): contagio de quiebras entre hogares sobre los compromisos de `life.loans`, en la unidad dada (`life.contagion`). */
  readonly loanContagion?: string;
  /** Opt-in (con `loanContagion`): fama del quebrado rebajada y `rateMarkup` en la tasa de los acreedores arrastrados. */
  readonly loanContagionEffects?: { readonly rateMarkup: number };
  /** Opt-in (con `loanContagion` y `loanSeeds`): el acreedor del hogar caído renegocia o ejecuta la garantía (`life.workout`). */
  readonly loanWorkout?: boolean;
  readonly recipes: readonly RecipeDef[];
  /** Recetas de oficio y los hogares que las practican (economy §3); sin asignaciones no producen. */
  readonly tradeRecipes?: readonly TradeRecipeDef[];
  readonly householdTrades?: readonly TradeAssignment[];
  /** Opt-in: cada hogar elige oficio por habilidad y necesidad (`tradeSkills`: receta a habilidad) y lo guarda; sin esto sale del seed. */
  readonly tradeChoice?: { readonly tradeSkills: Readonly<Record<string, string>> };
  /** Opt-in: quien cruza a un hogar con oficio cree que vive de eso (`TRADE_VIEW`); apagado por defecto. */
  readonly tradeView?:
    | boolean
    | { readonly misread?: { readonly chance: number }; readonly people?: boolean };
  /** Opt-in: el aporte del jornalero a la bolsa común sale de su temperamento y los dependientes de su hogar (`personalPoolShareOf`), no del 70% fijo; apagado por defecto. */
  readonly personalPool?: boolean;
  /** Opt-in: chisme de precios y lugares (`life.gossip_molds`, tabla `MOLD_RUMORS`) desde lo que cada uno vio (`seeds`); apagado por defecto. */
  readonly moldGossip?: MoldGossipOptions;
  /** Opt-in: la decisión (`life.decide`) suma al ánimo lo que cree de oídas en `MOLD_RUMORS` (`moldHintMood`: ir donde cree que hay algo, comerciar un bien con precio oído); apagado por defecto: no lee la tabla. */
  readonly moldHints?: MoldHintOptions;
  /** Opt-in: necesidades del hogar; `moldHints.tradeWant` sale de ellas (`tradeWantFromNeeds`) si no trae uno; apagado por defecto. */
  readonly tradeNeeds?: HouseholdNeeds;
  /** Opt-in: sin `moldHints`, usa `catalogMoldHints(goods)` con `bySide` (comprar y vender se distinguen); apagado por defecto. */
  readonly moldHintsFromCatalog?: boolean;
  /** Préstamos de cosecha decididos de antemano (economy §8); sin semillas no hay préstamos. */
  readonly loanSeeds?: readonly LoanSeed[];
  /** Opt-in: ejecutores de los préstamos (la aldea como comunidad que reclama la mora, contracts §6). */
  readonly loanEnforcement?: {
    readonly community: string;
    /** Opt-in: tribunal y/o clan que reclaman la mora según lo que cree la gente (`enforcerClaims`). */
    readonly court?: string;
    readonly organization?: string;
  };
  /** Opt-in: el fiador subrogado cobra al deudor original en cuotas por ledger (`credit.subrogated_paid`). */
  readonly loanRepaySubrogation?: boolean;
  /** Opt-in: la mora con pérdida abre una servidumbre por deudas (`LoansOptions.bondage`). */
  readonly loanBondage?: BondageTerms;
  /** Opt-in (con `loanBondage`): `abuse.chance` sale del temperamento, la necesidad y la cultura del acreedor (`bondageAbuseChance`). */
  /** Opt-in (con `loanBondage`): `skillWage` sale del mejor oficio del deudor (`skillWageOf`) y escala `wagePerDay`. */
  readonly loanBondageSkillWage?: boolean;
  readonly loanBondageAbuse?: { readonly reputationCost: number };
  /** Opt-in: arriendos decididos de antemano (`life.rents`, tabla `RENTS`, `Commitment` "lease" entre hogares, canon por ledger); sin semillas no hay proceso. */
  readonly rentSeeds?: readonly RentSeed[];
  /** Opt-in: cada tanto arma ofertas y buscadores de arriendo desde el estado (`rentMarketFromState` + `matchRents`). */
  readonly rentMarket?: RentMarketOptions;
  /** Presión de escasez de alimento y su descarga (economy, hambruna); apagada por defecto: la aldea no cambia. */
  readonly famine?: Omit<FamineOptions, "clock" | "goods" | "placeOf">;
  /** Opt-in: hogares que deciden irse por la hambruna (`life.migration`, tabla `MIGRATIONS`); solo la decisión, no mueve a nadie. Apagado por defecto. */
  readonly migration?: Omit<MigrationOptions, "clock" | "goods" | "placeOf">;
  /** Opt-in: el agravio que llega por rumor mueve la relación del tercero (`AppraiseOptions.rumorGrievance`); apagado por defecto. */
  readonly rumorGrievance?: boolean;
  /** Opt-in: la reconstrucción «distinta» puede cambiar de material (`UpkeepOptions.swapMaterials`); apagado por defecto. */
  readonly swapMaterials?: boolean;
  readonly statuses: readonly StatusDef[];
  readonly cultureTraits: readonly TraitDef[];
  readonly speech: readonly SpeechLine[];
  readonly pressureCurves: readonly PressureCurve[];
  readonly schemas: readonly SchemaDef[];
  readonly values: readonly ValueDef[];
  readonly stages: readonly StageDef[];
  readonly relationDims: readonly DimensionDef[];
  readonly relationBonds: readonly BondDef[];
  readonly habits: readonly HabitDef[];
  /** Linajes silvestres y trayectorias de vegetación de la celda de la aldea (living-world §8, §9). */
  readonly lineages?: readonly LineageDef[];
  readonly trajectories?: readonly TrajectoryDef[];
  readonly divinations: readonly DivinationMethodDef[];
  readonly concerns: readonly ConcernWords[];
  /** El catálogo de gustos: da nombre a lo que `TASTES_OF` guarda por id (npc-psychology §16). */
  readonly tastes: readonly TasteDef[];
  /** La lengua y la etiqueta de habla de la aldea (la forma de lo dicho, dialogue §10). */
  readonly form?: ConverseForm;
  readonly scheduler: Scheduler;
  readonly player: AgentId;
}

export type LifeParts = Omit<LifeWorld, "scheduler" | "player">;

/** El lugar de un evento de alguien: la aldea si está en su hex, si no la celda. */
function placeOf(parts: LifeParts, village: PlaceRef) {
  return (truth: ReadonlyWorldTruth, who: AgentId): PlaceRef => {
    const at = truth.get(LOCATION, who);
    return at && at.space !== undefined ? village : { kind: "cell", cell: parts.map.cell };
  };
}

/** El scheduler de la vida, nuevo (en `now`) o retomado de un estado guardado. */
export function lifeWorld(
  parts: LifeParts,
  player: AgentId,
  village: PlaceRef,
  start: SchedulerState,
): LifeWorld {
  const altitudeOf = parts.realAltitude
    ? parts.travelAltitude
      ? travelAltitudeOf(parts.map, parts.travelAltitude, parts.spaces)
      : mapAltitudeOf(parts.map, parts.spaces)
    : undefined;
  const scheduler = new Scheduler(
    {
      rng: Rng.root(parts.seed),
      clock: parts.clock,
      truth: parts.truth,
      ids: parts.ids,
      log: parts.log,
      ledger: parts.ledger,
      processes: [
        perceiveProcess({
          player,
          map: parts.map,
          spaces: parts.spaces,
          clock: parts.clock,
          seed: parts.seed,
          statuses: parts.statuses,
          cultureTraits: parts.cultureTraits,
          relations: { dims: parts.relationDims, bonds: parts.relationBonds },
        }),
        witnessingProcess({
          player,
          map: parts.map,
          spaces: parts.spaces,
          clock: parts.clock,
          seed: parts.seed,
          statuses: parts.statuses,
        }),
        deedsProcess({
          map: parts.map,
          spaces: parts.spaces,
          clock: parts.clock,
          seed: parts.seed,
          statuses: parts.statuses,
          relations: { dims: parts.relationDims, bonds: parts.relationBonds },
        }),
        bodyProcess({
          plans: parts.plans,
          placeOf: placeOf(parts, village),
          ambientOf: ambientOf(parts),
          deficiency: parts.deficiencyEffects === true,
          reopen: parts.reopenWounds === true,
          thermal: parts.coreEffects === true,
          amputations: parts.frostbite === true && parts.amputationScars === true,
        }),
        actProcess({
          logMeals: parts.eatenNutrition === true,
          map: parts.map,
          spaces: parts.spaces,
          catalog: parts.catalog,
          skills: parts.skills,
          traits: parts.traits,
          bodyPlans: parts.plans,
          foods: parts.foods,
          goods: parts.goods,
          recipes: parts.recipes,
          statuses: parts.statuses,
          clock: parts.clock,
          seed: parts.seed,
          player,
          ...(altitudeOf ? { altitudeOf } : {}),
          ...(parts.frostbite === true ? { frostbite: true } : {}),
          ...(parts.glanceOnMove === true ? { glanceOnMove: true } : {}),
          ...(parts.coreEffects === true ? { coreEffects: true } : {}),
          ...(parts.nutritionCaps === true ? { nutritionCaps: true } : {}),
          ...(parts.consumables ? { consumables: parts.consumables } : {}),
          ...(parts.foodSubstances ? { foodSubstances: parts.foodSubstances } : {}),
          ...(parts.drinkSubstance ? { drinkSubstance: parts.drinkSubstance } : {}),
          ...(parts.boil ? { boil: parts.boil } : {}),
          ...(parts.filter ? { filter: parts.filter } : {}),
          ...(parts.waterSources?.netDrink === true
            ? {
                drinkQuality: waterHooks(
                  resolveWaterSources(parts.waterSources, parts.map, parts.clock, parts.seed),
                ).drinkQuality,
              }
            : {}),
          ...(parts.cravingCues === true ? { cravingCues: true } : {}),
          ...(parts.scam === true
            ? {
                scam: scamProviders({
                  dims: parts.relationDims,
                  bonds: parts.relationBonds,
                  traits: parts.traits,
                  need: scamNeedOf(parts.plans),
                  ...(parts.scamFiller === undefined ? {} : { filler: parts.scamFiller }),
                }),
              }
            : {}),
        }),
        ...(parts.scam === true
          ? [
              scamDiscoveryProcess({
                placeOf: placeOf(parts, village),
                eye: scamEyeOf(parts.traits),
                appraisers: scamEyeOf(parts.traits),
                witnesses: scamEyeOf(parts.traits),
                refund: scamRefundOf(parts.traits, scamNeedOf(parts.plans)),
                day: parts.clock.day,
              }),
            ]
          : []),
        ...(parts.loanContagion !== undefined
          ? [
              contagionProcess({
                unit: parts.loanContagion,
                placeOf: placeOf(parts, village),
                ...(parts.loanContagionEffects ? { fame: true } : {}),
              }),
            ]
          : []),
        ...(parts.loanContagion !== undefined && parts.loanWorkout === true
          ? [
              workoutProcess({
                unit: parts.loanContagion,
                placeOf: placeOf(parts, village),
                day: parts.clock.day,
                // Valor provisional de una parcela en prenda (a calibrar): 1 unidad por 10 m2.
                parcelValue: (_ref, parcel) => Math.floor(parcel.area / 10),
                lots: new Map(
                  (parts.loanSeeds ?? []).flatMap((s) =>
                    (s.collateral ?? []).flatMap((c) => (c.lot ? [[c.ref, c.lot] as const] : [])),
                  ),
                ),
              }),
            ]
          : []),
        ...(parts.marks === true
          ? [
              marksProcess({
                placeOf: placeOf(parts, village),
                eye: scamEyeOf(parts.traits),
                skill: forgeSkillOf(parts.traits),
              }),
            ]
          : []),
        ...(parts.scam === true && parts.scamFiller !== undefined
          ? [
              fillerNoticeProcess({
                placeOf: placeOf(parts, village),
                eye: scamEyeOf(parts.traits),
              }),
            ]
          : []),
        converseProcess({
          spaces: parts.spaces,
          catalog: parts.catalog,
          goods: parts.goods,
          statuses: parts.statuses,
          dims: parts.relationDims,
          bonds: parts.relationBonds,
          lines: parts.speech,
          traits: parts.traits,
          placeOf: placeOf(parts, village),
          day: parts.clock.day,
          year: parts.clock.year,
          ...(parts.form ? { form: parts.form } : {}),
        }),
        ...(parts.form
          ? [
              bornTaboosProcess({
                form: parts.form,
                clock: parts.clock,
                placeOf: placeOf(parts, village),
              }),
              bornTaboosSettleProcess({ village }),
              heardWordsProcess(),
              accentProcess({ player }),
            ]
          : []),
        testifyProcess({
          dims: parts.relationDims,
          bonds: parts.relationBonds,
          traits: parts.traits,
          placeOf: placeOf(parts, village),
        }),
        gossipProcess({
          dims: parts.relationDims,
          bonds: parts.relationBonds,
          traits: parts.traits,
          placeOf: placeOf(parts, village),
          player,
        }),
        ...(parts.moldGossip
          ? [
              moldGossipProcess(
                parts.moldGossip.fromLooking && !parts.moldGossip.fromLooking.siteOf
                  ? {
                      ...parts.moldGossip,
                      fromLooking: {
                        ...parts.moldGossip.fromLooking,
                        siteOf: lookSiteOf(village),
                      },
                    }
                  : parts.moldGossip,
              ),
            ]
          : []),
        askAroundProcess({ player, traits: parts.traits, placeOf: placeOf(parts, village) }),
        creditProcess({ day: parts.clock.day, placeOf: placeOf(parts, village) }),
        ...(parts.lendBorrowed === true && parts.borrowCraving
          ? [
              lendProcess({
                goods: parts.goods,
                dims: parts.relationDims,
                bonds: parts.relationBonds,
                day: parts.clock.day,
                player,
                placeOf: placeOf(parts, village),
              }),
            ]
          : []),
        ...(parts.repayDoses === true && parts.consumables
          ? [
              repayDoseProcess({
                goods: parts.goods,
                substances: parts.consumables.map((c) => c.good),
                player,
                placeOf: placeOf(parts, village),
              }),
            ]
          : []),
        pledgeProcess({ goods: parts.goods, placeOf: placeOf(parts, village) }),
        keepProcess({
          values: parts.values,
          schemas: parts.schemas,
          dims: parts.relationDims,
          bonds: parts.relationBonds,
          player,
          placeOf: placeOf(parts, village),
        }),
        pitchProcess({
          catalog: parts.catalog,
          goods: parts.goods,
          lines: parts.speech,
          player,
          day: parts.clock.day,
          placeOf: placeOf(parts, village),
        }),
        arrearsProcess({ day: parts.clock.day, placeOf: placeOf(parts, village) }),
        borrowProcess({
          foods: parts.foods,
          curves: parts.pressureCurves,
          player,
          placeOf: placeOf(parts, village),
        }),
        repayProcess({
          foods: parts.foods,
          player,
          placeOf: placeOf(parts, village),
        }),
        spoilageProcess({
          goods: parts.goods,
          clock: parts.clock,
          placeOf: placeOf(parts, village),
        }),
        soilProcess({ clock: parts.clock, map: parts.map, seed: parts.seed }),
        ecologyProcess({
          clock: parts.clock,
          map: parts.map,
          seed: parts.seed,
          lineages: parts.lineages ?? [],
          trajectories: parts.trajectories ?? [],
        }),
        tradesProcess({
          clock: parts.clock,
          goods: parts.goods,
          recipes: parts.tradeRecipes ?? [],
          assignments: parts.householdTrades ?? [],
          // Sin asignaciones explícitas, el oficio de cada hogar sale de la población.
          ...(parts.tradeChoice ? { chosen: true } : {}),
          ...(parts.personalPool ? { poolShareOf: personalPoolShareOf(parts.clock.year) } : {}),
          ...(parts.householdTrades === undefined && !parts.tradeChoice
            ? { seed: parts.seed }
            : {}),
          placeOf: placeOf(parts, village),
        }),
        marketProcess({ clock: parts.clock, goods: parts.goods }),
        ...(parts.tradeChoice
          ? [
              tradeChoiceProcess({
                clock: parts.clock,
                goods: parts.goods,
                recipes: parts.tradeRecipes ?? [],
                skills: parts.tradeChoice.tradeSkills,
              }),
            ]
          : []),
        ...(parts.tradeView
          ? [
              tradeViewProcess({
                clock: parts.clock,
                recipes: parts.tradeRecipes ?? [],
                assignments: parts.householdTrades ?? [],
                chosen: parts.tradeChoice !== undefined,
                ...(typeof parts.tradeView === "object" && parts.tradeView.misread
                  ? { misread: parts.tradeView.misread }
                  : {}),
                ...(typeof parts.tradeView === "object" && parts.tradeView.people
                  ? { people: true }
                  : {}),
              }),
            ]
          : []),
        neighborsProcess({ clock: parts.clock, goods: parts.goods }),
        loansProcess({
          clock: parts.clock,
          goods: parts.goods,
          seeds: parts.loanSeeds ?? [],
          placeOf: placeOf(parts, village),
          ...(parts.loanEnforcement
            ? {
                enforcement: {
                  community: parts.loanEnforcement.community,
                  ...(parts.loanEnforcement.court ? { court: parts.loanEnforcement.court } : {}),
                  ...(parts.loanEnforcement.organization
                    ? { organization: parts.loanEnforcement.organization }
                    : {}),
                },
                communityClaim: true,
                ...(parts.loanEnforcement.court || parts.loanEnforcement.organization
                  ? { enforcerClaims: true }
                  : {}),
              }
            : {}),
          ...(parts.loanRepaySubrogation ? { repaySubrogation: true } : {}),
          ...(parts.loanBondage
            ? {
                bondage: {
                  ...parts.loanBondage,
                  ...(parts.loanBondageSkillWage && !parts.loanBondage.skillWage
                    ? {
                        skillWage: (
                          (crafts) => (t: ReadonlyWorldTruth, who: AgentId) =>
                            skillWageOf(t, who, parts.loanBondage?.wagePerDay ?? 0, crafts)
                        )(craftSkillIds(parts.skills)),
                      }
                    : {}),
                  ...(parts.loanBondageAbuse && !parts.loanBondage.abuse
                    ? {
                        abuse: {
                          chance: bondageAbuseChance(parts.traits, scamNeedOf(parts.plans)),
                          reputationCost: parts.loanBondageAbuse.reputationCost,
                        },
                      }
                    : {}),
                },
              }
            : {}),
          ...(parts.loanContagion !== undefined && parts.loanContagionEffects
            ? { contagionCaution: parts.loanContagionEffects }
            : {}),
          ...(parts.relationDecay
            ? {
                relationDecay: {
                  dims: parts.relationDims,
                  bonds: parts.relationBonds,
                  schemaStrength: () => 0,
                },
              }
            : {}),
        }),
        ...((parts.rentSeeds && parts.rentSeeds.length > 0) || parts.rentMarket
          ? [
              rentsProcess({
                clock: parts.clock,
                goods: parts.goods,
                seeds: parts.rentSeeds ?? [],
                ...(parts.rentMarket ? { market: parts.rentMarket } : {}),
                placeOf: placeOf(parts, village),
              }),
              ...(parts.rentSeeds?.some((r) => r.kind === "sharecrop")
                ? [sharecropHarvestProcess({ placeOf: placeOf(parts, village) })]
                : []),
            ]
          : []),
        ...(parts.famine
          ? [
              famineProcess({
                ...parts.famine,
                clock: parts.clock,
                goods: parts.goods,
                placeOf: placeOf(parts, village),
              }),
            ]
          : []),
        ...(parts.migration
          ? [
              migrationProcess({
                ...parts.migration,
                clock: parts.clock,
                goods: parts.goods,
                placeOf: placeOf(parts, village),
              }),
            ]
          : []),
        exposureProcess({
          clock: parts.clock,
          seeds: parts.pathogenSeeds ?? [],
          ...(parts.waterSources
            ? {
                waterFor: waterHooks(
                  resolveWaterSources(parts.waterSources, parts.map, parts.clock, parts.seed),
                ).waterFor,
              }
            : {}),
          deficiency: parts.deficiencyEffects === true,
          ...(parts.gatheringContact
            ? { gatherings: gatheringsFor({ clock: parts.clock, rng: Rng.root(parts.seed) }) }
            : {}),
          placeOf: placeOf(parts, village),
        }),
        medicineProcess({
          clock: parts.clock,
          healers: parts.healers ?? [],
          school: parts.healerSchool,
          stock: parts.remedyStock,
          doses: parts.remedyDoses,
          substanceSigns: parts.healerSubstanceSigns === true,
          frostbiteSigns: parts.healerFrostbiteSigns === true,
          frostbiteOrders: parts.frostbite === true && parts.healerFrostbiteOrders === true,
          altitudeSigns: parts.healerAltitudeSigns === true ? altitudeOf : undefined,
          plans: parts.healerRealSigns === true ? parts.plans : undefined,
          deficiencySigns: parts.deficiencySigns === true,
          placeOf: placeOf(parts, village),
        }),
        substancesProcess({
          clock: parts.clock,
          doses: parts.substanceDoses ?? [],
          treatmentDoses: parts.remedyDoses !== undefined,
          placeOf: placeOf(parts, village),
        }),
        nutritionProcess({
          clock: parts.clock,
          profiles: parts.nutrientProfiles ?? [],
          diet: parts.diets?.find((d) => d.id === "village"),
          useEaten: parts.eatenNutrition === true,
          lethal: parts.malnutritionDeath === true,
          placeOf: placeOf(parts, village),
        }),
        ...(parts.growthSequelae === true ? [growthSequelaeProcess({ clock: parts.clock })] : []),
        ...(parts.adultGrowth === true
          ? [
              adultGrowthProcess({
                clock: parts.clock,
                plans: parts.plans,
                traits: parts.traits,
                gradual: parts.gradualGrowth === true,
              }),
            ]
          : []),
        thermalProcess({
          clock: parts.clock,
          map: parts.map,
          spaces: parts.spaces,
          seed: parts.seed,
          placeOf: placeOf(parts, village),
          ...(altitudeOf ? { altitude: { baseM: parts.map.baseElevationM ?? 0, altitudeOf } } : {}),
          ...(parts.frostbite === true ? { frostbite: true } : {}),
          ...(parts.frostbite === true && parts.frostbiteTreatment === true
            ? { frostbiteTreatment: true }
            : {}),
          ...(parts.frostbite === true &&
          parts.frostbiteTreatment === true &&
          parts.frostbiteSupplies
            ? { frostbiteSupplies: parts.frostbiteSupplies }
            : {}),
          ...(parts.frostbite === true &&
          parts.frostbiteTreatment === true &&
          parts.frostbiteSelfCare === true
            ? {
                frostbiteSelfCare: {
                  skillOf: (_t: unknown, who: AgentId) =>
                    parts.healers?.find((h) => h.agent === who)?.skill ?? 0,
                },
              }
            : {}),
        }),
        ...(altitudeOf
          ? [
              altitudeProcess({
                clock: parts.clock,
                altitudeOf,
                genomeAdaptation: parts.altitudeGenome === true,
              }),
            ]
          : []),
        upkeepProcess({
          clock: parts.clock,
          map: parts.map,
          seed: parts.seed,
          materials: parts.materials ?? [],
          ...(parts.swapMaterials ? { swapMaterials: true } : {}),
        }),
        upbringingProcess({
          clock: parts.clock,
          bodyPlans: parts.plans,
          foods: parts.foods,
          dims: parts.relationDims,
          bonds: parts.relationBonds,
          placeOf: placeOf(parts, village),
        }),
        appraiseProcess({
          clock: parts.clock,
          schemas: parts.schemas,
          stages: parts.stages,
          dims: parts.relationDims,
          bonds: parts.relationBonds,
          habits: parts.habits,
          traits: parts.traits,
          values: parts.values,
          ...(parts.rumorGrievance ? { rumorGrievance: true } : {}),
          witness: {
            player,
            map: parts.map,
            spaces: parts.spaces,
            clock: parts.clock,
            seed: parts.seed,
            statuses: parts.statuses,
          },
        }),
        conscienceProcess({
          dims: parts.relationDims,
          bonds: parts.relationBonds,
          traits: parts.traits,
          values: parts.values,
          schemas: parts.schemas,
          placeOf: placeOf(parts, village),
        }),
        sleepProcess({
          clock: parts.clock,
          seed: parts.seed,
          schemas: parts.schemas,
          dims: parts.relationDims,
          bonds: parts.relationBonds,
          ambientOf: ambientOf(parts),
          placeOf: placeOf(parts, village),
        }),
        observeProcess({ clock: parts.clock, map: parts.map }),
        ponderProcess(),
        divinersProcess({
          methods: parts.divinations,
          concerns: parts.concerns,
          clock: parts.clock,
          placeOf: placeOf(parts, village),
        }),
        retoldProcess(),
        consultProcess({
          methods: parts.divinations,
          concerns: parts.concerns,
          clock: parts.clock,
          placeOf: placeOf(parts, village),
        }),
        visitsProcess({
          methods: parts.divinations,
          concerns: parts.concerns,
          clock: parts.clock,
          placeOf: placeOf(parts, village),
          player,
        }),
        intrusionProcess({ seed: parts.seed, placeOf: placeOf(parts, village) }),
        companyProcess({
          dims: parts.relationDims,
          bonds: parts.relationBonds,
        }),
        inventoryProcess({ player }),
        knowingProcess({
          player,
          map: parts.map,
          spaces: parts.spaces,
          clock: parts.clock,
          seed: parts.seed,
          statuses: parts.statuses,
          dims: parts.relationDims,
          bonds: parts.relationBonds,
        }),
        lookingProcess({
          player,
          map: parts.map,
          spaces: parts.spaces,
          clock: parts.clock,
          seed: parts.seed,
          statuses: parts.statuses,
        }),
        standingProcess({
          player,
          map: parts.map,
          spaces: parts.spaces,
          clock: parts.clock,
          seed: parts.seed,
          statuses: parts.statuses,
          dims: parts.relationDims,
          bonds: parts.relationBonds,
          placeOf: placeOf(parts, village),
        }),
        decideProcess({
          clock: parts.clock,
          catalog: parts.catalog,
          skills: parts.skills,
          traits: parts.traits,
          bodyPlans: parts.plans,
          values: parts.values,
          schemas: parts.schemas,
          stages: parts.stages,
          dims: parts.relationDims,
          bonds: parts.relationBonds,
          goods: parts.goods,
          habits: parts.habits,
          player,
          placeOf: placeOf(parts, village),
          ...(altitudeOf ? { altitudeOf } : {}),
          ...(parts.frostbite === true ? { frostbite: true } : {}),
          ...(parts.coreEffects === true ? { coreEffects: true } : {}),
          ...(parts.nutritionCaps === true ? { nutritionCaps: true } : {}),
          ...(parts.consumables ? { consumables: parts.consumables } : {}),
          ...(parts.buyCraving ? { buyCraving: parts.buyCraving } : {}),
          ...(parts.gatherCraving ? { gatherCraving: parts.gatherCraving } : {}),
          ...(parts.borrowCraving ? { borrowCraving: parts.borrowCraving } : {}),
          ...(parts.foodSubstances ? { foodSubstances: parts.foodSubstances } : {}),
          ...(parts.drinkSubstance ? { drinkSubstance: parts.drinkSubstance } : {}),
          ...(parts.cravingCues === true ? { cravingCues: true } : {}),
          ...(parts.cravingCues === true && parts.cueLocal === true
            ? { cueLocal: { lonDeg: parts.map.lonDeg } }
            : {}),
          ...(() => {
            const base: MoldHintOptions | undefined = parts.moldHints
              ? parts.moldHints
              : parts.moldHintsFromCatalog === true
                ? { ...catalogMoldHints(parts.goods), bySide: true, buyCandidates: true }
                : undefined;
            if (!base) return {};
            return parts.tradeNeeds && !base.tradeWant
              ? { moldHints: { ...base, tradeWant: tradeWantFromNeeds(parts.tradeNeeds) } }
              : { moldHints: base };
          })(),
          ...(parts.boil && parts.npcBoil ? { boilThirst: parts.npcBoil } : {}),
        }),
        routineProcess({
          ...(parts.boil && parts.npcBoil ? { boil: parts.boil } : {}),
          logMeals: parts.eatenNutrition === true,
          ...(parts.waterSources
            ? {
                drinkQuality: waterHooks(
                  resolveWaterSources(parts.waterSources, parts.map, parts.clock, parts.seed),
                ).drinkQuality,
              }
            : {}),
          map: parts.map,
          spaces: parts.spaces,
          bodyPlans: parts.plans,
          foods: parts.foods,
          clock: parts.clock,
          seed: parts.seed,
          placeOf: placeOf(parts, village),
        }),
      ],
      resolution: "local",
      scopes: (kind, t) =>
        kind === "agent" ? living(t) : kind === "household" ? householdsOf(t) : [],
    },
    start,
  );
  return { ...parts, scheduler, player };
}

export { makeId };
