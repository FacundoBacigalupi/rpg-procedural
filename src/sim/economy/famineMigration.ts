// Migración por hambruna, parte pura (economy §«Crisis con causa»). La hambruna declara
// `migrationPull` (fracción de la comunidad que considera irse); acá se lee como decisión de un
// hogar: irse (empuje del origen contra arraigo y medios) y llegar (atractivo del destino contra
// el costo del viaje). Sin RNG: la tirada la pone quien llama (`roll` en 0..1). Sin estado: no
// mueve a nadie, devuelve la decisión. Constantes sin calibrar.

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Lo que un hogar pesa al decidir si se va. Todo en 0..1. */
export interface LeaveInputs {
  /** `FAMINE.migrationPull` del asentamiento de origen. */
  readonly pull: number;
  /** Arraigo: tierra propia, parientes, tumbas, deudas que lo atan. */
  readonly attachment: number;
  /** Medios para el viaje y para empezar de nuevo (0 = nada, 1 = sobrados). */
  readonly means: number;
}

/** Peso del arraigo contra el empuje del hambre. */
export const LEAVE_ATTACHMENT_WEIGHT = 0.6;
/** Sin medios no se puede ir aunque se quiera: el piso del peso de los medios. */
export const LEAVE_MEANS_FLOOR = 0.2;

/** Ganas de irse, 0..1: 0 sin empuje de hambre; el arraigo la frena y la falta de medios la acota. */
export function leaveDesire(i: LeaveInputs): number {
  const drive = clamp(i.pull, 0, 1) * (1 - LEAVE_ATTACHMENT_WEIGHT * clamp(i.attachment, 0, 1));
  const can = LEAVE_MEANS_FLOOR + (1 - LEAVE_MEANS_FLOOR) * clamp(i.means, 0, 1);
  return clamp(drive * can, 0, 1);
}

/** Decide irse: la tirada (0..1, del RNG de quien llama) cae por debajo de las ganas. */
export function decidesToLeave(i: LeaveInputs, roll: number): boolean {
  return i.pull > 0 && roll < leaveDesire(i);
}

/** Un destino posible, visto por el hogar (lo que cree, no la verdad). */
export interface Destination {
  /** Escasez creída allá (`FAMINE.value` creído; 0 = hay de sobra). */
  readonly believedScarcity: number;
  /** El empuje de migración del destino: si ellos también se van, no se llega. */
  readonly pull: number;
  /** Costo del viaje en 0..1 (distancia, peligro, peaje). */
  readonly travelCost: number;
  /** Parientes o conocidos que lo reciben, 0..1. */
  readonly ties: number;
}

/** Atractivo de un destino, 0..1: poca escasez, sin éxodo propio, cerca y con lazos. */
export function arrivalAppeal(d: Destination): number {
  const open = (1 - clamp(d.believedScarcity, 0, 1)) * (1 - clamp(d.pull, 0, 1));
  const welcome = 0.7 + 0.3 * clamp(d.ties, 0, 1);
  return clamp(open * welcome * (1 - clamp(d.travelCost, 0, 1)), 0, 1);
}

/**
 * El mejor destino por atractivo (empate: el primero por clave), o undefined si ninguno supera
 * `minAppeal`: sin adónde ir se queda. Orden determinista por clave.
 */
export function chooseDestination(
  options: ReadonlyMap<string, Destination>,
  minAppeal = 0.15,
): string | undefined {
  let best: string | undefined;
  let bestAppeal = minAppeal;
  for (const key of [...options.keys()].sort()) {
    const a = arrivalAppeal(options.get(key) as Destination);
    if (a > bestAppeal) {
      best = key;
      bestAppeal = a;
    }
  }
  return best;
}
