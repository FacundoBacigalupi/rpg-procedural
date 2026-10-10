// Arriendos entre hogares (property §tenencia, economy: renta). Explícitos y opt-in: sin
// `RentSeed` no hay filas, ni eventos, ni RNG, así que la aldea por defecto no cambia. Una semilla
// es un arriendo ya decidido (dueño de la parcela, hogar arrendatario, canon por día en una
// moneda, plazo); al llegar su día el proceso diario lo abre con el evento `property.leased`
// (causa: la semilla, estado del hogar dueño) y crea la entidad `commitment:N` con `RENTS`, que
// guarda el `Commitment` contractual (kind "lease") y lo pagado. Cada día el arrendatario paga el
// canon con lo que tiene (`property.rent_paid`, por ledger: conserva); lo que no alcanza queda
// como atraso. Al vencer queda cumplido o en mora. `rentsOf` entrega las rentas vigentes de un
// hogar como `RentCollected` para `BudgetEnv.rents`. Tabla propia (escritor único).

import {
  type AgentId,
  type EntityRef,
  type HolderRef,
  holderAccount,
  type LedgerAccount,
  ledgerUnit,
  type PlaceRef,
  type PlanetClock,
  type Transfer,
} from "../../core/index.ts";
import {
  type Commitment,
  draftEvent,
  ENTITY,
  type EventDraft,
  type GoodDef,
  goodUnit,
  PARCEL,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type RentCollected,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";

export const RENTS_PROCESS = "life.rents";

export interface RentRow {
  readonly seed: string;
  readonly landlord: string;
  readonly tenant: string;
  readonly parcel: string;
  readonly unit: string;
  readonly perDay: number;
  /** Primer día de cobro y día en que vence (exclusive). */
  readonly startDay: number;
  readonly endDay: number;
  /** Lo pagado hasta hoy y lo que quedó sin pagar por falta de fondos. */
  readonly paid: number;
  readonly arrears: number;
  readonly status: "active" | "fulfilled" | "defaulted";
  readonly commitment: Commitment;
}

/** Cada arriendo vive en una entidad `commitment:n` con este componente. Solo lo escribe `life.rents`. */
export const RENTS = table<RentRow>("economy.rents");

/** Un arriendo decidido de antemano: la única fuente de arriendos hasta que los hogares sin tierra los busquen. */
export interface RentSeed {
  readonly id: string;
  readonly landlord: string;
  readonly tenant: string;
  /** Parcela arrendada (`parcel:N`); debe existir. */
  readonly parcel: string;
  /** Bien del canon (una moneda); canon entero por día. */
  readonly good: string;
  readonly perDay: number;
  readonly startDay: number;
  readonly termDays: number;
}

export interface RentsOptions {
  readonly clock: PlanetClock;
  readonly goods: readonly GoodDef[];
  readonly seeds: readonly RentSeed[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

const acct = (home: string): LedgerAccount => holderAccount(home as unknown as HolderRef);

export function rentRows(truth: ReadonlyWorldTruth): { id: string; rent: RentRow }[] {
  return [...truth.ids(RENTS)]
    .sort()
    .map((id) => ({ id: id as string, rent: truth.get(RENTS, id) as RentRow }));
}

/** Las rentas que el hogar `landlord` cobra y siguen vigentes, para `BudgetEnv.rents`. */
export function rentsOf(truth: ReadonlyWorldTruth, landlord: string): RentCollected[] {
  const out: RentCollected[] = [];
  for (const id of [...truth.ids(RENTS)].sort()) {
    const r = truth.get(RENTS, id);
    if (r && r.status === "active" && r.landlord === landlord) {
      out.push({ perDay: r.perDay, fromDay: r.startDay, untilDay: r.endDay });
    }
  }
  return out;
}

function leaseCommitment(
  id: string,
  s: RentSeed,
  unit: string,
  today: number,
  origin: string,
): Commitment {
  return {
    id,
    kind: "lease",
    basis: "agreement",
    parties: [
      { ref: s.landlord, role: "landlord" },
      { ref: s.tenant, role: "tenant" },
    ],
    obligations: [
      {
        id: `${id}#rent`,
        debtor: s.tenant,
        creditor: s.landlord,
        duty: { kind: "deliver", unit, qty: s.perDay * s.termDays },
        dueDay: today + 1 + s.termDays,
        state: "pending",
        performed: 0,
      },
    ],
    guarantees: [{ kind: "collateral", ref: s.parcel, held: "creditor" }],
    enforcers: [
      { kind: "conscience", reads: "belief" },
      { kind: "counterparty", reads: "belief" },
    ],
    status: "active",
    term: { startDay: today + 1, endDay: today + 1 + s.termDays },
    originEventId: origin,
    history: [],
  };
}

export function rentsProcess(o: RentsOptions): ProcessDef {
  const goodDef = new Map(o.goods.map((g) => [g.id, g]));
  return {
    id: RENTS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    reads: [PERSON.name, ENTITY.name, RENTS.name, PARCEL.name],
    writes: [RENTS.name, ENTITY.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger || o.seeds.length === 0) return {};
      const today = Math.floor(ctx.now / o.clock.day);
      const firstAlive = (home: string): AgentId | undefined => {
        for (const id of [...ctx.truth.ids(PERSON)].sort()) {
          if (ctx.truth.get(PERSON, id)?.household !== home) continue;
          if (ctx.truth.get(ENTITY, id)?.endedAt === undefined) return id as AgentId;
        }
        return undefined;
      };
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const changes: StateChange[] = [];
      const rows = rentRows(ctx.truth);
      const known = new Set(rows.map((r) => r.rent.seed));

      // Abrir: las semillas cuyo día llegó, con parcela existente y ambos hogares vivos.
      for (const s of [...o.seeds].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
        if (known.has(s.id) || s.startDay > today) continue;
        const def = goodDef.get(s.good);
        const landMan = firstAlive(s.landlord);
        const tenMan = firstAlive(s.tenant);
        if (!def || !landMan || !tenMan || !ctx.truth.get(PARCEL, s.parcel as never)) continue;
        if (!(s.perDay > 0) || !Number.isInteger(s.perDay) || s.termDays <= 0) continue;
        const id = ctx.newId("commitment");
        const k = events.length;
        const unit = goodUnit(def) as string;
        events.push({
          kind: "property.leased",
          actors: [landMan, tenMan],
          place: o.placeOf(ctx.truth, landMan),
          data: {
            rent: id,
            seed: s.id,
            parcel: s.parcel,
            unit,
            perDay: s.perDay,
            endDay: today + 1 + s.termDays,
          },
          emissions: {},
          causes: [
            { kind: "state", entity: s.landlord as unknown as EntityRef, key: `rent-seed:${s.id}` },
          ],
        });
        const row: RentRow = {
          seed: s.id,
          landlord: s.landlord,
          tenant: s.tenant,
          parcel: s.parcel,
          unit,
          perDay: s.perDay,
          startDay: today + 1,
          endDay: today + 1 + s.termDays,
          paid: 0,
          arrears: 0,
          status: "active",
          commitment: leaseCommitment(
            id as string,
            s,
            unit,
            today,
            draftEvent(k) as unknown as string,
          ),
        };
        changes.push(
          setComponent(
            ENTITY,
            id as never,
            { id, originEventId: draftEvent(k), createdAt: ctx.now } as never,
          ),
          setComponent(RENTS, id as never, row),
        );
      }

      // Cobrar: los activos de antes (los recién abiertos empiezan mañana). Cada arriendo
      // paga de la cuenta del arrendatario; con varios arriendos el saldo ya gastado cuenta.
      const spent = new Map<string, number>();
      for (const r of rows) {
        const l = r.rent;
        if (l.status !== "active" || today < l.startDay) continue;
        const landMan = firstAlive(l.landlord);
        const tenMan = firstAlive(l.tenant);
        if (!landMan || !tenMan) continue;
        const k = events.length;
        const u = ledgerUnit(l.unit);
        const sk = `${l.tenant}|${l.unit}`;
        const have = Math.floor(ledger.balance(acct(l.tenant), u) ?? 0) - (spent.get(sk) ?? 0);
        const pay = Math.max(0, Math.min(l.perDay, have));
        const paid = l.paid + pay;
        const arrears = l.arrears + (l.perDay - pay);
        const ended = today + 1 >= l.endDay;
        const total = l.perDay * (l.endDay - l.startDay);
        const status: RentRow["status"] = !ended
          ? "active"
          : paid >= total
            ? "fulfilled"
            : "defaulted";
        if (pay === 0 && status === "active") {
          changes.push(setComponent(RENTS, r.id as never, { ...l, arrears }));
          continue;
        }
        events.push({
          kind: "property.rent_paid",
          actors: [tenMan, landMan],
          place: o.placeOf(ctx.truth, tenMan),
          data: { rent: r.id, paid: pay, arrears, status },
          emissions: {},
          causes: [
            { kind: "event" as const, event: l.commitment.originEventId as never },
            { kind: "state" as const, entity: r.id as unknown as EntityRef, key: "rent" },
          ],
        });
        if (pay > 0) {
          const ts: Transfer[] = [
            { unit: u, from: acct(l.tenant), to: acct(l.landlord), amount: pay },
          ];
          postings.push({ event: draftEvent(k), transfers: ts });
          spent.set(sk, (spent.get(sk) ?? 0) + pay);
        }
        const c = l.commitment;
        const ob = c.obligations[0];
        const next: RentRow = {
          ...l,
          paid,
          arrears,
          status,
          commitment: {
            ...c,
            status: status === "active" ? "active" : status,
            obligations: ob
              ? [
                  {
                    ...ob,
                    performed: Math.min(ob.duty.qty, paid),
                    state:
                      status === "fulfilled"
                        ? "fulfilled"
                        : status === "defaulted"
                          ? "defaulted"
                          : "partial",
                  },
                ]
              : c.obligations,
            history: status === "active" ? c.history : [...c.history, `rent.${status}`],
          },
        };
        changes.push(setComponent(RENTS, r.id as never, next));
      }

      if (events.length === 0 && changes.length === 0) return {};
      return { events, postings, changes };
    },
  };
}
