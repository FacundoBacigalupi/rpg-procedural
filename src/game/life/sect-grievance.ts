// Las ofensas entre sectas (novel4-grievance-record, organizations §10): cuando alguien de una
// secta sabe que uno de otra secta con la que la suya tiene relación le robó, le pegó o mató a uno
// de los suyos (lo sabe como hecho con autor, `KNOWN_DEEDS`), la secta lo guarda como ofensa contra
// la otra (`addGrievance`): el hecho entra a `grievances` y el rencor sube según su peso. Una vez
// por hecho; queda el evento `org.grievance`, causado por el hecho.
//
// Corre una vez por día: una secta se entera de lo que saben los suyos sin apuro. La ofensa queda
// también como asunto (`SECT_GRIEVANCES`) y al día siguiente quien manda la trata
// (novel4-grievance-matter): exigir reparación, devolverla u olvidarla, según lo que la secta siente
// y cree de la otra (`chooseGrievanceResponse`); queda `org.grievance_matter`. Olvidar la cierra.
//
// Exigir (novel4-grievance-act): el enviado tarda `ENVOY_DAYS` en ir y volver; la otra repara o se
// niega según lo que siente por la que exige (`chooseReply`), y eso vuelve a las dos relaciones
// (`org.grievance_reply`). Devolverla sale a buscar al ofensor: los de la secta lo retan al
// cruzarlo (`wantedBy` en `challengeCandidates`) y el duelo ganado la cierra (`life.duels`).
//
// El enviado (novel4-grievance-envoy-mission): la exigencia espera `ENVOY_WAIT_DAYS` a que uno de la
// secta pida llevarla (la misión `envoy` que da el anciano). Si alguien la toma, el asunto lo anota
// (`envoy`) y la ranura no sale mientras la lleve; si se le vence, sale la ranura desde el plazo. Si
// nadie la toma, sale la ranura al terminar la espera (`envoySlotReturns`).
//
// De palabra (novel4-grievance-envoy-speak): el enviado se lo dice a un anciano o al maestro de la
// otra en su sede; contesta ahí mismo (`converse`) y `life.sect_grievance_spoken` aplica la
// respuesta como lo haría la ranura: las dos relaciones, el asunto cerrado y lo que se le cobra al
// ofensor si reparan.

