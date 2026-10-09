// La vista del jugador (narration §2, §3): el único muro entre la verdad y lo que ve el LLM. Todo
// lo que llega al narrador sale de acá, y acá se borra lo que el personaje no sabe: los ids reales
// (cambian por ids locales `e1`, `e2`… por pedido), `mistaken`, las confianzas crudas, la tirada,
// el margen, los factores y los hexes. Lo que entra ya es lo que el personaje percibió o cree: sus
// percepts, su autopercepción de cada paso (`SelfReport`) y lo que cree de quienes conoce.
//
// Una figura que no reconoció es una etiqueta nueva en cada percept, aunque sea la misma persona:
// así un id local nunca delata que dos figuras "distintas" son una sola (narration §3).
//
// Puro y determinista: las etiquetas se numeran en el orden en que aparecen (los pasos primero,
// los percepts después) y el léxico va ordenado.

import { type AgentId, compareStrings, type EntityRef } from "../../core/index.ts";
import {
  type Attire,
  type BelievedOutcome,
  type Channel,
  type FactorKey,
  type FightGist,
  type Figure,
  type Percept,
  type PerceptDetail,
  type PlaceKind,
  type SelfReport,
  type SpaceKind,
  type Standing,
  standingOf,
} from "../../sim/index.ts";

declare const viewBrand: unique symbol;

/** Lo que el personaje siente de sí (perception §10). El cuerpo lo llena con body-health. */
export type SelfCue = "hungry" | "thirsty" | "tired" | "hurt" | "bleeding" | "sick" | "cold";

export interface SelfView {
  readonly cues: readonly SelfCue[];
}

/** Lo que el personaje piensa o siente este turno (narration §7, modo introspección). */
export type ThoughtKind = "remember" | "ponder" | "feel";
export type Mood = "grief" | "fear" | "longing" | "guilt" | "calm";

/** Un pensamiento que le sale de la sim (su mente, no la verdad): a quién recuerda y qué siente. */
export interface ThoughtInput {
  readonly kind: ThoughtKind;
  readonly about?: EntityRef;
  readonly mood?: Mood;
  /** El recuerdo está deformado o borroso: no se cuenta como cierto (narration §7). */
  readonly hazy?: boolean;
}

export interface ThoughtView {
  readonly kind: ThoughtKind;
  /** Etiqueta local de la persona en que piensa. */
  readonly about?: string;
  readonly mood?: Mood;
  readonly hazy?: boolean;
}

/** Un gusto propio que viene al caso este turno (npc-psychology §16): lo que el personaje sabe de sí. */
export type TasteStance = "loves" | "likes" | "dislikes" | "loathes";
export interface TasteView {
  /** Cómo lo nombra («lo amargo», «el té»): viene del catálogo, el narrador no lo inventa. */
  readonly name: string;
  readonly stance: TasteStance;
}
/** Modos que salen de lo que pasó en el tiempo y no de los pasos: salto, sueño y secuela. */
export type SpecialMode = "montage" | "dream" | "aftermath";

export type TimeOfDay = "night" | "dawn" | "morning" | "midday" | "afternoon" | "dusk";
export type LightBand = "dark" | "dim" | "bright";

/** Dónde está el personaje y cómo lo percibe. Lo arma quien tiene la verdad del lugar. */
export interface SceneInput {
  readonly placeKinds: readonly PlaceKind[];
  readonly space: SpaceKind;
  readonly indoor: boolean;
  /** Es su casa. */
  readonly home: boolean;
  /** Ya estuvo acá antes (un lugar nuevo se describe más, narration §7). */
  readonly familiar: boolean;
  /** Hora local, 0-24. */
  readonly hour: number;
  /** Luz donde está, 0-1 (`spaceLight`). */
  readonly light: number;
  /** Huellas a la vista donde está (ya filtradas por luz y por cuánto quedan). */
  readonly marks?: readonly SceneMark[];
}

