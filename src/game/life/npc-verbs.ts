// El NPC ejecuta el verbo que decidió (actions §10, npc-c): la candidata ganadora de `life.decide`
// (`life.decision`) se vuelve un `ActionPlan` de fuente `utility` y entra a `life.plan` como el del
// personaje; `life.act` lo resuelve con la misma tirada, eventos y aprendizaje. Opt-in por verbo
// (`NpcVerbsOptions.verbs`): apagado, la decisión sigue sin mover nada salvo lo que ya ejecutan
// `life.routine` (comer, hervir, descansar, ir) y `life.lend`/`life.pawn_decide`.

import {
  type AgentId,
  type EntityRef,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  type PlaceRef,
  type PlanetClock,
  type Tick,
} from "../../core/index.ts";
import {
  type ActionCatalog,
  type ActionPlan,
  type ArgValue,
  ASLEEP,
  BODY_STATE,
  type BodyPlanDef,
  deleteComponent,
  draftEvent,
  ENTITY,
  type EventDraft,
  expandTemplate,
  hexPath,
  LOCATION,
  type LocalMap,
  localHour,
  nearestHex,
  nodeAt,
  PERSON,
  PLACE,
  type PlanCursor,
  type PlanTemplate,
  type PostingDraft,
  type ProcessDef,
  type ProcessResult,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import {
  ACT_PROCESS,
  FRESH_CURSOR,
  PLAN_STATE,
  type PlanState,
  planKey,
  type StepRecord,
} from "./act.ts";
import { alarmingSignsOf } from "./alarms.ts";
import { type Decision, NPC_DECISION } from "./decide.ts";
import { ROUTINE } from "./routine.ts";

/** Cada cuánto como mucho vuelve a comer un viajero (horas). */
const MEAL_GAP_HOURS = 4;

export const NPC_VERBS_PROCESS = "life.npc_verbs";

export interface NpcVerbsOptions {
  readonly catalog: ActionCatalog;
  /** Verbos de la decisión que se ejecutan (el resto sigue como hasta ahora). */
  readonly verbs: readonly string[];
  readonly day: number;
  /** Opt-in: el dormido (`ASLEEP`, tier 1) no arma planes. */
  readonly sleepers?: boolean;
  /** El personaje decide por su cuenta: queda afuera. */
  readonly player: AgentId;
  /**
   * Opt-in (con `placeOf`): ir a un lugar abre un viaje (`NPC_JOURNEY`) que sigue de día en día
   * hasta llegar o hasta `journeyDays` días; sin esto, el `move` vence con la decisión del día.
   */
  readonly journeyDays?: number;
  /**
   * Opt-in: verbos de la decisión que se ejecutan como una plantilla de plan de `content/plans/`
   * (`byVerb`: verbo -> id de plantilla, p. ej. `work` -> `fieldwork`). Los parámetros de lugar
   * salen del lugar más cercano de la clase que dice cada uno (`PARAM_PLACE_KIND`); sin ellos, el
   * verbo suelto como siempre.
   */
  readonly templates?: {
    readonly byVerb: Readonly<Record<string, string>>;
    readonly map: LocalMap;
  };
  readonly placeOf?: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /**
   * Opt-in (con `journeyDays`): el ritmo del viaje es el modo `careful` (más lento, más cuidado) o
   * `fast` (más rápido, peor tirada y más ruido) del `move`; sin esto, el modo por defecto.
   */
  readonly pace?: "careful" | "fast";
  /**
   * Opt-in (con `LifeParts.npcInterrupt`): lo que un percance cortó (`NPC_PAUSED`) se retoma,
   * `after` segundos después y si el cuerpo ya no tiene signos graves, desde el paso siguiente (o el
   * tramo a medias) y reabriendo el viaje; pasados `within` segundos se olvida.
   */
  readonly resume?: {
    readonly plans: readonly BodyPlanDef[];
    readonly after: number;
    readonly within: number;
  };
  /** Opt-in (con `journeyDays`): de noche el viajero interrumpe el tramo, duerme y sigue al alba. */
  readonly nightRest?: { readonly clock: PlanetClock; readonly lonDeg: number };
  /**
   * Opt-in (con `journeyDays`): el viajero sale con `grams` de `unit` de la despensa de su hogar
   * en el bolsillo (del libro mayor al suyo), come de eso en las horas de comida del camino
   * interrumpiendo el tramo y, al llegar o rendirse, devuelve lo que sobra a la despensa.
   */
  readonly provisions?: {
    readonly unit: string;
    readonly name: string;
    readonly grams: number;
    readonly clock: PlanetClock;
    readonly lonDeg: number;
  };
}

/** Qué decisión ya se volvió plan, para no repetirla cada hora mientras siga vigente. */
export const NPC_VERB_LOG = table<{ readonly at: Tick; readonly id: string }>("life.npc_verb_log");

const ENTITY_PART = /^(agent|place):/;
/** Ids con partes propias de otro proceso (pedir prestado, empeñar, ir hacia): no son del catálogo. */
const SPECIAL_PART = /^(borrow|pawn|toward):/;

/**
 * El plan de una decisión del catálogo (puro): el id es `<verbo>:<parte>+<parte>` con las partes en
 * el orden de los argumentos del verbo (`idOf` de `utility-verbs`). Lo que no encaja, un verbo
 * desconocido o un id con partes de otro proceso, no se ejecuta (`undefined`).
 */
export function planFromDecision(
  decision: Pick<Decision, "id" | "verb"> & Partial<Pick<Decision, "act">>,
  catalog: ActionCatalog,
  actor: AgentId,
  /** Modos del verbo (`careful`, `fast` en `move`): el ritmo del viaje. */
  manner: readonly string[] = [],
): ActionPlan | undefined {
  const def = catalog.verb(decision.verb);
  const prefix = `${decision.verb}:`;
  if (!def || !decision.id.startsWith(prefix)) return undefined;
  const rest = decision.id.slice(prefix.length);
  // `move:<lugar>+toward:<persona>`: ir hacia donde cree que está alguien. El destino es el lugar;
  // la persona es el porqué, no un argumento del verbo.
  const parts = (rest === "" ? [] : rest.split("+")).filter(
    (p) => !(decision.verb === "move" && p.startsWith("toward:")),
  );
  if (parts.some((p) => SPECIAL_PART.test(p))) return undefined;
  const args: ArgValue[] = [];
  let next = 0;
  for (const a of def.args) {
    if (a.kind === "duration") {
      // La duración por defecto no deja parte en el id; se usa la del verbo.
      if (a.required) return undefined;
      continue;
    }
    const part = parts[next];
    if (part === undefined) {
      if (a.required) return undefined;
      continue;
    }
    if (a.kind === "text") {
      if (ENTITY_PART.test(part)) {
        if (a.required) return undefined;
        continue;
      }
      args.push({ role: a.role, text: part });
    } else {
      if (!ENTITY_PART.test(part)) {
        if (a.required) return undefined;
        continue;
      }
      args.push({ role: a.role, entity: part as never });
    }
    next++;
  }
  if (next !== parts.length) return undefined;
  // El acto de habla declarado por la candidata viaja con el contenido (vacío si no dice palabras).
  if (decision.act && decision.verb === "speak") {
    const at = args.findIndex((a) => a.role === "content" && "text" in a);
    const spoken = args[at];
    if (at >= 0 && spoken && "text" in spoken) args[at] = { ...spoken, act: decision.act };
    else args.push({ role: "content", text: "", act: decision.act });
  }
  return {
    actor,
    source: "utility",
    root: { kind: "do", verb: decision.verb, args, manner: [...manner] },
    manner: [],
    causes: [{ kind: "state", entity: actor, key: "utility" }],
  };
}

/** Qué clase de lugar nombra cada parámetro de una plantilla (`field` es un campo, `home` la aldea…). */
export const PARAM_PLACE_KIND: Readonly<Record<string, string>> = {
  field: "fields",
  home: "village",
  water: "water",
  wood: "forest",
};

/**
 * Los parámetros de lugar de una plantilla para quien está en `from` (puro): el lugar más cercano
 * de la clase que dice cada parámetro (`PARAM_PLACE_KIND`). Un parámetro de persona, de clase
 * desconocida o sin lugar de esa clase deja la plantilla sin resolver (`undefined`).
 */
export function templateParams(
  template: PlanTemplate,
  places: readonly {
    readonly id: string;
    readonly kind: string;
    readonly hexes: readonly number[];
  }[],
  map: LocalMap,
  from: number | undefined,
): Record<string, EntityRef> | undefined {
  if (from === undefined) return undefined;
  const out: Record<string, EntityRef> = {};
  for (const p of template.params) {
    const kind = PARAM_PLACE_KIND[p.id];
    if (p.kind !== "place" || kind === undefined) return undefined;
    let best: { id: string; steps: number } | undefined;
    for (const pl of places) {
      if (pl.kind !== kind || pl.hexes.length === 0) continue;
      const steps = hexPath(map, from, nearestHex(map, from, pl.hexes)).length;
      if (!best || steps < best.steps || (steps === best.steps && pl.id < best.id)) {
        best = { id: pl.id, steps };
      }
    }
    if (!best) return undefined;
    out[p.id] = best.id as EntityRef;
  }
  return out;
}

/** El plan de una plantilla ya resuelta, con fuente `utility`; sin parámetros, nada. */
export function planFromTemplate(
  template: PlanTemplate,
  params: Readonly<Record<string, EntityRef>> | undefined,
  actor: AgentId,
): ActionPlan | undefined {
  if (!params) return undefined;
  return {
    actor,
    source: "utility",
    goal: template.id,
    root: expandTemplate(template.root, params),
    manner: [],
    causes: [{ kind: "state", entity: actor, key: "utility" }],
  };
}

/** Convierte la decisión vigente en plan y lo agenda para `life.act`; un plan en curso no se pisa. */
export function npcVerbsProcess(o: NpcVerbsOptions): ProcessDef {
  const allowed = new Set(o.verbs);
  return {
    id: NPC_VERBS_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [
      NPC_DECISION.name,
      PLAN_STATE.name,
      ENTITY.name,
      NPC_VERB_LOG.name,
      LOCATION.name,
      PLACE.name,
      ...(o.sleepers ? [ASLEEP.name] : []),
      ...(o.provisions ? [PERSON.name] : []),
      ...(o.nightRest || o.resume ? [BODY_STATE.name] : []),
      ...(o.resume ? [NPC_PAUSED.name] : []),
      ...(o.journeyDays !== undefined ? [NPC_JOURNEY.name] : []),
    ],
    writes: [
      PLAN_STATE.name,
      NPC_VERB_LOG.name,
      ...(o.resume ? [NPC_PAUSED.name] : []),
      ...(o.journeyDays !== undefined ? [NPC_JOURNEY.name] : []),
    ],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      if (me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      if (o.sleepers && truth.get(ASLEEP, me)) return {};
      const journeyDays = o.journeyDays;
      const trip = journeyDays !== undefined ? truth.get(NPC_JOURNEY, me) : undefined;
      if (journeyDays !== undefined && trip && o.placeOf) {
        // Un viaje en curso manda hasta llegar o rendirse; no depende de que la decisión siga vigente.
        const hexes = truth.get(PLACE, trip.place as never)?.hexes ?? [];
        const here = truth.get(LOCATION, me)?.hex;
        const days = (ctx.now - trip.since) / o.day;
        const prov = o.provisions;
        const pocket = holderAccount(me as unknown as HolderRef);
        const carried = prov ? (ctx.ledger?.balance(pocket, ledgerUnit(prov.unit)) ?? 0) : 0;
        const end = (what: "arrived" | "gave_up") => {
          const home = truth.get(PERSON, me)?.household;
          // Lo que sobra de las provisiones vuelve a la despensa, con el evento del fin.
          const back: PostingDraft[] =
            prov && carried > 0 && home
              ? [
                  {
                    event: draftEvent(0),
                    transfers: [
                      {
                        unit: ledgerUnit(prov.unit),
                        from: pocket,
                        to: holderAccount(home as unknown as HolderRef),
                        amount: carried,
                      },
                    ],
                  },
                ]
              : [];
          return {
            changes: [deleteComponent(NPC_JOURNEY, me)],
            events: [journeyEvent(me, what, trip.place, days, o.placeOf?.(truth, me))],
            postings: back,
          };
        };
        if (here !== undefined && hexes.includes(here)) return end("arrived");
        if (days >= journeyDays) return end("gave_up");
        const going = truth.get(PLAN_STATE, me);
        // Hora de comida con provisiones encima: el tramo se corta, come y sigue el camino.
        if (prov && carried > 0) {
          const hour = Math.floor(localHour(prov.clock, ctx.now, prov.lonDeg));
          const due =
            ROUTINE.meals.includes(hour) &&
            (trip.ate === undefined || ctx.now - trip.ate >= MEAL_GAP_HOURS * 3600);
          const meal = due
            ? planFromDecision({ id: `eat:${prov.name}`, verb: "eat" }, o.catalog, me)
            : undefined;
          if (meal) {
            return startPlan(me, meal, going?.seq ?? 0, ctx.now, {
              changes: [setComponent(NPC_JOURNEY, me, { ...trip, ate: ctx.now })],
            });
          }
        }
        // De noche el viajero para y duerme (el `rest` del catálogo, la noche entera) y sigue al alba.
        if (o.nightRest) {
          const hour = Math.floor(localHour(o.nightRest.clock, ctx.now, o.nightRest.lonDeg));
          const fatigue = truth.get(BODY_STATE, me)?.fatigue ?? 0;
          const sleep = restDue(hour, trip.rested, ctx.now, fatigue)
            ? planFromDecision({ id: "rest:", verb: "rest" }, o.catalog, me)
            : undefined;
          if (sleep) {
            return startPlan(me, sleep, going?.seq ?? 0, ctx.now, {
              changes: [setComponent(NPC_JOURNEY, me, { ...trip, rested: ctx.now })],
            });
          }
        }
        if (going && !going.done) return {};
        const plan = planFromDecision(
          { id: `move:${trip.place}`, verb: "move" },
          o.catalog,
          me,
          o.pace ? [o.pace] : [],
        );
        return plan ? startPlan(me, plan, going?.seq ?? 0, ctx.now) : {};
      }
      // Lo que un percance cortó se retoma cuando ya pasó (y si no pasa a tiempo, se olvida).
      const paused = o.resume ? truth.get(NPC_PAUSED, me) : undefined;
      if (o.resume && paused) {
        const idle = truth.get(PLAN_STATE, me);
        if (idle && !idle.done) return {};
        const age = ctx.now - paused.at;
        if (age > o.resume.within) return { changes: [deleteComponent(NPC_PAUSED, me)] };
        if (age < o.resume.after) return {};
        const body = truth.get(BODY_STATE, me);
        const bodyPlan = body && o.resume.plans.find((p) => p.id === body.plan);
        if (body && bodyPlan && alarmingSignsOf(bodyPlan, body).size > 0) return {};
        const seq = (idle?.seq ?? 0) + 1;
        const next: PlanState = {
          seq,
          plan: paused.plan,
          cursor: paused.cursor,
          lastBelieved: null,
          steps: paused.steps,
          done: false,
          ...(paused.resume ? { resume: true } : {}),
        };
        const cutAt = paused.cursor.path ? nodeAt(paused.plan.root, paused.cursor.path) : undefined;
        return {
          changes: [
            setComponent(PLAN_STATE, me, next),
            deleteComponent(NPC_PAUSED, me),
            ...(paused.journey ? [setComponent(NPC_JOURNEY, me, paused.journey)] : []),
          ],
          events: o.placeOf
            ? [
                {
                  kind: "npc.resumed",
                  actors: [me],
                  place: o.placeOf(truth, me),
                  data: {
                    plan: paused.plan.goal ?? "plan",
                    done: paused.steps.map((s) => s.verb),
                    from: cutAt && cutAt.kind === "do" ? cutAt.verb : null,
                    ...(paused.journey ? { journey: paused.journey.place } : {}),
                    why: paused.why,
                  },
                  emissions: {},
                  causes: [{ kind: "state", entity: me, key: "utility" }],
                },
              ]
            : [],
          schedule: [
            {
              at: (ctx.now + 1) as Tick,
              phase: "act",
              process: ACT_PROCESS,
              scope: me,
              reason: { kind: "state", entity: me, key: planKey(seq) },
            },
          ],
        };
      }
      const decision = truth.get(NPC_DECISION, me);
      if (!decision || !allowed.has(decision.verb) || ctx.now - decision.at >= o.day) return {};
      const done = truth.get(NPC_VERB_LOG, me);
      if (decision.verb === "move") {
        // Con viaje, la decisión abre un solo viaje; llegar no lo reabre cuando la rutina lo aleja.
        if (journeyDays !== undefined && done && done.at === decision.at && done.id === decision.id)
          return {};
        // Un camino largo son varios tramos: sigue hasta llegar al lugar mientras la decisión vigue.
        const hexes = decision.target
          ? truth.get(PLACE, decision.target as never)?.hexes
          : undefined;
        const here = truth.get(LOCATION, me)?.hex;
        if (!hexes || here === undefined || hexes.includes(here)) return {};
      } else if (done && done.at === decision.at && done.id === decision.id) return {};
      const state = truth.get(PLAN_STATE, me);
      if (state && !state.done) return {};
      // Con plantilla para este verbo (ir al campo, trabajar, volver) el plan es de varios pasos.
      const tplId = o.templates?.byVerb[decision.verb];
      const tpl = tplId ? o.catalog.template(tplId) : undefined;
      const fromTemplate =
        tpl && o.templates
          ? planFromTemplate(
              tpl,
              templateParams(
                tpl,
                truth.ids(PLACE).flatMap((id) => {
                  const p = truth.get(PLACE, id);
                  return p ? [{ id: id as string, kind: p.kind, hexes: p.hexes }] : [];
                }),
                o.templates.map,
                truth.get(LOCATION, me)?.hex,
              ),
              me,
            )
          : undefined;
      const plan =
        fromTemplate ??
        planFromDecision(
          decision,
          o.catalog,
          me,
          decision.verb === "move" && journeyDays !== undefined && o.pace ? [o.pace] : [],
        );
      if (!plan) return {};
      const log = setComponent(NPC_VERB_LOG, me, { at: decision.at, id: decision.id });
      // Con viaje, ir a un lugar abre un viaje que sigue los días siguientes si no llega.
      const opens =
        journeyDays !== undefined &&
        o.placeOf &&
        decision.verb === "move" &&
        decision.target !== undefined;
      if (opens && decision.target) {
        const open = setComponent(NPC_JOURNEY, me, {
          place: decision.target,
          since: ctx.now,
          decision: decision.id,
          ...(truth.get(LOCATION, me) ? { from: truth.get(LOCATION, me)?.hex as number } : {}),
        });
        // Las provisiones salen de la despensa del hogar al bolsillo, con el evento de salida.
        const prov = o.provisions;
        const home = truth.get(PERSON, me)?.household;
        const stock =
          prov && home
            ? (ctx.ledger?.balance(
                holderAccount(home as unknown as HolderRef),
                ledgerUnit(prov.unit),
              ) ?? 0)
            : 0;
        const pack = prov ? Math.min(prov.grams, stock) : 0;
        return startPlan(me, plan, state?.seq ?? 0, ctx.now, {
          changes: [log, open],
          events: [journeyEvent(me, "started", decision.target, 0, o.placeOf?.(truth, me))],
          postings:
            prov && home && pack > 0
              ? [
                  {
                    event: draftEvent(0),
                    transfers: [
                      {
                        unit: ledgerUnit(prov.unit),
                        from: holderAccount(home as unknown as HolderRef),
                        to: holderAccount(me as unknown as HolderRef),
                        amount: pack,
                      },
                    ],
                  },
                ]
              : [],
        });
      }
      return startPlan(me, plan, state?.seq ?? 0, ctx.now, { changes: [log] });
    },
  };
}

/** Un viaje del NPC: a dónde va y desde cuándo; sigue de día en día hasta llegar o rendirse. */
export interface NpcJourney {
  readonly place: string;
  readonly since: Tick;
  /** La decisión que lo abrió. */
  readonly decision: string;
  /** El hex del que salió, si se sabía (`life.transit` parte de ahí). */
  readonly from?: number;
  /** Cuándo comió por última vez en el camino (`NpcVerbsOptions.provisions`). */
  readonly ate?: Tick;
  /** Cuándo paró a dormir por última vez en el camino (`NpcVerbsOptions.nightRest`). */
  readonly rested?: Tick;
}
export const NPC_JOURNEY = table<NpcJourney>("life.npc_journey");

/** Lo que un percance cortó, a mano para retomarlo (`NpcVerbsOptions.resume`). */
export interface NpcPaused {
  readonly plan: ActionPlan;
  readonly cursor: PlanCursor;
  readonly steps: readonly StepRecord[];
  /** El viaje abierto cuando se cortó, para reabrirlo al retomar. */
  readonly journey?: NpcJourney;
  /** El tramo del camino estaba a medias (`PlanState.resume`). */
  readonly resume?: boolean;
  readonly at: Tick;
  readonly why: string;
}
export const NPC_PAUSED = table<NpcPaused>("life.npc_paused");

/** Entre una parada a dormir y la siguiente pasa al menos esto (horas): una por noche. */
export const REST_GAP_HOURS = 12;

/** Desde este cansancio del cuerpo (0-1, `Body.fatigue`: agotado) el viajero para aunque sea de día. */
export const TIRED_STOP = 0.85;

/**
 * ¿Toca parar? De noche (las horas de sueño de la rutina) o agotado (`fatigue >= TIRED_STOP`, el
 * cansancio que ya acumula el cuerpo por el esfuerzo del camino), y sin haber parado hace poco.
 */
export function restDue(
  hour: number,
  restedAt: Tick | undefined,
  now: number,
  fatigue = 0,
): boolean {
  const night = hour >= ROUTINE.sleep || hour < ROUTINE.wake;
  return (
    (night || fatigue >= TIRED_STOP) &&
    (restedAt === undefined || now - restedAt >= REST_GAP_HOURS * 3600)
  );
}

function journeyEvent(
  me: AgentId,
  what: "started" | "arrived" | "gave_up",
  place: string,
  days: number,
  at: PlaceRef | undefined,
): EventDraft {
  return {
    kind: "npc.journey",
    actors: [me],
    place: at as PlaceRef,
    data: { what, place, days: Math.round(days * 100) / 100 },
    emissions: {},
    causes: [{ kind: "state", entity: me, key: "utility" }],
  };
}

function startPlan(
  me: AgentId,
  plan: ActionPlan,
  prevSeq: number,
  now: Tick,
  extra: {
    readonly changes?: readonly StateChange[];
    readonly events?: readonly EventDraft[];
    readonly postings?: readonly PostingDraft[];
  } = {},
): ProcessResult {
  const seq = prevSeq + 1;
  const next: PlanState = {
    seq,
    plan,
    cursor: FRESH_CURSOR,
    lastBelieved: null,
    steps: [],
    done: false,
  };
  return {
    changes: [setComponent(PLAN_STATE, me, next), ...(extra.changes ?? [])],
    ...(extra.events ? { events: extra.events } : {}),
    ...(extra.postings && extra.postings.length > 0 ? { postings: extra.postings } : {}),
    schedule: [
      {
        at: (now + 1) as Tick,
        phase: "act",
        process: ACT_PROCESS,
        scope: me,
        reason: { kind: "state", entity: me, key: planKey(seq) },
      },
    ],
  };
}
