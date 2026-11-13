// La pista de frases (`play-hint-verbs`, player-loop §10): en vez del autocompletado del navegador,
// una línea con frases que la simulación entiende armadas con lo que el personaje tiene delante y
// conoce («Podés escribir: hablo con mi madre · voy al granero · como algo»), y las palabras para
// completar mientras se escribe: los verbos de la tabla, los nombres que conoce y, con «!», los
// comandos. Todo sale de lo que el personaje cree (`KnownEntity`, las sugerencias), nunca de la verdad.

import type { Suggestion } from "../game/index.ts";
import type { VerbWordBook } from "../llm/index.ts";
import type { KnownEntity } from "../sim/index.ts";

/** Los comandos fuera del personaje que se completan con «!» (los que terminan en espacio piden algo). */
export const COMMANDS: readonly string[] = [
  "!ayuda",
  "!verbos",
  "!personaje",
  "!inventario",
  "!deudas",
  "!gente",
  "!hipótesis",
  "!cielo",
  "!bitácora",
  "!resumen",
  "!pensar sobre ",
  "!qué sé de ",
  "!salir",
];

/** Cómo se escribe cada clase de sugerencia en primera persona (se entiende con la gramática). */
const PHRASES: Readonly<Record<Suggestion["kind"], string>> = {
  drink: "bebo agua",
  eat: "como algo",
  tend: "atiendo mi herida",
  sleep: "duermo hasta que amanezca",
  rest: "descanso una hora",
  work: "trabajo en el campo",
  talk: "hablo con",
  look: "miro alrededor",
  wait: "espero una hora",
  goal: "trabajo de más",
  fight: "le pego a",
};

/** Cómo se dice para qué se sigue la pelea (los modos que la gramática reconoce). */
const FIGHT_PURPOSE: Readonly<
  Record<NonNullable<NonNullable<Suggestion["fight"]>["manner"]>, string>
> = {
  kill: "para matarlo",
  drive_off: "para echarlo",
  escape: "para zafarme",
};

/** Las de una meta (novel-goals-hooks), por el verbo del borrador: «miro a Langdang». */
const GOAL_PHRASES: Readonly<Record<string, string>> = {
  speak: "hablo con",
  look: "miro a",
  work: "trabajo de más",
};

/** La frase escribible de una sugerencia: «hablo con mi madre», «como algo». */
export function suggestionPhrase(s: Suggestion): string {
  if (s.kind === "goal") {
    const node = s.draft.kind === "act" ? s.draft.plan : undefined;
    const verb = node?.kind === "do" ? node.verb : "work";
    const ref = node?.kind === "do" ? node.args.find((a) => "ref" in a) : undefined;
    const who = ref !== undefined && "ref" in ref ? ref.ref.text : undefined;
    const phrase = GOAL_PHRASES[verb] ?? PHRASES.goal;
    return who === undefined ? phrase : `${phrase} ${who}`;
  }
  if (s.fight !== undefined) {
    const base = `${PHRASES.fight} ${s.fight.who}`;
    return s.fight.manner === undefined ? base : `${base} ${FIGHT_PURPOSE[s.fight.manner]}`;
  }
  const phrase = PHRASES[s.kind];
  return s.with === undefined ? phrase : `${phrase} mi ${s.with}`;
}

/** «El granero» → «al granero»; «la plaza» → «a la plaza». */
function toPlace(name: string): string {
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  return /^el\s/u.test(lower) ? `al ${lower.slice(3)}` : `a ${lower}`;
}

export interface Hint {
  /** La línea de frases armadas, o vacía si no hay nada que sugerir. */
  readonly line: string;
  /** Lo que se completa al escribir: verbos y sinónimos, nombres conocidos y comandos con «!». */
  readonly complete: readonly string[];
}

/** Cuántas frases lleva la línea. */
export const HINT_PHRASES = 3;

/**
 * La pista de ahora: hasta `HINT_PHRASES` frases (las sugerencias más salientes, una ida a un lugar
 * que conoce y no tiene delante si queda lugar) y las palabras para completar.
 */
export function hintOf(
  suggestions: readonly Suggestion[],
  known: readonly KnownEntity[],
  words: VerbWordBook | undefined,
): Hint {
  const phrases = [...new Set(suggestions.map(suggestionPhrase))].slice(0, HINT_PHRASES - 1);
  const place = known.find((k) => k.kind === "place" && !k.present && k.names[0] !== undefined);
  if (place) phrases.push(`voy ${toPlace(place.names[0] as string)}`);
  for (const s of suggestions.map(suggestionPhrase)) {
    if (phrases.length >= HINT_PHRASES) break;
    if (!phrases.includes(s)) phrases.push(s);
  }
  const verbs = words
    ? words.entries.flatMap((e) => [...e.forms, ...e.synonyms.flatMap((g) => g.words)])
    : [];
  const names = known.filter((k) => k.kind !== "object").flatMap((k) => k.names.slice(0, 1));
  return {
    line: phrases.length === 0 ? "" : `Podés escribir: ${phrases.join(" · ")}`,
    complete: [...new Set([...verbs, ...names, ...COMMANDS])],
  };
}
