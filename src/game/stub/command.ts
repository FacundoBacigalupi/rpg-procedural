// El parser a mano del stub (player-loop §15, Fase 0): unas pocas frases fijas en castellano en
// vez del LLM. Separa los comandos fuera del personaje (§10), que no tocan el mundo, de los planes
// del personaje. En la Fase 1 lo reemplaza el parser de narration §10.

import { type AgentId, makeId } from "../../core/index.ts";
import { DAY, type StubPlan } from "./world.ts";

export type MetaCommand = "ayuda" | "salir";

export type Command =
  | { readonly kind: "plan"; readonly plan: StubPlan }
  | { readonly kind: "meta"; readonly meta: MetaCommand }
  | { readonly kind: "empty" }
  | { readonly kind: "unknown"; readonly text: string };

const UNITS: Readonly<Record<string, number>> = {
  segundo: 1,
  minuto: 60,
  hora: 3600,
  dia: DAY,
  semana: 7 * DAY,
};

const WORDS: Readonly<Record<string, number>> = { un: 1, una: 1, dos: 2, tres: 3, media: 0.5 };

/** El largo máximo de una espera en un turno: más que eso es una rutina (§5), que llega después. */
export const MAX_WAIT = 365 * DAY;

/** Sin tildes, en minúsculas y con los espacios normalizados. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.!¡¿?,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function amount(word: string): number | undefined {
  if (/^\d+$/.test(word)) return Number(word);
  return WORDS[word];
}

function unit(word: string): number | undefined {
  const singular = word.replace(/s$/, "");
  return UNITS[singular];
}

/** La duración de "2 horas", "un dia", "media hora", "3 semanas"; sin nada, una hora. */
function duration(words: readonly string[]): number | undefined {
  if (words.length === 0) return 3600;
  if (words.length === 1) return unit(words[0] as string);
  if (words.length !== 2) return undefined;
  const n = amount(words[0] as string);
  const u = unit(words[1] as string);
  if (n === undefined || u === undefined) return undefined;
  const seconds = Math.round(n * u);
  return seconds > 0 && seconds <= MAX_WAIT ? seconds : undefined;
}

/** A quién: "aldeano 3" (las etiquetas que muestra la vista del stub). */
function someone(words: readonly string[]): AgentId | undefined {
  if (words.length !== 2 || words[0] !== "aldeano") return undefined;
  const n = amount(words[1] as string);
  return n !== undefined && Number.isSafeInteger(n) && n > 1 ? makeId("agent", n) : undefined;
}

export function parseCommand(text: string): Command {
  const clean = normalize(text);
  if (clean === "") return { kind: "empty" };
  if (clean === "ayuda" || clean === "?") return { kind: "meta", meta: "ayuda" };
  if (clean === "salir") return { kind: "meta", meta: "salir" };

  const words = clean.split(" ");
  const [verb, ...rest] = words;
  const unknown: Command = { kind: "unknown", text };
  switch (verb) {
    case "esperar":
    case "espero": {
      const seconds = duration(rest);
      return seconds === undefined ? unknown : { kind: "plan", plan: { verb: "wait", seconds } };
    }
    case "dormir":
    case "duermo":
      return rest.length === 0
        ? { kind: "plan", plan: { verb: "wait", seconds: 8 * 3600 } }
        : unknown;
    case "mirar":
    case "miro":
      return rest.length === 0 || clean.endsWith("alrededor")
        ? { kind: "plan", plan: { verb: "look" } }
        : unknown;
    case "construir":
    case "construyo": {
      const what = rest.filter((w) => w !== "una");
      return what.length === 1 && what[0] === "choza"
        ? { kind: "plan", plan: { verb: "build" } }
        : unknown;
    }
    case "regalar":
    case "regalo":
    case "dar":
    case "doy": {
      // "regalar 3 monedas a aldeano 4"
      const n = amount(rest[0] ?? "");
      if (n === undefined || !Number.isSafeInteger(n) || n <= 0) return unknown;
      if (!/^monedas?$/.test(rest[1] ?? "") || rest[2] !== "a") return unknown;
      const to = someone(rest.slice(3));
      return to ? { kind: "plan", plan: { verb: "give", to, amount: n } } : unknown;
    }
    default:
      return unknown;
  }
}

export const HELP = [
  "Escribí lo que hace tu personaje. Por ahora se entiende poco:",
  "  esperar [N minutos|horas|días|semanas]   (sin nada, una hora)",
  "  dormir",
  "  mirar",
  "  construir una choza",
  "  regalar N monedas a aldeano K",
  "Fuera del personaje: ayuda, salir.",
].join("\n");
