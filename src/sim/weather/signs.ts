// Señales populares del tiempo (weather §7; weather-forecast-signs): refranes que la gente repite
// («cielo cargado, agua al otro día», «me duelen las rodillas»). Cada señal es una observación de
// HOY (qué se ve, se siente o se oye) más una predicción (llueve / se queda bueno) y NADA más: la
// correlación con el tiempo no se escribe, se mide. `signRecord` corre la señal contra el modelo
// diario (los días ya vividos) y cuenta cuántas veces acertó; las que miran lo que el generador
// hace depender de la lluvia (viento, nubes) aciertan, las que no (colores del cielo, rodillas,
// bochorno, golondrinas) son superstición y el registro lo muestra igual que cualquier otra: la
// gente las cree en los dos casos. Puro y sin estado.

import type { PlanetClock, Rng } from "../../core/index.ts";
import type { ClimateNormals } from "../world/index.ts";
import { type DayWeather, dailyWeather } from "./daily.ts";
import { expectedMeanC } from "./forecast.ts";

export type SignId =
  | "strong_wind"
  | "heavy_sky"
  | "clear_sky"
  | "muggy_air"
  | "red_dusk"
  | "aching_knees"
  | "low_swallows";

/** Qué anuncia la señal: lluvia en los próximos días o que el tiempo se queda bueno. */
export type SignSays = "rain" | "fair";

/** De dónde viene el refrán (culture: rasgos con origen): el oficio o la costumbre que lo inventó. */
export type SignOrigin = "sailors" | "shepherds" | "farmers" | "elders" | "omens";

/** Cuántos días mira hacia adelante un refrán («agua en tres días»). */
export const SIGN_HORIZON_DAYS = 3;

/** Lo que se puede observar un día: el tiempo de ese día y quién lo mira. */
interface Seen {
  readonly weather: DayWeather;
  /** Cuánto se aparta la temperatura del día de lo que toca en la fecha (°C). */
  readonly warmerThanSeason: number;
  readonly root: Rng;
  readonly who: string;
}

export interface SignDef {
  readonly id: SignId;
  readonly says: SignSays;
  readonly origin: SignOrigin;
  readonly shows: (s: Seen) => boolean;
}

/** Una moneda por (señal, quién, día) que no depende del tiempo: lo que no tiene relación con él. */
const coin = (s: Seen, id: SignId, p: number) =>
  s.root.fork("sign", id, s.who, s.weather.day).float() < p;

export const SIGNS: readonly SignDef[] = [
  { id: "strong_wind", says: "rain", origin: "sailors", shows: (s) => s.weather.windMs >= 4 },
  { id: "heavy_sky", says: "rain", origin: "shepherds", shows: (s) => s.weather.cloud >= 0.7 },
  { id: "clear_sky", says: "fair", origin: "farmers", shows: (s) => s.weather.cloud < 0.25 },
  { id: "muggy_air", says: "rain", origin: "farmers", shows: (s) => s.warmerThanSeason > 2 },
  { id: "red_dusk", says: "rain", origin: "omens", shows: (s) => coin(s, "red_dusk", 0.3) },
  {
    id: "aching_knees",
    says: "rain",
    origin: "elders",
    shows: (s) => coin(s, "aching_knees", 0.25),
  },
  { id: "low_swallows", says: "rain", origin: "omens", shows: (s) => coin(s, "low_swallows", 0.3) },
];

const BY_ID: ReadonlyMap<SignId, SignDef> = new Map(SIGNS.map((d) => [d.id, d]));

export function signDef(id: SignId): SignDef {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`señal desconocida: ${id}`);
  return d;
}

function seen(n: ClimateNormals, clock: PlanetClock, root: Rng, who: string, w: DayWeather): Seen {
  return { weather: w, warmerThanSeason: w.tempMeanC - expectedMeanC(n, clock, w.day), root, who };
}

/** Lo que cada señal muestra hoy (el cielo de hoy; nada de mañana). */
export function signsShowing(
  n: ClimateNormals,
  clock: PlanetClock,
  root: Rng,
  who: string,
  today: number,
): readonly SignId[] {
  const s = seen(n, clock, root, who, dailyWeather(n, clock, today, root));
  return SIGNS.filter((d) => d.shows(s)).map((d) => d.id);
}

