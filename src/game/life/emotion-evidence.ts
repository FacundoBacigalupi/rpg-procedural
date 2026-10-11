// Gates de evidencia para emociones propias: sin lectura del estado interior ajeno.
import type { AgentId, Event, Tick } from "../../core/index.ts";
import {
  type Appraised,
  appraisalEmotionSignals,
  appraiseEnvyEmotion,
  appraiseInsultEmotion,
  appraiseLoss,
  appraiseLoveEmotion,
  type EmotionSignal,
  type Percept,
} from "../../sim/index.ts";

/** Contrato de la respuesta entregada de converse: primero oyente, luego hablante conocido. */
export function receivedInsultSignals(
  event: Event,
  now: Tick,
  conscious: boolean,
): EmotionSignal[] {
  if (!conscious || event.tick > now || event.kind !== "action.speak") return [];
  const [listener, speaker] = event.actors;
  if (!listener?.startsWith("agent:") || !speaker?.startsWith("agent:")) return [];
  const effect = (
    event.data as {
      effect?: {
        kind?: string;
        delivered?: boolean;
        to?: string;
        reply?: string;
        regard?: { kind?: string; faceLoss?: number };
      };
    } | null
  )?.effect;
  if (
    effect?.kind !== "speak" ||
    effect.to !== speaker ||
    effect.regard?.kind !== "insult" ||
    (effect.reply !== "insult.hurt" && effect.reply !== "insult.shrug")
  )
    return [];
  const signal = appraiseInsultEmotion(listener as AgentId, {
    offender: speaker as AgentId,
    delivered: effect.delivered === true,
    understood: true,
    feltOffense: effect.regard.faceLoss ?? 0,
    originEventId: event.id,
    at: now,
  });
  return signal ? [{ ...signal, evidence: { kind: "own" as const, event: event.id } }] : [];
}

/** Un appraisal legacy no acredita percepción. Solo violencia corporal propia, culpa del actor y éxito propio en pelea. */
export function ownEmotionSignals(
  owner: AgentId,
  event: Event,
  appraisal: readonly Appraised[],
  now: Tick,
  conscious: boolean,
): EmotionSignal[] {
  if (!conscious || event.tick > now) return [];
  const own = appraisal.filter(
    (a) =>
      (a.stimulus.theme === "violence" &&
        a.blame !== null &&
        event.actors.includes(owner) &&
        (event.kind === "combat.fight" ||
          event.kind === "combat.finish" ||
          event.kind === "family.rearing")) ||
      (a.stimulus.theme === "guilt" &&
        event.actors[0] === owner &&
        event.kind.startsWith("action.")) ||
      // Alegría: el éxito de una pelea que el dueño inició y terminó de pie (appraiseFight).
      (a.stimulus.theme === "success" &&
        a.blame === null &&
        event.kind === "combat.fight" &&
        event.actors[0] === owner),
  );
  return appraisalEmotionSignals(owner, own, event.id, now).map((s) => ({
    ...s,
    evidence: { kind: "own" as const, event: event.id },
  }));
}

/** La identidad es lo que leyó, aunque se haya equivocado: nunca se sustituye por el muerto real. */
export function perceivedLossSignals(
  percept: Percept,
  now: Tick,
  closenessTo: (who: AgentId) => number,
): EmotionSignal[] {
  const who = percept.fields.identity?.value;
  const action = percept.fields.action;
  const identity = percept.fields.identity;
  if (
    !percept.sourceEventId ||
    percept.tick > now ||
    typeof who !== "string" ||
    !who.startsWith("agent:") ||
    action?.value !== "body.died" ||
    action.confidence <= 0 ||
    !identity ||
    identity.confidence <= 0
  )
    return [];
  const appraisal = appraiseLoss(closenessTo(who as AgentId)).map((a) => ({
    ...a,
    stimulus: {
      ...a.stimulus,
      intensity: a.stimulus.intensity * Math.min(action.confidence, identity.confidence),
    },
  }));
  return appraisalEmotionSignals(percept.observer, appraisal, percept.sourceEventId, now).map(
    (s) => ({ ...s, evidence: { kind: "percept" as const, percept: percept.id } }),
  );
}

