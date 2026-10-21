// La cultura nombra la condición (npc-psychology §11, culture): cada cultura tiene una teoría de la
// mente (rasgo `mind.theory`) y para cada tipo de condición una etiqueta con su tratamiento, su
// estigma y cuánto ayuda de verdad (a veces por razones reales: rutina, comunidad; a veces daña).
// Núcleo puro: la etiqueta es una creencia de alguien sobre alguien, no la condición. Sin cablear.

import type { AgentId, Tick } from "../../core/index.ts";
import { contentId, defineContent, type EventId, z } from "../../core/index.ts";
import type { Evidence } from "../knowledge/index.ts";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Los tipos de §11. Los que `conditions.ts` ya guarda son un subconjunto (trauma, culpa). */
export const LABELED_KINDS = ["grief", "depression", "trauma", "addiction", "guilt"] as const;
export type LabeledKind = (typeof LABELED_KINDS)[number];

export const MENTAL_TREATMENTS = [
  "none",
  "exorcism",
  "herbs",
  "confinement",
  "meditation",
  "ritual",
  "family_care",
] as const;
export type MentalTreatment = (typeof MENTAL_TREATMENTS)[number];

export const MentalLabelDef = z.strictObject({
  id: contentId,
  /** Variante del rasgo de cultura `mind.theory`. */
  theory: contentId,
  kind: z.enum(LABELED_KINDS),
  name: z.string().min(1),
  treatment: z.enum(MENTAL_TREATMENTS),
  /** 0-1: cuánto desprestigia al que la lleva. */
  stigma: z.number().min(0).max(1),
  /** -1..1: efecto real del trato sobre la cura (negativo = daña). */
  help: z.number().min(-1).max(1),
});
export type MentalLabelDef = z.infer<typeof MentalLabelDef>;
export const MENTAL_LABELS = defineContent("mental-labels", MentalLabelDef);

/** Teoría de respaldo cuando la cultura no tiene el rasgo o la variante no define el tipo. */
export const DEFAULT_THEORY = "plain";

/** Cómo lo ve alguien (incluido el que lo sufre): una creencia, puede ser falsa o parcial. */
export interface ConditionBelief {
  readonly holder: AgentId;
  readonly about: AgentId;
  readonly kind: LabeledKind;
  readonly label: string;
  readonly confidence: number;
  readonly sourceEventId: EventId;
}

/** La etiqueta de una teoría para un tipo; cae a la teoría por defecto, o a nada. */
export function labelFor(
  defs: readonly MentalLabelDef[],
  theory: string | undefined,
  kind: LabeledKind,
): MentalLabelDef | undefined {
  const find = (t: string) => defs.find((d) => d.theory === t && d.kind === kind);
  return (theory === undefined ? undefined : find(theory)) ?? find(DEFAULT_THEORY);
}

/**
 * Lo que `holder` cree que le pasa a `about`: la etiqueta de la teoría de `holder` sobre el tipo de
 * condición. Cita el evento que se lo mostró. Condiciones que no tienen etiqueta (otros tipos): nada.
 */
export function believeCondition(
  defs: readonly MentalLabelDef[],
  theory: string | undefined,
  holder: AgentId,
  about: AgentId,
  condition: { readonly kind: string; readonly severity: number },
  confidence: number,
  sourceEventId: EventId,
): ConditionBelief | undefined {
  if (!(LABELED_KINDS as readonly string[]).includes(condition.kind)) return undefined;
  const kind = condition.kind as LabeledKind;
  const def = labelFor(defs, theory, kind);
  if (!def) return undefined;
  return {
    holder,
    about,
    kind,
    label: def.id,
    confidence: round(clamp01(confidence)),
    sourceEventId,
  };
}

/**
 * La creencia como evidencia del libro `BELIEFS` (`knowledge/belief.ts`): proposición `condition` del
 * sujeto, valor el id de la etiqueta, fuente un percept que cita el evento. Pura.
 */
export function conditionEvidence(belief: ConditionBelief, now: Tick): Evidence {
  return {
    prop: { kind: "attr", subject: belief.about, attr: "condition" },
    value: belief.label,
    confidence: belief.confidence,
    asOf: now,
    source: { kind: "percept", percept: "condition", tick: now, event: belief.sourceEventId },
  };
}

/**
 * Qué condición se nombra de alguien: la más grave de las que tienen etiqueta (la que tira del resto).
 */
export function visibleCondition<T extends { readonly kind: string; readonly severity: number }>(
  conditions: readonly T[],
): T | undefined {
  let best: T | undefined;
  for (const c of conditions) {
    if (!(LABELED_KINDS as readonly string[]).includes(c.kind)) continue;
    if (best === undefined || c.severity > best.severity) best = c;
  }
  return best;
}

/** Apoyo (0-1) que el trato cultural suma a la cura: solo lo que ayuda; lo que daña no la acelera. */
export function treatmentSupport(def: MentalLabelDef | undefined): number {
  return def ? round(Math.max(0, def.help)) : 0;
}

/** Factor (>0) sobre la vida media: el trato que daña (`help < 0`) alarga la condición hasta 1,5×. */
export function treatmentHarm(def: MentalLabelDef | undefined): number {
  return def ? round(1 + 0.5 * Math.max(0, -def.help)) : 1;
}

/** Estigma (0-1) que cae sobre quien la lleva: crece con la gravedad visible, no sobre lo oculto. */
export function stigmaOf(def: MentalLabelDef | undefined, severity: number): number {
  return def ? round(clamp01(def.stigma * clamp01(severity))) : 0;
}

/** Tratamientos que sacan a la persona de la vista: la familia lo esconde o lo encierra. */
export const HIDING: ReadonlySet<MentalTreatment> = new Set<MentalTreatment>(["confinement"]);
export const hides = (def: MentalLabelDef | undefined): boolean =>
  def !== undefined && HIDING.has(def.treatment);
