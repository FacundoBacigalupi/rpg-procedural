// Proponer una hipótesis en texto libre (discovery §14, actions §9): «creo que rinde más de
// verano». El parser deja un `ponder` con las palabras del jugador; acá se traducen al catálogo de
// afirmaciones (`LawClaim`) que el personaje puede formular, y el proceso `life.ponder` llama a
// `proposeHypothesis` (`origin: player`) cuando el evento ocurre, así el replay lo reproduce.
// Lo que el catálogo no permite («de noche», «los lunes») no se formula: no se inventa una
// hipótesis nueva ni se adivina la verdad. La traducción es léxica y determinista, sin red.

import type { AgentId, Event, EventId } from "../../core/index.ts";
import {
  BUCKETS,
  candidateClaims,
  claimId,
  FIELD_YIELD,
  LAW_BELIEFS,
  type LawBelief,
  type LawBeliefs,
  type LawClaim,
  lawKeyId,
  PERSON,
  type ProcessDef,
  priorBelief,
  proposeHypothesis,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";

export const PONDER_PROCESS = "life.ponder";

/** Las estaciones en el orden de los tramos del año (como las muestra el diario). */
const SEASON_WORDS: readonly RegExp[] = [/primavera/, /verano/, /oto[nñ]o/, /invierno/];
/** Las fases de la luna en el orden de sus tramos. */
const MOON_WORDS: readonly RegExp[] = [
  /luna nueva|novilunio/,
  /creciente/,
  /llena|plenilunio/,
  /menguante/,
];

const LOW = /\b(?:menos|peor|flojo|poco|mal)\b/;
const NONE =
  /no (?:depende|tiene (?:nada )?que ver|importa|cambia)|da lo mismo|da igual|es (?:cuesti[oó]n de )?(?:pura )?(?:suerte|azar)|al azar/;
const MORAL =
  /\b(?:cielo|dioses?|castigo|bendici[oó]n|bendecid[oa]|merec\w+|karma|esp[ií]ritus?|maldici[oó]n|destino)\b/;

const normalize = (t: string): string =>
  t
    .toLowerCase()
    .normalize("NFC")
    .replace(/[¿?¡!.,;:«»"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Los tramos que el texto nombra en una lista de palabras, sin repetir y en orden. */
function named(t: string, words: readonly RegExp[]): number[] {
  return words.flatMap((re, k) => (re.test(t) ? [k] : []));
}

/** El par de tramos contiguos del catálogo (`[k, k+1]` con vuelta) que mejor dice lo nombrado. */
function pairFor(buckets: readonly number[], low: boolean): number[] | null {
  if (buckets.length === 0 || buckets.length > 2) return null;
  const first = buckets[0] as number;
  const second = buckets[1];
  let high: number[];
  if (second === undefined) {
    // Un solo tramo nombrado: ese y el que sigue (alto), o los dos que le siguen (si es lo bajo).
    high = low ? [(first + 1) % BUCKETS, (first + 2) % BUCKETS] : [first, (first + 1) % BUCKETS];
  } else {
    const adjacent =
      (second - first + BUCKETS) % BUCKETS === 1 || (first - second + BUCKETS) % BUCKETS === 1;
    if (!adjacent) return null;
    const pair = (second - first + BUCKETS) % BUCKETS === 1 ? [first, second] : [second, first];
    high = low ? [(pair[1] as number) + 1, (pair[1] as number) + 2].map((k) => k % BUCKETS) : pair;
  }
  return high.sort((a, b) => a - b);
}

/**
 * La afirmación del catálogo que dicen las palabras del jugador sobre qué hace rendir al campo,
 * o `null` si no se deja formular con lo que el personaje puede pensar.
 */
export function claimOfText(text: string): LawClaim | null {
  const t = normalize(text);
  const seasons = named(t, SEASON_WORDS);
  const moons = named(t, MOON_WORDS);
  const low = LOW.test(t);
  let claim: LawClaim | null = null;
  if (seasons.length > 0 && moons.length === 0) {
    const high = pairFor(seasons, low);
    claim = high ? { kind: "depends", on: "season", high } : null;
  } else if (moons.length > 0 && seasons.length === 0) {
    const high = pairFor(moons, low);
    claim = high ? { kind: "depends", on: "moon", high } : null;
  } else if (seasons.length === 0 && moons.length === 0) {
    if (NONE.test(t)) claim = { kind: "none" };
    else if (MORAL.test(t)) claim = { kind: "moral" };
  }
  if (claim === null) return null;
  const id = claimId(FIELD_YIELD, claim);
  return candidateClaims(FIELD_YIELD).find((c) => claimId(FIELD_YIELD, c) === id) ?? null;
}

/** Lo supuesto en un `action.ponder` del personaje (resolve): las palabras tal cual. */
export function ponderedText(e: Event): { who: AgentId; about: string } | undefined {
  if (e.kind !== "action.ponder") return undefined;
  const who = e.actors[0] as AgentId | undefined;
  const about = (e.data as { effect?: { kind?: string; about?: unknown } } | null)?.effect;
  if (!who || about?.kind !== "ponder" || typeof about.about !== "string") return undefined;
  return { who, about: about.about };
}

export function ponderProcess(): ProcessDef {
  const keyId = lawKeyId(FIELD_YIELD);
  return {
    id: PONDER_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [LAW_BELIEFS.name, PERSON.name],
    writes: [LAW_BELIEFS.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const rows = new Map<AgentId, LawBeliefs>();
      for (const e of ctx.recent) {
        const p = ponderedText(e);
        if (!p || !ctx.truth.get(PERSON, p.who)) continue;
        const claim = claimOfText(p.about);
        if (claim === null) continue;
        const row = rows.get(p.who) ?? ctx.truth.get(LAW_BELIEFS, p.who);
        const belief: LawBelief =
          row?.beliefs[keyId] ??
          priorBelief(FIELD_YIELD, ctx.rng.fork("discovery", p.who, keyId, "prior"), e.tick);
        const next: LawBeliefs = {
          beliefs: {
            ...(row?.beliefs ?? {}),
            [keyId]: proposeHypothesis(belief, claim, e.id as EventId),
          },
          originEventId: row?.originEventId ?? e.id,
        };
        rows.set(p.who, next);
      }
      for (const [id, r] of rows) changes.push(setComponent(LAW_BELIEFS, id, r));
      return changes.length === 0 ? {} : { changes };
    },
  };
}
