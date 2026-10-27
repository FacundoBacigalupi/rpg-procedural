// La rutina de la gente de la aldea (player-loop §5, npc-psychology §utilidad todavía no): hasta
// que los NPC decidan con su utilidad (Fase 2), cada hora siguen el día de la aldea. Duermen de
// noche en su casa, trabajan de día en el campo desde los diez años, comen tres veces de la
// despensa del hogar (con su evento y su asiento: la comida no aparece) y beben lo que les falta.
// Es el mismo cuerpo y la misma despensa que usa el personaje; él no tiene rutina: decide.
//
// Moverse entre la casa y el campo es instantáneo a la hora en punto: el viaje corto de la aldea
// queda debajo de la resolución local (simulation §LOD). Cuando haya `decide` de verdad, esto se
// vuelve la rutina por defecto de un plan (actions §3), no un proceso aparte.

import {
  type AgentId,
  compareStrings,
  externalAccount,
  type HolderRef,
  holderAccount,
  type LedgerUnit,
  ledgerUnit,
  type PlaceId,
  type PlaceRef,
  type PlanetClock,
  Rng,
  type Seed,
} from "../../core/index.ts";
import {
  type ActionDef,
  type Activity,
  ASLEEP,
  BODY_STATE,
  type Body,
  type BodyPlanDef,
  BUILDING,
  BURNED,
  dayOf,
  draftEvent,
  EATEN,
  ENTITY,
  type EventDraft,
  type FoodDef,
  fieldFertility,
  HARVEST,
  HARVEST_GOOD,
  HARVEST_GRAMS_PER_HOUR,
  HEARTH,
  houseKey,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  ingest,
  LOCATION,
  type LocalMap,
  type Location,
  localHour,
  logMeal,
  MEAL_KCAL,
  MEALS,
  nearestHex,
  needsFrom,
  netHydration,
  PERSON,
  type Person,
  PLACE,
  PROCESS_KNOWLEDGE,
  type ProcessContext,
  type ProcessDef,
  planLeaves,
  type ReadonlyWorldTruth,
  SOIL,
  SOIL_DAYS,
  type SpaceGraph,
  type StateChange,
  setActivity,
  setComponent,
  type TechCatalog,
  TREATED_WATER,
  table,
  VILLAGE_SQUARE,
  type WaterQuality,
  yieldFactor,
} from "../../sim/index.ts";
import { type BoilOptions, PLAN_STATE } from "./act.ts";
import { type Decision, NPC_DECISION } from "./decide.ts";
import { DRAFT_READS, type DraftOptions, draftFor } from "./draft.ts";
import { ECONOMIC_SERIAL_DOMAIN, ECONOMIC_SERIAL_GROUP } from "./economic-batch.ts";
import {
  fieldBoost,
  fieldIrrigationMm,
  IRRIGATED,
  IRRIGATION_MM_PER_HOUR,
  rainWindow,
  wantsToWater,
} from "./irrigation.ts";
import { harvestSeasonOf } from "./map.ts";
import { PLAYER } from "./player.ts";
import { routineToolStep } from "./routine-tools.ts";
import { SMITH } from "./smith.ts";
import {
  cropStarts,
  fieldSowYield,
  SEED_GRAMS,
  SEED_RETURN_DAYS,
  SOWN,
  SOWN_FIELD,
  sownDay,
  wantsToSow,
} from "./sowing.ts";

export const ROUTINE_PROCESS = "life.routine";

/** Las horas locales del día de la aldea. */
export const ROUTINE = {
  /** Se acuestan a esta hora y se levantan a la otra. */
  sleep: 21,
  wake: 5,
  meals: [7, 12, 19] as readonly number[],
  /** Una vuelta al pozo a media tarde. */
  drinkAlso: [15] as readonly number[],
  work: [8, 18] as const,
  /** Desde qué edad se va al campo. */
  workAge: 10,
} as const;

/** Desde cuánta necesidad de descanso o dolor se queda en casa en vez de ir al campo. */
const UNWELL_REST = 0.85;
const UNWELL_PAIN = 0.5;
/** Días de comida del hogar por debajo de los cuales no se saltea la cosecha. */
const LARDER_LOW_DAYS = 14;
/** Desde cuánta hambre una decisión fresca de comer saca una ración fuera de las comidas. */
const EAT_HUNGER = 0.6;

/** Si el plan es solo esperar (todas sus hojas son `wait`): lo único que la rutina atiende del jugador. */
export function onlyWaits(plan: { readonly root: Parameters<typeof planLeaves>[0] }): boolean {
  const leaves = planLeaves(plan.root);
  return leaves.length > 0 && leaves.every((l) => l.node.verb === "wait");
}

/** Lo que se bebe de una vez, como mucho: lo que falta, hasta esto. */
const MAX_DRINK_L = 1.5;

/** Litros del odre con que el jugador sale a la espera (como `JourneyDrinkOptions.carryLiters` de los viajeros). */
export const SKIN_CAPACITY_L = 3;

/**
 * El odre del personaje del jugador (desde `life-7`): litros que le quedan. Sin componente se lo
 * toma lleno. Como el `skin` de los viajeros NPC es un contador y no un bien (el agua de fuente no
 * pasa por el ledger): no crea ni destruye nada. Se vacía bebiendo lejos del agua mientras espera
 * y se llena al beber en la aldea o junto al agua.
 */
export interface WaterSkin {
  readonly liters: number;
}
export const WATER_SKIN = table<WaterSkin>("life.water_skin");

