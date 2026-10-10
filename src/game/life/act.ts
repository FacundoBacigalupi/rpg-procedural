// El plan del personaje en el mundo (player-loop §3, actions §3, §7): el plan entra como el
// componente `life.plan` del personaje y el proceso `life.act` lo ejecuta hoja por hoja contra el
// estado de ese momento. Cada corrida resuelve una hoja con `resolve` (la tirada común, el
// matiz, el evento con causas y emisiones), aplica lo que el paso le hace al cuerpo y a las
// habilidades de quien lo hizo, y agenda la hoja siguiente para cuando termina esta. Al
// terminar el último paso deja el plan en `done`.

import {
  type AgentId,
  type EntityRef,
  type HolderRef,
  holderAccount,
  type LedgerUnit,
  ledgerUnit,
  type PlanetClock,
  Rng,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import {
  ACCLIMATIZATION,
  type ActionCatalog,
  type ActionPlan,
  type Activity,
  AMPUTATIONS,
  adulterate,
  advance,
  applyAcute,
  type Bearing,
  BODY_STATE,
  type Body,
  type BodyPlanDef,
  BUILDING,
  bearingFactor,
  behindJammedDoor,
  beliefAbout,
  blowFromMishap,
  blowFromStrike,
  CREDIT,
  capabilitiesOf,
  DEFICIENCY_EFFECTS,
  type DealBudget,
  dayOf,
  deleteComponent,
  draftEvent,
  ENTITY,
  type EventDraft,
  endEntity,
  FINISH_FORCE,
  type FoodDef,
  FRESH_CURSOR,
  FROSTBITE,
  fieldFertility,
  fillerFor,
  type GoodDef,
  GROWTH_SEQUELAE,
  goodUnit,
  HARVEST_GOOD,
  HARVEST_GRAMS_PER_HOUR,
  harvestSeason,
  INNATE,
  ingest,
  injure,
  isScam,
  KNOWN_DEEDS,
  LANDMARK_MIN_LIGHT,
  LOCATION,
  LOT_ESSENCE,
  LOT_QUALITY,
  type LocalMap,
  learnFromAttempt,
  learnFromDeal,
  localHour,
  logMeal,
  MARKET_TAPE,
  type Market,
  MEALS,
  MIND,
  type Nutrition,
  nearestHex,
  netHydration,
  nodeAt,
  noteSeller,
  notoriety,
  OPINIONS,
  opposingSkill,
  PERSON,
  PLACE,
  type PlanCursor,
  type PlanNode,
  type PostingDraft,
  PRICE_BELIEFS,
  type ProcessContext,
  type ProcessDef,
  type ProcessResult,
  type Purpose,
  pillOf,
  placeAt,
  placeRefOf,
  qualityPriceFactor,
  RECEIPT_WINDOW_DAYS,
  REFERENCE_QUALITY,
  RELATIONS,
  RESIDUE,
  type ReadonlyWorldTruth,
  type RecipeDef,
  type ResolveInput,
  RUMORS,
  rankOf,
  receiveEssenceLot,
  receiveLot,
  recordDeal,
  recordScamDeal,
  reputationIn,
  resolve,
  SALE_RECEIPTS,
  SCAM_DEALS,
  SELF_IMAGES,
  SELLER_DAY,
  type SelfReport,
  SKILL_STATE,
  type SkillCatalog,
  SOIL,
  type SpaceGraph,
  STANDING_BELIEFS,
  STATUS,
  type StateChange,
  type StatusDef,
  setActivity,
  setComponent,
  skyBrightness,
  skyLight,
  skyObserverOf,
  spaceLight,
  standardize,
  type TapeEntry,
  THERMAL,
  TREATED_WATER,
  type Trait,
  table,
  treat,
  updateSelfImage,
  verbSkill,
  type WaterQuality,
  type WaterTreatment,
  walkingFactor,
  weatherAt,
  withReceipt,
  YIELDED,
} from "../../sim/index.ts";
import { applyAltitude } from "./altitude.ts";
import { coinCeilingOf, householdFlowsOf, standingOf } from "./budget.ts";
import { declaredStyle, listenTo, PENDING } from "./converse.ts";
import { masterCorrects } from "./correct.ts";
import { debtsTo } from "./credit.ts";
import { cueLocalOf } from "./cue-local.ts";
import { applyDeficiency } from "./deficiencyCaps.ts";
import { pricePushOf } from "./famineRow.ts";
import {
  atMyMercy,
  canFight,
  type Exposure,
  exposeSkills,
  FIGHT_STATE,
  livePause,
  strikeFight,
} from "./fight.ts";
import { loansOf } from "./loans.ts";
import { rentsOf } from "./rents.ts";
import { type ResidueConfig, takeEssence } from "./residue.ts";
import {
  acuteOf,
  type ConsumableDef,
  consumeDose,
  cueContextOf,
  scaledDose,
} from "./substances.ts";
import { applyCoreTemp, applyFrostbite } from "./thermal.ts";
import { incomeOfHousehold } from "./trades.ts";
import { watchersLearn } from "./watching.ts";

/** Un paso ya hecho, para la autopercepción y la narración del turno. */
export interface StepRecord {
  readonly verb: string;
  readonly at: number;
  readonly self: SelfReport;
  /** El porqué que declaró el jugador para el plan: el narrador solo lo cita. */
  readonly purpose?: Purpose | undefined;
}

/** El plan del personaje en curso (o terminado, `done`). Verdad de la sim: va a la base. */
export interface PlanState {
  readonly seq: number;
  readonly plan: ActionPlan;
  readonly cursor: PlanCursor;
  readonly lastBelieved: string | null;
  readonly steps: readonly StepRecord[];
  readonly done: boolean;
  /** Terminó un tramo de camino: el próximo paso repite la misma hoja sin avanzar el cursor. */
  readonly resume?: boolean;
}

export const PLAN_STATE = table<PlanState>("life.plan");

export const ACT_PROCESS = "life.act";

/** La clave de causa/razón de un plan: el ítem agendado y los eventos citan esto. */
export function planKey(seq: number): string {
  return `plan.${seq}`;
}

/** Agudeza de la mirada de paso al caminar (0-1); bajo `vagueBelow` el lugar queda vago. */
export const GLANCE_ACUITY = 0.6;

export interface ActOptions {
  /** Registrar lo comido en `MEALS` (para `life.nutrition` con `useEaten`). */
  readonly logMeals?: boolean;
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly catalog: ActionCatalog;
  readonly skills: SkillCatalog;
  readonly traits: readonly Trait[];
  readonly bodyPlans: readonly BodyPlanDef[];
  readonly foods: readonly FoodDef[];
  readonly goods: readonly GoodDef[];
  readonly recipes: readonly RecipeDef[];
  readonly statuses: readonly StatusDef[];
  readonly clock: PlanetClock;
  readonly seed: Seed;
  /** El personaje del jugador: sus peleas se pausan para que decida (combat §16). */
  readonly player: AgentId;
  /**
   * Opt-in: el trato pesa la reputación de la aldea (`reputationIn`: gravedad y confianza, con
   * rumores) en vez de solo la fracción que sabe algo. Apagado, el trato es el de siempre.
   */
  readonly reputationTrade?: boolean;
  /**
   * Opt-in: el trato escala el precio creído de la comida (`HARVEST_GOOD`) por el `pricePush` que
   * `life.famine` dejó en `FAMINE` para el asentamiento del actor. Apagado, o sin filas, no cambia.
   */
  readonly famineTrade?: boolean;
  /** Opt-in: la altura baja la resistencia al actuar (`applyAltitude`); apagado, no cambia. */
  readonly altitudeOf?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  /**
   * Opt-in: explorar a pie (un `move` que llega a otro hex) emite un evento de mirada de paso
   * (`look.glance`, agudeza `GLANCE_ACUITY`) que `life.moldgossip` con `fromLooking` lee como un `look`.
   */
  readonly glanceOnMove?: boolean;
  /** Opt-in: la congelación y las amputaciones bajan manos y pies al actuar (`applyFrostbite`); apagado, no cambia. */
  readonly frostbite?: boolean;
  /** Opt-in: el núcleo frío o caliente baja la destreza o deja inconsciente (`applyCoreTemp`); apagado, no cambia. */
  readonly coreEffects?: boolean;
  /** Opt-in: carencias (`vigor`, `oxygen`, `cognition`) y secuela cognitiva bajan las capacidades (`applyDeficiency`); apagado, no cambia. */
  readonly nutritionCaps?: boolean;
  /**
   * Opt-in: bienes que son sustancias de consumo (body-health §9): `consume` gasta una unidad y
   * suma una dosis con evento causal. Apagado, `consume` no tiene qué tomar y no cambia nada.
   */
  readonly consumables?: readonly ConsumableDef[];
  /**
   * Opt-in: comer un lote que contiene una sustancia (hierba, té) suma una dosis proporcional a
   * los gramos (`ConsumableDef.amount` = por gramo) vía `consumeDose`. Apagado: comer no cambia.
   */
  readonly foodSubstances?: readonly ConsumableDef[];
  /**
   * Opt-in: lo que se come o consume con `ConsumableDef.essence` deja residuo por su pureza
   * (`RESIDUE`) y, con `overload`, sobrecarga al cuerpo (fiebre, heridas, muerte). Apagado: nada.
   */
  readonly residue?: ResidueConfig;
  /**
   * Opt-in: lo que se bebe lleva una sustancia (té, tisana; `drink` no tiene bien): cada sorbo
   * suma `amount` por litro (`ConsumableDef.amount` = por litro) vía `consumeDose`. Apagado: beber no cambia.
   */
  readonly drinkSubstance?: ConsumableDef;
  /**
   * Opt-in: el verbo `boil` quema `grams` de la unidad `fuel` del ledger (de lo que lleva o de la
   * despensa) y deja agua tratada (`TREATED_WATER`) que dura `validDays` días. Apagado, `boil`
   * no tiene con qué y no cambia nada.
   */
  readonly boil?: BoilOptions;
  /**
   * Opt-in: el verbo `filter` gasta `grams` de la unidad `material` del ledger (lo que lleva o la
   * despensa) y deja agua filtrada (`TREATED_WATER`, `treatment` por defecto `filter`) que dura
   * `validDays` días. Apagado, `filter` no tiene con qué y no cambia nada.
   */
  readonly filter?: FilterOptions;
  /**
   * Opt-in: la calidad del agua que bebe el verbo `drink` (la sal deshidrata, `netHydration`); la
   * hidratación neta puede ser negativa y entonces falta más agua. Sin él, agua limpia como siempre.
   */
  readonly drinkQuality?: (truth: ReadonlyWorldTruth, who: AgentId, now?: number) => WaterQuality;
  /**
   * Opt-in: estafa de calidad (economy §6). `inflate` dice cuánto mejora de lo que es el vendedor
   * lo que ofrece (0 = honesto) y `trust` cuánto le cree el comprador (0-1); el comprador cotiza
   * por `believedQuality` y el lote sigue con su calidad real. Apagado, el comprador ve con su ojo.
   * Cada trato inflado queda en `SCAM_DEALS` del comprador (con el evento del trato) para que
   * `life.scam_discovery` lo descubra después.
   */
  readonly scam?: {
    readonly inflate: (truth: ReadonlyWorldTruth, seller: AgentId) => number;
    readonly trust: (
      truth: ReadonlyWorldTruth,
      buyer: AgentId,
      seller: AgentId,
      now: Tick,
    ) => number;
    /**
     * Opt-in: unidad del relleno (p. ej. piedras) con que el vendedor mezcla el lote; sale de su
     * bolsa (`fillerFor` desde su `inflate`) y pasa al comprador por el ledger en el mismo trato
     * (`scam.adulterated`); la calidad del lote recibido baja por promedio (`adulterate`).
     */
    readonly filler?: LedgerUnit;
  };
  /** Opt-in: cada dosis refuerza las señales del entorno (lugar, persona, hora); apagado, no guarda señales. */
  readonly cravingCues?: boolean;
  /** Opt-in (con `cravingCues`): las señales de la dosis usan creencias, huso y el objeto tomado; ver `cueLocalOf`. */
  readonly cueLocal?: boolean;
}

export interface BoilOptions {
  readonly fuel: string;
  readonly grams: number;
  readonly treatment: WaterTreatment;
  readonly validDays: number;
}

export interface FilterOptions {
  readonly material: string;
  readonly grams: number;
  readonly treatment?: WaterTreatment;
  readonly validDays: number;
}

/** El trato con relleno: lo que el vendedor mezcló en el lote (data: unit, filler, grams, lot). */
export const SCAM_ADULTERATED = "scam.adulterated";

const GOOD = (id: string): LedgerUnit => ledgerUnit(`good:${id}`);

/** El esfuerzo de cada verbo para el cuerpo (body-health: carga por actividad). */
const VERB_ACTIVITY: Readonly<Record<string, Activity>> = {
  move: "moderate",
  gather: "moderate",
  search: "light",
  work: "heavy",
  strike: "heavy",
  take: "light",
  store: "light",
  cook: "moderate",
  tend: "light",
  speak: "light",
  look: "light",
  eat: "rest",
  drink: "rest",
  wait: "rest",
  rest: "rest",
};

/** Descansar de noche es dormir. */
export function activityOf(verb: string, hour: number): Activity {
  const a = VERB_ACTIVITY[verb] ?? "light";
  return verb === "rest" && (hour >= 21 || hour < 5) ? "sleep" : a;
}

function placesOf(truth: ReadonlyWorldTruth) {
  return truth.ids(PLACE).flatMap((id) => {
    const place = truth.get(PLACE, id);
    return place ? [{ id, place }] : [];
  });
}

/** Qué tan fácil es torcer el rumbo ahora y qué hitos (la aldea, el agua) se distinguen (travel §11.3). */
function bearingOf(
  o: ActOptions,
  places: ReturnType<typeof placesOf>,
  hex: number,
  now: Tick,
): Bearing {
  const light = skyLight(o.map, o.clock, o.seed, now);
  const factor = bearingFactor(weatherAt(o.map, o.clock, o.seed, now), light, !!o.map.forest[hex]);
  const landmarks = new Set<number>();
  if (light >= LANDMARK_MIN_LIGHT) {
    for (const { place } of places) {
      if (place.kind === "village" || place.kind === "water") {
        for (const h of place.hexes as readonly number[]) landmarks.add(h);
      }
    }
  }
  return { factor, landmarks };
}

export function actProcess(o: ActOptions): ProcessDef {
  const foods = new Map<LedgerUnit, Nutrition>(
    o.foods.map((f) => [GOOD(f.id), { kcalPerGram: f.kcalPerGram, waterPerGram: f.waterPerGram }]),
  );
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  // Lo que rinde la hora de campo depende del día (calor, helada, lluvia) y del suelo, igual que en la rutina.
  const season = harvestSeason(o.map.climate, o.clock, Rng.root(o.seed));

  return {
    id: ACT_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "act",
    reads: [
      PLAN_STATE.name,
      KNOWN_DEEDS.name,
      RUMORS.name,
      STANDING_BELIEFS.name,
      CREDIT.name,
      SOIL.name,
      ENTITY.name,
      LOCATION.name,
      BUILDING.name,
      BODY_STATE.name,
      SKILL_STATE.name,
      SELF_IMAGES.name,
      YIELDED.name,
      FIGHT_STATE.name,
      PRICE_BELIEFS.name,
      LOT_QUALITY.name,
      MARKET_TAPE.name,
      SELLER_DAY.name,
      SALE_RECEIPTS.name,
      ACCLIMATIZATION.name,
      DEFICIENCY_EFFECTS.name,
      GROWTH_SEQUELAE.name,
      FROSTBITE.name,
      THERMAL.name,
      AMPUTATIONS.name,
      TREATED_WATER.name,
      ...(o.scam ? [INNATE.name, MIND.name, RELATIONS.name, SCAM_DEALS.name] : []),
      ...(o.residue ? [LOT_ESSENCE.name] : []),
    ],
    writes: [
      ...(o.scam ? [SCAM_DEALS.name] : []),
      ...(o.residue ? [RESIDUE.name, LOT_ESSENCE.name] : []),
      PRICE_BELIEFS.name,
      MARKET_TAPE.name,
      SALE_RECEIPTS.name,
      SELLER_DAY.name,
      LOT_QUALITY.name,
      PLAN_STATE.name,
      LOCATION.name,
      BODY_STATE.name,
      MEALS.name,
      SKILL_STATE.name,
      SELF_IMAGES.name,
      OPINIONS.name,
      PENDING.name,
      YIELDED.name,
      FIGHT_STATE.name,
    ],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const state = ctx.truth.get(PLAN_STATE, me);
      if (!state || state.done) return {};
      // Un plan nuevo reemplaza al anterior: el ítem viejo ya no tiene a quién ejecutar.
      if (ctx.item?.reason.kind !== "state" || ctx.item.reason.key !== planKey(state.seq)) {
        return {};
      }
      if (ctx.truth.get(ENTITY, me)?.endedAt !== undefined) return {};

      const hex = ctx.truth.get(LOCATION, me)?.hex ?? 0;
      const space = ctx.truth.get(LOCATION, me)?.space;
      const node = space === undefined ? undefined : o.spaces.spaces.find((s) => s.key === space);
      const sky = skyBrightness(o.clock, skyObserverOf(o.map), ctx.now);
      const hour = localHour(o.clock, ctx.now, o.map.lonDeg);
      const light = node ? spaceLight(node, sky) : sky;
      const cursor = state.resume
        ? state.cursor
        : advance(state.plan.root, state.cursor, {
            now: ctx.now,
            dark: light < 0.2,
            lastBelieved: state.lastBelieved,
          });
      if (cursor.path === null) {
        const changes: StateChange[] = [
          setComponent(PLAN_STATE, me, { ...state, cursor, done: true }),
        ];
        const body = ctx.truth.get(BODY_STATE, me);
        if (body && body.activity !== "rest") {
          changes.push(setComponent(BODY_STATE, me, setActivity(body, "rest")));
        }
        return { changes };
      }
      return step(ctx, o, { me, state, cursor, foods, plans, hex, light, hour, season });
    },
  };
}

