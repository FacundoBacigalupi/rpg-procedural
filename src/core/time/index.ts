// Tiempo de la simulación (ARCHITECTURE §4.2, simulation §1).
//
// La verdad usa ticks absolutos en segundos. El día, el año y las lunas son del planeta (planet-gen
// los calcula y los guarda en un `PlanetClock`), así que acá no hay nada de la Tierra salvo un reloj
// de referencia para tests y herramientas. El calendario de este módulo es el de la verdad: días que
// empiezan a medianoche del meridiano 0 y años trópicos exactos, con bisiestos que salen solos de la
// fracción de días del año. Los calendarios de las culturas (meses, eras, fiestas, errores de
// cómputo) son creencia y se construyen arriba de esto (culture, weather §6, living-world §5).
//
// Todo es aritmética entera exacta: ni floats en las fechas ni redondeos que dependan del motor.

/** Segundos absolutos desde el origen del mundo (entero seguro). */
export type Tick = number;

/** Segundos. */
export type Duration = number;

/** Alias: algunos docs dicen Time; es lo mismo que Tick. */
export type Time = Tick;

// Unidades físicas. La hora y el minuto son los del SI: si el día del planeta no dura 24 h, el día
// tiene otra cantidad de horas (los relojes de cada cultura dividen su día como quieren).
export const SECOND: Duration = 1;
export const MINUTE: Duration = 60;
export const HOUR: Duration = 3600;

export interface MoonClock {
  /** De luna nueva a luna nueva, en segundos. */
  readonly synodicPeriod: Duration;
  /** Un tick de luna nueva (cualquiera; la fase sale del período). */
  readonly newMoonAt: Tick;
}

/**
 * El reloj del planeta (planet-gen §0). En el tick 0 empieza el año 0 y el día 0, y la fase del año
 * 0 es el punto que planet-gen elige como inicio (el equinoccio de primavera del norte).
 */
export interface PlanetClock {
  /** Día solar medio, en segundos. */
  readonly day: Duration;
  /** Año trópico (de una estación a la misma), en segundos. */
  readonly year: Duration;
  /** Lunas, de la más grande a la más chica. Puede no haber ninguna. */
  readonly moons: readonly MoonClock[];
}

/** Valida un reloj: períodos enteros positivos y un año de al menos un día. */
export function planetClock(clock: PlanetClock): PlanetClock {
  positive("day", clock.day);
  positive("year", clock.year);
  if (clock.year < clock.day) throw new RangeError(`año más corto que el día: ${clock.year}`);
  clock.moons.forEach((m, i) => {
    positive(`moons[${i}].synodicPeriod`, m.synodicPeriod);
    assertTick(m.newMoonAt);
  });
  return { day: clock.day, year: clock.year, moons: clock.moons.map((m) => ({ ...m })) };
}

/** Reloj de referencia parecido a la Tierra (día de 24 h, año trópico, una luna). Para tests. */
export const EARTHLIKE_CLOCK: PlanetClock = planetClock({
  day: 86_400,
  year: 31_556_925, // 365,24219 días
  moons: [{ synodicPeriod: 2_551_443, newMoonAt: 0 }], // 29,53059 días
});

export function assertTick(t: Tick): Tick {
  if (!Number.isSafeInteger(t)) throw new RangeError(`tick inválido: ${t}`);
  return t;
}

/** División entera hacia −∞, exacta para enteros seguros (incluidos los negativos). */
export function floorDiv(a: number, b: number): number {
  // a − resto es múltiplo exacto de b: el cociente en double queda a menos de medio entero.
  return Math.round((a - floorMod(a, b)) / b);
}

/** Resto con el signo del divisor: siempre en [0, b). Para reducir fases antes de la trigonometría. */
export function floorMod(a: number, b: number): number {
  const r = a % b; // `%` es exacto en IEEE 754
  return r < 0 ? r + b : r === 0 ? 0 : r;
}

function ceilDiv(a: number, b: number): number {
  return -floorDiv(-a, b);
}

// ---------------------------------------------------------------------------------------------
// Calendario de la verdad

export interface CalendarDate {
  /** Año trópico desde el origen (0, 1, 2…; negativo antes del origen). */
  readonly year: number;
  /** Día del año desde 0. Un día pertenece al año en que empieza su medianoche. */
  readonly dayOfYear: number;
  /** Segundos desde la medianoche del meridiano 0. */
  readonly secondOfDay: number;
}

/** Número de día absoluto: los días empiezan a medianoche en múltiplos de `clock.day`. */
export function dayNumber(clock: PlanetClock, t: Tick): number {
  return floorDiv(assertTick(t), clock.day);
}

/** Primer día cuya medianoche cae en el año `year` o después de su comienzo. */
export function firstDayOfYear(clock: PlanetClock, year: number): number {
  return ceilDiv(year * clock.year, clock.day);
}

/** Días del año: `floor` o `ceil` de los días por año; los largos son los bisiestos. */
export function daysInYear(clock: PlanetClock, year: number): number {
  return firstDayOfYear(clock, year + 1) - firstDayOfYear(clock, year);
}

export function toCalendar(clock: PlanetClock, t: Tick): CalendarDate {
  const day = dayNumber(clock, t);
  const year = floorDiv(day * clock.day, clock.year);
  return {
    year,
    dayOfYear: day - firstDayOfYear(clock, year),
    secondOfDay: t - day * clock.day,
  };
}