/** Una huella a la vista en el lugar (perception §9): qué es y cuán vieja parece. */
export interface SceneMark {
  readonly kind: "blood";
  readonly age: "fresh" | "old";
}

export interface SceneView {
  /** Huellas que se ven donde está (con luz para verlas). */
  readonly marks: readonly SceneMark[];
  readonly placeKinds: readonly PlaceKind[];
  readonly space: SpaceKind;
  readonly indoor: boolean;
  readonly home: boolean;
  readonly familiar: boolean;
  readonly time: TimeOfDay;
  readonly light: LightBand;
}

export type Certainty = "sure" | "likely" | "unsure";

/** Cómo nombra el personaje a alguien (narration §3). */
export interface LocalLabel {
  readonly localId: string;
  /** Su nombre, si lo sabe. */
  readonly name?: string;
  /** "madre", "tío", "vecino": lo que es para el personaje. */
  readonly relation?: string;
  /** Lo que vio de su figura. */
  readonly figure?: Figure;
  /** Cómo viste, si lo alcanzó a ver (social-structure §3). */
  readonly attire?: Attire;
  /** La posición que deduce de la ropa, sin saber más (no el estatus real). */
  readonly standing?: Standing;
  /** Lo reconoció: sabe quién es. */
  readonly known: boolean;
  /** Cuán seguro está de lo que leyó (de quién es, o de que hay alguien). */
  readonly certainty: Certainty;
}

export interface PerceptView {
  /** La etiqueta de quién (o qué) percibió. */
  readonly who: string;
  readonly channels: readonly Channel[];
  readonly detail: PerceptDetail;
  /** El verbo que le vio hacer. */
  readonly action?: string;
  /** Lo que le oyó decir. */
  readonly words?: string;
}

/** El efecto de un paso propio como lo cree el personaje, sin ids ni hexes. */
export type EffectView =
  | { readonly kind: "none" }
  | {
      readonly kind: "move";
      /** Llegó; `false` quedó a mitad de camino; `null` no sabe dónde está. */
      readonly arrived: boolean | null;
      readonly stumbled: boolean;
    }
  | { readonly kind: "observe" }
  | {
      readonly kind: "search";
      readonly target?: string;
      readonly found: boolean;
      readonly glimpsed: boolean;
    }
  | {
      readonly kind: "gather";
      readonly good: string | null;
      readonly what: string | null;
      readonly amount: number;
      readonly stumbled: boolean;
    }
  | { readonly kind: "work"; readonly hurt: boolean }
  | {
      readonly kind: "speak";
      readonly to?: string;
      readonly delivered: boolean;
      readonly text: string | null;
    }
  | {
      readonly kind: "strike";
      readonly target?: string;
      readonly committed: boolean;
      readonly hit: boolean;
      readonly glancing: boolean;
      readonly offBalance: boolean;
      readonly fight?: FightGist;
      readonly finished?: boolean;
    }
  | {
      readonly kind: "spare";
      readonly target?: string;
    }
  | {
      readonly kind: "trade";
      readonly with?: string;
      readonly deal: boolean;
      /** Cómo cree que le fue con el precio. */
      readonly terms: "good" | "fair" | "poor";
      /** Lo que se movió, si se movió algo: compró o vendió tanto del bien por tantas monedas. */
      readonly moved?: {
        readonly direction: "buy" | "sell";
        readonly good: string;
        readonly grams: number;
        readonly coins: number;
      };
    }
  | {
      readonly kind: "give";
      readonly to?: string;
      /** Lo que dio, si dio algo. */
      readonly gave?: { readonly good: string; readonly grams: number };
    }
  | {
      readonly kind: "take";
      readonly from?: string;
      readonly got: readonly { readonly good: string; readonly amount: number }[];
    }
  | {
      readonly kind: "eat";
      readonly good: string | null;
      /** De la despensa de la casa (no de lo que llevaba encima). */
      readonly fromLarder: boolean;
      readonly grams: number;
    }
  | {
      readonly kind: "store";
      readonly got: readonly { readonly good: string; readonly amount: number }[];
    }
  | { readonly kind: "drink"; readonly drank: boolean }
  | {
      readonly kind: "cook";
      /** Lo que sacó (null si no cocinó nada). */
      readonly good: string | null;
      readonly grams: number;
      /** Cómo le pareció que quedó, por lo que alcanza a juzgar con sus sentidos. */
      readonly looks: "good" | "fair" | "poor";
    }
  | {
      readonly kind: "tend";
      readonly target?: string;
      readonly self: boolean;
      readonly done: boolean;
    }
  | {
      readonly kind: "consult";
      readonly with?: string;
      /** Si llegó a sentarse a la consulta. */
      readonly delivered: boolean;
      /** Monedas que dejó (0 si no pagó). */
      readonly paid: number;
    };

