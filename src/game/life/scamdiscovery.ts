// El descubrimiento de la estafa de calidad (economy §6): el comprador que pagó por un lote mejor
// de lo que es lo va usando, y cada día puede notar la diferencia (o un tasador, o su propio ojo).
// `life.act` deja cada trato inflado en `SCAM_DEALS` con el evento del trato; este proceso, único
// dueño de `SCAM_FOUND`, tira una vez por trato y día (RNG con clave: trato y día) con
// `discoveryChance` y, si lo descubre, emite `scam.discovered` con causa en el evento del trato.
// De ese evento sale lo demás: `life.appraise` baja la confianza del comprador en el vendedor
// (`scamAftermath`) y `life.deeds` lo anota como incumplimiento para que la fama del vendedor caiga.
// Opt-in (`LifeParts.scam`); apagado no existe ni corre.

import {
  type AgentId,
  type Event,
  type EventId,
  type HolderRef,
  holderAccount,
  type LedgerUnit,
  type PlaceRef,
  type Tick,
} from "../../core/index.ts";
import {
  discoveryChance,
  draftEvent,
  ENTITY,
  type EventDraft,
  type HeardRumor,
  INNATE,
  isMoney,
  KEPT_RUMORS,
  PERSON,
  type PostingDraft,
  type ProcessContext,
  type ProcessDef,
  pendingScams,
  qualityPriceFactor,
  type ReadonlyWorldTruth,
  RUMORS,
  type Rumors,
  SCAM_DEALS,
  SCAM_FOUND,
  type ScamAftermath,
  type ScamDeal,
  type StateChange,
  scamAftermath,
  setComponent,
} from "../../sim/index.ts";

export const SCAM_DISCOVERY_PROCESS = "life.scam_discovery";
export const SCAM_DISCOVERED = "scam.discovered";

export interface ScamDiscoveryOptions {
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Qué tan fino mira el comprador (0-1, ver `scamEyeOf`); sin dato, 0,5. */
  readonly eye?: (truth: ReadonlyWorldTruth, buyer: AgentId) => number;
  /** Días con el lote en uso por trato: el tiempo desde que lo compró. */
  readonly day: number;
  /** Ojo de quien puede tasar por paga (0-1, ver `scamEyeOf`); sin esto, no hay tasadores. */
  readonly appraisers?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  /** Chance (0-1) de que el vendedor devuelva el sobreprecio si se lo reclaman; sin esto, no hay reclamo. */
  /**
   * Ojo de un tercero que ve la mercadería (o se la cuentan) y la nota sin cobrar (0-1, ver
   * `scamEyeOf`); sin esto, nadie más la nota. Lo cuenta: `scam.noticed` y rumor en ambos.
   */
  readonly witnesses?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  readonly refund?: (truth: ReadonlyWorldTruth, seller: AgentId, buyer: AgentId) => number;
}

export const SCAM_NOTICED = "scam.noticed";
/** Chance diaria de que un vecino de buen ojo vea la mercadería del comprador (sin calibrar). */
export const NOTICE_HAZARD = 0.1;
/** Cuánto cree el comprador lo que le cuenta el vecino que la notó, y el vecino lo que vio (sin calibrar). */
export const NOTICE_CONFIDENCE = 0.7;

export const SCAM_REFUNDED = "scam.refunded";
export const SCAM_REFUND_REFUSED = "scam.refund_refused";

/** Lo que dicen `scam.refunded` (con `paid`) y `scam.refund_refused`: el trato y lo reclamado. */
export interface ScamRefundData {
  readonly deal: EventId;
  readonly owed: number;
  readonly paid?: { readonly unit: LedgerUnit; readonly amount: number };
}

export const SCAM_APPRAISED = "scam.appraised";
/** Lo que cobra el tasador por mirar el lote (una unidad de dinero). */
export const APPRAISAL_FEE = 1;
/** Chance diaria de que un comprador sin sospecha propia pague una tasación. */
export const APPRAISAL_HAZARD = 0.15;
/** Ojo mínimo para cobrar como tasador. */
export const APPRAISER_MIN_EYE = 0.3;

