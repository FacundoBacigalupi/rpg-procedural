// Las premisas que el personaje arma con lo que tiene delante y en la cabeza, además de las
// creencias de dónde está alguien (information §4, player-loop "Pensar"): las heridas que ve en
// los cuerpos presentes y las huellas del lugar atadas a un hecho que él ya sabe quién hizo. Nada
// sale de la verdad que él no pueda ver: una mancha de sangre sin hecho conocido no dice de quién
// es, y una herida interna no se ve. Puro sobre la verdad de lectura, para poder probarlo a mano.

import type { AgentId, Tick } from "../../core/index.ts";
import {
  BODY_STATE,
  KNOWN_DEEDS,
  LOCATION,
  type Premise,
  type ReadonlyWorldTruth,
  TRACE,
  traceStrength,
  traceVisible,
} from "../../sim/index.ts";

/** Qué tan seguro está de una herida que ve, propia o ajena. */
export const WOUND_SEEN_OWN = 0.9;
export const WOUND_SEEN_OTHER = 0.7;

/** Una herida de corte limpia: no entró mucha suciedad. */
export const CLEAN_CONTAMINATION = 0.5;

/** Desde esta fuerza la huella se lee como reciente. */
export const TRACKS_FRESH_AT = 0.5;

/** El lugar como argumento de una premisa: el hex (y el espacio, si es un sitio cerrado). */
export function placeArg(at: { readonly hex: number; readonly space?: unknown }): string {
  return at.space === undefined ? `hex:${at.hex}` : `hex:${at.hex}/${String(at.space)}`;
}

export function headPremises(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  now: Tick,
  rainSince: (made: Tick) => number = () => 0,
): Premise[] {
  const here = truth.get(LOCATION, me);
  if (here === undefined) return [];
  const out: Premise[] = [];

  // Heridas a la vista: la propia y las de los que están en el mismo lugar.
  for (const id of truth.ids(BODY_STATE)) {
    const at = truth.get(LOCATION, id as AgentId);
    const mine = id === me;
    if (!mine && (at === undefined || at.hex !== here.hex || at.space !== here.space)) continue;
    const wounds = truth.get(BODY_STATE, id as AgentId)?.wounds ?? [];
    const seen = wounds.find(
      (w) =>
        w.kind === "cut" &&
        w.stage !== "healed" &&
        w.internal === 0 &&
        w.contamination < CLEAN_CONTAMINATION,
    );
    if (seen === undefined) continue;
    out.push({
      fact: { pred: "clean_edged_wound", args: [id] },
      confidence: mine ? WOUND_SEEN_OWN : WOUND_SEEN_OTHER,
      kind: "percept",
      ref: `wound:${id}:${seen.id}`,
    });
  }

  // Huellas del lugar atadas a un hecho que él sabe quién hizo.
  const deeds = truth.get(KNOWN_DEEDS, me)?.deeds ?? [];
  const place = placeArg(here);
  for (const tid of truth.ids(TRACE)) {
    const t = truth.get(TRACE, tid);
    if (!t || t.at.hex !== here.hex || t.at.space !== here.space) continue;
    const rain = t.at.space === undefined ? rainSince(t.made) : 0;
    if (!traceVisible(t, now, rain)) continue;
    const deed = deeds.find((d) => d.event === t.event && d.by !== null);
    if (deed === undefined || deed.by === null) continue;
    const strength = traceStrength(t, now, rain);
    out.push({
      fact: { pred: "tracks_of", args: [deed.by, place] },
      confidence: Math.min(0.9, 0.4 + strength / 2),
      kind: "percept",
      ref: `trace:${tid}`,
    });
    if (strength >= TRACKS_FRESH_AT) {
      out.push({
        fact: { pred: "tracks_fresh", args: [place] },
        confidence: 0.9,
        kind: "percept",
        ref: `trace:${tid}`,
      });
    }
  }
  return out;
}
