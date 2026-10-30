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
  type Purpose,
  type PurposeId,
  type SelfReport,
  type SpaceKind,
  type Standing,
  standingOf,
} from "../../sim/index.ts";

declare const viewBrand: unique symbol;

/** Lo que el personaje siente de sí (perception §10). El cuerpo lo llena con body-health. */
export type SelfCue =
  | "hungry"
  | "thirsty"
  | "tired"
  | "hurt"
  | "bleeding"
  | "sick"
  | "cold"
  /** Le falta una parte del cuerpo (`Scar.lost`): lo sabe y lo ve. */
  | "maimed"
  /** Perdió el conocimiento por el frío o el calor y volvió en sí (`body.collapsed` por causa térmica). */
  | "blacked_out";

export interface SelfView {
  readonly cues: readonly SelfCue[];
}

/** Lo que el personaje piensa o siente este turno (narration §7, modo introspección). */
export type ThoughtKind = "remember" | "ponder" | "feel" | "conclude";
export type Mood = "grief" | "fear" | "longing" | "guilt" | "calm";

/** Qué tan seguro llega a una conclusión (las bandas de `confidenceBand`, sin cifras). */
export type ConclusionBand = "convinced" | "likely" | "maybe" | "hunch";

/**
 * Lo que el personaje concluyó al pensar (player-loop «Pensar»): el hecho (predicado del catálogo de
 * inferencias y las personas que nombra), la banda de seguridad, el hecho rival si dudó entre dos y
 * la evidencia citada por clase (lo que lo sostiene, no las cifras).
 */
export interface ConclusionInput {
  readonly pred: string;
  readonly args: readonly EntityRef[];
  readonly band: ConclusionBand;
  readonly rival?: { readonly pred: string; readonly args: readonly EntityRef[] };
  readonly because?: readonly string[];
}

export interface ConclusionView {
  readonly pred: string;
  /** Etiquetas locales de las personas que nombra el hecho, en orden (las demás se omiten). */
  readonly who: readonly string[];
  readonly band: ConclusionBand;
  readonly rival?: { readonly pred: string; readonly who: readonly string[] };
  readonly because?: readonly string[];
}

/** Un pensamiento que le sale de la sim (su mente, no la verdad): a quién recuerda y qué siente. */
export interface ThoughtInput {
  readonly kind: ThoughtKind;
  /** Solo con `kind: "conclude"`: la conclusión de pensar sobre algo. */
  readonly conclusion?: ConclusionInput;
  readonly about?: EntityRef;
  readonly mood?: Mood;
  /** El recuerdo está deformado o borroso: no se cuenta como cierto (narration §7). */
  readonly hazy?: boolean;
  /** Un gusto propio que viene atado a un recuerdo (cómo lo nombra el catálogo y cómo lo recuerda). */
  readonly taste?: { readonly name: string; readonly recalls: "ill" | "good" };
}

export interface ThoughtView {
  readonly kind: ThoughtKind;
  readonly conclusion?: ConclusionView;
  /** Etiqueta local de la persona en que piensa. */
  readonly about?: string;
  readonly mood?: Mood;
  readonly hazy?: boolean;
  readonly taste?: { readonly name: string; readonly recalls: "ill" | "good" };
}

/** Un gusto propio que viene al caso este turno (npc-psychology §16): lo que el personaje sabe de sí. */
export type TasteStance = "loves" | "likes" | "dislikes" | "loathes";
export interface TasteView {
  /** Cómo lo nombra («lo amargo», «el té»): viene del catálogo, el narrador no lo inventa. */
  readonly name: string;
  readonly stance: TasteStance;
  /** A quién le recuerda («tu madre»), si el gusto viene de alguien que conoce. */
  readonly reminds?: string;
  /** Si nació de algo que recuerda: `ill` (le cayó mal) o `good` (un buen momento). */
  readonly recalls?: "ill" | "good";
}
/**
 * Una deuda o promesa del libro del personaje que vale la pena recordar ahora (contracts §14): solo
 * lo que cree, sin números de la verdad. `what` ya viene dicho («unas monedas», «un favor»).
 */
