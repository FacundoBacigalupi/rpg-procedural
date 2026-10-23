import { describe, expect, it } from "vitest";
import type { EntityRef } from "../../core/index.ts";
import { type KnownEntity, resolveRef } from "../../sim/index.ts";
import { withNarratedWords } from "./known.ts";

const figure = (ref: string, features: string[], present = true): KnownEntity => ({
  ref: ref as EntityRef,
  kind: "person",
  names: [],
  features,
  relations: [],
  present,
  via: [],
});

describe("lo que la escena nombró se puede señalar", () => {
  const known = [
    figure("agent:7", ["persona", "hombre", "señor"]),
    figure("agent:8", ["persona", "mujer", "señora"]),
    figure("agent:9", ["persona", "viejo"], false),
  ];
  const ask = (text: string, narrated: ReadonlyMap<string, readonly string[]>) =>
    resolveRef({ text, kind: "person", features: [] }, withNarratedWords(known, narrated));

  it("«la figura desconocida» apunta a quien la narración llamó así", () => {
    expect(ask("la figura desconocida", new Map()).status).toBe("unknown");
    const r = ask("la figura desconocida", new Map([["agent:8", ["Una figura desconocida"]]]));
    expect(r.status === "unique" && r.chosen).toBe("agent:8");
  });

  it("lo narrado de alguien que ya no está no lo vuelve a señalar", () => {
    const r = ask("el hombre del sombrero", new Map([["agent:9", ["el hombre del sombrero"]]]));
    // Encaja por «hombre» con el que está, no por lo narrado del ausente.
    expect(r.status === "unique" && r.chosen).toBe("agent:7");
    expect(withNarratedWords(known, new Map([["agent:9", ["x"]]]))).toEqual(known);
  });
});
