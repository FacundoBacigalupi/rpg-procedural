import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  BODY_STATE,
  ENTITY,
  INFECTION,
  PATHOGEN,
  type PathogenDef,
  PERSON,
  type ProcessContext,
  WorldTruth,
} from "../../sim/index.ts";
import { optInParts } from "./create.ts";
import { exposureProcess } from "./exposure.ts";
import { engineOptions } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";
import { EXHAUSTION_MAX, exhaustionSusceptibility, STRAIN_AT } from "./strain.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };
const flu: PathogenDef = {
  id: "road-flu",
  routes: { air: 1, contact: 1 },
  incubationHours: 24,
  courseHours: 48,
  contagiousFrom: 0.5,
  transmissibility: 0.02,
  lethality: 0,
  immunity: "lifelong",
  immunityHours: 0,
};
const carrier = "agent:1" as AgentId;
const place = { kind: "cell", cell: "cell:1" } as never;
const people = Array.from({ length: 80 }, (_, i) => `agent:${100 + i}` as AgentId);

function ctx(truth: WorldTruth, now: number): ProcessContext {
  let n = 0;
  return {
    now,
    window: clock.day,
    truth,
    rng: Rng.root(1),
    newId: (k: string) => `${k}:~${n++}`,
  } as unknown as ProcessContext;
}

function camp(fatigue: number): WorldTruth {
  const t = new WorldTruth();
  for (const id of [carrier, ...people]) {
    t.set(
      ENTITY,
      id as EntityRef,
      { id, originEventId: "event:1" as EventId, createdAt: 0 } as never,
    );
    t.set(PERSON, id as EntityRef, { household: "household:1" } as never);
    t.set(
      BODY_STATE,
      id as EntityRef,
      { muscle: 0.5, fatigue: id === carrier ? 0 : fatigue } as never,
    );
  }
  t.set(PATHOGEN, "pathogen:1" as EntityRef, { def: flu, source: "escenario" });
  t.set(INFECTION, carrier as EntityRef, {
    infections: [
      { pathogen: "road-flu", exposedAt: 0, dose: 1, fatal: false, cause: "event:9" as EventId },
    ],
    immunities: [],
    ill: [],
  });
  return t;
}

function run(exhaustion: boolean, fatigue: number) {
  const p = exposureProcess({
    clock,
    placeOf: () => place,
    ...(exhaustion ? { exhaustion } : {}),
  });
  const out = p.run(ctx(camp(fatigue), clock.day * 2));
  const events = (out.events ?? []).filter((e) => e.kind === "body.infected");
  return { out, events };
}

describe("susceptibilidad por agotamiento (puro)", () => {
  it("1 hasta STRAIN_AT, sube lineal al tope y no pasa de EXHAUSTION_MAX", () => {
    expect(exhaustionSusceptibility(0)).toBe(1);
    expect(exhaustionSusceptibility(STRAIN_AT)).toBe(1);
    expect(exhaustionSusceptibility(0.8)).toBeCloseTo(1 + (EXHAUSTION_MAX - 1) / 2, 6);
    expect(exhaustionSusceptibility(1)).toBe(EXHAUSTION_MAX);
    expect(exhaustionSusceptibility(5)).toBe(EXHAUSTION_MAX);
  });
});

describe("contagio con el cuerpo agotado (npc-b2b3b2d5)", () => {
  it("cansado, el contagio prende más; sin la opción o descansado, igual que siempre", () => {
    const rested = run(true, 0.1);
    const tired = run(true, 1);
    const off = run(false, 1);
    expect(tired.events.length).toBeGreaterThan(rested.events.length);
    expect(off.out).toEqual(run(false, 0.1).out);
    expect(tired.events.every((e) => (e.data as { exhausted?: boolean }).exhausted === true)).toBe(
      true,
    );
    expect(rested.events.some((e) => "exhausted" in (e.data as object))).toBe(false);
  });

  it("es determinista y cada infección cita su causa", () => {
    const x = run(true, 1);
    expect(run(true, 1).out).toEqual(x.out);
    expect(x.events.every((e) => e.causes.length > 0)).toBe(true);
  });

  it("apagado por defecto; el perfil completo lo enciende desde life-25", () => {
    expect(optInParts({ npcExhaustion: true })).toEqual({ npcExhaustion: true });
    expect(optInParts({ npcExhaustion: true, legacyNoExhaustion: true })).toEqual({});
    expect(FULL_PROFILE.npcExhaustion).toBe(true);
    expect(engineOptions("life-24", FULL_PROFILE).legacyNoExhaustion).toBe(true);
    expect(engineOptions("life-25", FULL_PROFILE).legacyNoExhaustion).toBeUndefined();
  });
});
