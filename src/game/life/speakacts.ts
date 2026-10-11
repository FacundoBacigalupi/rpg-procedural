// Candidatas `speak` que declaran su acto (npc-c5b/c, dialogue §2): prometer devolver una deuda
// creída, pedir lo que le falta, contar una noticia, preguntar por una persona querida de la que no
// sabe dónde está o saludar, con ánimo desde afecto y familiaridad propios. Puro, sin RNG ni verdad: recibe lo que el NPC cree.

import type { EntityRef, Tick } from "../../core/index.ts";
import { type Candidate, STAKES_RISK } from "../../sim/index.ts";

/** Opt-in de `decide`: ofrecer saludos y preguntas como candidatas con acto declarado. */
export interface SpeakActsOptions {
  /** Familiaridad mínima (0-1) para saludar o preguntar. */
  readonly minFamiliarity: number;
  /** Segundos sin trato desde los que saludar tiene sentido. */
  readonly quietSeconds: number;
  /** Peso del ánimo con familiaridad y afecto al máximo. */
  readonly weight: number;
  /** Chance creída de que la conversación salga (0-1). */
  readonly chance: number;
  /** Urgencia (0-1) de lo que le falta desde la que pide; por defecto 0,5. */
  readonly requestMinUrgency?: number;
  /** Afecto mínimo (0-1) hacia quien le pide; por defecto 0,3. */
  readonly requestMinAffection?: number;
  /** Nombre (del catálogo) del bien que pide cuando le falta: lo básico de su casa; sin él, pide sin cosa precisa. */
  readonly requestWhat?: string;
  /** Gramos de ese bien en la despensa desde los que ya no pide (por defecto 1000). */
  readonly requestEnoughGrams?: number;
}

/** Lo que el NPC cree y quiere decir, más allá de a quién. */
export interface SpeakExtras {
  /** Lo que le falta: nombre (o null: ayuda sin cosa precisa) y urgencia (0-1). */
  readonly want?: { readonly what: string | null; readonly urgency: number };
  /** Noticias de terceros que cree (muerte o vida), para contar a quien no ve hace tiempo. */
  readonly news?: readonly { readonly about: string; readonly claim: "dead" | "alive" }[];
}

/** Un conocido tal como lo cree y lo siente el NPC. */
export interface Acquaintance {
  readonly id: string;
  readonly familiarity: number;
  readonly affection: number;
  /** Último momento en que recuerda haber compartido algo con él (muy atrás si no recuerda nada). */
  readonly updated: Tick;
  /** Si tiene una creencia de dónde está. */
  readonly whereaboutsKnown: boolean;
  /** Lo que cree deberle (unidad), si le debe algo: le promete devolverlo. */
  readonly owes?: string;
}

/**
 * Valores por defecto medidos (npc-c5c2b, 3 seeds, 10 días): con peso 0,4 el habla sube ~70 % sobre
 * no tener la opción (0,053 contra 0,031 hablas por NPC-día); con 1,5 se dispara (0,12, hasta 0,23).
 * `day` son los segundos del día del mundo.
 */
export function speakActsDefaults(day: number): SpeakActsOptions {
  return { minFamiliarity: 0.3, quietSeconds: day, weight: 0.4, chance: 0.9 };
}

const r = (x: number) => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const warmth = (a: Acquaintance) => 0.5 * clamp01(a.familiarity) + 0.5 * clamp01(a.affection);

/**
 * A lo sumo una candidata `speak:<persona>` por conocido, la de más prioridad: prometer devolver lo
 * que cree deber, pedir lo que le falta a quien le tiene afecto, contar una noticia o preguntar por el más querido de quien no sabe dónde está a quien no ve
 * hace `quietSeconds`, o saludar. Orden
 * fijo por id; sin conocidos que alcancen la familiaridad, nada.
 */
export function speakActCandidates(
  people: readonly Acquaintance[],
  now: Tick,
  o: SpeakActsOptions,
  extras: SpeakExtras = {},
): Candidate[] {
  const close = people
    .filter((p) => p.familiarity >= o.minFamiliarity)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const missed = close
    .filter((p) => !p.whereaboutsKnown && p.affection > 0)
    .sort((a, b) => warmth(b) - warmth(a) || (a.id < b.id ? -1 : 1))[0];
  const wanting =
    extras.want && extras.want.urgency >= (o.requestMinUrgency ?? 0.5) ? extras.want : undefined;
  const out: Candidate[] = [];
  for (const p of close) {
    const base = {
      id: `speak:${p.id}`,
      verb: "speak",
      target: p.id as unknown as EntityRef,
      contributes: { social: 0.3 },
      chance: o.chance,
      loss: STAKES_RISK.none.loss,
    } as const;
    const quiet = now - p.updated >= o.quietSeconds;
    const news = (extras.news ?? []).find((n) => n.about !== p.id);
    if (p.owes !== undefined && p.affection > -0.5) {
      out.push({
        ...base,
        mood: r(o.weight * (0.5 + 0.5 * warmth(p))),
        act: { kind: "promise", what: p.owes },
      });
    } else if (wanting && p.affection >= (o.requestMinAffection ?? 0.3)) {
      out.push({
        ...base,
        mood: r(o.weight * wanting.urgency * clamp01(p.affection)),
        act: { kind: "request", what: wanting.what },
      });
    } else if (news && quiet && p.affection > -0.2) {
      out.push({
        ...base,
        mood: r(o.weight * warmth(p)),
        act: { kind: "tell", about: news.about as unknown as EntityRef, claim: news.claim },
      });
    } else if (missed && missed.id !== p.id && p.affection >= 0 && quiet) {
      out.push({
        ...base,
        mood: r(o.weight * warmth(missed)),
        act: { kind: "ask", about: missed.id as unknown as EntityRef },
      });
    } else if (quiet && p.affection > -0.2) {
      out.push({ ...base, mood: r(o.weight * warmth(p)), act: { kind: "greet" } });
    }
  }
  return out;
}

/**
 * Lo que le falta para `request` (puro): con `requestWhat` configurado, pide ese bien si la despensa
 * de su casa tiene menos de `requestEnoughGrams` (y ninguna urgencia si le sobra); sin él, pide sin
 * cosa precisa con la urgencia del hambre.
 */
export function requestWant(
  o: SpeakActsOptions,
  hunger: number,
  larder: readonly { readonly unit: string; readonly amount: number }[] | undefined,
  goods: readonly { readonly id: string; readonly name: string; readonly form: string }[],
): { readonly what: string | null; readonly urgency: number } {
  if (o.requestWhat === undefined) return { what: null, urgency: hunger };
  const good = goods.find((g) => g.name === o.requestWhat && g.form === "good");
  const have = good ? (larder?.find((h) => h.unit === `good:${good.id}`)?.amount ?? 0) : 0;
  return have >= (o.requestEnoughGrams ?? 1000)
    ? { what: o.requestWhat, urgency: 0 }
    : { what: o.requestWhat, urgency: hunger };
}
