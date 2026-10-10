/**
 * Proveedor de reuniones del día (body-health §6) desde lo que ya hay en la vida: la fiesta del
 * calendario ritual de la aldea (`villageFestivals`) y el mercado (quienes tienen libro de vendedor
 * en `SELLER_DAY`). Todo en la plaza, al aire libre. Sin RNG propio: la fiesta usa claves del RNG
 * con seed. Sin fiesta ni vendedores no devuelve nada. Los de paso por `Journey` quedan pendientes.
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

export interface GatheringProviderOptions {
  readonly clock: PlanetClock;
  readonly rng: Rng;
}

/** El hex de la plaza: donde está el primer vecino (por id) que tiene espacio; undefined si nadie. */
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
    if (festivals.length === 0 && sellers.length === 0) return [];
    const hex = squareHex(truth);
    if (hex === undefined) return [];
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
    return out;
  };
}
