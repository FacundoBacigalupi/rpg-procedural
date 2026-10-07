// Serialización canónica (tooling §2): el mismo valor da siempre el mismo texto, en cualquier
// plataforma. Claves de objeto ordenadas por código, sin espacios; los arrays conservan su orden
// (el orden de un array es parte del dato: quien guarda un conjunto lo guarda ordenado, como
// `WorldTruth.rows()` o `IdAllocator.state()`). Los números salen con la representación más corta
// que vuelve exacta (la de `JSON.stringify`), y `-0` se escribe `0`.
//
// Solo acepta datos: null, booleanos, números finitos, strings, arrays y objetos planos. Una
// propiedad `undefined` se omite (es lo mismo que no tenerla); cualquier otra cosa (NaN, Map,
// funciones, clases, `undefined` dentro de un array) es un error, porque no volvería igual.
// El hash del estado vive en `persistence/`, que puede usar `node:crypto`.

import { compareStrings } from "../ids/index.ts";

export class CanonError extends Error {
  override name = "CanonError";
}

export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, out, "$");
  return out.join("");
}

/** Copia profunda que normaliza al valor que se lee de vuelta de `canonicalJson`. */
export function canonicalize<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function write(v: unknown, out: string[], path: string): void {
  if (v === null) {
    out.push("null");
    return;
  }
  switch (typeof v) {
    case "boolean":
      out.push(v ? "true" : "false");
      return;
    case "number":
      if (!Number.isFinite(v)) throw new CanonError(`${path}: número no finito (${v})`);
      out.push(Object.is(v, -0) ? "0" : JSON.stringify(v));
      return;
    case "string":
      out.push(JSON.stringify(v));
      return;
    case "object":
      break;
    default:
      throw new CanonError(`${path}: ${typeof v} no es un dato`);
  }
  if (Array.isArray(v)) {
    out.push("[");
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out.push(",");
      const item: unknown = v[i];
      if (item === undefined) throw new CanonError(`${path}[${i}]: undefined en un array`);
      write(item, out, `${path}[${i}]`);
    }
    out.push("]");
    return;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonError(`${path}: ${proto?.constructor?.name ?? "objeto"} no es un objeto plano`);
  }
  const record = v as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort(compareStrings);
  out.push("{");
  keys.forEach((k, i) => {
    if (i > 0) out.push(",");
    out.push(JSON.stringify(k), ":");
    write(record[k], out, `${path}.${k}`);
  });
  out.push("}");
}
