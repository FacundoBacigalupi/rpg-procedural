import { describe, expect, it } from "vitest";
import type { AgentId, EventId } from "../../core/index.ts";
import { type Appraised, appraiseFight, appraiseGuilt, appraiseLoss } from "./appraise.ts";
import {
  appraisalEmotionSignals,
  appraiseEnvyEmotion,
  appraiseInsultEmotion,
  appraiseLoveEmotion,
  appraiseShameEmotion,
  EMOTION_HALF_LIFE_TICKS,
  emotionIntensityAt,
  reconcileEmotionSignals,
} from "./emotions.ts";
import type { Mind } from "./mind.ts";

const OWNER = "agent:1" as AgentId;
const FOE = "agent:2" as AgentId;
const ORIGIN = "event:3" as EventId;
const mind: Mind = { schemas: {}, formative: [], originEventId: ORIGIN };

describe("emociones propias desde appraisal", () => {
  it("ira exige insulto comprendido, ofensa sentida y autor atribuible; conserva objetivo y causa", () => {
    const insult = {
      offender: FOE,
      feltOffense: 0.7,
      delivered: true,
      understood: true,
      originEventId: ORIGIN,
      at: 1000,
    };
    const anger = appraiseInsultEmotion(OWNER, insult);
    expect(anger).toMatchObject({
      owner: OWNER,
      emotion: "anger",
      intensity: 0.7,
      target: FOE,
      originEventId: ORIGIN,
      at: 1000,
      appraisalTheme: "injustice",
    });
    expect(appraiseInsultEmotion(OWNER, { ...insult, delivered: false })).toBeUndefined();
    expect(appraiseInsultEmotion(OWNER, { ...insult, understood: false })).toBeUndefined();
    expect(appraiseInsultEmotion(OWNER, { ...insult, feltOffense: 0 })).toBeUndefined();
    expect(appraiseInsultEmotion(OWNER, { ...insult, offender: OWNER })).toBeUndefined();
    expect(
      appraiseInsultEmotion(OWNER, {
        feltOffense: 0.7,
        delivered: true,
        understood: true,
        originEventId: ORIGIN,
        at: 1000,
      }),
    ).toBeUndefined();
    if (!anger) throw new Error("insulto sentido sin ira");
    expect(emotionIntensityAt(anger, 4600, { halfLifeTicks: 3600, reactivity: 0.5 })).toBe(0.35);
  });

  it("persistencia deduplica sin renovar el momento y no backfillea señales sin evidencia", () => {
    const bare = appraisalEmotionSignals(OWNER, appraiseGuilt(0.8), ORIGIN, 1000);
    expect(reconcileEmotionSignals([], bare, 1000, 0.5)).toEqual([]);
    const known = bare.map((s) => ({ ...s, evidence: { kind: "own" as const, event: ORIGIN } }));
    const initial = reconcileEmotionSignals([], known, 1000, 0.5);
    const repeated = reconcileEmotionSignals(
      initial,
      known.map((s) => ({ ...s, at: 2000 })),
      2000,
      0.5,
    );
    expect(repeated).toEqual(initial);
    expect(repeated[0]).toBe(initial[0]);
    expect(reconcileEmotionSignals(initial, [], 1000 + 100 * 86400, 0.5)).toEqual([]);
  });

  it("el mismo golpe produce miedo distinto, con dueño y procedencia del hecho interpretado", () => {
    const facts = { role: "victim", foe: FOE, worst: 0.8, standing: true, kin: false } as const;
    const afraid = appraisalEmotionSignals(
      OWNER,
      appraiseFight(facts, mind, { boldness: 0 }),
      ORIGIN,
      1000,
    );
    const brave = appraisalEmotionSignals(
      OWNER,
      appraiseFight(facts, mind, { boldness: 1 }),
      ORIGIN,
      1000,
    );
    expect(afraid[0]).toMatchObject({
      owner: OWNER,
      emotion: "fear",
      originEventId: ORIGIN,
      at: 1000,
      appraisalTheme: "violence",
    });
    expect(brave[0]?.intensity).toBeLessThan(afraid[0]?.intensity ?? 0);
    expect(
      appraisalEmotionSignals(OWNER, appraiseFight({ ...facts, worst: 0 }, mind, {}), ORIGIN, 1000),
    ).toEqual([]);
  });

  it("la pérdida sentida da tristeza y el consuelo ya interpretado la atenúa; culpa conserva su intensidad", () => {
    const bare = appraisalEmotionSignals(OWNER, appraiseLoss(0.8), ORIGIN, 1000);
    const comforted = appraisalEmotionSignals(OWNER, appraiseLoss(0.8, 1), ORIGIN, 1000);
    expect(bare[0]?.emotion).toBe("sadness");
    expect(comforted[0]?.intensity).toBeLessThan(bare[0]?.intensity ?? 0);
    expect(appraisalEmotionSignals(OWNER, appraiseGuilt(0.8), ORIGIN, 1000)[0]).toMatchObject({
      emotion: "guilt",
      intensity: 0.8,
      appraisalTheme: "guilt",
    });
    expect(appraisalEmotionSignals(OWNER, appraiseLoss(0), ORIGIN, 1000)).toEqual([]);
    expect(appraisalEmotionSignals(OWNER, appraiseGuilt(0), ORIGIN, 1000)).toEqual([]);
  });

  it("sin evidencia interpretada no inventa emociones; otros temas no se equiparan a emoción", () => {
    expect(appraisalEmotionSignals(OWNER, [], ORIGIN, 1000)).toEqual([]);
    const unsupported: Appraised[] = ["betrayal", "failure", "neglect", "care"].map((theme) => ({
      stimulus: { theme: theme as Appraised["stimulus"]["theme"], intensity: 1 },
      blame: FOE,
    }));
    expect(appraisalEmotionSignals(OWNER, unsupported, ORIGIN, 1000)).toEqual([]);
  });

  it("repetir appraisal no duplica intensidad y el orden de entrada no cambia las señales", () => {
    const appraisal: Appraised[] = [
      { stimulus: { theme: "violence", intensity: 0.3 }, blame: FOE },
      { stimulus: { theme: "violence", intensity: 0.8 }, blame: FOE },
      ...appraiseGuilt(0.7),
      ...appraiseLoss(0.6),
    ];
    const signals = appraisalEmotionSignals(OWNER, appraisal, ORIGIN, 1000);
    expect(signals.map((s) => s.emotion)).toEqual(["fear", "guilt", "sadness"]);
    expect(signals[0]?.intensity).toBe(0.8);
    expect(signals).toEqual(appraisalEmotionSignals(OWNER, [...appraisal].reverse(), ORIGIN, 1000));
  });

  it("decae según reactividad sin alterar fuente; antes de vivirlo no hay emoción y sin calibración válida falla", () => {
    const signal = appraisalEmotionSignals(OWNER, appraiseGuilt(0.8), ORIGIN, 1000)[0];
    if (!signal) throw new Error("appraisal de culpa sin señal");
    const decay = { halfLifeTicks: 3600, reactivity: 0.5 };
    expect(emotionIntensityAt(signal, 999, decay)).toBe(0);
    expect(emotionIntensityAt(signal, 1000, decay)).toBe(0.8);
    expect(emotionIntensityAt(signal, 4600, decay)).toBe(0.4);
    expect(emotionIntensityAt(signal, 4600, { ...decay, reactivity: 1 })).toBeGreaterThan(0.4);
    expect(emotionIntensityAt(signal, 4600, { ...decay, reactivity: 0 })).toBeLessThan(0.4);
    expect(emotionIntensityAt(signal, 1000 + 100 * 3600, decay)).toBe(0);
    expect(signal).toMatchObject({ originEventId: ORIGIN, at: 1000, intensity: 0.8 });
    expect(() => emotionIntensityAt(signal, 1000, { ...decay, halfLifeTicks: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("alegría, vergüenza, envidia y amor", () => {
  const base = { originEventId: ORIGIN, at: 1000 };
  it("alegría nace de éxito, amabilidad o bendición propios y no de temas dolorosos", () => {
    const joy = appraisalEmotionSignals(
      OWNER,
      [{ stimulus: { theme: "success", intensity: 0.4 }, blame: null }],
      ORIGIN,
      1000,
    );
    expect(joy).toMatchObject([{ emotion: "joy", intensity: 0.4, appraisalTheme: "success" }]);
    expect(
      appraisalEmotionSignals(
        OWNER,
        [{ stimulus: { theme: "failure", intensity: 0.4 }, blame: null }],
        ORIGIN,
        1000,
      ),
    ).toEqual([]);
  });

  it("vergüenza exige reconocer la falta y crece con testigos creídos", () => {
    const input = { faceLoss: 0.8, acknowledged: true, witnesses: 0, ...base };
    expect(appraiseShameEmotion(OWNER, input)?.intensity).toBe(0.4);
    expect(appraiseShameEmotion(OWNER, { ...input, witnesses: 9 })?.intensity).toBe(0.8);
    expect(appraiseShameEmotion(OWNER, { ...input, acknowledged: false })).toBeUndefined();
    expect(appraiseShameEmotion(OWNER, { ...input, faceLoss: 0 })).toBeUndefined();
    expect(appraiseShameEmotion(OWNER, input)?.target).toBeUndefined();
  });

  it("envidia necesita rival ajeno, lectura confiable, carencia creída y valor", () => {
    const input = { rival: FOE, perceivedGain: 0.8, confidence: 0.5, gap: 1, valued: 0.5, ...base };
    expect(appraiseEnvyEmotion(OWNER, input)).toMatchObject({
      emotion: "envy",
      intensity: 0.2,
      target: FOE,
    });
    for (const bad of [
      { rival: undefined },
      { rival: OWNER },
      { gap: 0 },
      { valued: 0 },
      { confidence: 0 },
      { perceivedGain: Number.NaN },
    ])
      expect(appraiseEnvyEmotion(OWNER, { ...input, ...bad })).toBeUndefined();
  });

  it("amor requiere cariño previo hacia alguien identificado; la calidez lo reaviva", () => {
    const input = { beloved: FOE, affection: 0.5, warmth: 1, confidence: 1, ...base };
    expect(appraiseLoveEmotion(OWNER, input)).toMatchObject({
      emotion: "love",
      intensity: 0.5,
      target: FOE,
    });
    expect(appraiseLoveEmotion(OWNER, { ...input, warmth: 0 })?.intensity).toBe(0.3);
    expect(appraiseLoveEmotion(OWNER, { ...input, affection: 0 })).toBeUndefined();
    expect(appraiseLoveEmotion(OWNER, { ...input, beloved: undefined })).toBeUndefined();
    expect(appraiseLoveEmotion(OWNER, { ...input, beloved: OWNER })).toBeUndefined();
  });

  it("cada emoción nueva persiste con evidencia y decae con su vida media", () => {
    const signal = appraiseLoveEmotion(OWNER, {
      beloved: FOE,
      affection: 1,
      warmth: 1,
      confidence: 1,
      ...base,
    });
    if (!signal) throw new Error("sin amor");
    const own = { ...signal, evidence: { kind: "own" as const, event: ORIGIN } };
    expect(reconcileEmotionSignals([], [own], 1000, 0.5)).toHaveLength(1);
    expect(reconcileEmotionSignals([], [signal], 1000, 0.5)).toEqual([]);
    for (const e of ["joy", "shame", "envy", "love"] as const)
      expect(EMOTION_HALF_LIFE_TICKS[e]).toBeGreaterThan(0);
  });
});