export interface OutcomeView {
  readonly verb: string;
  readonly believed: BelievedOutcome;
  /** Lo que nota que le jugó en contra (la luz, el terreno, los nervios). */
  readonly cues: readonly FactorKey[];
  readonly effect: EffectView;
}

/** Tipo con marca: solo `buildPlayerView` lo crea (narration §2). */
export interface PlayerView {
  readonly [viewBrand]: "PlayerView";
  readonly self: SelfView;
  readonly scene: SceneView;
  readonly percepts: readonly PerceptView[];
  readonly outcomes: readonly OutcomeView[];
  /** Lo que piensa, recuerda o siente; vacío casi siempre. */
  readonly thoughts: readonly ThoughtView[];
  /** Gustos propios que vale la pena decir ahora (`mentionableTastes`); vacío casi siempre. */
  readonly tastes: readonly TasteView[];
  /** Lo que la sim dice del momento (saltó el tiempo, soñó, pasó algo grave); casi nunca. */
  readonly mode?: SpecialMode;
  readonly labels: readonly LocalLabel[];
  /** Los nombres y palabras que el personaje conoce y pueden aparecer en la narración (§4). */
  readonly lexicon: readonly string[];
}

/** Lo que el personaje cree de alguien que conoce (information; la Fase 2 lo saca de creencias). */
export interface Acquaintance {
  readonly name?: string;
  readonly relation?: string;
}

/** Un paso propio: el verbo y lo que el personaje cree que pasó. */
export interface StepView {
  readonly verb: string;
  readonly self: SelfReport;
}

export interface ViewInput {
  readonly player: AgentId;
  readonly scene: SceneInput;
  /** Los percepts del jugador de este turno, en el orden en que llegaron. */
  readonly percepts: readonly Percept[];
  readonly steps: readonly StepView[];
  readonly acquaintances: ReadonlyMap<EntityRef, Acquaintance>;
  readonly self?: readonly SelfCue[];
  readonly thoughts?: readonly ThoughtInput[];
  readonly tastes?: readonly TasteView[];
  readonly mode?: SpecialMode;
  /** Palabras que conoce además de los nombres de sus conocidos (lugares, oficios). */
  readonly lexicon?: readonly string[];
  /**
   * Avisa a quien arma la vista qué entidad real está detrás de cada etiqueta local reconocida.
   * Queda del lado del motor (memoria de continuidad): no entra en `PlayerView`.
   */
  readonly onLabel?: (localId: string, entity: EntityRef) => void;
}

export function timeOfDay(hour: number): TimeOfDay {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5) return "night";
  if (h < 7) return "dawn";
  if (h < 11) return "morning";
  if (h < 14) return "midday";
  if (h < 18) return "afternoon";
  if (h < 20) return "dusk";
  return "night";
}

export function lightBand(light: number): LightBand {
  if (light < 0.05) return "dark";
  if (light < 0.35) return "dim";
  return "bright";
}

export function certaintyOf(confidence: number): Certainty {
  if (confidence >= 0.9) return "sure";
  if (confidence >= 0.6) return "likely";
  return "unsure";
}

