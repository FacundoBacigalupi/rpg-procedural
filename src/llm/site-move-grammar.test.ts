import { describe, expect, it } from "vitest";
import { parseCommand } from "./grammar.ts";

function placeOf(input: string): string | undefined {
  const d = parseCommand(input) as unknown as {
    plan?: { verb?: string; args?: { role: string; ref?: { text: string } }[] };
  };
  expect(d.plan?.verb).toBe("move");
  return d.plan?.args?.find((a) => a.role === "to")?.ref?.text;
}

describe("la gramática para moverse adentro de la aldea", () => {
  it("salir sin lugar es «afuera» y entrar sin lugar es «adentro»", () => {
    expect(placeOf("salgo")).toBe("afuera");
    expect(placeOf("salgo afuera")).toBe("afuera");
    expect(placeOf("salgo de casa")).toBe("afuera");
    expect(placeOf("entro")).toBe("adentro");
  });

  it("salir o ir a caminar por un lugar va a ese lugar", () => {
    expect(placeOf("salgo a caminar por la aldea")).toBe("la aldea");
    expect(placeOf("voy a dar una vuelta por el pueblo")).toBe("el pueblo");
    expect(placeOf("vuelvo a casa")).toBe("casa");
    expect(placeOf("voy a la casa de mi madre")).toBe("la casa de mi madre");
  });

  it("«salir» solo sigue siendo el comando para dejar el juego", () => {
    expect(parseCommand("salir")).toMatchObject({ kind: "meta" });
    expect(parseCommand("salir a la plaza")).not.toMatchObject({ kind: "meta" });
  });
});
