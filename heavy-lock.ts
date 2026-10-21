// Candado global de procesos pesados (vitest, sims, llm-bench): una sola instancia a la vez en
// toda la máquina, incluso entre worktrees y agentes (la PC se apaga bajo carga paralela).
// El candado es un archivo en el tmp del sistema con el pid del dueño; si el dueño murió, se roba.
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK = join(tmpdir(), "rpg-procedural-heavy.lock");
const POLL_MS = 2000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function tryTake(label: string): boolean {
  try {
    const fd = openSync(LOCK, "wx");
    writeSync(fd, `${process.pid} ${label}\n`);
    closeSync(fd);
    return true;
  } catch {
    try {
      const owner = Number.parseInt(readFileSync(LOCK, "utf8"), 10);
      if (!Number.isFinite(owner) || !alive(owner)) unlinkSync(LOCK);
    } catch {
      // otro proceso lo tomó o lo soltó justo ahora: se reintenta
    }
    return false;
  }
}

/** Espera su turno y devuelve la función que suelta el candado (también se suelta al salir). */
export async function acquireHeavy(label = "heavy"): Promise<() => void> {
  let warned = false;
  while (!tryTake(label)) {
    if (!warned) {
      console.error(`[heavy-lock] hay otro proceso pesado corriendo (${LOCK}); espero mi turno…`);
      warned = true;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    try {
      unlinkSync(LOCK);
    } catch {
      // ya no estaba
    }
  };
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      release();
      process.exit(1);
    });
  }
  return release;
}