export interface DueView {
  readonly direction: "i-owe" | "owed-to-me";
  /** Cómo llama a la otra parte (nombre o relación); el narrador no inventa otro. */
  readonly who: string;
  readonly what: string;
  /** Ya pasó el plazo, o falta poco. */
  readonly state: "overdue" | "soon";
  /** Si no está seguro de lo que recuerda, el narrador lo dice borroso. */
  readonly sure: boolean;
}
/**
 * Un oficio que el personaje oyó de un vecino (creencia de oídas, nunca la verdad): el oficio por
 * su nombre y, si conoce a alguien de esa casa, cómo lo llama. Sin ids de hogar ni de receta.
 */
export interface HeardTradeView {
  readonly trade: string;
  readonly who?: string;
  /** Si lo cree con firmeza; si no, el narrador lo deja en «dicen». */
  readonly sure: boolean;
}
/**
 * Lo que le contaron de si alguien vive («dicen que…», creencia `told`, nunca la verdad): de quién
 * habla y quién se lo dijo, ambos por cómo los conoce el personaje. Sin ids.
 */
export interface HeardClaimView {
  readonly about: string;
  readonly claim: "alive" | "dead";
  /** Quién se lo contó, si lo conoce; si no, el narrador lo deja en «dicen». */
  readonly from?: string;
  /** Si lo cree con firmeza; si no, el narrador lo deja en duda. */
  readonly sure: boolean;
}
/**
 * La lectura de un adivino que el personaje fue a ver (divination §5): lo que vio tirar y lo que
 * le dijeron, nunca si es cierto ni lo que el adivino creyó leer.
 */
export interface ReadingView {
  /** Con qué lee («huesos de gallina»). */
  readonly instrument: string;
  /** Los signos que cayeron, como los nombra el oficio. */
  readonly signs: readonly string[];
  /** Cómo llama a quien lee (nombre o relación). */
  readonly diviner: string;
  /** Lo que anunció: grandeza, ruina, muerte o fortuna, y qué tan fuerte lo dijo. */
  readonly told: "greatness" | "ruin" | "death" | "fortune";
  readonly strength: "strong" | "faint";
  /** Habló en vago (sirve a cualquiera). */
  readonly vague: boolean;
  /** El personaje no termina de creerlo. */
  readonly doubtful: boolean;
}
/** Modos que salen de lo que pasó en el tiempo y no de los pasos: salto, sueño y secuela. */
/**
 * Una falta de etiqueta en la que el personaje fue parte (social §4): la que recibió o la que
 * cometió y notó por la reacción del otro. Solo lo que se ve: la norma rota y qué hizo el ofendido.
 */
export interface OffenseView {
  readonly role: "received" | "caused";
  /** Cómo llama al otro (nombre o relación). */
  readonly who: string;
  /** La norma rota (id de la forma de la etiqueta: tuteo, saludo, reverencia...). */
  readonly norm: string;
  readonly response: "rebuke" | "punish" | "ignore";
}

export type SpecialMode = "montage" | "dream" | "aftermath";

/**
 * Lo que el personaje vivió en un salto de tiempo (modo `montage`, narration §1): solo cuentas de
 * lo propio —qué hizo, cuántas veces, cuántas le salieron mal—, nada del mundo que no vio.
 */
export interface StretchView {
  /** Días de mundo que pasaron. */
  readonly days: number;
  /** Lo que más hizo (verbo del catálogo), de más a menos veces; el resto se omite. */
  readonly did: readonly {
    readonly verb: string;
    readonly times: number;
    readonly failed: number;
  }[];
  /** Con cuántas personas distintas habló. */
  readonly spoke: number;
  /** Se lastimó en el trabajo o en una pelea. */
  readonly hurt: boolean;
  /** Peleó. */
  readonly fought: boolean;
  /**
   * Lo que el cuerpo sigue sintiendo de las heridas (qué parte y cómo), de la más grave a la menos;
   * son las señales que el personaje siente (`bodySigns`), nunca el estado real de la herida.
   */
  readonly wounds?: readonly { readonly zone: string; readonly sign: string }[];
  /** Etiquetas locales de los conocidos con los que habló (a los extraños no se los nombra). */
  readonly spokeWith: readonly string[];
}

