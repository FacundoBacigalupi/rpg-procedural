// Saltos de tiempo pedidos en palabras (novel-montage-parse, player-loop §4-§5): «paso el
// invierno», «trabajo el campo un mes», «sigo con mi vida hasta la primavera», «dejo pasar tres
// semanas». El pedido se vuelve un plan `routine` de solo esperas (`delegatedPlan`): el personaje
// vive la rutina del hogar hasta la fecha, con las interrupciones fijas. La fecha sale del
// calendario que conoce el personaje (estaciones por la fase del año de su hemisferio). Puro.

import type { AgentId, PlanetClock, Tick } from "../../core/index.ts";
import type { ActionPlan } from "../../sim/index.ts";
import { MAX_ROUTINE_DAYS } from "./life.ts";
import { type SeasonName, seasonOf } from "./weather-panel.ts";

export type SkipTarget =
  | {
      readonly kind: "for";
      readonly amount: number;
      readonly unit: "day" | "week" | "month" | "year";
    }
  /** Hasta que empiece la estación (la próxima vez: si ya es esa estación, la del año que viene). */
  | { readonly kind: "until"; readonly season: SeasonName };

export interface SkipRequest {
  readonly target: SkipTarget;
}

const SEASONS: readonly SeasonName[] = ["spring", "summer", "autumn", "winter"];
const SEASON_WORDS: Readonly<Record<string, SeasonName>> = {
  primavera: "spring",
  verano: "summer",
  otono: "autumn",
  invierno: "winter",
};
const NUMBERS: Readonly<Record<string, number>> = {
  un: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  quince: 15,
  veinte: 20,
  treinta: 30,
};
const UNITS: Readonly<Record<string, "day" | "week" | "month" | "year">> = {
  dia: "day",
  dias: "day",
  semana: "week",
  semanas: "week",
  mes: "month",
  meses: "month",
  ano: "year",
  anos: "year",
};

/** Los verbos de «seguir viviendo»: sin ellos, «espero tres días» sigue siendo una espera. */
const LIVE =
  /^(?:(?:me\s+)?paso|pasar|dejo\s+pasar|dejar\s+pasar|vivo|vivir|sigo\s+(?:con\s+)?(?:mi\s+vida|la\s+rutina|lo\s+de\s+siempre|como\s+siempre|trabajando(?:\s+(?:en\s+)?(?:el\s+campo|la\s+tierra))?)|hago\s+(?:mi\s+vida|lo\s+de\s+siempre)|trabajo\s+(?:en\s+)?(?:el\s+campo|la\s+tierra|los\s+campos)|me\s+dedico\s+(?:al\s+campo|a\s+la\s+tierra|a\s+mi\s+vida))\b/u;

/** Sin tildes ni mayúsculas, salvo la ñ (que distingue «año» de «ano»: se normaliza aparte). */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/ñ/g, "n")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;!¡?¿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** El pedido de saltar tiempo, o `null` si la frase no lo es. */
export function parseSkip(text: string): SkipRequest | null {
  const t = norm(text);
  const lead = LIVE.exec(t);
  if (!lead) return null;
  const rest = t.slice(lead[0].length).trim();
  const seasonWord = "(primavera|verano|otono|invierno)";
  // «hasta la primavera», «hasta la cosecha».
  const until = new RegExp(`\\bhasta (?:la |el )?(?:${seasonWord}|cosecha)\\b`).exec(rest);
  if (until) {
    const season = until[1] === undefined ? "autumn" : SEASON_WORDS[until[1]];
    return season ? { target: { kind: "until", season } } : null;
  }
  // «paso el invierno»: hasta que empiece la estación que le sigue.
  const through = new RegExp(`^(?:todo )?(?:el |la )${seasonWord}\\b`).exec(rest);
  if (through?.[1] !== undefined) {
    const season = SEASON_WORDS[through[1]];
    if (!season) return null;
    return { target: { kind: "until", season: nextSeason(season) } };
  }
  // «paso el año», «un mes», «tres semanas».
  if (/^(?:todo )?el ano\b/.test(rest)) return { target: { kind: "for", amount: 1, unit: "year" } };
  const span =
    /\b(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)\s+(dias?|semanas?|mes(?:es)?|anos?)\b/.exec(
      rest,
    );
  if (span) {
    const word = span[1] as string;
    const amount = /^\d+$/.test(word) ? Number(word) : (NUMBERS[word] ?? 1);
    const unit = UNITS[span[2] as string];
    if (unit === undefined || amount < 1) return null;
    return { target: { kind: "for", amount, unit } };
  }
  return null;
}

export function nextSeason(s: SeasonName): SeasonName {
  return SEASONS[(SEASONS.indexOf(s) + 1) % SEASONS.length] as SeasonName;
}

/**
 * Cuántos ticks dura el salto desde `now`, con el tope de `MAX_ROUTINE_DAYS` y el de `wait`. La estación empieza
 * cuando la fase del año del hemisferio cruza su cuarto (como `seasonOf`).
 */
export function skipTicks(
  target: SkipTarget,
  clock: PlanetClock,
  now: Tick,
  latDeg: number,
  /** El tope del verbo `wait` en el catálogo, si lo hay. */
  waitMax = Number.POSITIVE_INFINITY,
): number {
  const cap = Math.min(MAX_ROUTINE_DAYS * clock.day, waitMax);
  if (target.kind === "for") {
    const per =
      target.unit === "day"
        ? clock.day
        : target.unit === "week"
          ? 7 * clock.day
          : target.unit === "month"
            ? clock.year / 12
            : clock.year;
    return Math.min(cap, Math.round(target.amount * per));
  }
  const phase = (((now % clock.year) + clock.year) % clock.year) / clock.year;
  const local = latDeg >= 0 ? phase : (phase + 0.5) % 1;
  const start = SEASONS.indexOf(target.season) * 0.25;
  let delta = (((start - local) % 1) + 1) % 1;
  if (delta * clock.year < clock.day) delta += 1;
  return Math.min(cap, Math.round(delta * clock.year));
}

/** El plan del salto: esperar `ticks` delegando los días en la rutina del hogar. */
export function skipPlan(actor: AgentId, ticks: number): ActionPlan {
  return {
    actor,
    source: "routine",
    root: { kind: "do", verb: "wait", args: [{ role: "for", seconds: ticks }], manner: [] },
    manner: [],
    causes: [{ kind: "state", entity: actor, key: "intent" }],
  };
}

/** La estación en que cae el tick, para avisar «llegó la primavera». */
export function seasonAt(clock: PlanetClock, t: Tick, latDeg: number): SeasonName {
  return seasonOf((((t % clock.year) + clock.year) % clock.year) / clock.year, latDeg);
}
