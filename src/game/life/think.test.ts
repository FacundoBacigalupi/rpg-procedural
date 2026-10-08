import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { INFERENCE_RULES } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../index.ts";
import { Life } from "./index.ts";
import { knownEntities } from "./known.ts";
import { reasonerOf, thinkOn, topicEntity, topicText } from "./think.ts";

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

describe("pensar sobre X", () => {
  it("saca el tema de la línea sin comando ni artículos", () => {
    expect(topicText("pensar sobre mi padre")).toBe("padre");
    expect(topicText("¿qué hago con la madre?")).toBe("madre");
    expect(topicText("pensar")).toBeUndefined();
  });

  it("razona con lo del personaje: conoce las reglas de sentido común y no inventa hechos", () => {
    const life = Life.create(7, content);
    const defs = content.all(INFERENCE_RULES);
    const who = reasonerOf(life.world, defs);
    expect(who.intellect).toBeGreaterThanOrEqual(0);
    expect(who.intellect).toBeLessThanOrEqual(1);
    expect(who.rules).toContain("theft-from-access");
    const known = knownEntities(life.world).find((k) => k.kind === "person");
    const topic = known === undefined ? undefined : topicEntity(known.names[0] ?? "", [known]);
    expect(topic).toBe(known?.ref);
    const r = thinkOn(life.world, defs, topic ?? "agent:0");
    // Las reglas no se disparan con lo que hoy hay en las creencias: no concluye nada de la nada.
    expect(r.thoughts).toEqual([]);
  }, 120_000);
});
