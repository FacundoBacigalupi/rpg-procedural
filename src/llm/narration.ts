// El pedido al narrador (narration §5, §7, §12): sale solo de `PlayerView`, el único muro con la
// verdad. Lleva el modo (escena, acción, diálogo), lo que hay que nombrar sí o sí (`mustMention`),
// lo que se puede nombrar (`mayMention`), la paleta de ambiente y el estilo. El prompt del sistema
// depende solo del estilo, así que el runtime lo cachea entre turnos; lo variable (el pedido en
// JSON) va al final.

import type { LocalLabel, PlayerView } from "../game/index.ts";
import type { NarrationPrefs } from "./config.ts";
import type { ContinuityView } from "./continuity.ts";
import { type LexiconView, MOOD_TONE, REGISTER_TONE, type VoiceView } from "./voice.ts";

export type NarrationMode =
  | "scene"
  | "action"
  | "dialogue"
  | "introspection"
  | "montage"
  | "dream"
  | "aftermath";

/** El estilo de un pedido (narration §7): las preferencias del usuario más el idioma de salida. */
export interface StyleSettings extends NarrationPrefs {
  readonly language: "es" | "en";
}

export interface NarrationRequest {
  readonly view: PlayerView;
  readonly mode: NarrationMode;
  /** Ids locales que la narración tiene que nombrar con una referencia marcada. */
  readonly mustMention: readonly string[];
  /** Ids locales que puede nombrar: todas las etiquetas de la vista. */
  readonly mayMention: readonly string[];
  /** Texturas sin consecuencias que puede usar (narration §8). */
  readonly ambience: readonly string[];
  readonly style: StyleSettings;
  /** Lo ya narrado y cómo se nombró a cada uno (narration §6); falta en el primer turno. */
  readonly continuity?: ContinuityView;
  /** Cómo habla y mira el personaje (narration §4); falta si no se conoce. */
  readonly voice?: VoiceView;
  /** Los términos técnicos que conoce y los que dice con otras palabras. */
  readonly vocabulary?: LexiconView;
}

/** El modo sale de lo que pasó: un golpe es acción; lo dicho, diálogo; el resto, escena. */
export function narrationMode(view: PlayerView): NarrationMode {
  // El sueño y el salto de tiempo mandan sobre todo; la secuela, salvo que haya golpes o habla.
  if (view.mode === "dream" || view.mode === "montage") return view.mode;
  if (view.mode === "aftermath" && !view.outcomes.some((o) => o.effect.kind === "strike")) {
    return "aftermath";
  }
  if (view.outcomes.some((o) => o.effect.kind === "strike")) return "action";
  if (
    view.outcomes.some((o) => o.effect.kind === "speak") ||
    view.percepts.some((p) => p.words !== undefined)
  ) {
    return "dialogue";
  }
  if (view.thoughts.length > 0) return "introspection";
  return "scene";
}

/** A quién nombra cada resultado propio. */
function outcomeRefs(view: PlayerView): string[] {
  const out: string[] = [];
  for (const o of view.outcomes) {
    const e = o.effect;
    if ("target" in e && e.target !== undefined) out.push(e.target);
    if (e.kind === "speak" && e.to !== undefined) out.push(e.to);
    if (e.kind === "trade" && e.with !== undefined) out.push(e.with);
    if (e.kind === "take" && e.from !== undefined) out.push(e.from);
  }
  return out;
}

/** Lo que no se puede callar: a quién apuntó el personaje y lo que percibió con claridad. */
export function mustMentionOf(view: PlayerView): string[] {
  const ids = new Set(outcomeRefs(view));
  for (const t of view.thoughts) {
    if (t.about !== undefined) ids.add(t.about);
    for (const w of t.conclusion?.who ?? []) ids.add(w);
  }
  for (const p of view.percepts) {
    if (p.detail !== "vague" || p.action !== undefined || p.words !== undefined) ids.add(p.who);
  }
  return view.labels.map((l) => l.localId).filter((id) => ids.has(id));
}

export function styleOf(prefs: NarrationPrefs, language: "es" | "en"): StyleSettings {
  return { ...prefs, language };
}

export function narrationRequest(
  view: PlayerView,
  style: StyleSettings,
  ambience: readonly string[] = [],
  character: { readonly voice?: VoiceView; readonly vocabulary?: LexiconView } = {},
): NarrationRequest {
  return {
    ...(character.voice !== undefined ? { voice: character.voice } : {}),
    ...(character.vocabulary !== undefined ? { vocabulary: character.vocabulary } : {}),
    view,
    mode: narrationMode(view),
    mustMention: mustMentionOf(view),
    mayMention: view.labels.map((l) => l.localId),
    ambience: [...ambience],
    style,
  };
}

const PERSON = {
  second: "second person",
  first: "first person",
  third: "third person",
} as const;

const DETAIL = {
  brief: "Keep it short: one or two sentences.",
  normal: "Keep it to a short paragraph.",
  rich: "You may write up to three paragraphs.",
} as const;

