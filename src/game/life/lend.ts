// Pedir prestada la sustancia, de verdad (opt-in): quien decidió `speak:<prestamista>+borrow:<bien>`
// (`decide`, `borrowCraving`) y está con el prestamista le hace el pedido. El prestamista decide
// según lo que siente por quien pide (confianza, afecto, daño que le consta) y según lo que HAY en
// su despensa (la verdad del libro mayor, no lo que cree el que pide). Si accede, pasa una dosis de
// su despensa a la del que pide (conservación) con un `household.borrowed` que cita la decisión y
// que `life.credit` convierte en deuda (el `Commitment` liviano del fiado: se devuelve con un `give`).
// Si no la tiene, el que pidió corrige lo que creía: el rumor `has` pierde confianza (y se borra si
// queda por debajo de `dropBelow`). Si no quiere, el rumor queda y hay un `substance.borrow_refused`.
// Un pedido por día por persona. Apagado: el pedido sigue siendo solo una candidata que no hace nada.

import {
  type AgentId,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type Tick,
} from "../../core/index.ts";
import {
  type BondDef,
  CREDIT,
  type DimensionDef,
  draftEvent,
  ENTITY,
  type GoodDef,
  goodUnit,
  KNOWN_DEEDS,
  LOCATION,
  MIND,
  PERSON,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  relationship,
  setComponent,
  table,
  worstDeed,
} from "../../sim/index.ts";
import { creditRows } from "./credit.ts";
import { NPC_DECISION } from "./decide.ts";
import { MOLD_RUMORS } from "./moldgossip.ts";
import { NEIGHBOR_STANDING, neighborStandingKnown } from "./neighbors.ts";

export const LEND_PROCESS = "life.lend";

/** Cuándo pidió por última vez (un pedido por día). */
export const LEND_LOG = table<{ readonly at: Tick }>("life.lend_log");

