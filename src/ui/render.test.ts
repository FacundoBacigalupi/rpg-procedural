import { describe, expect, it } from "vitest";
import type { AboutPanel, BookLine, CharacterPanel } from "../game/index.ts";
import { renderAbout, renderBook, renderCharacter } from "./render.ts";

const line = (over: Partial<BookLine>): BookLine => ({
  kind: "pledge",
  direction: "i-owe",
  other: "tu madre",
  what: { kind: "coins", coins: 4 },
  dueInDays: 10,
  sure: "sure",
  defaulted: false,
  ...over,
});

describe("renderBook", () => {
  it("un libro vacío lo dice", () => {
    expect(renderBook({ lines: [] })).toContain("No le debés nada a nadie");
  });

  it("separa lo que debés de lo que te deben y marca la inseguridad", () => {
    const text = renderBook({
      lines: [
        line({}),
        line({ kind: "debt", defaulted: true, dueInDays: -3, other: "Wu" }),
        line({
          direction: "owed-to-me",
          what: { kind: "good", good: "grano", amount: "some" },
          dueInDays: null,
          sure: "vague",
        }),
      ],
    });
    expect(text.indexOf("Lo que debés:")).toBeLessThan(text.indexOf("Lo que te deben:"));
    expect(text).toContain("tu madre: 4 monedas de cobre, en 10 días (palabra dada)");
    expect(text).toContain("Wu: 4 monedas de cobre, vencida hace 3 días (fiado; ya está en mora)");
    expect(text).toContain(
      "algo de grano, sin plazo que recuerdes (palabra dada) (lo recordás vagamente)",
    );
  });
});

describe("renderAbout con el porqué leído", () => {
  const panel = (over: Partial<AboutPanel> = {}): AboutPanel => ({
    kind: "person",
    name: "Wu",
    alive: "alive",
    aliveSurety: "sure",
    where: { state: "here" },
    book: [],
    ...over,
  });

  it("dice lo que le pareció, con su firmeza, sin afirmarlo", () => {
    const text = renderAbout(panel({ purpose: { motive: "theft", surety: "unsure" } }));
    expect(text).toContain("te parece que anda por quedarse con lo ajeno (no del todo seguro)");
  });

  it("sin lectura no inventa nada", () => {
    expect(renderAbout(panel())).not.toContain("te parece");
  });
});

describe("renderCharacter substances", () => {
  it("muestra señales sin nombrar la sustancia", () => {
    const base = {
      ageYears: 30,
      where: { home: true },
      body: { general: [], zones: [] },
      family: [],
      tastes: [],
      skills: [],
      substances: {
        self: [{ kind: "poison", stage: "symptoms" }, { kind: "withdrawing" }],
        others: [{ who: "Wu", signs: [{ kind: "sedated" }] }],
      },
    } as unknown as CharacterPanel;
    const text = renderCharacter(base);
    expect(text).toContain("envenenado");
    expect(text).toContain("Wu parece adormecido.");
  });
});
