// Frío y calor cableados a la vida (body-health §7): cada día, a intervalos de unas horas, el núcleo
// de cada persona se mueve según el aire de donde está (el del día afuera; adentro, el filtrado por
// paredes y techo), el viento, la lluvia y lo que lleva puesto (`stepCore`). La temperatura vive en
// `THERMAL`, aparte del `Body`, y solo se guarda mientras se aparta de lo normal: con el clima
// templado el proceso no escribe nada. Si el núcleo cruza el umbral muere con causa
// (`hypothermia` / `heatstroke`). Ropa: hasta que haya ítems con aislamiento puestos, la gente se
// viste para la estación (`seasonalClothing`, calibración abierta).

import type { AgentId, PlaceRef, PlanetClock, Seed } from "../../core/index.ts";
import {
  ACTIVITY_LOAD,
  AMPUTATIONS,
  altitudeEnv,
  amputationFactors,
  BODY_STATE,
  type BodyCapabilities,
  type Clothing,
  CORE_NORMAL_C,
  type DayWeather,
  draftEvent,
  ENTITY,
  type EventDraft,
  endEntity,
  FROSTBITE,
  type FrostbiteState,
  frostbiteHandFactor,
  frostbiteMobilityFactor,
  LOCATION,
  type LocalMap,
  NO_FROSTBITE,
  newAmputations,
  outdoorTempC,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type SpaceGraph,
  type StateChange,
  SWEAT,
  setComponent,
  stepCore,
  stepFrostbite,
  THERMAL,
  type ThermalEnv,
  thermalDeath,
  weatherAt,
} from "../../sim/index.ts";
import { INDOOR_BASE_C, INDOOR_LEAK } from "./ambient.ts";

export const THERMAL_PROCESS = "life.thermal";

export interface ThermalOptions {
  readonly clock: PlanetClock;
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly seed: Seed;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Lo que lleva puesto cada uno; por defecto, ropa para la estación. */
  readonly clothingOf?: (truth: ReadonlyWorldTruth, who: AgentId, airC: number) => Clothing;
  /**
   * Ajusta el ambiente de alguien con lo que la sim sabe de su lugar (fuego cercano con
   * `fireRadiantC`, reparo del edificio con `shelterOf`). Por defecto no cambia nada.
   */
  /**
   * Opt-in: acumula congelación por parte (`FROSTBITE`, `stepFrostbite`) con la piel bajo cero.
   * La necrosis amputa la parte (`AMPUTATIONS`, evento `body.amputated`); `applyFrostbite` baja
   * las capacidades en `decide`/`act` (opción `frostbite` de `LifeParts`). Por defecto apagado.
   */
  readonly frostbite?: boolean;
  /**
   * Opt-in: el esfuerzo (`Body.activity`, `ACTIVITY_LOAD` relativo al reposo) entra en `stepCore`
   * como `activityKcal` y el sudor sostenido va a `SWEAT` (el cuerpo lo suma a la sed). Usa la
   * actividad al momento del paso (una vez por día), no el promedio del día. Por defecto apagado:
   * activityKcal 1 y sin sudor extra, la aldea no cambia.
   */
  readonly effort?: boolean;
  /**
   * Opt-in: altitud (m) de quien está y del lugar de referencia del mapa, y `qiC` (°C equivalentes
   * de un ambiente de qi, negativo enfría). El aire se enfría con el gradiente adiabático
   * (`altitudeEnv`) antes de `refineEnv`. Por defecto apagado: la aldea no cambia.
   */
  readonly altitude?: {
    readonly baseM: number;
    readonly altitudeOf: (truth: ReadonlyWorldTruth, who: AgentId) => number;
    readonly qiC?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  };
  readonly refineEnv?: (truth: ReadonlyWorldTruth, who: AgentId, env: ThermalEnv) => ThermalEnv;
}

/** Pasos de cálculo por día (cada uno cubre `day / STEPS_PER_DAY`). */
const STEPS_PER_DAY = 4;
/** Por debajo de esta desviación (°C) del núcleo normal no se guarda fila. */
const NORMAL_BAND_C = 0.5;
/** Horas de cada subpaso de `stepCore` (con pasos largos el Euler explícito oscila). */
const SUBSTEP_H = 0.25;
/** Por debajo de este sudor (L/h) no se guarda fila. */
const MIN_SWEAT_LPH = 0.005;

