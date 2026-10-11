// Medición de `speakActs` (npc-c5c): corre la misma vida sin y con candidatas `speak` de acto
// declarado, para distintos `quietSeconds`, y mide cuánto hablan los NPC por día (que no inunde el
// registro) y que el mundo siga coherente. Sirve para calibrar los umbrales con evidencia.

import type { Content, Seed } from "../../core/index.ts";
import { Life, type SpeakActsOptions } from "../../game/index.ts";
import { checkInvariants, PERSON } from "../../sim/index.ts";

export interface SpeakActsVariant {
  readonly name: string;
  readonly speakActs?: SpeakActsOptions;
}

export interface SpeakActsRun {
  readonly variant: string;
  readonly speaks: number;
  readonly speaksPerNpcDay: number;
  readonly events: number;
  readonly problems: number;
}

export function measureSpeakActs(
  seed: Seed,
  content: Content,
  days: number,
  variant: SpeakActsVariant,
  frequency?: number,
): SpeakActsRun {
  const life = Life.create(seed, content, {
    npcVerbs: ["speak"],
    ...(frequency === undefined ? {} : { frequency }),
    ...(variant.speakActs ? { speakActs: variant.speakActs } : {}),
  });
  const w = life.world;
  const from = life.now;
  life.advanceTo(from + Math.round(days * w.clock.day));
  const speaks = w.log.all().filter((e) => e.kind === "action.speak" && e.tick > from).length;
  const npcs = Math.max(1, w.truth.ids(PERSON).length - 1);
  return {
    variant: variant.name,
    speaks,
    speaksPerNpcDay: Math.round((speaks / npcs / days) * 1e4) / 1e4,
    events: w.log.all().length,
    problems:
      checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger }).length +
      w.ledger.audit().length,
  };
}

/** Variantes de calibración: apagado y tres umbrales de silencio (en días de mundo). */
export function speakActsVariants(day: number): SpeakActsVariant[] {
  const on = (days: number): SpeakActsOptions => ({
    minFamiliarity: 0.3,
    quietSeconds: days * day,
    weight: 0.4,
    chance: 0.9,
  });
  return [
    { name: "off" },
    { name: "quiet0.5d", speakActs: on(0.5) },
    { name: "quiet1d", speakActs: on(1) },
    { name: "quiet3d", speakActs: on(3) },
  ];
}
