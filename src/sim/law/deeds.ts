// Lo que cada uno sabe de lo que otros hicieron (law §2, §15; information): un delito entra en la
// justicia de la aldea solo si alguien lo cree. Hasta que exista el almacén de creencias, cada uno
// guarda los hechos que vio o le contaron (`Deed`), con quién fue si lo reconoció. La fama de
// alguien no es un número del mundo: es cuánta gente sabe de lo que hizo.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";

/** `default`: no devolvió lo que le fiaron y el acreedor lo reclamó (contracts, fiado). */
export type DeedKind = "theft" | "assault" | "default";

/** Cómo lo supo: lo vio, lo oyó (sin ver), se lo contaron. */
export type DeedVia = "saw" | "heard" | "told";

/**
 * La lectura del porqué que acompaña a un hecho: el `purposeWeight` (actions) de lo que leyó quien
 * guarda el hecho, de -1 (hostil, seguro) a 1 (benigno, seguro). Law no importa actions: el
 * cableado lo calcula con la lectura (`ReadPurpose`) y se lo da.
 */
export interface DeedRead {
  readonly weight: number;
}

export interface Deed {
  readonly kind: DeedKind;
  /** Quién lo hizo, si lo reconoció (si no, se sabe que pasó y no quién). */
  readonly by: AgentId | null;
  readonly victim: AgentId;
  /** El evento de la verdad (para el inspector y la crónica; nadie del mundo lo ve). */
  readonly event: EventId;
  readonly at: Tick;
  readonly via: DeedVia;
  /**
   * Lo que quien guarda el hecho leyó del porqué del actor (actions, `readPurpose`): con esto juzga
   * si es culpa y cuánta. Sin lectura se juzga por el hecho solo.
   */
  readonly read?: DeedRead;
}

export interface KnownDeeds {
  readonly deeds: readonly Deed[];
}

/** Lo que alguien sabe de lo que pasó, en su entidad. */
export const KNOWN_DEEDS = table<KnownDeeds>("law.known_deeds");

/** Cuántos hechos guarda cada uno (los más viejos se olvidan; la memoria real llega en Fase 2). */
export const KEPT_DEEDS = 16;

/**
 * Suma `deed`: el mismo evento no se guarda dos veces, y si ya lo había visto no se pisa con un
 * «me contaron». Pero saber quién fue pisa el «no sé quién».
 */
export function learnDeed(before: KnownDeeds | undefined, deed: Deed): KnownDeeds {
  const old = before?.deeds ?? [];
  const same = old.find((d) => d.event === deed.event);
  if (same) {
    const better = same.by === null && deed.by !== null;
    if (!better) return before as KnownDeeds;
    return { deeds: old.map((d) => (d.event === deed.event ? { ...d, by: deed.by } : d)) };
  }
  return { deeds: [...old, deed].slice(-KEPT_DEEDS) };
}

/** Lo que `knower` sabe que hizo `who` (los hechos con su nombre). */
export function deedsBy(known: KnownDeeds | undefined, who: AgentId): readonly Deed[] {
  return (known?.deeds ?? []).filter((d) => d.by === who);
}

const GRAVITY: readonly DeedKind[] = ["assault", "theft", "default"];

/**
 * El hecho más grave que `knower` sabe de `who` (herir pesa más que robar, y robar más que deber).
 * Un hecho que `knower` leyó como disculpable (`reportable` falso: un regalo, un malentendido) no
 * cuenta: no lo denuncia ni se lo reprocha.
 */
export function worstDeed(known: KnownDeeds | undefined, who: AgentId): Deed | null {
  const by = deedsBy(known, who).filter(reportable);
  for (const kind of GRAVITY) {
    const found = by.find((d) => d.kind === kind);
    if (found) return found;
  }
  return null;
}

/** Olvida lo que se sabía de que `by` no le pagó a `victim`: pagó, y la aldea lo sabe. */
export function clearDefault(
  known: KnownDeeds | undefined,
  by: AgentId,
  victim: AgentId,
): KnownDeeds | undefined {
  if (!known) return known;
  const kept = known.deeds.filter(
    (d) => !(d.kind === "default" && d.by === by && d.victim === victim),
  );
  return kept.length === known.deeds.length ? known : { deeds: kept };
}

/**
 * Fama de `who` entre `knowers`: la fracción que sabe de algo que hizo (0-1). Es lo que cambia el
 * trato (deferencia, regateo, pedidos), y sale solo de quién lo vio o se lo contó.
 */
export function notoriety(knowers: readonly (KnownDeeds | undefined)[], who: AgentId): number {
  if (knowers.length === 0) return 0;
  const aware = knowers.filter((k) => deedsBy(k, who).length > 0).length;
  return aware / knowers.length;
}

/** Cuánto baja la fama el margen de un trato (como la deferencia, con tope). */
export const NOTORIETY_EDGE = 0.12;

export function notorietyEdge(fame: number): number {
  return -NOTORIETY_EDGE * Math.min(1, Math.max(0, fame));
}

/** Desde cuánta culpa leída un hecho se denuncia (law §6): debajo es malentendido o disculpa. */
export const REPORT_EDGE = 0.5;
/** El tope de la culpa leída: un daño leído como venganza o robo no pasa de este múltiplo. */
export const MAX_CULPABILITY = 1.5;

/**
 * Cuánta culpa le ve a un hecho quien lo juzga, de 0 a `MAX_CULPABILITY`, según el porqué que
 * leyó y no el que es verdad: 1 sin lectura; el mismo `theft` leído como regalo casi no pesa y
 * leído como robo seguro pesa más. La duda ya viene en el peso (`purposeWeight` lo atenúa).
 */
export function culpability(deed: Pick<Deed, "read">): number {
  if (deed.read === undefined) return 1;
  const w = Math.min(1, Math.max(-1, deed.read.weight));
  return Math.min(MAX_CULPABILITY, Math.max(0, 1 - w));
}

/** Si quien juzga el hecho lo denunciaría: la culpa que le ve pasa `REPORT_EDGE`. */
export function reportable(deed: Pick<Deed, "read">): boolean {
  return culpability(deed) >= REPORT_EDGE;
}

/**
 * Cuánto escala la pena por la culpa leída (law §9): la pena base se multiplica por esto, de 0
 * (se desestima) a `MAX_CULPABILITY`.
 */
export function penaltyScale(deed: Pick<Deed, "read">): number {
  return reportable(deed) ? culpability(deed) : 0;
}