/** Lo que dice `scam.appraised`: el trato mirado, si se vio la brecha y lo cobrado (ya pasó por el ledger). */
export interface ScamAppraisedData {
  readonly deal: EventId;
  readonly found: boolean;
  readonly paid: { readonly unit: LedgerUnit; readonly amount: number };
}

/** Lo que dice `scam.discovered` en `data` (lo lee `life.appraise`). */
export interface ScamDiscoveredData extends ScamAftermath {
  readonly deal: EventId;
  readonly unit: string;
  readonly grams: number;
  readonly real: number;
  readonly believed: number;
  /** Quién lo tasó, si fue por tasador pagado. */
  readonly appraiser?: AgentId;
  /** Quién la notó sin cobrar, si fue un tercero. */
  readonly witness?: AgentId;
}

/** Del evento `scam.discovered`: quién cayó (comprador), quién estafó y el agravio. */
export function discoveredBy(
  e: Event,
): { buyer: AgentId; seller: AgentId; data: ScamDiscoveredData } | null {
  if (e.kind !== SCAM_DISCOVERED) return null;
  const [seller, buyer] = e.actors as (AgentId | undefined)[];
  if (!seller || !buyer) return null;
  return { buyer, seller, data: e.data as ScamDiscoveredData };
}

export function scamDiscoveryProcess(o: ScamDiscoveryOptions): ProcessDef {
  return {
    id: SCAM_DISCOVERY_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "perceive",
    reads: [
      SCAM_DEALS.name,
      SCAM_FOUND.name,
      ENTITY.name,
      INNATE.name,
      PERSON.name,
      ...(o.witnesses ? [RUMORS.name] : []),
    ],
    writes: [SCAM_FOUND.name, ...(o.witnesses ? [RUMORS.name] : [])],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const spent = new Map<AgentId, number>();
      const rumors = new Map<AgentId, Rumors>();
      const buyers = [...(truth.ids(SCAM_DEALS) as AgentId[])].sort();
      for (const buyer of buyers) {
        if (truth.get(ENTITY, buyer)?.endedAt !== undefined) continue;
        const pending = pendingScams(truth.get(SCAM_DEALS, buyer), truth.get(SCAM_FOUND, buyer));
        const found: EventId[] = [];
        for (const d of pending) {
          if (ctx.now <= d.tick) continue;
          const used = (ctx.now - d.tick) / o.day;
          const p = discoveryChance(d.real, d.believed, o.eye?.(truth, buyer) ?? 0.5, used);
          if (p <= 0) continue;
          const rng = ctx.rng.fork("scam", d.event, ctx.windowIndex ?? ctx.now);
          let appraised: AgentId | undefined;
          let witness: AgentId | undefined;
          if (!rng.chance(p)) {
            const seen = noticer(ctx, o, buyer, d, used);
            if (seen) {
              witness = seen;
              events.push({
                kind: SCAM_NOTICED,
                actors: [d.seller, buyer, seen],
                place: o.placeOf(truth, buyer),
                data: { deal: d.event },
                emissions: {},
                causes: [{ kind: "event" as const, event: d.event }],
              });
              for (const who of [seen, buyer]) {
                const before = rumors.get(who) ?? truth.get(RUMORS, who);
                rumors.set(
                  who,
                  withScamRumor(before, d, buyer, ctx.now, who === seen ? 0 : 1, seen),
                );
              }
            }
            if (!witness) {
              // Sin notarlo solo, puede pagarle a alguien de mejor ojo que esté ahí.
              const hire = hireAppraiser(ctx, o, buyer, d, spent);
              if (!hire) continue;
              spent.set(buyer, (spent.get(buyer) ?? 0) + APPRAISAL_FEE);
              const draft = draftEvent(events.length);
              const hit = ctx.rng
                .fork("appraise", d.event, ctx.windowIndex ?? ctx.now)
                .chance(discoveryChance(d.real, d.believed, hire.eye, used, true));
              events.push({
                kind: SCAM_APPRAISED,
                actors: [buyer, hire.who],
                place: o.placeOf(truth, buyer),
                data: {
                  deal: d.event,
                  found: hit,
                  paid: { unit: hire.unit, amount: APPRAISAL_FEE },
                } satisfies ScamAppraisedData,
                emissions: {},
                causes: [{ kind: "event" as const, event: d.event }],
              });
              postings.push({
                event: draft,
                transfers: [
                  {
                    unit: hire.unit,
                    from: holderAccount(buyer as unknown as HolderRef),
                    to: holderAccount(hire.who as unknown as HolderRef),
                    amount: APPRAISAL_FEE,
                  },
                ],
              });
              if (!hit) continue;
              appraised = hire.who;
            }
          }
          found.push(d.event);
          const after = scamAftermath(d.real, d.believed, d.trust);
          const data: ScamDiscoveredData = {
            ...after,
            deal: d.event,
            unit: d.unit,
            grams: d.grams,
            real: d.real,
            believed: d.believed,
            ...(appraised ? { appraiser: appraised } : {}),
            ...(witness ? { witness } : {}),
          };
          events.push({
            kind: SCAM_DISCOVERED,
            actors: [d.seller, buyer],
            place: o.placeOf(truth, buyer),
            data,
            emissions: {},
            causes: [{ kind: "event" as const, event: d.event }],
          });
          claimRefund(ctx, o, buyer, d, after.overpaid, events, postings);
        }
        if (found.length > 0) {
          const before = truth.get(SCAM_FOUND, buyer)?.events ?? [];
          changes.push(
            setComponent(SCAM_FOUND, buyer, { events: [...before, ...found].slice(-32) }),
          );
        }
      }
      for (const [who, r] of [...rumors].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        changes.push(setComponent(RUMORS, who, r));
      }
      return events.length === 0 ? {} : { changes, events, postings };
    },
  };
}

