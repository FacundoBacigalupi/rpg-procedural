// Rumores de hechos (information §2-§3, §9): lo que alguien cuenta de lo que otro hizo. Contar es
// una decisión (`tellDesire`: novedad, intensidad, relevancia, sociabilidad contra proteger al
// culpable, temerle o aburrir al oyente); al pasar de boca en boca el hecho se deforma con reglas
// deterministas (`distortRumor`: simplificación, exageración, atribución y asimilación, con valores
// que salen de lo que el que cuenta cree) y el que escucha lo pesa por quién lo cuenta (`hearRumor`),
// con el efecto «todos lo dicen» si no recuerda de quién lo oyó. Cada versión guarda su salto
// (`variant`, `parent`, `hops`) y de ahí sale el linaje (`rumorTree`). La reputación es la
// fracción de una comunidad que lo sabe y lo que cree (`reputationIn`), no un número global.
// Constantes sin calibrar.

import { type AgentId, type EventId, pow, type Random, type Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import { type DeedKind, type KnownDeeds, learnDeed } from "./deeds.ts";

const DAY = 86_400;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Qué se cuenta: el hecho, ya como lo cuenta el que habla (puede no ser lo que pasó). */
export interface RumorContent {
  readonly kind: DeedKind;
  readonly by: AgentId | null;
  readonly victim: AgentId;
  /** 1 = como pasó; crece con la exageración (tope `MAX_SEVERITY`). */
  readonly severity: number;
}

export const MAX_SEVERITY = 2;
/** Desde esta severidad el hecho sube un escalón (robo → agresión). */
export const ESCALATE_AT = 1.5;
const ESCALATION: Readonly<Record<DeedKind, DeedKind>> = {
  fraud: "theft",
  default: "theft",
  theft: "assault",
  assault: "assault",
};
/** Cuánto pesa en la fama cada clase de hecho. */
export const KIND_WEIGHT: Readonly<Record<DeedKind, number>> = {
  fraud: 0.4,
  default: 0.3,
  theft: 0.6,
  assault: 1,
};

/** Una versión de un rumor en la cabeza de alguien. */
export interface HeardRumor {
  /** La raíz: el evento real del hecho (o la mentira que lo creó). */
  readonly root: EventId;
  readonly content: RumorContent;
  /** Cuándo pasó, según lo que le llegó. */
  readonly at: Tick;
  readonly heardAt: Tick;
  /** 0-1: cuánto lo cree. */
  readonly confidence: number;
  /** Saltos desde la raíz (0 = lo vio). */
  readonly hops: number;
  /** Esta versión (`root#quien`) y de cuál vino. */
  readonly variant: string;
  readonly parent: string | null;
  /** De quién lo oyó, si lo recuerda (si no, «dicen que»). */
  readonly teller: AgentId | null;
  /** Cuántas bocas distintas (según él) se lo dijeron. */
  readonly voices: number;
}

export interface Rumors {
  readonly items: readonly HeardRumor[];
  /** A quién ya se lo contó (para no repetir). */
  readonly told: readonly { readonly root: EventId; readonly to: AgentId }[];
}

/** Lo que cada uno sabe de oídas y a quién se lo contó, en su entidad. */
export const RUMORS = table<Rumors>("law.rumors");

export const KEPT_RUMORS = 24;
export const KEPT_TOLD = 48;

export const variantId = (root: EventId, holder: AgentId): string => `${root}#${holder}`;

/** Lo que el que cuenta ve en el hecho y en sí mismo: de acá salen los valores que mete al deformar. */
export interface DistortContext {
  /** 0-1: cuánto recuerda del hecho (memoria y claridad). */
  readonly memory: number;
  /** 0-1: ganas de dramatizar (reactividad, emoción). */
  readonly drama: number;
  /** 0-1: apuro, alcohol, distracción. */
  readonly hurry: number;
  /** A quién le tiene rencor (y cuánto): ahí se desliza la culpa. Nunca la víctima. */
  readonly grudge: { readonly who: AgentId; readonly strength: number } | null;
}

export type Distortion = "simplified" | "exaggerated" | "attributed";

/**
 * Deforma `c` al contarlo (tres sorteos fijos por llamada). Simplificación: se pierde quién fue
 * (más cuanto menos recuerda); exageración: crece la severidad y, pasado `ESCALATE_AT`, el hecho
 * sube de clase; atribución/asimilación: el autor se desliza al que el narrador ya odia. Nunca
 * aparece un valor que el narrador no tuviera.
 */
export function distortRumor(
  c: RumorContent,
  ctx: DistortContext,
  rng: Random,
): { content: RumorContent; changes: readonly Distortion[] } {
  const rSimplify = rng.float();
  const rExaggerate = rng.float();
  const rAttribute = rng.float();
  const changes: Distortion[] = [];
  let { by, kind, severity } = c;
  if (by !== null && rSimplify < clamp01(0.5 * (1 - ctx.memory) + 0.2 * ctx.hurry)) {
    by = null;
    changes.push("simplified");
  }
  const g = ctx.grudge;
  if (g && g.who !== c.victim && g.who !== by) {
    const p = clamp01(g.strength * (by === null ? 0.6 : 0.25));
    if (rAttribute < p) {
      by = g.who;
      changes.push("attributed");
    }
  }
  if (rExaggerate < clamp01(0.5 * ctx.drama)) {
    severity = Math.min(MAX_SEVERITY, severity + 0.2 * (1 + ctx.drama));
    if (severity >= ESCALATE_AT) kind = ESCALATION[kind];
    changes.push("exaggerated");
  }
  return { content: { kind, by, victim: c.victim, severity: round(severity) }, changes };
}

/** Lo que pesa en las ganas de contar (todo 0-1 salvo lo que se aclara). */
export interface TellMotives {
  readonly content: RumorContent;
  /** Días desde que se enteró: lo fresco se cuenta más. */
  readonly ageDays: number;
  /** Cuánto le importa al oyente (parentesco con la víctima, trato con el culpable). */
  readonly relevance: number;
  readonly sociability: number;
  /** Cariño/lealtad al culpable: tiende a callar. */
  readonly protects: number;
  readonly fearOfDoer: number;
  /** Cuánto confía en el oyente. */
  readonly trustInListener: number;
  /** Ya se lo contó (o cree que ya lo sabe). */
  readonly alreadyTold: boolean;
}

/** Ganas de contarle esto a ese oyente, 0-1. Cero si ya se lo dijo. */
export function tellDesire(m: TellMotives): number {
  if (m.alreadyTold) return 0;
  const intensity = clamp01(KIND_WEIGHT[m.content.kind] * m.content.severity);
  const freshness = clamp01(1 - m.ageDays / 30);
  const v =
    0.35 * intensity +
    0.25 * freshness +
    0.2 * clamp01(m.relevance) +
    0.3 * clamp01(m.sociability) +
    0.1 * clamp01(m.trustInListener) -
    0.5 * clamp01(m.protects) -
    0.4 * clamp01(m.fearOfDoer);
  return round(clamp01(v));
}

/** Cuenta si el sorteo cae bajo las ganas (y bajo el piso, nadie lo cuenta). */
export const TELL_FLOOR = 0.25;
export function decidesToTell(desire: number, rng: Random): boolean {
  const roll = rng.float();
  return desire >= TELL_FLOOR && roll < desire;
}

/** Lo que el oyente pone para creer. */
export interface HearContext {
  /** Confianza en quien cuenta (-1..1). */
  readonly trustInTeller: number;
  /** Cariño hacia el acusado (-1..1): cuesta creer lo malo de un querido. */
  readonly affectionToDoer: number;
  /** Credulidad del oyente (curiosidad baja, reactividad alta). */
  readonly credulity: number;
  /** Cuánto retiene de quién se lo dijo (atención, memoria), 0-1. */
  readonly attention: number;
}

/** Cuánto se fía el oyente de esta versión (0-1): baja con los saltos que ya trae. */
export function rumorCredit(c: HearContext, hops: number): number {
  const base =
    0.2 +
    0.4 * Math.max(0, c.trustInTeller) -
    0.2 * Math.max(0, -c.trustInTeller) +
    0.2 * clamp01(c.credulity) -
    0.3 * Math.max(0, c.affectionToDoer);
  return round(clamp01(base) * pow(0.9, Math.max(0, hops)));
}

/**
 * El oyente integra lo que le cuentan. Si ya tenía el rumor: la misma boca no suma; otra boca sube la
 * confianza como independiente (aunque venga del mismo chismoso: «todos lo dicen»), y si
 * recuerda de quién lo oyó guarda la fuente. Sorteo fijo: una vez, si retiene la fuente.
 */
export function hearRumor(
  prev: HeardRumor | undefined,
  told: HeardRumor,
  from: AgentId,
  hearer: AgentId,
  ctx: HearContext,
  now: Tick,
  rng: Random,
): HeardRumor {
  const keepsSource = rng.float() < clamp01(0.3 + 0.65 * ctx.attention);
  const credit = rumorCredit(ctx, told.hops);
  const teller = keepsSource ? from : null;
  if (!prev) {
    return {
      root: told.root,
      content: told.content,
      at: told.at,
      heardAt: now,
      confidence: credit,
      hops: told.hops,
      variant: variantId(told.root, hearer),
      parent: told.variant,
      teller,
      voices: 1,
    };
  }
  if (prev.hops === 0) return prev; // lo que vio no se pisa con lo que oye
  const sameVoice = prev.teller !== null && prev.teller === from;
  const confidence = sameVoice
    ? prev.confidence
    : Math.min(0.99, 1 - (1 - prev.confidence) * (1 - credit));
  const betterWho = prev.content.by === null && told.content.by !== null;
  return {
    ...prev,
    content: betterWho ? { ...prev.content, by: told.content.by } : prev.content,
    confidence: round(confidence),
    heardAt: now,
    teller: prev.teller ?? teller,
    voices: sameVoice ? prev.voices : prev.voices + 1,
  };
}

/** Lo que `teller` sabe de primera mano como una versión de salto cero. */
export function firstHand(
  root: EventId,
  content: RumorContent,
  at: Tick,
  now: Tick,
  holder: AgentId,
): HeardRumor {
  return {
    root,
    content,
    at,
    heardAt: now,
    confidence: 0.95,
    hops: 0,
    variant: variantId(root, holder),
    parent: null,
    teller: null,
    voices: 1,
  };
}

/** Versión que sale de la boca de `teller` (un salto más, ya deformada). */
export function spoken(from: HeardRumor, content: RumorContent): HeardRumor {
  return { ...from, content, hops: from.hops + 1 };
}

export function contentOfDeed(d: {
  kind: DeedKind;
  by: AgentId | null;
  victim: AgentId;
}): RumorContent {
  return { kind: d.kind, by: d.by, victim: d.victim, severity: 1 };
}

/** Suma `h` a lo que sabe de oídas (misma raíz = reemplaza; tope por frescura). */
export function keepRumor(before: Rumors | undefined, h: HeardRumor): Rumors {
  const rest = (before?.items ?? []).filter((x) => x.root !== h.root);
  const items = [...rest, h].sort((a, b) => a.heardAt - b.heardAt).slice(-KEPT_RUMORS);
  return { items, told: before?.told ?? [] };
}

export function markTold(before: Rumors | undefined, root: EventId, to: AgentId): Rumors {
  const told = [...(before?.told ?? []), { root, to }].slice(-KEPT_TOLD);
  return { items: before?.items ?? [], told };
}

/** El hecho que guarda el oyente como `told` (para `KNOWN_DEEDS`): solo si cree lo bastante. */
export const BELIEVED_AT = 0.3;
export function rumorAsKnown(
  h: HeardRumor,
  before: KnownDeeds | undefined,
): KnownDeeds | undefined {
  if (h.confidence < BELIEVED_AT) return before;
  return learnDeed(before, {
    kind: h.content.kind,
    by: h.content.by,
    victim: h.content.victim,
    event: h.root,
    at: h.at,
    via: "told",
  });
}

/** De dónde dice alguien que lo sabe: lo vio, se lo dijo fulano, o «dicen que» (information §3). */
export type RumorSource =
  | { readonly kind: "saw" }
  | { readonly kind: "named"; readonly teller: AgentId; readonly voices: number }
  | { readonly kind: "crowd"; readonly voices: number };

/** La respuesta a «¿quién te lo dijo?»: solo lo que recuerda, no la cadena real. */
export function sourceOf(h: HeardRumor): RumorSource {
  if (h.hops === 0) return { kind: "saw" };
  if (h.teller !== null) return { kind: "named", teller: h.teller, voices: h.voices };
  return { kind: "crowd", voices: h.voices };
}

export interface RumorTree {
  readonly root: EventId;
  readonly variants: readonly {
    readonly variant: string;
    readonly parent: string | null;
    readonly holder: AgentId;
    readonly hops: number;
    readonly content: RumorContent;
    readonly confidence: number;
  }[];
}

/** El árbol de versiones de `root` entre todos los que lo guardan (por saltos y por id). */
export function rumorTree(
  root: EventId,
  holders: ReadonlyMap<AgentId, Rumors | undefined>,
): RumorTree {
  const variants: RumorTree["variants"][number][] = [];
  for (const [holder, r] of [...holders].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const h = r?.items.find((x) => x.root === root);
    if (!h) continue;
    variants.push({
      variant: h.variant,
      parent: h.parent,
      holder,
      hops: h.hops,
      content: h.content,
      confidence: h.confidence,
    });
  }
  variants.sort((a, b) => a.hops - b.hops || (a.variant < b.variant ? -1 : 1));
  return { root, variants };
}

/** Cuánto se aleja `c` de `truth` (0-1): clase del hecho, autor y gravedad. Solo lectura. */
export function contentDistance(truth: RumorContent, c: RumorContent): number {
  const gravity = Math.min(1, Math.abs(c.severity - truth.severity) / (MAX_SEVERITY - 1));
  return round(
    0.4 * (c.kind === truth.kind ? 0 : 1) + 0.3 * (c.by === truth.by ? 0 : 1) + 0.3 * gravity,
  );
}

export interface DeformationStep {
  readonly hops: number;
  readonly versions: number;
  /** Distancia media a la raíz de las versiones de este salto. */
  readonly mean: number;
  readonly max: number;
}

export interface Deformation {
  readonly root: EventId;
  /** La versión de referencia: la de menor salto (lo que vio quien estuvo). */
  readonly reference: RumorContent | null;
  /** La versión más sostenida (por confianza sumada) y qué tanto se aleja de la raíz. */
  readonly dominant: { readonly content: RumorContent; readonly distance: number } | null;
  readonly steps: readonly DeformationStep[];
}

/** Métrica de deformación de un árbol (information §9, tooling §6): por salto y de la versión dominante. */
export function rumorDeformation(tree: RumorTree): Deformation {
  const first = tree.variants[0];
  if (!first) return { root: tree.root, reference: null, dominant: null, steps: [] };
  const ref = first.content;
  const byHops = new Map<number, number[]>();
  const weight = new Map<string, { content: RumorContent; w: number }>();
  for (const v of tree.variants) {
    const d = contentDistance(ref, v.content);
    byHops.set(v.hops, [...(byHops.get(v.hops) ?? []), d]);
    const key = `${v.content.kind}|${v.content.by ?? "-"}|${v.content.severity}`;
    const prev = weight.get(key);
    weight.set(key, { content: v.content, w: (prev?.w ?? 0) + v.confidence });
  }
  const steps = [...byHops]
    .sort((a, b) => a[0] - b[0])
    .map(([hops, ds]) => ({
      hops,
      versions: ds.length,
      mean: round(ds.reduce((s, x) => s + x, 0) / ds.length),
      max: Math.max(...ds),
    }));
  let best: { content: RumorContent; w: number } | null = null;
  for (const [, x] of [...weight].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (best === null || x.w > best.w) best = x;
  }
  return {
    root: tree.root,
    reference: ref,
    dominant: best ? { content: best.content, distance: contentDistance(ref, best.content) } : null,
    steps,
  };
}

export interface Reputation {
  /** Cuántos de la comunidad saben algo de `who` (fracción 0-1). */
  readonly fame: number;
  /** -1..0: cuánto lo mal creen (ponderado por confianza y gravedad). */
  readonly standing: number;
  /** El hecho que más gente cuenta de él (el apodo sale de ahí). */
  readonly dominant: DeedKind | null;
}

/**
 * La reputación de `who` entre `community`: de lo que cada uno sabe de él (hechos vistos y
 * rumores creídos). Es por comunidad: otra comunidad con otros conocimientos da otra.
 */
export function reputationIn(
  community: readonly AgentId[],
  who: AgentId,
  known: (id: AgentId) => KnownDeeds | undefined,
  rumors: (id: AgentId) => Rumors | undefined,
): Reputation {
  const members = community.filter((m) => m !== who);
  if (members.length === 0) return { fame: 0, standing: 0, dominant: null };
  let knowers = 0;
  let total = 0;
  const tally: Record<DeedKind, number> = { default: 0, fraud: 0, theft: 0, assault: 0 };
  for (const m of members) {
    let worst = 0;
    let kind: DeedKind | null = null;
    for (const d of known(m)?.deeds ?? []) {
      if (d.by !== who) continue;
      const w = KIND_WEIGHT[d.kind] * (d.via === "saw" ? 1 : 0.6);
      if (w > worst) {
        worst = w;
        kind = d.kind;
      }
    }
    for (const h of rumors(m)?.items ?? []) {
      if (h.content.by !== who) continue;
      const w = KIND_WEIGHT[h.content.kind] * Math.min(1.5, h.content.severity) * h.confidence;
      if (w > worst) {
        worst = w;
        kind = h.content.kind;
      }
    }
    if (kind === null) continue;
    knowers++;
    total += worst;
    tally[kind]++;
  }
  let dominant: DeedKind | null = null;
  for (const k of ["assault", "theft", "fraud", "default"] as const) {
    if (tally[k] > 0 && (dominant === null || tally[k] > tally[dominant])) dominant = k;
  }
  return {
    fame: round(knowers / members.length),
    standing: knowers === 0 ? 0 : round(-Math.min(1, total / knowers)),
    dominant,
  };
}

export const DAYS = (ticks: number): number => ticks / DAY;
