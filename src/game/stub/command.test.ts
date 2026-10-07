import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { MAX_WAIT, parseCommand } from "./command.ts";
import { DAY } from "./world.ts";

describe("parseCommand", () => {
  it.each([
    ["esperar", { verb: "wait", seconds: 3600 }],
    ["Esperar 2 horas", { verb: "wait", seconds: 7200 }],
    ["espero un día.", { verb: "wait", seconds: DAY }],
    ["esperar media hora", { verb: "wait", seconds: 1800 }],
    ["esperar 3 semanas", { verb: "wait", seconds: 21 * DAY }],
    ["esperar dia", { verb: "wait", seconds: DAY }],
    ["dormir", { verb: "wait", seconds: 8 * 3600 }],
    ["miro alrededor", { verb: "look" }],
    ["MIRAR", { verb: "look" }],
    ["construir una choza", { verb: "build" }],
    ["construyo choza", { verb: "build" }],
    ["regalar 3 monedas a aldeano 4", { verb: "give", to: makeId("agent", 4), amount: 3 }],
    ["doy una moneda a aldeano 2", { verb: "give", to: makeId("agent", 2), amount: 1 }],
  ])("«%s» es un plan", (text, plan) => {
    expect(parseCommand(text)).toEqual({ kind: "plan", plan });
  });

  it.each([
    "esperar para siempre",
    "esperar 0 horas",
    `esperar ${MAX_WAIT / DAY + 1} dias`,
    "construir un castillo",
    "regalar 3 monedas a vos",
    "regalar 3 monedas a aldeano 1",
    "regalar -2 monedas a aldeano 3",
    "regalar 2 piedras a aldeano 3",
    "mirar el cielo",
    "volar",
  ])("«%s» no se entiende", (text) => {
    expect(parseCommand(text)).toEqual({ kind: "unknown", text });
  });

  it("separa los comandos fuera del personaje y la línea vacía", () => {
    expect(parseCommand(" Ayuda ")).toEqual({ kind: "meta", meta: "ayuda" });
    expect(parseCommand("salir")).toEqual({ kind: "meta", meta: "salir" });
    expect(parseCommand("   ")).toEqual({ kind: "empty" });
  });
});