/**
 * El reclamo del comprador: pide de vuelta el sobreprecio (la parte del pago que corresponde a la
 * calidad que no era). El vendedor acepta con la chance `o.refund` (su carácter y su necesidad); si
 * acepta paga, de su bolsa en dinero y hasta donde le alcance, con asiento al ledger y
 * `scam.refunded`; si no, `scam.refund_refused` y queda el agravio.
 */
function claimRefund(
  ctx: ProcessContext,
  o: ScamDiscoveryOptions,
  buyer: AgentId,
  d: ScamDeal,
  overpaid: number,
  events: EventDraft[],
  postings: PostingDraft[],
): void {
  const ledger = ctx.ledger;
  if (!o.refund || !ledger) return;
  const owed = Math.floor((d.coins * overpaid) / qualityPriceFactor(d.believed));
  if (owed < 1) return;
  const causes = [{ kind: "event" as const, event: d.event }];
  const place = o.placeOf(ctx.truth, buyer);
  const willing = o.refund(ctx.truth, d.seller, buyer);
  const accepts = ctx.rng.fork("refund", d.event, ctx.windowIndex ?? ctx.now).chance(willing);
  const purse = accepts
    ? ledger
        .holdings(holderAccount(d.seller as unknown as HolderRef))
        .filter((h) => isMoney(h.unit) && h.amount >= 1)
        .sort((a, b) => b.amount - a.amount || (a.unit < b.unit ? -1 : 1))[0]
    : undefined;
  if (!purse) {
    events.push({
      kind: SCAM_REFUND_REFUSED,
      actors: [d.seller, buyer],
      place,
      data: { deal: d.event, owed } satisfies ScamRefundData,
      emissions: {},
      causes,
    });
    return;
  }
  const amount = Math.min(owed, Math.floor(purse.amount));
  const draft = draftEvent(events.length);
  events.push({
    kind: SCAM_REFUNDED,
    actors: [d.seller, buyer],
    place,
    data: { deal: d.event, owed, paid: { unit: purse.unit, amount } },
    emissions: {},
    causes,
  });
  postings.push({
    event: draft,
    transfers: [
      {
        unit: purse.unit,
        from: holderAccount(d.seller as unknown as HolderRef),
        to: holderAccount(buyer as unknown as HolderRef),
        amount,
      },
    ],
  });
}

/**
 * Un tasador a mano: otro vecino vivo, en el mismo lugar que el comprador, que ni vendió ni es él,
 * con mejor ojo que el suyo; el comprador lo contrata con una chance por día y si le alcanza la
 * bolsa (en dinero, descontado lo ya gastado hoy). Elige al de mejor ojo; empate, por id.
 */
