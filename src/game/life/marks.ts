// Marcas en los lotes comerciados (economy §6, ver `sim/economy/marks.ts`): el vendedor que cierra
// un trato le pone al lote su marca auténtica (calidad real afirmada) y el comprador la verifica
// al recibirla, con chance según su ojo y su familiaridad con la marca (cuántos lotes de ese
// mismo vendedor ya tuvo). Proceso opt-in (`LifeParts.marks`): apagado no hay filas, RNG ni
// eventos. Único dueño de `LOT_MARKS`. Al cerrar otro trato repasa un lote ya recibido (`marks.rechecked`, con falso positivo). Mirar a pedido (`look`) repasa un lote recibido sin verbo nuevo. Falsificar como acción queda con ítem aparte (pide verbo).

import type { AgentId, EventId, PlaceRef, Tick } from "../../core/index.ts";
import {
  ENTITY,
  type EventDraft,
  type LotMark,
  markFalseAlarmChance,
  type ProcessDef,
  REFERENCE_QUALITY,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  stampMark,
  table,
  verifyMark,
} from "../../sim/index.ts";
import { lookAcuity } from "./looking.ts";

export const MARKS_PROCESS = "life.marks";
export const MARK_STAMPED = "marks.stamped";
export const MARK_VERIFIED = "marks.verified";
export const MARK_RECHECKED = "marks.rechecked";

/** Un lote marcado en manos del comprador: la verdad de la marca y qué creyó al verificarla. */
export interface MarkedLot {
  readonly event: EventId;
  readonly unit: string;
  readonly grams: number;
  readonly mark: LotMark;
  /** Lo que el comprador concluyó al mirarla (la verdad no se la dice nadie). */
  readonly seemsForged: boolean;
  readonly credence: number;
  /** Veces que volvió a mirarla ya recibida (puede cambiar de opinión, con falso positivo). */
  readonly rechecks?: number;
}

export interface LotMarks {
  readonly lots: readonly MarkedLot[];
}

/** Los lotes marcados que recibió cada comprador. Solo escribe `life.marks`. */
export const LOT_MARKS = table<LotMarks>("economy.lot_marks");

/** Cuántos lotes marcados guarda cada comprador (los más viejos se sueltan). */
export const KEPT_MARKED_LOTS = 8;
/** Familiaridad ganada por cada lote previo con la marca del mismo vendedor (tope 1). */
export const MARK_FAMILIARITY_STEP = 0.25;
/** Fama que se le supone a quien marca cuando nadie mide la suya (0-1). */
export const MARK_DEFAULT_RENOWN = 0.5;

export interface MarksOptions {
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Ojo del comprador (0-1, ver `scamEyeOf`); sin dato, 0,5. */
  readonly eye?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  /** Fama de quien marca (0-1); sin dato, `MARK_DEFAULT_RENOWN`. */
  readonly renown?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
}

interface TradeFx {
  readonly kind?: string;
  readonly with?: string | null;
  readonly deal?: boolean;
  readonly direction?: "buy" | "sell" | null;
  readonly good?: string | null;
  readonly grams?: number;
  readonly quality?: number;
}

