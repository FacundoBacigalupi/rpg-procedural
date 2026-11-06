import { describe, expect, it } from "vitest";
import type { PlanetClock } from "../../core/index.ts";
import { MAX_ROUTINE_DAYS } from "./life.ts";
import { delegatedPlan } from "./routine.ts";
import { nextSeason, parseSkip, seasonAt, skipPlan, skipTicks } from "./skip.ts";

const DAY = 86_400;
const clock = { day: DAY, year: 360 * DAY } as PlanetClock;

describe("saltos de tiempo en palabras (novel-montage-parse)", () => {
  it("entiende estaciones, la cosecha y lapsos con verbos de seguir viviendo", () => {
    expect(parseSkip("Paso el invierno")?.target).toEqual({ kind: "until", season: "spring" });
    expect(parseSkip("paso todo el otoño.")?.target).toEqual({ kind: "until", season: "winter" });
    expect(parseSkip("sigo con mi vida hasta la primavera")?.target).toEqual({
      kind: "until",
      season: "spring",
    });
    expect(parseSkip("trabajo el campo hasta la cosecha")?.target).toEqual({
      kind: "until",
      season: "autumn",
    });
    expect(parseSkip("trabajo en el campo un mes")?.target).toEqual({
      kind: "for",
      amount: 1,
      unit: "month",
    });
    expect(parseSkip("dejo pasar tres semanas")?.target).toEqual({
      kind: "for",
      amount: 3,
      unit: "week",
    });
    expect(parseSkip("vivo dos años")?.target).toEqual({ kind: "for", amount: 2, unit: "year" });
    expect(parseSkip("paso el año")?.target).toEqual({ kind: "for", amount: 1, unit: "year" });
    expect(parseSkip("hago lo de siempre 10 días")?.target).toEqual({
      kind: "for",
      amount: 10,
      unit: "day",
    });
  });

  it("no toma lo que no es un salto: esperas, horas, otras frases", () => {
    expect(parseSkip("espero tres días")).toBeNull();
    expect(parseSkip("trabajo en el campo hasta que anochezca")).toBeNull();
    expect(parseSkip("trabajo en el campo dos horas")).toBeNull();
    expect(parseSkip("paso por la plaza")).toBeNull();
    expect(parseSkip("voy al campo")).toBeNull();
  });

  it("la fecha: hasta el comienzo de la estación (la del año que viene si ya es esa), con topes", () => {
    // Fase 0 del norte = comienzo de la primavera.
    expect(seasonAt(clock, 0, 30)).toBe("spring");
    expect(skipTicks({ kind: "until", season: "summer" }, clock, 0, 30)).toBe(90 * DAY);
    expect(skipTicks({ kind: "until", season: "spring" }, clock, 0, 30)).toBe(360 * DAY);
    expect(skipTicks({ kind: "until", season: "spring" }, clock, 10 * DAY, 30)).toBe(350 * DAY);
    // En el sur las estaciones van corridas medio año.
    expect(seasonAt(clock, 0, -30)).toBe("autumn");
    expect(skipTicks({ kind: "until", season: "winter" }, clock, 0, -30)).toBe(90 * DAY);
    expect(skipTicks({ kind: "for", amount: 3, unit: "week" }, clock, 0, 30)).toBe(21 * DAY);
    expect(skipTicks({ kind: "for", amount: 1, unit: "month" }, clock, 0, 30)).toBe(30 * DAY);
    const long = { year: 500 * DAY, day: DAY } as PlanetClock;
    expect(skipTicks({ kind: "for", amount: 2, unit: "year" }, long, 0, 30)).toBe(
      MAX_ROUTINE_DAYS * DAY,
    );
    expect(skipTicks({ kind: "for", amount: 1, unit: "year" }, clock, 0, 30, 100 * DAY)).toBe(
      100 * DAY,
    );
    expect(nextSeason("winter")).toBe("spring");
  });

  it("el plan del salto es un plan delegado", () => {
    const plan = skipPlan("agent:1" as never, 7 * DAY);
    expect(plan.source).toBe("routine");
    expect(delegatedPlan({ done: false, plan })).toBe(true);
  });
});