function hireAppraiser(
  ctx: ProcessContext,
  o: ScamDiscoveryOptions,
  buyer: AgentId,
  d: ScamDeal,
  spent: ReadonlyMap<AgentId, number>,
): { who: AgentId; eye: number; unit: LedgerUnit } | null {
  const ledger = ctx.ledger;
  if (!o.appraisers || !ledger) return null;
  if (!ctx.rng.fork("hire", d.event, ctx.windowIndex ?? ctx.now).chance(APPRAISAL_HAZARD)) {
    return null;
  }
  const purse = ledger
    .holdings(holderAccount(buyer as unknown as HolderRef))
    .filter((h) => isMoney(h.unit) && h.amount - (spent.get(buyer) ?? 0) >= APPRAISAL_FEE)
    .sort((a, b) => b.amount - a.amount || (a.unit < b.unit ? -1 : 1))[0];
  if (!purse) return null;
  const here = JSON.stringify(o.placeOf(ctx.truth, buyer));
  const own = o.eye?.(ctx.truth, buyer) ?? 0.5;
  const pick = (ctx.truth.ids(PERSON) as AgentId[])
    .filter(
      (id) =>
        id !== buyer &&
        id !== d.seller &&
        ctx.truth.get(ENTITY, id)?.endedAt === undefined &&
        JSON.stringify(o.placeOf(ctx.truth, id)) === here,
    )
    .map((id) => ({ id, eye: o.appraisers?.(ctx.truth, id) ?? 0 }))
    .filter((c) => c.eye >= APPRAISER_MIN_EYE && c.eye > own + 0.05)
    .sort((a, b) => b.eye - a.eye || (a.id < b.id ? -1 : 1))[0];
  return pick ? { who: pick.id, eye: pick.eye, unit: purse.unit } : null;
}

/**
 * Un tercero que nota la estafa sin cobrar: otro vecino vivo en el mismo lugar que el comprador,
 * que ni vendió ni es él, de buen ojo (`witnesses`), que ve la mercadería con una chance por día
 * (`NOTICE_HAZARD`) y la brecha según su ojo (`discoveryChance`). Elige al de mejor ojo; empate, por id.
 */
function noticer(
  ctx: ProcessContext,
  o: ScamDiscoveryOptions,
  buyer: AgentId,
  d: ScamDeal,
  used: number,
): AgentId | null {
  if (!o.witnesses) return null;
  const here = JSON.stringify(o.placeOf(ctx.truth, buyer));
  const pick = (ctx.truth.ids(PERSON) as AgentId[])
    .filter(
      (id) =>
        id !== buyer &&
        id !== d.seller &&
        ctx.truth.get(ENTITY, id)?.endedAt === undefined &&
        JSON.stringify(o.placeOf(ctx.truth, id)) === here,
    )
    .map((id) => ({ id, eye: o.witnesses?.(ctx.truth, id) ?? 0 }))
    .filter((c) => c.eye >= APPRAISER_MIN_EYE)
    .sort((a, b) => b.eye - a.eye || (a.id < b.id ? -1 : 1))[0];
  if (!pick) return null;
  const rng = ctx.rng.fork("notice", d.event, ctx.windowIndex ?? ctx.now);
  if (!rng.chance(NOTICE_HAZARD)) return null;
  const p = discoveryChance(d.real, d.believed, pick.eye, used, true);
  return rng.chance(p) ? pick.id : null;
}

/** El rumor de la estafa en la cabeza de `who` (el tercero lo vio: 0 saltos; el comprador lo oyó: 1). Puro. */
function withScamRumor(
  before: Rumors | undefined,
  d: ScamDeal,
  victim: AgentId,
  now: Tick,
  hops: number,
  teller: AgentId,
): Rumors {
  const heard: HeardRumor = {
    root: d.event,
    content: { kind: "default", by: d.seller, victim, severity: 1 },
    at: d.tick,
    heardAt: now,
    confidence: NOTICE_CONFIDENCE,
    hops,
    variant: `${d.event}#${hops === 0 ? teller : victim}`,
    parent: null,
    teller: hops === 0 ? null : teller,
    voices: 1,
  };
  const items = [...(before?.items ?? []).filter((x) => x.root !== d.event), heard];
  return { items: items.slice(-KEPT_RUMORS), told: before?.told ?? [] };
}
