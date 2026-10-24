// La vida en memoria: la verdad, el registro, el ledger y el scheduler con los procesos de la
// Fase 1, más lo derivado del seed y del contenido que no se guarda (mapa, espacios, catálogos).

import type {
  AgentId,
  EntityRef,
  EventLog,
  IdAllocator,
  Ledger,
  LedgerUnit,
  PlaceRef,
  PlanetClock,
  Seed,
  Tick,
} from "../../core/index.ts";
import { ledgerUnit, makeId, Rng } from "../../core/index.ts";
import {
  type ActionCatalog,
  type BodyPlanDef,
  type BondDef,
  bodyProcess,
  type ConcernWords,
  type Demography,
  type DietDef,
  type DimensionDef,
  type DivinationMethodDef,
  type FoodDef,
  type GoodDef,
  goodUnit,
  type HabitDef,
  KNOWN_DEEDS,
  type LineageDef,
  LOCATION,
  type LocalMap,
  localHour,
  type MaterialDef,
  type MentalLabelDef,
  type NutrientProfileDef,
  nameRules,
  oscillationYearOfMap,
  outdoorTempC,
  PERSON,
  type PressureCurve,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type RecipeDef,
  RUMORS,
  rainBetween,
  Scheduler,
  type SchedulerState,
  type SchemaDef,
  type SkillCatalog,
  type SpaceGraph,
  type SpeechLine,
  type StageDef,
  type StatusDef,
  type TasteDef,
  type TechCatalog,
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
  type TravelCellOptions,
  travelAltitudeOf,
  travelCellProcess,
} from "./altitude.ts";
import { ambientOf } from "./ambient.ts";
import { type AmbientQi, ambientQiCOf } from "./ambientQi.ts";
import { APPRAISE_PROCESS, appraiseProcess } from "./appraise.ts";
import { askAroundProcess } from "./askaround.ts";
import { type BanditsOptions, banditsProcess } from "./bandits.ts";
import { belongingProcess } from "./belonging.ts";
import { birthProcess, newbornBondsProcess } from "./birth.ts";
import { bondageAbuseChance, craftSkillIds, skillWageOf } from "./bondagepolicy.ts";
import { borrowProcess, repayProcess } from "./borrow.ts";
import { personalPoolShareOf } from "./budget.ts";
import { CLOAK, carriedCloakClo, cloakWearProcess, roadClothing } from "./cloak.ts";
import { cloakMendProcess } from "./cloak-mend.ts";
import { companyProcess } from "./company.ts";
import { conceptionProcess, PREGNANCY, pregnancyLabors } from "./conception.ts";
import { conditionBeliefsProcess } from "./condition-beliefs.ts";
import { conscienceProcess } from "./conscience.ts";
import { contagionProcess } from "./contagion.ts";
import { type ConverseForm, converseProcess, OPEN_DEALS } from "./converse.ts";
import { conversationSettlementProcess } from "./converse-economy.ts";
import { converseProjectionProcess } from "./converse-project.ts";
import { type CoopOptions, coopProcess } from "./coop.ts";
import { type CouncilOptions, councilProcess } from "./council.ts";
import { type CouncilCasesOptions, councilCasesProcess } from "./council-cases.ts";
import { villageAuthority } from "./councilauthority.ts";
import { arrearsProcess, creditProcess } from "./credit.ts";
import type { ViewCues } from "./cue-local.ts";
import { debtKnowledgeProcess } from "./debtknowledge.ts";
import { debtorRepairProcess } from "./debtorrepair.ts";
import { decideProcess } from "./decide.ts";
import { DEEDS_PROCESS, deedsProcess } from "./deeds.ts";
import { consultProcess, divinersProcess, retoldProcess, visitsProcess } from "./divine.ts";
import { ecologyProcess } from "./ecology.ts";
import type { ErrandOptions } from "./errands.ts";
import { exposureProcess, type PathogenSeed } from "./exposure.ts";
import { type FamineOptions, famineProcess } from "./famine.ts";
import { footwearMendProcess } from "./footwear-mend.ts";
import { footwearRoadMendProcess } from "./footwear-road-mend.ts";
import { forecastBeforeLeaving } from "./forecast.ts";
import type { FuneralOptions } from "./funerals.ts";
import { gatheringsFor } from "./gathering-provider.ts";
import { goalDeathClosureProcess } from "./goal-death.ts";
import { debtGoalProgress, ownGoalProgress } from "./goal-evidence.ts";
import { gossipProcess } from "./gossip.ts";
import { growthSequelaeProcess } from "./growthSequelae.ts";
import { hireProcess } from "./hire.ts";
import { intrusionProcess } from "./intrusion.ts";
import { inventoryProcess } from "./inventory-belief.ts";
import { type AfflictedOrigin, journeySeeds } from "./journey-arrivals.ts";
import { keepProcess } from "./keep.ts";
import { knowingProcess, toldClaimsProcess } from "./knowing.ts";
import { type HeedStanding, lendProcess, repayDoseProcess } from "./lend.ts";
import { living } from "./living.ts";
import { type BondageTerms, type LoanSeed, loansProcess, type UsuryOptions } from "./loans.ts";
import { lookingProcess } from "./looking.ts";
import { harvestSeasonOf } from "./map.ts";
import { marketProcess } from "./market.ts";
import {
  believedMarkRenownBy,
  clearedRenown,
  MARK_CLEARED,
  MARK_EXPOSURE_PROCESS,
  markExposureProcess,
} from "./markexposure.ts";
import { marksProcess } from "./marks.ts";
import {
  type Healer,
  type HealerSchool,
  medicineProcess,
  type RemedyDose,
  type RemedyDosing,
} from "./medicine.ts";
import { type Labor, laborProcess, puerperalSeeds } from "./midwife.ts";
import { type MigrationOptions, migrationProcess } from "./migration.ts";
import {
  catalogMoldHints,
  type HouseholdNeeds,
  lookSiteOf,
  MOLD_RUMORS,
  type MoldGossipOptions,
  type MoldHintOptions,
  moldGossipProcess,
  renownBelieved,
  renownWeighed,
  tradeWantFromNeeds,
} from "./moldgossip.ts";
import { neighborsProcess } from "./neighbors.ts";
import { npcEncountersProcess } from "./npc-encounters.ts";
import { lexicalGreetingSpeech } from "./npc-greeting-speech.ts";
import { npcGreetingsProcess } from "./npc-greetings.ts";
import { npcInterruptProcess, npcReactProcess } from "./npc-interrupt.ts";
import { npcTracesProcess } from "./npc-traces.ts";
import { NPC_JOURNEY, npcVerbsProcess } from "./npc-verbs.ts";
import { npcWarningsProcess } from "./npc-warnings.ts";
import { nutritionProcess } from "./nutrition.ts";
import { observeProcess } from "./observe.ts";
import { offeringsProcess } from "./offerings.ts";
import { oscillationEventsProcess } from "./oscillation-events.ts";
import { householdAuthority, realTrust } from "./patientbonds.ts";
import {
  type PawnLots,
  type PawnOpenOptions,
  type PawnWantOptions,
  pawnOpenProcess,
  pawnProcess,
} from "./pawn.ts";
import { pawnDecideProcess } from "./pawndecide.ts";
import { perceiveProcess } from "./perceive.ts";
import { pitchProcess } from "./pitch.ts";
import { pledgeProcess } from "./pledges.ts";
import { ponderProcess } from "./ponder.ts";
import { practiceLogProcess } from "./practice-log.ts";
import {
  type RentMarketOptions,
  type RentSeed,
  rentsProcess,
  sharecropHarvestProcess,
} from "./rents.ts";
import { RESERVOIR, type ReservoirHost, reservoirProcess, reservoirSeeds } from "./reservoirs.ts";
import { type ResidueConfig, residueProcess } from "./residue.ts";
import { ROUTINE, routineProcess } from "./routine.ts";
import { fillerNoticeProcess, scamDiscoveryProcess } from "./scamdiscovery.ts";
import { forgeSkillOf, scamEyeOf, scamNeedOf, scamProviders, scamRefundOf } from "./scampolicy.ts";
import { schemerViewOf } from "./schemepolicy.ts";
import { type SchemesOptions, schemesProcess } from "./schemes.ts";
import { sleepProcess } from "./sleep.ts";
import {
  ASLEEP,
  CATCH_UP_DAILY_PROCESS,
  CATCH_UP_WAKE_PROCESS,
  catchUpDue,
  catchUpProcess,
  sleepPolicyProcess,
  sleepWorkPending,
} from "./sleepers.ts";
import { soilProcess } from "./soil.ts";
import type { SpeakActsOptions } from "./speakacts.ts";
import { householdsOf, spoilageProcess } from "./spoilage.ts";
import { stagesProcess } from "./stages.ts";
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
import type { TakeBelievedOptions } from "./takeillicit.ts";
import { techTeachProcess } from "./techknow.ts";
import { testifyProcess } from "./testify.ts";
import { seasonalClothing, thermalProcess } from "./thermal.ts";
import { tradeProjectionProcess } from "./trade-projection.ts";
import { tradeChoiceProcess } from "./tradechoice.ts";
import { type TradeAssignment, tradesProcess } from "./trades.ts";
import { tradeViewProcess } from "./tradeview.ts";
import { transitProcess } from "./transit.ts";
import { upbringingProcess } from "./upbringing.ts";
import { upkeepProcess } from "./upkeep.ts";
import { usuryGossipProcess } from "./usurygossip.ts";
import { watchingProjectionProcess } from "./watching-project.ts";
import { resolveWaterSources, type WaterSourcesConfig, waterHooks } from "./waterSources.ts";
import { wildProcess } from "./wild.ts";
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
  /** Opt-in (body-health §6): orígenes con epidemia; quien parte de ahí en un viaje abierto lleva el patógeno (`journeySeeds`). */
  readonly afflictedOrigins?: readonly AfflictedOrigin[];
  /** Opt-in (body-health §6): reservorios del patógeno en la ecología de la celda (bestias, agua quieta); quien los toca tira el derrame (`reservoirSeeds`). */
  readonly reservoirs?: readonly ReservoirHost[];
  /** Sanadores explícitos (body-health §6): diagnostican y tratan a los enfermos; sin ellos no hacen nada. */
  readonly healers?: readonly Healer[];
  /** Escuela de sanadores desde las habilidades (`medicine`); sin ella solo cuentan los explícitos. */
  readonly healerSchool?: HealerSchool;
  /** Opt-in: la escuela de cada sanador por habilidad según su comunidad (`schoolOfPerson`); cae a `healerSchool`. */
  readonly healerSchoolOf?: (truth: ReadonlyWorldTruth, who: AgentId) => HealerSchool | undefined;
  /** Opt-in: los signos que ve el sanador salen del cuerpo real (`bodySigns`). */
  readonly healerRealSigns?: boolean;
  /**
   * Opt-in (la fama viaja con `moldGossip.fromHealing`): el enfermo elige sanador por la
   * fama que cree (rumor `renown` de su libro) y le paga `healerFee` (base `base`, en `unit`) con asiento.
   */
  readonly healerFee?: {
    readonly unit: string;
    readonly base: number;
    /** Opt-in: la fama oída pesa por la fe que le tiene (`renownWeighed`) y no entera. */
    readonly byConfidence?: boolean;
  };
  /**
   * Opt-in (body-health §6): la cuarentena la decide el paciente (`patientDecides`); la confianza en el
   * sanador sale de la fama que cree (`renownBelieved`); con `secondOpinion` el que discrepa llama a otro.
   */
  readonly patientDecides?: {
    readonly contagionBelief?: Readonly<Record<string, number>>;
    readonly caution?: number;
    readonly secondOpinion?: boolean;
    /**
     * Opt-in: la autoridad sale del jefe del hogar real (`householdAuthority`: lo que él cree que se
     * pega por el respeto del paciente) y la confianza de la relación real (`realTrust`, con la fama
     * que cree de respaldo). Sin esto, la confianza es la fama creída y no hay autoridad.
     */
    readonly realBonds?: boolean;
    /** Opt-in (con `realBonds`): `contagionBelief` y el jefe del hogar salen de rasgos de la cultura de la aldea. */
    readonly cultureTraits?: { readonly contagion?: string; readonly head?: string };
    /**
     * Opt-in (con `realBonds`; el consejo sale de `council`): `authorityOf` combina al jefe del hogar
     * con los miembros del consejo de la aldea (`villageAuthority`, `combineAuthorities`): cada uno
     * pesa lo que cree que se pega por su rango y por el respeto del paciente. Sin esto, solo el hogar.
     */
    readonly councilAuthority?: { readonly headStrength?: number; readonly elderStrength?: number };
  };
  /**
   * Opt-in (body-health §6, family-lineage §3): partos a término. A la hora, el hogar llama a quien
   * tiene `medicine` (por la fama que cree, con `healerFee` si está) si cree el parto riesgoso, y la
   * habilidad de la partera baja el riesgo (`life.labor`, tabla `LABOR`). Sin esto, nada.
   */
  readonly labors?: readonly Labor[];
  /** Miedo del hogar al parto (se suma al riesgo creído; por defecto 0). */
  readonly laborCaution?: number;
  /**
   * Opt-in (family-lineage §3): una casada con el marido vivo concibe con la fecundidad de su edad
   * (`life.conception`, tabla `PREGNANCY`, evento `family.conception`) y su parto lo resuelve
   * `life.labor` con la partera. Exige `demography`. Apagado, nadie concibe en la vida viva.
   */
  readonly conception?: boolean;
  /**
   * Opt-in (con `conception`): el niño que no murió en el parto nace como persona (`life.birth`,
   * evento `family.birth`, genoma heredado, cuerpo de recién nacido, hogar de la madre). Apagado, el
   * parto resuelve a la madre y al niño pero no crea a nadie.
   */
  readonly births?: boolean;
  /** Con `conception`: multiplica la fecundidad (por defecto 1; calibrar o tests cortos). */
  readonly conceptionRateScale?: number;
  /** Con `conception`: días de embarazo (por defecto 280; tests cortos). */
  readonly conceptionGestationDays?: number;
  readonly demography?: Pick<Demography, "fertility">;
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
  /** Opt-in (con `remedyDoses`): la dosis sale del lote gastado (calidad, tomas) y de la masa del enfermo. */
  readonly remedyDosing?: RemedyDosing;
  /** Perfiles de nutrientes por alimento y dieta de referencia (body-health §5); sin dieta no hay reservas. */
  readonly nutrientProfiles?: readonly NutrientProfileDef[];
  readonly diets?: readonly DietDef[];
  /** Lo comido de verdad alimenta las reservas (`MEALS`); apagado por defecto: la aldea no cambia. */
  readonly eatenNutrition?: boolean;
  /** Con `eatenNutrition`: la necesidad suma embarazo y esfuerzo (fatiga); apagado por defecto. */
  readonly nutritionNeeds?: boolean;
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
  /** Opt-in (con `realAltitude`): celda por la que pasa quien viaja (la del `Journey`); `life.travel_cell` la escribe en `TRAVEL_CELL` cada día y la borra al llegar al parche. */
  readonly travelCell?: TravelCellOptions["cellOf"];
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
  /** Replay de motores anteriores a `life-4`: un registro por paso fallido repetido; ver `ActOptions.verboseSteps`. */
  readonly verboseSteps?: boolean;
  /** Replay de motores anteriores a `life-5`: esperar de noche no duerme; ver `BodyProcessOptions.nightRest`. */
  readonly waitAwake?: boolean;
  /** Replay de motores anteriores a `life-6`: nadie bebe ni come por quien espera; ver `RoutineOptions.waitTend`. */
  readonly waitUntended?: boolean;
  /** Replay de motores anteriores a `life-7`: quien espera no lleva odre; ver `RoutineOptions.waitSkin`. */
  readonly waitNoSkin?: boolean;
  /** Replay de motores anteriores a `life-8`: la deuda de sueño no tiene tope (`BodyProcessOptions.sleepCap`). */
  readonly sleepUncapped?: boolean;
  /** Replay de motores anteriores a `life-9`: todo tropezón es una caída; ver `ActOptions.legacyFalls`. */
  readonly legacyFalls?: boolean;
  /** Replay de motores anteriores a `life-10`: `tend` solo la herida peor; ver `ActOptions.legacyTend`. */
  readonly legacyTend?: boolean;
  /** Replay de motores anteriores a `life-11`: el `resume` del camino no se apaga; ver `ActOptions.legacyResume`. */
  readonly legacyResume?: boolean;
  /** Replay de motores anteriores a `life-27`: sin `perceiveCascade` en deeds y mark_exposure. */
  readonly legacyNoPerceiveCascade?: boolean;
  /** Replay de motores anteriores a `life-28`: `life.appraise` sin la segunda ronda de `scam.discovered`. */
  readonly legacyNoAppraiseCascade?: boolean;
  /** Replay de motores anteriores a `life-30`: `life.lend`, `life.repay_dose` y `life.pawn_decide` fuera del dominio económico. */
  readonly legacyNoLendPawnBatch?: boolean;
  /** Replay de motores anteriores a `life-31`: `trade` no mira `ENTITY.endedAt` de la contraparte. */
  readonly legacyNoDeadCounterpartyGuard?: boolean;
  /** Replay de motores anteriores a `life-36`: `give` no mira `ENTITY.endedAt` del destinatario. */
  readonly legacyNoDeadGiveGuard?: boolean;
  /** Replay de motores anteriores a `life-37`: lo oído (`HEARD`) no entra a `BELIEFS` como `told`. */
  readonly legacyNoToldBeliefs?: boolean;
  /** Replay de motores anteriores a `life-38`: `lexiconOf`, `ownBelief`, `heardClash` y `moldgossip.fromHeard` leen `HEARD`, no `BELIEFS`. */
  readonly legacyHeardReaders?: boolean;
  /** Replay de motores anteriores a `life-39`: lo oído se escribe en `HEARD`, no en `action.speak` + `BELIEFS`. */
  readonly legacyHeardTable?: boolean;
  /** Replay de motores anteriores a `life-40`: los nombres de una o dos letras no se alargan. */
  readonly legacyShortNames?: boolean;
  /** Replay de motores anteriores a `life-41`: `speak` dura 300 s fijos. */
  readonly legacyFixedSpeech?: boolean;
  /** Replay de motores anteriores a `life-42`: los `move` de los NPC a la aldea no caminan. */
  readonly legacyNoSettlementWalk?: boolean;
  /** Replay de motores anteriores a `life-43`: `take` en casa no saca de la despensa. */
  readonly legacyNoLarderTake?: boolean;
  /** Replay de motores anteriores a `life-32`: la espera por lluvia pierde el recado `move` al vencer el día. */
  readonly legacyNoRainWaitPersist?: boolean;
  /** Solo el replay de un motor anterior a `life-33`: el saludo al cruzarse lo hace `life.npc_greetings` con efecto directo, no la decisión `speak`. */
  readonly legacyNoGreetDecision?: boolean;
  /** Solo el replay de un motor anterior a `life-34`: la hambruna no cita la oscilación oceánica entre sus causas. */
  readonly legacyNoOscillationCause?: boolean;
  /** Solo el replay de un motor anterior a `life-35`: sin eventos de sequía e inundación ni campo anegado (el mapa ya lo trae armado). */
  readonly legacyNoOscillationEvents?: boolean;
  /** Replay de motores anteriores a `life-29`: el mapa no lleva cuenca (ya aplicado al armarlo; se guarda por trazabilidad). */
  readonly legacyNoOscillation?: boolean;
  /** Replay de motores anteriores a `life-12`: quien espera come solo puertas adentro; ver `RoutineOptions.waitEatVillage`. */
  readonly waitEatHomeOnly?: boolean;
  /** Replay de motores anteriores a `life-13`: nadie da de beber al inconsciente; ver `RoutineOptions.careWater`. */
  readonly legacyNoCare?: boolean;
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
  /** Opt-in (con `moldHints`): `take` sobre bienes que cree que tiene un conocido, con sanción por los robos que conoce (`life.decide`); apagado, sin candidata nueva. */
  readonly takeBelieved?: TakeBelievedOptions;
  /** Opt-in: candidatas `move` hacia lugares de otro hex (`life.decide`); apagado, sin candidata nueva. */
  readonly errands?: ErrandOptions;
  /** Opt-in: `speak` con acto declarado (saludar, preguntar) desde afecto y familiaridad (`life.decide`); apagado, sin candidata nueva. */
  readonly speakActs?: SpeakActsOptions;
  /** Opt-in (con `borrowCraving`): el pedido se ejecuta (`life.lend`): el prestamista decide, pasa una dosis por el libro mayor y queda un fiado; si no la tenía, el rumor `has` se debilita. Apagado, el pedido no hace nada. */
  readonly lendBorrowed?: boolean;
  /** Opt-in (con `consumables`): el hogar que debe una sustancia y ya la tiene la devuelve en especie por el libro mayor (`life.repay_dose`); si no, el vencimiento la vuelve mora. Apagado, sin proceso. */
  readonly repayDoses?: boolean;
  /** Opt-in: la decisión `move` hacia un lugar se ejecuta en la rutina diaria (`RoutineOptions.npcMove`); apagado, sin cambios. */
  readonly npcMove?: boolean;
  /** Opt-in: el personaje del jugador sin plan en curso sigue la rutina del hogar (come, bebe, trabaja) como cualquiera: la corrida sin jugador (`sim:batch`) no lo deja morir de sed al tercer día (`RoutineOptions.idlePlayer`). */
  readonly idlePlayerRoutine?: boolean;
  /**
   * Opt-in (tier 1, simulation §4.2): quien está a más de `near` hexes del personaje, sin vínculo
   * de hogar con él, se duerme (`ASLEEP`): deja de correr `body.physiology`, `life.routine` y
   * `life.decide` y `life.catch_up` lo pone al día por tramos al despertar o una vez por día,
   * comiendo `food` (id del alimento) de la despensa del hogar. Apagado, sin procesos ni cambios.
   */
  readonly sleepers?: { readonly near: number; readonly food: string };
  /** Solo medición (no entra al estado ni al hash): se llama tras cada ejecución de proceso con cuántos cambios y eventos devolvió. */
  readonly runProbe?: (process: string, changes: number, events: number, ms?: number) => void;
  /** Solo medición: reloj inyectado en ms; con él `runProbe` recibe lo que tardó cada ejecución. */
  readonly runClock?: () => number;
  /** Opt-in: verbos del catálogo cuya decisión el NPC ejecuta como plan (`life.npc_verbs`, por ahora `gather`); apagado, sin proceso. */
  readonly npcVerbs?: readonly string[];
  /** Opt-in (con `npcVerbs`): un signo grave nuevo del cuerpo corta el plan del NPC (viaje y plantillas incluidos) y deja el resultado parcial en `npc.interrupted` (`life.npc_interrupt`); apagado, sin proceso. */
  readonly npcInterrupt?: boolean;
  /** Ver `LifeOptions.npcResumeReevaluate`. */
  readonly npcResumeReevaluate?: boolean;
  /** Opt-in (con `npcJourneyDays`, mejor con `npcTransit`): el viajero se cruza con quien comparte su hex (`npc.crossed`, `life.npc_encounters`); apagado, sin proceso. */
  readonly npcEncounters?: boolean;
  /** Opt-in (con `npcEncounters`): el viajero deja rastros en los hexes que pisa y nota los de otros como creencia (`npc.trace_seen`, `life.npc_traces`); apagado, sin proceso. */
  readonly npcTraces?: boolean;
  /** Opt-in (con `npcTraces`): quien se cruzó y sigue en el hex le cuenta al otro los rastros que vio (`npc.warned`, `life.npc_warnings`); lo oído queda aparte como creencia de oídas. */
  readonly npcWarnings?: boolean;
  /** Opt-in (con `npcEncounters`): quienes se cruzaron y siguen en el hex se saludan (`npc.greeted`, `life.npc_greetings`), con familiaridad, afecto y confianza a ambos lados; apagado, sin proceso. */
  readonly npcGreetings?: boolean;
  /** Opt-in (con `npcGreetings`): el saludo de palabras se dice y el otro lo entiende (`understand`); sin entender un saludo no se entibia (`GreetingSpeech`). */
  readonly npcGreetingSpeech?: boolean;
  /** Opt-in (con `npcTraces`): horas que aguanta la carga caída antes de pudrirse. */
  readonly npcDropRotHours?: number;
  /** Opt-in (con `npcTraces` y `npcProvisions`): el dueño que vuelve al hex donde dejó caer su carga la reclama (`npc.load_reclaimed`) y tiene prioridad sobre quien la halle. */
  readonly npcDropReclaim?: boolean;
  /** Opt-in (con `npcTraces` y `npcProvisions`): id de un linaje de la ecología de la celda que se come lo caído en el camino (`npc.load_eaten`, sumidero `eaten`); la chance sale de cuántos animales hay. */
  readonly npcDropScavenge?: string;
  /** Opt-in (con `npcTraces` y `npcProvisions`): la carga se pierde por causas (tropiezo con fatiga, peso, fuga si `liquid`) con efecto distinto sobre lo caído (`npc.load_dropped` con `cause`, `npc.load_leaked`). */
  readonly npcDropCauses?: { readonly liquid?: boolean };
  /** Opt-in (con `npcVerbs`): verbo -> id de plantilla de `content/plans/` que el NPC ejecuta en vez del verbo suelto (`NpcVerbsOptions.templates`). */
  readonly npcTemplates?: Readonly<Record<string, string>>;
  /** Opt-in (con `npcVerbs` que incluya `move`): ir a un lugar abre un viaje que sigue hasta N días (`NpcVerbsOptions.journeyDays`). */
  readonly npcJourneyDays?: number;
  /** Opt-in (con `npcJourneyDays`): el NPC en viaje pasa por los hexes del camino mientras dura la marcha (`life.transit`). */
  readonly npcTransit?: boolean;
  /** Opt-in (con `npcJourneyDays`): el viajero sale con `grams` del bien `good` de la despensa, come en el camino y devuelve lo que sobra (`NpcVerbsOptions.provisions`). */
  readonly npcProvisions?: { readonly good: string; readonly grams: number };
  /** Opt-in (con `npcJourneyDays`): el viajero sale con un odre de `liters` y bebe en el camino al sentir sed (`NpcVerbsOptions.drink`). */
  readonly npcWater?: { readonly liters: number };
  /** Opt-in (con `npcJourneyDays`): de noche el viajero para y duerme (`rest`) y sigue al alba (`NpcVerbsOptions.nightRest`). */
  readonly npcNightRest?: boolean;
  /** Opt-in (con `npcJourneyDays`): el ritmo del viaje, modo `careful` o `fast` del `move` (`NpcVerbsOptions.pace`). */
  readonly npcPace?: "careful" | "fast";
  /** Opt-in: el calzado de quien camina se gasta (más por monte) y gastado cuesta más caminar (`life.act`); apagado, nada cambia. */
  readonly npcFootwear?: boolean;
  /** Opt-in (con `npcFootwear`): el calzado destrozado abre llagas en la pierna al caminar (`ActOptions.footSores`). */
  readonly npcFootSores?: boolean;
  /** Opt-in (con `npcFootwear`): el NPC en la aldea remienda o compra par nuevo del calzado gastado, pagando cobre (`life.footwear_mend`); apagado. */
  readonly npcFootwearMend?: boolean;
  /** Opt-in (con `npcFootwearMend`): un zapatero de la aldea cobra los arreglos con su oficio y cuero del ledger (`cobbler.ts`); apagado. */
  readonly npcCobbler?: boolean;
  readonly npcCobblerHides?: boolean;
  /** Opt-in (con `npcFootwearMend`): el viajero de camino con el calzado gastado lo hace arreglar en una posada o posta, más caro y peor (`life.footwear_road_mend`); apagado. */
  readonly npcRoadMend?: boolean;
  /** Opt-in: claims de ítems con identidad en `life.act` (`ActOptions.itemClaims`); apagado, nada cambia. */
  readonly itemClaims?: boolean;
  /** Opt-in: los gustos de comida y bebida corren lo que cada parte paga en un trato (`ActOptions.tasteDemand`, `parts.tastes` es el catálogo); apagado, nada cambia. */
  readonly tasteDemand?: boolean;
  /** Opt-in (con `npcRoadMend`): el arreglo de camino solo en la parada de la noche (`rested` del viaje); apagado. */
  readonly npcRoadStops?: boolean;
  /** Opt-in (con `npcRoadMend` y `npcCobbler`): si el zapatero está en el mismo hex que el viajero, arregla él con su oficio y cuero (npc-b2b3b2b3c2c); apagado. */
  readonly npcRoadCobbler?: boolean;
  /** Opt-in (con `npcJourneyDays`): el viajero se viste a la salida y lleva una capa para lo que baje el aire en el camino; la capa se gasta y se pierde (`life.cloak_wear`, `life.thermal`); apagado. */
  readonly npcCloak?: boolean;
  /** Opt-in (con `npcCloak`): el NPC en la aldea remienda o compra capa nueva cuando la suya está gastada o perdida, pagando cobre (`life.cloak_mend`); apagado. */
  readonly npcCloakMend?: boolean;
  /** Opt-in (con `npcCloak`): al salir el viajero pronostica el frío del camino y solo carga la capa si cree que la va a necesitar (`ForecastBeforeLeaving`); apagado: siempre la lleva. */
  readonly npcForecast?: boolean;
  /** Opt-in (con `npcForecast`): el viajero también cree si va a llover (`RoadForecast.rain`); con lluvia creída espera y carga la capa; apagado. */
  readonly npcRainForecast?: boolean;
  /** Opt-in (con `npcFieldWatering`): en la rutina, la gente de campo siembra la temporada según el suelo y la lluvia creída (`RoutineOptions.fieldSowing`); apagado. */
  readonly npcFieldSowing?: boolean;
  /** Opt-in (con `npcFieldSowing`): sembrar cuesta grano de la despensa (vuelve con la cosecha) y la helada creída hace esperar (`RoutineOptions.sowSeed`); apagado. */
  readonly npcSowSeed?: boolean;
  /** Opt-in (con `npcFieldWatering`): el jugador y los dormidos cosechan con el riego y la siembra de la aldea (`ActOptions.fieldWatering`/`fieldSowing`, `CatchUpProcessOptions.harvest.field`); apagado. */
  readonly npcFieldShared?: boolean;
  /** Opt-in (con `npcRainForecast`): en la rutina, la gente de campo riega con el suelo seco si no cree que llueva (`RoutineOptions.fieldWatering`); apagado. */
  readonly npcFieldWatering?: boolean;
  /** Opt-in (con `npcPace`): forzar el ritmo (`fast` con fatiga alta) puede torcer una pierna (`ActOptions.strain`); apagado. */
  readonly npcStrain?: boolean;
  /** Opt-in (con `npcStrain`): la fatiga alta baja las defensas ante el contagio (`ExposureOptions.exhaustion`); apagado. */
  readonly npcExhaustion?: boolean;
  /** Opt-in: bienes que al comerse dan una dosis (`amount` por gramo); ver `ActOptions.foodSubstances`. */
  readonly foodSubstances?: readonly ConsumableDef[];
  /** Opt-in: la pureza de lo ingerido con `essence` deja residuo y la sobrecarga hiere (`life.residue`, `ActOptions.residue`); apagado, sin filas ni RNG. */
  readonly residue?: ResidueConfig;
  /**
   * Opt-in: el qi del lugar (campo de `Essence` de la celda, solo lectura) entra al ambiente
   * térmico (`qiC`) y, con `residue`, a la absorción pasiva con residuo. Apagado: sin cambios.
   */
  readonly ambientQi?: AmbientQi;
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
  /** Opt-in (con `cravingCues`, `cueLocal` y `consumables`): ver el consumible en la despensa despierta su señal por objeto en `life.decide`; ver `DecideOptions.objectCues`. */
  readonly objectCues?: boolean;
  /** Opt-in (con `objectCues`): ver también lo que llevan los presentes y los puestos del lugar; ver `DecideOptions.viewCues`. */
  readonly viewCues?: ViewCues;
  /** Opt-in (con `objectCues`): ver lo soltado en el suelo del lugar (lotes a nombre del lugar, `drop`); ver `DecideOptions.groundCues`. */
  readonly groundCues?: boolean;
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
  /** Opt-in: la marca falsa descubierta dispara `scam.discovered` contra el falsificador (con `marks`). */
  readonly marksExpose?: boolean;
  /** Opt-in (con `marks` y `marksExpose`): rumor `fraud` sobre el falsificador y reparación del marcador copiado (`life.mark_exposure`). */
  readonly marksGossip?: boolean;
  /** Opt-in (con `marksGossip`): el rumor `fraud` también llega, con chance y más flojo, a gente de otros lugares. */
  readonly marksReach?: boolean;
  /** Opt-in: el fallo de usura que procede viaja como rumor `fraud` sobre el prestamista y quien pide fiado lo lee (`life.usury_gossip`). */
  readonly usuryGossip?: boolean;
  /** Opt-in: interés en especie en el fiado de comida entre hogares: al saldar, el hogar suma `ceil(principal * ratio)` g del mismo bien de lo que le sobra (`life.repay`). Ausente: sin interés. */
  readonly householdInterest?: number;
  /** Opt-in: pagar del todo la deuda repara parte de la fama de moroso o estafador del deudor en `RUMORS` (`life.debtor_repair`). */
  readonly debtorRepair?: boolean;
  /** Opt-in: consejo de aldea como organización fundada desde sus ancianos (`life.council`, organizations §11); sin esto no existe ni corre. */
  readonly council?: Omit<CouncilOptions, "placeOf" | "day" | "year" | "goods">;
  /** Opt-in (con `council`): la acusación contada a un anciano se vuelve un `Case` del consejo como foro (`life.council_cases`, law §4); sin esto no existe ni corre. */
  readonly councilCases?: CouncilCasesOptions;
  /** Opt-in (requiere `famine`): bandas de bandidos que nacen de la hambruna (`life.bandits`, organizations §11 «Hambre y armas»); sin esto no existe ni corre. */
  readonly bandits?: Omit<BanditsOptions, "placeOf" | "day" | "year" | "goods">;
  /** Opt-in: intrigas de asesinato/robo motivadas por un hecho (`life.schemes`, schemes F1b); sin esto no existe ni corre. */
  readonly schemes?: Omit<SchemesOptions, "placeOf" | "day" | "view"> &
    Partial<Pick<SchemesOptions, "view">>;
  /** Opt-in (con `debtorRepair`): devolver lo mal habido (estafa devuelta, reintegro de usura) también repara la fama y corre la voz correctiva. */
  readonly debtorRepairRestitution?: boolean;
  /** Opt-in (con `loanSeeds`): contagio de quiebras entre hogares sobre los compromisos de `life.loans`, en la unidad dada (`life.contagion`). */
  readonly loanContagion?: string;
  /** Opt-in (con `loanContagion`): fama del quebrado rebajada y `rateMarkup` en la tasa de los acreedores arrastrados. */
  readonly loanContagionEffects?: { readonly rateMarkup: number };
  /** Opt-in (con `loanContagion` y `loanSeeds`): el acreedor del hogar caído renegocia o ejecuta la garantía (`life.workout`). */
  readonly loanWorkout?: boolean;
  /** Opt-in: los hogares ofrendan grano en la ración a la tablilla y la fiesta, con destino (quemado, enterrado, a los pobres) y asiento en el ledger (`life.offerings`); apagado. */
  readonly offerings?: boolean;
  /** Opt-in: el desecho de lo comido vuelve al campo como abono (`life.soil`, ledger `excreted` -> aldea -> `field-manure`); apagado. */
  readonly fieldManure?: boolean;
  /** Con `fieldManure`: la calidad del abono sale de la proteína de lo comido (`manureQualityOf`); apagado, constante. */
  readonly fieldManureDiet?: boolean;
  /** Opt-in: el forraje del monte es un stock en pie que rebrota y del que la gente alcanza lo que da `harvestStock` (`life.wild`, ledger `wild` -> lugares de monte); apagado. */
  readonly wildHarvest?: boolean;
  /** Con `wildHarvest`: escala del techo del stock en pie (1 = el de la celda). */
  readonly wildCapacityScale?: number;
  /** Opt-in: la gente caza herbívoros de la celda (cobro diario dentro de `life.ecology`, ledger `hunt` -> montes); apagado. */
  readonly wildHunt?: boolean;
  /** Con `wildHunt`: multiplicador del esfuerzo diario de caza. */
  readonly wildHuntScale?: number;
  /** Opt-in (`LifeOptions.mortalTech`): el catálogo de procesos mortales; enciende la enseñanza en el hogar (`life.tech-teach`) y que la cosecha lea `yieldFactor`; apagado. */
  readonly mortalTech?: { readonly catalog: TechCatalog };
  readonly funerals?: FuneralOptions;
  /** Opt-in: casa de empeño (`life.pawn`): el dueño recupera la prenda pagando o el lote pasa a la casa al vencer; apagado por defecto. */
  readonly pawn?: {
    readonly unit: string;
    readonly lots: PawnLots;
    readonly open?: PawnOpenOptions;
    /** Opt-in (con `open` y `moldHints`): el NPC en apuro empeña por decisión (`decide` `pawnWant` + `life.pawn_decide`). */
    readonly want?: PawnWantOptions;
  };
  /** Opt-in: el verbo `hire` se ejecuta (`life.hire`): jornal por `skillWageOf` y lo que el oficial cree, pago por ledger, trabajo hecho o servidumbre por jornal; apagado por defecto. */
  /** Opt-in: el fiado por hambre (`life.borrow`) baja el limite segun lo que el vecino CREE del apuro del hogar que pide. */
  readonly creditHeed?: HeedStanding;
  readonly hire?: {
    readonly unit: string;
    readonly baseWage: number;
    readonly jobDays?: number;
    readonly distrustPremium?: number;
    /** Opt-in: ofrece menos jornal al oficial que CREE en la ruina (creido, nunca verdad). */
    readonly heedStanding?: HeedStanding;
    readonly bondage?: {
      readonly wagePerDay: number;
      readonly upkeepPerDay: number;
      readonly maxDays: number;
    };
  };
  readonly recipes: readonly RecipeDef[];
  /** Recetas de oficio y los hogares que las practican (economy §3); sin asignaciones no producen. */
  readonly tradeRecipes?: readonly TradeRecipeDef[];
  readonly householdTrades?: readonly TradeAssignment[];
  /** Opt-in: cada hogar elige oficio por habilidad y necesidad (`tradeSkills`: receta a habilidad) y lo guarda; sin esto sale del seed. */
  readonly tradeChoice?: { readonly tradeSkills: Readonly<Record<string, string>> };
  /** Opt-in: quien cruza a un hogar con oficio cree que vive de eso (`TRADE_VIEW`); apagado por defecto. */
  readonly tradeView?:
    | boolean
    | {
        readonly misread?: { readonly chance: number };
        readonly people?: boolean;
        /** El oficio visto sale del seed, como el que producen los hogares (sin asignaciones ni elección). */
        readonly fromSeed?: boolean;
      };
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
  /** Opt-in (con `loanSeeds`): préstamos con interés disfrazado donde la cultura lo prohíbe; con `communityCase` y `loanEnforcement.community`, el caso comunitario (`credit.usury_ruled`). */
  readonly loanUsury?: UsuryOptions;
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
  /** Opt-in: conserva largo/mediano/corto junto al núcleo en NPC_GOALS. */
  readonly persistGoalLayers?: boolean;
  /** Opt-in: libro personal de términos y pagos conocidos de préstamos Commitment. */
  readonly debtKnowledge?: boolean;
  readonly persistImmediateGoals?: boolean;
  /** Opt-in: cierra las metas persistidas cuando el NPC muere; apagado por defecto. */
  readonly closeGoalsOnDeath?: boolean;
  readonly recognizeGoalCompletion?: boolean;
  /** Opt-in: cierra saldar una deuda desde los pagos propios recordados (necesita `debtKnowledge`). */
  readonly recognizeGoalProgress?: boolean;
  /** Opt-in: el vacío por venganza cumplida presiona la necesidad lenta `meaning`. */
  readonly meaningPressure?: boolean;
  /** Opt-in (`LifeOptions.lifeStages`): enciende `life.stages` y que la decisión lea el sesgo de riesgo de la etapa; apagado. */
  readonly lifeStages?: boolean;
  /** Opt-in (`LifeOptions.stageRites`, con `lifeStages`): ritos de paso de la cultura en `life.stages`. */
  readonly stageRites?: boolean;
  /** Opt-in (`LifeOptions.attachmentBias`, con `lifeStages`): el apego tiñe las relaciones en `life.appraise`. */
  readonly attachmentBias?: boolean;
  /** Opt-in (`LifeOptions.belonging`): enciende `life.belonging`; apagado. */
  readonly belonging?: boolean;
  /** Opt-in (`LifeOptions.dreams`): `life.consolidate` emite `mind.dreamt` al despertar; apagado. */
  readonly dreams?: boolean;
  /** Opt-in (`LifeOptions.conditionLabels`): las etiquetas de `content/mental-labels`; con ellas, la muerte cercana abre duelo y el trato de la teoría de la cultura entra en la cura (npc-psychology §11). */
  readonly conditionLabels?: readonly MentalLabelDef[];
  /** Opt-in (`LifeOptions.conditionStigma`, requiere `conditionLabels`): los de afuera creen el mal ajeno y le ponen estigma, salvo que la familia lo esconda. */
  readonly conditionStigma?: boolean;
  /** Opt-in (`LifeOptions.coop`, requiere `council`): proyectos cooperativos de la aldea (`life.coop`, schemes §9); sin esto no existe ni corre. */
  readonly coop?: CoopOptions;
  /** Opt-in: registro de práctica propio y metas de oficio/estudio en las capas persistidas (con `persistGoalLayers`). */
  readonly craftGoals?: boolean;
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
/**
 * Los `perceive` por evento que también leen lo emitido por otros `perceive` del mismo paso
 * (`ProcessDef.perceiveCascade`): consumidores de `scam.discovered`, que `life.marks` emite al cerrar el paso.
 * `life.appraise` (desde `life-28`) lo recibe filtrado a `scam.discovered`: con todo lo demás que emiten los
 * `perceive` la cascada movía el perfil (ver ROADMAP `perfil2c-appraise-cascade`).
 */
