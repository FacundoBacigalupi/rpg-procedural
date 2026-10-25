// La ropa mojada (body-health §7, clothing-wet): quien está afuera con lluvia, aguanieve o nieve se
// moja la ropa de a poco según cuánto cae; adentro se seca despacio, junto a un fuego encendido
// rápido y afuera sin lluvia según el aire y el viento. El mojado pasa al ambiente de `life.thermal`
// como `wet` (`wetEnv`): la ropa abriga menos y la evaporación se lleva calor. Opt-in (con
// `wardrobe`); el único escritor de `WET_CLOTHES` es `life.wet_clothes`. Con `ford`
// (clothing-wet-river), quien cruza a pie un arroyo, un río o agua quieta fuera de la aldea se moja
// según lo hondo (`FORD_WET`), con un evento `life.waded`.

import type { AgentId, PlaceRef, PlanetClock, Seed, Tick } from "../../core/index.ts";
import {
  BODY_STATE,
  type DayWeather,
  deleteComponent,
  ENTITY,
  type EventDraft,
  HEARTH,
  hexPath,
  LOCATION,
  type LocalMap,
  outdoorTempC,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type SpaceGraph,
  type StateChange,
  setComponent,
  type ThermalEnv,
  table,
  weatherAt,
} from "../../sim/index.ts";

/** Qué tan mojada tiene la ropa (0 seca, 1 empapada). Sin fila, seca. */
export interface WetClothes {
  readonly wet: number;
}
export const WET_CLOTHES = table<WetClothes>("life.wet_clothes");

export const WET_CLOTHES_PROCESS = "life.wet_clothes";

/** Lluvia del día (mm) con la que una hora afuera empapa del todo (sin calibrar). */
export const SOAK_MM = 10;
/** Lo que moja una hora afuera con lluvia de `SOAK_MM` o más. */
export const WET_PER_HOUR = 0.5;
/** Cuánto moja la nieve y el aguanieve frente a la lluvia (se derrite de a poco en la ropa). */
export const PRECIP_WETTING: Readonly<Record<DayWeather["precip"]["kind"], number>> = {
  none: 0,
  rain: 1,
  sleet: 0.7,
  snow: 0.3,
};
/** Lo que se seca por hora adentro, sin fuego. */
export const DRY_INDOOR_PER_HOUR = 0.06;
/** Lo que se seca por hora junto a un fuego encendido (a intensidad 1). */
export const DRY_FIRE_PER_HOUR = 0.35;
/** Lo que se seca por hora afuera sin lluvia a 20 °C sin viento. */
export const DRY_OUTDOOR_PER_HOUR = 0.1;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Lo que se seca por hora afuera sin lluvia: más con calor y viento, casi nada con helada. */
export function outdoorDrying(airC: number, windMs: number): number {
  const warm = clamp01((airC + 5) / 25);
  return DRY_OUTDOOR_PER_HOUR * warm * (1 + Math.min(1, windMs / 8));
}

/** El mojado tras `hours` horas en ese lugar (puro). */
export function wetAfter(
  wet: number,
  hours: number,
  at: {
    readonly outdoors: boolean;
    readonly precip: DayWeather["precip"];
    readonly airC: number;
    readonly windMs: number;
    /** Intensidad del fuego encendido más fuerte en el mismo espacio (0 sin fuego). */
    readonly fire: number;
  },
): number {
  if (!(hours > 0)) return round(clamp01(wet));
  const falling = PRECIP_WETTING[at.precip.kind] * Math.min(1, at.precip.mm / SOAK_MM);
  if (at.outdoors && falling > 0) return round(clamp01(wet + WET_PER_HOUR * falling * hours));
  const dry = at.outdoors
    ? outdoorDrying(at.airC, at.windMs)
    : DRY_INDOOR_PER_HOUR + DRY_FIRE_PER_HOUR * clamp01(at.fire);
  return round(clamp01(wet - dry * hours));
}

/**
 * Lo que moja cruzar a pie cada agua (`LocalMap.water`): el arroyo hasta el tobillo (se pasa por
 * piedras), el río y el agua quieta hasta empaparse. Sin calibrar.
 */
export const FORD_WET: Readonly<Record<number, number>> = { 1: 0.2, 2: 0.9, 3: 1 };
export const WADED_EVENT = "life.waded";

/** El último hex donde lo vio `life.wet_clothes` (para saber qué cruzó desde entonces). */
export interface WetLastHex {
  readonly hex: number;
}
export const WET_LAST_HEX = table<WetLastHex>("life.wet_last_hex");

/**
 * Lo más hondo que vadeó quien fue de `from` a `to` a pie (puro): los hexes del camino sin el de
 * salida, salvo los de la aldea (`settled`, que tiene sus pasos). Devuelve el hex y cuánto moja.
 */