interface StepEnv {
  readonly me: AgentId;
  readonly state: PlanState;
  readonly cursor: PlanCursor;
  readonly foods: ReadonlyMap<LedgerUnit, Nutrition>;
  readonly plans: ReadonlyMap<string, BodyPlanDef>;
  readonly hex: number;
  readonly season: (day: number) => number;
  readonly light: number;
  readonly hour: number;
}

/** Cuántos comen de la despensa de ese hogar. */
function membersOf(truth: ReadonlyWorldTruth, household: string): number {
  return Math.max(
    1,
    truth
      .ids(PERSON)
      .filter(
        (id) =>
          truth.get(PERSON, id)?.household === household &&
          truth.get(ENTITY, id)?.endedAt === undefined,
      ).length,
  );
}

/** El presupuesto del hogar del otro del trato: su tope de gasto y cómo está. */
function dealBudgetOf(
  ctx: ProcessContext,
  truth: ReadonlyWorldTruth,
  o: ActOptions,
  home: string,
): DealBudget {
  const flows = householdFlowsOf(
    truth,
    {
      goods: o.goods,
      ledger: ctx.ledger,
      now: ctx.now,
      day: o.clock.day,
      year: o.clock.year,
      incomePerDay: incomeOfHousehold(truth, home, Math.floor(ctx.now / o.clock.day)),
      loans: loansOf(truth, holderAccount(home as unknown as HolderRef)),
      rents: rentsOf(truth, home),
    },
    home,
  );
  return {
    coinCeiling: coinCeilingOf(flows, false),
    urgentCeiling: coinCeilingOf(flows, true),
    standing: standingOf(flows),
  };
}