/** Lo que arma quien tiene la verdad: igual que `StretchView`, con las personas en vez de etiquetas. */
export interface StretchInput extends Omit<StretchView, "spokeWith"> {
  /** Con quién habló, en orden estable; el muro deja solo a los conocidos. */
  readonly metWith: readonly AgentId[];
}

/** Cuántos conocidos como máximo se nombran en un salto. */
export const STRETCH_NAMED = 3;

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
  /** Un extraño de la misma figura que ya vio otro día: «el desconocido de ayer». */
  readonly seenBefore?: boolean;
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
  /** No estaba a la vista en la escena anterior del mismo lugar (narration §7: se cuenta lo que cambia). */
  readonly arrived?: true;
}

/** El efecto de un paso propio como lo cree el personaje, sin ids ni hexes. */
export type EffectView =
  | { readonly kind: "none" }
  | {
      readonly kind: "move";
      /** Llegó; `false` quedó a mitad de camino; `null` no sabe dónde está. */
      readonly arrived: boolean | null;
      readonly stumbled: boolean;
      /** La puerta trabada no lo dejó salir. */
      readonly blocked?: boolean;
    }
  | {
      readonly kind: "observe";
      /** A quién miró en particular, si nombró a alguien («miro a mi madre»). */
      readonly target?: string;
    }
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
      /** La herramienta quedó gastada del todo en el paso (use-tools-wear): se nota en la mano. */
      readonly toolWorn?: boolean;
    }
  | { readonly kind: "work"; readonly hurt: boolean; readonly toolWorn?: boolean }
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
      /** El otro anda apretado de plata o en la ruina (se le nota): pesó en el trato. */
      readonly strain?: "tight" | "broke";
      /** Herramienta nueva del herrero: cuál y cuánto pagó (use-tools-mend-trade-buy). */
      readonly forged?: { readonly what: string; readonly coins: number };
      /**
       * Herramienta que no se pudo comprar o vender: cuál y qué faltó (cobre de quien compra, hierro
       * del herrero, ganas del comprador, otra en la casa del vendedor).
       */
      readonly unforged?: {
        readonly what: string;
        readonly lack: "copper" | "iron" | "want" | "spare";
        /** Era una herramienta usada (use-tools-mend-trade-sell), no una nueva del herrero. */
        readonly used?: true;
        /** Era un animal (livestock-tenure-sell). */
        readonly animal?: true;
      };
      /** Herramienta usada que cambió de manos: cuál, para qué lado y por cuánto (use-tools-mend-trade-sell). */
      readonly used?: {
        readonly what: string;
        readonly direction: "buy" | "sell";
        readonly coins: number;
        /** Era un animal (livestock-tenure-sell), no una herramienta. */
        readonly animal?: true;
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
      /** Tomó una sustancia (remedio, droga, veneno): sin nombrarla ni contarla como comida. */
      readonly kind: "consume";
      readonly fromLarder: boolean;
    }
  | {
      readonly kind: "store";
      readonly got: readonly { readonly good: string; readonly amount: number }[];
    }
  | {
      /** Soltó lo que llevaba en el lugar donde está (queda sin dueño en el suelo). */
      readonly kind: "drop";
      readonly got: readonly { readonly good: string; readonly amount: number }[];
    }
  | { readonly kind: "drink"; readonly drank: boolean }
  | {
      /**
       * Usó una cosa con una función (`well.draw_water`, `tool.sharpen`, `tool.mend`): si le salió
       * (juntó agua, le sacó filo, se la arreglaron), si tenía con qué (recipiente, herramienta y
       * piedra) y los litros juntados; en un arreglo que no se hizo, qué faltó.
       */
      readonly kind: "use";
      readonly how: string;
      readonly liters: number;
      readonly done: boolean;
      readonly means: boolean;
      readonly lack?: "tool" | "smith" | "copper" | "iron";
    }
  | { readonly kind: "boil"; readonly boiled: boolean }
  | { readonly kind: "filter"; readonly filtered: boolean }
  | { readonly kind: "kindle"; readonly lit: boolean; readonly fed: boolean }
  | { readonly kind: "douse"; readonly doused: boolean }
  | { readonly kind: "slaughter"; readonly done: boolean; readonly had: boolean }
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
  /** El porqué que el personaje declaró para este paso (su palabra, no una verdad): se cita tal cual. */
  readonly purpose?: PurposeView;
}

