// La pantalla de inicio (ROADMAP play-world-choice-screen): si el guardado no tiene vida, la web
// abre sin sesión y pregunta familia del mundo, modo, seed y (en modo novela) personaje; recién al
// elegir se genera el mundo. Con una vida ya empezada no hay nada que elegir y la API es la de
// siempre.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Session } from "../session.ts";
import type { SetupChoice, SetupInfo } from "./api.ts";
import { type ApiHandler, apiHandler, readBody, send } from "./server.ts";

/** Lo que se puede elegir del personaje en modo novela (los valores de `--sex` y `--familia`). */
export const NOVEL_SEXES = ["mujer", "hombre"] as const;
export const NOVEL_FAMILIES = ["terrateniente", "campesina", "sirviente"] as const;

/** Lee la elección del cliente; devuelve el texto del error si algo no vale. */
export function parseSetupChoice(body: unknown, info: SetupInfo): SetupChoice | string {
  if (body === null || typeof body !== "object") return "cuerpo inválido";
  const b = body as {
    world?: unknown;
    mode?: unknown;
    seed?: unknown;
    sex?: unknown;
    familia?: unknown;
    age?: unknown;
  };
  if (typeof b.world !== "string" || !info.families.includes(b.world))
    return `familia del mundo: ${info.families.join(", ")}`;
  if (b.mode !== "realista" && b.mode !== "novela") return "modo: realista o novela";
  const seed = b.seed;
  if (seed !== undefined && (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0))
    return "seed: un entero no negativo, o vacío para uno al azar";
  const novel = b.mode === "novela";
  const sex = b.sex;
  if (sex !== undefined && !(novel && NOVEL_SEXES.includes(sex as never)))
    return "el sexo se elige en modo novela: mujer u hombre";
  const familia = b.familia;
  if (familia !== undefined && !(novel && NOVEL_FAMILIES.includes(familia as never)))
    return "la familia se elige en modo novela: terrateniente, campesina o sirviente";
  const age = b.age;
  if (age !== undefined && !(novel && typeof age === "number" && Number.isInteger(age) && age >= 0))
    return "la edad de entrada se elige en modo novela: un entero";
  return {
    world: b.world,
    mode: b.mode,
    ...(seed !== undefined ? { seed: seed as number } : {}),
    ...(sex !== undefined ? { sex: sex as NonNullable<SetupChoice["sex"]> } : {}),
    ...(familia !== undefined ? { familia: familia as NonNullable<SetupChoice["familia"]> } : {}),
    ...(age !== undefined ? { age: age as number } : {}),
  };
}

/**
 * La API antes de que haya vida: `GET /api/setup` dice qué se puede elegir (y si ya empezó),
 * `POST /api/setup` empieza la vida con `begin` (tarda lo que tarda generar el planeta) y desde ahí
 * todo pasa a la API de la sesión. Mientras no hay vida, el resto de `/api/*` contesta 409.
 */
export function setupHandler(
  info: SetupInfo,
  begin: (choice: SetupChoice) => Promise<Session>,
): ApiHandler {
  let api: ApiHandler | undefined;
  let starting = false;
  return async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/api/setup" && req.method === "GET") {
      send(res, 200, { ...info, started: api !== undefined });
      return true;
    }
    if (path === "/api/setup" && req.method === "POST") {
      if (api !== undefined || starting) {
        send(res, 409, { error: "la vida ya empezó" });
        return true;
      }
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: "cuerpo inválido" });
        return true;
      }
      const choice = parseSetupChoice(body, info);
      if (typeof choice === "string") {
        send(res, 400, { error: choice });
        return true;
      }
      starting = true;
      try {
        api = apiHandler(await begin(choice));
        send(res, 200, { started: true });
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      } finally {
        starting = false;
      }
      return true;
    }
    if (api !== undefined) return api(req, res);
    if (path?.startsWith("/api/")) {
      send(res, 409, { error: "todavía no empezó la vida", setup: true });
      return true;
    }
    return false;
  };
}

/** Con una vida ya abierta: la API de siempre, y `GET /api/setup` dice que ya empezó. */
export function startedHandler(session: Session, info: SetupInfo): ApiHandler {
  const api = apiHandler(session);
  return async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/api/setup" && req.method === "GET") {
      send(res, 200, { ...info, started: true });
      return true;
    }
    return api(req, res);
  };
}