/** Cómo cree que le fue con el precio, desde la ventaja creída (-0,3 a 0,3). */
function termsOf(edge: number): "good" | "fair" | "poor" {
  if (edge > 0.05) return "good";
  if (edge < -0.05) return "poor";
  return "fair";
}

function isAgent(ref: unknown): ref is AgentId {
  return typeof ref === "string" && ref.startsWith("agent:");
}

/**
 * Arma la vista del jugador. Tira si le pasan percepts de otro: el muro no mezcla mentes.
 */
export function buildPlayerView(input: ViewInput): PlayerView {
  const labels: LocalLabel[] = [];
  const byEntity = new Map<EntityRef, string>();
  const words = new Set<string>(input.lexicon ?? []);

  const known = (
    entity: EntityRef,
    certainty: Certainty,
    figure?: Figure,
    attire?: Attire,
  ): string => {
    const hit = byEntity.get(entity);
    if (hit !== undefined) return hit;
    const localId = `e${labels.length + 1}`;
    const a = input.acquaintances.get(entity);
    labels.push({
      localId,
      ...(a?.name !== undefined ? { name: a.name } : {}),
      ...(a?.relation !== undefined ? { relation: a.relation } : {}),
      ...(figure !== undefined ? { figure } : {}),
      ...(attire !== undefined ? { attire, standing: standingOf(attire) } : {}),
      known: true,
      certainty,
    });
    if (a?.name !== undefined) words.add(a.name);
    byEntity.set(entity, localId);
    input.onLabel?.(localId, entity);
    return localId;
  };

  const stranger = (certainty: Certainty, figure?: Figure, attire?: Attire): string => {
    const localId = `e${labels.length + 1}`;
    labels.push({
      localId,
      ...(figure !== undefined ? { figure } : {}),
      ...(attire !== undefined ? { attire, standing: standingOf(attire) } : {}),
      known: false,
      certainty,
    });
    return localId;
  };

  /** A quién apuntó el personaje en su paso: lo sabe, porque lo eligió él. */
  const target = (ref: EntityRef | null | undefined): { target?: string } =>
    isAgent(ref) ? { target: known(ref, "sure") } : {};

  const outcomes: OutcomeView[] = input.steps.map((step) => ({
    verb: step.verb,
    believed: step.self.believed,
    cues: [...step.self.cues],
    effect: effectView(step.self, target, input.player),
  }));

  const percepts: PerceptView[] = [];
  for (const p of input.percepts) {
    if (p.observer !== input.player) {
      throw new RangeError(`percept ${p.id} es de ${p.observer}, no del jugador`);
    }
    const figure = p.fields.figure?.value as Figure | undefined;
    const attire = p.fields.attire?.value as Attire | undefined;
    const identity = p.fields.identity;
    const who =
      identity !== undefined && isAgent(identity.value)
        ? known(identity.value, certaintyOf(identity.confidence), figure, attire)
        : stranger(certaintyOf(p.fields.presence?.confidence ?? 0), figure, attire);
    const action = p.fields.action?.value;
    const said = p.fields.words?.value;
    percepts.push({
      who,
      channels: [...p.channels],
      detail: p.detail,
      ...(typeof action === "string" ? { action } : {}),
      ...(typeof said === "string" && said.length > 0 ? { words: said } : {}),
    });
  }

  const thoughts: ThoughtView[] = (input.thoughts ?? []).map((t) => ({
    kind: t.kind,
    ...(isAgent(t.about) ? { about: known(t.about, "sure") } : {}),
    ...(t.mood !== undefined ? { mood: t.mood } : {}),
    ...(t.hazy === true ? { hazy: true } : {}),
  }));

  const view = {
    self: { cues: [...(input.self ?? [])] },
    scene: sceneView(input.scene),
    percepts,
    outcomes,
    thoughts,
    tastes: (input.tastes ?? []).map((t) => ({ name: t.name, stance: t.stance })),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    labels,
    lexicon: [...words].sort(compareStrings),
  };
  return view as unknown as PlayerView;
}

