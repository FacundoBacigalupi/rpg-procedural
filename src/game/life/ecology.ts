// La ecología de la celda de la aldea día a día (living-world §8, §9): la producción primaria sale
// del tiempo del día y del suelo de los campos, las poblaciones corren la red trófica (la caza de la
// gente va aparte, contra `harvestStock`) y el monte avanza su sucesión de a un año. Cada día deja
// además el peligro de incendio; la chispa que lo vuelve fuego es de un ítem aparte.

import {
  externalAccount,
  holderAccount,
  ledgerUnit,
  type PlaceId,
  type PlanetClock,
  type Seed,
} from "../../core/index.ts";
import {
  advanceSuccession,
  dailyProductivity,
  draftEvent,
  ECOLOGY,
  fireHazard,
  GRAZED,
  HUNT,
  huntStep,
  type LineageDef,
  type LocalMap,
  lineageOf,
  PLACE,
  type ProcessDef,
  type ProcessResult,
  SOIL,
  setComponent,
  type TrajectoryDef,
  trophicStep,
  weatherAt,
} from "../../sim/index.ts";

export const ECOLOGY_PROCESS = "life.ecology";
/** Fuente del ledger de la caza (los animales que salen de la celda) y la carne que deja. */
export const HUNT_SOURCE = "hunt";
export const GAME_UNIT = ledgerUnit("good:venison");
export const HUNTED_EVENT = "wild.hunted";

/** Eventos de chispa esperados por día en el monte (rayo y fogatas sueltas); calibrar con el fuego real. */
export const BASE_SPARK = 0.002;

export interface EcologyOptions {
  readonly clock: PlanetClock;
  readonly map: LocalMap;
  readonly seed: Seed;
  readonly lineages: readonly LineageDef[];
  readonly trajectories: readonly TrajectoryDef[];
  /** Opt-in (`wildHunt`): la gente caza herbívoros de la celda; `effortScale` multiplica el esfuerzo diario. */
  readonly hunt?: { readonly effortScale: number };
  /** Opt-in (livestock-feed-pasture): lo que pastó el ganado (`GRAZED`) no lo comen los herbívoros del monte. */
  readonly grazed?: boolean;
}

/** Cuántos hexes del mapa local cuenta la celda ecológica de la aldea (su zona de caza y monte). */
export function ecologyHexes(map: LocalMap): number {
  return Math.max(1, Math.min(37, map.forest.length));
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function ecologyProcess(o: EcologyOptions): ProcessDef {
  const lineages = Object.fromEntries(o.lineages.map((d) => [d.id, lineageOf(d)]));
  return {
    id: ECOLOGY_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      ECOLOGY.name,
      SOIL.name,
      ...(o.hunt ? [PLACE.name, HUNT.name] : []),
      ...(o.grazed ? [GRAZED.name] : []),
    ],
    writes: [ECOLOGY.name, ...(o.hunt ? [HUNT.name] : [])],
    run(ctx) {
      const [id] = ctx.truth.ids(ECOLOGY);
      const eco = id === undefined ? undefined : ctx.truth.get(ECOLOGY, id);
      if (id === undefined || !eco) return {};
      const days = Math.max(1, ctx.window) / o.clock.day;
      const weather = weatherAt(o.map, o.clock, o.seed, ctx.now);
      const soil = id === undefined ? undefined : ctx.truth.get(SOIL, id);
      const hexes = ecologyHexes(o.map);
      const grown = dailyProductivity({
        tempMeanC: weather.tempMeanC,
        annualPrecipMm: o.map.climate.annualPrecipMm,
        soilFertility: soil?.fertility ?? 1,
        hexes,
      });
      // Lo que pastó el ganado ayer ya no está para el monte.
      const grazed = o.grazed ? (ctx.truth.get(GRAZED, id)?.kgPerDay ?? 0) : 0;
      const productivity = Math.max(0, grown - grazed);
      // Pasos de <= 5 días (estabilidad de la integración); un tramo largo se topa en 60 pasos.
      const steps = Math.min(60, Math.max(1, Math.ceil(days / 5)));
      let cell = { ...eco.cell, productivity };
      for (let i = 0; i < steps; i++) cell = trophicStep(cell, lineages, days / steps).next;
      // La caza de la gente cobra de lo que dejó la depredación; sale con evento, causa y carne en el ledger.
      let hunted: ProcessResult = {};
      const forests = o.hunt
        ? ctx.truth
            .ids(PLACE)
            .filter((p) => ctx.truth.get(PLACE, p)?.kind === "forest")
            .sort()
        : [];
      if (o.hunt && ctx.ledger && forests.length > 0) {
        const prev = ctx.truth.get(HUNT, id);
        const h = huntStep(cell, lineages, prev?.owed ?? {}, days, o.hunt.effortScale);
        cell = h.next;
        const changes = [setComponent(HUNT, id, { owed: h.owed })];
        const killed = Object.values(h.taken).reduce((a, b) => a + b, 0);
        if (killed === 0 || h.grams === 0) hunted = { changes };
        else {
          // La carne se reparte entre los montes; el resto del entero va al primero.
          const each = Math.floor(h.grams / forests.length);
          const transfers = forests.map((p, i) => ({
            unit: GAME_UNIT,
            from: externalAccount(HUNT_SOURCE),
            to: holderAccount({ kind: "place", place: p as unknown as PlaceId }),
            amount: each + (i === 0 ? h.grams - each * forests.length : 0),
          }));
          hunted = {
            changes,
            events: [
              {
                kind: HUNTED_EVENT,
                actors: [],
                place: { kind: "place", place: forests[0] as unknown as PlaceId },
                data: { taken: h.taken, grams: h.grams },
                emissions: {},
                causes: [{ kind: "state", entity: id as never, key: "ecology" }],
              },
            ],
            postings: [{ event: draftEvent(0), transfers }],
          };
        }
      }
      let forest = eco.forest;
      let yearDays = eco.yearDays + days;
      const years = Math.floor(yearDays / 365);
      if (years > 0) {
        yearDays -= years * 365;
        forest = advanceSuccession(forest, { vigor: 1, seedSource: 1, soilDepth: 1 }, years);
      }
      const dryness = weather.precip.kind === "none" ? clamp01(weather.tempMeanC / 30) : 0;
      return {
        changes: [
          setComponent(ECOLOGY, id, {
            cell,
            forest,
            fireHazard: fireHazard(forest, dryness, BASE_SPARK),
            day: eco.day + days,
            yearDays,
          }),
          ...(hunted.changes ?? []),
        ],
        ...(hunted.events ? { events: hunted.events } : {}),
        ...(hunted.postings ? { postings: hunted.postings } : {}),
      };
    },
  };
}