/**
 * La fama que pesa en el trato desde `reputationIn` (information §5): la fracción de la aldea que
 * sabe algo de `me` por cuánto lo mal cree (gravedad y confianza de lo visto y de los rumores), no
 * por contar hechos sueltos. Sin agravios conocidos da 0, igual que `notoriety`.
 */
export function reputationFameOf(truth: ReadonlyWorldTruth, me: AgentId): number {
  const village = truth.ids(PERSON) as readonly AgentId[];
  const rep = reputationIn(
    village,
    me,
    (id) => truth.get(KNOWN_DEEDS, id),
    (id) => truth.get(RUMORS, id),
  );
  return rep.fame * Math.min(1, Math.max(0, -rep.standing));
}

/** Los precios y las casas que `trade` y `work` necesitan para mover bienes (economy §4). */
function marketOf(
  ctx: ProcessContext,
  truth: ReadonlyWorldTruth,
  o: ActOptions,
  me: AgentId,
  other: EntityRef | null,
  harvestGramsPerHour: number,
  day: number,
): Market {
  const otherHome = other === null ? undefined : truth.get(PERSON, other as AgentId)?.household;
  return {
    priceCopperPerKg: new Map(
      o.goods.flatMap((g) =>
        g.priceCopperPerKg === undefined ? [] : [[goodUnit(g), g.priceCopperPerKg] as const],
      ),
    ),
    lots: {
      actor: truth.get(LOT_QUALITY, me),
      other: other === null ? undefined : truth.get(LOT_QUALITY, other as AgentId),
    },
    beliefs: {
      actor: truth.get(PRICE_BELIEFS, me),
      other: other === null ? undefined : truth.get(PRICE_BELIEFS, other as AgentId),
      day,
    },
    ownMembers: membersOf(truth, truth.get(PERSON, me)?.household ?? ""),
    other:
      otherHome === undefined
        ? undefined
        : {
            larder: otherHome as unknown as HolderRef,
            members: membersOf(truth, otherHome),
            // Solo en los tratos del jugador: el tope de monedas y el apuro del otro (economy §3).
            budget: me === o.player ? dealBudgetOf(ctx, truth, o, otherHome) : undefined,
          },
    harvestGramsPerHour,
    harvestGood: HARVEST_GOOD,
    ...(o.scam && other !== null
      ? {
          scam: {
            inflate: {
              actor: o.scam.inflate(truth, me),
              other: o.scam.inflate(truth, other as AgentId),
            },
            trust: {
              actor: o.scam.trust(truth, other as AgentId, me, ctx.now),
              other: o.scam.trust(truth, me, other as AgentId, ctx.now),
            },
          },
        }
      : {}),
    ...(o.famineTrade
      ? { pricePush: { unit: HARVEST_GOOD, factor: pricePushOf(truth, me as string) } }
      : {}),
    fame: o.reputationTrade
      ? reputationFameOf(truth, me)
      : notoriety(
          truth.ids(PERSON).flatMap((id) => (id === me ? [] : [truth.get(KNOWN_DEEDS, id)])),
          me,
        ),
    ranks: {
      actor: rankOf(truth.get(STATUS, me), o.statuses),
      // La posición del otro es lo que el actor CREE de él, no su STATUS (social-structure §3).
      other:
        other === null
          ? undefined
          : beliefAbout(truth.get(STANDING_BELIEFS, me), other as AgentId)?.rank,
    },
  };
}