/**
 * La ropa de quien se viste para lo que ve afuera: más abrigo cuanto más frío, y casi nada con
 * calor. Marcador hasta que la ropa sea ítems puestos con aislamiento.
 */
export function seasonalClothing(airC: number): Clothing {
  const clo = Math.min(3, Math.max(0.5, (24 - airC) / 9));
  return { clo, windproof: clo > 1.5 ? 0.6 : 0.2, coverage: Math.min(1, 0.4 + clo / 3) };
}

/** El ambiente de alguien a un tick: afuera con el viento y la lluvia, adentro con reparo. */
function envOf(day: DayWeather, outC: number, indoor: boolean): ThermalEnv {
  // La gente se refugia de la lluvia: el mojado de la ropa queda para el ítem de ropa puesta.
  const rain = 0;
  return indoor
    ? {
        airC: INDOOR_BASE_C + INDOOR_LEAK * (outC - INDOOR_BASE_C),
        windMs: 0,
        humidity: 0.5,
        wet: 0,
        shelter: 1,
        radiantC: 0,
      }
    : {
        airC: outC,
        windMs: day.windMs,
        humidity: day.precip.kind !== "none" ? 0.9 : 0.5,
        wet: rain,
        shelter: 0,
        radiantC: 0,
      };
}

/**
 * Las capacidades con lo que dejó la congelación: manos y pies con gravedad (`frostbiteHandFactor`,
 * `frostbiteMobilityFactor`) y las partes amputadas, que no vuelven. Sin filas devuelve las mismas.
 */
export function applyFrostbite(
  caps: BodyCapabilities,
  truth: ReadonlyWorldTruth,
  who: AgentId,
): BodyCapabilities {
  const state = truth.get(FROSTBITE, who);
  const lost = amputationFactors(truth.get(AMPUTATIONS, who));
  const hands = (state ? frostbiteHandFactor(state) : 1) * lost.manipulation;
  const feet = (state ? frostbiteMobilityFactor(state) : 1) * lost.locomotion;
  if (hands >= 1 && feet >= 1) return caps;
  return {
    ...caps,
    manipulation: caps.manipulation * hands,
    locomotion: caps.locomotion * feet,
  };
}

