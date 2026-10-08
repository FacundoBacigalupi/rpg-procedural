import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, HOUR } from "../../core/index.ts";
import {
  moonAt,
  NIGHT_FLOOR,
  type SkyObserver,
  skyBrightness,
  starCatalog,
  sunAt,
  sunriseSunset,
  visibleStars,
} from "./sky.ts";

const clock = EARTHLIKE_CLOCK;
const DAY = clock.day;
const YEAR = clock.year;
const temperate: SkyObserver = { latDeg: 45, lonDeg: 0, axialTiltDeg: 23.4 };
const DEG = 180 / Math.PI;

describe("sol", () => {
  it("culmina al mediodía local y está bajo el horizonte a medianoche", () => {
    const noon = sunAt(clock, temperate, 100 * DAY + DAY / 2);
    const night = sunAt(clock, temperate, 100 * DAY);
    expect(noon.altitude).toBeGreaterThan(0.5);
    expect(night.altitude).toBeLessThan(0);
  });

  it("el verano del norte tiene días más largos que el invierno, y al sur al revés", () => {
    const summerN = sunAt(clock, temperate, Math.round(YEAR * 0.25)).dayFraction;
    const winterN = sunAt(clock, temperate, Math.round(YEAR * 0.75)).dayFraction;
    expect(summerN).toBeGreaterThan(0.6);
    expect(winterN).toBeLessThan(0.4);
    const south = { ...temperate, latDeg: -45 };
    expect(sunAt(clock, south, Math.round(YEAR * 0.25)).dayFraction).toBeCloseTo(winterN, 6);
  });

  it("en los equinoccios el día dura la mitad en cualquier latitud", () => {
    for (const latDeg of [0, 30, 60]) {
      const f = sunAt(clock, { ...temperate, latDeg }, 0).dayFraction;
      expect(f).toBeCloseTo(0.5, 2);
    }
  });

  it("la altura del mediodía en el solsticio es 90° - lat + inclinación", () => {
    const t = Math.round(YEAR * 0.25) - (Math.round(YEAR * 0.25) % DAY) + DAY / 2;
    const alt = sunAt(clock, temperate, t).altitude * DEG;
    expect(alt).toBeGreaterThan(90 - 45 + 23.4 - 1);
    expect(alt).toBeLessThan(90 - 45 + 23.4 + 0.1);
  });

  it("hay noche polar y sol de medianoche cerca del polo", () => {
    const polar = { ...temperate, latDeg: 80 };
    expect(sunAt(clock, polar, Math.round(YEAR * 0.75)).dayFraction).toBe(0);
    expect(sunAt(clock, polar, Math.round(YEAR * 0.25)).dayFraction).toBe(1);
    expect(sunriseSunset(clock, polar, Math.round(YEAR * 0.25))).toBeUndefined();
  });

  it("orto y ocaso son simétricos al mediodía", () => {
    const r = sunriseSunset(clock, temperate, 30 * DAY);
    expect(r).toBeDefined();
    if (r) expect(r.rise + r.set).toBeCloseTo(24, 6);
  });

  it("la longitud corre la hora del mediodía", () => {
    const east = { ...temperate, lonDeg: 90 };
    const t = 50 * DAY + DAY / 2; // mediodía en el meridiano 0
    expect(sunAt(clock, east, t).hourAngle).toBeGreaterThan(sunAt(clock, temperate, t).hourAngle);
  });
});

