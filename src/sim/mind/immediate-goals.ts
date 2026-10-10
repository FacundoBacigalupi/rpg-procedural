// La capa inmediata registra presiones sentidas, sin volver a sumarlas a la utilidad (§7).
// El miedo disponible es el de recuerdos dolorosos propios, no emociones de terceros.
import {
  type AgentId,
  compareStrings,
  type EventId,
  exp,
  LN2,
  type Tick,
} from "../../core/index.ts";
import {
  type CravingCue,
  type CueContext,
  craving,
  cueCraving,
  cueStrength,
  cuesOf,
  type HeldSubstance,
  type SubstanceDef,
} from "../body/index.ts";
import { EMOTION_HALF_LIFE_TICKS, type EmotionSignal, emotionIntensityAt } from "./emotions.ts";
import type { Goal } from "./goals.ts";
import type { Memories } from "./memory.ts";
import type { ValueId } from "./mind.ts";
import type { NeedId } from "./utility.ts";
import { WARM_VALENCE } from "./utility-beliefs.ts";

/** Umbral y vida media provisionales; la emoción decae en horas, aunque el recuerdo perdure. */
export const IMMEDIATE_MIN = 0.5;
export const IMMEDIATE_FEAR_HALF_LIFE = 6 * 3600;
export const MAX_IMMEDIATE_GOALS = 3;

export interface FeltNeed {
  readonly need: NeedId;
  readonly urgency: number;
  readonly originEventId: EventId;
}

/** Ansia propia con procedencia de dosis o señales aprendidas; filas viejas no aportan causas.
 * `scale` es el mismo factor de etapa de vida que ya aplica la utilidad.
 */
export function feltCravingNeeds(
  held: readonly HeldSubstance[],
  defs: readonly SubstanceDef[],
  cues: readonly CravingCue[],
  context: CueContext | undefined,
  now: Tick,
  halfLifeTicks: number,
  scale = 1,
): FeltNeed[] {
  const out: FeltNeed[] = [];
  for (const h of held) {
    if (h.originEventId === undefined) continue;
    const def = defs.find((d) => d.id === h.substance);
    if (def)
      out.push({
        need: "craving",
        urgency: craving(def, h.state) * scale,
        originEventId: h.originEventId,
      });
  }
  if (context) {
    const here = cuesOf(context);
    const known = cues
      .filter(
        (c) =>
          c.originEventId !== undefined &&
          c.at <= now &&
          here.some((t) => t.kind === c.kind && t.key === c.key),
      )
      .sort((a, b) =>
        compareStrings(`${a.substance}|${a.kind}|${a.key}`, `${b.substance}|${b.kind}|${b.key}`),
      );
    const strongest = [...known].sort(
      (a, b) =>
        cueStrength(b, now, halfLifeTicks) - cueStrength(a, now, halfLifeTicks) ||
        compareStrings(a.originEventId as EventId, b.originEventId as EventId),
    )[0];
    if (strongest?.originEventId !== undefined)
      out.push({
        need: "craving",
        urgency: cueCraving(known, context, now, halfLifeTicks) * scale,
        originEventId: strongest.originEventId,
      });
  }
  return out;
}

/** Fuente de la soledad sentida: su último contacto grato vivido con alguien querido.
 * Una noticia sobre otro no demuestra compañía propia; sin contacto recordado no inventa uno.
 */
export function feltCompanyNeed(
  memories: Memories | undefined,
  now: Tick,
  urgency: number,
  cares: (who: AgentId) => boolean,
): FeltNeed | undefined {
  const warm = (memories?.items ?? [])
    .filter(
      (m) =>
        m.at <= now &&
        m.source === "witnessed" &&
        m.valence >= WARM_VALENCE &&
        m.intensity > 0 &&
        m.confidence > 0 &&
        m.perceived.with.some(cares),
    )
    .sort((a, b) => b.at - a.at || compareStrings(a.eventId, b.eventId))[0];
  return warm ? { need: "social", urgency, originEventId: warm.eventId } : undefined;
}

/** `meaning` no tiene objetivo inmediato: es una presión lenta, no una urgencia sentida. */
const VALUE: Readonly<Partial<Record<NeedId, ValueId>>> = {
  hunger: "safety",
  thirst: "safety",
  pain: "safety",
  safety: "safety",
  rest: "pleasure",
  social: "family",
  craving: "pleasure",
};
/** Valor que cada emoción propia mueve en la capa inmediata (provisional; ira y tristeza aún sin proyección). */
const EMOTION_VALUE: Readonly<Partial<Record<EmotionSignal["emotion"], ValueId>>> = {
  fear: "safety",
  joy: "pleasure",
  shame: "status",
  envy: "status",
  love: "family",
};
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** Sin señal con procedencia no nace un objetivo. Una memoria futura tampoco es una señal. */
export function immediateGoals(
  needs: readonly FeltNeed[],
  memories: Memories | undefined,
  core: readonly Goal[],
  now: Tick,
  emotions?: {
    readonly owner: AgentId;
    readonly signals: readonly EmotionSignal[];
    readonly reactivity: number;
  },
): Goal[] {
  const signals = new Map<string, { value: ValueId; weight: number; origin: EventId }>();
  const add = (id: string, value: ValueId, weight: number, origin: EventId) => {
    const w = round(clamp(weight));
    if (!Number.isFinite(w) || w < IMMEDIATE_MIN) return;
    const previous = signals.get(id);
    if (
      !previous ||
      w > previous.weight ||
      (w === previous.weight && compareStrings(origin, previous.origin) < 0)
    )
      signals.set(id, { value, weight: w, origin });
  };
  for (const n of needs) {
    const value = VALUE[n.need];
    if (value !== undefined) add(`immediate:${n.need}`, value, n.urgency, n.originEventId);
  }
  for (const m of memories?.items ?? []) {
    if (m.at > now || m.valence >= 0) continue;
    const fear =
      m.intensity * -m.valence * m.salience * exp((-LN2 * (now - m.at)) / IMMEDIATE_FEAR_HALF_LIFE);
    add("immediate:fear", "safety", fear, m.eventId);
  }
  for (const s of emotions?.signals ?? []) {
    if (!emotions || s.owner !== emotions.owner || s.evidence === undefined) continue;
    const value = EMOTION_VALUE[s.emotion];
    const halfLifeTicks =
      EMOTION_HALF_LIFE_TICKS[s.emotion as keyof typeof EMOTION_HALF_LIFE_TICKS];
    if (value === undefined || halfLifeTicks === undefined) continue;
    add(
      `immediate:${s.emotion}`,
      value,
      emotionIntensityAt(s, now, { halfLifeTicks, reactivity: emotions.reactivity }),
      s.originEventId,
    );
  }
  const coreIds = new Set(core.map((g) => g.id));
  return [...signals]
    .map(
      ([id, s]): Goal => ({
        id,
        layer: "immediate",
        kind: "pursue",
        value: s.value,
        weight: s.weight,
        originEventId: s.origin,
        since: now,
        ...(coreIds.has(`core:${s.value}`) ? { parent: `core:${s.value}` } : {}),
      }),
    )
    .sort((a, b) => b.weight - a.weight || compareStrings(a.id, b.id))
    .slice(0, MAX_IMMEDIATE_GOALS);
}
