import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../core/index.ts";
import { ACTIONS, PLANS } from "../actions/index.ts";
import { TRAITS } from "../family/index.ts";
import { type Learner, learnFromHearing, levelOf, SKILLS } from "./index.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS],
  [
    { kind: "actions", file: "a.json", data: json("content/actions/core.json") },
    { kind: "skills", file: "s.json", data: json("content/skills/core.json") },
    { kind: "traits", file: "t.json", data: json("content/traits/human.json") },
  ],
);
const speech = content.all(SKILLS).find((s) => s.id === "speech");
if (!speech) throw new Error("falta la habilidad speech");
const adult: Learner = { z: {}, capabilities: {}, ageYears: 25 };
const heard = { speaker: "agent:9", clarity: 0.8, speakerLevel: 0.7, seconds: 3600, tick: 100 };

describe("aprender a hablar oyendo", () => {
  it("la habilidad de lengua tiene faceta de acento", () => {
    expect(speech.domain).toBe("language");
    expect(speech.facets).toContain("accent");
  });

  it("oír a quien habla mejor deposita en acento, saber y oído, no en la boca", () => {
    const out = learnFromHearing(speech, undefined, adult, heard, 86400);
    expect(levelOf(out ?? undefined, "accent")).toBeGreaterThan(0);
    expect(levelOf(out ?? undefined, "knowledge")).toBeGreaterThan(0);
    expect(levelOf(out ?? undefined, "execution")).toBe(0);
  });

  it("no se aprende de quien habla peor o apenas se oye", () => {
    expect(
      learnFromHearing(speech, undefined, adult, { ...heard, speakerLevel: 0 }, 86400),
    ).toBeNull();
    expect(
      learnFromHearing(speech, undefined, adult, { ...heard, clarity: 0.05 }, 86400),
    ).toBeNull();
  });
});