export function thermalProcess(o: ThermalOptions): ProcessDef {
  const stepTicks = o.clock.day / STEPS_PER_DAY;
  const hours = 24 / STEPS_PER_DAY;
  return {
    id: THERMAL_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      PERSON.name,
      ENTITY.name,
      BODY_STATE.name,
      THERMAL.name,
      LOCATION.name,
      FROSTBITE.name,
      SWEAT.name,
      AMPUTATIONS.name,
    ],
    writes: [THERMAL.name, ENTITY.name, FROSTBITE.name, SWEAT.name, AMPUTATIONS.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const window = Math.max(stepTicks, Math.min(ctx.window, o.clock.day));
      const n = Math.max(1, Math.round(window / stepTicks));
      for (const id of ctx.truth.ids(PERSON)) {
        const body = ctx.truth.get(BODY_STATE, id);
        const base = ctx.truth.get(ENTITY, id);
        if (!body || !base || base.endedAt !== undefined || body.death) continue;
        const space = ctx.truth.get(LOCATION, id)?.space;
        const node = space === undefined ? undefined : o.spaces.spaces.find((s) => s.key === space);
        const indoor = node?.indoor ?? false;
        const agent = id as AgentId;
        const had = ctx.truth.get(THERMAL, id);
        let core = had?.coreC ?? CORE_NORMAL_C;
        const hydration = Math.max(0, 1 - body.water / Math.max(0.1, 0.05 * body.massKg));
        const hadFrost = o.frostbite ? ctx.truth.get(FROSTBITE, id) : undefined;
        let frost: FrostbiteState | undefined = hadFrost;
        let dead: "hypothermia" | "heatstroke" | null = null;
        const kcal = o.effort ? ACTIVITY_LOAD[body.activity].kcal / ACTIVITY_LOAD.rest.kcal : 1;
        const hadSweat = o.effort ? ctx.truth.get(SWEAT, id) : undefined;
        let sweatL = 0;
        let sweatH = 0;
        for (let k = 0; k < n && dead === null; k++) {
          const at = ctx.now - (n - 1 - k) * stepTicks;
          const outC = outdoorTempC(o.map, o.clock, o.seed, at);
          const flat = envOf(weatherAt(o.map, o.clock, o.seed, at), outC, indoor);
          const base0 = o.altitude
            ? altitudeEnv(
                flat,
                o.altitude.baseM,
                o.altitude.altitudeOf(ctx.truth, agent),
                o.altitude.qiC?.(ctx.truth, agent) ?? 0,
                indoor ? INDOOR_LEAK : 1,
              )
            : flat;
          const env = o.refineEnv ? o.refineEnv(ctx.truth, agent, base0) : base0;
          const clothing = (o.clothingOf ?? ((_t, _w, c) => seasonalClothing(c)))(
            ctx.truth,
            agent,
            outC,
          );
          for (let s = 0; s < hours / SUBSTEP_H && dead === null; s++) {
            const st = stepCore(core, body.massKg, env, clothing, kcal, hydration, SUBSTEP_H);
            core = st.coreC;
            sweatL += st.sweatL;
            sweatH += SUBSTEP_H;
            dead = thermalDeath(core);
            if (o.frostbite) {
              frost = stepFrostbite(frost ?? NO_FROSTBITE, env, clothing, core, SUBSTEP_H, at);
            }
          }
        }
        if (dead !== null) {
          const kd = events.length;
          events.push({
            kind: "body.died",
            actors: [agent],
            place: o.placeOf(ctx.truth, agent),
            data: { cause: dead, coreC: Math.round(core * 10) / 10 },
            emissions: { sight: 0.6, sound: 0.2 },
            causes: [{ kind: "state", entity: agent, key: "body.thermal" }],
          });
          changes.push(
            endEntity(base, draftEvent(kd), ctx.now),
            setComponent(THERMAL, id, { coreC: core, at: ctx.now }),
          );
        } else if (Math.abs(core - CORE_NORMAL_C) > NORMAL_BAND_C) {
          changes.push(setComponent(THERMAL, id, { coreC: core, at: ctx.now }));
        } else if (had) {
          changes.push({ op: "delete", table: THERMAL.name, id });
        }
        if (o.effort) {
          const lph = dead === null && sweatH > 0 ? sweatL / sweatH : 0;
          if (lph >= MIN_SWEAT_LPH) {
            changes.push(setComponent(SWEAT, id, { litersPerHour: lph, at: ctx.now }));
          } else if (hadSweat) {
            changes.push({ op: "delete", table: SWEAT.name, id });
          }
        }
        if (o.frostbite && frost !== hadFrost) {
          if (frost && (frost.hands > 0 || frost.feet > 0 || frost.face > 0)) {
            changes.push(setComponent(FROSTBITE, id, { ...frost, at: ctx.now }));
          } else if (hadFrost) {
            changes.push({ op: "delete", table: FROSTBITE.name, id });
          }
          // Tejido necrosado: la parte se pierde para siempre, con evento que la causa.
          const hadLost = ctx.truth.get(AMPUTATIONS, id);
          const fresh = frost && dead === null ? newAmputations(frost, hadLost) : [];
          if (frost && fresh.length > 0) {
            const lost = [...(hadLost?.lost ?? [])];
            for (const part of fresh) {
              const ke = events.length;
              events.push({
                kind: "body.amputated",
                actors: [agent],
                place: o.placeOf(ctx.truth, agent),
                data: { part, cause: "frostbite", severity: Math.round(frost[part] * 100) / 100 },
                emissions: { sight: 0.4 },
                causes: [{ kind: "state", entity: agent, key: "body.frostbite" }],
              });
              lost.push({ part, at: ctx.now, cause: draftEvent(ke) });
            }
            changes.push(setComponent(AMPUTATIONS, id, { lost }));
          }
        }
      }
      return changes.length > 0 || events.length > 0 ? { changes, events } : {};
    },
  };
}