describe("lunas", () => {
  const moon = (t: number) => moonAt(clock, temperate, 0, t);
  const P = clock.moons[0]?.synodicPeriod ?? 1;

  it("la fase sigue el período y la luna llena está iluminada", () => {
    expect(moon(0).illumination).toBeCloseTo(0, 6);
    expect(moon(Math.round(P / 2)).illumination).toBeCloseTo(1, 3);
    expect(moon(Math.round(P)).phase).toBeLessThan(0.001);
  });

  it("la luna llena sale cuando se pone el sol y está alta a medianoche", () => {
    const fullMidnight = Math.round(P / 2) - (Math.round(P / 2) % DAY); // medianoche, cerca de la llena
    const alts = [];
    for (let k = 0; k < 3; k++) alts.push(moon(fullMidnight + k * DAY).altitude);
    expect(Math.max(...alts)).toBeGreaterThan(0.2);
  });

  it("la luna nueva sale y se pone con el sol: no ilumina de noche", () => {
    expect(moon(0 + DAY / 2).altitude).toBeGreaterThan(0.3);
    expect(moon(0 + DAY / 2 + 12 * HOUR).altitude).toBeLessThan(0);
  });

  it("pide una luna que no existe: error", () => {
    expect(() => moonAt(clock, temperate, 3, 0)).toThrow(RangeError);
  });
});

describe("luz del cielo", () => {
  const bright = (t: number, o = temperate) => skyBrightness(clock, o, t);

  it("de día plena y de noche con piso; entre medio crece sin saltos", () => {
    const base = 80 * DAY;
    expect(bright(base + DAY / 2)).toBeCloseTo(1, 1);
    expect(bright(base)).toBeGreaterThanOrEqual(NIGHT_FLOOR);
    let prev = bright(base);
    for (let s = 0; s <= DAY; s += 600) {
      const b = bright(base + s);
      expect(Math.abs(b - prev)).toBeLessThan(0.15);
      prev = b;
    }
  });

  it("las noches con luna alumbran más que las sin luna, a lo largo del mes", () => {
    const P = clock.moons[0]?.synodicPeriod ?? 1;
    const midnights: number[] = [];
    for (let d = 0; d < Math.ceil(P / DAY); d++) midnights.push(bright((200 + d) * DAY));
    expect(Math.max(...midnights)).toBeGreaterThan(NIGHT_FLOOR + 0.05);
    expect(Math.min(...midnights)).toBeLessThan(NIGHT_FLOOR + 0.01);
  });

  it("es determinista y siempre entre 0 y 1", () => {
    for (let d = 0; d < 400; d += 7) {
      const b = bright(d * DAY + 3 * HOUR);
      expect(b).toBe(bright(d * DAY + 3 * HOUR));
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
});

describe("estrellas", () => {
  const stars = starCatalog(7);

  it("el catálogo sale del seed y es estable", () => {
    expect(starCatalog(7)).toEqual(stars);
    expect(starCatalog(8)).not.toEqual(stars);
    expect(stars.length).toBe(400);
    const bright = stars.filter((s) => s.brightness > 0.5).length;
    expect(bright).toBeGreaterThan(0);
    expect(bright).toBeLessThan(stars.length / 4);
  });

  it("de día no se ve ninguna y de noche cerrada se ve una buena parte", () => {
    const noon = 120 * DAY + DAY / 2;
    expect(visibleStars(stars, clock, temperate, noon).length).toBe(0);
    const night = visibleStars(stars, clock, temperate, 120 * DAY);
    expect(night.length).toBeGreaterThan(20);
    expect(night.every((s) => s.altitude > 0)).toBe(true);
  });

  it("el cielo gira: unas horas después de la medianoche se ven otras", () => {
    const a = new Set(visibleStars(stars, clock, temperate, 120 * DAY - 3 * HOUR).map((s) => s.id));
    const b = visibleStars(stars, clock, temperate, 120 * DAY + 2 * HOUR).map((s) => s.id);
    expect(b.some((id) => !a.has(id))).toBe(true);
    expect(b.some((id) => a.has(id))).toBe(true);
  });

  it("las estaciones cambian qué constelaciones se ven a la medianoche", () => {
    const winter = new Set(visibleStars(stars, clock, temperate, 0).map((s) => s.id));
    const summer = visibleStars(stars, clock, temperate, Math.floor(YEAR / 2 / DAY) * DAY).map(
      (s) => s.id,
    );
    const overlap = summer.filter((id) => winter.has(id)).length;
    expect(overlap).toBeLessThan(summer.length * 0.8);
  });
});
