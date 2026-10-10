// Agua corriente y fosas (body-health §6, "contaminación de lugares"): cadáveres sin enterrar y fosas
// ensucian el tramo de río donde están; el agua arrastra la carga río abajo (se diluye al sumar
// caudal y se asienta con los días) y un pozo junto a un tramo sucio se filtra. Todo puro: sin RNG,
// sin tablas; el llamador decide qué fuentes existen y a qué patógeno corresponden.

import { exp, type Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";

/** Un tramo de río: desemboca en otro (o en el mar/sumidero si `downstream` es null). */
export interface Reach {
  readonly id: string;
  readonly downstream: string | null;
  /** Caudal relativo (>0): más caudal diluye más y arrastra más rápido. */
  readonly flow: number;
  readonly lengthKm: number;
}

/** Algo que ensucia un tramo: un cadáver, una fosa común, una letrina junto al agua. */
export interface CarrionSource {
  readonly id: string;
  readonly reach: string;
  /** Desde cuándo está ahí (tick). */
  readonly since: Tick;
  /** Enterrado fuera del alcance del agua: no ensucia. */
  readonly buried: boolean;
  readonly massKg: number;
  readonly pathogen: string;
  /** El evento que lo dejó ahí (muerte, batalla, fosa). */
  readonly cause: string;
}

/** La carga de un tramo de río (clave: el id del tramo). */
export interface ReachTaint {
  readonly pathogen: string;
  readonly load: number;
  readonly since: Tick;
  readonly cause: string;
}

export const REACH_TAINT = table<ReachTaint>("body.reach_taint");

/** Días hasta que un cadáver deja de aportar (se seca o se lo come la fauna; calibración abierta). */
const CARRION_SPAN_DAYS = 40;
/** Carga por día de un cadáver de 70 kg en su pico (calibración abierta). */
const CARRION_PEAK = 0.12;
/** Cuánto de la carga que baja se aporta como filtración a un pozo vecino (calibración abierta). */
export const SEEPAGE = 0.5;

/**
 * Carga por día que aporta una fuente: sube mientras se descompone (pico a los ~5 días) y baja
 * hasta cero; enterrada no aporta; escala con la masa.
 */
export function carrionShedding(ageDays: number, buried: boolean, massKg: number): number {
  if (buried || ageDays < 0 || ageDays >= CARRION_SPAN_DAYS || massKg <= 0) return 0;
  const rise = Math.min(1, ageDays / 5);
  const fall = 1 - ageDays / CARRION_SPAN_DAYS;
  return CARRION_PEAK * (massKg / 70) * rise * fall;
}

/** Fracción de la carga de un tramo que pasa río abajo en un día (más caudal y tramo corto: más). */
export function carryFraction(r: Reach): number {
  const f = (0.5 * r.flow) / (r.flow + Math.max(0.1, r.lengthKm) * 0.1);
  return Math.min(0.9, Math.max(0, f));
}

/** Fracción que queda de la carga de un tramo tras un día: se asienta y se diluye (calibración abierta). */
const SETTLE_PER_DAY = exp(-Math.LN2 / 3);
const MIN_LOAD = 0.01;

/** Tramos ordenados de aguas arriba a aguas abajo (los ciclos mal armados quedan al final, sin colgarse). */
export function reachOrder(reaches: readonly Reach[]): readonly Reach[] {
  const byId = new Map(reaches.map((r) => [r.id, r]));
  const depth = (r: Reach): number => {
    let d = 0;
    let cur: Reach | undefined = r;
    const seen = new Set<string>();
    while (cur?.downstream != null && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.downstream);
      d += 1;
    }
    return d;
  };
  return [...reaches]
    .map((r) => ({ r, d: depth(r) }))
    .sort((a, b) => b.d - a.d || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0))
    .map((x) => x.r);
}

/**
 * Un día de agua: cada fuente suma carga a su tramo, y cada tramo, de aguas arriba abajo, deja
 * pasar una parte a su desembocadura (diluida por el caudal de ésta) y asienta el resto. Sin
 * fuentes y sin carga devuelve el mapa vacío. El patógeno de un tramo es el de la mayor carga que
 * le llega y la causa la de esa carga.
 */
export function stepWatercourse(
  reaches: readonly Reach[],
  prev: ReadonlyMap<string, ReachTaint>,
  sources: readonly CarrionSource[],
  now: Tick,
  ticksPerDay: number,
): Map<string, ReachTaint> {
  const cur = new Map<string, { pathogen: string; load: number; since: Tick; cause: string }>();
  const add = (id: string, pathogen: string, load: number, since: Tick, cause: string) => {
    if (load <= 0) return;
    const had = cur.get(id);
    if (!had) cur.set(id, { pathogen, load, since, cause });
    else if (load > had.load)
      cur.set(id, { pathogen, load: Math.min(1, had.load + load), since: had.since, cause });
    else cur.set(id, { ...had, load: Math.min(1, had.load + load) });
  };
  for (const [id, t] of prev) add(id, t.pathogen, t.load, t.since, t.cause);
  for (const s of sources) {
    const age = (now - s.since) / ticksPerDay;
    add(s.reach, s.pathogen, carrionShedding(age, s.buried, s.massKg), now, s.cause);
  }
  const byId = new Map(reaches.map((r) => [r.id, r]));
  const out = new Map<string, ReachTaint>();
  const next = new Map<string, { pathogen: string; load: number; since: Tick; cause: string }>();
  for (const r of reachOrder(reaches)) {
    const here = cur.get(r.id);
    const inbound = next.get(r.id);
    const total = [here, inbound].filter((x) => x !== undefined);
    if (total.length === 0) continue;
    const head = total.reduce((a, b) => (b.load > a.load ? b : a));
    const load = Math.min(
      1,
      total.reduce((n, x) => n + x.load, 0),
    );
    const down = r.downstream !== null ? byId.get(r.downstream) : undefined;
    const carried = down ? load * carryFraction(r) * (r.flow / (r.flow + down.flow)) : 0;
    const kept = (load - (down ? load * carryFraction(r) : 0)) * SETTLE_PER_DAY;
    if (down && carried >= MIN_LOAD) {
      const dn = next.get(down.id);
      if (!dn)
        next.set(down.id, {
          pathogen: head.pathogen,
          load: carried,
          since: now,
          cause: head.cause,
        });
      else next.set(down.id, { ...dn, load: Math.min(1, dn.load + carried) });
    }
    if (kept >= MIN_LOAD) {
      out.set(r.id, { pathogen: head.pathogen, load: kept, since: head.since, cause: head.cause });
    }
  }
  // Lo que llegó a un tramo ya visitado no puede ocurrir (orden aguas arriba abajo); los ciclos se descartan.
  return out;
}

/** Carga que un pozo junto a un tramo recibe por filtración (0 si el tramo está limpio). */
export function seepageLoad(reach: ReachTaint | undefined): number {
  return reach ? Math.min(1, reach.load * SEEPAGE) : 0;
}
