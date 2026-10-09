// La vista del jugador desde la vida real (narration §2, player-loop §9): `buildPlayerView` con
// lo que el personaje percibe ahora (la gente que está en su espacio, por perception), cómo se
// siente (los signos del cuerpo) y lo que cree que le pasó en los pasos del turno. Es el único
// lugar donde la verdad del mundo se convierte en entrada del narrador.

import { type AgentId, type EntityRef, ledgerUnit, Rng, type Tick } from "../../core/index.ts";
import {
  ATTENTION,
  attireLook,
  BELIEFS,
  type Beliefs,
  BODY_STATE,
  beliefConfidenceAt,
  believed,
  bodySigns,
  bookOf,
  COPPER,
  houseKey,
  LOCATION,
  type Location,
  localHour,
  mentionableTastes,
  PERSON,
  type Percept,
  PLACE,
  PLEDGE,
  PLEDGE_BOOK,
  perceive,
  presenceStimulus,
  type ReadonlyWorldTruth,
  rainBetween,
  STATUS,
  sameValue,
  skyLight,
  spaceLight,
  TASTES_OF,
  TRACE,
  traceStrength,
  traceVisible,
  watching,
} from "../../sim/index.ts";
import {
  buildPlayerView,
  type DueView,
  type PlayerView,
  type SceneMark,
  type SelfCue,
  type TasteView,
  type ThoughtInput,
} from "../view/index.ts";
import type { StepRecord } from "./act.ts";
import { creditRows } from "./credit.ts";
import { withImpressions } from "./impressions.ts";
import { PERCEPTS } from "./perceive.ts";
import { stretchOf } from "./stretch.ts";
import { thoughtsOf } from "./thoughts.ts";
import { acquaintances, knownWords, playerObserver, type Witness } from "./witness.ts";
import { type LifeWorld, living } from "./world.ts";

export { acquaintances, knownWords, playerObserver, type Witness };

const CUES: Readonly<Record<string, SelfCue>> = {
  hungry: "hungry",
  starving: "hungry",
  thirsty: "thirsty",
  parched: "thirsty",
  tired: "tired",
  exhausted: "tired",
  sleepy: "tired",
  in_pain: "hurt",
  limping: "hurt",
  bone_broken: "hurt",
  bleeding: "bleeding",
  bleeding_heavily: "bleeding",
  feverish: "sick",
  wound_hot: "sick",
};

/** Cómo llama el personaje a su gente: la relación que sabe que tiene (sin nombres todavía). */
/** Mirando a propósito se ve más (perception §4); si no, está relajado. */
/** Las huellas que se ven donde está el personaje: con luz, y mientras no se hayan borrado. */
function marksAt(
  truth: ReadonlyWorldTruth,
  at: Location,
  now: Tick,
  light: number,
  rainSince: (made: Tick) => number,
): SceneMark[] {
  if (light < 0.3) return [];
  return truth.ids(TRACE).flatMap((id) => {
    const t = truth.get(TRACE, id);
    if (!t || t.at.hex !== at.hex || t.at.space !== at.space) return [];
    const rain = t.at.space === undefined ? rainSince(t.made) : 0;
    if (!traceVisible(t, now, rain)) return [];
    return [
      {
        kind: t.kind,
        age: traceStrength(t, now, rain) > 0.5 ? ("fresh" as const) : ("old" as const),
      },
    ];
  });
}

function attentionOf(steps: readonly StepRecord[]): number {
  const looked = steps.findLast((s) => s.verb === "look");
  const effect = looked?.self.effect;
  return effect?.kind === "observe" ? watching(effect.acuity) : ATTENTION.relaxed;
}

/** Cuántos percepts claros llegan al narrador por turno (narration §5; calibración abierta). */
export const MAX_CLEAR_PERCEPTS = 5;

const DETAIL_RANK = { identified: 0, clear: 1, vague: 2 } as const;

/**
 * Lo que merece una línea: lo reconocido y lo visto con claridad primero, hasta un tope, y a lo
 * sumo una sombra suelta. Una multitud de lejos es una sola impresión (npc-psychology, multitudes
 * por umbrales), no cien frases.
 */
function digest(percepts: readonly Percept[]): Percept[] {
  const sorted = [...percepts].sort((a, b) => DETAIL_RANK[a.detail] - DETAIL_RANK[b.detail]);
  const clear = sorted.filter((p) => p.detail !== "vague").slice(0, MAX_CLEAR_PERCEPTS);
  const vague = clear.length === 0 ? sorted.slice(0, 1) : [];
  return [...clear, ...vague];
}

/** Confianza mínima (ya envejecida) para dar por reconocido a alguien que cree que está acá. */
export const RECOGNIZED_CONFIDENCE = 0.2;

/**
 * Quién es lo que se ve sale de lo que el personaje cree (player-loop §9): si lo vio y lo
 * reconoció hace poco (`knowing` lo guarda en sus `BELIEFS`), lo reconoce; si no, es alguien de
 * cara no reconocida (figura y ropa se leen igual, pero sin identidad). Solo al mirar a propósito
 * (o en la primera escena) reconoce al instante y la mirada se queda con la lectura directa.
 */
