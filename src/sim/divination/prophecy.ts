// Profecías como creencias con linaje (divination §5, information §3, Fase 2). Una profecía es una
// interpretación DICHA que se vuelve creencia de quien la oye y viaja: cada vez que se cuenta se
// deforma (se vuelve más clara y más dramática, pierde crédito por salto) y queda anotado quién se
// la contó a quién. Lo que cada quien cree de ella cambia lo que quiere (`prophecyPull`: miedo,
// esperanza, hostilidad, devoción y los valores que se mueven) y cómo mira al sujeto
// (`prophecyDeltas`). Nada acá consulta la verdad ni fuerza su cumplimiento: se cumple o se frustra
// por lo que la gente hace con ella.

import type { AgentId, EventId, Random, Tick } from "../../core/index.ts";
import type { ValueId } from "../mind/index.ts";
import type { Deltas } from "../relations/index.ts";
import { table } from "../world/index.ts";

export const PROPHECY_KINDS = ["greatness", "ruin", "death", "fortune"] as const;
/** Qué anuncia: que el sujeto se elevará, traerá ruina, morirá antes de tiempo o prosperará. */
export type ProphecyKind = (typeof PROPHECY_KINDS)[number];

export interface ProphecyClaim {
  readonly kind: ProphecyKind;
  /** De quién se dice. */
  readonly subject: AgentId;
  /** 0-1: lo grande y específico que suena tal como le llegó a quien la cree. */
  readonly intensity: number;
}

/** El id sale del evento en que se dijo por primera vez: no hay otra forma de que nazca. */
export type ProphecyId = `prophecy@${number}`;

export interface LineageHop {
  readonly from: AgentId;
  readonly to: AgentId;
  readonly at: Tick;
  readonly event: EventId;
}

export interface ProphecyRoot {
  readonly speaker: AgentId;
  /** Id del método de adivinación (`content/divination`), o `spoken` si nadie la leyó. */
  readonly method: string;
  readonly at: Tick;
  readonly event: EventId;
}

export interface HeardProphecy {
  readonly id: ProphecyId;
  readonly claim: ProphecyClaim;
  /** 0-1: cuánto se la cree. */
  readonly credence: number;
  /** Quién la dijo originalmente; nunca se pierde en el camino. */
  readonly root: ProphecyRoot;
  /** Los saltos de boca en boca, del más viejo al más nuevo (los últimos `MAX_LINEAGE`). */
  readonly lineage: readonly LineageHop[];
  /** Cuántas veces se contó en total hasta llegar acá. */
  readonly hops: number;
  readonly learnedAt: Tick;
}

export interface ProphecyBeliefs {
  readonly items: readonly HeardProphecy[];
}

/** Las profecías que cada persona conoce y cuánto las cree, en su entidad. */
export const PROPHECY_BELIEFS = table<ProphecyBeliefs>("divination.prophecies");

export const MAX_LINEAGE = 6;
/** Cuántas profecías retiene cada persona (se olvidan las de menos peso: crédito por intensidad). */
export const PROPHECY_CAPACITY = 12;
/** Crédito que se pierde por salto, además de la confianza en quien la cuenta. */
export const HOP_LOSS = 0.08;
/** Cuánto sube de media la intensidad al contarse (más clara, más dramática), a dramatismo 1. */
export const DRAMA_DRIFT = 0.12;
/** Chance por salto de que una profecía grave o feliz suene peor o mejor de lo que fue. */
export const ESCALATE_CHANCE = 0.18;
/** Peso de oír lo mismo de otra fuente: cuánto de su crédito se suma al que ya había. */
export const CORROBORATION = 0.5;
/** Cuánto más se cree lo que promete algo bueno sobre uno mismo (pensamiento deseante). */
export const WISHFUL_BONUS = 0.15;
/** Crédito de base de quien oye a un adivino que no conoce, a credulidad 0. */
export const BASE_CREDENCE = 0.2;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const byId = (a: HeardProphecy, b: HeardProphecy) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function prophecyId(origin: EventId): ProphecyId {
  return `prophecy@${origin as unknown as number}`;
}

/** Lo bueno o malo que suena para el sujeto: +1 felicidad plena, -1 desgracia plena. */
export function valence(kind: ProphecyKind): number {
  return kind === "fortune" ? 1 : kind === "greatness" ? 0.6 : kind === "ruin" ? -0.8 : -1;
}