import {
  type AgentId,
  compareStrings,
  type EntityRef,
  type EventId,
  type PlaceId,
  type Tick,
} from "../../core/index.ts";
import {
  addGrievance,
  afterReplyGiven,
  afterReplyReceived,
  BODY_STATE,
  chooseGrievanceResponse,
  chooseReply,
  ENTITY,
  type EventDraft,
  envoySlotReturns,
  type GrievanceKind,
  type GrievanceReply,
  KNOWN_DEEDS,
  missionLapsed,
  ORG_GRIEVANCE_EVENT,
  ORG_GRIEVANCE_MATTER_EVENT,
  ORG_GRIEVANCE_REPLY_EVENT,
  ORG_RELATION,
  type OrgRelations,
  type OrgTie,
  openGrievance,
  orgTie,
  type ProcessDef,
  REPARATION_PENALTY,
  type ReadonlyWorldTruth,
  SECT,
  SECT_CONTRIBUTION,
  SECT_GRIEVANCES,
  SECT_MEMBER,
  SECT_MISSION,
  type SectContribution,
  type SectGrievanceEntry,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";

export const SECT_GRIEVANCE_PROCESS = "life.sect_grievance";
export const SECT_GRIEVANCE_SPOKEN_PROCESS = "life.sect_grievance_spoken";

/** Una ofensa que la secta `org` todavía no guarda contra `against`. */
export interface SectGrievance {
  readonly org: EntityRef;
  readonly against: EntityRef;
  readonly event: EventId;
  readonly kind: GrievanceKind;
  readonly by: AgentId;
  readonly victim: AgentId;
  /** Quién de la secta lo sabe (el primero por id). */
  readonly knower: AgentId;
}

function dead(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  if (truth.get(ENTITY, id)?.endedAt !== undefined) return true;
  return (truth.get(BODY_STATE, id)?.death ?? null) !== null;
}

/**
 * Las ofensas nuevas (puro): de lo que saben los miembros vivos de cada secta, los hechos con autor
 * conocido contra uno de la misma secta, cometidos por uno de una secta con la que la suya tiene
 * relación. Robo, agresión o muerte (la agresión cuenta como muerte si la víctima ya no vive).
 * Ordenadas por secta y por hecho; una por par de sectas y hecho.
 */
export function newGrievances(truth: ReadonlyWorldTruth): SectGrievance[] {
  const found = new Map<string, SectGrievance>();
  for (const knower of [...truth.ids(SECT_MEMBER)].sort(compareStrings) as AgentId[]) {
    if (dead(truth, knower)) continue;
    const org = truth.get(SECT_MEMBER, knower)?.org;
    if (org === undefined) continue;
    const relations = truth.get(ORG_RELATION, org);
    if (!relations) continue;
    for (const d of truth.get(KNOWN_DEEDS, knower)?.deeds ?? []) {
      if (d.by === null || (d.kind !== "theft" && d.kind !== "assault")) continue;
      if (truth.get(SECT_MEMBER, d.victim)?.org !== org) continue;
      const against = truth.get(SECT_MEMBER, d.by)?.org;
      if (against === undefined || against === org) continue;
      const tie = orgTie(relations, against);
      if (!tie || tie.grievances.includes(d.event)) continue;
      const key = `${org}|${against}|${d.event}`;
      if (found.has(key)) continue;
      const kind: GrievanceKind =
        d.kind === "theft" ? "theft" : dead(truth, d.victim) ? "killing" : "assault";
      found.set(key, { org, against, event: d.event, kind, by: d.by, victim: d.victim, knower });
    }
  }
  return [...found.values()].sort(
    (a, b) => compareStrings(a.org, b.org) || compareStrings(a.event, b.event),
  );
}

/** Escritor de `ORG_RELATION` y `SECT_GRIEVANCES`: las sectas guardan y tratan las ofensas que saben los suyos (cableado opt-in). */
export function sectGrievanceProcess(o: {
  /** Cuántos ticks tiene un día (lo que tarda el enviado se cuenta en días). */
  readonly dayTicks: number;
}): ProcessDef {
  return {
    id: SECT_GRIEVANCE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      SECT_MEMBER.name,
      KNOWN_DEEDS.name,
      ORG_RELATION.name,
      ENTITY.name,
      BODY_STATE.name,
      SECT.name,
      SECT_GRIEVANCES.name,
      SECT_CONTRIBUTION.name,
      SECT_MISSION.name,
    ],
    writes: [ORG_RELATION.name, SECT_GRIEVANCES.name, SECT_CONTRIBUTION.name],
    run(ctx) {
      const truth = ctx.truth;
      const relations = new Map<EntityRef, OrgRelations>();
      const ledgers = new Map<EntityRef, SectGrievanceEntry[]>();
      const ledger = (org: EntityRef) => {
        let l = ledgers.get(org);
        if (!l) {
          l = [...(truth.get(SECT_GRIEVANCES, org)?.entries ?? [])];
          ledgers.set(org, l);
        }
        return l;
      };
      const events: EventDraft[] = [];
      /** Si se tocó un asunto sin evento (anotar al enviado). */
      let changed = false;
      const contributions = new Map<AgentId, SectContribution>();
      const seatOf = (org: EntityRef) => truth.get(SECT, org)?.seatPlace;
      const relationOf = (org: EntityRef) => relations.get(org) ?? truth.get(ORG_RELATION, org);
      const setTie = (org: EntityRef, toward: EntityRef, tie: OrgTie) => {
        const had = relationOf(org);
        if (had) relations.set(org, { toward: { ...had.toward, [toward]: tie } });
      };
      // Quién lleva cada exigencia (novel4-grievance-envoy-mission): la misión vigente, por hecho.
      const carriers = new Map<string, { who: AgentId; due: Tick }>();
      for (const id of [...truth.ids(SECT_MISSION)].sort(compareStrings)) {
        const m = truth.get(SECT_MISSION, id);
        if (m?.kind !== "envoy" || m.deed === undefined || missionLapsed(m, ctx.now)) continue;
        carriers.set(`${m.org}|${m.deed}`, { who: id as unknown as AgentId, due: m.due });
      }
      // Las exigencias que ya llegaron y volvieron: la otra repara o se niega (novel4-grievance-act).
      for (const org of [...truth.ids(SECT_GRIEVANCES)].sort(compareStrings) as EntityRef[]) {
        const entries = ledger(org);
        entries.forEach((e, i) => {
          if (!openGrievance(e) || e.response?.choice !== "demand") return;
          const carrier = carriers.get(`${org}|${e.deed}`);
          // La tomó uno de los suyos: queda anotado quién y hasta cuándo, y la ranura no sale.
          if (carrier && (e.envoy?.who !== carrier.who || e.envoy.due !== carrier.due)) {
            entries[i] = { ...e, envoy: carrier };
            changed = true;
          }
          const back = envoySlotReturns(entries[i] ?? e, o.dayTicks, carrier !== undefined);
          if (back === undefined || ctx.now < back) return;
          const theirs = orgTie(relationOf(e.against), org);
          const ours = orgTie(relationOf(org), e.against);
          const seat = seatOf(e.against);
          if (!theirs || !ours || seat === undefined) return;
          const roll = ctx.rng.fork("grievance-reply", org, e.deed).float();
          const reply = chooseReply(theirs, e.kind, roll);
          setTie(org, e.against, afterReplyReceived(ours, e.kind, reply));
          // Repara la otra: se lo cobra al suyo que hizo la ofensa (novel4-grievance-player).
          let penalty = 0;
          if (reply === "pay") {
            setTie(e.against, org, afterReplyGiven(theirs));
            const had = contributions.get(e.by) ?? truth.get(SECT_CONTRIBUTION, e.by);
            if (had?.org === e.against) {
              penalty = Math.min(had.points, REPARATION_PENALTY[e.kind]);
              if (penalty > 0) contributions.set(e.by, { ...had, points: had.points - penalty });
            }
          }
          entries[i] = {
            ...e,
            outcome: { result: reply === "pay" ? "paid" : "refused", at: ctx.now },
          };
          events.push({
            kind: ORG_GRIEVANCE_REPLY_EVENT,
            actors: [e.by, e.victim],
            place: { kind: "place", place: seat as unknown as PlaceId },
            data: { org, against: e.against, kind: e.kind, deed: e.deed, reply, penalty },
            emissions: {},
            causes: [{ kind: "event", event: e.deed }],
          });
        });
      }
      // Lo guardado antes de hoy se trata hoy: quien manda elige la respuesta (novel4-grievance-matter).
      for (const org of [...truth.ids(SECT_GRIEVANCES)].sort(compareStrings) as EntityRef[]) {
        const seat = seatOf(org);
        const had = relationOf(org);
        if (seat === undefined || !had) continue;
        const entries = ledger(org);
        entries.forEach((e, i) => {
          if (e.response || e.at >= ctx.now) return;
          const tie = orgTie(had, e.against);
          if (!tie) return;
          const roll = ctx.rng.fork("grievance-matter", org, e.deed).float();
          const choice = chooseGrievanceResponse(tie, e.kind, roll);
          // Olvidar termina el asunto ahí mismo; exigir y devolver quedan abiertos.
          entries[i] = {
            ...e,
            response: { choice, at: ctx.now },
            ...(choice === "forget" ? { outcome: { result: "forgotten", at: ctx.now } } : {}),
          };
          events.push({
            kind: ORG_GRIEVANCE_MATTER_EVENT,
            actors: [e.by, e.victim],
            place: { kind: "place", place: seat as unknown as PlaceId },
            data: { org, against: e.against, kind: e.kind, deed: e.deed, response: choice },
            emissions: {},
            causes: [{ kind: "event", event: e.deed }],
          });
        });
      }
      for (const g of newGrievances(truth)) {
        const had = relationOf(g.org);
        const tie = orgTie(had, g.against);
        // La ofensa se guarda en la sede (sin sede no hay secta que la guarde).
        const seat = seatOf(g.org);
        if (!had || !tie || seat === undefined) continue;
        relations.set(g.org, {
          toward: { ...had.toward, [g.against]: addGrievance(tie, g.event, g.kind) },
        });
        ledger(g.org).push({
          deed: g.event,
          against: g.against,
          kind: g.kind,
          by: g.by,
          victim: g.victim,
          at: ctx.now,
        });
        events.push({
          kind: ORG_GRIEVANCE_EVENT,
          actors: [g.by, g.victim, g.knower],
          place: { kind: "place", place: seat as unknown as PlaceId },
          data: { org: g.org, against: g.against, kind: g.kind, deed: g.event },
          emissions: {},
          causes: [{ kind: "event", event: g.event }],
        });
      }
      if (events.length === 0 && !changed) return {};
      const changes: StateChange[] = [
        ...[...relations]
          .sort(([a], [b]) => compareStrings(a, b))
          .map(([id, r]) => setComponent(ORG_RELATION, id, r)),
        ...[...ledgers]
          .sort(([a], [b]) => compareStrings(a, b))
          .map(([id, entries]) => setComponent(SECT_GRIEVANCES, id, { entries })),
        ...[...contributions]
          .sort(([a], [b]) => compareStrings(a, b))
          .map(([id, c]) => setComponent(SECT_CONTRIBUTION, id, c)),
      ];
      return { changes, events };
    },
  };
}

