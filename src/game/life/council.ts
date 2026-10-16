// Consejo de aldea 1 (organizations §11 «Nacimiento», «Familia que acumula» / aldea): el módulo puro
// `sim/org` cableado a la vida. Cada día de mundo, por cada asentamiento con hogares vivos que
// todavía no tiene consejo, se eligen sus ancianos reales (los de más edad y respeto de sus hogares)
// y, si llegan al mínimo, se funda una entidad `org:n` con `ORG`: evento `org.founded` (causa: la
// fundación del asentamiento), `originEventId` = ese evento, fundadores, membresía y puestos. Cuando
// un miembro muere se cierra su membresía y el puesto queda vacante (`org.member_left`, causa: su
// muerte). Todavía no decide nada (ni reparte, ni defiende, ni cobra): eso es «Consejo de aldea
// 2-5» del ROADMAP. Opt-in (`LifeParts.council`); apagado no existe ni corre ni cambia hashes.

import {
  type AgentId,
  type EntityRef,
  type EventId,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type SettlementId,
  type Transfer,
} from "../../core/index.ts";
import {
  type Agenda,
  activeMembers,
  addOrder,
  admitMember,
  assumeAmount,
  type CouncilRules,
  chooseElders,
  chooseRaiser,
  closeIssue,
  closeOrder,
  DEFAULT_COUNCIL_RULES,
  DEFAULT_ISSUE_RULES,
  DEFAULT_ORDER_RULES,
  deliberate,
  draftEvent,
  type ElderCandidate,
  EMPTY_AGENDA,
  EMPTY_BOOK,
  ENTITY,
  type EventDraft,
  electHead,
  fillHead,
  foundCouncil,
  type GoodDef,
  goodUnit,
  HEAD_POSITION,
  HOUSEHOLD,
  headClaim,
  headVacant,
  type Issue,
  type IssueRules,
  isMember,
  lapse,
  ORG,
  ORG_AGENDA,
  ORG_ORDERS,
  type Order,
  type OrderBook,
  type OrderRules,
  type Organization,
  obedienceChance,
  obeys,
  oldestVacancy,
  openIssue,
  openOrders,
  openSeats,
  orderFrom,
  outstanding,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  recentlyHandled,
  type StateChange,
  type SuccessionCandidate,
  setComponent,
  spendable,
  withdrawMember,
} from "../../sim/index.ts";
import {
  type IssuesOptions,
  type PressureSignal,
  perceiveAll,
  scanPressures,
} from "./council-issues.ts";
import { LOANS } from "./loans.ts";

export const COUNCIL_PROCESS = "life.council";
export const ORG_FOUNDED_EVENT = "org.founded";
export const ORG_MEMBER_LEFT_EVENT = "org.member_left";
export const ORG_POSITION_FILLED_EVENT = "org.position_filled";
export const ORG_MEMBER_JOINED_EVENT = "org.member_joined";
export const ORG_ISSUE_RAISED_EVENT = "org.issue_raised";
export const ORG_DECIDED_EVENT = "org.decided";
export const ORG_ISSUE_LAPSED_EVENT = "org.issue_lapsed";
export const ORG_CONTRIBUTED_EVENT = "org.contributed";
export const ORG_ORDERED_EVENT = "org.ordered";
export const ORG_ORDER_EXECUTED_EVENT = "org.order_executed";
export const ORG_ORDER_REFUSED_EVENT = "org.order_refused";
export const ORG_ORDER_FAILED_EVENT = "org.order_failed";

/** Una contribución al tesoro: cada miembro da `amount` del bien de la despensa de su hogar, si le sobra `keep`. */
export interface Contribution {
  readonly good: string;
  /** Unidades (gramos de grano, piezas de moneda) por miembro y período. */
  readonly amount: number;
  /** Lo que el hogar tiene que conservar después de dar. */
  readonly keep?: number;
}

/**
 * Consejo de aldea 4: el tesoro del consejo (una cuenta del ledger, `holderAccount(orgId)`) y las
 * órdenes. Opt-in; sin esto no hay cuenta, aportes, libro ni órdenes.
 */
