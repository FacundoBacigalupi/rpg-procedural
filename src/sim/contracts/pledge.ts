// Promesas de palabra (contracts §1, §3, §4, §7, §14; dialogue §8): lo que dos personas se dicen
// y cada una guarda a su manera. La verdad es un solo `Pledge` (quién prometió qué a quién, con
// qué peso y qué testigos); cada parte guarda además *su creencia* de lo prometido (`PledgeBelief`),
// que se deforma al entenderlo, se desgasta con el tiempo y puede no coincidir con la del otro.
// Cumplir o no se decide con la utilidad de §7 (con la culpa que sale de los valores), y el libro
// de deudas y promesas del personaje se arma de sus creencias, nunca de la verdad.
//
// Todo puro: sin IO ni reloj; la aleatoriedad llega por el `Random` que pasa el llamador.

import {
  type AgentId,
  type EventId,
  exp,
  type LedgerUnit,
  LN2,
  type Random,
  type Tick,
} from "../../core/index.ts";
import type { ValueId } from "../mind/index.ts";
import { table } from "../world/index.ts";
import type { Credit, CreditRow } from "./credit.ts";
import { isLive } from "./credit.ts";

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const DAY = 86_400;

/** Qué se prometió: dar un bien, hacer un favor o callar algo. */
export type PledgeTerm =
  | { readonly kind: "give"; readonly unit: LedgerUnit; readonly grams: number }
  | { readonly kind: "favor"; readonly what: string }
  | { readonly kind: "silence"; readonly about: string };

export type PledgeStatus = "open" | "kept" | "broken" | "released" | "impossible";

/** La verdad de una promesa. Vive en una entidad `commitment:n`. */
export interface Pledge {
  readonly kind: "pledge";
  readonly promisor: AgentId;
  readonly promisee: AgentId;
  readonly term: PledgeTerm;
  readonly madeAt: Tick;
  /** Cuándo se espera; null si no se fijó plazo (una promesa vaga). */
  readonly due: Tick | null;
  /** 0-1: cuánto importa (lo que se juega); las triviales no llegan al Cielo (§9). */
  readonly weight: number;
  /** 0-1: qué tan claros quedaron los términos; con baja, cada parte entiende otra cosa (§4). */
  readonly precision: number;
  /** Quiénes lo oyeron (además de las partes). */
  readonly witnesses: readonly AgentId[];
  readonly status: PledgeStatus;
  readonly history: readonly EventId[];
}

export const PLEDGE = table<Pledge>("contracts.pledge");

/** Días de plazo por defecto de una promesa de dar algo sin fecha. */
export const PLEDGE_DEFAULT_DAYS = 30;
/** Días de gracia pasado el plazo antes de darla por rota. */
export const PLEDGE_GRACE_DAYS = 7;
/** Peso bajo el cual una promesa no pesa más que en la conciencia y la relación (§9). */
export const TRIVIAL_WEIGHT = 0.15;

export function makePledge(i: {
  readonly promisor: AgentId;
  readonly promisee: AgentId;
  readonly term: PledgeTerm;
  readonly at: Tick;
  readonly dueInDays?: number | null;
  readonly weight: number;
  readonly precision?: number;
  readonly witnesses?: readonly AgentId[];
}): Pledge {
  const days = i.dueInDays === undefined ? PLEDGE_DEFAULT_DAYS : i.dueInDays;
  return {
    kind: "pledge",
    promisor: i.promisor,
    promisee: i.promisee,
    term: i.term,
    madeAt: i.at,
    due: days === null ? null : i.at + days * DAY,
    weight: clamp01(i.weight),
    precision: clamp01(i.precision ?? 1),
    witnesses: [...(i.witnesses ?? [])].filter((w) => w !== i.promisor && w !== i.promisee),
    status: "open",
    history: [],
  };
}

/** Peso de una promesa de dar `grams`: más gramos, más importa (satura). */
export function weightOfGive(grams: number): number {
  return round6(clamp01(grams / (grams + 1500)));
}

