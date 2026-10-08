// El cielo visible (cosmology §2; Fase 1): sol, lunas y estrellas calculados del reloj del planeta,
// la inclinación del eje y el lugar. Todo sale de la fórmula, sin estado ni azar en el tiempo: el
// mismo tick da el mismo cielo. Lo único que viene del seed es el catálogo de estrellas.
//
// Aproximaciones declaradas: órbita circular (sin ecuación del tiempo), el sol camina por la
// eclíptica a ritmo parejo, las lunas orbitan en el plano de la eclíptica y no hay refracción. Lo
// que falta (eclipses, planetas errantes, cometas, precesión, mareas de qi) está en el ROADMAP.

import {
  acos,
  asin,
  cos,
  floorMod,
  PI,
  type PlanetClock,
  Rng,
  type Seed,
  sin,
  type Tick,
  tan,
} from "../../core/index.ts";

const TAU = 2 * PI;
const RAD = PI / 180;

/** Piso de luz de la noche sin luna (el mismo que usaba `daylight`). */
export const NIGHT_FLOOR = 0.05;
/** Luz que da una luna llena alta sobre el horizonte, sumada al piso (0-1). */
export const FULL_MOON_LIGHT = 0.2;
/** Altura del sol (grados) por debajo de la cual es noche cerrada y por encima de la cual es día. */
const TWILIGHT_FROM_DEG = -8;
const TWILIGHT_TO_DEG = 8;

/** Dónde se mira: latitud y longitud en grados, y el eje del planeta. */
export interface SkyObserver {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly axialTiltDeg: number;
}

/** El observador de un mapa local. */
export function skyObserverOf(map: {
  readonly lonDeg: number;
  readonly climate: { readonly latDeg: number; readonly axialTiltDeg: number };
}): SkyObserver {
  return {
    latDeg: map.climate.latDeg,
    lonDeg: map.lonDeg,
    axialTiltDeg: map.climate.axialTiltDeg,
  };
}

export interface SunState {
  /** Declinación en radianes: sube y baja con el año entre ±inclinación. */
  readonly declination: number;
  /** Ángulo horario en radianes (-π a π): 0 al mediodía solar local. */
  readonly hourAngle: number;
  /** Altura sobre el horizonte, radianes (negativa bajo el horizonte). */
  readonly altitude: number;
  /** Cuánto del día dura el sol arriba (0-1; 0 noche polar, 1 sol de medianoche). */
  readonly dayFraction: number;
}

export interface MoonState {
  readonly index: number;
  /** 0 nueva, 0,5 llena. */
  readonly phase: number;
  /** Fracción iluminada 0-1. */
  readonly illumination: number;
  readonly altitude: number;
}

/** Fase del año con 0 en el equinoccio de primavera del norte (la convención del reloj). */
function yearAngle(clock: PlanetClock, t: Tick): number {
  return (floorMod(t, clock.year) / clock.year) * TAU;
}

/** Ángulo horario del sol en `t` para una longitud: 0 al mediodía local, creciendo hacia la tarde. */
function solarHourAngle(clock: PlanetClock, t: Tick, lonDeg: number): number {
  const shifted = t + Math.round((lonDeg / 360) * clock.day);
  const frac = floorMod(shifted, clock.day) / clock.day; // 0 medianoche
  const h = (frac - 0.5) * TAU;
  return h;
}

function altitudeOf(latRad: number, dec: number, hourAngle: number): number {
  const s = sin(latRad) * sin(dec) + cos(latRad) * cos(dec) * cos(hourAngle);
  return asin(Math.max(-1, Math.min(1, s)));
}

export function sunAt(clock: PlanetClock, obs: SkyObserver, t: Tick): SunState {
  const lat = obs.latDeg * RAD;
  const tilt = obs.axialTiltDeg * RAD;
  const declination = asin(sin(tilt) * sin(yearAngle(clock, t)));
  const hourAngle = solarHourAngle(clock, t, obs.lonDeg);
  const altitude = altitudeOf(lat, declination, hourAngle);
  const c = -tan(lat) * tan(declination); // cos del ángulo horario del orto
  const dayFraction = c <= -1 ? 1 : c >= 1 ? 0 : acos(c) / PI;
  return { declination, hourAngle, altitude, dayFraction };
}

/** El sol por día, en horas locales (0-24) de orto y ocaso; `undefined` si no sale o no se pone. */
export function sunriseSunset(
  clock: PlanetClock,
  obs: SkyObserver,
  t: Tick,
): { readonly rise: number; readonly set: number } | undefined {
  const { dayFraction } = sunAt(clock, obs, t);
  if (dayFraction <= 0 || dayFraction >= 1) return undefined;
  return { rise: 12 - 12 * dayFraction, set: 12 + 12 * dayFraction };
}