function sceneView(s: SceneInput): SceneView {
  return {
    placeKinds: [...s.placeKinds],
    space: s.space,
    indoor: s.indoor,
    home: s.home,
    familiar: s.familiar,
    time: timeOfDay(s.hour),
    light: lightBand(s.light),
    marks: [...(s.marks ?? [])],
  };
}

function effectView(
  self: SelfReport,
  target: (ref: EntityRef | null | undefined) => { target?: string },
  player: AgentId,
): EffectView {
  const e = self.effect;
  switch (e.kind) {
    case "none":
      return { kind: "none" };
    case "move":
      return {
        kind: "move",
        arrived: e.reached === null ? null : e.reached === e.to,
        stumbled: e.stumbled,
      };
    case "observe":
      return { kind: "observe" };
    case "search":
      return { kind: "search", ...target(e.target), found: e.found, glimpsed: e.glimpsed };
    case "gather":
      return {
        kind: "gather",
        good: e.good,
        what: e.what,
        amount: Math.round(e.amount),
        stumbled: e.stumbled,
      };
    case "work":
      return { kind: "work", hurt: e.hurt };
    case "speak": {
      const to = target(e.to).target;
      return {
        kind: "speak",
        ...(to !== undefined ? { to } : {}),
        delivered: e.delivered,
        text: e.text,
      };
    }
    case "strike":
      return {
        kind: "strike",
        ...target(e.target),
        committed: e.committed,
        hit: e.hit,
        glancing: e.glancing,
        offBalance: e.offBalance,
        ...(e.fight ? { fight: e.fight } : {}),
        ...(e.finished ? { finished: true } : {}),
      };
    case "spare":
      return { kind: "spare", ...target(e.target) };
    case "trade": {
      const w = target(e.with).target;
      return {
        kind: "trade",
        ...(w !== undefined ? { with: w } : {}),
        deal: e.deal,
        terms: termsOf(e.edge),
        ...(e.direction !== null && e.good !== null
          ? {
              moved: {
                direction: e.direction,
                good: e.good as string,
                grams: e.grams,
                coins: e.coins,
              },
            }
          : {}),
      };
    }
    case "give": {
      const to = target(e.to).target;
      return {
        kind: "give",
        ...(to !== undefined ? { to } : {}),
        ...(e.good !== null && e.grams > 0
          ? { gave: { good: e.good as string, grams: Math.round(e.grams) } }
          : {}),
      };
    }
    case "take": {
      const from = target(typeof e.from === "string" ? (e.from as EntityRef) : null).target;
      return {
        kind: "take",
        ...(from !== undefined ? { from } : {}),
        got: e.got.map((h) => ({ good: h.unit as string, amount: Math.round(h.amount) })),
      };
    }
    case "eat":
      return {
        kind: "eat",
        good: e.good,
        fromLarder: e.from !== null && e.from !== player,
        grams: Math.round(e.grams),
      };
    case "store":
      return {
        kind: "store",
        got: e.got.map((h) => ({ good: h.unit as string, amount: Math.round(h.amount) })),
      };
    case "drink":
      return { kind: "drink", drank: e.liters > 0 };
    case "cook":
      return {
        kind: "cook",
        good: e.good,
        grams: Math.round(e.grams),
        looks: e.quality >= 0.7 ? "good" : e.quality >= 0.35 ? "fair" : "poor",
      };
    case "tend": {
      const self = e.target === player;
      return { kind: "tend", ...(self ? {} : target(e.target)), self, done: e.done };
    }
    case "consult": {
      const w = target(e.with).target;
      return {
        kind: "consult",
        ...(w !== undefined ? { with: w } : {}),
        delivered: e.delivered,
        paid: e.paid?.amount ?? 0,
      };
    }
  }
}