export function recognizedFromBeliefs(
  percept: Percept,
  beliefs: Beliefs | undefined,
  at: Location,
  now: Tick,
): Percept {
  const who = percept.fields.identity;
  if (who === undefined || who.value === null || typeof who.value !== "string") return percept;
  const b = believed(beliefs, who.value as AgentId, "at");
  if (
    b !== undefined &&
    typeof b.value !== "boolean" &&
    sameValue(b.value, at) &&
    beliefConfidenceAt(b, now) >= RECOGNIZED_CONFIDENCE
  ) {
    return percept;
  }
  const { identity: _dropped, ...fields } = percept.fields;
  const detail = fields.figure !== undefined || fields.words !== undefined ? "clear" : "vague";
  return { ...percept, detail, fields };
}

export interface PlayerViewOptions {
  /** Es la primera escena de la sesión: se describe el lugar aunque lo conozca (narration §7). */
  readonly intro?: boolean;
  /** Lo que se dijo cerca desde este tick (lo guardado por la fase `perceive`) entra en la escena. */
  readonly heardSince?: Tick;
  /** Qué entidad hay detrás de cada etiqueta local (para la memoria de continuidad, del motor). */
  readonly onLabel?: (localId: string, entity: EntityRef) => void;
  /** Lo que el jugador pidió pensar (`pensar sobre X`): entra como pensamientos de la vista. */
  readonly thinking?: readonly ThoughtInput[];
}

/** Los verbos con los que se prueba algo: ahí un gusto de comida viene al caso. */
const TASTING = new Set(["eat", "drink", "cook"]);
/** Cuántas veces de cada tantas que prueba algo el personaje lo nota (no en cada bocado). */
export const TASTE_NOTICE_CHANCE = 0.35;

/**
 * Un gusto de comida del personaje, si probó algo y lo nota esta vez (npc-psychology §16). Sale de
 * `mentionableTastes` sobre sus propias preferencias; la tirada es de la vista (`rng`, no de la sim).
 */
export function tastesForView(
  w: LifeWorld,
  steps: readonly StepRecord[],
  rng: Rng,
): readonly TasteView[] {
  if (!steps.some((s) => TASTING.has(s.verb))) return [];
  const mine = w.truth.get(TASTES_OF, w.player);
  if (!mine) return [];
  const food = mine.preferences.filter((p) => p.domain.startsWith("food."));
  const [first] = mentionableTastes(food, w.tastes, 1);
  if (!first || !rng.chance(TASTE_NOTICE_CHANCE)) return [];
  // Si el gusto viene de alguien que conoce, lo cita como lo llama (nombre o «tu madre»).
  const who = first.about === undefined ? undefined : acquaintances(w).get(first.about);
  const reminds = who ? (who.name ?? `tu ${who.relation}`) : undefined;
  return [{ name: first.name, stance: first.stance, ...(reminds ? { reminds } : {}) }];
}

/** Cuántas veces de cada tantas el personaje se acuerda de una deuda a la vista (no en cada turno). */
export const DUE_NOTICE_CHANCE = 0.3;
/** Días de antelación desde los que una deuda o promesa se siente «por vencer». */
export const DUE_SOON_DAYS = 3;

/**
 * La deuda o promesa más urgente del libro del personaje, si ya venció o está por vencer y esta
 * vez se acuerda (contracts §14). Sale de `bookOf` (deuda de fiado exacta, promesas como las cree),
 * nunca de la verdad de una promesa; a lo prometido en bienes lo dice a ojo, sin gramos.
 */
export function duesForView(w: LifeWorld, rng: Rng): readonly DueView[] {
  const now = w.scheduler.now;
  const entries = bookOf(
    w.player,
    creditRows(w.truth),
    w.truth.get(PLEDGE_BOOK, w.player),
    now,
    (id) => w.truth.get(PLEDGE, id as EntityRef)?.weight ?? 0.5,
  ).filter((e) => e.due !== null && (e.due - now) / w.clock.day <= DUE_SOON_DAYS);
  const first = entries.sort((a, b) => (a.due as number) - (b.due as number))[0];
  if (!first || !rng.chance(DUE_NOTICE_CHANCE)) return [];
  const a = acquaintances(w).get(first.other);
  const t = first.term;
  const what =
    t.kind === "favor"
      ? "un favor"
      : t.kind === "silence"
        ? "un secreto"
        : t.unit === COPPER
          ? "unas monedas"
          : `algo de ${w.foods.find((f) => ledgerUnit(`good:${f.id}`) === t.unit)?.name ?? "lo prometido"}`;
  return [
    {
      direction: first.direction,
      who: a?.name ?? a?.relation ?? "alguien",
      what,
      state: (first.due as number) < now ? "overdue" : "soon",
      sure: first.confidence >= 0.4,
    },
  ];
}

