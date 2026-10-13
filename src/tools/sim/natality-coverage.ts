// Cobertura dirigida de natalidad (perfil2c-natality). Opt-in del tooling: sin `natality` el perfil
// completo no cambia. No inventa estado: las parejas son las que ya existen y el parto, el nacimiento
// y la crianza salen de los procesos normales (`life.conception`, `life.labor`, `life.birth`); solo se
// acelera la curva de fecundidad y se acorta la gestación para que el ciclo entero entre en un
// horizonte corto, antes de que la hambruna del perfil (starvation) se lleve a las madres.
import type { LifeOptions } from "../../game/index.ts";

/** Multiplicador de la fecundidad de la curva demográfica (todas las bandas fértiles de 15 a 44 años pasan a tasa >= 1: la pareja elegible concibe el primer día). */
export const NATALITY_RATE_SCALE = 12;
/** Días de embarazo en la cobertura (el normal es 280). */
export const NATALITY_GESTATION_DAYS = 30;

export function natalityLifeOptions<T extends LifeOptions>(base: T): T {
  return {
    ...base,
    conception: true,
    births: true,
    conceptionRateScale: NATALITY_RATE_SCALE,
    conceptionGestationDays: NATALITY_GESTATION_DAYS,
  };
}

/** Procesos y eventos que esta cobertura debe ejercitar. */
export const NATALITY_PROCESSES = ["life.conception", "life.labor", "life.birth"] as const;
export const NATALITY_EVENTS = ["family.conception", "family.birth", "family.rearing"] as const;
