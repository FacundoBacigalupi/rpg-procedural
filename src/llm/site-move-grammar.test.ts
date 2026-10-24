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

  it("acercarse a alguien o a algo es moverse hasta ahí, sin decir qué es", () => {
    expect(placeOf("me acerco a la vieja")).toBe("la vieja");
    expect(placeOf("acercarse a la vieja")).toBe("la vieja");
    expect(placeOf("me acerco al río")).toBe("el río");
  });

  it("solo «!salir» deja el juego; sin «!» es del personaje (play-bang-commands)", () => {
    expect(parseCommand("!salir")).toEqual({ kind: "meta", text: "salir" });
    expect(parseCommand("! gente")).toEqual({ kind: "meta", text: "gente" });
    expect(parseCommand("salir")).not.toMatchObject({ kind: "meta" });
    expect(parseCommand("salir corriendo")).toMatchObject({ plan: { verb: "move" } });
    expect(parseCommand("salir a la plaza")).not.toMatchObject({ kind: "meta" });
    expect(parseCommand("gente de la plaza, ¿me oyen?")).not.toMatchObject({ kind: "meta" });
  });
});

describe("andar sin destino", () => {
  it("caminar o ir «por ahí» es dar una vuelta", () => {
    expect(placeOf("camino")).toBe("por ahí");
    expect(placeOf("salgo a caminar")).toBe("afuera");
    expect(placeOf("paseo un poco")).toBe("por ahí");
    expect(placeOf("voy por ahí")).toBe("por ahí");
    expect(placeOf("camino por los alrededores")).toBe("por ahí");
  });
});

describe("lo que dura un paseo", () => {
  const lasts = (input: string) =>
    (
      parseCommand(input) as unknown as {
        plan?: { args?: { role: string; duration?: { amount: number; unit: string } }[] };
      }
    ).plan?.args?.find((a) => a.role === "for")?.duration;

  it("dar una vuelta dura un rato si no se dice cuánto", () => {
    for (const t of [
      "camino",
      "paseo un poco",
      "voy por ahí",
      "voy a dar una vuelta por el pueblo",
    ]) {
      expect(lasts(t), t).toEqual({ amount: 15, unit: "minute" });
    }
  });

  it("lo que dice el jugador manda y no se lee como lugar", () => {
    expect(placeOf("camino media hora")).toBe("por ahí");
    expect(lasts("camino media hora")).toEqual({ amount: 30, unit: "minute" });
    expect(placeOf("paseo por la plaza durante una hora")).toBe("la plaza");
    expect(lasts("paseo por la plaza durante una hora")).toEqual({ amount: 1, unit: "hour" });
  });

  it("ir a un lugar no es un paseo: dura lo que tarda llegar", () => {
    for (const t of ["vuelvo a casa", "voy a la casa de mi madre", "salgo", "entro"]) {
      expect(lasts(t), t).toBeUndefined();
    }
  });
});
