import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, type EntityRef, loadContent, makeId } from "../../core/index.ts";
import { TRAITS } from "../family/index.ts";
import { SKILLS } from "../skills/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  type IntentDraft,
  type KnownEntity,
  type KnownSpace,
  PLANS,
  planFromDraft,
} from "./index.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS],
  [
    { kind: "actions", file: "content/actions/core.json", data: json("content/actions/core.json") },
    { kind: "skills", file: "content/skills/core.json", data: json("content/skills/core.json") },
    { kind: "traits", file: "content/traits/human.json", data: json("content/traits/human.json") },
    { kind: "plans", file: "content/plans/steal.json", data: json("content/plans/steal.json") },
  ],
);
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));

const me = makeId("agent", 1);
const lan = makeId("agent", 2);
const village = makeId("place", 1);
const well = makeId("place", 2);

const person = (ref: EntityRef, names: string[]): KnownEntity => ({
  ref,
  kind: "person",
  names,
  features: [],
  relations: [],
  present: false,
  via: [],
});

const known: KnownEntity[] = [
  person(lan, ["Lan"]),
  { ...person(village, ["la aldea"]), kind: "place" },
  { ...person(well, ["el pozo"]), kind: "place" },
];
// Como los arma `knownSpaces`: la plaza (con el pozo y «por ahí»), la casa propia y la de Lan.
const spaces: KnownSpace[] = [
  {
    key: "square",
    place: village,
    names: ["la plaza", "la calle", "la aldea", "el pueblo", "el centro", "el pozo", "por ahí"],
    owners: [],
  },
  { key: "house:h1", place: village, names: ["casa", "mi casa"], owners: [] },
  { key: "house:h2", place: village, names: [], owners: [lan] },
];
const ctx = {
  actor: me,
  source: "player" as const,
  catalog,
  known,
  clock: EARTHLIKE_CLOCK,
  causes: [],
  spaces,
};

function spaceOf(text: string): string | undefined {
  const draft: IntentDraft = {
    kind: "act",
    plan: { kind: "do", verb: "move", args: [{ role: "to", ref: { text, features: [] } }] },
  };
  const r = planFromDraft(draft, ctx);
  if (r.kind !== "plan" || r.plan.root.kind !== "do") return undefined;
  const arg = r.plan.root.args.find((a) => a.role === "space");
  return arg !== undefined && "text" in arg ? arg.text : undefined;
}

describe("ir a un espacio del sitio por lo que se dice de él", () => {
  it("el pozo y «por ahí» son la plaza", () => {
    expect(spaceOf("el pozo")).toBe("square");
    expect(spaceOf("por ahí")).toBe("square");
  });

  it("varias palabras de la misma plaza siguen siendo la plaza", () => {
    expect(spaceOf("la plaza de la aldea")).toBe("square");
    expect(spaceOf("la plaza del pueblo")).toBe("square");
  });

  it("una palabra que no es del espacio no lo elige", () => {
    expect(spaceOf("la plaza del templo")).toBeUndefined();
    expect(spaceOf("el templo")).toBeUndefined();
  });

  it("la casa de alguien por su nombre", () => {
    expect(spaceOf("la casa de Lan")).toBe("house:h2");
    expect(spaceOf("mi casa")).toBe("house:h1");
  });
});
