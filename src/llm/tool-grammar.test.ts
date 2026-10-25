import { describe, expect, it } from "vitest";
import { parseCommand } from "./grammar.ts";

function planOf(input: string): unknown {
  return (parseCommand(input) as unknown as { plan?: unknown }).plan;
}

describe("la herramienta con la que se hace el paso (use-tools-arg)", () => {
  it("«junto leña con el hacha» separa lo que junta de con qué", () => {
    expect(planOf("junto leña con el hacha")).toMatchObject({
      verb: "gather",
      args: [
        { role: "what", text: "leña" },
        { role: "with", ref: { text: "hacha", kind: "object" } },
      ],
    });
    expect(planOf("recojo hongos con mi cuchillo")).toMatchObject({
      verb: "gather",
      args: [
        { role: "what", text: "hongos" },
        { role: "with", ref: { text: "cuchillo", kind: "object" } },
      ],
    });
  });

  it("«trabajo con la azada dos horas» lleva la herramienta y el tiempo", () => {
    expect(planOf("trabajo con la azada dos horas")).toMatchObject({
      verb: "work",
      args: [{ role: "for" }, { role: "with", ref: { text: "azada" } }],
    });
    expect(planOf("carpo con la azada")).toMatchObject({
      verb: "work",
      args: [{ role: "with", ref: { text: "azada" } }],
    });
  });

  it("«con cuidado» es un modo, no una herramienta; sin «con», a mano", () => {
    const careful = planOf("junto leña con cuidado") as { args: { role: string }[] };
    expect(careful.args.some((a) => a.role === "with")).toBe(false);
    expect(planOf("junto leña")).toMatchObject({
      verb: "gather",
      args: [{ role: "what", text: "leña" }],
    });
    expect(planOf("trabajo")).toMatchObject({ verb: "work", args: [] });
  });
});
