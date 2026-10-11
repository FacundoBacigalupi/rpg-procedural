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
  /** Hablas con acto declarado, por tipo de acto (`greet`, `ask`, `request`, `tell`, `promise`). */
  readonly acts: Readonly<Record<string, number>>;
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
  const spoken = w.log.all().filter((e) => e.kind === "action.speak" && e.tick > from);
  const speaks = spoken.length;
  const acts: Record<string, number> = {};
  for (const e of spoken) {
    const kind = (e.data as { effect?: { act?: { kind?: string } | null } } | null)?.effect?.act
      ?.kind;
    if (kind) acts[kind] = (acts[kind] ?? 0) + 1;
  }
  const npcs = Math.max(1, w.truth.ids(PERSON).length - 1);
  return {
    variant: variant.name,
    speaks,
    speaksPerNpcDay: Math.round((speaks / npcs / days) * 1e4) / 1e4,
    acts,
    events: w.log.all().length,
    problems:
      checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger }).length +
      w.ledger.audit().length,
  };
}

/** Variantes de calibración: apagado y combinaciones de silencio (días de mundo) y peso del ánimo. */
export function speakActsVariants(day: number): SpeakActsVariant[] {
  const on = (days: number, weight: number): SpeakActsOptions => ({
    minFamiliarity: 0.3,
    quietSeconds: days * day,
    weight,
    chance: 0.9,
  });
  const v = (days: number, weight: number): SpeakActsVariant => ({
    name: `q${days}d-w${weight}`,
    speakActs: on(days, weight),
  });
  return [
    { name: "off" },
    v(1, 0.1),
    v(1, 0.4),
    v(1, 1.5),
    v(0.1, 0.4),
    v(7, 0.4),
    v(0.5, 0.4),
    v(3, 0.4),
  ];
}
