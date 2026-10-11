import { describe, expect, it } from "vitest";
import { engineNumber, type SaveVersions, upgradeVersions } from "./versions.ts";

const v1: SaveVersions = { engine: "life-1", content: "none", format: 1 };
const v2: SaveVersions = { ...v1, engine: "life-2" };

describe("versiones de un guardado", () => {
  it("las mismas versiones abren sin más", () => {
    expect(upgradeVersions(v1, v1, 100)).toEqual({ kind: "same" });
  });

  it("un motor más nuevo sigue la vida y registra el límite de replay con tick y versiones", () => {
    expect(upgradeVersions(v1, v2, 777)).toEqual({
      kind: "upgrade",
      versions: v2,
      limit: { tick: 777, from: v1, to: v2 },
    });
  });

  it("un motor más viejo, el mismo número, otro formato u otro contenido no se cruzan", () => {
    for (const [saved, current] of [
      [v2, v1],
      [{ ...v1, engine: "otro" }, v2],
      [{ ...v1, format: 2 }, v2],
      [{ ...v1, content: "abc" }, v2],
    ] as const)
      expect(upgradeVersions(saved, current, 0).kind).toBe("incompatible");
  });

  it("lee el número del motor", () => {
    expect(engineNumber("life-12")).toBe(12);
    expect(engineNumber("motor")).toBeUndefined();
  });
});
