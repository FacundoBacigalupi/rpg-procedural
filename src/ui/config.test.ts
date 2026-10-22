import { parseArgs } from "node:util";
import { describe, expect, it } from "vitest";
import { FULL_PROFILE, optionsOf } from "../game/index.ts";
import { ScenarioLife } from "../sim/index.ts";
import { LIFE_ARG_OPTIONS, lifeConfig } from "./config.ts";

function config(args: string[]) {
  return lifeConfig(
    parseArgs({ args: ["--seed", "1", ...args], options: LIFE_ARG_OPTIONS }).values,
  );
}

describe("perfil de la CLI y la web", () => {
  it("guarda las opciones completas como datos del setup para retomar y reproducir", () => {
    const setup = config(["--profile", "full"]).setup;
    expect(setup.life).toEqual(FULL_PROFILE);
    expect(ScenarioLife.parse(setup.life)).toEqual(FULL_PROFILE);
    expect(optionsOf(JSON.parse(JSON.stringify(setup)))).toMatchObject(FULL_PROFILE);
    expect(setup.life).not.toBe(FULL_PROFILE);
  });

  it("sin flag la vida nueva lleva el perfil completo (life-3) y basic conserva el mundo mínimo", () => {
    expect(config([]).setup.life).toEqual(FULL_PROFILE);
    expect(config(["--profile", "basic"]).setup.life).toBeUndefined();
    expect(config(["--profile", "basic", "--famine"]).setup.famine).toBe(true);
  });

  it("--tech suma mortalTech al setup (con o sin perfil) y sin él no aparece", () => {
    expect(config([]).setup.life).not.toHaveProperty("mortalTech");
    const full = config(["--tech"]).setup.life;
    expect(full).toEqual({ ...FULL_PROFILE, mortalTech: true });
    expect(ScenarioLife.parse(full)).toEqual({ ...FULL_PROFILE, mortalTech: true });
    expect(config(["--profile", "basic", "--tech"]).setup.life).toEqual({ mortalTech: true });
  });

  it("rechaza nombres de perfil desconocidos", () => {
    expect(() => config(["--profile", "ful"])).toThrow("perfil inválido");
  });
});
