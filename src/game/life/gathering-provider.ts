/**
 * Proveedor de reuniones del dÃ­a (body-health Â§6) desde lo que ya hay en la vida: la fiesta del
 * calendario ritual de la aldea (`villageFestivals`) y el mercado (quienes tienen libro de vendedor
 * en `SELLER_DAY`). Todo en la plaza, al aire libre. Sin RNG propio: la fiesta usa claves del RNG
 * con seed. Sin fiesta ni vendedores no devuelve nada. Los de paso y el templo entran por `transit`/`temple` (opt-in).
 */

import type { PlanetClock, Rng, Tick } from "../../core/index.ts";
import {
  ENTITY,
  LOCATION,
  PERSON,
  type ReadonlyWorldTruth,
  SELLER_DAY,
  VILLAGE_SQUARE,
} from "../../sim/index.ts";
import { villageFestivals } from "./festival.ts";
import type { Gathering, HourWindow } from "./gathering.ts";

/** Horas locales de la fiesta y del mercado en la plaza. */
export const FESTIVAL_WINDOW: HourWindow = { from: 10, to: 16 };
export const MARKET_WINDOW: HourWindow = { from: 8, to: 12 };

/** Quien está de paso (posada, posta) y cuándo: `place` es la clave `hex|espacio` donde para. */
export interface TransitStop {
  readonly place: string;
  readonly open: boolean;
  readonly visitors: ReadonlyMap<string, HourWindow>;
}

/** Un servicio del templo: horas de la jornada y quiénes asisten (el templo es cerrado). */
export interface TempleService {
  readonly place: string;
  readonly window: HourWindow;
  readonly attendees: readonly string[];
}

export interface GatheringProviderOptions {
  readonly clock: PlanetClock;
  readonly rng: Rng;
  /** Opt-in: viajeros de paso (de `Journey`) del día; sin esto no hay cambios. */
  readonly transit?: (truth: ReadonlyWorldTruth, now: Tick) => readonly TransitStop[];
  /** Opt-in: servicios del templo con horario real. */
  readonly temple?: (truth: ReadonlyWorldTruth, now: Tick) => readonly TempleService[];
}

/** Reuniones de paso y de templo, puras: un viajero comparte horas solo con quien coincide en la ventana. */
export function extraGatherings(
  stops: readonly TransitStop[],
  services: readonly TempleService[],
): Gathering[] {
  const out: Gathering[] = [];
  for (const s of stops) {
    if (s.visitors.size > 1) out.push({ place: s.place, open: s.open, visits: s.visitors });
  }
  for (const t of services) {
    if (t.attendees.length > 1) {
      out.push({
        place: t.place,
        open: false,
        visits: new Map([...t.attendees].sort().map((a) => [a, t.window] as const)),
      });
    }
  }
  return out;
}

/** El hex de la plaza: donde estÃ¡ el primer vecino (por id) que tiene espacio; undefined si nadie. */
function squareHex(truth: ReadonlyWorldTruth): string | undefined {
  for (const id of [...truth.ids(PERSON)].sort()) {
    const loc = truth.get(LOCATION, id as never);
    if (loc?.space !== undefined) return String(loc.hex);
  }
  return undefined;
}

export function gatheringsFor(
  o: GatheringProviderOptions,
): (truth: ReadonlyWorldTruth, now: Tick) => readonly Gathering[] {
  return (truth, now) => {
    const day = Math.floor(now / o.clock.day);
    const festivals = villageFestivals(truth, day, o.rng);
    const sellers = [...truth.ids(SELLER_DAY)]
      .sort()
      .filter((id) => truth.get(ENTITY, id as never)?.endedAt === undefined);
    const extra = extraGatherings(o.transit?.(truth, now) ?? [], o.temple?.(truth, now) ?? []);
    if (festivals.length === 0 && sellers.length === 0) return extra;
    const hex = squareHex(truth);
    if (hex === undefined) return extra;
    const place = `${hex}|${VILLAGE_SQUARE}`;
    const out: Gathering[] = [];
    for (const f of festivals) {
      out.push({
        place,
        open: true,
        visits: new Map(f.attendees.map((a) => [a as string, FESTIVAL_WINDOW] as const)),
      });
    }
    if (sellers.length > 0) {
      out.push({
        place,
        open: true,
        visits: new Map(sellers.map((s) => [s as string, MARKET_WINDOW] as const)),
      });
    }
    return [...out, ...extra];
  };
}
