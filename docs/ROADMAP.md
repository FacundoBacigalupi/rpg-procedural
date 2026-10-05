# Roadmap

**Fuente única de "qué sigue".** Cuando preguntes "¿con qué seguimos?", la respuesta sale de la sección **Ahora** de este archivo. Al terminar algo: marcarlo, moverlo y elegir el siguiente.

Construcción por capas: cada fase deja algo **jugable o inspeccionable**.

Estado: `[ ]` pendiente · `[~]` en curso · `[x]` hecho

## ▶ Ahora (en orden)
**Backlog de diseño** (acordado el 2026-10-05). Se hace **de a un ítem**: cada uno en su rama `docs/<nombre>`, con PR a `develop` (squash + auto-merge), y en el mismo PR se marca acá y se suma a "Diseño". Los sistemas nuevos van en `docs/systems/<nombre>.md`. La **Fase 0 (scaffold)** se puede intercalar en cualquier momento si se quiere empezar a codear.

### A. Sistemas base que otros docs ya dan por hechos
1. [x] **Percepción** → [perception.md](systems/perception.md): canales, emisión, propagación, atención, errores con forma, huellas, lectura de cultivo.
2. [x] **Información y rumores** → [information.md](systems/information.md): propagación con distorsión, canales (postas, palomas, talismanes de mensaje, espías), creencias en `sim/knowledge`, el mapa como creencia (mapas como objetos que envejecen y se falsifican), alfabetización y escrituras.
3. [x] **Cuerpo y salud** → [body-health.md](systems/body-health.md): cuerpo por partes, heridas que se infectan o dejan secuelas, enfermedades crónicas, nutrición, frío/calor, fatiga, adicciones, envejecimiento, medicina mortal vs alquimia, daño a meridianos.
4. [ ] **Cultivo** → `cultivation.md` (familia xianxia, con las interfaces genéricas de [metaphysics.md](systems/metaphysics.md)): reinos procedurales, técnicas como conocimiento, rupturas, cultivo de espíritus, volver a ser humano.
5. [ ] **Experimentación, descubrimiento e iluminación** → `discovery.md`: cómo un agente forma hipótesis sobre las leyes del mundo, prueba, se equivoca y acumula comprensión; dogmas erróneos de escuelas; iluminación (悟) como umbral de un estado acumulado; arte con intención (aprender contemplando una obra).
6. [ ] **Economía** → `economy.md`: mercados por asentamiento, precios por oferta y demanda, información asimétrica de precios, piedras espirituales como moneda (inflación por minas), crédito y usura, subastas, gremios y monopolios, metal escaso.
7. [ ] **Organizaciones** → `organizations.md`: clanes, sectas, gremios; decisiones por facciones internas; nacimiento, cismas y muerte; recursos, aportes y puestos.

### B. Sistemas nuevos
8. [ ] **Interacciones elementales** (ampliación de [metaphysics.md](systems/metaphysics.md)): ciclos de generación y destrucción como física común para alquimia, formaciones y combate. Va antes de oficios porque estos la usan.
9. [ ] **Oficios** → `crafts.md`: alquimia con propiedades y toxinas residuales, forja limitada por el metal escaso, formaciones que modifican el campo de qi real, talismanes.
10. [ ] **Contratos y juramentos** → `contracts.md`: un modelo único para deudas, matrimonios, maestro–discípulo, alianzas y pactos, con cumplimiento social, legal o kármico (unifica `debts`, `bonds` y `KarmicBond`).
11. [ ] **Familia y linaje** → `family-lineage.md`: matrimonio y alianzas, sexualidad, hijos ilegítimos, herencias y disputas, cultivo dual, fertilidad baja en cultivadores, genealogías de clan.
12. [ ] **Estratificación social** → `social-structure.md`: castas, servidumbre, esclavitud, movilidad social, abismo mortal/cultivador; qué acciones tiene cada uno a su alcance.
13. [ ] **Ley y justicia** → `law.md`: códigos por cultura, crímenes, investigación (huellas), jueces corruptos, castigos, sectas por encima de la ley, vendetta vs tribunal, reglas internas de secta, contrabando y mercado negro.
14. [ ] **Estado y política** → `state.md`: legitimidad, impuestos, burocracia, exámenes imperiales, crisis de sucesión, relación trono–secta.
15. [ ] **Guerra** → `war.md`: logística y suministro, moral, asedios, formaciones defensivas, ejércitos mortales vs cultivadores.
16. [ ] **Tecnología mortal** → `technology.md`: agricultura, metalurgia, escritura, imprenta; difusión de innovaciones con el modelo de información.
17. [ ] **Reinos secretos (秘境)** → `secret-realms.md`: bolsillos dimensionales con creador, que se abren con las mareas de qi, saqueados antes y degradándose por dentro.
18. [ ] **Adivinación y profecía** → `divination.md`: lectura ruidosa del grafo causal y de las presiones; profecías que se cumplen solas o provocan lo que querían evitar; lectura de karma.
19. [ ] **Crónica, epílogo e historiografía** → `chronicle.md`: epílogo simulado N años después de morir; crónicas in-world sesgadas; el legado como lo que se recuerda de vos.

