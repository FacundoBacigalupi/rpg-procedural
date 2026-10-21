import { acquireHeavy } from "./heavy-lock.ts";

export default async function setup() {
  const release = await acquireHeavy("vitest");
  return release;
}
