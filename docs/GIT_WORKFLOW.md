# Flujo de Git

## Ramas
| Rama | Para qué | Cómo entra código |
|---|---|---|
| `main` | Versión estable. Cada merge es un "release" (fin de una fase o hito jugable). | Solo PR desde `develop` (o `hotfix/*`). Merge commit + tag `vX.Y.Z`. |
| `develop` | Integración. Siempre compila y pasa los tests. | Solo PR desde ramas de trabajo. **Squash merge.** |
| `feat/<nombre>` | Una feature del ROADMAP | Sale de `develop`, vuelve a `develop`. |
| `fix/<nombre>` | Bug | Sale de `develop`, vuelve a `develop`. |
| `docs/<nombre>` | Diseño / documentación | Sale de `develop`, vuelve a `develop`. |
| `chore/<nombre>` | Config, CI, dependencias, refactors sin cambio de comportamiento | Sale de `develop`, vuelve a `develop`. |
| `hotfix/<nombre>` | Arreglo urgente sobre `main` | Sale de `main`, va a `main` **y** a `develop`. |

No hay `master`.

## Ciclo de una tarea
```
git switch develop && git pull
git switch -c feat/rng-seeded
# ... commits ...
git push -u origin feat/rng-seeded
# PR → develop, CI en verde, squash merge, se borra la rama
```

## Commits
Conventional Commits: `tipo(scope): descripción`
- tipos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`
- scopes: `core`, `sim`, `npc`, `world`, `worldgen`, `cultivation`, `llm`, `persistence`, `cli`, `repo`
- Ejemplo: `feat(core): RNG con seed y sub-streams`

## Versionado
`v0.<fase>.<n>` hasta que el juego sea jugable de punta a punta. Por ejemplo, terminar la Fase 1 es `v0.1.0`.

## CI (`.github/workflows/ci.yml`)
Corre en push y PR a `main`/`develop`:
- typecheck + lint + tests (se saltean hasta que exista `package.json`)
- escaneo de secretos con gitleaks
- `npm audit` en PRs

Dependabot propone actualizaciones de dependencias contra `develop`.

## Secretos
- La API key de Claude va en `.env` (ignorado por git). La plantilla está en `.env.example`.
- Nunca se commitean partidas (`saves/`, `*.db`).

## Configuración de GitHub (aplicada)
El repo es **público**.
- **Rulesets** en `main` (solo merge commit) y `develop` (solo squash): PR obligatorio (0 aprobaciones, porque es un solo dev), checks obligatorios `Typecheck, lint y tests` y `Escaneo de secretos`, sin force-push ni borrado. Nadie puede saltearlos, ni el admin.
- Merges permitidos: squash y merge commit (rebase desactivado). Las ramas se borran solas al mergear.
- Seguridad: Dependabot alerts y security updates, secret scanning con push protection, CodeQL (default setup).
- Actions con permisos de solo lectura por defecto.
- Labels: `feature`, `bug`, `design`, `chore`, `dependencies`, `area:*`. Milestones: uno por fase del ROADMAP.
- `gh` está instalado y autenticado (`C:\Program Files\GitHub CLI`), así que Claude puede abrir PRs e issues, consultar el CI y mergear (permiso `Bash(gh pr merge *)` en `.claude/settings.local.json`, no versionado). Mergear PRs que tocan `.github/workflows/` requiere que el token de gh tenga el scope `workflow`.
