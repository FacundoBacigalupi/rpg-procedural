// Gates de evidencia para emociones propias: sin lectura del estado interior ajeno.
import type { AgentId, Event, Tick } from "../../core/index.ts";
import {
  type Appraised,
  appraisalEmotionSignals,
  appraiseInsultEmotion,
  appraiseLoss,
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

/** Un appraisal legacy no acredita percepción. Solo violencia corporal propia y culpa del actor. */
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
        event.kind.startsWith("action.")),
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
