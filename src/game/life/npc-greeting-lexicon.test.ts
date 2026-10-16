import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent, makeId } from "../../core/index.ts";
import {
  CONCEPTS,
  ENTITY,
  generateLanguage,
  LANGUAGES,
  PERSON_NAME,
  understand,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { greetingWord, lexicalGreetingSpeech } from "./npc-greeting-speech.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const spec = content.get(LANGUAGES, "village.hills");
if (!spec) throw new Error("falta la lengua de la aldea");
const concepts = content.all(CONCEPTS);

const a = makeId("agent", 1) as AgentId;
const b = makeId("agent", 2) as AgentId;

describe("el saludo desde el concepto greeting del léxico", () => {
  it("la palabra sale de la lengua, es estable y cambia con el seed", () => {
    const x = generateLanguage(5, spec, concepts);
    const word = greetingWord(x);
    expect(word).toBeTruthy();
    expect(word).not.toBe("Buenas");
    expect(greetingWord(generateLanguage(5, spec, concepts))).toBe(word);
    expect(greetingWord(generateLanguage(6, spec, concepts))).not.toBe(word);
  });

  it("el saludo dicho en la lengua lo entiende `understand` por el léxico, no por regex", () => {
    const language = generateLanguage(5, spec, concepts);
    const t = new WorldTruth();
    t.set(ENTITY, b, { id: b, originEventId: makeId("event", 1), createdAt: 0 } as never);
    t.set(PERSON_NAME, b, { language: "hills", parts: [{ kind: "given", form: "Aren" }] } as never);
    const speech = lexicalGreetingSpeech({ language, addresses: [], culture: "village" });
    const said = speech.say(a, b, t);
    expect(said.startsWith(greetingWord(language) as string)).toBe(true);
    expect(understand(said, speech.lexicon).kind).toBe("greet");
    // Sin el léxico del saludo, la palabra de la lengua no es un saludo.
    expect(understand(said, { people: [], goods: [] }).kind).toBe("other");
    // El español del jugador sigue entendiéndose.
    expect(understand("Buenas", { people: [], goods: [] }).kind).toBe("greet");
    expect(speech.gesture?.(t, a, b)).toBe(true);
  });
});