export function moonAt(clock: PlanetClock, obs: SkyObserver, moon: number, t: Tick): MoonState {
  const m = clock.moons[moon];
  if (!m) throw new RangeError(`el planeta no tiene la luna ${moon}`);
  const phase = floorMod(t - m.newMoonAt, m.synodicPeriod) / m.synodicPeriod;
  const elong = phase * TAU;
  const lat = obs.latDeg * RAD;
  const tilt = obs.axialTiltDeg * RAD;
  // Longitud eclíptica de la luna: la del sol más su elongación. Orbita en la eclíptica.
  const lon = yearAngle(clock, t) + elong;
  const dec = asin(sin(tilt) * sin(lon));
  // Sale más tarde cada día: su ángulo horario es el del sol menos la elongación.
  const hourAngle = solarHourAngle(clock, t, obs.lonDeg) - elong;
  return {
    index: moon,
    phase,
    illumination: (1 - cos(elong)) / 2,
    altitude: altitudeOf(lat, dec, hourAngle),
  };
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Luz del sol (0-1) por su altura: el crepúsculo es la franja entre -8° y +8°. */
export function sunLight(sun: SunState): number {
  const deg = sun.altitude / RAD;
  const x = (deg - TWILIGHT_FROM_DEG) / (TWILIGHT_TO_DEG - TWILIGHT_FROM_DEG);
  return smooth(Math.max(0, Math.min(1, x)));
}

/** Luz de las lunas (0-1, sin el piso): fase por altura; las más chicas pesan menos. */
export function moonLight(clock: PlanetClock, obs: SkyObserver, t: Tick): number {
  let total = 0;
  for (let i = 0; i < clock.moons.length; i++) {
    const m = moonAt(clock, obs, i, t);
    total += (FULL_MOON_LIGHT * m.illumination * Math.max(0, sin(m.altitude))) / (1 + i);
  }
  return Math.min(FULL_MOON_LIGHT, total);
}

/**
 * Luz del cielo despejado (0-1) a un tick: el sol, y de noche el piso más las lunas. Es el techo
 * de lo que dejan pasar las nubes (`weather.skyLight`).
 */
export function skyBrightness(clock: PlanetClock, obs: SkyObserver, t: Tick): number {
  const day = sunLight(sunAt(clock, obs, t));
  const night = NIGHT_FLOOR + moonLight(clock, obs, t) * (1 - day);
  return day + (1 - day) * night;
}

// ---------------------------------------------------------------------------------------------
// Estrellas: un catálogo mínimo del seed; las constelaciones son de las culturas (language §9).

export interface Star {
  readonly id: number;
  /** Ascensión recta, radianes 0-2π. */
  readonly ra: number;
  /** Declinación, radianes. */
  readonly dec: number;
  /** Brillo 0-1: pocas brillantes y muchas tenues. */
  readonly brightness: number;
  /** Color: 0 rojizo, 0,5 blanco, 1 azulado. */
  readonly hue: number;
}

export const STAR_COUNT = 400;

/** El catálogo del mundo: puntos parejos sobre la esfera y brillos con cola larga. */
export function starCatalog(seed: Seed, count = STAR_COUNT): readonly Star[] {
  const root = Rng.root(seed).fork("sky", "stars");
  const out: Star[] = [];
  for (let id = 0; id < count; id++) {
    const r = root.fork(id);
    const ra = r.float() * TAU;
    const dec = asin(2 * r.float() - 1);
    const u = r.float();
    const u3 = u * u * u;
    const brightness = Math.min(1, 0.04 + 0.96 * u3 * u3);
    out.push({ id, ra, dec, brightness, hue: r.float() });
  }
  return out;
}

export interface SeenStar extends Star {
  readonly altitude: number;
}

/** Las estrellas arriba del horizonte a un tick que se distinguen con la luz de ese momento. */
export function visibleStars(
  stars: readonly Star[],
  clock: PlanetClock,
  obs: SkyObserver,
  t: Tick,
): SeenStar[] {
  const sun = sunAt(clock, obs, t);
  const dark = 1 - skyBrightness(clock, obs, t);
  // Con el cielo claro no se ve ninguna; de noche cerrada, hasta las tenues.
  const floor = 1.05 - dark * 1.02;
  const lat = obs.latDeg * RAD;
  // Tiempo sidéreo local: ascensión recta del sol (aprox. su longitud eclíptica) más su ángulo horario.
  const sunRa = yearAngle(clock, t);
  const lst = sunRa + sun.hourAngle;
  const out: SeenStar[] = [];
  for (const s of stars) {
    if (s.brightness < floor) continue;
    const altitude = altitudeOf(lat, s.dec, lst - s.ra);
    if (altitude > 0) out.push({ ...s, altitude });
  }
  return out;
}
