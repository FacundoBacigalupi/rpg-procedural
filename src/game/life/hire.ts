// Contratar a un oficial (economy §3, crafts; verbo `hire`): quien ofrece jornal acuerda con el
// oficial el precio del día: `skillWageOf` (su mejor oficio) por lo que el oficial cree del que
// contrata (su confianza hacia él: cuanto menos confía, más pide). Paga con asiento al ledger (de
// su bolsa y, si no alcanza, de la de su hogar) y deja el trabajo hecho como un registro con origen
// (`HIRED_WORK`, con el evento del verbo como causa). Si no puede pagar todo, lo que falta se salda
// con servidumbre por jornal (el que contrató sirve al oficial, `makeBondage`) cuando hay términos;
// sin términos el trabajo no se hace (`hire.refused`). El destino puede ser una persona o un hogar
// (la candidata `hire:<hogar>` de `life.decide`): se resuelve a su miembro vivo de mejor oficio.
// Proceso opt-in (`LifeParts.hire`): apagado no hay filas, RNG ni eventos. Único dueño de `HIRED_WORK`.

import type { AgentId, EventId, HolderRef, LedgerAccount, PlaceRef } from "../../core/index.ts";
import { holderAccount, ledgerUnit } from "../../core/index.ts";
import {
  draftEvent,
  ENTITY,
  type EventDraft,
  makeBondage,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  SKILL_STATE,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import { skillWageOf } from "./bondagepolicy.ts";
import { COMMITMENTS } from "./loans.ts";

export const HIRE_PROCESS = "life.hire";
export const HIRE_DONE = "hire.done";
export const HIRE_BONDED = "hire.bonded";
export const HIRE_REFUSED = "hire.refused";

/** Un trabajo contratado: quién lo hizo, por cuánto y qué quedó sin pagar. */
export interface HiredJob {
  readonly event: EventId;
  readonly worker: AgentId;
  readonly what: string | null;
  readonly days: number;
  readonly wage: number;
  readonly paid: number;
  readonly owed: number;
  /** El compromiso de servidumbre que salda lo debido, si lo hubo. */
  readonly bondage?: string;
  readonly tick: number;
}

export interface HiredWork {
  readonly jobs: readonly HiredJob[];
}

/** Los trabajos que contrató cada persona. Solo escribe `life.hire`. */
export const HIRED_WORK = table<HiredWork>("economy.hired_work");

export const KEPT_HIRED_JOBS = 8;

export interface HireOptions {
  readonly unit: string;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  readonly day: number;
  /** Jornal base por día (en `unit`) que escala `skillWageOf`. */
  readonly baseWage: number;
  readonly crafts: ReadonlySet<string>;
  /** Días de trabajo de cada contrato (3 por defecto). */
  readonly jobDays?: number;
  /** Cuánto más pide quien no confía (fracción del jornal con confianza 0; 0.5 por defecto). */
  readonly distrustPremium?: number;
  /** Servidumbre por lo no pagado: sin esto, quien no puede pagar no consigue el trabajo. */
  readonly bondage?: {
    readonly wagePerDay: number;
    readonly upkeepPerDay: number;
    readonly maxDays: number;
  };
}

interface HireFx {
  readonly kind?: string;
  readonly who?: string | null;
  readonly what?: string | null;
}

const acct = (h: string): LedgerAccount => holderAccount(h as unknown as HolderRef);

export function hireProcess(o: HireOptions): ProcessDef {
  const days = o.jobDays ?? 3;
  const premium = o.distrustPremium ?? 0.5;
  return {
    id: HIRE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, RELATIONS.name, SKILL_STATE.name, HIRED_WORK.name],
    writes: [HIRED_WORK.name, ...(o.bondage ? [COMMITMENTS.name, ENTITY.name] : [])],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const truth = ctx.truth;
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const changes: StateChange[] = [];
      const spent = new Map<string, number>();
      const pending = new Map<AgentId, HiredWork>();
      const alive = (id: string) =>
        truth.get(PERSON, id as never) !== undefined &&
        truth.get(ENTITY, id as never)?.endedAt === undefined;
      const resolve = (hirer: AgentId, who: string): AgentId | undefined => {
        if (alive(who)) return who as AgentId;
        const home = who.startsWith("household:") ? who.slice("household:".length) : who;
        let best: { id: AgentId; w: number } | undefined;
        for (const id of [...truth.ids(PERSON)].sort()) {
          if (id === hirer || !alive(id) || truth.get(PERSON, id)?.household !== home) continue;
          const w = skillWageOf(truth, id as AgentId, 1, o.crafts) ?? 0;
          if (!best || w > best.w) best = { id: id as AgentId, w };
        }
        return best?.id;
      };
      const free = (a: LedgerAccount) =>
        Math.max(0, Math.floor(ledger.balance(a, ledgerUnit(o.unit)) - (spent.get(a) ?? 0)));
      for (const e of ctx.recent) {
        const fx = (e.data as { effect?: HireFx; failure?: unknown } | null)?.effect;
        const hirer = e.actors[0] as AgentId | undefined;
        if (!hirer || fx?.kind !== "hire" || !fx.who) continue;
        if ((e.data as { failure?: unknown }).failure != null || !alive(hirer)) continue;
        const worker = resolve(hirer, fx.who);
        if (!worker || worker === hirer) continue;
        const place = o.placeOf(truth, hirer);
        const base = skillWageOf(truth, worker, o.baseWage, o.crafts) ?? o.baseWage;
        const trust = truth.get(RELATIONS, worker)?.toward[hirer as string]?.dims.trust ?? 0.5;
        const wage = Math.max(
          1,
          Math.round(base * (1 + premium * (1 - Math.min(1, Math.max(0, trust))))),
        );
        const total = wage * days;
        const homeId = truth.get(PERSON, hirer)?.household as string | undefined;
        const sources = [acct(hirer as string), ...(homeId ? [acct(homeId)] : [])];
        const transfers: {
          unit: ReturnType<typeof ledgerUnit>;
          from: LedgerAccount;
          to: LedgerAccount;
          amount: number;
        }[] = [];
        let left = total;
        for (const s of sources) {
          const take = Math.min(left, free(s));
          if (take <= 0) continue;
          transfers.push({
            unit: ledgerUnit(o.unit),
            from: s,
            to: acct(worker as string),
            amount: take,
          });
          spent.set(s, (spent.get(s) ?? 0) + take);
          left -= take;
        }
        const causes = [{ kind: "event" as const, event: e.id }];
        const actors = [hirer, worker];
        if (left > 0 && !o.bondage) {
          for (const t of transfers) spent.set(t.from, (spent.get(t.from) ?? 0) - t.amount);
          events.push({
            kind: HIRE_REFUSED,
            actors,
            place,
            data: { wage, days, owed: total },
            emissions: {},
            causes,
          });
          continue;
        }
        const k = events.length;
        events.push({
          kind: HIRE_DONE,
          actors,
          place,
          data: { what: fx.what ?? null, wage, days, paid: total - left, owed: left },
          emissions: {},
          causes,
        });
        if (transfers.length > 0) postings.push({ event: draftEvent(k), transfers });
        let bondage: string | undefined;
        if (left > 0 && o.bondage) {
          const bid = ctx.newId("commitment");
          const today = Math.floor(ctx.now / o.day);
          const bond = makeBondage({
            id: bid as string,
            creditor:
              (truth.get(PERSON, worker)?.household as string | undefined) ?? (worker as string),
            debtor: homeId ?? (hirer as string),
            debt: left,
            wagePerDay: o.bondage.wagePerDay,
            upkeepPerDay: o.bondage.upkeepPerDay,
            startDay: today,
            maxDays: o.bondage.maxDays,
            basis: "agreement",
            originEventId: draftEvent(k) as unknown as string,
          });
          if (bond) {
            bondage = bid as string;
            events.push({
              kind: HIRE_BONDED,
              actors,
              place,
              data: { commitment: bid, debt: left, maxDays: o.bondage.maxDays },
              emissions: {},
              causes: [{ kind: "event" as const, event: draftEvent(k) as never }],
            });
            changes.push(
              setComponent(
                ENTITY,
                bid as never,
                {
                  id: bid,
                  originEventId: draftEvent(events.length - 1),
                  createdAt: ctx.now,
                } as never,
              ),
              setComponent(COMMITMENTS, bid as never, bond),
            );
          }
        }
        const before = pending.get(hirer) ?? truth.get(HIRED_WORK, hirer);
        const job: HiredJob = {
          event: e.id,
          worker,
          what: fx.what ?? null,
          days,
          wage,
          paid: total - left,
          owed: left,
          ...(bondage ? { bondage } : {}),
          tick: ctx.now,
        };
        const after: HiredWork = { jobs: [...(before?.jobs ?? []), job].slice(-KEPT_HIRED_JOBS) };
        pending.set(hirer, after);
        changes.push(setComponent(HIRED_WORK, hirer, after));
      }
      return events.length === 0 ? {} : { events, postings, changes };
    },
  };
}