export const PERCEIVE_CASCADE: ReadonlySet<string> = new Set([
  DEEDS_PROCESS,
  MARK_EXPOSURE_PROCESS,
]);

/** Lo que `life.appraise` recibe de la segunda ronda: solo la falsificación descubierta. */
export const APPRAISE_CASCADE = { kinds: ["scam.discovered"] } as const;

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
  // `life-33`: el saludo al cruzarse sale de la decisión (`speak` con acto `greet`) si el viajero puede hablar.
  const greetByDecision =
    parts.legacyNoGreetDecision !== true &&
    parts.npcGreetings === true &&
    parts.npcEncounters === true &&
    parts.npcJourneyDays !== undefined &&
    parts.npcVerbs?.includes("speak") === true;
  const economicBatch = (parts.npcVerbs?.length ?? 0) > 0;
  const altitudeOf = parts.realAltitude
    ? parts.travelAltitude
      ? travelAltitudeOf(parts.map, parts.travelAltitude, parts.spaces)
      : mapAltitudeOf(parts.map, parts.spaces)
    : undefined;
  const onRun = parts.runProbe;
  const clock = parts.runClock;
  const probe = (def: ProcessDef): ProcessDef =>
    onRun
      ? {
          ...def,
          run(ctx) {
            const t0 = clock?.();
            const out = def.run(ctx);
            onRun(
              def.id,
              out.changes?.length ?? 0,
              out.events?.length ?? 0,
              clock && t0 !== undefined ? clock() - t0 : undefined,
            );
            return out;
          },
        }
      : def;
  // Desde `life-27` (perfil2c-mark-exposure-cascade): quienes leen lo que emite otro `perceive` del
  // paso (el `scam.discovered` de una marca falsa que emite `life.marks`) lo reciben en la segunda ronda.
  const cascade = (def: ProcessDef): ProcessDef =>
    PERCEIVE_CASCADE.has(def.id)
      ? { ...def, perceiveCascade: true }
      : def.id === APPRAISE_PROCESS && parts.legacyNoAppraiseCascade !== true
        ? { ...def, perceiveCascade: APPRAISE_CASCADE }
        : def;
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
          ...(parts.sleepers ? { sleepers: true } : {}),
          ...(parts.sleepUncapped === true ? {} : { sleepCap: true }),
          ...(parts.waitAwake === true
            ? {}
            : { nightRest: (at: number) => localHour(parts.clock, at, parts.map.lonDeg) }),
        }),
        actProcess({
          ...(parts.npcFieldWatering === true && parts.npcFieldShared === true
            ? {
                fieldWatering: true,
                ...(parts.npcFieldSowing === true ? { fieldSowing: true } : {}),
              }
            : {}),
          ...(parts.npcVerbs && parts.npcVerbs.length > 0 ? { projectWatchExposures: true } : {}),
          ...(parts.npcVerbs?.includes("trade") ? { projectTrades: true } : {}),
          ...(economicBatch
            ? {
                // El jugador comparte recursos aunque su verbo no esté habilitado para NPC.
                serialEconomicVerbs: [
                  "trade",
                  "give",
                  "eat",
                  "cook",
                  "take",
                  "gather",
                  "hunt",
                  "consult",
                ] as const,
                economicBatch: true,
              }
            : {}),
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
          ...(parts.verboseSteps === true ? { verboseSteps: true } : {}),
          ...(parts.legacyFalls === true ? { legacyFalls: true } : {}),
          ...(parts.legacyNoDeadCounterpartyGuard === true
            ? { legacyNoDeadCounterpartyGuard: true }
            : {}),
          ...(parts.legacyNoDeadGiveGuard === true ? { legacyNoDeadGiveGuard: true } : {}),
          ...(parts.legacyFixedSpeech === true ? { legacyFixedSpeech: true } : {}),
          ...(parts.legacyNoSettlementWalk === true ? { legacyNoSettlementWalk: true } : {}),
          ...(parts.legacyNoLarderTake === true ? { legacyNoLarderTake: true } : {}),
          ...(parts.legacyTend === true ? { legacyTend: true } : {}),
          ...(parts.legacyResume === true ? { legacyResume: true } : {}),
          ...(parts.npcPace ? { effortByManner: true } : {}),
          ...(parts.npcPace && parts.npcStrain === true ? { strain: true } : {}),
          ...(parts.npcFootwear === true ? { footwear: true } : {}),
          ...(parts.itemClaims === true ? { itemClaims: true } : {}),
          ...(parts.tasteDemand === true ? { tasteDemand: parts.tastes } : {}),
          ...(parts.npcFootwear === true && parts.npcFootSores === true ? { footSores: true } : {}),
          ...(parts.coreEffects === true ? { coreEffects: true } : {}),
          ...(parts.nutritionCaps === true ? { nutritionCaps: true } : {}),
          ...(parts.consumables ? { consumables: parts.consumables } : {}),
          ...(parts.foodSubstances ? { foodSubstances: parts.foodSubstances } : {}),
          ...(parts.residue ? { residue: parts.residue } : {}),
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
          ...(parts.persistImmediateGoals === true ? { causalDoseOrigins: true } : {}),
          ...(parts.cravingCues === true && parts.cueLocal === true ? { cueLocal: true } : {}),
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
        ...(parts.pawn
          ? [
              pawnProcess({
                unit: parts.pawn.unit,
                lots: parts.pawn.lots,
                placeOf: () => village,
                day: parts.clock.day,
              }),
            ]
          : []),
        ...(parts.pawn?.open
          ? [
              pawnOpenProcess({
                unit: parts.pawn.unit,
                open: parts.pawn.open,
                placeOf: () => village,
                day: parts.clock.day,
              }),
            ]
          : []),
        ...(parts.pawn?.open && parts.pawn.want
          ? [
              pawnDecideProcess({
                ...(economicBatch && parts.legacyNoLendPawnBatch !== true
                  ? { economicBatch: true }
                  : {}),
                goods: parts.goods,
                day: parts.clock.day,
                player,
                placeOf: placeOf(parts, village),
              }),
            ]
          : []),
        ...(parts.npcFootwear === true && parts.npcFootwearMend === true
          ? [
              footwearMendProcess({
                player,
                placeOf: placeOf(parts, village),
                ...(parts.npcCobbler === true
                  ? {
                      cobbler: {
                        clock: parts.clock,
                        ...(parts.npcCobblerHides === true ? { hideCost: true } : {}),
                      },
                    }
                  : {}),
              }),
            ]
          : []),
        ...(parts.npcFootwear === true &&
        parts.npcFootwearMend === true &&
        parts.npcRoadMend === true
          ? [
              footwearRoadMendProcess({
                player,
                placeOf: placeOf(parts, village),
                ...(parts.npcRoadStops === true ? { atStops: true } : {}),
                ...(parts.npcRoadCobbler === true && parts.npcCobbler === true
                  ? { cobbler: true as const }
                  : {}),
              }),
            ]
          : []),
        ...(parts.npcCloak === true && parts.npcJourneyDays !== undefined
          ? [cloakWearProcess({ placeOf: placeOf(parts, village) })]
          : []),
        ...(parts.npcCloak === true &&
        parts.npcJourneyDays !== undefined &&
        parts.npcCloakMend === true
          ? [cloakMendProcess({ player, placeOf: placeOf(parts, village) })]
          : []),
        ...(parts.hire
          ? [
              hireProcess({
                ...parts.hire,
                placeOf: placeOf(parts, village),
                day: parts.clock.day,
                crafts: craftSkillIds(parts.skills),
                ...(parts.usuryGossip ? { heedFraud: true } : {}),
              }),
            ]
          : []),
        ...(parts.marks === true
          ? [
              marksProcess({
                placeOf: placeOf(parts, village),
                eye: scamEyeOf(parts.traits),
                skill: forgeSkillOf(parts.traits),
                ...(parts.marksExpose === true ? { exposeForgery: true } : {}),
                ...(parts.marksExpose === true && parts.marksGossip === true
                  ? parts.moldGossip?.fromForgery
                    ? {
                        renown: believedMarkRenownBy,
                        renownReads: [MARK_CLEARED.name, MOLD_RUMORS.name],
                      }
                    : {
                        renown: (t, _observer, owner) => clearedRenown(t, owner),
                        renownReads: [MARK_CLEARED.name],
                      }
                  : {}),
              }),
            ]
          : []),
        ...(parts.marks === true && parts.marksExpose === true && parts.marksGossip === true
          ? [
              markExposureProcess({
                placeOf: placeOf(parts, village),
                ...(parts.marksReach === true ? { reach: true } : {}),
              }),
            ]
          : []),
        ...(parts.usuryGossip ? [usuryGossipProcess({ placeOf: placeOf(parts, village) })] : []),
        ...(parts.debtorRepair
          ? [
              debtorRepairProcess({
                placeOf: placeOf(parts, village),
                ...(parts.debtorRepairRestitution ? { restitution: true } : {}),
              }),
            ]
          : []),
        ...(parts.council
          ? [
              councilProcess({
                ...parts.council,
                placeOf: placeOf(parts, village),
                goods: parts.goods,
                day: parts.clock.day,
                year: parts.clock.year,
              }),
            ]
          : []),
        ...(parts.bandits
          ? [
              banditsProcess({
                ...parts.bandits,
                placeOf: placeOf(parts, village),
                goods: parts.goods,
                day: parts.clock.day,
                year: parts.clock.year,
              }),
            ]
          : []),
        ...(parts.council && parts.councilCases
          ? [
              councilCasesProcess({
                ...parts.councilCases,
                dims: parts.relationDims,
                bonds: parts.relationBonds,
                traits: parts.traits,
                goods: parts.goods,
                placeOf: placeOf(parts, village),
                day: parts.clock.day,
                year: parts.clock.year,
                rain: (made, now) => rainBetween(parts.map, parts.clock, parts.seed, made, now),
              }),
            ]
          : []),
        ...(parts.schemes
          ? [
              schemesProcess({
                ...parts.schemes,
                view:
                  parts.schemes.view ??
                  schemerViewOf({
                    traits: parts.traits,
                    dims: parts.relationDims,
                    bonds: parts.relationBonds,
                  }),
                placeOf: placeOf(parts, village),
                day: parts.clock.day,
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
          ...(economicBatch ? { projectSharedEffects: true, settleEconomy: true } : {}),
          ...(parts.legacyHeardReaders === true ? {} : { toldReaders: true }),
          ...(parts.legacyHeardTable === true ? {} : { toldClaims: true }),
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
        ...(economicBatch ? [converseProjectionProcess()] : []),
        ...(economicBatch
          ? [conversationSettlementProcess([OPEN_DEALS.name, KNOWN_DEEDS.name, RUMORS.name])]
          : []),
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
        ...(parts.debtKnowledge === true ? [debtKnowledgeProcess()] : []),
        ...(parts.lendBorrowed === true && parts.borrowCraving
          ? [
              lendProcess({
                ...(economicBatch && parts.legacyNoLendPawnBatch !== true
                  ? { economicBatch: true }
                  : {}),
                goods: parts.goods,
                dims: parts.relationDims,
                bonds: parts.relationBonds,
                day: parts.clock.day,
                player,
                placeOf: placeOf(parts, village),
                ...(parts.usuryGossip ? { heedFraud: true } : {}),
              }),
            ]
          : []),
        ...(parts.repayDoses === true && parts.consumables
          ? [
              repayDoseProcess({
                ...(economicBatch && parts.legacyNoLendPawnBatch !== true
                  ? { economicBatch: true }
                  : {}),
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
          ...(economicBatch ? { economicBatch: true } : {}),
          foods: parts.foods,
          curves: parts.pressureCurves,
          player,
          placeOf: placeOf(parts, village),
          ...(parts.creditHeed ? { heedStanding: parts.creditHeed } : {}),
          ...(parts.usuryGossip ? { heedFraud: true } : {}),
        }),
        repayProcess({
          ...(economicBatch ? { economicBatch: true } : {}),
          foods: parts.foods,
          player,
          placeOf: placeOf(parts, village),
          ...(parts.householdInterest ? { interestRatio: parts.householdInterest } : {}),
        }),
        spoilageProcess({
          goods: parts.goods,
          clock: parts.clock,
          placeOf: placeOf(parts, village),
        }),
        soilProcess({
          clock: parts.clock,
          map: parts.map,
          seed: parts.seed,
          ...(parts.fieldManure
            ? {
                manure: {
                  placeOf: placeOf(parts, village),
                  ...(parts.fieldManureDiet
                    ? {
                        proteinOf: new Map(
                          parts.foods.map((f) => [`good:${f.id}`, f.proteinPerGram] as const),
                        ),
                      }
                    : {}),
                },
              }
            : {}),
        }),
        ...(parts.coop
          ? [
              coopProcess({
                ...parts.coop,
                placeOf: placeOf(parts, village),
                day: parts.clock.day,
                year: parts.clock.year,
                traits: parts.traits,
                dims: parts.relationDims,
                bonds: parts.relationBonds,
              }),
            ]
          : []),
        ...(parts.lifeStages
          ? [
              stagesProcess({
                stages: parts.stages,
                clock: parts.clock,
                placeOf: placeOf(parts, village),
                ...(parts.stageRites === true ? { rites: {} } : {}),
              }),
            ]
          : []),
        ...(parts.belonging
          ? [belongingProcess({ clock: parts.clock, placeOf: placeOf(parts, village) })]
          : []),
        ...(parts.mortalTech
          ? [
              techTeachProcess({
                catalog: parts.mortalTech.catalog,
                clock: parts.clock,
                workAge: ROUTINE.workAge,
                placeOf: placeOf(parts, village),
              }),
            ]
          : []),
        ecologyProcess({
          clock: parts.clock,
          map: parts.map,
          seed: parts.seed,
          lineages: parts.lineages ?? [],
          trajectories: parts.trajectories ?? [],
          ...(parts.wildHunt ? { hunt: { effortScale: parts.wildHuntScale ?? 1 } } : {}),
        }),
        ...(parts.wildHarvest
          ? [
              wildProcess({
                dayTicks: parts.clock.day,
                capacityScale: parts.wildCapacityScale ?? 1,
              }),
            ]
          : []),
        ...(parts.reservoirs && parts.reservoirs.length > 0
          ? [reservoirProcess({ hosts: parts.reservoirs, dayTicks: parts.clock.day })]
          : []),
        tradesProcess({
          ...(economicBatch ? { economicBatch: true } : {}),
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
        ...(parts.npcVerbs && parts.npcVerbs.length > 0
          ? [watchingProjectionProcess({ catalog: parts.skills, clock: parts.clock })]
          : []),
        ...(parts.npcVerbs?.includes("trade")
          ? [tradeProjectionProcess({ clock: parts.clock, goods: parts.goods })]
          : []),
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
                ...(typeof parts.tradeView === "object" &&
                parts.tradeView.fromSeed &&
                parts.householdTrades === undefined &&
                !parts.tradeChoice
                  ? { seed: parts.seed }
                  : {}),
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
          ...(parts.funerals
            ? { funerals: parts.funerals, eventOf: (id) => parts.log.get(id) }
            : {}),
          ...(economicBatch ? { economicBatch: true } : {}),
          ...(parts.debtKnowledge === true ? { debtKnowledge: true } : {}),
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
          ...(parts.loanUsury ? { usury: parts.loanUsury } : {}),
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
                ...(economicBatch ? { economicBatch: true } : {}),
                placeOf: placeOf(parts, village),
              }),
              ...(parts.rentSeeds?.some((r) => r.kind === "sharecrop")
                ? [sharecropHarvestProcess({ placeOf: placeOf(parts, village) })]
                : []),
            ]
          : []),
        ...(parts.legacyNoOscillationEvents !== true && parts.map.oscillation !== undefined
          ? [
              oscillationEventsProcess({
                clock: parts.clock,
                yearOf: (day: number) =>
                  oscillationYearOfMap(parts.map, parts.clock, parts.seed, day),
                place: village,
                subject: (village.kind === "settlement"
                  ? village.settlement
                  : parts.map.cell) as unknown as EntityRef,
              }),
            ]
          : []),
        ...(parts.offerings
          ? [
              offeringsProcess({
                clock: parts.clock,
                goods: parts.goods,
                placeOf: placeOf(parts, village),
              }),
            ]
          : []),
        ...(parts.famine
          ? [
              famineProcess({
                ...parts.famine,
                ...(parts.legacyNoOscillationCause !== true && parts.map.oscillation !== undefined
                  ? {
                      oscillationYear: (day: number) =>
                        oscillationYearOfMap(parts.map, parts.clock, parts.seed, day),
                    }
                  : {}),
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
          ...((parts.labors && parts.labors.length > 0) ||
          (parts.afflictedOrigins && parts.afflictedOrigins.length > 0) ||
          (parts.reservoirs && parts.reservoirs.length > 0)
            ? {
                ...(parts.reservoirs && parts.reservoirs.length > 0
                  ? { arrivalReads: [RESERVOIR.name] }
                  : {}),
                arrivals: (truth: ReadonlyWorldTruth, now: Tick) => [
                  ...reservoirSeeds(
                    Rng.root(parts.seed),
                    truth,
                    now,
                    parts.reservoirs ?? [],
                    parts.map,
                  ),
                  ...(parts.labors && parts.labors.length > 0 ? puerperalSeeds(truth) : []),
                  ...journeySeeds(
                    Rng.root(parts.seed),
                    truth,
                    now,
                    parts.clock,
                    parts.afflictedOrigins ?? [],
                  ),
                ],
              }
            : {}),
          ...(parts.waterSources
            ? {
                waterFor: waterHooks(
                  resolveWaterSources(parts.waterSources, parts.map, parts.clock, parts.seed),
                ).waterFor,
              }
            : {}),
          deficiency: parts.deficiencyEffects === true,
          ...(parts.npcStrain === true && parts.npcExhaustion === true ? { exhaustion: true } : {}),
          ...(parts.gatheringContact
            ? { gatherings: gatheringsFor({ clock: parts.clock, rng: Rng.root(parts.seed) }) }
            : {}),
          placeOf: placeOf(parts, village),
        }),
        medicineProcess({
          clock: parts.clock,
          healers: parts.healers ?? [],
          school: parts.healerSchool,
          schoolOf: parts.healerSchoolOf,
          stock: parts.remedyStock,
          ...(parts.healerFee
            ? {
                fee: {
                  unit: ledgerUnit(parts.healerFee.unit),
                  base: parts.healerFee.base,
                  renownOf: (truth, patient, healer) =>
                    (parts.healerFee?.byConfidence ? renownWeighed : renownBelieved)(
                      truth,
                      patient,
                      healer,
                    ),
                },
              }
            : {}),
          ...(parts.patientDecides
            ? {
                patientDecides: {
                  ...parts.patientDecides,
                  trustOf: parts.patientDecides.realBonds
                    ? (truth, patient, healer) => realTrust(truth, patient, healer)
                    : (truth, patient, healer) => renownBelieved(truth, patient, healer),
                  ...(parts.patientDecides.realBonds
                    ? {
                        authorityOf: (truth, patient, pathogen) =>
                          (parts.patientDecides?.councilAuthority
                            ? villageAuthority
                            : householdAuthority)(truth, patient, pathogen, {
                            ...parts.patientDecides?.councilAuthority,
                            ...(parts.patientDecides?.contagionBelief
                              ? { contagionBelief: parts.patientDecides.contagionBelief }
                              : {}),
                            ...(parts.patientDecides?.cultureTraits
                              ? { cultureTraits: parts.patientDecides.cultureTraits }
                              : {}),
                          }),
                      }
                    : {}),
                },
              }
            : {}),
          doses: parts.remedyDoses,
          dosing: parts.remedyDosing,
          substanceSigns: parts.healerSubstanceSigns === true,
          frostbiteSigns: parts.healerFrostbiteSigns === true,
          frostbiteOrders: parts.frostbite === true && parts.healerFrostbiteOrders === true,
          altitudeSigns: parts.healerAltitudeSigns === true ? altitudeOf : undefined,
          plans: parts.healerRealSigns === true ? parts.plans : undefined,
          deficiencySigns: parts.deficiencySigns === true,
          placeOf: placeOf(parts, village),
        }),
        ...(parts.conception === true && parts.demography
          ? [
              conceptionProcess({
                clock: parts.clock,
                demography: parts.demography,
                ...(parts.conceptionRateScale !== undefined
                  ? { rateScale: parts.conceptionRateScale }
                  : {}),
                ...(parts.conceptionGestationDays !== undefined
                  ? { gestationDays: parts.conceptionGestationDays }
                  : {}),
                placeOf: placeOf(parts, village),
              }),
            ]
          : []),
        ...((parts.labors && parts.labors.length > 0) || parts.conception === true
          ? [
              laborProcess({
                clock: parts.clock,
                labors: parts.labors ?? [],
                ...(parts.conception === true
                  ? { more: { reads: [PREGNANCY.name], of: pregnancyLabors } }
                  : {}),
                ...(parts.laborCaution !== undefined ? { caution: parts.laborCaution } : {}),
                ...(parts.healerFee
                  ? {
                      fee: {
                        unit: ledgerUnit(parts.healerFee.unit),
                        base: parts.healerFee.base,
                        renownOf: (truth, mother, healer) =>
                          (parts.healerFee?.byConfidence ? renownWeighed : renownBelieved)(
                            truth,
                            mother,
                            healer,
                          ),
                      },
                    }
                  : {}),
                placeOf: placeOf(parts, village),
              }),
            ]
          : []),
        ...(parts.conception === true && parts.births === true && parts.form
          ? [newbornBondsProcess({ dims: parts.relationDims, bonds: parts.relationBonds })]
          : []),
        ...(parts.conception === true && parts.births === true
          ? [
              birthProcess({
                clock: parts.clock,
                traits: parts.traits,
                bodyPlans: parts.plans,
                ...(parts.form
                  ? {
                      newborn: {
                        language: parts.form.language,
                        names: nameRules(parts),
                        schemas: parts.schemas,
                        dims: parts.relationDims,
                        bonds: parts.relationBonds,
                        cultureTraits: parts.cultureTraits,
                        skills: parts.skills,
                        tastes: parts.tastes,
                      },
                    }
                  : {}),
                placeOf: placeOf(parts, village),
              }),
            ]
          : []),
        substancesProcess({
          clock: parts.clock,
          doses: parts.substanceDoses ?? [],
          treatmentDoses: parts.remedyDoses !== undefined,
          ...(parts.persistImmediateGoals === true ? { causalDoseOrigins: true } : {}),
          placeOf: placeOf(parts, village),
        }),
        nutritionProcess({
          ...(parts.sleepers ? { sleepers: true } : {}),
          clock: parts.clock,
          profiles: parts.nutrientProfiles ?? [],
          diet: parts.diets?.find((d) => d.id === "village"),
          useEaten: parts.eatenNutrition === true,
          ...(parts.nutritionNeeds === true
            ? {
                needExtras: {
                  table: PREGNANCY.name,
                  pregnant: (truth: ReadonlyWorldTruth, who: EntityRef) =>
                    truth.get(PREGNANCY, who) !== undefined,
                },
              }
            : {}),
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
          ...(parts.sleepers ? { sleepers: true } : {}),
          plans: parts.plans,
          clock: parts.clock,
          map: parts.map,
          spaces: parts.spaces,
          seed: parts.seed,
          placeOf: placeOf(parts, village),
          ...(parts.npcCloak === true && parts.npcJourneyDays !== undefined
            ? {
                clothingOf: (t: ReadonlyWorldTruth, who: AgentId, airC: number) => {
                  const trip = t.get(NPC_JOURNEY, who);
                  if (!trip) return seasonalClothing(airC);
                  return roadClothing(
                    airC,
                    outdoorTempC(parts.map, parts.clock, parts.seed, trip.since),
                    carriedCloakClo(trip.cloak, t.get(CLOAK, who)?.wear),
                  );
                },
              }
            : {}),
          ...(altitudeOf || parts.ambientQi
            ? {
                altitude: {
                  baseM: parts.map.baseElevationM ?? 0,
                  altitudeOf: altitudeOf ?? (() => parts.map.baseElevationM ?? 0),
                  ...(parts.ambientQi
                    ? {
                        qiC: (t: ReadonlyWorldTruth, w: AgentId) =>
                          ambientQiCOf(parts.ambientQi as AmbientQi, t, w),
                      }
                    : {}),
                },
              }
            : {}),
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
        ...(altitudeOf && parts.travelCell
          ? [travelCellProcess({ cellOf: parts.travelCell })]
          : []),
        ...(altitudeOf
          ? [
              altitudeProcess({
                clock: parts.clock,
                altitudeOf,
                genomeAdaptation: parts.altitudeGenome === true,
              }),
            ]
          : []),
        ...(parts.residue
          ? [
              residueProcess({
                ...parts.residue,
                ...(parts.ambientQi ? { ambient: parts.ambientQi } : {}),
                clock: parts.clock,
                placeOf: placeOf(parts, village),
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
          ...(parts.persistImmediateGoals === true
            ? { persistEmotionSignals: true, envyStatuses: parts.statuses }
            : {}),
          clock: parts.clock,
          schemas: parts.schemas,
          stages: parts.stages,
          dims: parts.relationDims,
          bonds: parts.relationBonds,
          habits: parts.habits,
          traits: parts.traits,
          values: parts.values,
          ...(parts.rumorGrievance ? { rumorGrievance: true } : {}),
          ...(parts.lifeStages && parts.attachmentBias === true ? { attachmentBias: true } : {}),
          ...(parts.conditionLabels ? { conditionGrief: true } : {}),
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
          ...(parts.sleepers ? { sleepers: true } : {}),
          ...(parts.dreams ? { dreams: true } : {}),
          ...(parts.conditionLabels
            ? { mentalLabels: parts.conditionLabels, chronicDepression: true }
            : {}),
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
          ...(economicBatch ? { economicBatch: true } : {}),
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
          ...(parts.legacyNoToldBeliefs === true || parts.legacyHeardTable !== true
            ? {}
            : { toldBeliefs: true }),
        }),
        ...(parts.legacyHeardTable === true ? [] : [toldClaimsProcess()]),
        ...(parts.conditionLabels
          ? [
              conditionBeliefsProcess({
                mentalLabels: parts.conditionLabels,
                ...(parts.conditionStigma ? { stigma: true } : {}),
              }),
            ]
          : []),
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
          ...(parts.persistGoalLayers === true ? { persistGoalLayers: true } : {}),
          ...(parts.persistImmediateGoals === true ? { persistImmediateGoals: true } : {}),
          ...(parts.debtKnowledge === true ? { debtKnowledge: true } : {}),
          ...(parts.recognizeGoalCompletion === true ? { recognizeGoalCompletion: true } : {}),
          ...(parts.recognizeGoalProgress === true
            ? {
                goalProgress:
                  parts.craftGoals === true
                    ? ownGoalProgress(parts.clock.day)
                    : debtGoalProgress(parts.clock.day),
              }
            : {}),
          ...(parts.craftGoals === true ? { craftGoals: { window: 60 * parts.clock.day } } : {}),
          ...(parts.meaningPressure === true ? { meaningPressure: true } : {}),
          ...(parts.lifeStages === true ? { lifeStages: true } : {}),
          ...(parts.sleepers ? { sleepers: true } : {}),
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
          ...(parts.takeBelieved ? { takeBelieved: parts.takeBelieved } : {}),
          ...(parts.errands ? { errands: parts.errands } : {}),
          ...(parts.speakActs ? { speakActs: parts.speakActs } : {}),
          ...(parts.pawn?.open && parts.pawn.want ? { pawnWant: parts.pawn.want } : {}),
          ...(parts.foodSubstances ? { foodSubstances: parts.foodSubstances } : {}),
          ...(parts.drinkSubstance ? { drinkSubstance: parts.drinkSubstance } : {}),
          ...(parts.cravingCues === true ? { cravingCues: true } : {}),
          ...(parts.cravingCues === true && parts.cueLocal === true
            ? { cueLocal: { lonDeg: parts.map.lonDeg } }
            : {}),
          ...(parts.cravingCues === true && parts.cueLocal === true && parts.objectCues === true
            ? { objectCues: true }
            : {}),
          ...(parts.cravingCues === true &&
          parts.cueLocal === true &&
          parts.objectCues === true &&
          parts.viewCues
            ? { viewCues: parts.viewCues }
            : {}),
          ...(parts.cravingCues === true &&
          parts.cueLocal === true &&
          parts.objectCues === true &&
          parts.groundCues === true
            ? { groundCues: parts.map }
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
        ...(parts.craftGoals ? [practiceLogProcess({ skills: parts.skills })] : []),
        ...(parts.npcInterrupt === true
          ? [
              npcInterruptProcess({
                player,
                plans: parts.plans,
                placeOf: placeOf(parts, village),
                ...(parts.npcTransit === true && parts.npcJourneyDays !== undefined
                  ? { map: parts.map }
                  : {}),
              }),
              npcReactProcess({ player }),
            ]
          : []),
        ...(parts.npcEncounters === true && parts.npcJourneyDays !== undefined
          ? [npcEncountersProcess({ player, placeOf: placeOf(parts, village) })]
          : []),
        ...(parts.npcWarnings === true && parts.npcTraces === true && parts.npcEncounters === true
          ? [npcWarningsProcess({ player, placeOf: placeOf(parts, village) })]
          : []),
        ...(parts.npcGreetings === true && parts.npcEncounters === true && !greetByDecision
          ? [
              npcGreetingsProcess({
                player,
                dims: parts.relationDims,
                bonds: parts.relationBonds,
                placeOf: placeOf(parts, village),
                ...(parts.npcGreetingSpeech === true
                  ? {
                      speech: parts.form
                        ? lexicalGreetingSpeech({
                            language: parts.form.language,
                            addresses: parts.form.addresses,
                            culture: parts.form.culture,
                          })
                        : { say: () => "Buenas", lexicon: { people: [], goods: [] } },
                    }
                  : {}),
              }),
            ]
          : []),
        ...(parts.npcTraces === true && parts.npcEncounters === true
          ? [
              npcTracesProcess({
                player,
                placeOf: placeOf(parts, village),
                ...(() => {
                  const food = parts.goods.find((g) => g.id === parts.npcProvisions?.good);
                  return food && parts.npcProvisions
                    ? {
                        load: {
                          unit: goodUnit(food),
                          name: food.name,
                          ...(parts.npcDropReclaim ? { reclaim: true } : {}),
                          ...(parts.npcDropCauses ? { causes: parts.npcDropCauses } : {}),
                          ...(parts.npcDropScavenge !== undefined
                            ? { scavenge: { lineage: parts.npcDropScavenge } }
                            : {}),
                          ...(parts.npcDropRotHours !== undefined
                            ? { rotAfterHours: parts.npcDropRotHours }
                            : {}),
                        },
                      }
                    : {};
                })(),
              }),
            ]
          : []),
        ...(parts.npcVerbs && parts.npcVerbs.length > 0
          ? [
              npcVerbsProcess({
                ...(parts.sleepers ? { sleepers: true } : {}),
                catalog: parts.catalog,
                verbs: parts.npcVerbs,
                day: parts.clock.day,
                ...(parts.legacyNoSettlementWalk === true ? { legacyNoSettlementWalk: true } : {}),
                ...(parts.legacyNoRainWaitPersist === true
                  ? { legacyNoRainWaitPersist: true }
                  : {}),
                player,
                ...(parts.npcInterrupt === true
                  ? {
                      placeOf: placeOf(parts, village),
                      resume: {
                        plans: parts.plans,
                        after: 3600,
                        within: parts.clock.day,
                        ...(parts.npcResumeReevaluate === true ? { reevaluate: true } : {}),
                      },
                    }
                  : {}),
                ...(parts.npcTemplates
                  ? { templates: { byVerb: parts.npcTemplates, map: parts.map } }
                  : {}),
                ...(parts.npcJourneyDays !== undefined
                  ? {
                      journeyDays: parts.npcJourneyDays,
                      ...(greetByDecision
                        ? {
                            greet: {
                              dims: parts.relationDims,
                              bonds: parts.relationBonds,
                            },
                          }
                        : {}),
                      ...(parts.npcTransit === true ? { transit: true } : {}),
                      placeOf: placeOf(parts, village),
                      ...(parts.npcPace ? { pace: parts.npcPace } : {}),
                      ...(parts.npcForecast === true && parts.npcCloak === true
                        ? {
                            forecast: (who: AgentId, now: Tick, days: number) =>
                              forecastBeforeLeaving(
                                parts.map,
                                parts.clock,
                                parts.seed,
                                who,
                                now,
                                days,
                                parts.npcRainForecast === true,
                              ),
                          }
                        : {}),
                      ...(parts.npcWater
                        ? {
                            drink: {
                              plans: parts.plans,
                              carryLiters: parts.npcWater.liters,
                              ...(parts.waterSources
                                ? {
                                    quality: waterHooks(
                                      resolveWaterSources(
                                        parts.waterSources,
                                        parts.map,
                                        parts.clock,
                                        parts.seed,
                                      ),
                                    ).drinkQuality,
                                  }
                                : {}),
                            },
                          }
                        : {}),
                      ...(parts.npcNightRest === true
                        ? { nightRest: { clock: parts.clock, lonDeg: parts.map.lonDeg } }
                        : {}),
                      ...(() => {
                        const food = parts.goods.find((g) => g.id === parts.npcProvisions?.good);
                        return food && parts.npcProvisions
                          ? {
                              provisions: {
                                unit: goodUnit(food),
                                name: food.name,
                                grams: parts.npcProvisions.grams,
                                clock: parts.clock,
                                lonDeg: parts.map.lonDeg,
                              },
                            }
                          : {};
                      })(),
                    }
                  : {}),
              }),
            ]
          : []),
        ...(parts.npcTransit === true && parts.npcJourneyDays !== undefined
          ? [
              transitProcess({
                map: parts.map,
                player,
                ...(parts.npcNightRest === true ? { pauseRest: true } : {}),
              }),
            ]
          : []),
        ...(() => {
          const sl = parts.sleepers;
          const food = sl ? parts.foods.find((f) => f.id === sl.food) : undefined;
          if (!sl || !food) return [];
          const household = (t: ReadonlyWorldTruth, who: string) =>
            t.get(PERSON, who as AgentId)?.household;
          return [
            sleepPolicyProcess({
              player,
              map: parts.map,
              near: sl.near,
              // Vínculo (tier 4): quien comparte hogar con el personaje no se duerme.
              bonded: (t, who) => household(t, who) === household(t, player),
              important: () => false,
              pending: sleepWorkPending,
            }),
            // Dos procesos con alcances repartidos (off-3e): por hora solo quien pidió despertar,
            // por día el resto; así no se invoca a cada dormido cada hora.
            ...(["wake", "daily"] as const).map((mode) =>
              catchUpProcess({
                mode,
                plans: parts.plans,
                clock: parts.clock,
                lonDeg: parts.map.lonDeg,
                ration: {
                  unit: `good:${food.id}`,
                  kcalPerGram: food.kcalPerGram,
                  waterPerGram: food.waterPerGram,
                },
                player,
                placeOf: placeOf(parts, village),
                // Los dormidos también cosechan en sus horas de campo (misma estación que la rutina).
                harvest: {
                  season: harvestSeasonOf(parts.map, parts.clock, parts.seed),
                  ...(parts.npcFieldWatering === true && parts.npcFieldShared === true
                    ? {
                        field: {
                          map: parts.map,
                          seed: parts.seed,
                          sowing: parts.npcFieldSowing === true,
                        },
                      }
                    : {}),
                },
              }),
            ),
          ];
        })(),
        ...(parts.closeGoalsOnDeath
          ? [goalDeathClosureProcess({ placeOf: placeOf(parts, village) })]
          : []),
        routineProcess({
          ...(economicBatch ? { economicBatch: true } : {}),
          ...(parts.boil && parts.npcBoil ? { boil: parts.boil } : {}),
          ...(parts.npcMove === true ? { npcMove: true } : {}),
          ...(parts.npcFieldWatering === true ? { fieldWatering: true } : {}),
          ...(parts.npcFieldWatering === true && parts.npcFieldSowing === true
            ? { fieldSowing: true }
            : {}),
          ...(parts.npcFieldWatering === true &&
          parts.npcFieldSowing === true &&
          parts.npcSowSeed === true
            ? { sowSeed: true }
            : {}),
          ...(parts.mortalTech ? { tech: parts.mortalTech } : {}),
          ...(parts.idlePlayerRoutine === true ? { idlePlayer: true } : {}),
          ...(parts.waitUntended === true ? {} : { waitTend: true }),
          ...(parts.waitUntended === true || parts.waitNoSkin === true ? {} : { waitSkin: true }),
          ...(parts.waitUntended === true || parts.waitEatHomeOnly === true
            ? {}
            : { waitEatVillage: true }),
          ...(parts.legacyNoCare === true ? {} : { careWater: true }),
          ...(parts.sleepers ? { sleepers: true } : {}),
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
      ]
        .map(parts.legacyNoPerceiveCascade === true ? (d: ProcessDef) => d : cascade)
        .map(probe),
      resolution: "local",
      scopes: (kind, t, def) =>
        kind === "agent"
          ? !parts.sleepers
            ? living(t)
            : def.id === CATCH_UP_WAKE_PROCESS || def.id === CATCH_UP_DAILY_PROCESS
              ? // Tier 1 (off-3e): la puesta al día solo toca a los dormidos que le corresponden.
                living(t).filter((id) => {
                  const s = t.get(ASLEEP, id);
                  return (
                    s !== undefined &&
                    catchUpDue(def.id === CATCH_UP_WAKE_PROCESS ? "wake" : "daily", s)
                  );
                })
              : // Tier 1 (off-3d): al dormido no se lo invoca.
                living(t).filter((id) => !t.get(ASLEEP, id))
          : kind === "household"
            ? householdsOf(t)
            : [],
    },
    start,
  );
  return { ...parts, scheduler, player };
}

export { makeId };