/**
 * Escritor de `ORG_RELATION`, `SECT_GRIEVANCES` y `SECT_CONTRIBUTION`: la respuesta que la otra secta
 * le dio de palabra al enviado (`org.grievance_reply` con `envoy`, novel4-grievance-envoy-speak) vuelve
 * a las dos relaciones y cierra el asunto, igual que la que trae la ranura.
 */
export function sectGrievanceSpokenProcess(): ProcessDef {
  return {
    id: SECT_GRIEVANCE_SPOKEN_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [ORG_RELATION.name, SECT_GRIEVANCES.name, SECT_CONTRIBUTION.name],
    writes: [ORG_RELATION.name, SECT_GRIEVANCES.name, SECT_CONTRIBUTION.name],
    run(ctx) {
      const truth = ctx.truth;
      const relations = new Map<EntityRef, OrgRelations>();
      const ledgers = new Map<EntityRef, SectGrievanceEntry[]>();
      const contributions = new Map<AgentId, SectContribution>();
      const relationOf = (org: EntityRef) => relations.get(org) ?? truth.get(ORG_RELATION, org);
      const setTie = (org: EntityRef, toward: EntityRef, tie: OrgTie) => {
        const had = relationOf(org);
        if (had) relations.set(org, { toward: { ...had.toward, [toward]: tie } });
      };
      for (const e of ctx.recent) {
        if (e.kind !== ORG_GRIEVANCE_REPLY_EVENT) continue;
        const d = e.data as {
          org?: EntityRef;
          against?: EntityRef;
          deed?: EventId;
          reply?: GrievanceReply;
          envoy?: AgentId;
        } | null;
        if (!d?.org || !d.against || !d.deed || !d.reply || d.envoy === undefined) continue;
        let entries = ledgers.get(d.org);
        if (!entries) {
          entries = [...(truth.get(SECT_GRIEVANCES, d.org)?.entries ?? [])];
          ledgers.set(d.org, entries);
        }
        const i = entries.findIndex((g) => g.deed === d.deed);
        const entry = entries[i];
        if (!entry || !openGrievance(entry)) continue;
        const theirs = orgTie(relationOf(d.against), d.org);
        const ours = orgTie(relationOf(d.org), d.against);
        if (!theirs || !ours) continue;
        setTie(d.org, d.against, afterReplyReceived(ours, entry.kind, d.reply));
        if (d.reply === "pay") {
          setTie(d.against, d.org, afterReplyGiven(theirs));
          const had = contributions.get(entry.by) ?? truth.get(SECT_CONTRIBUTION, entry.by);
          if (had?.org === d.against) {
            const penalty = Math.min(had.points, REPARATION_PENALTY[entry.kind]);
            if (penalty > 0) contributions.set(entry.by, { ...had, points: had.points - penalty });
          }
        }
        entries[i] = {
          ...entry,
          outcome: { result: d.reply === "pay" ? "paid" : "refused", at: ctx.now },
        };
      }
      if (relations.size === 0 && contributions.size === 0) return {};
      const changes: StateChange[] = [
        ...[...relations]
          .sort(([a], [b]) => compareStrings(a, b))
          .map(([id, r]) => setComponent(ORG_RELATION, id, r)),
        ...[...ledgers]
          .sort(([a], [b]) => compareStrings(a, b))
          .map(([id, entries]) => setComponent(SECT_GRIEVANCES, id, { entries })),
        ...[...contributions]
          .sort(([a], [b]) => compareStrings(a, b))
          .map(([id, c]) => setComponent(SECT_CONTRIBUTION, id, c)),
      ];
      return { changes };
    },
  };
}
