import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentKind, z } from "../core/index.ts";
import { VERB_WORDS } from "../game/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  type DraftPlanNode,
  type IntentDraft,
  intentDraftFor,
  PLANS,
} from "../sim/index.ts";
import { parseCommand } from "./grammar.ts";
import { parserSetup } from "./parser.ts";
import { VerbWordBook, verbWordProblems } from "./verb-words.ts";

function load<T extends { readonly id: string }>(kind: ContentKind<T>): T[] {
  const dir = join("content", kind.name);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => z.array(kind.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

const entries = load(VERB_WORDS);
const words = new VerbWordBook(entries);
const catalog = new ActionCatalog(load(ACTIONS), load(PLANS));
const schema = intentDraftFor(catalog);

/** El verbo del primer paso (o el de hablar, o el robo como plantilla). */
function verbOf(d: IntentDraft | null): string | undefined {
  if (d === null) return undefined;
  if (d.kind !== "act" && d.kind !== "plan") return undefined;
  if (d.speech && !d.plan) return "speak";
  let n: DraftPlanNode | undefined = d.plan;
  while (n && n.kind !== "do") {
    if (n.kind === "template") return n.template === "steal" ? "take" : n.template;
    n = n.kind === "seq" ? n.steps[0] : n.kind === "until" ? n.body : undefined;
  }
  return n?.verb;
}

describe("los sinónimos de los verbos (play-verb-words)", () => {
  it("cada sinónimo, con su cola, se entiende como su verbo", () => {
    const wrong: string[] = [];
    for (const e of entries) {
      for (const g of e.synonyms) {
        const tail = g.tail ?? e.tail ?? "";
        for (const w of g.words) {
          const text = `${w} ${tail}`.trim();
          const got = verbOf(parseCommand(text, catalog, words));
          if (got !== e.id) wrong.push(`«${text}» → ${got ?? "nada"} (esperaba ${e.id})`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("cada ejemplo de la ayuda se entiende como su verbo, también sin la tabla", () => {
    for (const e of entries) {
      expect(verbOf(parseCommand(e.example, catalog, words)), e.example).toBe(e.id);
      expect(verbOf(parseCommand(e.example, catalog)), e.example).toBe(e.id);
    }
  });

  it("todos los verbos del catálogo tienen sus palabras", () => {
    const ids = entries.map((e) => e.id);
    expect(catalog.verbs.map((v) => v.id).filter((v) => !ids.includes(v))).toEqual([]);
    expect(ids.filter((id) => catalog.verb(id) === undefined)).toEqual([]);
  });

  it("un sinónimo da el mismo borrador que la forma: «me dirijo al río» es «voy al río»", () => {
    expect(parseCommand("me dirijo al río", catalog, words)).toEqual(
      parseCommand("voy al río", catalog, words),
    );
    expect(parseCommand("le obsequio el grano a mi tío", catalog, words)).toEqual(
      parseCommand("le doy el grano a mi tío", catalog, words),
    );
    expect(parseCommand("lo embisto", catalog, words)).toEqual(
      parseCommand("lo ataco", catalog, words),
    );
    // Sin tildes también: «reuno hierbas».
    expect(parseCommand("reuno hierbas", catalog, words)).toEqual(
      parseCommand("junto hierbas", catalog, words),
    );
    // En una secuencia y después de «voy a»: cada paso se lee por su lado.
    expect(parseCommand("me dirijo al río y voy a contemplar", catalog, words)).toEqual(
      parseCommand("voy al río y miro", catalog, words),
    );
  });

  it("lo más largo manda: «me voy de caza» es cazar y «me quedo con la jarra» es agarrar", () => {
    expect(verbOf(parseCommand("me voy de caza", catalog, words))).toBe("hunt");
    expect(verbOf(parseCommand("me quedo con la jarra", catalog, words))).toBe("take");
    expect(verbOf(parseCommand("me quedo una hora", catalog, words))).toBe("wait");
    // «Me siento a comer» sigue siendo comer: «me siento a» va antes que el sinónimo.
    expect(verbOf(parseCommand("me siento a comer", catalog, words))).toBe("eat");
  });

  it("los verbos nuevos de la gramática dan borradores válidos", () => {
    for (const text of [
      "cazo conejos",
      "perdono al bandido",
      "consumo la píldora",
      "hiervo agua",
      "filtro el agua",
      "falsifico una escritura",
      "contrato a Wu para arar",
    ]) {
      const d = parseCommand(text, catalog, words);
      expect(schema.safeParse(d).success, text).toBe(true);
    }
    expect(parseCommand("contrato a Wu para arar", catalog, words)).toMatchObject({
      plan: {
        verb: "hire",
        args: [
          { role: "who", ref: { text: "Wu" } },
          { role: "what", text: "arar" },
        ],
      },
    });
  });

  it("la tabla va al prompt del parser como pista, y sin tabla el prompt no cambia", () => {
    const withWords = parserSetup(catalog, [], words);
    expect(withWords.system).toContain("Spanish words the player may use");
    expect(withWords.system).toContain("contemplo");
    expect(parserSetup(catalog, []).system).not.toContain("Spanish words");
  });

  it("guardia: la tabla del contenido no tiene huecos ni conflictos (play-verb-words-guard)", () => {
    expect(
      verbWordProblems(
        entries,
        catalog.verbs.map((v) => v.id),
      ),
    ).toEqual([]);
  });

  it("guardia: un verbo sin sinónimos y un choque fallan nombrando el par", () => {
    const [a, b] = entries;
    if (!a || !b) throw new Error("tabla vacía");
    const verbs = [a.id, b.id, "nuevo"];
    const bForm = b.forms[0] as string;
    const problems = verbWordProblems(
      [
        { ...a, synonyms: [{ as: a.forms[0] as string, words: ["choco", bForm, "x"] }] },
        { ...b, synonyms: [{ as: bForm, words: ["choco", "y"] }] },
      ],
      verbs,
    );
    expect(problems).toContain("el verbo nuevo no tiene palabras en verb-words");
    const [first, second] = [a.id, b.id].sort();
    expect(problems).toContain(`«choco» es sinónimo de ${first} y sinónimo de ${second}`);
    expect(problems.some((p) => p.includes(`sinónimo de ${a.id} y forma de ${b.id}`))).toBe(true);
    // Con `shared` el choque es a propósito: no falla y la gramática lee el que lo declara.
    const shared = [
      { ...a, synonyms: [{ as: a.forms[0] as string, words: ["choco", "x1", "x2", "x3"] }] },
      { ...b, synonyms: [{ as: bForm, words: ["choco", "y1", "y2", "y3"] }], shared: ["choco"] },
    ];
    expect(verbWordProblems(shared, [a.id, b.id])).toEqual([]);
    expect(new VerbWordBook(shared).rewrite("choco algo")).toBe(`${bForm} algo`);
  });

  it("«!verbos» sale de la tabla: un renglón por verbo y todas las palabras de uno (play-help-verbs)", () => {
    const name = (id: string) => catalog.verb(id)?.name;
    const all = words.help(name);
    for (const e of entries) expect(all).toContain(`${name(e.id)}: «${e.example}»`);
    expect(all.split("\n")).toHaveLength(entries.length + 2);
    const look = words.helpOf("contemplo", name);
    expect(look).toContain("observar: «");
    for (const w of words.synonymsOf("look")) expect(look).toContain(w);
    // Por id, por nombre y por forma, sin tildes: el mismo verbo.
    expect(words.helpOf("look", name)).toBe(look);
    expect(words.helpOf("OBSERVAR", name)).toBe(look);
    expect(words.helpOf("volar", name)).toBeUndefined();
  });

  it("un sinónimo con dos lecturas no carga", () => {
    const [a, b] = entries;
    if (!a || !b) throw new Error("tabla vacía");
    expect(
      () =>
        new VerbWordBook([
          { ...a, synonyms: [{ as: a.forms[0] as string, words: ["choco"] }] },
          { ...b, synonyms: [{ as: b.forms[0] as string, words: ["choco"] }] },
        ]),
    ).toThrow(/dos lecturas/);
  });
});
