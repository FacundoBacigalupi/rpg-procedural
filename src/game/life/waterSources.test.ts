import { describe, expect, it } from "vitest";
import { waterAt } from "./waterSources.ts";

describe("waterAt", () => {
  it("en el sitio bebe el pozo, y hervirlo mata la carga", () => {
    const raw = waterAt({}, { hex: 3, space: "s" }, 0.5);
    const boiled = waterAt({ treatment: "boil" }, { hex: 3, space: "s" }, 0.5);
    expect(raw.treated).toBe(0);
    expect(boiled.treated).toBeGreaterThan(0.9);
  });
  it("a campo abierto usa la fuente del hex, por defecto río, y el mar es salado", () => {
    const cfg = { hexKinds: new Map([[7, "sea" as const]]) };
    expect(waterAt(cfg, { hex: 7 }, 0).salinity).toBeGreaterThan(0.5);
    expect(waterAt(cfg, { hex: 1 }, 0).load).toBeGreaterThan(0);
  });
});