/** Las reglas fijas del narrador: el prefijo que se cachea (narration §12). Solo cambia con el estilo. */
export function narratorSystem(style: StyleSettings): string {
  const lang = style.language === "es" ? "Rioplatense Spanish" : "English";
  return [
    "You narrate a life in a simulated fantasy world to the person who plays it.",
    `Write in ${lang}, ${PERSON[style.person]}, ${style.tense} tense${style.language === "es" && style.voseo ? ", with voseo" : ""}.`,
    "The request is JSON with what the character perceived and believes happened this turn.",
    "Narrate only that. Never add people, objects, places, names or numbers that are not in the",
    "request. Never decide outcomes, never foreshadow, never talk to the player as a game.",
    "- `outcomes` are the character's own steps as they believe they went: tell them that way.",
    "- An outcome's `purpose.motive` is why the character says they did it (their own word, not a",
    "  fact): you may quote it in passing, never explain it, never add another reason, and never",
    "  say it was true. `purpose.forWhom` is the label id of whom it was done for.",
    "- `percepts` are what reached their senses. A vague percept is only a shape or a sound: do",
    "  not tell who it is. A label with `known: false` is a stranger: describe it by its figure.",
    "- Every time you name a labelled person, write it as {{id|words}}, for example",
    "  {{e2|el viejo}} or {{e1|tu madre}}. Use only the ids in `labels`. Every id in",
    "  `mustMention` has to appear at least once. Names may appear only if they are in `lexicon`",
    "  or in a label's `name`.",
    "- `continuity` is text the player already read. Do not repeat it. Keep what `established`",
    "  says about a label (how it was named); change it only if the request shows a change.",
    "- `thoughts` are what the character remembers, ponders or feels (mode `introspection`): write",
    "  it from inside, quiet and slow, with little description of the surroundings. Say only the",
    "  `mood` given; do not invent memories, causes or facts about the person they think of. A",
    "  thought with `hazy: true` is a blurred memory: say it is unclear, never as plain fact. A thought",
    "  of kind `conclude` is what the character worked out: say its `conclusion` (`pred` about the",
    "  people in `who`) with the certainty of its `band` (convinced, likely, maybe, hunch), as their own",
    "  inner voice; if there is a `rival`, they also doubt it; `because` is the kind of evidence, cite",
    "  it in passing. Never add a reason, a fact or a person that is not there, and never say it is true.",
    "- `tastes` are things the character likes or dislikes, each with its `stance`: mention at most",
    "  one, in passing, with that exact feeling. Never invent why they like it or who it recalls.",
    "- `dues` are a debt or promise the character remembers (`direction` i-owe: they owe `who`; owed-to-me:",
    "  `who` owes them), `overdue` or `soon`: mention it in passing. Say `what` as given, never an amount",
    "  or date; if `sure` is false, say they do not remember it well.",
    "- Mode `dream`: the character is asleep; broken images of the `thoughts`, nothing new. Mode",
    "  `montage`: time passed; one short paragraph, no scene detail; `stretch` is what the character",
    "  lived in it (`days`, `did` verbs with `times` and `failed`, `spoke` people, `hurt`, `fought`):",
    "  say only that, in broad strokes, never an amount or a detail that is not there. Mode `aftermath`: after",
    "  something grave; the body, the silence, what is left; no explanation of why.",
    "- `vocabulary.use` are the technical words the character knows. For each `vocabulary.avoid`",
    "  entry, never write its `term`: say what the character sees (`say`) instead.",
    "- `voice` is how the character speaks and notices: `register` sets the words, `trade` what they",
    "  notice first, `mood` colors only the tone. Never add facts because of the mood.",
    "- `ambience` are textures you may use; you may also leave them out.",
    "- Quote heard words exactly as in `words` or `text`.",
    DETAIL[style.detail],
    "Answer only with the narration.",
  ].join("\n");
}

/** Cómo conviene nombrar a una etiqueta (lo que el narrador puede usar en la marca). */
function labelHint(l: LocalLabel): Record<string, unknown> {
  return {
    id: l.localId,
    ...(l.name !== undefined ? { name: l.name } : {}),
    ...(l.relation !== undefined ? { relation: l.relation } : {}),
    ...(l.figure !== undefined ? { figure: `${l.figure.sex} ${l.figure.age}` } : {}),
    known: l.known,
    certainty: l.certainty,
  };
}

/** El mensaje variable de cada turno: el pedido en JSON compacto, en orden fijo. */
export function narratorUserMessage(request: NarrationRequest): string {
  const v = request.view;
  return JSON.stringify({
    mode: request.mode,
    scene: v.scene,
    self: v.self.cues,
    outcomes: v.outcomes,
    ...(v.thoughts.length > 0 ? { thoughts: v.thoughts } : {}),
    ...(v.tastes.length > 0 ? { tastes: v.tastes } : {}),
    ...(v.dues.length > 0 ? { dues: v.dues } : {}),
    ...(v.stretch !== undefined ? { stretch: v.stretch } : {}),
    percepts: v.percepts,
    labels: v.labels.map(labelHint),
    lexicon: v.lexicon,
    mustMention: request.mustMention,
    ambience: request.ambience,
    ...(request.voice !== undefined
      ? {
          voice: {
            ...request.voice,
            register: REGISTER_TONE[request.voice.register],
            ...(request.voice.mood !== undefined ? { mood: MOOD_TONE[request.voice.mood] } : {}),
          },
        }
      : {}),
    ...(request.vocabulary !== undefined ? { vocabulary: request.vocabulary } : {}),
    ...(request.continuity !== undefined ? { continuity: request.continuity } : {}),
  });
}
