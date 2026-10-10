// La vida en memoria: la verdad, el registro, el ledger y el scheduler con los procesos de la
// Fase 1, más lo derivado del seed y del contenido que no se guarda (mapa, espacios, catálogos).

import type {
  AgentId,
  EventLog,
  IdAllocator,
  Ledger,
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
import { actProcess } from "./act.ts";
import { altitudeProcess, mapAltitudeOf } from "./altitude.ts";
import { ambientOf } from "./ambient.ts";
import { appraiseProcess } from "./appraise.ts";
import { askAroundProcess } from "./askaround.ts";
import { borrowProcess, repayProcess } from "./borrow.ts";
import { personalPoolShareOf } from "./budget.ts";
import { companyProcess } from "./company.ts";
import { conscienceProcess } from "./conscience.ts";
import { type ConverseForm, converseProcess } from "./converse.ts";
import { arrearsProcess, creditProcess } from "./credit.ts";
import { decideProcess } from "./decide.ts";
import { deedsProcess } from "./deeds.ts";
import { consultProcess, divinersProcess, retoldProcess, visitsProcess } from "./divine.ts";
import { ecologyProcess } from "./ecology.ts";
import { exposureProcess, type PathogenSeed } from "./exposure.ts";
import { type FamineOptions, famineProcess } from "./famine.ts";
import { gossipProcess } from "./gossip.ts";
import { growthSequelaeProcess } from "./growthSequelae.ts";
import { intrusionProcess } from "./intrusion.ts";
import { inventoryProcess } from "./inventory-belief.ts";
import { keepProcess } from "./keep.ts";
import { knowingProcess } from "./knowing.ts";
import { living } from "./living.ts";
import { type LoanSeed, loansProcess } from "./loans.ts";
import { lookingProcess } from "./looking.ts";
import { marketProcess } from "./market.ts";
import { type Healer, type HealerSchool, medicineProcess } from "./medicine.ts";
import { type MigrationOptions, migrationProcess } from "./migration.ts";
import { type MoldGossipOptions, moldGossipProcess } from "./moldgossip.ts";
import { neighborsProcess } from "./neighbors.ts";
import { nutritionProcess } from "./nutrition.ts";
import { observeProcess } from "./observe.ts";
import { perceiveProcess } from "./perceive.ts";
import { pitchProcess } from "./pitch.ts";
import { pledgeProcess } from "./pledges.ts";
import { ponderProcess } from "./ponder.ts";
import { type RentSeed, rentsProcess } from "./rents.ts";
import { routineProcess } from "./routine.ts";
import { sleepProcess } from "./sleep.ts";
import { soilProcess } from "./soil.ts";
import { householdsOf, spoilageProcess } from "./spoilage.ts";
import { standingProcess } from "./standing.ts";
import { type SubstanceDose, substancesProcess } from "./substances.ts";
import { bornTaboosProcess, bornTaboosSettleProcess, heardWordsProcess } from "./taboos.ts";
import { testifyProcess } from "./testify.ts";
import { thermalProcess } from "./thermal.ts";
import { tradeChoiceProcess } from "./tradechoice.ts";
import { type TradeAssignment, tradesProcess } from "./trades.ts";
import { tradeViewProcess } from "./tradeview.ts";
import { upbringingProcess } from "./upbringing.ts";
import { upkeepProcess } from "./upkeep.ts";
import { type WaterSourcesConfig, waterHooks } from "./waterSources.ts";
import { witnessingProcess } from "./witnessing.ts";

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
  /** Remedio a unidad del ledger: darlo gasta un bien real (del sanador o del enfermo); sin existencias no se da. Sin esto, remedios sin costo. */
  readonly remedyStock?: Readonly<Record<string, string>>;
  /** Dosis explícitas de sustancias (body-health §9); sin ellas no hay nada que simular. */
  readonly substanceDoses?: readonly SubstanceDose[];
  /** Perfiles de nutrientes por alimento y dieta de referencia (body-health §5); sin dieta no hay reservas. */
  readonly nutrientProfiles?: readonly NutrientProfileDef[];
  readonly diets?: readonly DietDef[];
  /** Lo comido de verdad alimenta las reservas (`MEALS`); apagado por defecto: la aldea no cambia. */
  readonly eatenNutrition?: boolean;
  /** Las carencias publicadas (`DEFICIENCY_EFFECTS`) frenan la curación y la defensa inmune del cuerpo; apagado por defecto. */
  readonly deficiencyEffects?: boolean;
  /** Desnutrición proteica grave sostenida mata (causa `malnutrition`); apagado por defecto: sin muertes nuevas. */
  readonly malnutritionDeath?: boolean;
  /** Opt-in: el hambre infantil deja secuelas permanentes (`GROWTH_SEQUELAE`); apagado por defecto: sin filas. */
  readonly growthSequelae?: boolean;
  /**
   * Opt-in: altitud real del hex (`LocalMap.elevationM`): corre `life.altitude` (aclimatación en
   * `ACCLIMATIZATION`), el frío sigue el gradiente con la elevación y la resistencia de `decide`/`act`
   * baja con la altura. Apagado por defecto: la aldea no cambia, sin filas ni RNG.
   */
  readonly realAltitude?: boolean;
  /** Opt-in: qué fuente bebe cada quien (pozo tratado en el sitio, fuente del hex fuera) con `drinkQuality`/`waterFor`; apagado: agua limpia/pozo como siempre. */
  readonly waterSources?: WaterSourcesConfig;
  /**
   * Opt-in: la congelación se acumula por parte (`FROSTBITE`), la necrosis amputa (`AMPUTATIONS`,
   * evento `body.amputated`) y manos y pies heridos bajan las capacidades de `decide`/`act`.
   * Apagado por defecto: la aldea no cambia, sin filas, RNG ni muertes.
   */
  readonly frostbite?: boolean;
  readonly recipes: readonly RecipeDef[];
  /** Recetas de oficio y los hogares que las practican (economy §3); sin asignaciones no producen. */
  readonly tradeRecipes?: readonly TradeRecipeDef[];
  readonly householdTrades?: readonly TradeAssignment[];
  /** Opt-in: cada hogar elige oficio por habilidad y necesidad (`tradeSkills`: receta a habilidad) y lo guarda; sin esto sale del seed. */
  readonly tradeChoice?: { readonly tradeSkills: Readonly<Record<string, string>> };
  /** Opt-in: quien cruza a un hogar con oficio cree que vive de eso (`TRADE_VIEW`); apagado por defecto. */
  readonly tradeView?: boolean;
  /** Opt-in: el aporte del jornalero a la bolsa común sale de su temperamento y los dependientes de su hogar (`personalPoolShareOf`), no del 70% fijo; apagado por defecto. */
  readonly personalPool?: boolean;
  /** Opt-in: chisme de precios y lugares (`life.gossip_molds`, tabla `MOLD_RUMORS`) desde lo que cada uno vio (`seeds`); apagado por defecto. */
  readonly moldGossip?: MoldGossipOptions;
  /** Préstamos de cosecha decididos de antemano (economy §8); sin semillas no hay préstamos. */
  readonly loanSeeds?: readonly LoanSeed[];
  /** Opt-in: arriendos decididos de antemano (`life.rents`, tabla `RENTS`, `Commitment` "lease" entre hogares, canon por ledger); sin semillas no hay proceso. */
  readonly rentSeeds?: readonly RentSeed[];
  /** Presión de escasez de alimento y su descarga (economy, hambruna); apagada por defecto: la aldea no cambia. */
  readonly famine?: Omit<FamineOptions, "clock" | "goods" | "placeOf">;
  /** Opt-in: hogares que deciden irse por la hambruna (`life.migration`, tabla `MIGRATIONS`); solo la decisión, no mueve a nadie. Apagado por defecto. */
  readonly migration?: Omit<MigrationOptions, "clock" | "goods" | "placeOf">;
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
  const altitudeOf = parts.realAltitude ? mapAltitudeOf(parts.map) : undefined;
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
        }),
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
        ...(parts.moldGossip ? [moldGossipProcess(parts.moldGossip)] : []),
        askAroundProcess({ player, traits: parts.traits, placeOf: placeOf(parts, village) }),
        creditProcess({ day: parts.clock.day, placeOf: placeOf(parts, village) }),
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
              }),
            ]
          : []),
        neighborsProcess({ clock: parts.clock, goods: parts.goods }),
        loansProcess({
          clock: parts.clock,
          goods: parts.goods,
          seeds: parts.loanSeeds ?? [],
          placeOf: placeOf(parts, village),
        }),
        ...(parts.rentSeeds && parts.rentSeeds.length > 0
          ? [
              rentsProcess({
                clock: parts.clock,
                goods: parts.goods,
                seeds: parts.rentSeeds,
                placeOf: placeOf(parts, village),
              }),
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
          ...(parts.waterSources ? { waterFor: waterHooks(parts.waterSources).waterFor } : {}),
          deficiency: parts.deficiencyEffects === true,
          placeOf: placeOf(parts, village),
        }),
        medicineProcess({
          clock: parts.clock,
          healers: parts.healers ?? [],
          school: parts.healerSchool,
          stock: parts.remedyStock,
          plans: parts.healerRealSigns === true ? parts.plans : undefined,
          placeOf: placeOf(parts, village),
        }),
        substancesProcess({
          clock: parts.clock,
          doses: parts.substanceDoses ?? [],
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
        thermalProcess({
          clock: parts.clock,
          map: parts.map,
          spaces: parts.spaces,
          seed: parts.seed,
          placeOf: placeOf(parts, village),
          ...(altitudeOf ? { altitude: { baseM: parts.map.baseElevationM ?? 0, altitudeOf } } : {}),
          ...(parts.frostbite === true ? { frostbite: true } : {}),
        }),
        ...(altitudeOf ? [altitudeProcess({ clock: parts.clock, altitudeOf })] : []),
        upkeepProcess({
          clock: parts.clock,
          map: parts.map,
          seed: parts.seed,
          materials: parts.materials ?? [],
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
        }),
        routineProcess({
          logMeals: parts.eatenNutrition === true,
          ...(parts.waterSources
            ? { drinkQuality: waterHooks(parts.waterSources).drinkQuality }
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