/** Quién se la cree más: más tradicionalista y menos curioso (valor `tradition`, eje `curiosity`). */
export function credulity(traits: {
  readonly tradition: number;
  readonly curiosity: number;
}): number {
  return round(clamp01(0.5 + 0.5 * clamp01(traits.tradition) - 0.4 * clamp01(traits.curiosity)));
}

export interface Hearer {
  readonly id: AgentId;
  readonly credulity: number;
  /** Lo que confía en quien se lo cuenta, -1..1 (de la relación o de la fama del adivino). */
  readonly trustInTeller: number;
}

/** Crédito con que alguien acepta una profecía por primera vez. */
export function initialCredence(claim: ProphecyClaim, hearer: Hearer): number {
  const trust = clamp01(0.5 + 0.5 * hearer.trustInTeller);
  const wish = claim.subject === hearer.id && valence(claim.kind) > 0 ? WISHFUL_BONUS : 0;
  return round(clamp01((BASE_CREDENCE + 0.6 * hearer.credulity) * trust + wish));
}

/** La raíz: quien la dijo la cree según la convicción que le da a su propio método. */
export function utter(
  speaker: AgentId,
  claim: ProphecyClaim,
  method: string,
  conviction: number,
  event: EventId,
  at: Tick,
): HeardProphecy {
  return {
    id: prophecyId(event),
    claim,
    credence: round(clamp01(conviction)),
    root: { speaker, method, at, event },
    lineage: [],
    hops: 0,
    learnedAt: at,
  };
}

/**
 * Lo que `hearer` llega a creer cuando `from` le cuenta lo que cree. Se deforma (siempre consume
 * tres sorteos): la intensidad sube según el dramatismo de quien cuenta, a veces escala la
 * gravedad o la dicha, y el crédito sale de la confianza en quien cuenta menos lo que se pierde
 * por salto.
 */
export function transmit(
  told: HeardProphecy,
  from: AgentId,
  hearer: Hearer,
  drama: number,
  event: EventId,
  at: Tick,
  rng: Random,
): HeardProphecy {
  const driftRoll = Math.abs(rng.normal());
  const escalateRoll = rng.float();
  const sign = rng.float();
  let kind = told.claim.kind;
  if (escalateRoll < ESCALATE_CHANCE * clamp01(drama) && sign < 0.5) {
    if (kind === "ruin") kind = "death";
    else if (kind === "fortune") kind = "greatness";
  }
  const intensity = round(clamp01(told.claim.intensity + DRAMA_DRIFT * clamp01(drama) * driftRoll));
  const claim: ProphecyClaim = { kind, subject: told.claim.subject, intensity };
  const base = initialCredence(claim, hearer);
  const credence = round(clamp01(Math.min(base, told.credence + 0.1) * (1 - HOP_LOSS)));
  const hop: LineageHop = { from, to: hearer.id, at, event };
  return {
    id: told.id,
    claim,
    credence,
    root: told.root,
    lineage: [...told.lineage, hop].slice(-MAX_LINEAGE),
    hops: told.hops + 1,
    learnedAt: at,
  };
}

const weightOf = (p: HeardProphecy) => p.credence * p.claim.intensity;

/**
 * Suma lo oído a lo que ya sabe. Oírla otra vez por otro camino la refuerza (el segundo aporta la
 * mitad de su crédito) y se queda con la versión de menos saltos; si no entra todo se olvida lo de
 * menos peso. Orden canónico por id.
 */
export function receive(
  before: ProphecyBeliefs | undefined,
  heard: HeardProphecy,
): ProphecyBeliefs {
  const items = before?.items ?? [];
  const prev = items.find((p) => p.id === heard.id);
  const merged: HeardProphecy = prev
    ? {
        ...(heard.hops < prev.hops ? heard : prev),
        credence: round(
          Math.min(0.99, 1 - (1 - prev.credence) * (1 - CORROBORATION * heard.credence)),
        ),
        learnedAt: heard.learnedAt,
      }
    : heard;
  const all = [...items.filter((p) => p.id !== heard.id), merged];
  const kept = [...all]
    .sort((a, b) => weightOf(b) - weightOf(a) || byId(a, b))
    .slice(0, PROPHECY_CAPACITY)
    .sort(byId);
  return { items: kept };
}

export interface HolderStake {
  readonly id: AgentId;
  /** Sus valores (`valuesOf`), normalizados. */
  readonly values: Readonly<Record<ValueId, number>>;
  /** Lo que siente por el sujeto: afecto -1..1 (de `RELATIONS`). */
  readonly affection: number;
}

