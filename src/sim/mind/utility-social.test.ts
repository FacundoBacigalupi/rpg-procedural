import { describe, expect, it } from "vitest";
import { DIMENSIONS, type Vector } from "../relations/index.ts";
import { type Drives, rank } from "./utility.ts";
import {
  avengeCandidate,
  avoidCandidate,
  closeness,
  giveCandidate,
  helpCandidate,
  kinWeight,
  type SocialInput,
  socialCandidates,
} from "./utility-social.ts";

const dims = (over: Partial<Record<(typeof DIMENSIONS)[number], number>> = {}): Vector => {
  const v = {} as Record<(typeof DIMENSIONS)[number], number>;
  for (const d of DIMENSIONS) v[d] = 0;
  return { ...v, ...over };
};
const input = (over: Partial<SocialInput> = {}): SocialInput => ({
  target: "p:2",
  dims: dims(),
  bonds: [],
  belief: { need: 0, threat: 0.3, confidence: 0.8 },
  means: { surplus: 0.5 },
  ...over,
});
const drives: Drives = {
  needs: {},
  values: { family: 0.4, justice: 0.3, safety: 0.2, wealth: 0.1 },
};
const bold = { boldness: 0.5 };

describe("candidatas sociales", () => {
  it("el parentesco pesa más que la casa compartida", () => {
    expect(kinWeight(["child"])).toBeGreaterThan(kinWeight(["housemate"]));
    expect(kinWeight([])).toBe(0);
    expect(closeness(dims({ affection: 0.5 }), ["parent"])).toBeGreaterThan(
      closeness(dims({ affection: 0.5 }), []),
    );
  });

  it("no hay ayuda ni regalo sin necesidad creída", () => {
    expect(helpCandidate(input())).toBeUndefined();
    expect(giveCandidate(input())).toBeUndefined();
  });

  it("ayuda antes a un hijo en necesidad que a un extraño", () => {
    const belief = { need: 0.8, threat: 0.1, confidence: 0.9 };
    const child = input({
      target: "p:child",
      bonds: ["child"],
      belief,
      dims: dims({ affection: 0.8 }),
    });
    const stranger = input({ target: "p:x", belief });
    const [first] = rank([...socialCandidates(stranger), ...socialCandidates(child)], drives, bold);
    expect(first?.candidate.target).toBe("p:child");
  });

  it("dar cuesta riqueza cuando no sobra", () => {
    const belief = { need: 0.6, threat: 0, confidence: 1 };
    const poor = giveCandidate(input({ belief, means: { surplus: 0.05 } }));
    const rich = giveCandidate(input({ belief, means: { surplus: 0.9 } }));
    expect(poor?.contributes.wealth).toBeLessThan(rich?.contributes.wealth ?? 0);
  });

  it("evita a quien teme y no a quien quiere", () => {
    expect(avoidCandidate(input())).toBeUndefined();
    const feared = avoidCandidate(input({ dims: dims({ fear: 0.8 }) }));
    expect(feared?.contributes.safety).toBeGreaterThan(0.3);
    const [first] = rank(socialCandidates(input({ dims: dims({ fear: 0.9 }) })), drives, bold);
    expect(first?.candidate.id).toBe("avoid:p:2");
  });

  it("la venganza necesita rencor y la frenan el cariño y el peligro creído", () => {
    expect(avengeCandidate(input({ dims: dims({ resentment: 0.1 }) }))).toBeUndefined();
    const grudge = dims({ resentment: 0.9 });
    const weak = { need: 0, threat: 0.1, confidence: 0.9 };
    const strong = { need: 0, threat: 0.9, confidence: 0.9 };
    const a = rank(socialCandidates(input({ dims: grudge, belief: weak })), drives, bold);
    const b = rank(socialCandidates(input({ dims: grudge, belief: strong })), drives, bold);
    const uA = a.find((s) => s.candidate.verb === "strike")?.utility ?? 0;
    const uB = b.find((s) => s.candidate.verb === "strike")?.utility ?? 0;
    expect(uA).toBeGreaterThan(uB);
    const loved = rank(
      socialCandidates(
        input({
          dims: dims({ resentment: 0.9, affection: 0.9 }),
          bonds: ["sibling"],
          belief: weak,
        }),
      ),
      drives,
      bold,
    );
    const uL = loved.find((s) => s.candidate.verb === "strike")?.utility ?? 0;
    expect(uL).toBeLessThan(uA);
  });
});