export function fordOf(
  map: LocalMap,
  from: number,
  to: number,
  settled: ReadonlySet<number>,
): { readonly hex: number; readonly wet: number } | undefined {
  if (!map.water) return undefined;
  let best: { hex: number; wet: number } | undefined;
  for (const h of hexPath(map, from, to)) {
    if (settled.has(h)) continue;
    const wet = FORD_WET[map.water[h] ?? 0] ?? 0;
    if (wet > (best?.wet ?? 0)) best = { hex: h, wet };
  }
  return best;
}

export interface WetClothesOptions {
  readonly map: LocalMap;
  readonly clock: PlanetClock;
  readonly seed: Seed;
  readonly spaces: SpaceGraph;
  /** Si los fuegos de `HEARTH` secan (con `hearths`). */
  readonly fires?: boolean;
  /** Vados (clothing-wet-river): dónde se ve un vado en los eventos. */
  readonly ford?: { readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef };
}

/** El fuego encendido más fuerte en el espacio `space` (0 sin fuego). */
function fireIn(truth: ReadonlyWorldTruth, space: string | undefined): number {
  if (space === undefined) return 0;
  let best = 0;
  for (const id of truth.ids(HEARTH)) {
    const h = truth.get(HEARTH, id);
    if (h && h.space === space && h.intensity > best) best = h.intensity;
  }
  return best;
}

/** Cada hora, la ropa de cada persona viva se moja o se seca según dónde está y qué cae. */
export function wetClothesProcess(o: WetClothesOptions): ProcessDef {
  return {
    id: WET_CLOTHES_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "physics",
    reads: [
      WET_CLOTHES.name,
      PERSON.name,
      ENTITY.name,
      BODY_STATE.name,
      LOCATION.name,
      ...(o.fires ? [HEARTH.name] : []),
      ...(o.ford ? [WET_LAST_HEX.name] : []),
    ],
    writes: [WET_CLOTHES.name, ...(o.ford ? [WET_LAST_HEX.name] : [])],
    run(ctx) {
      const settled = new Set(o.spaces.spaces.map((s) => s.hex));
      const events: EventDraft[] = [];
      const hours = Math.max(1, ctx.window) / (o.clock.day / 24);
      const day = weatherAt(o.map, o.clock, o.seed, ctx.now as Tick);
      const airC = outdoorTempC(o.map, o.clock, o.seed, ctx.now as Tick);
      const changes: StateChange[] = [];
      for (const id of [...ctx.truth.ids(PERSON)].sort()) {
        const who = id as AgentId;
        if (ctx.truth.get(ENTITY, who)?.endedAt !== undefined) continue;
        if (ctx.truth.get(BODY_STATE, who)?.death) continue;
        const loc = ctx.truth.get(LOCATION, who);
        if (!loc) continue;
        const outdoors = o.spaces.spaces.find((s) => s.key === loc.space)?.indoor !== true;
        const had = ctx.truth.get(WET_CLOTHES, who)?.wet ?? 0;
        let waded = 0;
        if (o.ford) {
          const last = ctx.truth.get(WET_LAST_HEX, who)?.hex;
          if (last !== loc.hex) changes.push(setComponent(WET_LAST_HEX, who, { hex: loc.hex }));
          const ford = last === undefined ? undefined : fordOf(o.map, last, loc.hex, settled);
          if (ford) {
            waded = ford.wet;
            events.push({
              kind: WADED_EVENT,
              actors: [who],
              place: o.ford.placeOf(ctx.truth, who),
              data: { hex: ford.hex, water: o.map.water?.[ford.hex] ?? 0 },
              emissions: {},
              causes: [{ kind: "state", entity: who as never, key: LOCATION.name }],
            });
          }
        }
        const aired = wetAfter(had, hours, {
          outdoors,
          precip: day.precip,
          airC,
          windMs: day.windMs,
          fire: o.fires && !outdoors ? fireIn(ctx.truth, loc.space) : 0,
        });
        const wet = Math.max(aired, waded);
        if (wet === had) continue;
        changes.push(
          wet > 0 ? setComponent(WET_CLOTHES, who, { wet }) : deleteComponent(WET_CLOTHES, who),
        );
      }
      return changes.length === 0 ? {} : { events, changes };
    },
  };
}

/** `refineEnv` de `life.thermal`: la ropa mojada moja el ambiente de quien la lleva. */
export function wetEnv(truth: ReadonlyWorldTruth, who: AgentId, env: ThermalEnv): ThermalEnv {
  const wet = truth.get(WET_CLOTHES, who)?.wet ?? 0;
  return wet > env.wet ? { ...env, wet } : env;
}
