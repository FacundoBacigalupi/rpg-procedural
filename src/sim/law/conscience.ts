// La conciencia de quien hizo algo (law §15, npc-psychology §11): lo que cada uno sabe de lo que
// hizo él mismo, aunque nadie lo haya visto. `KNOWN_DEEDS` es lo que otros saben; esto es lo que
// carga quien lo hizo. De acá sale la culpa (`guiltOf`, testimony.ts), y de la culpa lo que hace:
// evitar a la víctima, querer reparar, confesar si lo preguntan o desviar. La respuesta se guarda
// aparte (`AMENDS`) para que la lea quien contesta una acusación o un interrogatorio.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { DeedKind } from "./deeds.ts";
import { type Conscience, type GuiltResponse, guiltOf, type OwnDeed } from "./testimony.ts";

/** Lo que `OwnDeed` ya dice, guardado en la entidad de quien lo hizo. */
export interface OwnDeeds {
  readonly deeds: readonly OwnDeed[];
}

/** Lo que cada uno sabe que hizo él mismo (esté o no sabido por otros). */
export const OWN_DEEDS = table<OwnDeeds>("law.own_deeds");

/** Cuántos hechos propios carga cada uno (los más viejos se olvidan; la culpa ya decayó). */
export const KEPT_OWN_DEEDS = 12;

/** Suma `d`: el mismo evento no se guarda dos veces. */
export function rememberOwn(before: OwnDeeds | undefined, d: OwnDeed): OwnDeeds {
  const old = before?.deeds ?? [];
  if (old.some((x) => x.event === d.event)) return before as OwnDeeds;
  return { deeds: [...old, d].slice(-KEPT_OWN_DEEDS) };
}

/** Un hecho propio de esa clase (contra `victim`, o contra cualquiera si es null), el más reciente. */
export function didDeed(
  own: OwnDeeds | undefined,
  kind: DeedKind,
  victim: AgentId | null,
): OwnDeed | undefined {
  const found = (own?.deeds ?? []).filter(
    (d) => d.kind === kind && (victim === null || d.victim === victim),
  );
  return found[found.length - 1];
}

/** Qué decidió hacer con la culpa de un hecho y desde cuándo. */
export interface Stance {
  readonly response: GuiltResponse;
  /** La culpa (0-1) con que lo decidió, para mostrar el peso. */
  readonly guilt: number;
  readonly decided: Tick;
}

export interface Amends {
  /** Por evento del hecho propio. */
  readonly byDeed: Readonly<Record<string, Stance>>;
}

/** Lo que cada uno decidió hacer con su culpa. */
export const AMENDS = table<Amends>("law.amends");

export function stanceOf(a: Amends | undefined, event: EventId): Stance | undefined {
  return a?.byDeed[event];
}

/** Culpa que carga hoy por el peor de sus hechos (null si no tiene ninguno que pese). */
export function heaviestGuilt(
  own: OwnDeeds | undefined,
  conscienceFor: (d: OwnDeed) => Conscience,
  now: Tick,
): { deed: OwnDeed; guilt: number } | null {
  let best: { deed: OwnDeed; guilt: number } | null = null;
  for (const deed of own?.deeds ?? []) {
    const guilt = guiltOf(deed, conscienceFor(deed), now);
    if (guilt > 0 && (!best || guilt > best.guilt)) best = { deed, guilt };
  }
  return best;
}

/** Cuánto mueve la honestidad al ser interrogado: confesar la sube, desviar la baja. */
export const CONFESS_SHIFT = 0.35;

export function honestyShift(stance: Stance | undefined): number {
  if (!stance) return 0;
  if (stance.response === "confess") return CONFESS_SHIFT;
  if (stance.response === "deflect") return -CONFESS_SHIFT;
  if (stance.response === "repair") return CONFESS_SHIFT / 2;
  return 0;
}

/** Si, preguntado por el hecho, lo reconoce: confesar (o querer reparar) lo admite; lo demás lo niega. */
export function admitsIt(stance: Stance | undefined): boolean {
  return stance?.response === "confess" || stance?.response === "repair";
}

/** Si evita a `victim`: tiene un hecho contra ella y decidió evitarla (o desviar, que es lo mismo a la distancia). */
export function avoidsVictim(
  own: OwnDeeds | undefined,
  amends: Amends | undefined,
  victim: AgentId,
): boolean {
  return (own?.deeds ?? []).some((d) => {
    if (d.victim !== victim) return false;
    const r = amends?.byDeed[d.event]?.response;
    return r === "avoid" || r === "deflect";
  });
}
