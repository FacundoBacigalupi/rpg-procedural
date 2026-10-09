// Errores de quien habla mal (language §12): salen de la distancia entre lo que el hablante sabe
// y la lengua real, no de una tirada abstracta. Cuatro formas: la palabra que no sabe (cae a gestos
// o a un falso amigo de su lengua), el registro equivocado (lo juzga `judgeRegister`), el tono que
// no distingue (dos palabras que solo difieren en el tono) y el falso amigo (una palabra de su
// lengua que suena como otra de la lengua real con otro significado). Todo es puro; el azar viene
// del `Random` con seed que pasa quien llama, y quien escucha decide qué hace con la ofensa.

import { compareStrings, contentId, defineContent, type Random, z } from "../../core/index.ts";
import type { Language } from "./language.ts";
import { judgeRegister, type RegisterSlip, type TabooDef } from "./register.ts";

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Lo que sabe quien habla de la lengua del otro (viene de las facetas de la habilidad, skills §1). */
export interface SpeakerCommand {
  /** 0-1: faceta de hablar. */
  readonly speak: number;
  /** 0-1: cuánto conoce los registros y la cortesía de esa lengua. */
  readonly register: number;
  /** 0-1: cuánto distingue los tonos. */
  readonly tone: number;
  /** Los conceptos que sabe decir en la lengua del otro. */
  readonly vocabulary: ReadonlySet<string>;
}

/** Dos palabras que solo se distinguen por el tono: confundir una con otra cambia lo dicho. */
export interface ToneContrast {
  readonly concepts: readonly string[];
  readonly confusableWith: readonly string[];
  /** 0-1: lo grave de decir la otra (a veces es una grosería). */
  readonly offense: number;
}

/** Una palabra de la lengua propia que suena como otra de la lengua real con otro significado. */
export interface FalseFriend {
  /** El concepto que quiere decir quien habla, en su lengua. */
  readonly nativeConcept: string;
  /** El concepto que significa esa forma en la lengua real. */
  readonly targetConcept: string;
  /** La forma que dice quien habla (la de su lengua). */
  readonly nativeText: string;
  /** La forma real con la que se confunde. */
  readonly targetText: string;
  /** 0-1: cuánto se parecen (1 es idéntica). */
  readonly closeness: number;
  /** 0-1: lo grave de que se entienda lo otro. */
  readonly offense: number;
}

/** Distancia de edición entre dos formas romanizadas. */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(
        Math.min(
          (prev[j] as number) + 1,
          (cur[j - 1] as number) + 1,
          (prev[j - 1] as number) + cost,
        ),
      );
    }
    prev = cur;
  }
  return prev[b.length] as number;
}

/** Parecido 0-1 de dos formas: 1 si son iguales, baja con la distancia relativa a la más larga. */
export function formCloseness(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : clamp01(1 - editDistance(a, b) / longest);
}

/** Parecido mínimo para que dos formas con distinto significado se confundan. */
export const FALSE_FRIEND_CLOSENESS = 0.75;

/**
 * Los falsos amigos entre dos lenguas: raíces de la propia que suenan casi igual a una raíz de la
 * otra que significa otra cosa. `rudeness` da lo grave de que se entienda el concepto de la lengua
 * real (por defecto, nada). Orden determinista: por concepto propio, luego el del otro.
 */
export function findFalseFriends(
  native: Language,
  target: Language,
  rudeness: (targetConcept: string) => number = () => 0,
): FalseFriend[] {
  const out: FalseFriend[] = [];
  const targets = target.roots();
  for (const n of native.roots()) {
    const nativeConcept = n.gloss[0] as string;
    for (const t of targets) {
      const targetConcept = t.gloss[0] as string;
      if (targetConcept === nativeConcept) continue;
      const closeness = formCloseness(n.text, t.text);
      if (closeness < FALSE_FRIEND_CLOSENESS) continue;
      out.push({
        nativeConcept,
        targetConcept,
        nativeText: n.text,
        targetText: t.text,
        closeness,
        offense: clamp01(rudeness(targetConcept)),
      });
    }
  }
  return out.sort(
    (x, y) =>
      compareStrings(x.nativeConcept, y.nativeConcept) ||
      compareStrings(x.targetConcept, y.targetConcept),
  );
}

/** Lo que quiere decir el hablante: las palabras (cada una como conceptos) y el registro usado. */
export interface SpeechPlan {
  readonly words: readonly (readonly string[])[];
  /** Formalidad que pide la situación y la que usa el hablante (0-1, ver `demandedFormality`). */
  readonly demanded: number;
  readonly used: number;
}

