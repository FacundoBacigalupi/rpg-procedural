import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, makeId } from "../../core/index.ts";
import { PERSON_CULTURE, type TraitDef, WorldTruth } from "../../sim/index.ts";
import { SEEN_WHILE_DOING, visibleMarks } from "./identity.ts";

const who = makeId("agent", 1) as AgentId;
const traits = [
  { id: "dress.cloth", domain: "dress", salience: 0.8 },
  { id: "food.staple", domain: "food", salience: 0.6 },
] as unknown as TraitDef[];

describe("lo que se come a la vista delata de dónde sos", () => {
  const truth = new WorldTruth();
  truth.set(PERSON_CULTURE, who, {
    holdings: {
      "dress.cloth": { variant: "wool", shown: "wool" },
      "food.staple": { variant: "porridge", shown: "porridge" },
    },
    identity: [],
    originEventId: makeId("event", 1) as EventId,
  } as never);

  it("al cruzarse solo se ve la ropa; comiendo, también la comida", () => {
    expect(Object.keys(visibleMarks(truth, who, traits))).toEqual(["dress.cloth"]);
    expect(Object.keys(visibleMarks(truth, who, traits, ["food"])).sort()).toEqual([
      "dress.cloth",
      "food.staple",
    ]);
  });

  it("comer, cocinar y beber cuentan como hacerlo a la vista", () => {
    expect(SEEN_WHILE_DOING.food).toEqual(expect.arrayContaining(["eat", "cook", "drink"]));
  });
});
