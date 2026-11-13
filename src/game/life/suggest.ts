// Las opciones sugeridas (player-loop, ampliación 2026-10-08): una lista corta de cosas que el
// personaje podría hacer ahora, armadas solo con lo que siente y sabe (regla 4): los signos del cuerpo,
// la hora, la gente de su casa que tiene delante. El jugador siempre puede escribir otra cosa; esto
// solo evita quedarse sin qué hacer. Cada opción es un borrador que pasa por el mismo `planFromDraft`
// que el texto del jugador, así que se salta el parser pero no la validación: si el plan no sale
// factible según lo que cree, la opción no aparece.
//
// La cantidad no es fija: hasta `limit` (por defecto `DEFAULT_SUGGESTIONS`), ordenadas por
// saliencia. Las metas del personaje suman una opción cada una (novel-goals-hooks: `goal`); deberes
// y utilidad de NPC (Fase 2/3) entran como fuentes nuevas.

import type { AgentId, Tick } from "../../core/index.ts";
import {
  avoidance,
  avoided,
  BODY_STATE,
  believesSectHere,
  bodySigns,
  type DraftArg,
  type IntentDraft,
  LOCATION,
  localHour,
  MENTAL,
  nextTreatment,
  PERSON,
  type PlanNode,
  planFromDraft,
  SECT_LORE,
  SKILL_STATE,
  VILLAGE_SQUARE,
} from "../../sim/index.ts";
import type { GoalSketch } from "../view/index.ts";
import { anyLivePause } from "./fight.ts";
import { activePlayerGoals, type PlayerGoal } from "./goals.ts";
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
  | "wait"
  | "goal"
  | "fight";

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
  /** Para `goal`: qué meta la propone y cómo se lee la opción («observar a Langdang…»). */
  readonly goal?: { readonly id: number; readonly text: string; readonly say: string };
  /** Para `fight`: con quién sigue la pelea pausada y para qué (sin modo, como venía). */
  readonly fight?: { readonly who: string; readonly manner?: FightManner };
}

/** Los modos de `strike` que se ofrecen al retomar una pelea pausada (novel3-intent-panel). */
export type FightManner = "kill" | "drive_off" | "escape";

/** Las metas del personaje y su catálogo, para las opciones que proponen (novel-goals-hooks). */
export interface SuggestionGoals {
  readonly goals: readonly PlayerGoal[];
  readonly sketches: readonly GoalSketch[];
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
  goal: "routine",
  fight: "violent",
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
function candidates(w: LifeWorld, now: Tick, goals?: SuggestionGoals): Suggestion[] {
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
  // Curar solo se ofrece si hay algo que hacer (vendar, limpiar, entablillar): ya curado, no se repite.
  const hurt = w.truth.get(BODY_STATE, w.player);
  if (
    has("bleeding", "bleeding_heavily", "wound_hot", "bone_broken") &&
    hurt &&
    nextTreatment(hurt) !== null
  ) {
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
  for (const s of goalCandidates(w, goals)) out.push(s);
  for (const s of fightCandidates(w, now)) out.push(s);
  return out;
}

/** Arriba de todo lo demás: con la pelea en pausa no hay otra cosa más urgente. */
const FIGHT_OPTIONS: readonly { readonly manner?: FightManner; readonly salience: number }[] = [
  { salience: 0.999 },
  { manner: "kill", salience: 0.998 },
  { manner: "drive_off", salience: 0.997 },
  { manner: "escape", salience: 0.996 },
];

/**
 * Con una pelea pausada que sigue viva (novel3-intent-panel): seguir peleando, matarlo, echarlo o
 * escaparse, contra el rival como lo nombra el personaje. Si no lo tiene delante con un nombre para
 * señalarlo, no hay opción (escribir sigue andando).
 */
function fightCandidates(w: LifeWorld, now: Tick): Suggestion[] {
  const paused = anyLivePause(w.truth, w.player, now);
  if (!paused) return [];
  const foe = knownEntities(w).find((k) => k.ref === paused.foe && k.present);
  const who = foe?.names[0];
  if (who === undefined) return [];
  const ref = { text: who, kind: "person" as const, features: [] };
  return FIGHT_OPTIONS.map((o) => ({
    id: `fight:${o.manner ?? "on"}`,
    kind: "fight" as const,
    salience: o.salience,
    draft: {
      kind: "act" as const,
      plan: {
        kind: "do" as const,
        verb: "strike",
        args: [{ role: "target" as const, ref }],
        ...(o.manner ? { manner: [o.manner] } : {}),
      },
    },
    tone: BASE_TONE.fight,
    confirm: false,
    fight: { who, ...(o.manner ? { manner: o.manner } : {}) },
  }));
}

/**
 * Una opción por meta activa con `suggest` en su bosquejo (novel-goals-hooks): la de una persona
 * solo si el personaje la tiene delante; el resto, trabajar de más. Solo con lo que sabe (regla 4).
 */
function goalCandidates(w: LifeWorld, goals?: SuggestionGoals): Suggestion[] {
  if (goals === undefined) return [];
  const known = knownEntities(w);
  const out: Suggestion[] = [];
  for (const g of activePlayerGoals(goals.goals)) {
    const s = goals.sketches.find((k) => k.id === g.sketch)?.suggest;
    if (s === undefined) continue;
    let draft: IntentDraft;
    let who: string | undefined;
    if (s.when === "sect_visit") {
      // Solo el día que cree que la secta está en la plaza, y si no está ya ahí.
      if (!believesSectHere(w.truth.get(SECT_LORE, w.player), w.scheduler.now, w.clock)) continue;
      if (w.truth.get(LOCATION, w.player)?.space === VILLAGE_SQUARE) continue;
    }
    if (s.place !== undefined) {
      draft = act(s.verb, [{ role: "to", ref: { text: s.place, kind: "place", features: [] } }]);
    } else if (s.person === true) {
      const e = known.find((k) => k.ref === g.target && k.present && k.kind === "person");
      who = e?.names[0];
      if (who === undefined) continue;
      const ref = { text: who, kind: "person" as const, features: [] };
      draft = act(s.verb, [{ role: s.verb === "speak" ? "to" : "target", ref }]);
    } else {
      draft = act(s.verb, [{ role: "for", duration: hours(s.hours ?? 4) }]);
    }
    out.push({
      id: `goal:${g.id}`,
      kind: "goal",
      salience: s.when !== undefined ? 0.6 : s.person === true ? 0.55 : 0.4,
      draft,
      tone: BASE_TONE.goal,
      confirm: false,
      goal: { id: g.id, text: g.text, say: s.say.replace("{who}", who ?? "") },
    });
  }
  return out;
}

/**
 * Las opciones de ahora, ordenadas por saliencia y recortadas a `limit`; las que el plan no
 * valida con lo que el personaje sabe quedan afuera. Sin `limit` salen todas (para «ver más»).
 */
export function suggestions(w: LifeWorld, limit?: number, goals?: SuggestionGoals): Suggestion[] {
  const here = w.truth.get(LOCATION, w.player)?.hex;
  const me = w.truth.get(PERSON, w.player);
  if (!me) return [];
  const known = knownEntities(w);
  const skills = w.truth.get(SKILL_STATE, w.player);
  const toned = candidates(w, w.scheduler.now, goals).flatMap((s): Suggestion[] => {
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
