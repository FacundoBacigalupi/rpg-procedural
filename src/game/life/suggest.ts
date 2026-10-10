// Las opciones sugeridas (player-loop, ampliación 2026-10-08): una lista corta de cosas que el
// personaje podría hacer ahora, armadas solo con lo que siente y sabe (regla 4): los signos del cuerpo,
// la hora, la gente de su casa que tiene delante. El jugador siempre puede escribir otra cosa; esto
// solo evita quedarse sin qué hacer. Cada opción es un borrador que pasa por el mismo `planFromDraft`
// que el texto del jugador, así que se salta el parser pero no la validación: si el plan no sale
// factible según lo que cree, la opción no aparece.
//
// La cantidad no es fija: hasta `limit` (por defecto `DEFAULT_SUGGESTIONS`), ordenadas por
// saliencia. Cuando existan metas, deberes y utilidad de NPC (Fase 2/3) entran como fuentes nuevas.

import type { AgentId, Tick } from "../../core/index.ts";
import {
  avoidance,
  avoided,
  BODY_STATE,
  bodySigns,
  type DraftArg,
  type IntentDraft,
  LOCATION,
  localHour,
  MENTAL,
  PERSON,
  type PlanNode,
  planFromDraft,
  SKILL_STATE,
} from "../../sim/index.ts";
import { knownEntities } from "./known.ts";
import { deficiencyStagesOf } from "./nutrition.ts";
import { needsConfirmation, type SuggestionTone, suggestionTone } from "./tone.ts";
import type { LifeWorld } from "./world.ts";

export type SuggestionKind =
  | "drink"
  | "eat"
  | "tend"
  | "sleep"
  | "rest"
  | "work"
  | "talk"
  | "look"
  | "wait";

export interface Suggestion {
  /** Estable entre turnos mientras la opción siga siendo la misma ("talk:madre"). */
  readonly id: string;
  readonly kind: SuggestionKind;
  /** Con quién, para `talk`: la relación que sabe que tiene. */
  readonly with?: string;
  /** 0-1: cuánto se impone; ordena la lista. */
  readonly salience: number;
  readonly draft: IntentDraft;
  /** Qué clase de cosa es, de un vistazo (player-loop «Tono de las opciones»). */
  readonly tone: SuggestionTone;
  /** Las graves piden un segundo toque antes de jugarse. */
  readonly confirm: boolean;
}

/** El tono base de cada clase de opción, antes de mirar el catálogo. */
const BASE_TONE: Readonly<Record<SuggestionKind, SuggestionTone>> = {
  drink: "need",
  eat: "need",
  tend: "need",
  sleep: "need",
  rest: "routine",
  work: "routine",
  talk: "social",
  look: "routine",
  wait: "routine",
};

function verbsOf(node: PlanNode): string[] {
  switch (node.kind) {
    case "do":
      return [node.verb];
    case "seq":
      return node.steps.flatMap(verbsOf);
    case "until":
      return verbsOf(node.body);
    default:
      return [];
  }
}

/** Cuántas opciones se muestran sin pedir más. */
export const DEFAULT_SUGGESTIONS = 4;

const act = (verb: string, args: DraftArg[] = []): IntentDraft => ({
  kind: "act",
  plan: { kind: "do", verb, args },
});

const hours = (amount: number) => ({ amount, unit: "hour" as const });

function feelings(w: LifeWorld): ReadonlySet<string> {
  const body = w.truth.get(BODY_STATE, w.player);
  const plan = body && w.plans.find((p) => p.id === body.plan);
  if (!body || !plan) return new Set();
  const signs = bodySigns(
    plan,
    body,
    false,
    deficiencyStagesOf(w.truth, w.player, w.deficiencySigns),
  );
  return new Set([...signs.general, ...signs.zones.flatMap((z) => z.signs)]);
}