/** El porqué declarado, con el beneficiario como etiqueta local si es alguien. */
export interface PurposeView {
  readonly motive: PurposeId;
  readonly forWhom?: string;
}

/**
 * Una cosa suelta a la vista (play-refs-objects-look): lo que se ve de ella como claves (forma,
 * material, tamaño); el narrador la nombra con las palabras de las plantillas. `looked`: la miró a
 * propósito este turno («miro la canasta»).
 */
export interface ThingView {
  readonly shape: string;
  readonly material?: string;
  readonly size: "small" | "medium" | "large";
  readonly looked?: true;
  /** Lo que se nota de su estado al mirarlo (lo fijo: el pozo gastado, el granero descuidado; el buey cansado). */
  readonly state?: "worn" | "poor" | "lit" | "cold" | "tired" | "soaking" | "almost";
  /** Lo demás que se le nota a un animal de cerca (livestock-look-more): edad, hambre, cría. */
  readonly marks?: readonly ("young" | "old" | "thin" | "starving" | "nursing")[];
}

/** Lo fijo del espacio (el pozo, el granero): entra a la vista solo si lo miró a propósito. */
export interface FixtureInput {
  readonly ref: EntityRef;
  readonly shape: string;
  readonly state?: ThingView["state"];
  readonly marks?: ThingView["marks"];
  /** Sin definir: grande (el pozo, el granero). Un animal chico, mediano. */
  readonly size?: "small" | "medium" | "large";
}

/** Tipo con marca: solo `buildPlayerView` lo crea (narration §2). */
export interface PlayerView {
  readonly [viewBrand]: "PlayerView";
  readonly self: SelfView;
  readonly scene: SceneView;
  readonly percepts: readonly PerceptView[];
  /** Las cosas sueltas que ve (no personas); casi siempre ausente. */
  readonly things?: readonly ThingView[];
  readonly outcomes: readonly OutcomeView[];
  /** Lo que piensa, recuerda o siente; vacío casi siempre. */
  readonly thoughts: readonly ThoughtView[];
  /** Gustos propios que vale la pena decir ahora (`mentionableTastes`); vacío casi siempre. */
  readonly tastes: readonly TasteView[];
  /** Una deuda o promesa por vencer o vencida que el personaje recuerda ahora; vacío casi siempre. */
  readonly dues: readonly DueView[];
  readonly offenses: readonly OffenseView[];
  /** Un oficio oído de un vecino, como creencia; vacío casi siempre. */
  readonly heardTrades: readonly HeardTradeView[];
  /** Lo que le contaron de si alguien vive («dicen que…») este turno; vacío casi siempre. */
  readonly heardClaims: readonly HeardClaimView[];
  /** Las lecturas de adivino de este turno; vacío casi siempre. */
  readonly readings: readonly ReadingView[];
  /** Lo que la sim dice del momento (saltó el tiempo, soñó, pasó algo grave); casi nunca. */
  readonly mode?: SpecialMode;
  /** Con el modo `montage`: lo que vivió en el salto. */
  readonly stretch?: StretchView;
  /** Quienes estaban a la vista en la escena anterior del mismo lugar y ya no; casi siempre vacío. */
  readonly gone?: readonly string[];
  readonly labels: readonly LocalLabel[];
  /** Los nombres y palabras que el personaje conoce y pueden aparecer en la narración (§4). */
  readonly lexicon: readonly string[];
  /** Opt-in: cómo le dicen al personaje en la aldea, con lugar («el Ladrón de Valle Alto»), solo si ya lo sabe. */
  readonly nickname?: string;
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
  /** El porqué que declaró el propio jugador; el narrador solo lo cita. */
  readonly purpose?: Purpose | undefined;
}