export function marksProcess(o: MarksOptions): ProcessDef {
  return {
    id: MARKS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [LOT_MARKS.name, ENTITY.name],
    writes: [LOT_MARKS.name],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const pending = new Map<AgentId, LotMarks | undefined>();
      for (const e of ctx.recent) {
        const fx = (e.data as { effect?: TradeFx } | null)?.effect;
        const actor = e.actors[0] as AgentId | undefined;
        if (actor && fx?.kind !== "trade" && lookAcuity(e.data) !== undefined) {
          // Mirar a pedido: repasa un lote marcado ya recibido (mismo repaso que al cerrar un trato).
          const held = pending.has(actor) ? pending.get(actor) : truth.get(LOT_MARKS, actor);
          const lots = held?.lots ?? [];
          if (lots.length === 0 || truth.get(ENTITY, actor)?.endedAt !== undefined) continue;
          const idx = Math.min(
            lots.length - 1,
            Math.floor(ctx.rng.fork("mark_look", e.id, ctx.now).float() * lots.length),
          );
          const old = lots[idx] as MarkedLot;
          const fam = Math.min(
            1,
            lots.filter((l) => l.mark.claimedBy === old.mark.claimedBy).length *
              MARK_FAMILIARITY_STEP,
          );
          const eye = o.eye?.(truth, actor) ?? 0.5;
          const again = verifyMark(
            old.mark,
            eye,
            fam,
            o.renown?.(truth, old.mark.claimedBy) ?? MARK_DEFAULT_RENOWN,
            ctx.rng.fork("mark_look_roll", e.id, ctx.now).float(),
            markFalseAlarmChance(eye, fam),
          );
          events.push({
            kind: MARK_RECHECKED,
            actors: [actor, old.mark.claimedBy],
            place: o.placeOf(truth, actor),
            data: {
              deal: old.event,
              credence: again.credence,
              seemsForged: again.seemsForged,
              wasForged: old.mark.claimedBy !== old.mark.stampedBy,
              onLook: true,
            },
            emissions: {},
            causes: [{ kind: "event" as const, event: e.id }],
          });
          const after: LotMarks = {
            lots: lots.map((l, i) =>
              i === idx
                ? {
                    ...l,
                    seemsForged: again.seemsForged,
                    credence: again.credence,
                    rechecks: (l.rechecks ?? 0) + 1,
                  }
                : l,
            ),
          };
          pending.set(actor, after);
          changes.push(setComponent(LOT_MARKS, actor, after));
          continue;
        }
        if (fx?.kind !== "trade" || !fx.deal || !fx.with || !actor) continue;
        if (!fx.direction || !fx.good || !fx.grams || fx.grams <= 0) continue;
        const other = fx.with as AgentId;
        const seller = fx.direction === "sell" ? actor : other;
        const buyer = fx.direction === "sell" ? other : actor;
        if (truth.get(ENTITY, buyer)?.endedAt !== undefined) continue;
        const causes = [{ kind: "event" as const, event: e.id }];
        const place = o.placeOf(truth, buyer);
        const mark = stampMark(seller, fx.quality ?? REFERENCE_QUALITY, ctx.now as Tick);
        events.push({
          kind: MARK_STAMPED,
          actors: [seller, buyer],
          place,
          data: { deal: e.id, unit: fx.good, grams: fx.grams, claimed: mark.claimed },
          emissions: {},
          causes,
        });
        const before = pending.has(buyer) ? pending.get(buyer) : truth.get(LOT_MARKS, buyer);
        const seen = (before?.lots ?? []).filter((l) => l.mark.claimedBy === seller).length;
        const familiarity = Math.min(1, seen * MARK_FAMILIARITY_STEP);
        const roll = ctx.rng.fork("mark_verify", e.id, ctx.now).float();
        const verdict = verifyMark(
          mark,
          o.eye?.(truth, buyer) ?? 0.5,
          familiarity,
          o.renown?.(truth, seller) ?? MARK_DEFAULT_RENOWN,
          roll,
        );
        events.push({
          kind: MARK_VERIFIED,
          actors: [buyer, seller],
          place,
          data: { deal: e.id, credence: verdict.credence, seemsForged: verdict.seemsForged },
          emissions: {},
          causes,
        });
        let older = before?.lots ?? [];
        if (older.length > 0) {
          // Al cerrar un trato el comprador repasa sus lotes: mira uno ya recibido de nuevo.
          const pick = ctx.rng.fork("mark_recheck", e.id, ctx.now).float();
          const idx = Math.min(older.length - 1, Math.floor(pick * older.length));
          const old = older[idx] as MarkedLot;
          const fam = Math.min(
            1,
            older.filter((l) => l.mark.claimedBy === old.mark.claimedBy).length *
              MARK_FAMILIARITY_STEP,
          );
          const eye = o.eye?.(truth, buyer) ?? 0.5;
          const again = verifyMark(
            old.mark,
            eye,
            fam,
            o.renown?.(truth, old.mark.claimedBy) ?? MARK_DEFAULT_RENOWN,
            ctx.rng.fork("mark_recheck_roll", e.id, ctx.now).float(),
            markFalseAlarmChance(eye, fam),
          );
          events.push({
            kind: MARK_RECHECKED,
            actors: [buyer, old.mark.claimedBy],
            place,
            data: {
              deal: old.event,
              credence: again.credence,
              seemsForged: again.seemsForged,
              wasForged: old.mark.claimedBy !== old.mark.stampedBy,
            },
            emissions: {},
            causes,
          });
          older = older.map((l, i) =>
            i === idx
              ? {
                  ...l,
                  seemsForged: again.seemsForged,
                  credence: again.credence,
                  rechecks: (l.rechecks ?? 0) + 1,
                }
              : l,
          );
        }
        const lot: MarkedLot = {
          event: e.id,
          unit: fx.good,
          grams: fx.grams,
          mark,
          seemsForged: verdict.seemsForged,
          credence: verdict.credence,
        };
        const after: LotMarks = {
          lots: [...older, lot].slice(-KEPT_MARKED_LOTS),
        };
        pending.set(buyer, after);
        changes.push(setComponent(LOT_MARKS, buyer, after));
      }
      return events.length === 0 ? {} : { changes, events };
    },
  };
}