export interface LendOptions {
  readonly goods: readonly GoodDef[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly day: number;
  /** El jugador decide por su cuenta: queda afuera. */
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Unidades que presta por pedido (1 = una dosis). */
  readonly units?: number;
  /** Lo que se queda el prestamista antes de prestar (unidades; 0 por defecto). */
  readonly keep?: number;
  /** Cuánto se multiplica la confianza en el rumor `has` si el prestamista no lo tenía (0.25 por defecto). */
  readonly weaken?: number;
  /** Con menos confianza que esto el rumor se borra (0.1 por defecto). */
  readonly dropBelow?: number;
  /** Opt-in: el prestamista presta menos al hogar que CREE apretado o en la ruina (creencia, no verdad). */
  readonly heedStanding?: HeedStanding;
}

/** Cuánto pesa en el prestamista lo que cree del apuro del hogar que pide (multiplicadores de 0 a 1). */
export interface HeedStanding {
  /** Si cree que anda apretado (0.6 por defecto). */
  readonly tight?: number;
  /** Si cree que está en la ruina (0.2 por defecto). */
  readonly broke?: number;
}

/**
 * Multiplicador de la gana de prestar según lo que `lender` CREE del apuro de `home` (puro, nunca
 * la verdad): lo que vio él mismo (`NEIGHBOR_STANDING`, confianza 1) o lo que oyó (rumor `standing`
 * en `MOLD_RUMORS`, ponderado por su confianza). Sin nada creído: 1. Toma lo más cauto.
 */
export function standingCaution(
  truth: ReadonlyWorldTruth,
  lender: AgentId,
  home: string,
  heed: HeedStanding,
): number {
  const mult = (s: "tight" | "broke") =>
    s === "broke" ? (heed.broke ?? 0.2) : (heed.tight ?? 0.6);
  let out = 1;
  const seen = neighborStandingKnown(truth.get(NEIGHBOR_STANDING, lender), home);
  if (seen) out = Math.min(out, mult(seen.standing));
  for (const h of truth.get(MOLD_RUMORS, lender)?.items ?? []) {
    const r = h.rumor;
    if (r.mold !== "attr" || r.attr !== "standing" || r.about !== home) continue;
    if (r.value !== "tight" && r.value !== "broke") continue;
    out = Math.min(out, 1 - clamp01(h.confidence) * (1 - mult(r.value)));
  }
  return out;
}

const DECISION_ID = /^speak:(.+)\+borrow:(.+)$/;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function lendProcess(o: LendOptions): ProcessDef {
  const units = o.units ?? 1;
  const keep = o.keep ?? 0;
  const weaken = o.weaken ?? 0.25;
  const dropBelow = o.dropBelow ?? 0.1;
  return {
    id: LEND_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "act",
    reads: [
      NEIGHBOR_STANDING.name,
      NPC_DECISION.name,
      PERSON.name,
      ENTITY.name,
      LOCATION.name,
      RELATIONS.name,
      MIND.name,
      KNOWN_DEEDS.name,
      MOLD_RUMORS.name,
      LEND_LOG.name,
    ],
    writes: [MOLD_RUMORS.name, LEND_LOG.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      const ledger = ctx.ledger;
      if (!ledger || me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      const decision = truth.get(NPC_DECISION, me);
      if (decision?.verb !== "speak" || ctx.now - decision.at >= o.day) return {};
      const m = DECISION_ID.exec(decision.id);
      if (!m) return {};
      const lender = m[1] as AgentId;
      const name = m[2] as string;
      const last = truth.get(LEND_LOG, me);
      if (last && ctx.now - last.at < o.day) return {};
      const here = truth.get(LOCATION, me);
      const there = truth.get(LOCATION, lender);
      if (!here || !there || here.hex !== there.hex || here.space !== there.space) return {};
      const good = o.goods.find((g) => g.name === name);
      const myHome = truth.get(PERSON, me)?.household;
      const hisHome = truth.get(PERSON, lender)?.household;
      if (!good || myHome === undefined || hisHome === undefined || myHome === hisHome) return {};

      const unit = goodUnit(good);
      const lenderAlive = truth.get(ENTITY, lender)?.endedAt === undefined;
      const has = lenderAlive
        ? ledger.balance(holderAccount(hisHome as unknown as HolderRef), unit)
        : 0;
      const place = o.placeOf(truth, me);
      const asked = { kind: "state", entity: me, key: "utility" } as const;
      const log = setComponent(LEND_LOG, me, { at: ctx.now });

      if (has < units + keep) {
        // Lo que creía no era cierto: el rumor pierde confianza (o se borra).
        const book = truth.get(MOLD_RUMORS, me);
        const items = (book?.items ?? []).flatMap((h) => {
          const r = h.rumor;
          if (r.mold !== "attr" || r.attr !== "has" || r.about !== lender || r.value !== name) {
            return [h];
          }
          const confidence = Math.round(h.confidence * weaken * 1e6) / 1e6;
          return confidence < dropBelow ? [] : [{ ...h, confidence }];
        });
        return {
          changes: [log, ...(book ? [setComponent(MOLD_RUMORS, me, { ...book, items })] : [])],
          events: [
            {
              kind: "substance.borrow_missed",
              actors: [me, lender],
              place,
              data: { good: good.id, name },
              emissions: { sight: 0.2, sound: 0.2 },
              causes: [asked, { kind: "state", entity: lender, key: "larder" }],
            },
          ],
        };
      }

      // Si accede: según lo que siente por quien pide y el daño que le consta.
      const rel = relationship(truth.get(RELATIONS, lender), me, ctx.now, {
        dims: o.dims,
        bonds: o.bonds,
        schemaStrength: (s) => truth.get(MIND, lender)?.schemas[s]?.strength ?? 0,
      });
      const harmed = worstDeed(truth.get(KNOWN_DEEDS, lender), me) !== null;
      const base = harmed ? 0 : clamp01(0.4 + 0.4 * rel.dims.trust + 0.2 * rel.dims.affection);
      const willing = o.heedStanding
        ? base * standingCaution(truth, lender, myHome, o.heedStanding)
        : base;
      if (!ctx.rng.fork("lend", me, ctx.now).chance(willing)) {
        return {
          changes: [log],
          events: [
            {
              kind: "substance.borrow_refused",
              actors: [me, lender],
              place,
              data: { good: good.id, name },
              emissions: { sight: 0.2, sound: 0.2 },
              causes: [asked],
            },
          ],
        };
      }
      const ev = draftEvent(0);
      return {
        changes: [log],
        events: [
          {
            kind: "household.borrowed",
            actors: [lender, me],
            place,
            data: {
              credit: { unit, grams: units },
              from: hisHome,
              to: myHome,
              substance: good.id,
            },
            emissions: { sight: 0.2, sound: 0.2 },
            causes: [asked, { kind: "state", entity: lender, key: "larder" }],
          },
        ],
        postings: [
          {
            event: ev,
            transfers: [
              {
                unit,
                from: holderAccount(hisHome as unknown as HolderRef),
                to: holderAccount(myHome as unknown as HolderRef),
                amount: units,
              },
            ],
          },
        ],
      };
    },
  };
}

export const REPAY_DOSE_PROCESS = "life.repay_dose";

export interface RepayDoseOptions {
  readonly goods: readonly GoodDef[];
  /** Ids de los bienes que son sustancias (`ConsumableDef.good`): solo esas deudas se devuelven acá. */
  readonly substances: readonly string[];
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/**
 * Devolver la dosis prestada en especie (opt-in): una vez por día, el hogar que debe una sustancia
 * y ya la tiene en su despensa (la consiguió por compra, recolección o cosecha) la pasa al hogar
 * del prestamista por el libro mayor. El `household.repaid` descuenta el fiado (`life.credit`) y
 * sube la confianza (appraise). Si no la devuelve, el vencimiento (`life.arrears`) la declara
 * mora y baja la confianza; nada se cobra solo.
 */
export function repayDoseProcess(o: RepayDoseOptions): ProcessDef {
  const units = new Map<string, string>();
  for (const g of o.goods) if (o.substances.includes(g.id)) units.set(goodUnit(g), g.id);
  return {
    id: REPAY_DOSE_PROCESS,
    system: "life",
    scope: "household",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    reads: [PERSON.name, ENTITY.name, CREDIT.name],
    writes: [],
    run(ctx) {
      const ledger = ctx.ledger;
      const home = ctx.scope as string;
      if (!ledger || units.size === 0) return {};
      const mine = ctx.truth
        .ids(PERSON)
        .filter(
          (id) =>
            ctx.truth.get(PERSON, id)?.household === home &&
            ctx.truth.get(ENTITY, id)?.endedAt === undefined,
        );
      if (mine.length === 0 || mine.includes(o.player)) return {};
      const row = creditRows(ctx.truth)
        .filter(
          (r) =>
            mine.includes(r.credit.debtor) &&
            units.has(r.credit.unit) &&
            r.credit.status !== "settled" &&
            r.credit.owed > 0 &&
            ctx.truth.get(ENTITY, r.credit.creditor)?.endedAt === undefined,
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
      if (!row) return {};
      const creditorHome = ctx.truth.get(PERSON, row.credit.creditor)?.household;
      if (creditorHome === undefined || creditorHome === home) return {};
      const held = ledger.balance(holderAccount(home as unknown as HolderRef), row.credit.unit);
      const amount = Math.min(row.credit.owed, Math.floor(held));
      if (amount <= 0) return {};
      const paid = draftEvent(0);
      return {
        events: [
          {
            kind: "household.repaid",
            actors: [row.credit.debtor, row.credit.creditor],
            place: o.placeOf(ctx.truth, row.credit.debtor),
            data: { payment: { unit: row.credit.unit, grams: amount, credit: row.id } },
            emissions: { sight: 0.2 },
            causes: [{ kind: "state", entity: row.id as never, key: "owed" }],
          },
        ],
        postings: [
          {
            event: paid,
            transfers: [
              {
                unit: row.credit.unit,
                from: holderAccount(home as unknown as HolderRef),
                to: holderAccount(creditorHome as unknown as HolderRef),
                amount,
              },
            ],
          },
        ],
      };
    },
  };
}
