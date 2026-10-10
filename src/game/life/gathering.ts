/**
 * Lugares de reunión (mercado, fiesta, templo) con horas de contacto reales (body-health §6): en vez
 * de la foto diaria de `LOCATION`, cada asistente trae una ventana de horas del día y el contacto de
 * un par pesa por las horas en que de verdad coinciden. Funciones puras, sin RNG.
 */

/** Ventana de presencia dentro del día, en horas [from, to) con 0 <= from <= to <= 24. */
export interface HourWindow {
  readonly from: number;
  readonly to: number;
}

/** Una reunión del día: el lugar (`hex|espacio`, como la clave de lugar de `exposure`) y quién estuvo cuándo. */
export interface Gathering {
  readonly place: string;
  /** Si el lugar es abierto (plaza, mercado al aire libre) la ventilación es alta. */
  readonly open: boolean;
  readonly visits: ReadonlyMap<string, HourWindow>;
}

/** Cuántas horas coinciden dos ventanas (0 si no se cruzan). */
export function overlapHours(a: HourWindow, b: HourWindow): number {
  const lo = a.from > b.from ? a.from : b.from;
  const hi = a.to < b.to ? a.to : b.to;
  return hi > lo ? hi - lo : 0;
}

/** Horas compartidas por cada par (a, b) con a < b por id; solo los pares que se cruzan. */
export function pairContactHours(g: Gathering): Map<string, number> {
  const ids = [...g.visits.keys()].sort();
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) {
    const a = g.visits.get(ids[i] as string);
    if (!a) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const b = g.visits.get(ids[j] as string);
      if (!b) continue;
      const h = overlapHours(a, b);
      if (h > 0) out.set(`${ids[i]}|${ids[j]}`, h);
    }
  }
  return out;
}

/** Horas que `who` comparte con `other` en la reunión (0 si alguno no fue). */
export function sharedHours(g: Gathering, who: string, other: string): number {
  const a = g.visits.get(who);
  const b = g.visits.get(other);
  return a && b ? overlapHours(a, b) : 0;
}

/** Cuántos asistentes coinciden con `who` en algún momento (sin contarlo). */
export function overlapCount(g: Gathering, who: string): number {
  const a = g.visits.get(who);
  if (!a) return 0;
  let n = 0;
  for (const [id, w] of g.visits) if (id !== who && overlapHours(a, w) > 0) n++;
  return n;
}
