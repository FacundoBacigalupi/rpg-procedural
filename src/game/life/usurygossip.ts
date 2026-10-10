// Lo que sigue a un fallo de usura que procede (credit §6, information §4): tras `credit.usury_ruled`
// con `upheld`, el deudor, los testigos que tasaron el trato y algunos vecinos del lugar oyen el
// rumor `fraud` sobre el prestamista (creencia en `RUMORS`, nunca la verdad). Quien pide prestado
// lee ese rumor (`fraudCaution`) y evita al que cree tramposo. Opt-in (`LifeParts.usuryGossip`);
// apagado no existe ni corre. Constantes sin calibrar.

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
} from "../../sim/index.ts";

export const USURY_GOSSIP_PROCESS = "life.usury_gossip";
export const USURY_RULED_EVENT = "credit.usury_ruled";

/** Cuánto le cree el deudor (lo vivió) y el testigo (lo tasó) al fallo; el vecino que lo oye (sin calibrar). */
export const USURY_BORROWER_CONFIDENCE = 0.9;
export const USURY_WITNESS_CONFIDENCE = 0.8;
export const USURY_NEIGHBOR_CONFIDENCE = 0.5;
/** Chance de que cada vecino del lugar se entere del fallo (sin calibrar). */
export const USURY_NEIGHBOR_CHANCE = 0.5;

/**
 * Multiplicador (0-1) de la gana de pedirle a `lender` según lo que `observer` CREE: el rumor `fraud`
 * más confiable sobre él lo baja en proporción a la confianza (`1 - conf * (1 - floor)`). Sin rumor: 1.
 */
export function fraudCaution(
  truth: ReadonlyWorldTruth,
  observer: AgentId,
  lender: AgentId,
  floor = 0.2,
): number {
  let best = 0;
  for (const h of truth.get(RUMORS, observer)?.items ?? []) {
    if (h.content.kind !== "fraud" || h.content.by !== lender) continue;
    best = Math.max(best, Math.min(1, Math.max(0, h.confidence)));
  }
  return 1 - best * (1 - floor);
}

export interface UsuryGossipOptions {
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

function usuryRumor(
  before: Rumors | undefined,
  root: EventId,
  lender: AgentId,
  borrower: AgentId,
  at: Tick,
  now: Tick,
  hops: number,
  confidence: number,
  teller: AgentId | null,
  who: AgentId,
): Rumors {
  const heard: HeardRumor = {
    root,
    content: { kind: "fraud", by: lender, victim: borrower, severity: 1 },
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

export function usuryGossipProcess(o: UsuryGossipOptions): ProcessDef {
  return {
    id: USURY_GOSSIP_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [RUMORS.name, ENTITY.name, PERSON.name],
    writes: [RUMORS.name],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const rumors = new Map<AgentId, Rumors | undefined>();
      for (const e of ctx.recent) {
        if (e.kind !== USURY_RULED_EVENT) continue;
        const data = e.data as { upheld?: boolean; evidence?: { observer: AgentId }[] };
        if (data.upheld !== true) continue;
        const [borrower, lender] = e.actors as (AgentId | undefined)[];
        if (!borrower || !lender) continue;
        const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
        const here = JSON.stringify(o.placeOf(truth, borrower));
        const hears = new Map<
          AgentId,
          { hops: number; confidence: number; teller: AgentId | null }
        >();
        if (alive(borrower))
          hears.set(borrower, { hops: 0, confidence: USURY_BORROWER_CONFIDENCE, teller: null });
        for (const w of data.evidence ?? []) {
          if (w.observer === lender || hears.has(w.observer) || !alive(w.observer)) continue;
          hears.set(w.observer, { hops: 0, confidence: USURY_WITNESS_CONFIDENCE, teller: null });
        }
        for (const id of (truth.ids(PERSON) as AgentId[]).sort()) {
          if (id === lender || hears.has(id) || !alive(id)) continue;
          if (JSON.stringify(o.placeOf(truth, id)) !== here) continue;
          if (!ctx.rng.fork("usury_rumor", e.id, id).chance(USURY_NEIGHBOR_CHANCE)) continue;
          hears.set(id, { hops: 1, confidence: USURY_NEIGHBOR_CONFIDENCE, teller: borrower });
        }
        for (const [who, h] of hears) {
          const before = rumors.has(who) ? rumors.get(who) : truth.get(RUMORS, who);
          rumors.set(
            who,
            usuryRumor(
              before,
              e.id as EventId,
              lender,
              borrower,
              e.tick,
              ctx.now,
              h.hops,
              h.confidence,
              h.teller,
              who,
            ),
          );
        }
      }
      for (const [who, r] of [...rumors].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (r) changes.push(setComponent(RUMORS, who, r));
      }
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}
