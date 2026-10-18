// Lectura posterior a la corrida: ventanas del reloj de oscilación, sin inferir causalidad
// de una coincidencia temporal ni estimar personas-año desde dos fotos de población.
import { compareStrings, type Event, type PlanetClock } from "../../core/index.ts";
import type { OscillationYear } from "../../sim/index.ts";

export interface OscillationMeasurementOptions {
  readonly from: number;
  readonly to: number;
  readonly clock: Pick<PlanetClock, "day" | "year">;
  readonly yearOf: (day: number) => OscillationYear | undefined;
  readonly population: readonly { readonly tick: number; readonly livingPeople: number }[];
}

/** Todas las fechas son ticks absolutos; el intervalo observado es (from, to]. */
export function profileOscillation(
  events: readonly Event[],
  options: OscillationMeasurementOptions,
) {
  const { from, to, clock } = options;
  const yearDays = Math.round(clock.year / clock.day);
  const yearTicks = yearDays * clock.day;
  if (
    ![from, to, clock.day, yearTicks].every(Number.isSafeInteger) ||
    from < 0 ||
    to < from ||
    clock.day <= 0 ||
    yearTicks <= 0
  ) {
    throw new RangeError("intervalo o reloj inválido para medir oscilación");
  }
  const relevant = events
    .filter(
      (e) =>
        e.tick > from &&
        e.tick <= to &&
        (e.kind === "weather.drought" ||
          e.kind === "weather.flood" ||
          e.kind.startsWith("famine.") ||
          (e.kind === "body.died" && (e.data as { cause?: unknown }).cause === "starvation")),
    )
    .sort((a, b) => a.tick - b.tick || compareStrings(a.id, b.id));
  const firstYear = Math.floor(from / yearTicks);
  const lastYear = Math.floor(to / yearTicks);
  const rows = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const start = year * yearTicks;
    const end = start + yearTicks;
    const state = options.yearOf(year * yearDays);
    const observed = relevant.filter((e) => e.tick >= start && e.tick < end);
    const record = (e: Event) => ({
      id: e.id,
      tick: e.tick,
      kind: e.kind,
      place: e.place,
      data: e.data,
      causes: e.causes,
    });
    rows.push({
      year,
      basin: state?.cause.basin ?? null,
      oscillation: state ?? null,
      observedFrom: Math.max(from, start),
      observedTo: Math.min(to, end),
      observedDays: Math.max(0, Math.min(to, end) - Math.max(from, start)) / clock.day,
      weather: observed.filter((e) => e.kind.startsWith("weather.")).map(record),
      hunger: observed.filter((e) => e.kind.startsWith("famine.")).map(record),
      starvationDeaths: observed.filter((e) => e.kind === "body.died").map(record),
      populationSnapshots: options.population
        .filter((p) => p.tick >= Math.max(from, start) && p.tick <= Math.min(to, end))
        .map((p) => ({ ...p })),
    });
  }
  return {
    interval: { fromExclusive: from, toInclusive: to },
    populationExposure: "snapshots_only_not_person_days" as const,
    attribution: "temporal_context_only_explicit_causes_preserved" as const,
    rows,
  };
}