/** Calidez que se lee de cada acción de cuidado vista (no de la intención del actor). */
const WARM_ACTIONS: Readonly<Record<string, number>> = { "action.give": 0.6, "action.tend": 0.8 };

/** Amor desde una acción cálida vista de alguien identificado al que el observador ya quiere.
 * La identidad es la leída (aunque errónea); sin cariño previo propio, o sin lectura, no nace.
 */
export function perceivedLoveSignals(
  percept: Percept,
  now: Tick,
  affectionFor: (who: AgentId) => number,
): EmotionSignal[] {
  const who = percept.fields.identity?.value;
  const action = percept.fields.action;
  const identity = percept.fields.identity;
  const warmth = typeof action?.value === "string" ? WARM_ACTIONS[action.value] : undefined;
  if (
    !percept.sourceEventId ||
    percept.tick > now ||
    typeof who !== "string" ||
    !who.startsWith("agent:") ||
    warmth === undefined ||
    !action ||
    action.confidence <= 0 ||
    !identity ||
    identity.confidence <= 0
  )
    return [];
  const signal = appraiseLoveEmotion(percept.observer, {
    beloved: who as AgentId,
    affection: affectionFor(who as AgentId),
    warmth,
    confidence: Math.min(action.confidence, identity.confidence),
    originEventId: percept.sourceEventId,
    at: now,
  });
  return signal ? [{ ...signal, evidence: { kind: "percept" as const, percept: percept.id } }] : [];
}

export interface EnvyContext {
  /** Rango ritual (de `rankOfAttire`) que el observador lee en una vestimenta; undefined si no la ubica. */
  readonly rankOfAttire: (attire: string) => number | undefined;
  /** Rango propio que el observador cree tener (undefined: no se compara). */
  readonly ownRank: number | undefined;
  /** Distancia máxima entre rangos del mundo (> 0), para normalizar la ventaja. */
  readonly rankSpan: number;
  /** Cuánto le importa el estatus al observador (0-1, de sus valores). */
  readonly valuesStatus: number;
}

/** Envidia desde la vestimenta vista de alguien identificado de rango mayor al que el observador cree
 * tener. La ventaja es la leída (puede ser ropa que miente); sin rango propio, sin lectura o sin que
 * le importe el estatus no nace. No cambia ningún evento: sólo lee lo percibido.
 */
export function perceivedEnvySignals(
  percept: Percept,
  now: Tick,
  ctx: EnvyContext,
): EmotionSignal[] {
  const who = percept.fields.identity?.value;
  const identity = percept.fields.identity;
  const attire = percept.fields.attire;
  if (
    !percept.sourceEventId ||
    percept.tick > now ||
    typeof who !== "string" ||
    !who.startsWith("agent:") ||
    !identity ||
    identity.confidence <= 0 ||
    typeof attire?.value !== "string" ||
    attire.confidence <= 0 ||
    ctx.ownRank === undefined ||
    !(ctx.rankSpan > 0)
  )
    return [];
  const rival = ctx.rankOfAttire(attire.value);
  if (rival === undefined || rival <= ctx.ownRank) return [];
  const signal = appraiseEnvyEmotion(percept.observer, {
    rival: who as AgentId,
    perceivedGain: (rival - ctx.ownRank) / ctx.rankSpan,
    confidence: Math.min(identity.confidence, attire.confidence),
    gap: 1,
    valued: ctx.valuesStatus,
    originEventId: percept.sourceEventId,
    at: now,
  });
  return signal ? [{ ...signal, evidence: { kind: "percept" as const, percept: percept.id } }] : [];
}