export interface RoutineOptions {
  /**
   * Opt-in (`life-50`, con `itemClaims` y las cosas de cada casa): la hora de campo se trabaja con la
   * azada o la hoz de la casa (los `instruments` de `work`), que se agarra al salir y se deja al
   * volver (`routineToolStep`).
   */
  readonly fieldTools?: ActionDef["instruments"];
  /**
   * Opt-in (`life-55`, con `fieldTools` y herrero): al dejar la herramienta en la casa la afila con la
   * piedra o la lleva al herrero y le paga el arreglo (`careForTool`, use-tools-mend-npc).
   */
  readonly toolCare?: boolean;
  /** Opt-in: comidas, cosecha y combustible comparten saldos con los demás procesos económicos. */
  readonly economicBatch?: boolean;
  /** Registrar lo comido en `MEALS` (para `life.nutrition` con `useEaten`). */
  readonly logMeals?: boolean;
  /** Calidad del agua que bebe cada quien (fuente y tratamiento); sin esto, agua limpia. */
  readonly drinkQuality?: (
    truth: ReadonlyWorldTruth,
    who: AgentId,
    now?: number,
  ) => WaterQuality | undefined;
  /**
   * Opt-in: quien decidió hervir (`life.decision`, sed con carga alta) quema `grams` de `fuel` de la
   * despensa del hogar (sale del ledger hacia `burned`) y queda con agua tratada (`TREATED_WATER`).
   * Apagado: no lee ni escribe la tabla, sin eventos ni asientos nuevos.
   */
  readonly boil?: BoilOptions;
  /**
   * Opt-in: quien decidió `move` hacia un lugar (`move:<lugar>+toward:<persona>`) pasa el día
   * despierto en el hex de ese lugar más cercano a donde está, en vez de ir al campo o a casa.
   * Hoy sin costo ni tiempo de viaje, igual que el resto de la rutina; apagado, nada cambia.
   */
  readonly npcMove?: boolean;
  /**
   * Opt-in (`LifeOptions.npcFieldWatering`): a la primera hora de campo, con el suelo seco y sin creer
   * que llueva (`believedRainChance`), una parte de la gente riega en vez de cosechar (evento
   * `routine.irrigated`, `IRRIGATED`); el riego vigente sube el rinde de las horas siguientes
   * (`irrigationBoost`). Apagado: nada cambia.
   */
  readonly fieldWatering?: boolean;
  /**
   * Opt-in (`LifeOptions.npcFieldSowing`, con `fieldWatering`): la temporada de crecimiento abre una
   * ventana de siembra; a la primera hora de campo una parte de la gente siembra si el suelo está
   * mojado o cree que llueve pronto (evento `routine.sown`, `SOWN`), y sembrar tarde le cuesta rinde
   * a la temporada (`sowYield`). Apagado: nada cambia.
   */
  readonly fieldSowing?: boolean;
  /**
   * Opt-in (`LifeOptions.npcSowSeed`, con `fieldSowing`): sembrar cuesta `SEED_GRAMS` de grano de la
   * despensa del hogar (sin grano no se siembra hoy; el grano pasa a la tierra, `SOWN_FIELD`, en el
   * ledger) que vuelve a la despensa `SEED_RETURN_DAYS` después; y quien cree que va a helar espera.
   */
  readonly sowSeed?: boolean;
  /**
   * Opt-in (`LifeOptions.mortalTech`): la cosecha de cada quien se multiplica por `yieldFactor` de lo que
   * sabe del campo (`PROCESS_KNOWLEDGE`, technology §4). Apagado: nada cambia.
   */
  readonly tech?: { readonly catalog: TechCatalog };
  /**
   * Opt-in (`LifeOptions.livestockDraft`, livestock-yield-draft): la hora de campo de quien tiene un
   * buey del hogar en su turno (`draftFor`) rinde `fieldRate` veces y el evento cita al animal.
   */
  readonly draft?: DraftOptions;
  /** Opt-in: el personaje del jugador sin plan en curso sigue la rutina como un NPC (corridas sin jugador). */
  readonly idlePlayer?: boolean;
  /**
   * Desde `life-6`: el personaje del jugador con un plan de solo esperas sigue la parte chica de la
   * rutina (player-loop §4, delegar lo chico): a las horas de comida come de la despensa del hogar
   * si está en su casa y a las de agua bebe si está en la aldea o junto al agua. No lo mueve, no
   * cambia su esfuerzo y no trabaja: la espera sigue siendo suya. Apagado: nadie lo atiende.
   */
  readonly waitTend?: boolean;
  /**
   * Desde `life-7` (con `waitTend`): quien espera lleva un odre (`WATER_SKIN`, `SKIN_CAPACITY_L`
   * litros): lejos del agua bebe de él a las horas de agua, y donde hay agua lo llena. Apagado: sin
   * agua en el lugar no bebe y la sed corta la espera.
   */
  readonly waitSkin?: boolean;
  /**
   * Desde `life-12` (con `waitTend`): quien espera en el hex de su casa (la plaza, la calle, un
   * vecino) también come de la despensa del hogar, que está a unos pasos; antes solo comía
   * puertas adentro y, esperando afuera en la aldea, vivía de reservas (seed 5: grasa de 91k a 18k
   * kcal). Lejos de la aldea sigue sin comer: el hambre corta la espera. Apagado: solo en casa.
   */
  readonly waitEatVillage?: boolean;
  /**
   * Desde `life-13`: el inconsciente (que la rutina saltea) recibe agua de quien lo cuida, un adulto
   * despierto de su casa en su mismo hex, a las horas de agua (`CARE_SIP_L` a la medida del cuerpo,
   * evento `routine.watered` con las dos personas). Sin cuidador, sigue sin beber. Apagado: nadie.
   */
  readonly careWater?: boolean;
  /**
   * Opt-in (hearth-npc, con hogares): cuando la pila de leña del hogar baja de `lowG`, en vez de ir
   * al campo quien le toca (el mayor de diez años de menor id de la casa) va al monte más cercano a
   * la casa y junta hasta `perHourG` por hora de lo que hay caído (la cuenta del lugar, que llena
   * `life.wild`), que pasa a la pila (evento `routine.gathered_wood`). Esa hora no cosecha.
   */
  readonly firewood?: FirewoodRoutine;
  /** Opt-in: el dormido (`ASLEEP`, tier 1) no sigue la rutina hora por hora; lo pone al día `life.catch_up`. */
  readonly sleepers?: boolean;
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly bodyPlans: readonly BodyPlanDef[];
  readonly foods: readonly FoodDef[];
  readonly clock: PlanetClock;
  readonly seed: Seed;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export interface FirewoodRoutine {
  /** Unidad del ledger de la leña. */
  readonly unit: string;
  /** Debajo de esta pila (g) la casa sale a buscar leña. */
  readonly lowG: number;
  /** Gramos que junta una persona en una hora de monte. */
  readonly perHourG: number;
}

/** Event de quien junta leña para la casa en la rutina. */
export const GATHERED_WOOD_EVENT = "routine.gathered_wood";

/** Qué hace a esta hora quien sigue la rutina: dónde y con qué esfuerzo. */
export function routineAt(
  hour: number,
  ageYears: number,
): { activity: Activity; at: "home" | "fields" } {
  const h = Math.floor(hour);
  if (h >= ROUTINE.sleep || h < ROUTINE.wake) return { activity: "sleep", at: "home" };
  if (ageYears >= ROUTINE.workAge && h >= ROUTINE.work[0] && h < ROUTINE.work[1]) {
    return { activity: "moderate", at: "fields" };
  }
  return { activity: ageYears < 3 ? "rest" : "light", at: "home" };
}

/**
 * La rutina como plantilla de plan por defecto (actions §3): `routineAt` es lo que hace quien no
 * decidió otra cosa, y la decisión vigente (`life.decision`, de hoy) la reemplaza cuando gana otra
 * candidata. Por ahora solo reemplaza el tramo de trabajo: quien elige descansar (`rest`) se queda
 * en casa en vez de ir al campo, y solo si de verdad está agotado o dolorido (`unwell`) y la
 * despensa del hogar no está baja (`larderLow`: la cosecha no se saltea con hambre en casa); al
 * descansar se recupera y deja de cumplirse, así que no encadena días. De noche manda el sueño y el resto de la decisión (comer, beber,
 * hablar, ayudar) todavía no mueve el cuerpo.
 */
export function planFor(
  hour: number,
  ageYears: number,
  decision: (Pick<Decision, "verb" | "at"> & { readonly target?: string | undefined }) | undefined,
  now: number,
  day: number,
  state: {
    readonly unwell: boolean;
    readonly larderLow: boolean;
    readonly hungry?: boolean;
    /** Opt-in: puede hervir (hay `boil` configurado y no tiene agua tratada vigente). */
    readonly canBoil?: boolean;
    /** Opt-in (`RoutineOptions.npcMove`): la decisión `move` hacia un lugar se ejecuta. */
    readonly canMove?: boolean;
  } = {
    unwell: false,
    larderLow: false,
  },
): {
  activity: Activity;
  at: "home" | "fields";
  replaced: boolean;
  eat?: true;
  boil?: true;
  /** El lugar (`place:N`) al que fue la decisión de moverse. */
  move?: string;
} {
  const base = routineAt(hour, ageYears);
  const fresh = decision !== undefined && now - decision.at < day;
  // Ir hacia un lugar decidido: despierto, el día vigente de la decisión; no hay trabajo de campo ahí.
  if (
    fresh &&
    decision.verb === "move" &&
    state.canMove === true &&
    decision.target?.startsWith("place:") &&
    base.activity !== "sleep"
  ) {
    return {
      activity: base.activity === "moderate" ? "light" : base.activity,
      at: "home",
      replaced: true,
      move: decision.target,
    };
  }
  // Hervir decidido (sed con carga alta): en casa y despierto; al tener agua tratada no encadena.
  if (
    fresh &&
    decision.verb === "boil" &&
    state.canBoil === true &&
    base.activity !== "sleep" &&
    base.at === "home"
  ) {
    return { ...base, replaced: true, boil: true };
  }
  // Comer decidido: una ración fuera de las comidas de la rutina (que ya comen a su hora, así
  // que no se duplica), despierto y con hambre; al comer el hambre baja y no encadena.
  if (
    fresh &&
    decision.verb === "eat" &&
    state.hungry === true &&
    base.activity !== "sleep" &&
    !ROUTINE.meals.includes(Math.floor(hour))
  ) {
    return { ...base, replaced: true, eat: true };
  }
  if (
    fresh &&
    decision.verb === "rest" &&
    base.at === "fields" &&
    state.unwell &&
    !state.larderLow
  ) {
    return { activity: "rest", at: "home", replaced: true };
  }
  return { ...base, replaced: false };
}

export function routineProcess(o: RoutineOptions): ProcessDef {
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  const foods = o.foods
    .filter((f) => f.kcalPerGram > 0)
    .map((f) => ({ unit: ledgerUnit(`good:${f.id}`), food: f }));
  // El rinde de la hora depende del día del año (calor, helada, lluvia reciente).
  const season = harvestSeasonOf(o.map, o.clock, o.seed);
  const rainOf = rainWindow(o);
  const cropStart = cropStarts(season, Math.round(o.clock.year / o.clock.day));
  const nutrition = new Map<LedgerUnit, FoodDef>(foods.map((f) => [f.unit, f.food]));

  return {
    id: ROUTINE_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "act",
    ...(o.economicBatch
      ? { serialDomain: ECONOMIC_SERIAL_DOMAIN, serialGroup: () => ECONOMIC_SERIAL_GROUP }
      : {}),
    reads: [
      MEALS.name,
      ...(o.waitSkin ? [WATER_SKIN.name] : []),
      PLAYER.name,
      PLAN_STATE.name,
      NPC_DECISION.name,
      SOIL.name,
      ENTITY.name,
      PERSON.name,
      LOCATION.name,
      BODY_STATE.name,
      ...(o.sleepers ? [ASLEEP.name] : []),
      ...(o.boil ? [TREATED_WATER.name] : []),
      ...(o.fieldWatering ? [IRRIGATED.name] : []),
      ...(o.fieldSowing ? [SOWN.name] : []),
      ...(o.firewood ? [HEARTH.name, PLACE.name] : []),
      ...(o.fieldTools ? [ITEM_HOLD.name, ITEM_LOOK.name, ITEM_WEAR.name] : []),
      ...(o.fieldTools && o.toolCare ? [SMITH.name] : []),
      ...(o.draft ? DRAFT_READS : []),
    ],
    writes: [
      LOCATION.name,
      ...(o.fieldTools ? [ITEM_HOLD.name, ITEM_WEAR.name] : []),
      ...(o.fieldTools && o.toolCare ? [SMITH.name] : []),
      BODY_STATE.name,
      MEALS.name,
      ...(o.waitSkin ? [WATER_SKIN.name] : []),
      ...(o.boil ? [TREATED_WATER.name] : []),
      ...(o.fieldWatering ? [IRRIGATED.name] : []),
      ...(o.fieldSowing ? [SOWN.name] : []),
    ],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      // El personaje decide él; quien tiene un plan en curso lo sigue.
      const plan = truth.get(PLAN_STATE, me);
      // Quien espera (el jugador con un plan de solo `wait`) solo recibe lo chico: comer y beber.
      const tendOnly =
        o.waitTend === true &&
        truth.has(PLAYER, me) &&
        plan !== undefined &&
        !plan.done &&
        onlyWaits(plan.plan);
      if (truth.has(PLAYER, me) && o.idlePlayer !== true && !tendOnly) return {};
      // El dormido (tier 1) no corre: `life.catch_up` lo pone al día por tramos.
      if (o.sleepers && truth.get(ASLEEP, me)) return {};
      if (plan && !plan.done && !tendOnly) return {};
      const person = truth.get(PERSON, me);
      const body = truth.get(BODY_STATE, me);
      if (!person || !body || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      if (body.death) return {};
      const bodyPlan = plans.get(body.plan);
      if (!bodyPlan) throw new RangeError(`plan corporal desconocido: ${body.plan}`);
      if (body.consciousness === "unconscious") {
        // Desde `life-13`: el inconsciente no puede beber solo; quien lo cuida (alguien despierto
        // de su casa, en su mismo hex) le da agua a las horas de agua.
        if (o.careWater !== true) return {};
        return careForUnconscious(o, ctx, me, person, body, bodyPlan);
      }

      const hour = Math.floor(localHour(o.clock, ctx.now, o.map.lonDeg));
      const age = (ctx.now - person.born) / o.clock.year;
      const needs = needsFrom(bodyPlan, body);
      const unwell = (needs.rest ?? 0) >= UNWELL_REST || (needs.pain ?? 0) >= UNWELL_PAIN;
      let larderLow = false;
      if (unwell) {
        const mouths = truth
          .ids(PERSON)
          .filter(
            (id) =>
              truth.get(PERSON, id)?.household === person.household &&
              truth.get(ENTITY, id)?.endedAt === undefined,
          ).length;
        const kcal = (
          ctx.ledger?.holdings(holderAccount(person.household as unknown as HolderRef)) ?? []
        ).reduce((t, h) => t + h.amount * (nutrition.get(h.unit)?.kcalPerGram ?? 0), 0);
        larderLow = kcal < LARDER_LOW_DAYS * 3 * MEAL_KCAL * Math.max(1, mouths);
      }
      if (tendOnly && !ROUTINE.meals.includes(hour) && !ROUTINE.drinkAlso.includes(hour)) {
        return {};
      }
      const want: ReturnType<typeof planFor> = tendOnly
        ? { activity: body.activity, at: "home", replaced: false }
        : planFor(hour, age, truth.get(NPC_DECISION, me), ctx.now, o.clock.day, {
            unwell,
            larderLow,
            hungry: (needs.hunger ?? 0) >= EAT_HUNGER,
            canBoil: o.boil !== undefined && (truth.get(TREATED_WATER, me)?.until ?? -1) < ctx.now,
            canMove: o.npcMove === true,
          });
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const postings = [];

      // Dónde: la casa del hogar o el campo más cercano a ella.
      const home = o.spaces.spaces.find((s) => s.key === houseKey(person.household));
      const here = truth.get(LOCATION, me);
      let there: Location | undefined;
      if (!tendOnly && want.at === "home" && home) there = { hex: home.hex, space: home.key };
      if (want.at === "fields" && home) {
        const fields = truth.ids(PLACE).flatMap((id) => {
          const p = truth.get(PLACE, id);
          return p?.kind === "fields" ? [...p.hexes] : [];
        });
        if (fields.length > 0) there = { hex: nearestHex(o.map, home.hex, fields) };
      }
      if (want.move && home) {
        const hexes = truth.get(PLACE, want.move as never)?.hexes ?? [];
        if (hexes.length > 0) there = { hex: nearestHex(o.map, here?.hex ?? home.hex, hexes) };
      }
      // La puerta trabada del hogar no cede: de afuera no se entra (queda en la plaza) y de
      // adentro no se sale hasta que la arreglen (settlements �7).
      if (!tendOnly && home && jammedHome(truth, person.household)) {
        const inside = o.spaces.spaces.find((s) => s.key === here?.space)?.indoor === true;
        const toHome = there?.space === home.key;
        if (!inside && toHome) there = { hex: home.hex, space: VILLAGE_SQUARE };
        else if (inside && !toHome) there = undefined;
      }
      // Leña para el hogar (opt-in `firewood`): la hora de campo de quien le toca se va al monte.
      const wood =
        o.firewood && want.at === "fields" && home && !tendOnly
          ? woodHour(o, o.firewood, truth, ctx.ledger, me, person.household, home.hex, age, ctx.now)
          : undefined;
      if (wood) {
        there = { hex: wood.hex };
        const ev = draftEvent(events.length);
        events.push({
          kind: GATHERED_WOOD_EVENT,
          actors: [me],
          place: { kind: "place", place: wood.place },
          data: { good: wood.unit, grams: wood.grams },
          emissions: { sight: 0.3, sound: 0.2 },
          causes: [{ kind: "state", entity: me, key: "routine" }],
        });
        postings.push({
          event: ev,
          transfers: [
            {
              from: holderAccount({ kind: "place", place: wood.place }),
              to: holderAccount(person.household as unknown as HolderRef),
              unit: wood.unit,
              amount: wood.grams,
            },
          ],
        });
      }
      const atFields = want.at === "fields" && wood === undefined;
      if (there && (here?.hex !== there.hex || here?.space !== there.space)) {
        changes.push(setComponent(LOCATION, me, there));
      }
      const toolStep =
        o.fieldTools && home
          ? routineToolStep({
              truth,
              me,
              household: person.household,
              home: home.key,
              here,
              there,
              atFields: atFields && there !== undefined,
              working: age >= ROUTINE.workAge && season(dayOf(o.clock, ctx.now)) > 0,
              instruments: o.fieldTools,
              place: o.placeOf(truth, me),
              ...(o.toolCare && ctx.ledger
                ? { mend: { balance: (a, u) => ctx.ledger?.balance(a, u) ?? 0 } }
                : {}),
            })
          : undefined;
      if (toolStep) {
        const base = events.length;
        changes.push(...toolStep.changes);
        events.push(...toolStep.events);
        for (const p of toolStep.postings ?? []) {
          postings.push({ event: draftEvent(base + p.at), transfers: [...p.transfers] });
        }
      }

      let next = setActivity(body, want.activity);
      // Trabajar la tierra rinde: una hora de campo es grano para la despensa del hogar (fuente
      // externa `harvest`; economy §1), según la estación del día: en invierno o con helada el
      // campo no da y la hora no deja asiento.
      const day = dayOf(o.clock, ctx.now + Math.round((o.map.lonDeg / 360) * o.clock.day));
      let boost = 1;
      let waters = false;
      let sows = false;
      let sowYieldNow = 1;
      if (o.fieldWatering && atFields && there && season(day) > 0) {
        const rained = rainOf(day);
        boost = fieldBoost(rained, truth, day);
        const start = o.fieldSowing ? cropStart(day) : undefined;
        if (start !== undefined) {
          const sowedOn = sownDay(truth, start);
          if (sowedOn === undefined && age >= ROUTINE.workAge && hour === ROUTINE.work[0]) {
            const soilMm = rained + fieldIrrigationMm(truth, day);
            const w = wantsToSow(o, me as string, day, start, soilMm, o.sowSeed === true);
            // Con semilla: el grano sale de la despensa del hogar; sin él no se siembra hoy.
            const larder = holderAccount(person.household as unknown as HolderRef);
            const haveSeed =
              o.sowSeed !== true ||
              (ctx.ledger?.holdings(larder).find((h) => h.unit === HARVEST_GOOD)?.amount ?? 0) >=
                SEED_GRAMS;
            if (w.sow && haveSeed) {
              sows = true;
              changes.push(
                setComponent(
                  SOWN,
                  me,
                  o.sowSeed ? { start, day, seed: SEED_GRAMS, returned: false } : { start, day },
                ),
              );
              const ev = draftEvent(events.length);
              events.push({
                kind: "routine.sown",
                actors: [me],
                place: o.placeOf(truth, me),
                data: {
                  start,
                  lateDays: day - start,
                  rainChance: w.chance,
                  soilMm,
                  ...(o.sowSeed ? { seedGrams: SEED_GRAMS } : {}),
                },
                emissions: { sight: 0.3, sound: 0.05 },
                causes: [{ kind: "state", entity: me, key: "routine" }],
              });
              if (o.sowSeed) {
                postings.push({
                  event: ev,
                  transfers: [
                    {
                      from: larder,
                      to: externalAccount(SOWN_FIELD),
                      unit: HARVEST_GOOD,
                      amount: SEED_GRAMS,
                    },
                  ],
                });
              }
            }
          }
          sowYieldNow = fieldSowYield(truth, start, day);
        }
        // La primera hora de campo del día: mira el suelo y lo que cree del cielo, y quizá riega.
        if (!sows && age >= ROUTINE.workAge && hour === ROUTINE.work[0]) {
          const soilMm = rained + fieldIrrigationMm(truth, day);
          const w = wantsToWater(o, me as string, day, soilMm);
          if (w.water) {
            waters = true;
            const prev = (truth.get(IRRIGATED, me)?.entries ?? []).filter(
              (e) => day - e.day < SOIL_DAYS,
            );
            changes.push(
              setComponent(IRRIGATED, me, {
                entries: [...prev, { day, mm: IRRIGATION_MM_PER_HOUR }],
              }),
            );
            events.push({
              kind: "routine.irrigated",
              actors: [me],
              place: o.placeOf(truth, me),
              data: { mm: IRRIGATION_MM_PER_HOUR, rainChance: w.chance, soilMm },
              emissions: { sight: 0.3, sound: 0.1 },
              causes: [{ kind: "state", entity: me, key: "routine" }],
            });
          }
        }
      }
      const draft =
        o.draft && atFields && there && !waters && !sows
          ? draftFor(truth, me, ctx.now, o.draft)
          : undefined;
      const grams =
        waters || sows
          ? 0
          : Math.round(
              (draft?.rate ?? 1) *
                HARVEST_GRAMS_PER_HOUR *
                season(day) *
                boost *
                sowYieldNow *
                fieldFertility(truth) *
                (toolStep?.rate ?? 1) *
                (o.tech
                  ? yieldFactor(o.tech.catalog, truth.get(PROCESS_KNOWLEDGE, me), "grain")
                  : 1),
            );
      if (atFields && there && grams > 0) {
        const ev = draftEvent(events.length);
        events.push({
          kind: "routine.harvested",
          actors: [me],
          place: o.placeOf(truth, me),
          data: {
            good: HARVEST_GOOD,
            grams,
            ...(toolStep?.tool !== undefined ? { tool: toolStep.tool } : {}),
            ...(draft !== undefined ? { draft: draft.animals } : {}),
          },
          emissions: { sight: 0.3, sound: 0.1 },
          causes: [
            { kind: "state", entity: me, key: "routine" },
            ...(draft !== undefined
              ? draft.animals.map((a) => ({ kind: "state" as const, entity: a, key: "draft" }))
              : []),
          ],
        });
        postings.push({
          event: ev,
          transfers: [
            {
              from: externalAccount(HARVEST),
              to: holderAccount(person.household as unknown as HolderRef),
              unit: HARVEST_GOOD,
              amount: grams,
            },
          ],
        });
      }
      // La semilla vuelve: a la primera hora de campo, pasados `SEED_RETURN_DAYS` de sembrar, el grano
      // que salió de la despensa vuelve a ella con la cosecha (de la tierra, no de la fuente).
      const mine = o.sowSeed ? truth.get(SOWN, me) : undefined;
      if (
        mine?.seed !== undefined &&
        mine.returned !== true &&
        hour === ROUTINE.work[0] &&
        day - mine.day >= SEED_RETURN_DAYS
      ) {
        const ev = draftEvent(events.length);
        events.push({
          kind: "routine.seed_returned",
          actors: [me],
          place: o.placeOf(truth, me),
          data: { start: mine.start, grams: mine.seed },
          emissions: { sight: 0.1 },
          causes: [{ kind: "state", entity: me, key: "routine" }],
        });
        postings.push({
          event: ev,
          transfers: [
            {
              from: externalAccount(SOWN_FIELD),
              to: holderAccount(person.household as unknown as HolderRef),
              unit: HARVEST_GOOD,
              amount: mine.seed,
            },
          ],
        });
        changes.push(setComponent(SOWN, me, { ...mine, returned: true }));
      }
      // Hervir: quema el combustible de la despensa y deja agua tratada que dura `validDays`.
      if (want.boil && o.boil) {
        const fuel = ledgerUnit(o.boil.fuel);
        const have =
          ctx.ledger
            ?.holdings(holderAccount(person.household as unknown as HolderRef))
            .find((h) => h.unit === fuel)?.amount ?? 0;
        if (have >= o.boil.grams) {
          const ev = draftEvent(events.length);
          events.push({
            kind: "routine.boiled",
            actors: [me],
            place: o.placeOf(truth, me),
            data: { fuel: o.boil.fuel, grams: o.boil.grams, treatment: o.boil.treatment },
            emissions: { sight: 0.2, sound: 0.05 },
            causes: [{ kind: "state", entity: me, key: "routine" }],
          });
          postings.push({
            event: ev,
            transfers: [
              {
                from: holderAccount(person.household as unknown as HolderRef),
                to: externalAccount(BURNED),
                unit: fuel,
                amount: o.boil.grams,
              },
            ],
          });
          changes.push(
            setComponent(TREATED_WATER, me, {
              treatment: o.boil.treatment,
              until: ctx.now + Math.round(o.boil.validDays * o.clock.day),
            }),
          );
        }
      }
      // Comer: una ración a la medida del cuerpo, de lo que haya en la despensa del hogar. Solo
      // si alcanza para todos los de la casa: dos que comen en la misma fase no pueden dejar el
      // saldo en negativo (scheduler, asientos por fase).
      // Quien espera come solo si está en su casa, donde está la despensa del hogar (desde
      // `life-12`, también en el hex de la casa: la despensa queda a unos pasos).
      const atHome =
        home !== undefined &&
        (here?.space === home.key || (o.waitEatVillage === true && here?.hex === home.hex));
      if ((ROUTINE.meals.includes(hour) || want.eat) && (!tendOnly || atHome)) {
        const larder = person.household as unknown as HolderRef;
        const mouths = truth
          .ids(PERSON)
          .filter(
            (id) =>
              truth.get(PERSON, id)?.household === person.household &&
              truth.get(ENTITY, id)?.endedAt === undefined,
          ).length;
        const kcal = MEAL_KCAL * (body.massKg / bodyPlan.physiology.refMassKg);
        const held = (ctx.ledger?.holdings(holderAccount(larder)) ?? [])
          .filter((h) => nutrition.has(h.unit))
          .sort((a, b) => b.amount - a.amount || (a.unit < b.unit ? -1 : 1));
        const row = held.find((h) => {
          const f = nutrition.get(h.unit) as FoodDef;
          return h.amount >= Math.ceil(kcal / f.kcalPerGram) * Math.max(1, mouths);
        });
        if (row) {
          const f = nutrition.get(row.unit) as FoodDef;
          const grams = Math.ceil(kcal / f.kcalPerGram);
          const ev = draftEvent(events.length);
          events.push({
            kind: "routine.ate",
            actors: [me],
            place: o.placeOf(truth, me),
            data: {
              good: row.unit,
              grams,
              ...(want.eat ? { decided: true } : {}),
              ...(tendOnly ? { waiting: true } : {}),
            },
            emissions: { sight: 0.2, sound: 0.05 },
            causes: [{ kind: "state", entity: me, key: "routine" }],
          });
          postings.push({
            event: ev,
            transfers: [
              {
                from: holderAccount(larder),
                to: externalAccount(EATEN),
                unit: row.unit,
                amount: grams,
              },
            ],
          });
          next = ingest(bodyPlan, next, Math.round(grams * f.kcalPerGram), grams * f.waterPerGram);
          if (o.logMeals)
            changes.push(
              setComponent(
                MEALS,
                me,
                logMeal(truth.get(MEALS, me), Math.floor(ctx.now / o.clock.day), row.unit, grams),
              ),
            );
        }
      }
      // Beber lo que falta (el agua del pozo no va al ledger todavía, como en `drink`).
      // Quien espera bebe solo donde hay agua: la aldea o el agua (`drink` pide lo mismo).
      const atWater =
        !tendOnly ||
        (here !== undefined &&
          truth.ids(PLACE).some((id) => {
            const p = truth.get(PLACE, id);
            return (p?.kind === "village" || p?.kind === "water") && p.hexes.includes(here.hex);
          }));
      const skinOn = tendOnly && o.waitSkin === true;
      const skin = skinOn ? (truth.get(WATER_SKIN, me)?.liters ?? SKIN_CAPACITY_L) : 0;
      const fromSkin = skinOn && !atWater;
      const drinkHour = ROUTINE.meals.includes(hour) || ROUTINE.drinkAlso.includes(hour);
      if (drinkHour && (atWater || (fromSkin && skin > 0))) {
        const liters = Math.min(MAX_DRINK_L, Math.max(0, next.water), fromSkin ? skin : Infinity);
        if (fromSkin && liters > 0) {
          // Del odre: el agua que llevaba (limpia), sin la calidad del lugar.
          next = ingest(bodyPlan, next, 0, liters);
          changes.push(setComponent(WATER_SKIN, me, { liters: skin - liters }));
          events.push({
            kind: "routine.drank",
            actors: [me],
            place: o.placeOf(truth, me),
            data: { liters: Math.round(liters * 100) / 100, waiting: true, from: "skin" },
            emissions: { sight: 0.2 },
            causes: [{ kind: "state", entity: me, key: "body.water" }],
          });
        } else if (liters > 0) {
          // Con `drinkQuality` la sal deshidrata (netHydration): la hidratación neta puede ser
          // negativa y entonces falta más agua. Sin el gancho, agua limpia como siempre.
          const q = o.drinkQuality?.(truth, me, ctx.now);
          const net = q ? netHydration(liters, q) : liters;
          next = net >= 0 ? ingest(bodyPlan, next, 0, net) : { ...next, water: next.water - net };
          if (tendOnly) {
            events.push({
              kind: "routine.drank",
              actors: [me],
              place: o.placeOf(truth, me),
              data: { liters: Math.round(liters * 100) / 100, waiting: true },
              emissions: { sight: 0.2 },
              causes: [{ kind: "state", entity: me, key: "body.water" }],
            });
          }
        }
      }
      // Donde hay agua el odre se llena (a la hora de beber, beba o no).
      if (skinOn && atWater && drinkHour && skin < SKIN_CAPACITY_L) {
        changes.push(setComponent(WATER_SKIN, me, { liters: SKIN_CAPACITY_L }));
      }
      if (next !== body) changes.push(setComponent(BODY_STATE, me, next));
      return { changes, events, postings };
    },
  };
}

/** Lo que se le da de beber a un inconsciente de una vez (a la medida de su masa): sorbos, no jarras. */
export const CARE_SIP_L = 0.4;
/** Desde qué edad (años) alguien cuida a otro. */
export const CARE_MIN_AGE_YEARS = 12;

/**
 * El cuidador de un inconsciente: el de menor id entre los de su casa, vivos, despiertos, mayores
 * de `CARE_MIN_AGE_YEARS`, en su mismo hex (y no dormidos, con `sleepers`). Verdad física del lugar:
 * ver el cuerpo caído es percepción de primera mano (perception §canales), no se modela aparte.
 */
function caregiverOf(
  o: RoutineOptions,
  truth: ReadonlyWorldTruth,
  me: AgentId,
  household: unknown,
  hex: unknown,
  now: number,
): AgentId | undefined {
  for (const id of truth.ids(PERSON)) {
    if (id === me) continue;
    const p = truth.get(PERSON, id);
    if (!p || p.household !== household || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    if ((now - p.born) / o.clock.year < CARE_MIN_AGE_YEARS) continue;
    const b = truth.get(BODY_STATE, id);
    if (!b || b.death || b.consciousness !== "alert" || b.activity === "sleep") continue;
    if (o.sleepers && truth.get(ASLEEP, id)) continue;
    if (truth.get(LOCATION, id)?.hex !== hex) continue;
    return id as AgentId;
  }
  return undefined;
}

/** El inconsciente recibe agua de su cuidador a las horas de agua (evento con los dos). */
function careForUnconscious(
  o: RoutineOptions,
  ctx: Parameters<ProcessDef["run"]>[0],
  me: AgentId,
  person: { readonly household: unknown; readonly born: number },
  body: Body,
  bodyPlan: BodyPlanDef,
): ReturnType<ProcessDef["run"]> {
  const truth = ctx.truth;
  const hour = Math.floor(localHour(o.clock, ctx.now, o.map.lonDeg));
  if (!ROUTINE.meals.includes(hour) && !ROUTINE.drinkAlso.includes(hour)) return {};
  const here = truth.get(LOCATION, me);
  if (!here) return {};
  const carer = caregiverOf(o, truth, me, person.household, here.hex, ctx.now);
  if (carer === undefined) return {};
  const sip = CARE_SIP_L * (body.massKg / bodyPlan.physiology.refMassKg);
  const liters = Math.min(sip, Math.max(0, body.water));
  if (liters <= 0) return {};
  const q = o.drinkQuality?.(truth, me, ctx.now);
  const net = q ? netHydration(liters, q) : liters;
  const next = net >= 0 ? ingest(bodyPlan, body, 0, net) : { ...body, water: body.water - net };
  return {
    changes: [setComponent(BODY_STATE, me, next)],
    events: [
      {
        kind: "routine.watered",
        actors: [carer, me],
        place: o.placeOf(truth, me),
        data: { liters: Math.round(liters * 100) / 100 },
        emissions: { sight: 0.2 },
        causes: [{ kind: "state", entity: me, key: "body.water" }],
      },
    ],
  };
}

/** Si la puerta de la casa del hogar est� trabada. */
function jammedHome(truth: ReadonlyWorldTruth, household: unknown): boolean {
  return truth.ids(BUILDING).some((id) => {
    const b = truth.get(BUILDING, id);
    return b?.household === household && b?.doorState === "jammed";
  });
}

/**
 * La hora de leña de `me`, si le toca (puro): la pila del hogar bajo `lowG`, `me` es el mayor de
 * `ROUTINE.workAge` de menor id de la casa, y el monte más cercano a la casa tiene leña caída. Junta
 * hasta `perHourG`, nunca más que lo que hay repartido entre todos los hogares (que corren en la
 * misma fase contra el mismo saldo y no pueden dejarlo en negativo).
 */
function woodHour(
  o: RoutineOptions,
  f: FirewoodRoutine,
  truth: ReadonlyWorldTruth,
  ledger: ProcessContext["ledger"],
  me: AgentId,
  household: Person["household"],
  homeHex: number,
  age: number,
  now: number,
): { place: PlaceId; hex: number; unit: LedgerUnit; grams: number } | undefined {
  if (!ledger || age < ROUTINE.workAge) return undefined;
  const unit = ledgerUnit(f.unit);
  const larder = holderAccount(household as unknown as HolderRef);
  if (ledger.balance(larder, unit) >= f.lowG) return undefined;
  const fetcher = truth
    .ids(PERSON)
    .filter((id) => {
      const p = truth.get(PERSON, id);
      return (
        p?.household === household &&
        p !== undefined &&
        (now - p.born) / o.clock.year >= ROUTINE.workAge &&
        truth.get(ENTITY, id)?.endedAt === undefined &&
        !truth.get(BODY_STATE, id)?.death
      );
    })
    .sort(compareStrings)[0];
  if (fetcher !== me) return undefined;
  const forests = truth
    .ids(PLACE)
    .sort(compareStrings)
    .flatMap((id) => {
      const p = truth.get(PLACE, id);
      return p?.kind === "forest" && p.hexes.length > 0 ? [{ id, hexes: p.hexes }] : [];
    });
  if (forests.length === 0) return undefined;
  const hex = nearestHex(
    o.map,
    homeHex,
    forests.flatMap((p) => [...p.hexes]),
  );
  const place = forests.find((p) => p.hexes.includes(hex))?.id as unknown as PlaceId | undefined;
  if (place === undefined) return undefined;
  const stock = ledger.balance(holderAccount({ kind: "place", place }), unit);
  const share = Math.floor(stock / Math.max(1, truth.ids(HEARTH).length));
  const grams = Math.min(f.perHourG, share);
  return grams > 0 ? { place, hex, unit, grams } : undefined;
}