/** Las candidatas, sin validar. */
function candidates(w: LifeWorld, now: Tick): Suggestion[] {
  const felt = feelings(w);
  const has = (...signs: string[]) => signs.some((s) => felt.has(s));
  const hour = localHour(w.clock, now, w.map.lonDeg);
  const night = hour < 6 || hour >= 21;
  const mental = w.truth.get(MENTAL, w.player);
  const out: Suggestion[] = [];
  const add = (
    kind: SuggestionKind,
    salience: number,
    draft: IntentDraft,
    extra: { id?: string; with?: string } = {},
  ) =>
    out.push({
      id: extra.id ?? kind,
      kind,
      salience,
      draft,
      tone: BASE_TONE[kind],
      confirm: false,
      ...(extra.with ? { with: extra.with } : {}),
    });

  if (has("parched", "thirsty")) add("drink", has("parched") ? 0.95 : 0.8, act("drink"));
  if (has("starving", "hungry")) add("eat", has("starving") ? 0.9 : 0.7, act("eat"));
  if (has("bleeding", "bleeding_heavily", "wound_hot", "bone_broken")) {
    add("tend", has("bleeding_heavily", "bone_broken") ? 0.97 : 0.75, act("tend"));
  }
  if (has("exhausted", "sleepy", "tired") || night) {
    const tired = has("exhausted") ? 0.85 : has("sleepy", "tired") ? 0.6 : 0.4;
    add("sleep", night ? Math.max(tired, 0.5) : tired, {
      kind: "plan",
      plan: {
        kind: "until",
        body: { kind: "do", verb: "rest", args: [] },
        cond: { kind: "time", text: "hasta que amanezca", is: { kind: "light" } },
      },
    });
  } else {
    add("rest", 0.2, act("rest", [{ role: "for", duration: hours(1) }]));
  }
  if (!night && hour >= 7 && hour < 18 && !has("exhausted", "bleeding_heavily", "bone_broken")) {
    add("work", 0.45, act("work", [{ role: "for", duration: hours(4) }]));
  }
  for (const e of knownEntities(w)) {
    if (e.kind !== "person" || !e.present) continue;
    const rel = e.relations[0]?.rel;
    if (rel === undefined) continue;
    // Evitación (npc-psychology §11): acercarse a quien dispara su trauma o su culpa pesa menos.
    add(
      "talk",
      avoided(0.35, avoidance(mental, { who: e.ref as AgentId })),
      act("speak", [
        {
          role: "to",
          ref: { text: `mi ${rel}`, kind: "person", features: [], relation: { to: "self", rel } },
        },
      ]),
      { id: `talk:${rel}`, with: rel },
    );
  }
  add("look", 0.15, act("look"));
  add("wait", 0.05, act("wait", [{ role: "for", duration: hours(1) }]));
  return out;
}

/**
 * Las opciones de ahora, ordenadas por saliencia y recortadas a `limit`; las que el plan no
 * valida con lo que el personaje sabe quedan afuera. Sin `limit` salen todas (para «ver más»).
 */
export function suggestions(w: LifeWorld, limit?: number): Suggestion[] {
  const here = w.truth.get(LOCATION, w.player)?.hex;
  const me = w.truth.get(PERSON, w.player);
  if (!me) return [];
  const known = knownEntities(w);
  const skills = w.truth.get(SKILL_STATE, w.player);
  const toned = candidates(w, w.scheduler.now).flatMap((s): Suggestion[] => {
    const made = planFromDraft(s.draft, {
      actor: w.player,
      source: "player",
      catalog: w.catalog,
      known,
      clock: w.clock,
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
      here,
    });
    if (made.kind !== "plan") return [];
    const verbs = verbsOf(made.plan.root).map((v) => w.catalog.verb(v));
    const tone = suggestionTone(BASE_TONE[s.kind], verbs, skills);
    return [{ ...s, tone, confirm: needsConfirmation(tone) }];
  });
  const sorted = toned.sort((a, b) => b.salience - a.salience || (a.id < b.id ? -1 : 1));
  return limit === undefined ? sorted : sorted.slice(0, limit);
}
