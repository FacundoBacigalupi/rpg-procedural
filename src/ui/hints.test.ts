import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentKind, z } from "../core/index.ts";
import { type Suggestion, VERB_WORDS } from "../game/index.ts";
import { parseCommand, VerbWordBook } from "../llm/index.ts";
import { ACTIONS, ActionCatalog, type KnownEntity, PLANS } from "../sim/index.ts";
import { COMMANDS, HINT_PHRASES, hintOf, suggestionPhrase } from "./hints.ts";
import { completionsOf } from "./web/complete.ts";

function load<T extends { readonly id: string }>(kind: ContentKind<T>): T[] {
  const dir = join("content", kind.name);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => z.array(kind.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

const words = new VerbWordBook(load(VERB_WORDS));
const catalog = new ActionCatalog(load(ACTIONS), load(PLANS));

const KINDS: Suggestion["kind"][] = [
  "drink",
  "eat",
  "tend",
  "sleep",
  "rest",
  "work",
  "talk",
  "look",
  "wait",
];
const VERB: Record<Suggestion["kind"], string> = {
  drink: "drink",
  eat: "eat",
  tend: "tend",
  sleep: "rest",
  rest: "rest",
  work: "work",
  talk: "speak",
  look: "look",
  wait: "wait",
};

function suggestion(kind: Suggestion["kind"], extra: Partial<Suggestion> = {}): Suggestion {
  return {
    id: kind,
    kind,
    salience: 0.5,
    draft: { kind: "act" },
    tone: "routine",
    confirm: false,
    ...extra,
  } as Suggestion;
}

function known(kind: KnownEntity["kind"], name: string, present = false): KnownEntity {
  return {
    ref: `${kind}:${name}`,
    kind,
    names: [name],
    features: [],
    relations: [],
    present,
    via: [],
  } as unknown as KnownEntity;
}

/** El verbo del primer paso de lo que la gramática lee. */
function verbOf(text: string): string | undefined {
  const d = parseCommand(text, catalog, words);
  if (d?.speech && !d.plan) return "speak";
  let n = d?.plan;
  while (n && n.kind !== "do")
    n = n.kind === "seq" ? n.steps[0] : n.kind === "until" ? n.body : undefined;
  return n?.verb;
}

describe("la pista de frases (play-hint-verbs)", () => {
  it("cada frase sugerida se entiende como el verbo de su sugerencia", () => {
    for (const k of KINDS) {
      const phrase = suggestionPhrase(suggestion(k, k === "talk" ? { with: "madre" } : {}));
      expect(verbOf(phrase), phrase).toBe(VERB[k]);
    }
  });

  it("arma la línea con lo que tiene delante y conoce, sin pasarse de frases", () => {
    const hint = hintOf(
      [suggestion("talk", { with: "madre" }), suggestion("eat"), suggestion("look")],
      [known("place", "el granero"), known("person", "Wu", true)],
      words,
    );
    expect(hint.line).toBe("Podés escribir: hablo con mi madre · como algo · voy al granero");
    expect(hint.line.split(" · ")).toHaveLength(HINT_PHRASES);
    expect(hint.complete).toContain("contemplo");
    expect(hint.complete).toContain("Wu");
    for (const c of COMMANDS) expect(hint.complete).toContain(c);
    expect(hintOf([], [], undefined).line).toBe("");
  });

  it("completa la palabra a medio escribir, sin tildes, y con «!» solo comandos", () => {
    const { complete } = hintOf([], [known("person", "Wu", true)], words);
    expect(completionsOf("contem", complete)).toContain("contemplo");
    expect(completionsOf("hablo con w", complete)).toContain("hablo con Wu");
    expect(completionsOf("me dir", complete)[0]).toBe("me dirijo");
    expect(completionsOf("!ver", complete)).toEqual(["!verbos"]);
    expect(completionsOf("!bitac", complete)).toEqual(["!bitácora"]);
    expect(completionsOf("ver", complete).some((c) => c.startsWith("!"))).toBe(false);
    expect(completionsOf("", complete)).toEqual([]);
    expect(completionsOf("x", complete, 3).length).toBeLessThanOrEqual(3);
  });

  it("si no se entiende, propone el verbo más parecido de la tabla", () => {
    expect(words.closest("mieo alrededor")).toBe("miro");
    expect(words.closest("descnaso un rato")).toBe("descanso");
    expect(words.closest("miro alrededor")).toBeUndefined();
    expect(words.closest("zzzzzz")).toBeUndefined();
  });
});