/** Cuántas veces se mostró una señal y cuántas acertó lo que decía. */
export interface SignRecord {
  readonly id: SignId;
  readonly shown: number;
  readonly hits: number;
  /** Días con la señal en que llovió en el plazo (para medir la ventaja sobre el clima). */
  readonly rainy: number;
  /** Días totales mirados y días en que llovió en el plazo, con o sin señal. */
  readonly days: number;
  readonly rainyDays: number;
}

/**
 * El registro de una señal en los `lookback` días que terminan en `lastDay`: cada día en que se
 * mostró, ¿pasó lo que decía en los `SIGN_HORIZON_DAYS` siguientes? Sólo cuenta días ya cumplidos
 * (el último evaluado es `lastDay - SIGN_HORIZON_DAYS`), que es lo que cualquiera pudo ver vivir ahí.
 */
export function signRecord(
  id: SignId,
  n: ClimateNormals,
  clock: PlanetClock,
  root: Rng,
  who: string,
  lastDay: number,
  lookback: number,
): SignRecord {
  const def = signDef(id);
  const first = lastDay - lookback;
  const end = lastDay - SIGN_HORIZON_DAYS;
  const byDay = new Map<number, DayWeather>();
  for (let d = first; d <= lastDay; d++) byDay.set(d, dailyWeather(n, clock, d, root));
  let shown = 0;
  let hits = 0;
  let rainy = 0;
  let days = 0;
  let rainyDays = 0;
  for (let d = first; d <= end; d++) {
    let willRain = false;
    for (let k = 1; k <= SIGN_HORIZON_DAYS; k++)
      if ((byDay.get(d + k)?.precip.mm ?? 0) > 0) willRain = true;
    days++;
    if (willRain) rainyDays++;
    const w = byDay.get(d);
    if (!w || !def.shows(seen(n, clock, root, who, w))) continue;
    shown++;
    if (willRain) rainy++;
    if (willRain === (def.says === "rain")) hits++;
  }
  return { id, shown, hits, rainy, days, rainyDays };
}

/**
 * Cuánto más (o menos) llueve en el plazo los días en que se muestra la señal que el promedio:
 * `P(llueve | señal) - P(llueve)`. Positivo en las señales de lluvia que valen, ~0 en la
 * superstición, negativo en las de buen tiempo que valen. Es la medida de la correlación.
 */
export function signLift(r: SignRecord): number {
  if (r.shown === 0 || r.days === 0) return 0;
  return r.rainy / r.shown - r.rainyDays / r.days;
}

/** Cuánta fe gana la señal con lo vivido: pocas veces vista no se sabe; si no, por la tasa de aciertos. */
export type SignFaith = "unproven" | "rarely" | "sometimes" | "often";

export const MIN_SIGHTINGS = 6;

export function signFaith(r: SignRecord): SignFaith {
  if (r.shown < MIN_SIGHTINGS) return "unproven";
  const rate = r.hits / r.shown;
  if (rate >= 0.75) return "often";
  if (rate >= 0.5) return "sometimes";
  return "rarely";
}

/**
 * Qué señales conoce una comunidad: un subconjunto estable por lugar (cada pueblo repite unos
 * refranes y no otros). Mismo seed y mismo lugar, mismas señales.
 */
export function knownSigns(root: Rng, place: string, count = 4): readonly SignId[] {
  const r = root.fork("sign-lore", place);
  const scored = SIGNS.map((d) => ({ id: d.id, k: r.fork(d.id).float() }));
  scored.sort((a, b) => a.k - b.k);
  return scored.slice(0, count).map((x) => x.id);
}

/**
 * La lluvia que espera quien se guía por las señales (creencia popular): sale de lo que vale la
 * señal según lo vivido (su tasa de aciertos), no del tiempo que viene. Con la señal más
 * contundente a la vista; sin señales o sin experiencia suficiente, `undefined` y se queda con el
 * clima del lugar.
 */
export function folkRainChance(
  showing: readonly SignId[],
  records: ReadonlyMap<SignId, SignRecord>,
): number | undefined {
  let best: number | undefined;
  for (const id of showing) {
    const r = records.get(id);
    if (!r || r.shown < MIN_SIGHTINGS) continue;
    const rate = r.hits / r.shown;
    const p = signDef(id).says === "rain" ? rate : 1 - rate;
    if (best === undefined || Math.abs(p - 0.5) > Math.abs(best - 0.5)) best = p;
  }
  return best === undefined ? undefined : Math.round(best * 1000) / 1000;
}