/** Vencida y pasada la gracia (sin plazo, nunca vence sola). */
export function isPledgeOverdue(p: Pledge, now: Tick): boolean {
  return p.status === "open" && p.due !== null && now > p.due + PLEDGE_GRACE_DAYS * DAY;
}

export const isPledgeLive = (p: Pledge): boolean => p.status === "open";

/** Cierra la promesa con el evento que la cumplió, la rompió o la dispensó. */
export function resolvePledge(
  p: Pledge,
  status: Exclude<PledgeStatus, "open">,
  event: EventId,
): Pledge {
  return p.status === "open" ? { ...p, status, history: [...p.history, event] } : p;
}

// --- Creencias sobre lo prometido (contracts §4, §14) ---

export type PledgeRole = "promisor" | "promisee";

/** Lo que una parte cree de una promesa: sus términos, tal como los entendió y los recuerda. */
export interface PledgeBelief {
  /** El id de la entidad `commitment:n` a la que se refiere. */
  readonly pledge: string;
  readonly role: PledgeRole;
  readonly other: AgentId;
  /** Los términos como los entendió (con `grams` deformado si quedaron vagos). */
  readonly term: PledgeTerm;
  /** Cuándo cree que vence; null si no recuerda plazo. */
  readonly due: Tick | null;
  /** Qué cree que pasó con ella. */
  readonly status: PledgeStatus;
  /** 0-1: qué tan seguro está de lo que recuerda; decae (`beliefConfidence`). */
  readonly confidence: number;
  readonly learnedAt: Tick;
  /** Cuándo se acordó por última vez (refresca la confianza). */
  readonly rehearsedAt: Tick;
}

export interface PledgeBook {
  readonly items: readonly PledgeBelief[];
}
export const PLEDGE_BOOK = table<PledgeBook>("contracts.pledge-book");

/** Cuántas promesas guarda cada persona antes de olvidar las más viejas y chicas (§15). */
export const PLEDGE_BOOK_CAPACITY = 24;
/** Vida media de la confianza en lo prometido, en días (lo que se recuerda sin repasar). */
export const PLEDGE_HALF_LIFE_DAYS = 90;
/** Cuánto se desvía lo entendido por cada unidad de vaguedad (1 - precision). */
export const MISREAD_SPREAD = 0.5;
/** Sesgo de interés: el que debe recuerda menos, el que cobra más (por unidad de vaguedad). */
export const SELF_SERVING = 0.25;

/**
 * Cómo entiende `role` los términos recién dichos. Con `precision` 1 entiende lo dicho; con
 * vaguedad se desvía al azar y con el sesgo de su interés (el desconfiado espera menos de lo que
 * debe y cree que le deben más, §4: `suspicion` 0-1).
 */
export function understandTerm(
  term: PledgeTerm,
  role: PledgeRole,
  precision: number,
  rng: Random,
  suspicion = 0,
): PledgeTerm {
  if (term.kind !== "give") return term;
  const vague = 1 - clamp01(precision);
  if (vague === 0) return term;
  const interest = role === "promisee" ? 1 : -1;
  const noise = MISREAD_SPREAD * rng.normal(0, 0.5);
  const shift = vague * (noise + interest * SELF_SERVING * (0.5 + suspicion / 2));
  const grams = Math.max(1, Math.round(term.grams * (1 + Math.max(-0.8, Math.min(1.5, shift)))));
  return { ...term, grams };
}

/** La creencia que forma `role` al oír la promesa (confianza según lo claro y lo atento). */
export function believePledge(
  id: string,
  p: Pledge,
  role: PledgeRole,
  rng: Random,
  opts: { readonly suspicion?: number; readonly attention?: number } = {},
): PledgeBelief {
  const attention = clamp01(opts.attention ?? 1);
  const other = role === "promisor" ? p.promisee : p.promisor;
  const missedDue = rng.chance(Math.min(0.9, (1 - p.precision) * 0.6 + (1 - attention) * 0.3));
  return {
    pledge: id,
    role,
    other,
    term: understandTerm(
      p.term,
      role,
      p.precision * (0.5 + attention / 2),
      rng,
      opts.suspicion ?? 0,
    ),
    due: missedDue ? null : p.due,
    status: "open",
    confidence: round6(clamp01(0.4 + 0.6 * p.precision * attention)),
    learnedAt: p.madeAt,
    rehearsedAt: p.madeAt,
  };
}

