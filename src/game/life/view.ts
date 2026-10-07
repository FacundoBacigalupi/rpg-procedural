// La vista del jugador desde la vida real (narration §2, player-loop §9): `buildPlayerView` con
// lo que el personaje percibe ahora (la gente que está en su espacio, por perception), cómo se
// siente (los signos del cuerpo) y lo que cree que le pasó en los pasos del turno. Es el único
// lugar donde la verdad del mundo se convierte en entrada del narrador.

import type { AgentId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  ATTENTION,
  BODY_STATE,
  bodySigns,
  daylight,
  houseKey,
  LOCATION,
  localHour,
  type Observer,
  PERSON,
  type Percept,
  PLACE,
  perceive,
  presenceStimulus,
  sensorAcuity,
  spaceLight,
  watching,
} from "../../sim/index.ts";
import {
  type Acquaintance,
  buildPlayerView,
  type PlayerView,
  type SelfCue,
} from "../view/index.ts";
import type { StepRecord } from "./act.ts";
import { type LifeWorld, living } from "./world.ts";

const CUES: Readonly<Record<string, SelfCue>> = {
  hungry: "hungry",
  starving: "hungry",
  thirsty: "thirsty",
  parched: "thirsty",
  tired: "tired",
  exhausted: "tired",
  sleepy: "tired",
  in_pain: "hurt",
  limping: "hurt",
  bone_broken: "hurt",
  bleeding: "bleeding",
  bleeding_heavily: "bleeding",
  feverish: "sick",
  wound_hot: "sick",
};

/** Cómo llama el personaje a su gente: la relación que sabe que tiene (sin nombres todavía). */
export function acquaintances(w: LifeWorld): Map<AgentId, Acquaintance> {
  const me = w.truth.get(PERSON, w.player);
  const out = new Map<AgentId, Acquaintance>();
  if (!me) return out;
  const sexed = (id: AgentId | null, female: string, male: string) => {
    const p = id ? w.truth.get(PERSON, id) : undefined;
    return p?.sex === "female" ? female : male;
  };
  if (me.mother) out.set(me.mother, { relation: "madre" });
  if (me.father) out.set(me.father, { relation: "padre" });
  if (me.spouse) out.set(me.spouse, { relation: sexed(me.spouse, "esposa", "esposo") });
  for (const id of w.truth.ids(PERSON) as AgentId[]) {
    if (id === w.player || out.has(id)) continue;
    const p = w.truth.get(PERSON, id);
    if (!p) continue;
    if (p.household === me.household) out.set(id, { relation: sexed(id, "hermana", "hermano") });
  }
  return out;
}

/** El personaje como observador (perception §2): su lugar, sus sentidos por edad, su gente. */
export function playerObserver(w: LifeWorld, attention: number = ATTENTION.relaxed): Observer {
  const me = w.truth.get(PERSON, w.player);
  const at = w.truth.get(LOCATION, w.player);
  if (!me || !at) throw new Error("el personaje no tiene persona o lugar");
  const age = (w.scheduler.now - me.born) / w.clock.year;
  return {
    id: w.player,
    at,
    acuity: sensorAcuity(age),
    attention,
    familiar: new Map([...acquaintances(w).keys()].map((id) => [id, 0.9])),
  };
}

/** Mirando a propósito se ve más (perception §4); si no, está relajado. */
function attentionOf(steps: readonly StepRecord[]): number {
  const looked = steps.findLast((s) => s.verb === "look");
  const effect = looked?.self.effect;
  return effect?.kind === "observe" ? watching(effect.acuity) : ATTENTION.relaxed;
}

/** Cuántos percepts claros llegan al narrador por turno (narration §5; calibración abierta). */
export const MAX_CLEAR_PERCEPTS = 5;

const DETAIL_RANK = { identified: 0, clear: 1, vague: 2 } as const;

/**
 * Lo que merece una línea: lo reconocido y lo visto con claridad primero, hasta un tope, y a lo
 * sumo una sombra suelta. Una multitud de lejos es una sola impresión (npc-psychology, multitudes
 * por umbrales), no cien frases.
 */
function digest(percepts: readonly Percept[]): Percept[] {
  const sorted = [...percepts].sort((a, b) => DETAIL_RANK[a.detail] - DETAIL_RANK[b.detail]);
  const clear = sorted.filter((p) => p.detail !== "vague").slice(0, MAX_CLEAR_PERCEPTS);
  const vague = clear.length === 0 ? sorted.slice(0, 1) : [];
  return [...clear, ...vague];
}

export interface PlayerViewOptions {
  /** Es la primera escena de la sesión: se describe el lugar aunque lo conozca (narration §7). */
  readonly intro?: boolean;
}

export function playerView(
  w: LifeWorld,
  steps: readonly StepRecord[],
  options: PlayerViewOptions = {},
): PlayerView {
  const now = w.scheduler.now;
  const me = w.truth.get(PERSON, w.player);
  const at = w.truth.get(LOCATION, w.player);
  const body = w.truth.get(BODY_STATE, w.player);
  if (!me || !at || !body) throw new Error("el personaje no tiene persona, lugar o cuerpo");
  const hour = localHour(w.clock, now, w.map.lonDeg);
  const day = daylight(hour);
  const node = at.space === undefined ? undefined : w.spaces.spaces.find((s) => s.key === at.space);

  const acq = acquaintances(w);
  const observer = playerObserver(w, attentionOf(steps));
  const rng = Rng.root(w.seed).fork("view", now);
  const percepts: Percept[] = [];
  for (const id of living(w.truth)) {
    if (id === w.player) continue;
    const p = w.truth.get(PERSON, id);
    const l = w.truth.get(LOCATION, id);
    if (!p || !l) continue;
    percepts.push(
      ...perceive(
        presenceStimulus({
          id,
          at: l,
          look: { sex: p.sex, ageYears: (now - p.born) / w.clock.year },
          tick: now,
        }),
        [observer],
        { graph: w.spaces, forest: w.map.forest, daylight: day },
        rng,
      ),
    );
  }

  const plan = w.plans.find((p) => p.id === body.plan);
  const signs = plan ? bodySigns(plan, body) : { general: [], zones: [] };
  const cues = new Set<SelfCue>();
  for (const s of [...signs.general, ...signs.zones.flatMap((z) => z.signs)]) {
    const c = CUES[s];
    if (c) cues.add(c);
  }

  const places = w.truth.ids(PLACE).flatMap((id) => {
    const p = w.truth.get(PLACE, id);
    return p ? [p] : [];
  });
  return buildPlayerView({
    player: w.player,
    scene: {
      placeKinds: places.filter((p) => p.hexes.includes(at.hex)).map((p) => p.kind),
      space: node?.kind ?? "open",
      indoor: node?.indoor ?? false,
      home: at.space === houseKey(me.household),
      familiar: !options.intro,
      hour,
      light: node ? spaceLight(node, day) : day,
    },
    percepts: digest(percepts),
    steps: steps.map((s) => ({ verb: s.verb, self: s.self })),
    acquaintances: acq,
    self: [...cues],
  });
}
