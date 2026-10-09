import { describe, expect, it } from "vitest";
import { DEFAULT_NARRATION, type Narration, styleOf } from "../../llm/index.ts";
import { narrationRejected, narratorRepro } from "./repro.ts";

const base: Narration = { text: "t", marked: "t", source: "templates", problems: [] };

describe("paquete de reproducción del narrador", () => {
  it("solo se arma si el modelo estaba y el validador lo rechazó", () => {
    expect(narrationRejected(base)).toBe(false);
    expect(narrationRejected({ ...base, problems: ["local:m: no disponible"] })).toBe(false);
    expect(narrationRejected({ ...base, problems: ["m: e1 has to be mentioned"] })).toBe(true);
    expect(narrationRejected({ ...base, source: "llm" })).toBe(false);
  });

  it("lleva versiones, planes, vista, prompt y salida, y sobrevive a JSON", () => {
    const view = {
      scene: "calle",
      self: { cues: [] },
      outcomes: [],
      thoughts: [],
      tastes: [],
      dues: [],
      offenses: [],
      readings: [],
      percepts: [],
      labels: [{ id: "e1", label: "una mujer", kind: "agent" }],
      lexicon: [],
    };
    const request = {
      view,
      mode: "scene",
      mustMention: ["e1"],
      mayMention: ["e1"],
      ambience: [],
      style: styleOf(DEFAULT_NARRATION, "es"),
    };
    const pkg = narratorRepro({
      versions: { engine: "life-1", content: "h", format: 1 },
      seed: 7,
      setup: { game: {} } as never,
      plans: [{ verb: "wait" }],
      tick: 99,
      request: request as never,
      narration: { ...base, problems: ["m: mal"] },
    });
    expect(pkg).toMatchObject({ kind: "narrator", seed: 7, tick: 99, problems: ["m: mal"] });
    expect(pkg.narrator?.view).toMatchObject({ scene: "calle" });
    expect(pkg.narrator?.user).toContain("mustMention");
    expect(JSON.parse(JSON.stringify(pkg))).toEqual(pkg);
  });
});