### C. Ampliaciones de lo que ya hay
20. [ ] [heaven-karma.md](systems/heaven-karma.md): atención del Cielo como recurso finito, zonas ciegas, robar el rayo de una tribulación ajena, el Cielo inclina tiradas a favor de los enemigos de quien sobreexplota, fortuna colectiva (气运) de organizaciones y naciones.
21. [ ] [npc-psychology.md](systems/npc-psychology.md): desarrollo por etapas, salud mental (depresión, estrés postraumático, adicción), declive cognitivo, necesidad de sentido y pertenencia, psicología de multitudes, sueños que consolidan memorias, gustos personales generados.
22. [ ] [causality.md](systems/causality.md) + [schemes.md](systems/schemes.md): mapa de presiones en el inspector; generalizar `Scheme` a proyectos (planes cooperativos); intrigas entre organizaciones; intrigantes que explotan profecías.
23. [ ] [planet-gen.md](systems/planet-gen.md): glaciaciones y nivel del mar ligados a las mareas de qi (puentes de tierra), suelos que se agotan, inviernos volcánicos.
24. [ ] [living-world.md](systems/living-world.md): sucesión ecológica, especies invasoras por rutas comerciales, migraciones estacionales, domesticación y contratos con bestias.
25. [ ] [spirits.md](systems/spirits.md): economía de ofrendas a ancestros; qué pasa cuando un linaje deja de ofrendar.
26. [ ] [deep-history.md](systems/deep-history.md): arqueología como juego (estratos, datación de objetos, nombres de lugares deformados como pistas).

### Después del backlog
- [ ] **Fase 0: scaffold** (TS strict, Vitest, ESLint con reglas de dependencia, scripts npm), que activa los checks de CI. Ver la sección Fase 0 más abajo.

## Estado del diseño (2026-10-05)
Todo el diseño base está escrito en `docs/systems/` y mergeado en `develop`. Los docs marcados "borrador" tienen preguntas abiertas menores que se cierran al implementar (calibración con la sim headless):
- deep-history: criterio de "ya no importa", calibración agregado vs individual, cuánto pasado mostrar.
- npc-psychology: top-N memorias por NPC de tier 2.
- schemes: máximo de intrigas activas por NPC.
- spirits: tiempo en las Fuentes antes de renacer.
- metaphysics: peso exacto de cada familia.
- perception: tamaño del grafo de espacios en ciudades grandes, calibración de curvas de atenuación.
- body-health: cantidad de partes del plan humano en tier 4, calibración de curación, infección y mortalidad.

## Ideas / pendientes sueltos
- ¿Qué hay después de la ascensión? (salir del planeta)
- Segunda familia de mundo: alta fantasía occidental (Fase 7+).

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
- [x] Generación del planeta ([systems/planet-gen.md](systems/planet-gen.md))
- [~] Metafísica: leyes por mundo ([systems/metaphysics.md](systems/metaphysics.md)) — borrador
- [x] Mundo vivo ([systems/living-world.md](systems/living-world.md))
- [~] Espíritus ([systems/spirits.md](systems/spirits.md)) — borrador
- [~] Intrigas de NPCs ([systems/schemes.md](systems/schemes.md)) — borrador
- [~] Percepción ([systems/perception.md](systems/perception.md)) — borrador
- [~] Información, creencias y rumores ([systems/information.md](systems/information.md)) — borrador
- [~] Cuerpo y salud ([systems/body-health.md](systems/body-health.md)) — borrador

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
- [ ] Percepción mínima (vista y oído, grafo de espacios de la aldea, luz) ([perception.md](systems/perception.md))
- [ ] Narrador (Claude) solo con los percepts del jugador
- [ ] Cuerpo mínimo: heridas con sangrado e infección, hambre, sed, fatiga, muerte con causa ([body-health.md](systems/body-health.md))
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
- [ ] Enfermedades con contagio, médicos, sustancias y adicciones, nutrición, frío/calor ([body-health.md](systems/body-health.md))
- [ ] Economía básica: oficios, precios, deudas
- [ ] Rumores (propagación de información con distorsión, reputación por comunidad) ([information.md](systems/information.md))
- [ ] Intrigas F1-F2: asesinato/robo motivados, cebos con rumores falsos, cómplices ([schemes.md](systems/schemes.md))

## Fase 4 — Cultivo
- [ ] Raíces espirituales, afinidades, meridianos, alma
- [ ] Cuerpo y cultivo: daño de meridianos, desviación de qi, toxicidad de píldoras, refinamiento corporal ([body-health.md](systems/body-health.md))
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