export function fromCalendar(clock: PlanetClock, date: CalendarDate): Tick {
  const { year, dayOfYear, secondOfDay } = date;
  if (!Number.isSafeInteger(year)) throw new RangeError(`año inválido: ${year}`);
  if (!Number.isSafeInteger(dayOfYear) || dayOfYear < 0 || dayOfYear >= daysInYear(clock, year)) {
    throw new RangeError(`día ${dayOfYear} fuera del año ${year}`);
  }
  if (!Number.isSafeInteger(secondOfDay) || secondOfDay < 0 || secondOfDay >= clock.day) {
    throw new RangeError(`segundo del día fuera de rango: ${secondOfDay}`);
  }
  return assertTick((firstDayOfYear(clock, year) + dayOfYear) * clock.day + secondOfDay);
}

/** "año 3, día 41, 06:30:00" (día desde 1). Para el inspector y los logs, no para el narrador. */
export function formatTick(clock: PlanetClock, t: Tick): string {
  const { year, dayOfYear, secondOfDay } = toCalendar(clock, t);
  const h = Math.floor(secondOfDay / HOUR);
  const m = Math.floor((secondOfDay % HOUR) / MINUTE);
  const s = secondOfDay % MINUTE;
  return `año ${year}, día ${dayOfYear + 1}, ${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ---------------------------------------------------------------------------------------------
// Fases: el año (estaciones), el día y las lunas. En [0, 1).

/** Fase de la órbita: 0 es el inicio del año trópico; las estaciones se leen de acá. */
export function yearPhase(clock: PlanetClock, t: Tick): number {
  return floorMod(assertTick(t), clock.year) / clock.year;
}

/** Fase del día en el meridiano 0: 0 es medianoche, 0,5 mediodía medio. */
export function dayPhase(clock: PlanetClock, t: Tick): number {
  return floorMod(assertTick(t), clock.day) / clock.day;
}

/** Fase de una luna: 0 nueva, 0,5 llena. */
export function moonPhase(clock: PlanetClock, moon: number, t: Tick): number {
  const m = moonOf(clock, moon);
  return floorMod(assertTick(t) - m.newMoonAt, m.synodicPeriod) / m.synodicPeriod;
}

/** Cuántas lunas nuevas pasaron desde la de referencia (para calendarios lunares). */
export function lunation(clock: PlanetClock, moon: number, t: Tick): number {
  const m = moonOf(clock, moon);
  return floorDiv(assertTick(t) - m.newMoonAt, m.synodicPeriod);
}

// ---------------------------------------------------------------------------------------------
// Escalas y ventanas (simulation §1, §2): cada proceso corre por ventanas de su escala, y el índice
// de la ventana entra en la clave del rng (`rng.fork(system, process, scope, windowIndex)`).

export type TimeScale =
  | "instant" // segundos: intercambios de combate, una frase, un gesto
  | "scene" // minutos: una conversación, una sesión de oficio paso a paso
  | "hour"
  | "day"
  | "season"
  | "year"
  | "decade"
  | "epoch"; // un siglo por ventana; solo en historia (deep-history: embudo)

export const TIME_SCALES: readonly TimeScale[] = [
  "instant",
  "scene",
  "hour",
  "day",
  "season",
  "year",
  "decade",
  "epoch",
];

/**
 * Cómo se corta el tiempo en ventanas: de largo fijo, o `parts` partes del año que no dejan
 * huecos (las estaciones son cuartos de la órbita aunque el año no sea divisible por 4).
 */
type WindowRule =
  | { readonly kind: "fixed"; readonly length: Duration }
  | { readonly kind: "yearParts"; readonly parts: number };

function windowRule(clock: PlanetClock, scale: TimeScale): WindowRule {
  switch (scale) {
    case "instant":
      return { kind: "fixed", length: SECOND };
    case "scene":
      return { kind: "fixed", length: MINUTE };
    case "hour":
      return { kind: "fixed", length: HOUR };
    case "day":
      return { kind: "fixed", length: clock.day };
    case "season":
      return { kind: "yearParts", parts: 4 };
    case "year":
      return { kind: "fixed", length: clock.year };
    case "decade":
      return { kind: "fixed", length: 10 * clock.year };
    case "epoch":
      return { kind: "fixed", length: 100 * clock.year };
  }
}

/** Índice de la ventana de la escala que contiene a `t`. */
export function windowIndex(clock: PlanetClock, scale: TimeScale, t: Tick): number {
  assertTick(t);
  const rule = windowRule(clock, scale);
  if (rule.kind === "fixed") return floorDiv(t, rule.length);
  const n = rule.parts;
  const q = floorDiv(t, clock.year);
  const s = t - q * clock.year;
  // La parte r empieza en floor(r·año/n): la última que empieza en s o antes.
  return q * n + floorDiv(n * (s + 1) - 1, clock.year);
}

/** Primer tick de la ventana `index`. */
export function windowStart(clock: PlanetClock, scale: TimeScale, index: number): Tick {
  if (!Number.isSafeInteger(index)) throw new RangeError(`índice de ventana inválido: ${index}`);
  const rule = windowRule(clock, scale);
  if (rule.kind === "fixed") return assertTick(index * rule.length);
  const n = rule.parts;
  const q = floorDiv(index, n);
  return assertTick(q * clock.year + floorDiv((index - q * n) * clock.year, n));
}

/** Duración exacta de la ventana `index` (las estaciones pueden diferir en un segundo). */
export function windowDuration(clock: PlanetClock, scale: TimeScale, index: number): Duration {
  return windowStart(clock, scale, index + 1) - windowStart(clock, scale, index);
}

function moonOf(clock: PlanetClock, moon: number): MoonClock {
  const m = clock.moons[moon];
  if (!m) throw new RangeError(`el planeta no tiene la luna ${moon}`);
  return m;
}

function positive(name: string, n: number): void {
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new RangeError(`${name} debe ser entero positivo: ${n}`);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
