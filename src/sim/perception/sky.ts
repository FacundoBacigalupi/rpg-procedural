// Lo que se ve de lejos en el cielo (novel2-trib-far-sight, perception §12): un prodigio grande
// (las nubes de una tribulación, sus rayos) llega a los de otros hexes, no solo a los del mismo. De
// tan lejos no se ve a nadie: llega que hay algo y qué es (`presence` y `action`), sin figura ni
// identidad, con una chance que cae con la distancia en km y se lee con la vista y la atención de
// cada uno. El mismo hex sigue siendo de `perceive` (con el grafo de espacios y todo lo demás).
//
// Puro: recibe la fuente, los observadores con su distancia en hexes y el tamaño del hex.

import type { EventId, Rng, Tick } from "../../core/index.ts";
import { type Observer, type Percept, readChance } from "./percept.ts";

/** Hasta cuántos km se ve un prodigio en el cielo (sin calibrar). */
export const SKY_SIGHT_KM = 12;
/** A cuántos km la señal cae a la mitad (sin calibrar). */
export const SKY_HALF_KM = 5;
/** Señal sobre legibilidad en la fuente para quien mira con atención normal (sin calibrar). */
export const SKY_SIGNAL = 6;

export interface SkySource {
  readonly event: EventId;
  readonly tick: Tick;
  /** Qué se ve (el tipo del evento). */
  readonly verb: string;
}

/** Un observador lejos de la fuente, a `hexes` hexes (1 o más). */
export interface SkyWatcher {
  readonly observer: Observer;
  readonly hexes: number;
}

/** Los hexes alrededor de `from`, de 1 a `radius` pasos, con su distancia (BFS por los vecinos). */
export function hexesAround(
  neighbors: readonly (readonly number[])[],
  from: number,
  radius: number,
): Map<number, number> {
  const out = new Map<number, number>([[from, 0]]);
  let ring = [from];
  for (let d = 1; d <= radius && ring.length > 0; d++) {
    const next: number[] = [];
    for (const h of ring)
      for (const n of neighbors[h] ?? [])
        if (!out.has(n)) {
          out.set(n, d);
          next.push(n);
        }
    ring = next;
  }
  out.delete(from);
  return out;
}

/** Cuántos hexes de radio da `SKY_SIGHT_KM` con hexes de `kmPerHex`. */
export const skyRadius = (kmPerHex: number): number =>
  kmPerHex > 0 ? Math.max(1, Math.floor(SKY_SIGHT_KM / kmPerHex)) : 0;

/** La chance de ver el prodigio a `km` con esta vista y atención. */
export function skyChance(km: number, sight: number, attention: number): number {
  if (km > SKY_SIGHT_KM) return 0;
  const r = km / SKY_HALF_KM;
  return readChance((SKY_SIGNAL * sight * attention) / (1 + r * r));
}

/** Lo que leen de lejos los observadores: presencia y qué es, vago, por quien lo vio. */
export function skyPercepts(
  source: SkySource,
  observers: readonly SkyWatcher[],
  kmPerHex: number,
  rng: Rng,
): Percept[] {
  const out: Percept[] = [];
  const sorted = [...observers].sort((a, b) =>
    a.observer.id < b.observer.id ? -1 : a.observer.id > b.observer.id ? 1 : 0,
  );
  for (const { observer, hexes } of sorted) {
    if (hexes < 1) continue;
    const p = skyChance(hexes * kmPerHex, observer.acuity.sight, observer.attention);
    const roll = rng.fork("sky", source.event, observer.id).float();
    if (p <= 0 || roll >= p) continue;
    const confidence = Math.round(p * 1e6) / 1e6;
    out.push({
      id: `${source.event}@${source.tick}/${observer.id}`,
      observer: observer.id,
      sourceEventId: source.event,
      tick: source.tick,
      channels: ["sight"],
      detail: "vague",
      fields: {
        presence: { value: true, confidence, mistaken: false },
        action: { value: source.verb, confidence, mistaken: false },
      },
    });
  }
  return out;
}