export interface ViewInput {
  readonly player: AgentId;
  readonly scene: SceneInput;
  /** Los percepts del jugador de este turno, en el orden en que llegaron. */
  readonly percepts: readonly Percept[];
  /** Las cosas sueltas que ve (percepts con `thing`, de `itemsSeen`). */
  readonly things?: readonly Percept[];
  /** Lo fijo del espacio donde está (play-refs-objects-fixtures-look). */
  readonly fixtures?: readonly FixtureInput[];
  /** Ids de los percepts de extraños que el personaje ya vio otro día (`strangersSeenBefore`). */
  readonly seenBefore?: ReadonlySet<string>;
  /** Ids de los percepts de quienes no estaban a la vista en la escena anterior del mismo lugar. */
  readonly arrived?: ReadonlySet<string>;
  /** Los percepts de la escena anterior del mismo lugar de quienes ya no se ven. */
  readonly gone?: readonly Percept[];
  readonly steps: readonly StepView[];
  readonly acquaintances: ReadonlyMap<EntityRef, Acquaintance>;
  readonly self?: readonly SelfCue[];
  readonly thoughts?: readonly ThoughtInput[];
  readonly tastes?: readonly TasteView[];
  readonly dues?: readonly DueView[];
  readonly offenses?: readonly OffenseView[];
  readonly heardTrades?: readonly HeardTradeView[];
  readonly heardClaims?: readonly HeardClaimView[];
  readonly readings?: readonly ReadingView[];
  readonly mode?: SpecialMode;
  readonly stretch?: StretchInput;
  /** Palabras que conoce además de los nombres de sus conocidos (lugares, oficios). */
  readonly lexicon?: readonly string[];
  /** El apodo con lugar que el personaje ya sabe (opt-in). */
  readonly nickname?: string;
  /**
   * Avisa a quien arma la vista qué entidad real está detrás de cada etiqueta local reconocida.
   * Queda del lado del motor (memoria de continuidad): no entra en `PlayerView`.
   */
  readonly onLabel?: (localId: string, entity: EntityRef) => void;
  /**
   * Lo mismo para la etiqueta de un desconocido: de qué fuente salió lo que vio. El personaje no
   * sabe quién es; sirve para que «la figura de recién» apunte a la misma figura (actions §4).
   */
  readonly onStranger?: (localId: string, source: EntityRef) => void;
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
 * Cómo se narra lo que se vio hacer: los eventos de acción llegan como `action.<verbo>` y se narran
 * por el verbo (`work`); los demás (`body.died`, `family.birth`) conservan su clase entera.
 */
export function perceivedAction(kind: string): string {
  return kind.startsWith("action.") ? kind.slice("action.".length) : kind;
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

  const stranger = (
    certainty: Certainty,
    figure?: Figure,
    attire?: Attire,
    seenBefore = false,
  ): string => {
    const localId = `e${labels.length + 1}`;
    labels.push({
      localId,
      ...(seenBefore ? { seenBefore: true } : {}),
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
    ...(step.purpose
      ? {
          purpose: {
            motive: step.purpose.motive,
            ...(isAgent(step.purpose.forWhom)
              ? { forWhom: known(step.purpose.forWhom, "sure") }
              : {}),
          },
        }
      : {}),
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
        : stranger(
            certaintyOf(p.fields.presence?.confidence ?? 0),
            figure,
            attire,
            input.seenBefore?.has(p.id) === true,
          );
    if (p.sourceEntityId !== undefined && !(identity !== undefined && isAgent(identity.value)))
      input.onStranger?.(who, p.sourceEntityId);
    const action = p.fields.action?.value;
    const said = p.fields.words?.value;
    percepts.push({
      who,
      channels: [...p.channels],
      detail: p.detail,
      ...(typeof action === "string" ? { action: perceivedAction(action) } : {}),
      ...(typeof said === "string" && said.length > 0 ? { words: said } : {}),
      ...(input.arrived?.has(p.id) === true ? { arrived: true as const } : {}),
    });
  }
  // Quien se dejó de ver se nombra como se lo vio la última vez (no se sabe adónde fue).
  const gone = (input.gone ?? []).map((p) => {
    const identity = p.fields.identity;
    const figure = p.fields.figure?.value as Figure | undefined;
    const attire = p.fields.attire?.value as Attire | undefined;
    return identity !== undefined && isAgent(identity.value)
      ? known(identity.value, certaintyOf(identity.confidence), figure, attire)
      : stranger(certaintyOf(p.fields.presence?.confidence ?? 0), figure, attire, false);
  });

  const conclusionWho = (args: readonly EntityRef[]): string[] =>
    args.filter(isAgent).map((a) => known(a, "sure"));
  const thoughts: ThoughtView[] = (input.thoughts ?? []).map((t) => ({
    kind: t.kind,
    ...(t.conclusion !== undefined
      ? {
          conclusion: {
            pred: t.conclusion.pred,
            who: conclusionWho(t.conclusion.args),
            band: t.conclusion.band,
            ...(t.conclusion.rival !== undefined
              ? {
                  rival: {
                    pred: t.conclusion.rival.pred,
                    who: conclusionWho(t.conclusion.rival.args),
                  },
                }
              : {}),
            ...(t.conclusion.because !== undefined ? { because: [...t.conclusion.because] } : {}),
          },
        }
      : {}),
    ...(isAgent(t.about) ? { about: known(t.about, "sure") } : {}),
    ...(t.mood !== undefined ? { mood: t.mood } : {}),
    ...(t.hazy === true ? { hazy: true } : {}),
    ...(t.taste !== undefined ? { taste: t.taste } : {}),
  }));

  const things = thingViews(input.things ?? [], input.fixtures ?? [], input.steps);
  const view = {
    self: { cues: [...(input.self ?? [])] },
    scene: sceneView(input.scene),
    percepts,
    ...(things.length > 0 ? { things } : {}),
    ...(gone.length > 0 ? { gone } : {}),
    outcomes,
    thoughts,
    tastes: (input.tastes ?? []).map((t) => ({ name: t.name, stance: t.stance })),
    dues: (input.dues ?? []).map((d) => ({ ...d })),
    offenses: (input.offenses ?? []).map((o) => ({ ...o })),
    heardTrades: (input.heardTrades ?? []).map((t) => ({ ...t })),
    heardClaims: (input.heardClaims ?? []).map((c) => ({ ...c })),
    readings: (input.readings ?? []).map((r) => ({ ...r, signs: [...r.signs] })),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.mode === "montage" && input.stretch !== undefined
      ? {
          stretch: {
            days: input.stretch.days,
            did: input.stretch.did.map((d) => ({ ...d })),
            spoke: input.stretch.spoke,
            hurt: input.stretch.hurt,
            fought: input.stretch.fought,
            ...(input.stretch.wounds !== undefined && input.stretch.wounds.length > 0
              ? { wounds: input.stretch.wounds.map((w) => ({ ...w })) }
              : {}),
            spokeWith: input.stretch.metWith
              .filter((a) => input.acquaintances.has(a))
              .slice(0, STRETCH_NAMED)
              .map((a) => known(a, "sure")),
          },
        }
      : {}),
    labels,
    lexicon: [...words].sort(compareStrings),
    ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
  };
  return view as unknown as PlayerView;
}

/** Las cosas vistas, con las que miró a propósito marcadas (lo eligió él: lo sabe). */
function thingViews(
  percepts: readonly Percept[],
  fixtures: readonly FixtureInput[],
  steps: readonly StepView[],
): ThingView[] {
  const looked = new Set(
    steps.flatMap((s) =>
      s.self.effect.kind === "observe" && s.self.effect.target !== undefined
        ? [s.self.effect.target]
        : [],
    ),
  );
  const fixed = fixtures.flatMap((f): ThingView[] =>
    looked.has(f.ref)
      ? [
          {
            shape: f.shape,
            size: f.size ?? "large",
            looked: true,
            ...(f.state !== undefined ? { state: f.state } : {}),
            ...(f.marks !== undefined && f.marks.length > 0 ? { marks: f.marks } : {}),
          },
        ]
      : [],
  );
  const loose = percepts.flatMap((p): ThingView[] => {
    const look = p.fields.thing?.value as
      | { shape?: unknown; material?: unknown; size?: unknown }
      | undefined;
    if (typeof look?.shape !== "string") return [];
    const size = look.size === "small" || look.size === "large" ? look.size : "medium";
    return [
      {
        shape: look.shape,
        ...(typeof look.material === "string" ? { material: look.material } : {}),
        size,
        ...(p.sourceEntityId !== undefined && looked.has(p.sourceEntityId)
          ? { looked: true as const }
          : {}),
      },
    ];
  });
  return [...loose, ...fixed];
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
    case "ponder":
    case "forge":
    case "hire":
      return { kind: "none" };
    case "move":
      return {
        kind: "move",
        arrived: e.reached === null ? null : e.reached === e.to,
        stumbled: e.stumbled,
        ...(e.blocked !== undefined ? { blocked: true } : {}),
      };
    case "observe":
      return { kind: "observe", ...target(e.target) };
    case "search":
      return { kind: "search", ...target(e.target), found: e.found, glimpsed: e.glimpsed };
    case "gather":
      return {
        kind: "gather",
        good: e.good,
        what: e.what,
        amount: Math.round(e.amount),
        stumbled: e.stumbled,
        ...(e.toolWorn === true ? { toolWorn: true } : {}),
      };
    case "work":
      return { kind: "work", hurt: e.hurt, ...(e.toolWorn === true ? { toolWorn: true } : {}) };
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
        ...(e.strain !== undefined ? { strain: e.strain } : {}),
        ...(e.deal &&
        e.forgedName !== undefined &&
        e.usedItem === undefined &&
        e.animal === undefined
          ? { forged: { what: e.forgedName, coins: e.coins } }
          : {}),
        ...(e.deal &&
        e.forgedName !== undefined &&
        (e.usedItem !== undefined || e.animal !== undefined) &&
        e.direction !== null
          ? {
              used: {
                what: e.forgedName,
                direction: e.direction,
                coins: e.coins,
                ...(e.animal !== undefined ? { animal: true as const } : {}),
              },
            }
          : {}),
        ...(!e.deal && e.forgedName !== undefined && e.lack !== undefined
          ? {
              unforged: {
                what: e.forgedName,
                lack: e.lack,
                ...(e.usedItem !== undefined ? { used: true as const } : {}),
                ...(e.animal !== undefined ? { animal: true as const } : {}),
              },
            }
          : {}),
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
    case "consume":
      // Frase propia: no nombra la sustancia (el personaje puede no saber qué es).
      return { kind: "consume", fromLarder: e.from !== null && e.from !== player };
    case "store":
      return {
        kind: "store",
        got: e.got.map((h) => ({ good: h.unit as string, amount: Math.round(h.amount) })),
      };
    case "drop":
      return {
        kind: "drop",
        got: e.got.map((h) => ({ good: h.unit as string, amount: Math.round(h.amount) })),
      };
    case "boil":
      // Hirvió si quemó combustible; el número de gramos no se cuenta.
      return { kind: "boil", boiled: e.fuel !== null && e.grams > 0 };
    case "filter":
      return { kind: "filter", filtered: e.material !== null && e.grams > 0 };
    case "kindle":
      // Si dejó leña en la pila se nota; los gramos no se cuentan.
      return { kind: "kindle", lit: e.hearth !== null, fed: e.moved > 0 };
    case "douse":
      return { kind: "douse", doused: e.hearth !== null };
    case "slaughter":
      // Lo que dejó se ve en la despensa; los gramos no se cuentan.
      return { kind: "slaughter", done: e.done, had: e.animal !== null };
    case "drink":
      return { kind: "drink", drank: e.liters > 0 };
    case "use":
      return {
        kind: "use",
        how: e.how,
        liters: Math.round(e.liters),
        done:
          e.how === "tool.mend"
            ? e.mended === true
            : e.how === "tool.sharpen"
              ? (e.honed ?? 0) > 0
              : e.how === "hearth.warm"
                ? e.warmed === true
                : e.how === "bench.sit"
                  ? e.sat === true
                  : e.liters > 0,
        means:
          e.how === "tool.mend"
            ? e.lack === undefined
            : e.how === "tool.sharpen" || e.how === "hearth.warm"
              ? e.means === true
              : e.how === "bench.sit"
                ? true
                : e.item !== undefined,
        ...(e.lack !== undefined ? { lack: e.lack } : {}),
      };
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