function step(ctx: ProcessContext, o: ActOptions, e: StepEnv): ProcessResult {
  const { me, state, cursor } = e;
  const truth = ctx.truth;
  // Entorno de la dosis; con `cueLocal`, a quién cree presente, el huso y el objeto tomado (su olor).
  const doseCueCtx = (good: string) =>
    cueContextOf(
      truth,
      me,
      ctx.now,
      o.clock,
      o.cueLocal
        ? { ...cueLocalOf(truth, me, ctx.now, o.clock, o.map.lonDeg), objects: [good] }
        : undefined,
    );
  const node = nodeAt(state.plan.root, cursor.path as number[]) as Extract<
    PlanNode,
    { kind: "do" }
  >;
  const def = o.catalog.verb(node.verb);
  if (!def) throw new RangeError(`verbo desconocido en el plan: ${node.verb}`);

  const person = truth.get(PERSON, me);
  const innate = truth.get(INNATE, me);
  const body = truth.get(BODY_STATE, me);
  if (!person || !innate || !body) throw new Error(`${me} no tiene persona, rasgos o cuerpo`);
  const bodyPlan = e.plans.get(body.plan) as BodyPlanDef;
  const acuteCaps = applyAcute(capabilitiesOf(bodyPlan, body), acuteOf(truth, me));
  const altCaps = o.altitudeOf ? applyAltitude(acuteCaps, truth, me, o.altitudeOf) : acuteCaps;
  const frostCaps = o.frostbite ? applyFrostbite(altCaps, truth, me) : altCaps;
  const coreCaps = o.coreEffects ? applyCoreTemp(frostCaps, truth, me) : frostCaps;
  const caps = o.nutritionCaps ? applyDeficiency(coreCaps, truth, me) : coreCaps;
  const skills = truth.get(SKILL_STATE, me);
  const places = placesOf(truth);

  const partyOf = (id: EntityRef) => {
    const p = truth.get(PERSON, id as AgentId);
    const n = truth.get(INNATE, id as AgentId);
    return {
      id,
      z: p && n ? standardize(n, o.traits, p.sex) : {},
      hex: truth.get(LOCATION, id)?.hex ?? e.hex,
      skill: opposingSkill(o.skills, truth.get(SKILL_STATE, id), node.verb),
    };
  };
  const parties: ResolveInput["parties"] = Object.fromEntries(
    node.args.flatMap((a) =>
      "entity" in a && a.entity.startsWith("agent:") ? [[a.role, partyOf(a.entity)]] : [],
    ),
  );
  const destArg = node.args.find((a) => "entity" in a && a.entity.startsWith("place:"));
  const destination =
    destArg && "entity" in destArg
      ? nearestHex(
          o.map,
          e.hex,
          (truth.get(PLACE, destArg.entity)?.hexes as readonly number[] | undefined) ?? [e.hex],
        )
      : undefined;

  const z = standardize(innate, o.traits, person.sex);
  const here = placeAt(places, e.hex);
  const day = dayOf(o.clock, ctx.now + Math.round((o.map.lonDeg / 360) * o.clock.day));
  const harvestRate = HARVEST_GRAMS_PER_HOUR * e.season(day) * fieldFertility(truth);
  const input: ResolveInput = {
    def,
    node,
    planManner: state.plan.manner,
    actor: {
      id: me,
      z,
      capabilities: caps,
      hex: e.hex,
      skill: verbSkill(o.skills, skills, node.verb),
    },
    parties,
    scene: {
      light: e.light,
      terrain: o.map.forest[e.hex] ? 0.6 : 0.1,
      placeKinds: places
        .filter((p) => (p.place.hexes as readonly number[]).includes(e.hex))
        .map((p) => p.place.kind),
    },
    tick: ctx.now,
    rng: ctx.rng.fork("act", state.seq, (cursor.path as number[]).join(".")),
    map: o.map,
    destination,
    shut:
      def.resolver === "move" ? behindJammedDoor(truth, truth.get(LOCATION, me)?.space) : undefined,
    walkFactor:
      def.resolver === "move"
        ? walkingFactor(weatherAt(o.map, o.clock, o.seed, ctx.now))
        : undefined,
    bearing: def.resolver === "move" ? bearingOf(o, places, e.hex, ctx.now) : undefined,
    ledger: { holdings: (a) => ctx.ledger?.holdings(a) ?? [] },
    place: placeRefOf(o.map, here),
    causes: [{ kind: "state", entity: me, key: planKey(state.seq) }],
    foods: e.foods,
    unitNames: new Map(o.goods.map((g) => [goodUnit(g), g.name] as const)),
    larder: person.household as unknown as HolderRef,
    boilFuel:
      o.boil && node.verb === "boil"
        ? { unit: ledgerUnit(o.boil.fuel), grams: o.boil.grams }
        : undefined,
    filterMaterial:
      o.filter && node.verb === "filter"
        ? { unit: ledgerUnit(o.filter.material), grams: o.filter.grams }
        : undefined,
    consumables:
      o.consumables && node.verb === "consume"
        ? new Set(o.consumables.map((c) => GOOD(c.good)))
        : undefined,
    owed: node.verb === "give" ? debtsTo(truth, me, parties["to"]?.id ?? null) : undefined,
    recipes: node.verb === "cook" ? o.recipes : undefined,
    market:
      node.verb === "trade" || node.verb === "work"
        ? marketOf(ctx, truth, o, me, parties["with"]?.id ?? null, harvestRate, day)
        : undefined,
  };
  const r = resolve(input);

  // Lo que el paso le hace al cuerpo (body-health): comer, beber, curar, golpes y percances.
  let nextBody: Body = setActivity(body, activityOf(node.verb, e.hour));
  let bodyTouched = nextBody !== body;
  const changes: StateChange[] = [...r.changes];
  const doseEvents: EventDraft[] = [];
  const eff = r.effect;
  let essence: { essence: number; purity: number | undefined; good: string } | undefined;
  if (eff.kind === "eat") {
    nextBody = ingest(bodyPlan, nextBody, eff.kcal, eff.water);
    if (o.logMeals && eff.good !== null && eff.grams > 0)
      changes.push(
        setComponent(
          MEALS,
          me,
          logMeal(truth.get(MEALS, me), Math.floor(ctx.now / o.clock.day), eff.good, eff.grams),
        ),
      );
    bodyTouched = true;
    const laced =
      eff.good !== null && eff.grams > 0
        ? o.foodSubstances?.find((c) => GOOD(c.good) === eff.good)
        : undefined;
    if (laced?.essence !== undefined && eff.good !== null) {
      essence = { essence: laced.essence * eff.grams, purity: laced.purity, good: laced.good };
    }
    if (laced) {
      const dose = consumeDose(
        truth,
        me,
        scaledDose(laced, eff.grams),
        ctx,
        input.place,
        r.events.length,
        o.cravingCues ? { ctx: doseCueCtx(laced.good), clock: o.clock } : undefined,
      );
      changes.push(...dose.changes);
      doseEvents.push(...dose.events);
    }
  } else if (eff.kind === "drink") {
    const q = o.drinkQuality?.(truth, me, ctx.now);
    const net = q ? netHydration(eff.liters, q) : eff.liters;
    nextBody =
      net >= 0 ? ingest(bodyPlan, nextBody, 0, net) : { ...nextBody, water: nextBody.water - net };
    bodyTouched = true;
    if (o.drinkSubstance && eff.liters > 0) {
      const dose = consumeDose(
        truth,
        me,
        scaledDose(o.drinkSubstance, eff.liters),
        ctx,
        input.place,
        r.events.length,
        o.cravingCues ? { ctx: doseCueCtx(o.drinkSubstance.good), clock: o.clock } : undefined,
      );
      changes.push(...dose.changes);
      doseEvents.push(...dose.events);
    }
  } else if (eff.kind === "boil" && eff.fuel !== null && eff.grams > 0 && o.boil) {
    changes.push(
      setComponent(TREATED_WATER, me, {
        treatment: o.boil.treatment,
        until: ctx.now + Math.round(o.boil.validDays * o.clock.day),
      }),
    );
  } else if (eff.kind === "filter" && eff.material !== null && eff.grams > 0 && o.filter) {
    changes.push(
      setComponent(TREATED_WATER, me, {
        treatment: o.filter.treatment ?? "filter",
        until: ctx.now + Math.round(o.filter.validDays * o.clock.day),
      }),
    );
  } else if (eff.kind === "consume" && eff.good !== null && eff.units > 0) {
    // La dosis entra al cuerpo ahora; `life.substances` la absorbe y metaboliza desde la próxima hora.
    const used = o.consumables?.find((c) => GOOD(c.good) === eff.good);
    if (used?.essence !== undefined) {
      essence = { essence: used.essence * eff.units, purity: used.purity, good: used.good };
    }
    if (used) {
      const dose = consumeDose(
        truth,
        me,
        used,
        ctx,
        input.place,
        r.events.length,
        o.cravingCues ? { ctx: doseCueCtx(used.good), clock: o.clock } : undefined,
      );
      changes.push(...dose.changes);
      doseEvents.push(...dose.events);
    }
  } else if (eff.kind === "tend" && eff.done) {
    const target = eff.target === me ? nextBody : truth.get(BODY_STATE, eff.target as AgentId);
    const worst = target?.wounds
      .filter((w) => w.stage !== "healed")
      .sort((a, b) => b.severity - a.severity)[0];
    if (target && worst) {
      const treated = treat(target, worst.id, worst.infection > 0.05 ? "clean" : "bandage");
      if (eff.target === me) nextBody = treated;
      else changes.push(setComponent(BODY_STATE, eff.target as AgentId, treated));
      bodyTouched = bodyTouched || eff.target === me;
    }
  }
  const intakePostings: PostingDraft[] = [];
  if (o.residue && eff.kind === "eat" && eff.good !== null && eff.grams > 0) {
    // Lo preparado por alquimia lleva su propia esencia y pureza (por gramo): pisa lo del contenido.
    const lot = truth.get(LOT_ESSENCE, me)?.[eff.good];
    if (lot) {
      essence = {
        essence: lot.essence * eff.grams,
        purity: lot.purity,
        good: eff.good.replace(/^good:/, ""),
      };
    }
  }
  if (o.residue && essence) {
    // Pureza y sobrecarga de lo ingerido con `Essence`: residuo en `RESIDUE`, heridas o muerte.
    const k = r.events.length + doseEvents.length;
    const take = takeEssence(truth, me, essence, o.residue, ctx.now, input.place, {
      kind: "event",
      event: draftEvent(0),
    });
    changes.push(...take.changes);
    intakePostings.push(...take.postings);
    doseEvents.push(...take.events);
    const ov = take.overload;
    if (ov && ov.stage === "fatal") {
      const base = truth.get(ENTITY, me);
      doseEvents.push({
        kind: "body.died",
        actors: [me],
        place: input.place,
        data: { cause: "poison", reason: "overload", good: essence.good },
        emissions: { sight: 0.6, sound: 0.2 },
        causes: [{ kind: "event", event: draftEvent(k) }],
      });
      if (base) changes.push(endEntity(base, draftEvent(k + 1), ctx.now));
    } else if (ov && ov.meridianDamage > 0) {
      nextBody = injure(
        bodyPlan,
        nextBody,
        {
          kind: "blunt",
          force: ov.meridianDamage * 0.6,
          zone: "torso",
          cause: draftEvent(k),
          at: ctx.now,
        },
        input.rng.fork("overload"),
      ).body;
      bodyTouched = true;
    }
  }
  const mishap = blowFromMishap(eff, draftEvent(0), ctx.now, input.rng.fork("mishap"));
  if (mishap) {
    nextBody = injure(bodyPlan, nextBody, mishap, input.rng.fork("injure")).body;
    bodyTouched = true;
  }
  // Un golpe contra alguien vivo es el comienzo de una pelea (combat §1): corre hasta que alguien
  // no puede o no quiere seguir. Contra quien ya no está en pie queda el golpe suelto.
  const targetId = "target" in eff ? (eff.target as AgentId | null) : null;
  const extraEvents: EventDraft[] = [];
  const fillerPostings: PostingDraft[] = [];
  let fightSeconds = 0;
  let exposure: Exposure | undefined;
  let record: StepRecord["self"] = r.self;
  const merciful = targetId !== null && atMyMercy(truth, me, targetId, ctx.now);
  if (eff.kind === "spare" && targetId && merciful) {
    // Perdonar: lo deja ir. Queda en lo que los testigos vieron, no en un castigo.
    changes.push(deleteComponent(YIELDED, targetId));
    extraEvents.push({
      kind: "combat.spare",
      actors: [me, targetId],
      place: input.place,
      data: {},
      emissions: { sight: 0.6, sound: 0.3 },
      causes: [{ kind: "event", event: draftEvent(0) }],
    });
  } else if (eff.kind === "strike" && eff.committed && targetId && merciful) {
    // Rematar a quien se rindió: no hay pelea, hay un golpe a alguien que no se defiende.
    const tb = truth.get(BODY_STATE, targetId);
    if (tb) {
      changes.push(
        setComponent(
          BODY_STATE,
          targetId,
          injure(
            bodyPlan,
            tb,
            { kind: "blunt", force: FINISH_FORCE, zone: "head", cause: draftEvent(0), at: ctx.now },
            input.rng.fork("finish"),
          ).body,
        ),
        deleteComponent(YIELDED, targetId),
      );
    }
    extraEvents.push({
      kind: "combat.finish",
      actors: [me, targetId],
      place: input.place,
      data: {},
      emissions: { sight: 1, sound: 0.6 },
      causes: [{ kind: "event", event: draftEvent(0) }],
    });
    if (r.self.effect.kind === "strike") {
      record = { ...r.self, effect: { ...r.self.effect, finished: true } };
    }
  } else if (eff.kind === "strike" && eff.committed && targetId && canFight(truth, targetId)) {
    // Si la pelea quedó pausada contra el mismo rival y sigue caliente, esto la retoma.
    const resumed = livePause(truth, me, targetId, ctx.now);
    const fight = strikeFight({
      truth,
      me,
      myBody: nextBody,
      target: targetId,
      plans: e.plans,
      skills: o.skills,
      traits: o.traits,
      intent: [...state.plan.manner, ...node.manner].includes("fast") ? "drive_off" : "subdue",
      light: e.light,
      ...([...state.plan.manner, ...node.manner].includes("hold_back") ? { holdBack: 1 } : {}),
      start: ctx.now,
      rng: input.rng.fork("fight"),
      ...(o.coreEffects ? { coreEffects: true } : {}),
      day: o.clock.day,
      cause: draftEvent(0),
      place: input.place,
      ...(me === o.player ? { control: true } : {}),
      ...(resumed ? { resume: resumed } : {}),
    });
    nextBody = fight.myBody;
    bodyTouched = true;
    changes.push(...fight.changes);
    extraEvents.push(fight.event);
    fightSeconds = fight.seconds;
    exposure = fight.exposure;
    if (r.self.effect.kind === "strike") {
      record = { ...r.self, effect: { ...r.self.effect, fight: fight.gist } };
    }
  } else {
    const blow = blowFromStrike(eff, draftEvent(0), ctx.now);
    if (blow && targetId) {
      const tb = truth.get(BODY_STATE, targetId);
      if (tb) {
        changes.push(
          setComponent(
            BODY_STATE,
            targetId,
            injure(bodyPlan, tb, blow, input.rng.fork("hit")).body,
          ),
        );
      }
    }
  }
  if (bodyTouched) changes.push(setComponent(BODY_STATE, me, nextBody));

  // Lo que aprendió del paso (skills §3).
  const age = (ctx.now - person.born) / o.clock.year;
  const learned = learnFromAttempt(
    o.skills,
    skills,
    { z, capabilities: caps, ageYears: age },
    def,
    r.attempt,
    r.seconds,
    ctx.now,
  );
  // Pelear le enseñó el estilo del rival (skills §2.3): se suma sobre lo aprendido del paso.
  const lessons = exposure
    ? exposeSkills(learned ?? skills, exposure, ctx.now + fightSeconds, o.clock.day)
    : learned;
  if (lessons) changes.push(setComponent(SKILL_STATE, me, lessons));
  // Los presentes que lo vieron aprenden mirando (skills §3.2).
  if (r.attempt.expected !== null) {
    changes.push(
      ...watchersLearn({
        truth,
        catalog: o.skills,
        traits: o.traits,
        plans: e.plans,
        clock: o.clock,
        doer: me,
        verb: node.verb,
        doerLevel: input.actor.skill ?? 0,
        // El rival de la pelea ya recibió su propio cambio de habilidades (familiaridad).
        except: targetId,
        rng: input.rng.fork("watch"),
        hex: e.hex,
        light: skyLight(o.map, o.clock, o.seed, ctx.now),
        spaces: o.spaces,
        forest: o.map.forest,
        emissions: r.emissions,
        seconds: r.seconds,
        now: ctx.now,
      }),
    );
  }
  // Y lo que cree de sí mismo por el resultado que percibió (skills §9).
  const image = updateSelfImage(
    o.skills,
    truth.get(SELF_IMAGES, me),
    skills,
    z,
    node.verb,
    r.attempt,
    ctx.now,
  );
  if (image) changes.push(setComponent(SELF_IMAGES, me, image));

  // Un trato cerrado se ve: los dos corren lo que creen del bien hacia lo que se pagó (economy §4).
  if (eff.kind === "trade" && eff.deal && eff.good !== null && eff.grams > 0 && eff.with) {
    const unit = eff.good as string;
    const ref = o.goods.find((g) => goodUnit(g) === eff.good)?.priceCopperPerKg;
    // Lo pagado se normaliza a la calidad de referencia: el bien bueno no sube "el precio del bien".
    const paid =
      ((eff.coins / eff.grams) * 1000) / qualityPriceFactor(eff.quality ?? REFERENCE_QUALITY);
    // Relleno (opt-in): el vendedor mezcla de lo que tiene en la bolsa; pasa al comprador por el
    // ledger en este trato y baja la calidad del lote recibido (conserva la masa).
    let dealQuality = eff.quality;
    let mixedFiller = 0;
    if (
      o.scam?.filler !== undefined &&
      eff.quality !== undefined &&
      eff.believed !== undefined &&
      isScam(eff.quality, eff.believed) &&
      ctx.ledger
    ) {
      const buyerId = eff.direction === "buy" ? me : (eff.with as AgentId);
      const sellerId = buyerId === me ? (eff.with as AgentId) : me;
      const stock =
        ctx.ledger
          .holdings(holderAccount(sellerId as unknown as HolderRef))
          .find((h) => h.unit === o.scam?.filler)?.amount ?? 0;
      const grams = Math.min(
        Math.floor(fillerFor(eff.grams, o.scam.inflate(truth, sellerId))),
        Math.floor(stock),
      );
      if (grams >= 1) {
        dealQuality = adulterate(eff.grams, eff.quality, grams).quality;
        mixedFiller = grams;
        fillerPostings.push({
          event: draftEvent(0),
          transfers: [
            {
              unit: o.scam.filler,
              from: holderAccount(sellerId as unknown as HolderRef),
              to: holderAccount(buyerId as unknown as HolderRef),
              amount: grams,
            },
          ],
        });
        extraEvents.push({
          kind: SCAM_ADULTERATED,
          actors: [sellerId, buyerId],
          place: input.place,
          data: { unit: eff.good as string, filler: o.scam.filler, grams, lot: eff.grams },
          emissions: {},
          causes: [{ kind: "event", event: draftEvent(0) }],
        });
      }
    }
    // El lote cambia de manos con su calidad: se mezcla con lo que el comprador ya tenía.
    if (eff.quality !== undefined) {
      const buyer = eff.direction === "buy" ? me : (eff.with as AgentId);
      const heldBy = (h: unknown) => ctx.ledger?.holdings(holderAccount(h as HolderRef)) ?? [];
      const home = truth.get(PERSON, buyer)?.household;
      const held = [...heldBy(buyer), ...(home === undefined ? [] : heldBy(home))]
        .filter((r) => r.unit === eff.good)
        .reduce((sum, r) => sum + r.amount, 0);
      changes.push(
        setComponent(
          LOT_QUALITY,
          buyer,
          receiveLot(
            truth.get(LOT_QUALITY, buyer),
            unit,
            held,
            eff.grams,
            dealQuality ?? eff.quality,
          ),
        ),
      );
    }
    if (ref !== undefined && paid > 0) {
      const buyer = eff.direction === "buy" ? me : (eff.with as AgentId);
      const seller = buyer === me ? (eff.with as AgentId) : me;
      // Un trato inflado queda registrado con su evento: es lo que después se descubre.
      if (
        o.scam &&
        eff.believed !== undefined &&
        eff.quality !== undefined &&
        isScam(eff.quality, eff.believed)
      ) {
        changes.push(
          setComponent(
            SCAM_DEALS,
            buyer,
            recordScamDeal(truth.get(SCAM_DEALS, buyer), {
              event: draftEvent(0),
              tick: ctx.now,
              seller,
              unit,
              grams: eff.grams,
              coins: eff.coins,
              real: dealQuality ?? eff.quality,
              believed: eff.believed,
              trust: o.scam.trust(truth, buyer, seller, ctx.now),
              ...(mixedFiller > 0 ? { filler: mixedFiller } : {}),
            }),
          ),
        );
      }
      // La cinta guarda el precio normalizado a la calidad de referencia (lo que aprenden todos).
      const entry: TapeEntry = {
        day,
        unit,
        grams: eff.grams,
        coins: (paid * eff.grams) / 1000,
        seller,
        buyer,
      };
      const market = here ?? seller;
      changes.push(
        setComponent(MARKET_TAPE, market, recordDeal(truth.get(MARKET_TAPE, market) ?? [], entry)),
      );
      // Lo cobrado es ingreso real del hogar del vendedor (recibo de venta; alimenta su presupuesto).
      const sellerHome = truth.get(PERSON, seller)?.household;
      if (sellerHome !== undefined && eff.coins > 0)
        changes.push(
          setComponent(SALE_RECEIPTS, sellerHome as never, {
            receipts: withReceipt(
              truth.get(SALE_RECEIPTS, sellerHome as never)?.receipts ?? [],
              day,
              eff.coins,
              RECEIPT_WINDOW_DAYS,
            ),
          }),
        );
      // Las partes toman el precio entero; quien estaba en el hex y despierto lo vio de lejos.
      const learners = new Map<AgentId, "party" | "witness">();
      for (const id of [...(truth.ids(PERSON) as AgentId[])].sort()) {
        if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        if (truth.get(LOCATION, id)?.hex !== e.hex) continue;
        if (truth.get(BODY_STATE, id)?.activity === "sleep") continue;
        learners.set(id, "witness");
      }
      learners.set(me, "party");
      learners.set(eff.with as AgentId, "party");
      for (const [who, role] of [...learners].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        changes.push(
          setComponent(
            PRICE_BELIEFS,
            who,
            learnFromDeal(truth.get(PRICE_BELIEFS, who), entry, ref, role),
          ),
        );
      }
    }
  }

  // El vendedor lleva el día: lo que sacó a la venta y lo que vendió (cierre en `life.market`).
  if (eff.kind === "trade" && eff.with) {
    const other = eff.with as AgentId;
    const day = Math.floor(ctx.now / o.clock.day);
    const note = (seller: AgentId, unit: string, offered: number, sold: number) =>
      changes.push(
        setComponent(
          SELLER_DAY,
          seller,
          noteSeller(truth.get(SELLER_DAY, seller), day, unit, offered, sold),
        ),
      );
    if (eff.deal && eff.direction !== null && eff.good !== null && eff.grams > 0) {
      note(eff.direction === "sell" ? me : other, eff.good as string, eff.grams, eff.grams);
    } else if (eff.unsold !== undefined && eff.unsold.grams > 0) {
      note(
        eff.unsold.seller === "actor" ? me : other,
        eff.unsold.good as string,
        eff.unsold.grams,
        0,
      );
    }
  }

  // Lo que cocinó queda con su calidad, mezclada con lo que ya tenía de ese bien (crafts §11).
  if (eff.kind === "cook" && eff.good !== null && eff.grams > 0 && eff.from !== null) {
    const held = (ctx.ledger?.holdings(holderAccount(eff.from as HolderRef)) ?? [])
      .filter((r) => r.unit === eff.good)
      .reduce((sum, r) => sum + r.amount, 0);
    changes.push(
      setComponent(
        LOT_QUALITY,
        me,
        receiveLot(truth.get(LOT_QUALITY, me), eff.good as string, held, eff.grams, eff.quality),
      ),
    );
  }

  // La alquimia escribe la esencia y la pureza en lo que produjo (opt-in, `pill` de la receta).
  if (o.residue && eff.kind === "cook" && eff.good !== null && eff.grams > 0 && eff.from !== null) {
    const recipe = o.recipes?.find((rc) => GOOD(rc.output.good) === eff.good);
    const made = pillOf(recipe?.pill, eff.quality);
    if (made) {
      const held = (ctx.ledger?.holdings(holderAccount(eff.from as HolderRef)) ?? [])
        .filter((r2) => r2.unit === eff.good)
        .reduce((sum, r2) => sum + r2.amount, 0);
      changes.push(
        setComponent(
          LOT_ESSENCE,
          me,
          receiveEssenceLot(
            truth.get(LOT_ESSENCE, me),
            eff.good as string,
            held,
            eff.grams,
            made.essence,
            made.purity,
          ),
        ),
      );
    }
  }

  // Un maestro de la casa que vio la tanda le señala lo que notó y el cocinero lo incorpora (crafts §11).
  if (eff.kind === "cook" && eff.defects && eff.defects.length > 0) {
    const fix = masterCorrects({
      truth,
      catalog: o.skills,
      traits: o.traits,
      plans: e.plans,
      clock: o.clock,
      cook: me,
      verb: node.verb,
      defects: eff.defects,
      hex: e.hex,
      seconds: r.seconds,
      expected: r.attempt.expected,
      now: ctx.now,
      skills: lessons ?? skills,
    });
    if (fix) {
      changes.push(...fix.changes);
      extraEvents.push({
        kind: "craft.corrected",
        actors: [fix.master, me],
        place: input.place,
        data: { noticed: fix.noticed.map((d) => d.kind), gain: Math.round(fix.gain * 1000) / 1000 },
        emissions: { sight: 0.3, sound: 0.5 },
        causes: [{ kind: "event", event: draftEvent(0) }],
      });
    }
  }

  if (
    o.glanceOnMove &&
    eff.kind === "move" &&
    eff.reached !== null &&
    eff.reached !== eff.from &&
    eff.blocked === undefined
  ) {
    extraEvents.push({
      kind: "look.glance",
      actors: [me],
      place: input.place,
      data: { glance: { acuity: GLANCE_ACUITY, hex: eff.reached } },
      emissions: { sight: 0.1 },
      causes: [{ kind: "event", event: draftEvent(0) }],
    });
  }

  // Un tramo de camino a medias no cuenta como paso: el viaje se registra al llegar o al fallar.
  const resume = eff.kind === "move" && eff.onTheWay === true;
  const stepRecord: StepRecord = {
    verb: node.verb,
    at: ctx.now,
    self: record,
    ...(state.plan.purpose ? { purpose: state.plan.purpose } : {}),
  };
  const lastBelieved = r.self.believed;
  const end = ctx.now + Math.max(r.seconds, fightSeconds);
  // Si le habló a alguien en persona, el oyente contesta cuando termina de oír (converse).
  const heard =
    eff.kind === "speak" && eff.delivered && eff.to !== null
      ? listenTo(
          me,
          eff.to,
          eff.text,
          eff.clarity,
          ctx.now,
          end,
          declaredStyle([...state.plan.manner, ...node.manner]),
          eff.act?.kind,
          eff.act ?? undefined,
        )
      : { changes: [], schedule: [] };
  changes.push(...heard.changes);
  changes.push(
    setComponent(PLAN_STATE, me, {
      ...state,
      cursor,
      lastBelieved,
      steps: resume ? state.steps : [...state.steps, stepRecord],
      ...(resume ? { resume } : {}),
    }),
  );
  return {
    // El porqué real viaja en el evento como verdad del mundo; los testigos lo leen con error (reading).
    events: [
      ...r.events.map((e) =>
        state.plan.purpose
          ? { ...e, data: { ...(e.data as object), purpose: state.plan.purpose } }
          : e,
      ),
      ...doseEvents,
      ...extraEvents,
    ],
    changes,
    postings:
      fillerPostings.length + intakePostings.length === 0
        ? r.postings
        : [...r.postings, ...fillerPostings, ...intakePostings],
    schedule: [
      {
        at: end,
        phase: "act",
        process: ACT_PROCESS,
        scope: me,
        reason: { kind: "state", entity: me, key: planKey(state.seq) },
      },
      ...heard.schedule,
    ],
  };
}

export { deleteComponent, FRESH_CURSOR };
