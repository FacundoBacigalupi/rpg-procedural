import { describe, expect, it } from "vitest";
import { parseCommand } from "./grammar.ts";

function planOf(input: string): unknown {
  return (parseCommand(input) as unknown as { plan?: unknown } | null)?.plan;
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

  it("«uso el hacha para cortar leña» lleva el para qué; «mi azada» es una cosa (use-tools-rewrite)", () => {
    expect(planOf("uso el hacha para cortar leña")).toMatchObject({
      verb: "use",
      args: [
        { role: "target", ref: { text: "el hacha", kind: "object" } },
        { role: "how", text: "cortar leña" },
      ],
    });
    const mine = planOf("uso mi azada") as { args: { ref?: object }[] };
    expect(mine.args[0]?.ref).toEqual({ text: "mi azada", kind: "object", features: ["azada"] });
  });

  it("«afilo la hoz con la piedra» es use sobre la hoz para afilar (use-tools-mend-sharpen)", () => {
    for (const text of ["afilo la hoz", "afilo la hoz con la piedra", "amolar la hoz"]) {
      expect(planOf(text), text).toMatchObject({
        verb: "use",
        args: [
          { role: "target", ref: { text: "la hoz", kind: "object" } },
          { role: "how", text: "afilar" },
        ],
      });
    }
  });

  it("«arreglo la hoz» y «llevo la hoz al herrero» son use para arreglar (use-tools-mend-smith)", () => {
    for (const text of [
      "arreglo la hoz",
      "hago arreglar la hoz",
      "reparo la hoz",
      "llevo la hoz al herrero",
      "llevo la hoz a la herrería",
    ]) {
      expect(planOf(text), text).toMatchObject({
        verb: "use",
        args: [
          { role: "target", ref: { text: "la hoz", kind: "object" } },
          { role: "how", text: "arreglar" },
        ],
      });
    }
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

  it("«me siento en el banco» y «me caliento junto al fogón» arman use con su función (fixtures-bench)", () => {
    expect(planOf("me siento en el banco")).toMatchObject({
      verb: "use",
      args: [
        { role: "target", ref: { text: "el banco", kind: "object" } },
        { role: "how", text: "sentarme" },
      ],
    });
    for (const text of ["me caliento junto al fogón", "me caliento", "me caliento al fuego"]) {
      expect(planOf(text), text).toMatchObject({
        verb: "use",
        args: [
          { role: "target", ref: { text: "el fogón", kind: "object" } },
          { role: "how", text: "calentarme" },
        ],
      });
    }
    // «Me siento cansado» no es sentarse en nada.
    expect((planOf("me siento cansado") as { verb?: string } | undefined)?.verb).not.toBe("use");
  });
});
