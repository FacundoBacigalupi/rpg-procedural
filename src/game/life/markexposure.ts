// Lo que sigue a una marca falsa descubierta (information §4, economy §6): tras `scam.discovered`
// con `forgedMark`, el comprador y algunos vecinos del lugar oyen el rumor `fraud` sobre el
// falsificador (creencia en `RUMORS`, nunca la verdad) y a quien le copiaron la marca se le repara
// la reputación: `marks.cleared` (causa en el descubrimiento) y una fila en `MARK_CLEARED`, que
// guarda en quién se supo que la marca era falsa. Único dueño de `MARK_CLEARED`. Opt-in
// (`LifeParts.marksGossip`, con `marks` y `marksExpose`); apagado no existe ni corre.
// Constantes sin calibrar.

import type { AgentId, EventId, PlaceRef, Tick } from "../../core/index.ts";
import {
  ENTITY,
  type EventDraft,
  type HeardRumor,
  KEPT_RUMORS,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  RUMORS,
  type Rumors,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import { SCAM_DISCOVERED, type ScamDiscoveredData } from "./scamdiscovery.ts";

export const MARK_EXPOSURE_PROCESS = "life.mark_exposure";
export const MARK_CLEARED_EVENT = "marks.cleared";

/** Cuánto cree el comprador que lo descubrió, y el vecino que se lo cuenta (sin calibrar). */
export const FORGERY_BUYER_CONFIDENCE = 0.9;
export const FORGERY_NEIGHBOR_CONFIDENCE = 0.6;
/** Chance de que cada vecino del lugar se entere del fraude (sin calibrar). */
export const FORGERY_NEIGHBOR_CHANCE = 0.5;

/** Quién supo que la marca copiada era falsa (sobre el marcador copiado). */
export interface ClearedBy {
  readonly buyer: AgentId;
  readonly forger: AgentId;
  readonly deal: EventId;
  readonly at: Tick;
}
export interface MarkCleared {
  readonly entries: readonly ClearedBy[];
}
/** Reparaciones de reputación por marcador copiado. Solo escribe `life.mark_exposure`. */
export const MARK_CLEARED = table<MarkCleared>("economy.mark_cleared");
export const KEPT_CLEARED = 16;

/** Cuántas veces se supo que una marca copiada de `copied` era falsa (cuenta de `MARK_CLEARED`). */
export function clearedCount(truth: ReadonlyWorldTruth, copied: AgentId): number {
  return truth.get(MARK_CLEARED, copied)?.entries.length ?? 0;
}

export interface MarkExposureOptions {
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

function fraudRumor(
  before: Rumors | undefined,
  root: EventId,
  forger: AgentId,
  victim: AgentId,
  at: Tick,
  now: Tick,
  hops: number,
  confidence: number,
  teller: AgentId | null,
  who: AgentId,
): Rumors {
  const heard: HeardRumor = {
    root,
    content: { kind: "fraud", by: forger, victim, severity: 1 },
    at,
    heardAt: now,
    confidence,
    hops,
    variant: `${root}#${who}`,
    parent: null,
    teller,
    voices: 1,
  };
  const items = [...(before?.items ?? []).filter((x) => x.root !== root), heard];
  return { items: items.slice(-KEPT_RUMORS), told: before?.told ?? [] };
}

export function markExposureProcess(o: MarkExposureOptions): ProcessDef {
  return {
    id: MARK_EXPOSURE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [RUMORS.name, MARK_CLEARED.name, ENTITY.name, PERSON.name],
    writes: [RUMORS.name, MARK_CLEARED.name],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const rumors = new Map<AgentId, Rumors | undefined>();
      const cleared = new Map<AgentId, MarkCleared | undefined>();
      for (const e of ctx.recent) {
        if (e.kind !== SCAM_DISCOVERED) continue;
        const data = e.data as Partial<ScamDiscoveredData> & { forgedMark?: boolean };
        if (data.forgedMark !== true) continue;
        const [forger, buyer, copied] = e.actors as (AgentId | undefined)[];
        if (!forger || !buyer || !copied) continue;
        const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
        const here = JSON.stringify(o.placeOf(truth, buyer));
        const hears: { who: AgentId; hops: number; confidence: number; teller: AgentId | null }[] =
          [];
        if (alive(buyer)) {
          hears.push({ who: buyer, hops: 0, confidence: FORGERY_BUYER_CONFIDENCE, teller: null });
        }
        for (const id of (truth.ids(PERSON) as AgentId[]).sort()) {
          if (id === buyer || id === forger || id === copied || !alive(id)) continue;
          if (JSON.stringify(o.placeOf(truth, id)) !== here) continue;
          if (!ctx.rng.fork("forgery_rumor", e.id, id).chance(FORGERY_NEIGHBOR_CHANCE)) continue;
          hears.push({ who: id, hops: 1, confidence: FORGERY_NEIGHBOR_CONFIDENCE, teller: buyer });
        }
        for (const h of hears) {
          const before = rumors.has(h.who) ? rumors.get(h.who) : truth.get(RUMORS, h.who);
          rumors.set(
            h.who,
            fraudRumor(
              before,
              e.id as EventId,
              forger,
              buyer,
              e.tick,
              ctx.now,
              h.hops,
              h.confidence,
              h.teller,
              h.who,
            ),
          );
        }
        if (alive(copied)) {
          const before = cleared.has(copied)
            ? cleared.get(copied)
            : truth.get(MARK_CLEARED, copied);
          cleared.set(copied, {
            entries: [
              ...(before?.entries ?? []),
              { buyer, forger, deal: (data.deal ?? e.id) as EventId, at: ctx.now as Tick },
            ].slice(-KEPT_CLEARED),
          });
          events.push({
            kind: MARK_CLEARED_EVENT,
            actors: [copied, buyer, forger],
            place: o.placeOf(truth, buyer),
            data: { deal: data.deal ?? null, heard: hears.length },
            emissions: {},
            causes: [{ kind: "event" as const, event: e.id as EventId }],
          });
        }
      }
      for (const [who, r] of [...rumors].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (r) changes.push(setComponent(RUMORS, who, r));
      }
      for (const [who, c] of [...cleared].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (c) changes.push(setComponent(MARK_CLEARED, who, c));
      }
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}
