// Heridas viejas que se reabren (body-health §5): una carencia (`DeficiencyEffects.reopenWound`, la
// falta de vitamina C) suma una probabilidad diaria de que una herida cerrada o cerrándose vuelva a
// abrirse. Puro: el azar sale de un `Rng` con clave que pasa el llamador (el de la persona), y acá se
// bifurca por tick y herida, así agregar una herida no corre las tiradas de las otras.

import { pow, type Rng, type Tick } from "../../core/index.ts";
import type { Body, Wound } from "./state.ts";

const DAY_SECONDS = 86_400;

/** Qué le pasa a la herida al reabrirse: vuelve a inflamarse y sangra poco; lo cerrado se pierde en parte. */
function reopened(w: Wound): Wound {
  return {
    ...w,
    stage: "inflamed",
    repair: Math.min(w.repair, 0.25),
    bleeding: Math.max(w.bleeding, 0.03),
  };
}

/**
 * Tira la reapertura de cada herida vieja (`healing` o `healed`) en una ventana de `windowSeconds`
 * que termina en `now`. `perDay` es la probabilidad diaria; en la ventana se prorratea. Devuelve el
 * cuerpo y los ids de las heridas reabiertas (sin cambios si ninguna). Con `perDay <= 0` no tira.
 */
export function reopenOldWounds(
  body: Body,
  perDay: number,
  windowSeconds: number,
  now: Tick,
  rng: Rng,
): { readonly body: Body; readonly reopened: readonly Wound[] } {
  if (perDay <= 0 || windowSeconds <= 0) return { body, reopened: [] };
  const p = 1 - pow(1 - Math.min(perDay, 1), windowSeconds / DAY_SECONDS);
  const out: Wound[] = [];
  const wounds = body.wounds.map((w) => {
    if (w.stage !== "healing" && w.stage !== "healed") return w;
    if (!rng.fork("reopen", now, w.id).chance(p)) return w;
    const n = reopened(w);
    out.push(n);
    return n;
  });
  return out.length === 0 ? { body, reopened: [] } : { body: { ...body, wounds }, reopened: out };
}