/** Confianza en `b` al momento `now`: decae sin repasar y las importantes se recuerdan más. */
export function beliefConfidence(b: PledgeBelief, now: Tick, weight = 0.5): number {
  const days = Math.max(0, now - b.rehearsedAt) / DAY;
  const half = PLEDGE_HALF_LIFE_DAYS * (0.5 + weight * 2);
  return round6(b.confidence * exp(-LN2 * (days / half)));
}

/** Repasar (que el otro la mencione, que venza el plazo) renueva la memoria. */
export function rehearse(b: PledgeBelief, now: Tick, boost = 0.15): PledgeBelief {
  return {
    ...b,
    confidence: round6(clamp01(beliefConfidence(b, now) + boost)),
    rehearsedAt: now,
  };
}

/** Pone la promesa en el libro; reemplaza la anterior del mismo id y olvida lo menos recordable. */
export function remember(book: PledgeBook | undefined, b: PledgeBelief, now: Tick): PledgeBook {
  const items = [...(book?.items ?? []).filter((x) => x.pledge !== b.pledge), b];
  if (items.length <= PLEDGE_BOOK_CAPACITY) return { items };
  // Lo cerrado y lo menos seguro se olvida primero.
  const keep = [...items].sort(
    (x, y) =>
      Number(y.status === "open") - Number(x.status === "open") ||
      beliefConfidence(y, now) - beliefConfidence(x, now) ||
      (x.pledge < y.pledge ? -1 : 1),
  );
  return { items: keep.slice(0, PLEDGE_BOOK_CAPACITY) };
}

/** Lo que el titular se entera que pasó: cumplida, rota o dispensada (si no lo ve, no cambia). */
export function learnOutcome(
  book: PledgeBook | undefined,
  pledge: string,
  status: Exclude<PledgeStatus, "open">,
  now: Tick,
): PledgeBook | undefined {
  if (!book) return book;
  return {
    items: book.items.map((b) =>
      b.pledge === pledge
        ? { ...b, status, rehearsedAt: now, confidence: Math.max(b.confidence, 0.8) }
        : b,
    ),
  };
}

// --- Culpa y decisión de cumplir (contracts §7) ---

/** Pesos de cada valor en la culpa por romper la palabra. */
export const GUILT_VALUES: Readonly<Partial<Record<ValueId, number>>> = {
  tradition: 1.2,
  justice: 1.5,
  family: 0.6,
  status: 0.4,
};
/** Valores normalizados suman 1 (≈ 0,09 cada uno): esto los lleva a una culpa del orden de 0-1. */
export const GUILT_SCALE = 3;

export interface GuiltContext {
  /** La víctima es de la familia o muy querida (suma el valor `family`). */
  readonly close: boolean;
  /** Cuánto lo perjudica a la otra parte romperla (0-1). */
  readonly harm: number;
  /** El promisor le debe gratitud a la otra parte (0-1): agrava. */
  readonly gratitude?: number;
}

/** Cuánto pesa en la conciencia romper `p` (0-1), según los valores de quien promete. */
export function guiltOf(
  values: Readonly<Partial<Record<ValueId, number>>>,
  p: Pledge,
  ctx: GuiltContext,
): number {
  let moral = 0;
  for (const [id, w] of Object.entries(GUILT_VALUES) as [ValueId, number][]) {
    if (id === "family" && !ctx.close) continue;
    moral += (values[id] ?? 0) * w;
  }
  const sensed = clamp01(moral * GUILT_SCALE);
  const aggravation = 0.5 + 0.5 * clamp01(ctx.harm) + 0.25 * clamp01(ctx.gratitude ?? 0);
  // Una promesa trivial pesa poco aunque se tenga conciencia.
  return round6(clamp01(sensed * (0.2 + 0.8 * p.weight) * aggravation));
}

