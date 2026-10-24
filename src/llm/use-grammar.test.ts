import { describe, expect, it } from "vitest";
import { parseCommand } from "./grammar.ts";

function planOf(input: string): unknown {
  return (parseCommand(input) as unknown as { plan?: unknown }).plan;
}

describe("la gramática de use y del target de look (use-core)", () => {
  it("«uso el pozo» y «saco agua del pozo» arman use sobre el pozo", () => {
    expect(planOf("uso el pozo")).toMatchObject({
      verb: "use",
      args: [{ role: "target", ref: { text: "el pozo", kind: "object" } }],
    });
    expect(planOf("saco agua del pozo")).toMatchObject({
      verb: "use",
      args: expect.arrayContaining([
        { role: "target", ref: expect.objectContaining({ kind: "object" }) },
        { role: "how", text: "sacar agua" },
      ]),
    });
  });

  it("«miro alrededor» sigue sin target y «miro a Wu» busca una persona", () => {
    for (const text of ["miro", "miro alrededor", "miro por ahí"]) {
      expect(planOf(text), text).toMatchObject({ verb: "look", args: [] });
    }
    expect(planOf("miro a Wu")).toMatchObject({
      verb: "look",
      args: [{ role: "target", ref: { kind: "person" } }],
    });
  });
});
