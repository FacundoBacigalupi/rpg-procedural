// El comando «pensar sobre X» / «¿qué hago con X?» (player-loop "Pensar", information §4): el
// personaje junta lo que tiene en la cabeza —sus creencias, envejecidas— y lo pasa por las reglas
// de inferencia que conoce (`knownRules`) con su inteligencia, sus esquemas, su cansancio y su
// miedo. Devuelve estructura (qué cree, con qué seguridad, de qué evidencia), no texto: la voz es
// de la UI o del narrador. No pasa el tiempo ni se lee la verdad.

import { type AgentId, compareStrings, type EntityRef } from "../../core/index.ts";
import {
  BELIEFS,
  BODY_STATE,
  beliefConfidenceAt,
  type Fact,
  INNATE,
  type InferenceRuleDef,
  infer,
  knownRules,
  MIND,
  type Premise,
  type Reasoner,
  rainBetween,
  SKILL_STATE,
  skillLevel,
  type Thought,
  thinkAbout,
  toRule,
} from "../../sim/index.ts";
import type { ThoughtInput } from "../view/index.ts";
import { headPremises } from "./evidence.ts";
import { SLEEP_STATE } from "./sleep.ts";
import type { LifeWorld } from "./world.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Cómo está el que piensa: lo que el panel puede decir de su estado, sin cifras. */
export interface ThinkState {
  readonly tired: boolean;
  readonly afraid: boolean;
}

export interface ThinkResult {
  readonly thoughts: readonly Thought[];
  readonly state: ThinkState;
  /** Cuántas premisas había en la cabeza (0: no tiene nada con qué pensar). */
  readonly evidence: number;
}

/** Desde cuánto cansancio o miedo se nota al pensar. */
export const THINK_NOTICE = 0.5;

/** Quien razona es el personaje: inteligencia de `INNATE`, esquemas de `MIND`, cuerpo y sueño. */
export function reasonerOf(w: LifeWorld, defs: readonly InferenceRuleDef[]): Reasoner {
  const me = w.player;
  const innate = w.truth.get(INNATE, me) ?? {};
  const mind = w.truth.get(MIND, me);
  const body = w.truth.get(BODY_STATE, me);
  const owned = w.truth.get(SKILL_STATE, me) ?? {};
  const skills: Record<string, number> = {};
  for (const [id, state] of Object.entries(owned)) {
    const def = w.skills.skill(id);
    if (def) skills[id] = skillLevel(def, state);
  }
  const schemas = Object.fromEntries(
    Object.entries(mind?.schemas ?? {}).map(([id, h]) => [id, h.strength]),
  );
  return {
    intellect: clamp01(innate["intellect"] ?? 0.5),
    rules: knownRules(defs, { skills, schemas }),
    fatigue: clamp01(body?.fatigue ?? 0),
    fear: clamp01(w.truth.get(SLEEP_STATE, me)?.fear ?? 0),
    suspicion: clamp01(schemas["people_are_untrustworthy"] ?? 0),
  };
}

function sourceKind(kind: string | undefined): Premise["kind"] {
  return kind === "told" ? "told" : kind === "reasoning" ? "inference" : "percept";
}

/**
 * Las premisas de la cabeza: dónde cree que está alguien y si vive (creencias envejecidas) y lo que
 * tiene delante (heridas a la vista y huellas atadas a un hecho que sabe, `headPremises`).
 */
export function evidenceOf(w: LifeWorld): Premise[] {
  const items = w.truth.get(BELIEFS, w.player)?.items ?? [];
  const now = w.scheduler.now;
  const beliefs = items.flatMap((b): Premise[] => {
    const confidence = beliefConfidenceAt(b, now);
    if (confidence <= 0) return [];
    const subject = b.prop.subject;
    const ref = `belief:${subject}:${b.prop.attr}`;
    const fact: Fact =
      b.prop.attr === "alive"
        ? { pred: b.value === true ? "alive" : "dead", args: [subject] }
        : b.prop.attr === "purpose"
          ? { pred: "intends", args: [subject, String(b.value)] }
          : { pred: "at", args: [subject, String((b.value as { hex: number }).hex)] };
    return [{ fact, confidence, kind: sourceKind(b.sources.at(-1)?.kind), ref }];
  });
  const here = headPremises(w.truth, w.player, now, (made) =>
    rainBetween(w.map, w.clock, w.seed, made, now),
  );
  return [...beliefs, ...here];
}

/** Piensa sobre `topic` (el id de una persona o lugar que conoce). */
export function thinkOn(
  w: LifeWorld,
  defs: readonly InferenceRuleDef[],
  topic: AgentId | string,
): ThinkResult {
  const who = reasonerOf(w, defs);
  const evidence = evidenceOf(w);
  const found = infer(evidence, defs.map(toRule), who);
  return {
    thoughts: thinkAbout(found, topic),
    state: { tired: who.fatigue >= THINK_NOTICE, afraid: who.fear >= THINK_NOTICE },
    evidence: evidence.length,
  };
}

/** De qué quiere pensar: el resto de la línea sin el comando ni artículos, o `undefined` si no hay. */
export function topicText(line: string): string | undefined {
  const rest = line
    .trim()
    .replace(/^¿?(?:qu[eé] hago (?:con|sobre)|pens[aá]r?|pienso|reflexion[oa]r?)\s*/iu, "")
    .replace(/^(?:sobre|en|acerca de)\s+/iu, "")
    .replace(/[?¿!.]+$/u, "")
    .replace(/^(?:el|la|los|las|mi|mis|un|una)\s+/iu, "")
    .trim()
    .toLowerCase();
  return rest === "" ? undefined : rest;
}

/** La cosa o persona conocida a la que se refiere el tema (por cualquiera de sus nombres). */
export function topicEntity(
  text: string,
  known: readonly { readonly ref: string; readonly names: readonly string[] }[],
): string | undefined {
  const strip = (s: string) => s.toLowerCase().replace(/^(?:el|la|los|las|mi|mis)\s+/u, "");
  return known.find((k) => k.names.some((n) => strip(n) === text))?.ref;
}

/** La clase de evidencia que cita una referencia de premisa (sin ids ni cifras). */
function becauseOf(ref: string): string | undefined {
  if (ref.startsWith("wound:")) return "wound";
  if (ref.startsWith("trace:")) return "tracks";
  if (ref.startsWith("belief:")) return "inference";
  return undefined;
}

/**
 * Lo que concluyó al pensar, como pensamientos para el narrador (`PlayerView.thoughts`, modo
 * introspección): hecho, banda, rival y clases de evidencia citadas. Sin cifras de confianza.
 */
export function thoughtInputsOf(result: ThinkResult): ThoughtInput[] {
  return result.thoughts.map((t) => {
    const because = [...new Set(t.support.flatMap((s) => becauseOf(s) ?? []))].sort(compareStrings);
    return {
      kind: "conclude",
      conclusion: {
        pred: t.fact.pred,
        args: t.fact.args as readonly EntityRef[],
        band: t.band,
        ...(t.rival !== undefined
          ? { rival: { pred: t.rival.pred, args: t.rival.args as readonly EntityRef[] } }
          : {}),
        ...(because.length > 0 ? { because } : {}),
      },
    };
  });
}
