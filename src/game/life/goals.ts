// Las metas del personaje que escribe el jugador (player-loop §8, `novel-goals-set`): «quiero entrar
// a una secta» queda como `PlayerGoal` con el texto, el bosquejo del catálogo cerrado
// (`content/goals/`) y, si la meta es sobre alguien, a quién. Son del personaje, no misiones: no hay
// marcadores ni pasos sugeridos. Por ahora viven en `meta` (fuera del hash, como las reglas de los
// saltos): las leen el panel y el narrador; entrar a los objetivos del agente es `novel-goals-truth`.
// Puro sobre sus entradas.

import type { AgentId, Tick } from "../../core/index.ts";
import type { GoalSketch } from "../view/index.ts";
import type { WatchRule } from "./interrupts.ts";

export const GOAL_STATUSES = ["active", "abandoned", "achieved_believed"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface PlayerGoal {
  /** Número estable dentro de la vida (1, 2…), para abandonarla por número. */
  readonly id: number;
  /** Lo que escribió el usuario, tal cual. */
  readonly text: string;
  /** El bosquejo del catálogo que la frase nombra; falta si no se reconoce ninguno. */
  readonly sketch?: string;
  /** La persona de la meta (la de una venganza, a quien proteger), si la conoce. */
  readonly target?: AgentId;
  readonly setAt: Tick;
  readonly status: GoalStatus;
}

/** Sin mayúsculas ni tildes, para comparar palabras. */
export function foldWords(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * El bosquejo que nombra la frase: el de la palabra que aparece primero (en «entrar a una secta
 * para vengar a mi padre» manda la secta); empate por id. Las palabras del catálogo son prefijos
 * de palabra («cultiv» vale «cultivar» y «cultivo»).
 */
export function sketchOf(
  text: string,
  sketches: readonly GoalSketch[],
): { sketch: GoalSketch; at: number; end: number } | undefined {
  const t = ` ${foldWords(text)}`;
  let best: { sketch: GoalSketch; at: number; end: number } | undefined;
  for (const s of sketches) {
    for (const w of s.words) {
      const at = t.indexOf(` ${foldWords(w)}`);
      if (at < 0) continue;
      const better =
        best === undefined || at < best.at || (at === best.at && s.id < best.sketch.id);
      if (better) best = { sketch: s, at, end: at + w.length + 1 };
    }
  }
  return best;
}

/**
 * La persona conocida que nombra la frase (el nombre más largo que aparece como palabras enteras,
 * sin «el/la/mi»); empate por referencia. Solo agentes.
 */
export function goalTarget(
  text: string,
  known: readonly { readonly ref: string; readonly names: readonly string[] }[],
): AgentId | undefined {
  const t = ` ${foldWords(text).replace(/[^a-z0-9ñ ]/g, " ")} `;
  let best: { ref: string; len: number } | undefined;
  for (const k of known) {
    if (!k.ref.startsWith("agent")) continue;
    for (const n of k.names) {
      const name = foldWords(n).replace(/^(?:el|la|los|las|mi|mis)\s+/u, "");
      if (name.length === 0 || !t.includes(` ${name} `)) continue;
      const better =
        best === undefined ||
        name.length > best.len ||
        (name.length === best.len && k.ref < best.ref);
      if (better) best = { ref: k.ref, len: name.length };
    }
  }
  return best?.ref as AgentId | undefined;
}

/** Las metas guardadas, o ninguna si el guardado no tiene la forma. */
export function playerGoalsOf(raw: unknown): PlayerGoal[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (g): g is PlayerGoal =>
      typeof g === "object" &&
      g !== null &&
      typeof (g as PlayerGoal).id === "number" &&
      typeof (g as PlayerGoal).text === "string" &&
      typeof (g as PlayerGoal).setAt === "number" &&
      GOAL_STATUSES.includes((g as PlayerGoal).status),
  );
}

export function activePlayerGoals(goals: readonly PlayerGoal[]): PlayerGoal[] {
  return goals.filter((g) => g.status === "active");
}

/**
 * Agrega una meta. Si ya hay una activa con el mismo texto (o el mismo bosquejo y la misma persona),
 * no la repite: devuelve esa como `same`.
 */
export function addGoal(
  goals: readonly PlayerGoal[],
  text: string,
  sketches: readonly GoalSketch[],
  known: readonly { readonly ref: string; readonly names: readonly string[] }[],
  at: Tick,
): { goals: PlayerGoal[]; goal: PlayerGoal; same: boolean } {
  const found = sketchOf(text, sketches);
  const target =
    found !== undefined && found.sketch.target !== "none"
      ? goalTarget(` ${foldWords(text)} `.slice(found.end), known)
      : undefined;
  const same = activePlayerGoals(goals).find(
    (g) =>
      foldWords(g.text) === foldWords(text) ||
      (found !== undefined && g.sketch === found.sketch.id && g.target === target),
  );
  if (same !== undefined) return { goals: [...goals], goal: same, same: true };
  const goal: PlayerGoal = {
    id: goals.reduce((m, g) => Math.max(m, g.id), 0) + 1,
    text: text.trim(),
    ...(found !== undefined ? { sketch: found.sketch.id } : {}),
    ...(target !== undefined ? { target } : {}),
    setAt: at,
    status: "active",
  };
  return { goals: [...goals, goal], goal, same: false };
}

/**
 * Abandona una meta activa por número («2») o por lo que dice («la secta», «vengarme»): la de
 * texto que contiene lo pedido, o la del bosquejo que nombra. Sin coincidencia no cambia nada.
 */
export function dropGoal(
  goals: readonly PlayerGoal[],
  query: string,
  sketches: readonly GoalSketch[],
): { goals: PlayerGoal[]; dropped?: PlayerGoal } {
  const q = foldWords(query);
  const active = activePlayerGoals(goals);
  const byNumber = /^\d+$/.test(q) ? active.find((g) => g.id === Number(q)) : undefined;
  const sketch = sketchOf(q, sketches)?.sketch.id;
  const hit =
    byNumber ??
    active.find((g) => q.length > 0 && foldWords(g.text).includes(q)) ??
    (sketch !== undefined ? active.find((g) => g.sketch === sketch) : undefined);
  if (hit === undefined) return { goals: [...goals] };
  return {
    goals: goals.map((g) => (g.id === hit.id ? { ...g, status: "abandoned" } : g)),
    dropped: hit,
  };
}

/** Los bosquejos de las metas activas, en el orden en que se las propuso (para el narrador). */
export function goalSketches(goals: readonly PlayerGoal[]): string[] {
  return [
    ...new Set(activePlayerGoals(goals).flatMap((g) => (g.sketch !== undefined ? [g.sketch] : []))),
  ];
}

/**
 * Los avisos que ponen las metas activas en un salto delegado (novel-goals-watch): ver a la persona
 * de la meta y los sucesos de su bosquejo. Con `stopAll` («hasta que pase algo con mi meta») todo
 * corta en vez de anotar.
 */
export function goalWatch(
  goals: readonly PlayerGoal[],
  sketches: readonly GoalSketch[],
  stopAll = false,
): WatchRule[] {
  const out: WatchRule[] = [];
  for (const g of activePlayerGoals(goals)) {
    const w = sketches.find((s) => s.id === g.sketch)?.watch;
    if (w === undefined) continue;
    if (w.person !== undefined && g.target !== undefined)
      out.push({
        on: { kind: "goal", goal: g.id, who: g.target },
        action: stopAll ? "stop" : w.person,
      });
    if (w.events !== undefined)
      out.push({
        on: { kind: "goal", goal: g.id, events: w.events },
        action: stopAll ? "stop" : (w.action ?? "note"),
      });
  }
  return out;
}