export function playerView(
  w: LifeWorld,
  steps: readonly StepRecord[],
  options: PlayerViewOptions = {},
): PlayerView {
  const now = w.scheduler.now;
  const me = w.truth.get(PERSON, w.player);
  const at = w.truth.get(LOCATION, w.player);
  const body = w.truth.get(BODY_STATE, w.player);
  if (!me || !at || !body) throw new Error("el personaje no tiene persona, lugar o cuerpo");
  const hour = localHour(w.clock, now, w.map.lonDeg);
  const day = skyLight(w.map, w.clock, w.seed, now);
  const node = at.space === undefined ? undefined : w.spaces.spaces.find((s) => s.key === at.space);

  const acq = acquaintances(w);
  const observer = playerObserver(w, attentionOf(steps), now);
  const rng = Rng.root(w.seed).fork("view", now);
  // Reconoce por lo que cree (BELIEFS); al mirar a propósito o en la primera escena, al instante.
  const mine = w.truth.get(BELIEFS, w.player);
  const glancing = options.intro === true || steps.some((s) => s.verb === "look");
  const percepts: Percept[] = [];
  for (const id of living(w.truth)) {
    if (id === w.player) continue;
    const p = w.truth.get(PERSON, id);
    const l = w.truth.get(LOCATION, id);
    if (!p || !l) continue;
    const seen = perceive(
      presenceStimulus({
        id,
        at: l,
        look: {
          sex: p.sex,
          ageYears: (now - p.born) / w.clock.year,
          ...attireLook(w.truth.get(STATUS, id), w.statuses),
        },
        tick: now,
      }),
      [observer],
      { graph: w.spaces, forest: w.map.forest, daylight: day },
      rng,
    );
    // Lo no mirado a propósito se lee de lo que cree: quién es y cómo lo vio (figura y ropa).
    const believedSeen = (s: Percept): Percept => {
      const r = recognizedFromBeliefs(s, mine, l, now);
      return r.fields.identity === undefined ? r : withImpressions(r, id, mine, now);
    };
    percepts.push(...(glancing ? seen : seen.map(believedSeen)));
  }

  // Lo que otros dijeron mientras pasaba el turno (la respuesta de quien te escuchó).
  if (options.heardSince !== undefined) {
    const since = options.heardSince;
    for (const p of w.truth.get(PERCEPTS, w.player)?.recent ?? []) {
      const said = p.fields.words?.value;
      if (p.tick > since && typeof said === "string" && said.length > 0) percepts.push(p);
    }
  }

  const plan = w.plans.find((p) => p.id === body.plan);
  const signs = plan ? bodySigns(plan, body) : { general: [], zones: [] };
  const cues = new Set<SelfCue>();
  for (const s of [...signs.general, ...signs.zones.flatMap((z) => z.signs)]) {
    const c = CUES[s];
    if (c) cues.add(c);
  }

  const places = w.truth.ids(PLACE).flatMap((id) => {
    const p = w.truth.get(PLACE, id);
    return p ? [p] : [];
  });
  // Lo que le pasa por la cabeza desde que empezó el turno (no en la primera escena).
  const inner =
    options.heardSince === undefined
      ? undefined
      : thoughtsOf(w, {
          since: options.heardSince,
          present: percepts.flatMap((p) => {
            const who = p.fields.identity?.value;
            return typeof who === "string" ? [who as AgentId] : [];
          }),
          known: new Set<string>(acq.keys()),
        });
  const thoughtList = [...(options.thinking ?? []), ...(inner?.thoughts ?? [])];
  return buildPlayerView({
    player: w.player,
    ...(thoughtList.length > 0 ? { thoughts: thoughtList } : {}),
    ...(inner?.mode ? { mode: inner.mode } : {}),
    ...(inner?.mode === "montage" && options.heardSince !== undefined
      ? { stretch: stretchOf(steps, w.log.all(), w.player, options.heardSince, now, w.clock.day) }
      : {}),
    scene: {
      placeKinds: places.filter((p) => p.hexes.includes(at.hex)).map((p) => p.kind),
      space: node?.kind ?? "open",
      indoor: node?.indoor ?? false,
      home: at.space === houseKey(me.household),
      familiar: !options.intro,
      hour,
      light: node ? spaceLight(node, day) : day,
      marks: marksAt(w.truth, at, now, node ? spaceLight(node, day) : day, (made) =>
        rainBetween(w.map, w.clock, w.seed, made, now),
      ),
    },
    percepts: digest(percepts),
    steps: steps.map((s) => ({
      verb: s.verb,
      self: s.self,
      ...(s.purpose ? { purpose: s.purpose } : {}),
    })),
    acquaintances: acq,
    lexicon: knownWords(w),
    ...(options.onLabel ? { onLabel: options.onLabel } : {}),
    self: [...cues],
    tastes: tastesForView(w, steps, rng.fork("taste")),
    dues: duesForView(w, rng.fork("dues")),
  });
}