export interface TreasuryOptions {
  /** Aportes periódicos de los miembros (por defecto 10 kg de grano, si al hogar le quedan 60 kg). */
  readonly contribute?: readonly Contribution[];
  /** Cada cuántos días de mundo aporta (30 por defecto). */
  readonly everyDays?: number;
  /** Con esto las decisiones aprobadas se vuelven órdenes que ejecutan los miembros; requiere `issues`. */
  readonly orders?: Partial<OrderRules>;
}

const DEFAULT_CONTRIBUTIONS: readonly Contribution[] = [
  { good: "grain", amount: 10000, keep: 60000 },
];

/**
 * El respeto que la aldea le tiene a `who`: lo que sus vecinos sienten de verdad (RELATIONS,
 * `respect` positivo, tal cual guardado) sumado y dividido por los otros vecinos, tope 1. Sin
 * relaciones registradas pesa 0.
 */
export function communityRespect(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  peers: readonly AgentId[],
): number {
  let sum = 0;
  let n = 0;
  for (const p of peers) {
    if (p === who) continue;
    n++;
    sum += Math.max(0, truth.get(RELATIONS, p)?.toward[who as string]?.dims.respect ?? 0);
  }
  return n === 0 ? 0 : Math.min(1, Math.round((sum / n) * 1e6) / 1e6);
}