export interface KeepInput {
  /** Lo que cumplir le cuesta (misma escala que `saving`). */
  readonly cost: number;
  /** Lo que ahorra incumpliendo. */
  readonly saving: number;
  /** Lo que le vale la relación, la cara y la reputación con esa persona. */
  readonly relationValue: number;
  /** Chance creída de que se detecte, y sanción creída si se detecta. */
  readonly detect: number;
  readonly sanction: number;
  readonly guilt: number;
  /** Miedo al karma, si cree en él. */
  readonly karmaFear?: number;
  /** Aversión a la sanción (los cautelosos pesan más lo que pueden perder). */
  readonly aversion?: number;
}

export interface KeepDecision {
  readonly keep: boolean;
  readonly uKeep: number;
  readonly uBreak: number;
}

/** `U(cumplir)` contra `U(incumplir)` de §7: gana el mayor; en empate, se cumple. */
export function decideKeep(i: KeepInput): KeepDecision {
  const uKeep = -i.cost + i.relationValue;
  const uBreak =
    i.saving - clamp01(i.detect) * i.sanction * (i.aversion ?? 1) - i.guilt - (i.karmaFear ?? 0);
  return { keep: uKeep >= uBreak, uKeep: round6(uKeep), uBreak: round6(uBreak) };
}

// --- Libro de deudas y promesas del personaje (contracts §14) ---

export type BookKind = "debt" | "pledge";
export type BookDirection = "i-owe" | "owed-to-me";

export interface BookEntry {
  readonly kind: BookKind;
  readonly id: string;
  readonly direction: BookDirection;
  readonly other: AgentId;
  readonly term: PledgeTerm;
  readonly due: Tick | null;
  /** Qué tan seguro está de la entrada (1 en las deudas de fiado, que lleva anotadas). */
  readonly confidence: number;
  readonly status: PledgeStatus | "defaulted";
}

/**
 * El libro de `holder`: las deudas de fiado que lleva (cuenta exacta, como en el fiado de aldea)
 * y las promesas tal como las cree. No mira la verdad de ninguna promesa: lo olvidado o mal
 * entendido figura así. Ordenado: lo que debe primero, lo más próximo a vencer primero.
 */
export function bookOf(
  holder: AgentId,
  credits: readonly CreditRow[],
  book: PledgeBook | undefined,
  now: Tick,
  weightOf: (pledge: string) => number = () => 0.5,
): BookEntry[] {
  const out: BookEntry[] = [];
  for (const r of credits) {
    const c: Credit = r.credit;
    if (!isLive(c)) continue;
    const mine = c.debtor === holder;
    if (!mine && c.creditor !== holder) continue;
    out.push({
      kind: "debt",
      id: r.id,
      direction: mine ? "i-owe" : "owed-to-me",
      other: mine ? c.creditor : c.debtor,
      term: { kind: "give", unit: c.unit, grams: c.owed },
      due: c.due,
      confidence: 1,
      status: c.status === "defaulted" ? "defaulted" : "open",
    });
  }
  for (const b of book?.items ?? []) {
    if (b.status !== "open") continue;
    out.push({
      kind: "pledge",
      id: b.pledge,
      direction: b.role === "promisor" ? "i-owe" : "owed-to-me",
      other: b.other,
      term: b.term,
      due: b.due,
      confidence: beliefConfidence(b, now, weightOf(b.pledge)),
      status: "open",
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.direction === "i-owe") - Number(a.direction === "i-owe") ||
      (a.due ?? Number.POSITIVE_INFINITY) - (b.due ?? Number.POSITIVE_INFINITY) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Dos partes creen cosas distintas de la misma promesa (§7, falsos incumplimientos). */
export function disputes(a: PledgeBelief, b: PledgeBelief): boolean {
  if (a.term.kind !== b.term.kind) return true;
  if (a.term.kind === "give" && b.term.kind === "give") return a.term.grams !== b.term.grams;
  if (a.term.kind === "favor" && b.term.kind === "favor") return a.term.what !== b.term.what;
  return false;
}
