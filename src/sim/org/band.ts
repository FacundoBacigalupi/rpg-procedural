// Bandas de bandidos que nacen del hambre (organizations §11 «Hambre y armas», §13 «Banda»): la
// misma estructura que el consejo (`Organization`, `Membership`, puesto de cabeza, lealtad de
// `ORG_LOYALTY`) con otra plantilla. Nace de una hambruna con causa: quienes están más
// desesperados juntan a su alrededor a los que juran seguirlos; después roban grano a los hogares
// que lo tienen (el botín es el tesoro, una cuenta del ledger), lo reparten, capturan a alguien
// de vez en cuando, pierden gente por deserción o muerte y se disuelven rápido cuando el botín no
// alcanza, el cabeza cae o la hambruna pasó.
//
// Puro: sin IO ni reloj. Decide sobre lo que cada uno cree de sí mismo y de los demás (su
// despensa, su confianza en el cabecilla, su lealtad al consejo), nunca sobre hechos ajenos. La
// tabla `BANDS` la escribe un único proceso (`life.bandits`).

import type { AgentId, EventId, OrgId, Rng, SettlementId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import {
  activeMembers,
  HEAD_POSITION,
  type Membership,
  type MembershipVia,
  type Organization,
  orgViolations,
  withdrawMember,
} from "./council.ts";
import { type OrgLoyalty, shiftLoyalty } from "./loyalty.ts";

export type BandDissolution = "leader_fell" | "starved" | "too_few" | "famine_over" | "scattered";

export interface BandRules {
  /** Con menos gente que esto no nace (ni sigue). */
  readonly minFounders: number;
  readonly maxMembers: number;
  readonly minAge: number;
  readonly maxAge: number;
  /** Desesperación mínima (0-1) para ser candidato. */
  readonly minDesperation: number;
  readonly raidEveryDays: number;
  /** Gramos que intenta llevarse en un asalto. */
  readonly raidTake: number;
  /** Lo que el hogar asaltado conserva sí o sí (gramos). */
  readonly victimKeep: number;
  readonly shareEveryDays: number;
  /** Gramos por miembro y día que el reparto intenta cubrir. */
  readonly ration: number;
  /** Probabilidad de capturar a un débil del hogar tras un asalto exitoso. */
  readonly captureChance: number;
  /** Con lealtad por debajo de esto el miembro puede desertar. */
  readonly desertBelow: number;
  readonly desertChance: number;
  /** Días seguidos sin poder repartir la ración antes de disolverse. */
  readonly dissolveUnfedDays: number;
  /** Días con la hambruna terminada antes de que la gente vuelva a casa. */
  readonly peaceDays: number;
  /** Días tras disolverse antes de que pueda nacer otra en el mismo lugar. */
  readonly rebirthDays: number;
  readonly fedGain: number;
  readonly unfedLoss: number;
  readonly swornLoyalty: number;
  readonly capturedLoyalty: number;
}

export const DEFAULT_BAND_RULES: BandRules = {
  minFounders: 3,
  maxMembers: 12,
  minAge: 16,
  maxAge: 55,
  minDesperation: 0.5,
  raidEveryDays: 5,
  raidTake: 40_000,
  victimKeep: 90_000,
  shareEveryDays: 7,
  ration: 500,
  captureChance: 0.25,
  desertBelow: 0.2,
  desertChance: 0.3,
  dissolveUnfedDays: 21,
  peaceDays: 30,
  rebirthDays: 120,
  fedGain: 0.05,
  unfedLoss: 0.15,
  swornLoyalty: 0.5,
  capturedLoyalty: 0.05,
};

export interface Band {
  readonly org: Organization;
  /** Evento (o causa) que la hizo nacer: la hambruna. */
  readonly bornOf: EventId;
  readonly founded: Tick;
  /** Lealtad de cada miembro a la banda (misma tabla de reglas que el consejo). */
  readonly loyalty: OrgLoyalty;
  /** Gramos asaltados en total y repartidos en total; tesoro = looted - paid. */
  readonly looted: number;
  readonly paid: number;
  readonly unfedDays: number;
  readonly raids: number;
  readonly lastRaid: Tick | null;
  readonly lastShare: Tick;
  /** Desde cuándo la hambruna del lugar terminó (null si sigue). */
  readonly peaceSince: Tick | null;
  readonly dissolved?: {
    readonly at: Tick;
    readonly reason: BandDissolution;
    readonly event: EventId;
  };
}

/** Cada banda vive en una entidad `org:n` con este componente. Solo la escribe `life.bandits`. */
export const BANDS = table<Band>("org.band");

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

export interface BandCandidate {
  readonly agent: AgentId;
  readonly ageYears: number;
  /** 0-1: fuerza para pelear. */
  readonly strength: number;
  /** 0-1: qué tan desesperado está (su propia despensa). */
  readonly desperation: number;
  /** 0-1: lo que le debe al consejo de la aldea (su lealtad). */
  readonly villageLoyalty: number;
}

/** Fuerza por edad: sube hasta los 25, meseta hasta los 40 y baja. Sin azar. */
export function ageStrength(ageYears: number): number {
  const a = Math.max(0, ageYears);
  const v = a < 25 ? a / 25 : a <= 40 ? 1 : 1 - (a - 40) / 50;
  return round6(clamp(v, 0.05, 1));
}

/** Desesperación: 0 con la despensa para `horizon` días, 1 sin nada. */
export function desperation(daysOfFood: number, horizon = 14): number {
  return round6(clamp01(1 - daysOfFood / horizon));
}

export const isCandidate = (c: BandCandidate, r: BandRules): boolean =>
  c.ageYears >= r.minAge && c.ageYears <= r.maxAge && c.desperation >= r.minDesperation;

/** Quién tiene derecho a ser cabecilla: fuerza (0.6), desesperación (0.25), edad (0.15). */
export function leaderClaim(c: BandCandidate): number {
  return round6(0.6 * c.strength + 0.25 * c.desperation + 0.15 * clamp01(c.ageYears / 40));
}

/** El cabecilla entre los candidatos (desempate por id), o null. */
export function chooseLeader(cands: readonly BandCandidate[], r: BandRules): BandCandidate | null {
  let best: BandCandidate | null = null;
  for (const c of cands) {
    if (!isCandidate(c, r)) continue;
    if (
      best === null ||
      leaderClaim(c) > leaderClaim(best) ||
      (leaderClaim(c) === leaderClaim(best) && c.agent < best.agent)
    )
      best = c;
  }
  return best;
}

/**
 * Chance de jurar: el hambre empuja (0.7), la confianza en el cabecilla ayuda (0.3) y lo que le
 * debe al consejo frena (0.5). Todo es lo que el propio candidato siente.
 */
export function joinChance(c: BandCandidate, tie: number): number {
  return round6(
    clamp(0.1 + 0.7 * c.desperation + 0.3 * clamp01(tie) - 0.5 * c.villageLoyalty, 0.02, 0.95),
  );
}

export interface Founding {
  readonly leader: BandCandidate;
  readonly sworn: readonly BandCandidate[];
}

/**
 * Quiénes forman la banda: el cabecilla y los que juran (cada uno sortea con su propio hilo del
 * RNG). `null` si no se llega a `minFounders`.
 */
export function gatherFounders(
  cands: readonly BandCandidate[],
  tieOf: (who: AgentId, leader: AgentId) => number,
  rng: Rng,
  r: BandRules,
): Founding | null {
  const leader = chooseLeader(cands, r);
  if (!leader) return null;
  const sworn = [...cands]
    .filter((c) => c.agent !== leader.agent && isCandidate(c, r))
    .sort((a, b) => (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0))
    .filter((c) =>
      rng.fork("join", c.agent as string).chance(joinChance(c, tieOf(c.agent, leader.agent))),
    )
    .sort((a, b) => b.strength - a.strength || (a.agent < b.agent ? -1 : 1))
    .slice(0, r.maxMembers - 1);
  return sworn.length + 1 < r.minFounders ? null : { leader, sworn };
}

export interface FoundBandInput {
  readonly id: OrgId;
  readonly settlement: SettlementId;
  readonly founding: Founding;
  readonly originEventId: EventId;
  readonly bornOf: EventId;
  readonly at: Tick;
  readonly rules: BandRules;
}

/** Funda la banda con el cabecilla y sus juramentados. */
export function foundBand(i: FoundBandInput): Band {
  const all = [i.founding.leader, ...i.founding.sworn];
  const members: Membership[] = all.map((c, k) => ({
    agent: c.agent,
    rank: k === 0 ? "head" : "follower",
    positions: k === 0 ? [HEAD_POSITION] : [],
    via: "founding",
    since: i.at,
    originEventId: i.originEventId,
  }));
  let loyalty: OrgLoyalty = { toward: {} };
  for (const c of all)
    loyalty = shiftLoyalty(loyalty, c.agent, i.rules.swornLoyalty, i.at, i.originEventId);
  return {
    org: {
      id: i.id,
      template: "bandit_band",
      settlement: i.settlement,
      originEventId: i.originEventId,
      founders: all.map((c) => c.agent),
      status: "active",
      members,
      positions: [
        {
          id: HEAD_POSITION,
          title: "cabecilla",
          selection: "strength",
          holder: i.founding.leader.agent,
          since: i.at,
          originEventId: i.originEventId,
        },
      ],
      organs: [
        {
          id: "band",
          seats: [
            { rank: "head", weight: 1 },
            { rank: "follower", weight: 0 },
          ],
          rule: "leader_decides",
        },
      ],
    },
    bornOf: i.bornOf,
    founded: i.at,
    loyalty,
    looted: 0,
    paid: 0,
    unfedDays: 0,
    raids: 0,
    lastRaid: null,
    lastShare: i.at,
    peaceSince: null,
  };
}

export const isActive = (b: Band): boolean => b.org.status === "active";
export const treasuryOf = (b: Band): number => b.looted - b.paid;
export const memberAgents = (b: Band): readonly AgentId[] =>
  activeMembers(b.org).map((m) => m.agent);
export const leaderOf = (b: Band): AgentId | null =>
  b.org.positions.find((p) => p.id === HEAD_POSITION)?.holder ?? null;

/** Solo juramentados activos y leales disputan la vacante; fuerza primero, id desempata.
 * La lista recibida contiene únicamente personas vivas existentes, verificadas por el llamador.
 * No exige hambre ni el límite de edad de reclutamiento: un veterano sigue siendo miembro.
 */
export function chooseBandSuccessor(
  b: Band,
  candidates: readonly { readonly agent: AgentId; readonly strength: number }[],
  r: BandRules,
): AgentId | null {
  if (!isActive(b) || leaderOf(b) !== null) return null;
  const eligible = new Set(
    activeMembers(b.org)
      .filter(
        (m) => m.via !== "captured" && (b.loyalty.toward[m.agent]?.value ?? 0) >= r.desertBelow,
      )
      .map((m) => m.agent),
  );
  return (
    [...candidates]
      .filter((c) => eligible.has(c.agent))
      .sort(
        (a, z) => z.strength - a.strength || (a.agent < z.agent ? -1 : a.agent > z.agent ? 1 : 0),
      )[0]?.agent ?? null
  );
}

/** Ocupa la vacante sin alterar membresía histórica, lealtades ni tesoro. */
export function succeedBand(b: Band, who: AgentId, at: Tick, event: EventId): Band {
  if (
    !isActive(b) ||
    leaderOf(b) !== null ||
    !activeMembers(b.org).some((m) => m.agent === who && m.via !== "captured")
  )
    return b;
  return {
    ...b,
    org: {
      ...b.org,
      members: b.org.members.map((m) =>
        m.until !== undefined
          ? m
          : {
              ...m,
              rank: m.agent === who ? "head" : "follower",
              positions: m.agent === who ? [HEAD_POSITION] : [],
            },
      ),
      positions: b.org.positions.map((p) =>
        p.id !== HEAD_POSITION
          ? p
          : {
              id: p.id,
              title: p.title,
              selection: p.selection,
              holder: who,
              since: at,
              originEventId: event,
            },
      ),
    },
  };
}

/** Alguien se suma por juramento o por captura (tope `maxMembers`); idempotente si ya es miembro. */
export function joinBand(
  b: Band,
  who: AgentId,
  via: Extract<MembershipVia, "sworn" | "captured">,
  at: Tick,
  event: EventId,
  r: BandRules,
): Band {
  if (!isActive(b) || memberAgents(b).includes(who) || memberAgents(b).length >= r.maxMembers)
    return b;
  const m: Membership = {
    agent: who,
    rank: "follower",
    positions: [],
    via,
    since: at,
    originEventId: event,
  };
  return {
    ...b,
    org: { ...b.org, members: [...b.org.members, m] },
    loyalty: shiftLoyalty(
      b.loyalty,
      who,
      via === "sworn" ? r.swornLoyalty : r.capturedLoyalty,
      at,
      event,
    ),
  };
}

/** Un miembro sale (muerte o deserción). Si era el cabeza, el puesto queda vacante con su causa. */
export function leaveBand(
  b: Band,
  who: AgentId,
  exit: { readonly at: Tick; readonly kind: "death" | "desertion"; readonly event: EventId },
): Band {
  const org = withdrawMember(b.org, who, exit);
  return org === b.org ? b : { ...b, org };
}

/** La banda se disuelve: se cierran las membresías que quedan y el puesto queda vacante. */
export function dissolveBand(b: Band, at: Tick, event: EventId, reason: BandDissolution): Band {
  if (!isActive(b)) return b;
  const members = b.org.members.map((m) =>
    m.until === undefined
      ? { ...m, until: at, exit: "dissolution" as const, exitEventId: event }
      : m,
  );
  const positions = b.org.positions.map((p) =>
    p.holder !== null ? { ...p, holder: null, vacantSince: at, vacatedBy: event } : p,
  );
  return {
    ...b,
    org: { ...b.org, members, positions, status: "dissolved" },
    dissolved: { at, reason, event },
  };
}

/** Fuerza de la banda: suma de la fuerza de sus miembros. */
export const bandStrength = (strengths: readonly number[]): number =>
  round6(strengths.reduce((s, x) => s + x, 0));

/** Chance de que el asalto salga bien: la fuerza de la banda contra la de los defensores. */
export function raidChance(attack: number, defense: number): number {
  return round6(clamp(attack / (attack + defense + 0.25), 0.05, 0.95));
}

/** Cuánto se lleva de un hogar: lo que pide, tope lo que le sobra sobre lo que conserva. */
export function raidLoot(want: number, victimStock: number, keep: number): number {
  return Math.max(0, Math.floor(Math.min(want, victimStock - keep)));
}

export interface ShareOutcome {
  /** Gramos por miembro (iguales; entero). */
  readonly each: number;
  readonly fed: boolean;
}

/** Reparto del tesoro entre `n` miembros por `days` días de ración; `fed` si se cubre entera. */
export function shareOut(treasury: number, n: number, days: number, r: BandRules): ShareOutcome {
  if (n <= 0) return { each: 0, fed: false };
  const want = Math.floor(r.ration * days);
  const each = Math.max(0, Math.min(want, Math.floor(treasury / n)));
  return { each, fed: each >= want };
}

/** ¿Deserta? Solo quien tiene poca lealtad, y con su propio sorteo. */
export function deserts(loyalty: number, rng: Rng, r: BandRules): boolean {
  return loyalty < r.desertBelow && rng.chance(r.desertChance);
}

export interface DissolveContext {
  readonly leaderAlive: boolean;
  readonly members: number;
  readonly now: Tick;
  readonly day: number;
}

/** Por qué se disuelve hoy (en este orden de gravedad), o null si sigue. */
export function dissolveReason(b: Band, c: DissolveContext, r: BandRules): BandDissolution | null {
  if (!c.leaderAlive || leaderOf(b) === null) return "leader_fell";
  if (c.members < r.minFounders) return "too_few";
  if (b.unfedDays >= r.dissolveUnfedDays) return "starved";
  if (b.peaceSince !== null && c.now - b.peaceSince >= r.peaceDays * c.day) return "famine_over";
  return null;
}

/** Ración repartida y botín: los contadores del ledger de la banda. */
export function bandAccounting(b: Band, loot: number, paid: number): Band {
  return { ...b, looted: b.looted + loot, paid: b.paid + paid };
}

/**
 * Lo que tiene que cumplir toda banda; devuelve las violaciones. Con `vault` (saldo real de su
 * cuenta del ledger) comprueba que el tesoro es lo asaltado menos lo repartido.
 */
export function bandViolations(b: Band, vault?: number): readonly string[] {
  const out = [...orgViolations(b.org)];
  const id = b.org.id;
  if (b.org.template !== "bandit_band") out.push(`${id}: plantilla de banda incorrecta`);
  if (b.looted < 0 || b.paid < 0) out.push(`${id}: contadores negativos`);
  if (b.paid > b.looted) out.push(`${id}: repartió más de lo que asaltó`);
  if (vault !== undefined && vault !== treasuryOf(b))
    out.push(`${id}: tesoro ${vault} distinto de asaltado - repartido ${treasuryOf(b)}`);
  if (b.org.status === "dissolved" && b.dissolved === undefined)
    out.push(`${id}: disuelta sin causa`);
  if (b.org.status === "dissolved" && (vault ?? 0) !== 0)
    out.push(`${id}: disuelta con tesoro sin repartir`);
  if (!b.bornOf) out.push(`${id}: sin causa de nacimiento`);
  for (const m of activeMembers(b.org))
    if (b.loyalty.toward[m.agent as string] === undefined && m.via !== "captured")
      out.push(`${id}: ${m.agent} sin lealtad registrada`);
  return out;
}
