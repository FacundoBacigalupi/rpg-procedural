// Resolver dentro de life.loans mantiene un único escritor de los compromisos y un presupuesto
// compartido. Cada muerto se marca una vez; el origen es su evento real body.died.
import type { AgentId, Event, EventId, LedgerAccount, LedgerUnit } from "../../core/index.ts";
import { type HolderRef, holderAccount, makeId } from "../../core/index.ts";
import {
  adjustFace,
  draftEvent,
  ENTITY,
  type EventDraft,
  FACE,
  funeralExpense,
  type GoodDef,
  goodUnit,
  LOCATION,
  PERSON,
  PERSON_CULTURE,
  type PostingDraft,
  type ProcessContext,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";

export const FUNERALS = table<{ readonly event: string }>("life.funerals");

/** Configuración explícita: personas/proveedor/prestamista existentes, sin crearlos al morir. */
export interface FuneralOptions {
  /** Límite inferior persistible: no organizar muertes históricas anteriores a este tick. */
  readonly since: number;
  readonly provider: AgentId;
  readonly lender?: AgentId;
  readonly fee: number;
  readonly rate: number;
  readonly termDays: number;
  readonly unsecuredLimit: number;
  readonly materials: readonly { readonly good: string; readonly amount: number }[];
}

const account = (home: string) => holderAccount(home as unknown as HolderRef);

/** Rechaza configuración inválida antes de construir el scheduler o producir diffs. */
export function validateFuneralOptions(o: FuneralOptions, goods: readonly GoodDef[]): void {
  const integer = (n: number, min: number) => Number.isSafeInteger(n) && n >= min;
  if (
    !integer(o.since, 0) ||
    !integer(o.fee, 0) ||
    !integer(o.unsecuredLimit, 0) ||
    !integer(o.termDays, 1) ||
    o.termDays > 36500 ||
    !Number.isFinite(o.rate) ||
    o.rate < 0 ||
    o.rate > 1 ||
    !/^agent:\d+$/.test(o.provider) ||
    (o.lender !== undefined && !/^agent:\d+$/.test(o.lender)) ||
    o.materials.length === 0 ||
    o.materials.some((m) => !integer(m.amount, 1) || !goods.some((g) => g.id === m.good))
  ) {
    throw new TypeError("configuración funeraria inválida");
  }
}

export function resolveFunerals(
  ctx: ProcessContext,
  o: FuneralOptions,
  goods: readonly GoodDef[],
  day: number,
  balance: (account: LedgerAccount, unit: LedgerUnit) => number,
  apply: (transfers: readonly import("../../core/index.ts").Transfer[]) => void,
  events: EventDraft[],
  postings: PostingDraft[],
  changes: StateChange[],
  eventOf: (id: EventId) => Event | undefined,
  placeOf: (who: AgentId) => import("../../core/index.ts").PlaceRef,
  registerLoan: (loan: import("../../sim/index.ts").LoanCommitment, dead: string) => void,
): void {
  const copperDef = goods.find((g) => g.id === "copper");
  const provider = ctx.truth.get(PERSON, o.provider);
  const alive = (id: AgentId) => {
    const entity = ctx.truth.get(ENTITY, id);
    return entity !== undefined && entity.endedAt === undefined;
  };
  if (!copperDef || !provider || !alive(o.provider)) return;
  const copper = goodUnit(copperDef);
  const lender =
    o.lender !== undefined && alive(o.lender) ? ctx.truth.get(PERSON, o.lender) : undefined;
  const faces = new Map<AgentId, ReturnType<typeof adjustFace>>();
  for (const dead of [...ctx.truth.ids(PERSON)].sort()) {
    const base = ctx.truth.get(ENTITY, dead);
    if (
      base?.endedAt === undefined ||
      base.endedAt < o.since ||
      !base.endEventId ||
      ctx.truth.get(FUNERALS, dead)
    )
      continue;
    const death = eventOf(base.endEventId);
    if (death?.kind !== "body.died" || !death.actors.includes(dead as AgentId)) continue;
    const household = ctx.truth.get(PERSON, dead)?.household;
    const members = [...ctx.truth.ids(PERSON)]
      .sort()
      .filter((id) => ctx.truth.get(PERSON, id)?.household === household && alive(id as AgentId));
    const organizer = members[0] as AgentId | undefined;
    if (!household || !organizer || provider.household === household) continue;
    // El proveedor debe ver el rito: no se pierde cara públicamente por una muerte desconocida.
    const at = ctx.truth.get(LOCATION, organizer);
    const providerAt = ctx.truth.get(LOCATION, o.provider);
    if (!at || !providerAt || at.hex !== providerAt.hex || at.space !== providerAt.space) continue;
    const holding = ctx.truth.get(PERSON_CULTURE, organizer)?.holdings["funeral.rite"];
    if (holding?.variant !== "burial") continue;
    const materials = o.materials.map((m) => ({
      def: goods.find((g) => g.id === m.good),
      amount: m.amount,
    }));
    if (materials.some((m) => m.def === undefined)) continue;
    // La despensa es compartida; las monedas viven en bolsas personales de la aldea.
    const from = holderAccount(organizer);
    // La cuenta del muerto conserva ajuar separado del suelo genérico, recuperable por saqueo.
    const grave = holderAccount(dead as unknown as HolderRef);
    const stocks = new Map<LedgerUnit, number>([[copper, balance(from, copper)]]);
    const prepared: import("../../core/index.ts").Transfer[] = [];
    const needed = new Map<LedgerUnit, number>();
    for (const m of materials)
      if (m.def) {
        const unit = goodUnit(m.def);
        needed.set(unit, (needed.get(unit) ?? 0) + Math.max(0, Math.floor(m.amount)));
      }
    for (const [unit, wanted] of needed) {
      if (unit === copper) continue;
      const amount = Math.max(
        0,
        Math.min(wanted - balance(from, unit), balance(account(household), unit)),
      );
      if (amount > 0) prepared.push({ unit, from: account(household), to: from, amount });
      stocks.set(unit, balance(from, unit) + amount);
    }
    const k = events.length;
    const result = funeralExpense({
      household: from,
      stocks,
      copper,
      fee: o.fee,
      provider: holderAccount(o.provider),
      faceWeight: holding.strength,
      materials: materials.flatMap((m) =>
        m.def ? [{ unit: goodUnit(m.def), amount: m.amount, destination: grave }] : [],
      ),
      ...(lender && lender.household !== household
        ? {
            credit: {
              lenderCopper: balance(holderAccount(o.lender as AgentId), copper),
              terms: {
                id: makeId("commitment", 1),
                lender: lender.household,
                borrower: household,
                lenderAccount: holderAccount(o.lender as AgentId),
                rate: o.rate,
                startDay: day,
                dueDay: day + o.termDays,
                collateral: [],
                guarantors: [],
                unsecuredLimit: o.unsecuredLimit,
                originEventId: draftEvent(k),
              },
            },
          }
        : {}),
    });
    events.push({
      kind: "funeral.held",
      actors: [organizer, o.provider],
      place: placeOf(organizer),
      data: {
        deceased: dead,
        household,
        rite: "burial",
        grave,
        paid: result.paid,
        unpaid: result.unpaid,
        dignified: result.dignified,
        faceLoss: result.faceLoss,
        principal: result.loan?.principal ?? 0,
      },
      emissions: { sight: 0.6, sound: 0.2 },
      causes: [
        { kind: "event", event: death.id },
        { kind: "state", entity: organizer, key: "funeral.rite" },
      ],
    });
    const transfers = [...prepared, ...result.transfers];
    if (transfers.length) postings.push({ event: draftEvent(k), transfers });
    apply(transfers);
    changes.push(setComponent(FUNERALS, dead, { event: draftEvent(k) }));
    if (result.loan) {
      registerLoan({ ...result.loan, id: ctx.newId("commitment") }, dead);
    }
    if (result.faceLoss > 0)
      for (const member of members) {
        const id = member as AgentId;
        faces.set(
          id,
          adjustFace(faces.get(id) ?? ctx.truth.get(FACE, id), -result.faceLoss, ctx.now),
        );
      }
  }
  for (const [id, face] of faces) changes.push(setComponent(FACE, id, face));
}