export interface ProphecyPull {
  readonly subject: AgentId;
  /** 0-1: miedo por sí o por alguien querido. */
  readonly fear: number;
  readonly hope: number;
  /** Ganas de impedirlo o de quitar de en medio al sujeto. */
  readonly hostility: number;
  /** Ganas de acercarse, proteger o servir al sujeto. */
  readonly devotion: number;
  /** Cuánto se mueve el peso de cada valor mientras decide algo que toca al sujeto. */
  readonly valueShifts: Partial<Record<ValueId, number>>;
}

const POWER_STAKE: readonly ValueId[] = ["power", "status", "immortality"];

/**
 * Cómo cambia lo que quiere alguien que cree la profecía (§5): según su peso (crédito por
 * intensidad), quién es el sujeto para él y qué valora. Un rival por el poder teme lo que se dice
 * de un grande; quien quiere al sujeto lo protege; el sujeto mismo espera o teme. No decide nada:
 * da los insumos que la utilidad del NPC lee.
 */
export function prophecyPull(p: HeardProphecy, holder: HolderStake): ProphecyPull {
  const w = clamp01(p.credence * p.claim.intensity);
  const self = p.claim.subject === holder.id;
  const loved = clamp01(holder.affection);
  const disliked = clamp01(-holder.affection);
  const v = holder.values;
  const val = (k: ValueId) => v[k] ?? 0;
  const ambition = POWER_STAKE.reduce((s, k) => s + val(k), 0) / POWER_STAKE.length;
  let fear = 0;
  let hope = 0;
  let hostility = 0;
  let devotion = 0;
  const shifts: Partial<Record<ValueId, number>> = {};
  const shift = (k: ValueId, x: number) => {
    shifts[k] = round((shifts[k] ?? 0) + x);
  };
  switch (p.claim.kind) {
    case "greatness":
      if (self) {
        hope = w * (0.4 + 0.6 * ambition);
        shift("power", 0.5 * w);
        shift("status", 0.4 * w);
      } else {
        fear = w * ambition * (1 - loved);
        hostility = w * ambition * (0.4 + 0.6 * disliked) * (1 - loved);
        devotion = w * loved;
        shift("power", 0.3 * w * ambition);
        shift("safety", 0.3 * w * ambition);
      }
      break;
    case "ruin":
      if (self) {
        fear = w;
        shift("safety", 0.5 * w);
      } else {
        fear = w * Math.min(1, val("safety") * 2) * (0.5 + 0.5 * loved);
        hostility = w * Math.min(1, val("safety") * 2.5) * (1 - loved);
        devotion = w * loved * 0.5;
        shift("safety", 0.4 * w);
        shift("family", 0.2 * w * loved);
      }
      break;
    case "death":
      if (self) {
        fear = w;
        shift("immortality", 0.5 * w);
        shift("safety", 0.3 * w);
      } else {
        fear = w * loved;
        hope = w * disliked * Math.min(1, val("power") * 2);
        devotion = w * loved;
        shift("family", 0.3 * w * loved);
      }
      break;
    case "fortune":
      if (self) {
        hope = w;
        shift("wealth", 0.3 * w);
      } else {
        const greed = Math.min(1, val("wealth") * 3);
        hope = w * loved * 0.5;
        devotion = w * (0.3 * greed + 0.7 * loved);
        shift("wealth", 0.2 * w * greed);
      }
      break;
  }
  const out = (x: number) => round(clamp01(x));
  return {
    subject: p.claim.subject,
    fear: out(fear),
    hope: out(hope),
    hostility: out(hostility),
    devotion: out(devotion),
    valueShifts: shifts,
  };
}

/** Cómo mira el oyente al sujeto después de enterarse (una sola vez, al formarse la creencia). */
export function prophecyDeltas(pull: ProphecyPull): Deltas {
  const d: Record<string, number> = {};
  const add = (k: string, x: number) => {
    if (Math.abs(x) >= 1e-6) d[k] = round(x);
  };
  add("fear", 0.3 * pull.fear + 0.1 * pull.hostility);
  add("respect", 0.2 * (pull.hope + pull.devotion));
  add("resentment", 0.2 * pull.hostility);
  add("trust", -0.15 * pull.hostility + 0.1 * pull.devotion);
  add("familiarity", 0.02);
  return d as Deltas;
}