export type SpeechError =
  | { readonly kind: "missing-word"; readonly concepts: readonly string[] }
  | { readonly kind: "register"; readonly slip: RegisterSlip }
  | {
      readonly kind: "tone";
      readonly meant: readonly string[];
      readonly said: readonly string[];
      readonly offense: number;
    }
  | { readonly kind: "false-friend"; readonly friend: FalseFriend };

export const SPEECH_ERROR_KINDS = ["missing-word", "register", "tone", "false-friend"] as const;

/** Chance de confundir un tono: nula con oído perfecto, más alta con poco oído y poco habla. */
export function toneSlipChance(c: Pick<SpeakerCommand, "speak" | "tone">): number {
  return clamp01((1 - clamp01(c.tone)) * (1 - 0.3 * clamp01(c.speak)));
}

/** Chance de tirar de una palabra propia que se parece: crece con el parecido y baja con la habla. */
export function falseFriendChance(
  c: Pick<SpeakerCommand, "speak">,
  friend: Pick<FalseFriend, "closeness">,
): number {
  return clamp01(friend.closeness * (1 - clamp01(c.speak)));
}

/**
 * Los errores de una frase. Las palabras que no sabe decir salen como hueco (gesto) o, a veces, como
 * la palabra de su lengua que se parece (falso amigo); las de tono confundible se confunden según
 * su oído; el registro se juzga con lo que conoce. Se consume el `rng` en orden de las palabras.
 */
export function speechErrors(
  command: SpeakerCommand,
  plan: SpeechPlan,
  contrasts: readonly ToneContrast[],
  friends: readonly FalseFriend[],
  rng: Random,
): SpeechError[] {
  const out: SpeechError[] = [];
  const slip = judgeRegister(plan.demanded, plan.used, command.register);
  if (slip) out.push({ kind: "register", slip });
  for (const concepts of plan.words) {
    if (!concepts.every((c) => command.vocabulary.has(c))) {
      const friend =
        concepts.length === 1 ? friends.find((f) => f.nativeConcept === concepts[0]) : undefined;
      if (friend && rng.chance(falseFriendChance(command, friend))) {
        out.push({ kind: "false-friend", friend });
      } else {
        out.push({ kind: "missing-word", concepts });
      }
      continue;
    }
    const contrast = contrasts.find(
      (t) => t.concepts.length === concepts.length && t.concepts.every((c, i) => c === concepts[i]),
    );
    if (contrast && rng.chance(toneSlipChance(command))) {
      out.push({
        kind: "tone",
        meant: concepts,
        said: contrast.confusableWith,
        offense: clamp01(contrast.offense),
      });
    }
  }
  return out;
}

/** Lo ofensivo de un error (0-1); perder una palabra no ofende, solo se entiende menos. */
export function speechErrorOffense(e: SpeechError): number {
  switch (e.kind) {
    case "missing-word":
      return 0;
    case "register":
      return e.slip.size;
    case "tone":
      return e.offense;
    case "false-friend":
      return e.friend.offense;
  }
}

/** Qué parte de lo dicho llega entera (0-1): cada palabra perdida o confundida resta. */
export function intelligibility(plan: SpeechPlan, errors: readonly SpeechError[]): number {
  if (plan.words.length === 0) return 1;
  const lost = errors.filter((e) => e.kind !== "register").length;
  return clamp01(1 - lost / plan.words.length);
}

/** Un par de palabras que solo se distinguen por el tono, como contenido (`content/language-tone/`). */
export const ToneContrastDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  /** La lengua cuyo tono las separa. */
  language: contentId,
  concepts: z.array(contentId).min(1),
  confusableWith: z.array(contentId).min(1),
  /** 0-1: lo grave de decir la otra (a veces es una grosería). */
  offense: z.number().min(0).max(1),
});
export type ToneContrastDef = z.infer<typeof ToneContrastDef>;
export const TONE_CONTRASTS = defineContent("language-tone", ToneContrastDef, (t) => [
  { kind: "languages", id: t.language, at: "language" },
]);

/** Los pares de tono de una lengua, listos para `speechErrors`. */
export function toneContrastsOf(
  defs: readonly ToneContrastDef[],
  language: string,
): ToneContrast[] {
  return defs
    .filter((d) => d.language === language)
    .map((d) => ({
      concepts: d.concepts,
      confusableWith: d.confusableWith,
      offense: d.offense,
    }));
}

/**
 * Lo grosero de un concepto en una cultura (0-1) para `findFalseFriends`: la gravedad del tabú más
 * grave que lo nombra como palabra vedada suelta; lo demás no ofende.
 */
export function tabooRudeness(
  taboos: readonly TabooDef[],
  culture: string,
): (concept: string) => number {
  return (concept) =>
    taboos
      .filter((t) => t.culture === culture && t.concepts.length === 1 && t.concepts[0] === concept)
      .reduce((m, t) => Math.max(m, t.severity), 0);
}
