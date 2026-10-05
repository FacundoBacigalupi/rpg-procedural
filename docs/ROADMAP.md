# Roadmap

**Fuente única de "qué sigue".** Cuando preguntes "¿con qué seguimos?", la respuesta sale de la sección **Ahora** de este archivo. Al terminar algo: marcarlo, moverlo y elegir el siguiente.

Construcción por capas: cada fase deja algo **jugable o inspeccionable**.

Estado: `[ ]` pendiente · `[~]` en curso · `[x]` hecho

## ▶ Ahora (en orden)
1. [~] **Diseño: generación del planeta** ([systems/planet-gen.md](systems/planet-gen.md)) — decisiones cerradas (planeta grande, cielo plausible, tesoros naturales por qi).
2. [ ] **Fase 0: scaffold** (TS, Vitest, ESLint, scripts) — activa los checks de CI.

## Ideas / pendientes sueltos
- Cerrar las preguntas abiertas de [deep-history.md](systems/deep-history.md) (criterio de "ya no importa", calibración agregado vs individual).
- ¿Qué hay después de la ascensión? (salir del planeta)
- Diseño de cultivo: reinos procedurales, técnicas como objetos de conocimiento.
- Diseño de información y rumores.

## Setup del repo
- [x] Ramas `main` + `develop` (sin `master`), flujo en [GIT_WORKFLOW.md](GIT_WORKFLOW.md)
- [x] CI: typecheck/lint/tests, gitleaks, npm audit · Dependabot · CodeQL · secret scanning + push protection
- [x] Rulesets en `main` y `develop`, opciones de merge, labels, milestones por fase
- [x] `gh` autenticado (con scope `workflow`) · PRs #2 y #3 de Dependabot mergeados

## Diseño
- [x] Modelo causal del mundo ([systems/causality.md](systems/causality.md))
- [x] El Cielo y el karma ([systems/heaven-karma.md](systems/heaven-karma.md))
- [~] Historia profunda por relevancia ([systems/deep-history.md](systems/deep-history.md)) — borrador
- [~] Psicología de NPCs ([systems/npc-psychology.md](systems/npc-psychology.md)) — borrador
- [~] Generación del planeta ([systems/planet-gen.md](systems/planet-gen.md)) — borrador
- [~] Intrigas de NPCs ([systems/schemes.md](systems/schemes.md)) — borrador

## Fase 0 — Fundamentos
- [ ] Scaffold: TS strict, Vitest, ESLint (con reglas de dependencia), scripts npm, GitHub Actions (typecheck + tests)
- [ ] `core/rng` con seed y sub-streams + test de determinismo
- [ ] `core/time`: calendario, avance multi-escala
- [ ] Modelo de `Event` con `causes` + `originEventId` + tests de invariantes (sin huérfanos, conservación)
- [ ] Persistencia SQLite mínima (guardar/cargar mundo + log de eventos)
- [ ] Loop CLI: leer input → (stub) → imprimir

## Fase 1 — Vertical slice: una aldea, 20 NPCs, acción libre
- [ ] Planet-gen mínima (grilla, tectónica, clima, biomas, qi, PNG) para ubicar la aldea
- [ ] Aldea + bosque cercano hardcodeados/semigenerados
- [ ] Jugador con stats generados por seed
- [ ] Catálogo de ~10 acciones (moverse, buscar/recolectar, hablar, trabajar, descansar, robar, pelear, comerciar, observar, esperar)
- [ ] Resolución con resultados matizados
- [ ] Intent parser (Claude) → ActionPlan validado
- [ ] Narrador (Claude) solo con eventos visibles
- [ ] Muerte → pantalla de crónica
- [ ] Inspector god-mode básico

## Fase 2 — Psicología y memoria
- [ ] Rasgos innatos + adquiridos
- [ ] Relaciones multidimensionales
- [ ] Memorias de eventos con intensidad, confianza, degradación
- [ ] Conocimiento vs verdad (creencias sobre el jugador)
- [ ] Diálogo de NPCs condicionado por personalidad/memorias

## Fase 3 — Vida offscreen, familias y economía
- [ ] IA de utilidad: objetivos en capas que compiten
- [ ] Rutinas diarias, NPCs actúan sin el jugador
- [ ] Familias, herencia de rasgos, crianza → rasgos adquiridos
- [ ] Economía básica: oficios, precios, deudas
- [ ] Rumores (propagación de información con distorsión)
- [ ] Intrigas F1-F2: asesinato/robo motivados, cebos con rumores falsos, cómplices ([schemes.md](systems/schemes.md))

## Fase 4 — Cultivo
- [ ] Raíces espirituales, afinidades, meridianos, alma
- [ ] Reinos y técnicas (base metafísica + sistemas descubiertos por civilización)
- [ ] Percepción de nivel de cultivo ajeno (con incertidumbre)
- [ ] Talentos ocultos

## Fase 5 — Región y LOD
- [ ] Múltiples asentamientos, viajes, biomas
- [ ] Tiers de NPC 0–4, materialización coherente con estadísticas
- [ ] Scheduler multi-escala eficiente

## Fase 6 — Organizaciones
- [ ] Clanes, sectas, gremios como entidades con recursos, ideología, facciones internas
- [ ] Sectas que nacen de eventos (descubridor de técnica → escuela → secta)
- [ ] Relaciones entre organizaciones

## Fase 7 — Historia procedural
- [ ] Pipeline completo de worldgen (cosmología → … → NPCs)
- [ ] Simulación histórica rápida (siglos) que deja ruinas, técnicas perdidas, rivalidades
- [ ] Eras variables (temprana / dorada / decadente…)

## Fase 8 — Mundo completo
- [ ] Naciones, guerras, política
- [ ] Eventos mundiales que ocurren sin el jugador
- [ ] Rivales/genios en otras partes del mundo

## Fase 9 — Pulido
- [ ] UI web (Vite + React): chat + mapa + panel del personaje + crónica
- [ ] Archivo de crónicas de vidas pasadas