export interface CouncilOptions {
  /** Reglas del consejo (asientos, edad mínima, mínimo para fundar); por defecto `DEFAULT_COUNCIL_RULES`. */
  readonly rules?: Partial<CouncilRules>;
  /** Respeto creído (0-1) que la aldea le tiene a alguien; sin esto cuenta solo la edad. */
  readonly respectOf?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  /** `"relations"`: el respeto sale de RELATIONS (`communityRespect`); `respectOf` tiene prioridad. */
  readonly respect?: "relations";
  /** `false` apaga la sucesión del cabeza y la reposición de asientos (queda solo la fundación y las salidas). */
  readonly succession?: boolean;
  /**
   * Opt-in (Consejo de aldea 3): asuntos y deliberación. Presiones reales de la aldea (hambre,
   * deuda en mora, disputa) que un miembro percibe y plantea; el consejo delibera y decide. Sin
   * esto no hay agenda ni eventos de asuntos. Usa `goods` para medir la despensa.
   */
  readonly issues?: IssuesOptions;
  /** Opt-in (Consejo de aldea 4): tesoro con aportes y órdenes con efecto acotado. */
  readonly treasury?: TreasuryOptions;
  /** Bienes de la aldea (los inyecta el mundo); la despensa de los hogares se mide con ellos. */
  readonly goods?: readonly GoodDef[];
  /** Ticks por día de mundo. */
  readonly day: number;
  /** Ticks por año de mundo (para la edad). */
  readonly year: number;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Los consejos existentes, en orden de id. */
export function councilRows(truth: ReadonlyWorldTruth): { id: string; org: Organization }[] {
  return [...truth.ids(ORG)]
    .sort()
    .map((id) => ({ id: id as string, org: truth.get(ORG, id) as Organization }));
}

export function councilProcess(o: CouncilOptions): ProcessDef {
  const rules: CouncilRules = { ...DEFAULT_COUNCIL_RULES, ...o.rules };
  const ordersOn = o.treasury?.orders !== undefined && o.issues !== undefined;
  const orderRules: OrderRules = { ...DEFAULT_ORDER_RULES, ...o.treasury?.orders };
  return {
    id: COUNCIL_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [
      ORG.name,
      ENTITY.name,
      PERSON.name,
      HOUSEHOLD.name,
      RELATIONS.name,
      ...(o.issues ? [ORG_AGENDA.name, LOANS.name] : []),
      ...(ordersOn ? [ORG_ORDERS.name] : []),
    ],
    writes: [
      ORG.name,
      ENTITY.name,
      ...(o.issues ? [ORG_AGENDA.name] : []),
      ...(ordersOn ? [ORG_ORDERS.name, RELATIONS.name] : []),
    ],
    run(ctx) {
      const truth = ctx.truth;
      const postings: PostingDraft[] = [];
      // Saldos del ledger con lo ya asentado en esta corrida (el tesoro no gasta dos veces lo mismo).
      const moved = new Map<string, number>();
      const bal = (acct: string, unit: string): number =>
        (ctx.ledger?.balance(acct as never, unit as never) ?? 0) +
        (moved.get(`${acct}|${unit}`) ?? 0);
      const post = (ev: EventId, transfers: readonly Transfer[]): void => {
        for (const t of transfers) {
          moved.set(`${t.from}|${t.unit}`, (moved.get(`${t.from}|${t.unit}`) ?? 0) - t.amount);
          moved.set(`${t.to}|${t.unit}`, (moved.get(`${t.to}|${t.unit}`) ?? 0) + t.amount);
        }
        postings.push({ event: ev, transfers });
      };
      const unitOf = (good: string) => {
        const def = (o.goods ?? []).find((g) => g.id === good);
        return def ? goodUnit(def) : undefined;
      };
      const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const founded = new Set<string>();
      const updated = new Map<string, { before: Organization; after: Organization }>();

      // Salidas por muerte de los consejos que ya existen.
      for (const { id, org } of councilRows(truth)) {
        founded.add(org.settlement);
        let next = org;
        for (const m of org.members) {
          if (m.until !== undefined || alive(m.agent)) continue;
          const dead = truth.get(ENTITY, m.agent);
          const cause = dead?.endEventId ?? org.originEventId;
          next = withdrawMember(next, m.agent, {
            at: dead?.endedAt ?? ctx.now,
            kind: "death",
            event: cause,
          });
          events.push({
            kind: ORG_MEMBER_LEFT_EVENT,
            actors: [m.agent],
            place: o.placeOf(truth, m.agent),
            data: { org: id, agent: m.agent, exit: "death", status: next.status },
            emissions: {},
            causes: [{ kind: "event", event: cause }],
          });
        }
        updated.set(id, { before: org, after: next });
      }

      // Gente viva de los hogares vivos, por asentamiento.
      const peopleOf = new Map<SettlementId, AgentId[]>();
      for (const hid of [...truth.ids(HOUSEHOLD)].sort()) {
        const h = truth.get(HOUSEHOLD, hid);
        if (!h) continue;
        if (truth.get(ENTITY, hid)?.endedAt !== undefined) continue;
        for (const who of h.members) {
          if (!truth.get(PERSON, who) || !alive(who)) continue;
          const list = peopleOf.get(h.settlement) ?? [];
          list.push(who);
          peopleOf.set(h.settlement, list);
        }
      }
      const respectIn = (who: AgentId, settlement: SettlementId): number | undefined =>
        o.respectOf
          ? o.respectOf(truth, who)
          : o.respect === "relations"
            ? communityRespect(truth, who, peopleOf.get(settlement) ?? [])
            : undefined;
      const candidate = (who: AgentId, settlement: SettlementId): ElderCandidate => {
        const respect = respectIn(who, settlement);
        return {
          agent: who,
          ageYears: (ctx.now - (truth.get(PERSON, who)?.born ?? ctx.now)) / o.year,
          ...(respect !== undefined ? { respect } : {}),
        };
      };

      // Sucesión: el cabeza vacante lo ocupa el miembro con más legitimidad y los asientos que
      // dejó la muerte los reponen nuevos ancianos (cooptados). Solo con `succession`.
      if (o.succession !== false) {
        for (const [id, u] of updated) {
          const org = u.after;
          if (org.status !== "active") continue;
          let next = org;
          const people = peopleOf.get(org.settlement) ?? [];
          if (headVacant(next)) {
            const info = new Map<AgentId, SuccessionCandidate>();
            for (const m of activeMembers(next))
              info.set(m.agent, candidate(m.agent, org.settlement));
            const who = electHead(next, info, ctx.now, o.year);
            if (who !== null) {
              const vac = next.positions.find((p) => p.id === HEAD_POSITION);
              const ev = draftEvent(events.length);
              const prev = next;
              next = fillHead(next, who, ctx.now, ev);
              events.push({
                kind: ORG_POSITION_FILLED_EVENT,
                actors: [who],
                place: o.placeOf(truth, who),
                data: {
                  org: id,
                  position: HEAD_POSITION,
                  agent: who,
                  claim: headClaim(
                    activeMembers(prev).find((m) => m.agent === who) as never,
                    info.get(who) as SuccessionCandidate,
                    ctx.now,
                    o.year,
                  ),
                },
                emissions: {},
                causes: vac?.vacatedBy ? [{ kind: "event", event: vac.vacatedBy }] : [],
              });
            }
          }
          let seats = openSeats(next, rules);
          if (seats > 0) {
            const members = new Set(activeMembers(next).map((m) => m.agent as string));
            const pool = chooseElders(
              people.filter((p) => !members.has(p)).map((p) => candidate(p, org.settlement)),
              { ...rules, seats, minSeats: 1 },
            );
            for (const c of pool) {
              if (seats-- <= 0) break;
              const seat = oldestVacancy(next);
              const ev = draftEvent(events.length);
              next = admitMember(next, c.agent, ctx.now, ev);
              events.push({
                kind: ORG_MEMBER_JOINED_EVENT,
                actors: [c.agent],
                place: o.placeOf(truth, c.agent),
                data: { org: id, agent: c.agent, via: "coopted", replaces: seat?.agent },
                emissions: {},
                causes: seat?.exitEventId ? [{ kind: "event", event: seat.exitEventId }] : [],
              });
            }
          }
          u.after = next;
        }
      }
      for (const [id, u] of updated)
        if (u.after !== u.before) changes.push(setComponent(ORG, id as never, u.after));

      // Tesoro: cada período los miembros aportan de la despensa de su hogar lo que les sobra.
      if (o.treasury && ctx.ledger) {
        const today = Math.floor(ctx.now / o.day);
        const every = Math.max(1, o.treasury.everyDays ?? 30);
        if (today > 0 && today % every === 0)
          for (const [id, u] of updated) {
            if (u.after.status !== "active") continue;
            const vault = holderAccount(id as unknown as HolderRef);
            for (const m of activeMembers(u.after)) {
              const home = truth.get(PERSON, m.agent)?.household as string | undefined;
              if (home === undefined) continue;
              const from = holderAccount(home as unknown as HolderRef);
              for (const c of o.treasury.contribute ?? DEFAULT_CONTRIBUTIONS) {
                const unit = unitOf(c.good);
                const amount = Math.floor(c.amount);
                if (!unit || amount <= 0 || bal(from, unit) - amount < (c.keep ?? 0)) continue;
                const ev = draftEvent(events.length);
                events.push({
                  kind: ORG_CONTRIBUTED_EVENT,
                  actors: [m.agent],
                  place: o.placeOf(truth, m.agent),
                  data: { org: id, agent: m.agent, home, good: c.good, amount },
                  emissions: {},
                  causes: [{ kind: "event", event: u.after.originEventId }],
                });
                post(ev, [{ from, to: vault, unit, amount }]);
              }
            }
          }
      }

      // Asuntos y deliberación (opt-in).
      if (o.issues) {
        const iopts = o.issues;
        const irules: IssueRules = { ...DEFAULT_ISSUE_RULES, ...iopts.rules };
        for (const [id, u] of updated) {
          const org = u.after;
          if (org.status !== "active") continue;
          const agenda0: Agenda = truth.get(ORG_AGENDA, id as never) ?? EMPTY_AGENDA;
          let agenda = agenda0;
          const book0: OrderBook = ordersOn
            ? (truth.get(ORG_ORDERS, id as never) ?? EMPTY_BOOK)
            : EMPTY_BOOK;
          let book = book0;
          const homes = new Map<string, AgentId[]>();
          for (const who of peopleOf.get(org.settlement) ?? []) {
            const home = truth.get(PERSON, who)?.household as string | undefined;
            if (home === undefined) continue;
            const list = homes.get(home) ?? [];
            list.push(who);
            homes.set(home, list);
          }
          const signals = scanPressures(
            {
              truth,
              ledger: ctx.ledger,
              now: ctx.now,
              day: o.day,
              year: o.year,
              goods: o.goods ?? [],
              ...(ordersOn ? { assumed: book0.assumed } : {}),
            },
            { homes },
            iopts,
          );
          const byKey = new Map<string, PressureSignal>(
            signals.map((s) => [`${s.kind}|${s.subject}`, s]),
          );
          const members = activeMembers(org).map((m) => m.agent);

          // Las órdenes pendientes que ya esperaron se cumplen (o no) por los miembros.
          if (ordersOn && ctx.ledger) {
            const vault = holderAccount(id as unknown as HolderRef);
            const grain = unitOf("grain");
            const homeOf = (who: string): string | undefined =>
              truth.get(PERSON, who as AgentId)?.household as string | undefined;
            const livingHome = (home: string): boolean =>
              truth.get(ENTITY, home as never)?.endedAt === undefined &&
              (truth.get(HOUSEHOLD, home as never)?.members ?? []).some(
                (x) => truth.get(PERSON, x) && alive(x),
              );
            for (const ord of openOrders(book0)) {
              if (ctx.now - ord.issuedAt < orderRules.executeAfterDays * o.day) continue;
              const decision = agenda0.decisions.find((d) => d.id === ord.decision);
              const base = { org: id, order: ord.id, option: ord.option, subject: ord.subject };
              const cause = [{ kind: "event", event: ord.issuedEvent }] as never;
              const fail = (note: string, status: "failed" | "void" = "failed") => {
                book = closeOrder(book, ord.id, status, ctx.now, { note });
                events.push({
                  kind: ORG_ORDER_FAILED_EVENT,
                  actors: [ord.executor],
                  place: o.placeOf(truth, ord.executor),
                  data: { ...base, status, note },
                  emissions: {},
                  causes: cause,
                });
              };
              if (!alive(ord.executor) || !isMember(org, ord.executor)) {
                fail("executor_gone", "void");
                continue;
              }
              const loan =
                ord.option === "extend" ? truth.get(LOANS, ord.subject as never) : undefined;
              const conflict = loan !== undefined && homeOf(ord.executor) === loan.lender;
              const chance = obedienceChance(
                decision?.votes.find((v) => v.agent === ord.executor),
                conflict,
                orderRules,
              );
              if (!obeys(chance, ctx.rng.fork("order", ord.id))) {
                book = closeOrder(book, ord.id, "refused", ctx.now, { note: "disobeyed" });
                events.push({
                  kind: ORG_ORDER_REFUSED_EVENT,
                  actors: [ord.executor],
                  place: o.placeOf(truth, ord.executor),
                  data: { ...base, obedienceChance: chance, conflict },
                  emissions: {},
                  causes: cause,
                });
                continue;
              }
              const done = (
                transfers: readonly Transfer[],
                extra: { unit?: string; loan?: string },
                data: Record<string, unknown>,
                changesMore: StateChange[] = [],
              ) => {
                const spent = transfers.reduce((n, t) => n + t.amount, 0);
                const ev = draftEvent(events.length);
                book = closeOrder(book, ord.id, "done", ctx.now, {
                  ...(spent > 0 ? { spent } : {}),
                  ...extra,
                });
                events.push({
                  kind: ORG_ORDER_EXECUTED_EVENT,
                  actors: [ord.executor],
                  place: o.placeOf(truth, ord.executor),
                  data: { ...base, spent, ...data },
                  emissions: {},
                  causes: cause,
                });
                if (transfers.length > 0) post(ev, transfers);
                changes.push(...changesMore);
              };
              if (ord.option === "relief") {
                if (!grain) {
                  fail("no_grain");
                  continue;
                }
                if (!livingHome(ord.subject)) {
                  fail("household_gone", "void");
                  continue;
                }
                const amount = spendable(orderRules.reliefGrams, bal(vault, grain));
                if (amount <= 0) {
                  fail("empty_treasury");
                  continue;
                }
                done(
                  [
                    {
                      from: vault,
                      to: holderAccount(ord.subject as unknown as HolderRef),
                      unit: grain,
                      amount,
                    },
                  ],
                  { unit: grain },
                  { home: ord.subject, unit: grain },
                );
              } else if (ord.option === "extend") {
                if (!loan || loan.status !== "defaulted") {
                  fail("loan_not_defaulted", "void");
                  continue;
                }
                const owed = outstanding(loan) - (book.assumed[ord.subject] ?? 0);
                const amount = spendable(assumeAmount(owed, orderRules), bal(vault, loan.unit));
                if (amount <= 0) {
                  fail(
                    owed <= 0 ? "nothing_owed" : "empty_treasury",
                    owed <= 0 ? "void" : "failed",
                  );
                  continue;
                }
                done(
                  [{ from: vault, to: loan.lenderAccount, unit: loan.unit, amount }],
                  { unit: loan.unit, loan: ord.subject },
                  { lender: loan.lender, borrower: loan.borrower, unit: loan.unit },
                );
              } else {
                const [a, b] = ord.subject.split("|") as [AgentId, AgentId];
                if (!alive(a) || !alive(b)) {
                  fail("party_gone", "void");
                  continue;
                }
                const more: StateChange[] = [];
                for (const [x, y] of [
                  [a, b],
                  [b, a],
                ] as const) {
                  const row = truth.get(RELATIONS, x);
                  const r = row?.toward[y];
                  if (!row || !r) continue;
                  const resentment = Math.max(
                    0,
                    Math.round(((r.dims.resentment ?? 0) - orderRules.resentmentDrop) * 1e6) / 1e6,
                  );
                  more.push(
                    setComponent(RELATIONS, x, {
                      ...row,
                      toward: {
                        ...row.toward,
                        [y]: { ...r, dims: { ...r.dims, resentment }, updated: ctx.now },
                      },
                    }),
                  );
                }
                const hs = [
                  ...new Set([homeOf(a), homeOf(b)].filter((x): x is string => !!x)),
                ].sort();
                const each = grain
                  ? Math.floor(
                      spendable(orderRules.feastGrams, bal(vault, grain)) / Math.max(1, hs.length),
                    )
                  : 0;
                const feast: Transfer[] =
                  grain && each > 0
                    ? hs.map((h) => ({
                        from: vault,
                        to: holderAccount(h as unknown as HolderRef),
                        unit: grain,
                        amount: each,
                      }))
                    : [];
                done(
                  feast,
                  grain ? { unit: grain } : {},
                  { parties: [a, b], resentmentDrop: orderRules.resentmentDrop },
                  more,
                );
              }
            }
          }

          // Los asuntos abiertos que ya deliberaron un tiempo se votan (o caducan si la presión se fue).
          for (const issue of agenda0.open) {
            if (ctx.now - issue.raisedAt < irules.deliberationDays * o.day) continue;
            const decisionId = `decision:${id}:${agenda.serial}`;
            const sig = byKey.get(`${issue.kind}|${issue.subject}`);
            const raiserBelief = issue.beliefs[0];
            if (!sig || !raiserBelief) {
              const d = lapse(issue, ctx.now, decisionId);
              agenda = closeIssue(agenda, d, irules.keepDecisions);
              events.push({
                kind: ORG_ISSUE_LAPSED_EVENT,
                actors: [issue.raisedBy],
                place: o.placeOf(truth, issue.raisedBy),
                data: { org: id, issue: issue.id, kind: issue.kind, subject: issue.subject },
                emissions: {},
                causes: d.causes as never,
              });
              continue;
            }
            const res = deliberate({
              org,
              issue,
              perceived: perceiveAll(truth, members, sig, irules),
              raiserBelief,
              rules: irules,
              rng: ctx.rng.fork("org", id, decisionId),
              at: ctx.now,
              decisionId,
            });
            agenda = closeIssue(agenda, res.decision, irules.keepDecisions);
            const decidedEv = draftEvent(events.length);
            events.push({
              kind: ORG_DECIDED_EVENT,
              actors: [issue.raisedBy, ...res.decision.votes.map((v) => v.agent)].filter(
                (a, k, l) => l.indexOf(a) === k,
              ),
              place: o.placeOf(truth, issue.raisedBy),
              data: {
                org: id,
                decision: decisionId,
                issue: issue.id,
                kind: issue.kind,
                subject: issue.subject,
                option: res.decision.option,
                outcome: res.decision.outcome,
                raisedBy: issue.raisedBy,
                votes: res.decision.votes.map((v) => ({
                  agent: v.agent,
                  vote: v.vote,
                  utility: v.utility,
                  confidence: v.confidence,
                })),
                circulated: res.circulated,
              },
              emissions: {},
              causes: res.decision.causes as never,
            });
            if (ordersOn) {
              const ordEv = draftEvent(events.length);
              const order: Order | null = orderFrom(
                org,
                res.decision,
                `order:${id}:${book.serial}`,
                ctx.now,
                ordEv,
              );
              if (order) {
                book = addOrder(book, order, orderRules.keepOrders);
                events.push({
                  kind: ORG_ORDERED_EVENT,
                  actors: [order.executor],
                  place: o.placeOf(truth, order.executor),
                  data: {
                    org: id,
                    order: order.id,
                    decision: decisionId,
                    option: order.option,
                    subject: order.subject,
                    executor: order.executor,
                  },
                  emissions: {},
                  causes: [{ kind: "event", event: decidedEv }],
                });
              }
            }
          }

          // Presiones nuevas: las plantea quien las percibe y le conviene; si nadie, no existen.
          for (const sig of signals) {
            if (agenda.open.length >= irules.maxOpen) break;
            if (
              recentlyHandled(agenda, sig.kind, sig.subject, ctx.now, irules.cooldownDays * o.day)
            )
              continue;
            const pick = chooseRaiser(org, perceiveAll(truth, members, sig, irules), irules);
            if (!pick) continue;
            const issue: Issue = {
              id: `issue:${id}:${agenda.serial}`,
              org: org.id,
              kind: sig.kind,
              subject: sig.subject,
              raisedBy: pick.agent,
              raisedAt: ctx.now,
              beliefs: [pick.belief],
              raisedEvent: draftEvent(events.length),
              causes: sig.causes,
            };
            agenda = openIssue(agenda, issue);
            events.push({
              kind: ORG_ISSUE_RAISED_EVENT,
              actors: [pick.agent],
              place: o.placeOf(truth, pick.agent),
              data: {
                org: id,
                issue: issue.id,
                kind: sig.kind,
                subject: sig.subject,
                raisedBy: pick.agent,
                believed: pick.belief,
              },
              emissions: {},
              causes: sig.causes as never,
            });
          }
          if (agenda !== agenda0) changes.push(setComponent(ORG_AGENDA, id as never, agenda));
          if (book !== book0) changes.push(setComponent(ORG_ORDERS, id as never, book));
        }
      }

      // Fundación: asentamientos con gente y sin consejo.
      for (const settlement of [...peopleOf.keys()].sort()) {
        if (founded.has(settlement)) continue;
        const elders = chooseElders(
          (peopleOf.get(settlement) ?? []).map((p) => candidate(p, settlement)),
          rules,
        );
        if (elders.length === 0) continue;
        const orgId = ctx.newId("org");
        const origin = draftEvent(events.length);
        const org = foundCouncil({
          id: orgId,
          settlement,
          elders,
          originEventId: origin,
          at: ctx.now,
        });
        const settled = truth.get(ENTITY, settlement as unknown as EntityRef)?.originEventId;
        changes.push(
          setComponent(
            ENTITY,
            orgId as never,
            {
              id: orgId,
              originEventId: origin,
              createdAt: ctx.now,
            } as never,
          ),
          setComponent(ORG, orgId as never, org),
        );
        events.push({
          kind: ORG_FOUNDED_EVENT,
          actors: org.founders as AgentId[],
          place: o.placeOf(truth, org.founders[0] as AgentId),
          data: {
            org: orgId,
            template: org.template,
            settlement,
            head: elders[0]?.agent,
            members: org.founders.length,
          },
          emissions: {},
          causes: settled ? [{ kind: "event", event: settled as EventId }] : [],
        });
      }

      return changes.length === 0 && events.length === 0
        ? {}
        : { changes, events, ...(postings.length > 0 ? { postings } : {}) };
    },
  };
}

/** Las agendas de los consejos (asuntos abiertos y decisiones), en orden de id. */
export function agendaRows(truth: ReadonlyWorldTruth): { id: string; agenda: Agenda }[] {
  return [...truth.ids(ORG_AGENDA)]
    .sort()
    .map((id) => ({ id: id as string, agenda: truth.get(ORG_AGENDA, id) as Agenda }));
}

/** ¿Es `who` miembro activo de algún consejo? (lectura para otros módulos). */
export function inAnyCouncil(truth: ReadonlyWorldTruth, who: AgentId): boolean {
  return councilRows(truth).some((r) => isMember(r.org, who));
}
