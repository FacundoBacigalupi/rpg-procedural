# Habilidades y aprendizaje: el saber hacer

> Principio: **la habilidad está en el cuerpo y en la cabeza de alguien, no en una hoja.** Se forma con lo que la persona percibió al practicar, al mirar y al ser corregida. Tiene un techo que pone el talento y el cuerpo, se oxida si no se usa y se parece a sus vecinas. Nadie, ni siquiera quien la tiene, conoce su nivel exacto.

> Estado: **borrador** (2026-10-06).

Depende de: [actions.md](actions.md) §7 (la habilidad es un factor de cada resolución), [perception.md](perception.md) (se aprende solo de lo percibido), [npc-psychology.md](npc-psychology.md) (aptitudes, plasticidad por etapa, memoria, sueño que consolida, motivación), [body-health.md](body-health.md) §3 (capacidades, techo corporal, envejecimiento), [family-lineage.md](family-lineage.md) §4 (talento heredado), [information.md](information.md) (el saber explícito son creencias; manuales como medios).
Generaliza: crafts §1 (`CraftSkill`), cultivation §8 (`KnownTechnique`: comprensión y competencia), technology §2 (`ProcessKnowledge`: fidelidad y práctica).
Lo usan: todos los resolvers de acciones, [combat.md](combat.md) (estilos y reflejos), [dialogue.md](dialogue.md) (habilidades sociales), [language.md](language.md) (lenguas y escrituras con este modelo), organizations §9 (maestro y discípulo), economy (el oficio como medio de vida), social-structure (exámenes y certificaciones), discovery (insights y descubrimientos que se vuelven saber).

---

## Principios

1. **Un solo modelo para todo saber hacer:** combate, oficios, trato social, cuerpo, estudio, lenguas y técnicas de cultivo. Lo que cambia entre dominios son los datos (en `content/skills/`), no el mecanismo.
2. **Tácito y explícito son cosas distintas.** El saber explícito ("la temperatura del temple es el rojo cereza") es una creencia, se escribe y se transmite como texto. El saber tácito (la mano que siente cuándo) solo se forma practicando, mirando y siendo corregido. Un manual da lo primero; un maestro, los dos.
3. **Se aprende de lo percibido.** La práctica enseña lo que el actor notó de su propio resultado. Un error que no vio no le enseña nada, o le enseña mal: así nacen los vicios.
4. **El techo existe y está oculto.** Talento, cuerpo, edad y cultivo ponen un límite real que nadie ve directamente. Se intuye por la velocidad con que uno mejora y por cuándo deja de mejorar.
5. **Nadie sabe exactamente cuánto sabe.** Cada uno tiene una creencia sobre su propia habilidad (y los demás también), con errores y sesgos de temperamento. Las decisiones usan la creencia; las resoluciones, la verdad.
6. **La práctica cuesta tiempo y el tiempo es finito.** Dominar un oficio lleva años. Lo que alguien sabe hacer es la huella de cómo pasó su vida, y por eso es biografía.

---

## 1. Qué es una habilidad

```ts
interface SkillDef {                          // content/skills/, validado con Zod
  id: SkillId;                                // "sword", "smithing", "persuasion", "swimming", "reading:<scriptId>", "herbalism"
  domain: SkillDomain;                        // combat | craft | social | body | study | language | esoteric | survival | arts
  facets: FacetKey[];                         // qué partes tiene (§2)
  usesCapabilities: Partial<Record<CapabilityKey, number>>;  // body-health §3: cuánto pesa cada capacidad en el techo y en la ejecución
  usesAptitudes: Partial<Record<AptitudeKey, number>>;       // npc-psychology §1: intellect, perception, willpower, memory; cultivation §3: comprehension
  tacitness: number;                          // 0..1: cuánto del dominio NO se puede transmitir como texto (forja ~0.8, contabilidad ~0.3)
  neighbors: Array<{ skill: SkillId; facet?: FacetKey; transfer: number; interference?: number }>;  // §8
  decay: { tacit: number; explicit: number }; // tasas de oxidación (§7)
  curve: LearningCurveParams;                 // forma de la curva (§4)
  repertoireKind?: RepertoireKind;            // qué tipo de piezas acumula: movimientos, recetas, fórmulas, cortesías, técnicas
}
```

- **Granularidad media con facetas.** Una habilidad es lo bastante amplia para que tenga sentido entrenarla ("espada", "herrería", "persuasión", "natación") y se parte en facetas y piezas de repertorio para el detalle. Del orden de 60 a 100 habilidades en total, más las lenguas y escrituras que genere cada mundo.
- **Las lenguas y las escrituras usan este modelo** con facetas propias (entender, hablar, acento, leer, escribir) y su contenido lo define [language.md](language.md).
- **Los oficios de crafts, los procesos de technology y las técnicas de cultivation** son habilidades de este modelo: sus estructuras (`CraftSkill`, `ProcessKnowledge`, `KnownTechnique`) son vistas de un `SkillState` (§10).

## 2. El estado de una habilidad en una persona

```ts
interface SkillState {
  holder: AgentId;
  skill: SkillId;
  facets: Record<FacetKey, FacetState>;      // §2.1
  repertoire: RepertoireEntry[];             // §2.2: piezas concretas que sabe hacer
  familiarity: Familiarity[];                // §2.3: con qué situaciones, herramientas, rivales y materiales está acostumbrado
  habits: Habit[];                           // §5: vicios y mañas, buenos o malos
  lineage: LineageEntry[];                   // de quién aprendió qué y cuándo (§6)
  lastPracticed: Tick;
  pressureExperience: number;                // cuánto practicó con algo en juego (§3.3)
}

interface FacetState {
  level: number;                             // nivel real actual (verdad)
  peak: number;                              // máximo alcanzado (para la recuperación rápida, §7)
  ceiling: number;                           // derivado (§4.2); no se guarda como dato libre, se recalcula
}
```

### 2.1 Facetas

Las facetas generalizan las de crafts (control, sentidos, juicio). Cada dominio usa las que le sirven:

| Faceta | Qué es | Ejemplo |
|---|---|---|
| `execution` | Precisión y fluidez de la mano o del cuerpo | El golpe que va donde se quiso; el trazo firme del talismán |
| `reading` | Percibir el estado de la tarea o del rival mientras se hace | Ver que el rival va a fintar; oír que el metal está listo |
| `judgment` | Saber qué hacer con lo que se lee, corregir a tiempo | Cambiar de guardia; bajar el fuego antes de que se agriete |
| `knowledge` | Saber explícito del dominio (creencias, §2.4) | Nombres de hierbas y sus usos; reglas de etiqueta; fórmulas |
| `endurance` | Sostener la tarea sin degradarse | Pelear media hora sin que caiga la técnica; regatear todo el día |
| `composure` | Rendir bajo presión, miedo o público | El examen ante el magistrado; el primer duelo a muerte |

### 2.2 Repertorio

Piezas discretas que se saben o no: un movimiento de un estilo, una receta, una fórmula de cortesía, un nudo, un poema memorizado, una técnica de cultivo. Cada una tiene su propio nivel de dominio y su versión (con los errores de quien la enseñó o del manual).

```ts
interface RepertoireEntry {
  piece: PieceRef;                           // MoveId | RecipeId | TechniqueId | TechProcessId | FormulaId…
  version: CopyRef;                          // la versión aprendida, con sus fallas
  understanding: number;                     // lo explícito: entiende el porqué
  proficiency: number;                       // lo tácito: lo ejecuta bien
  learnedAt: EventId;
}
```

### 2.3 Familiaridad

La habilidad general rinde menos en lo desconocido. Un herrero de hierro con bronce, un espadachín contra un estilo que nunca vio, un médico con una enfermedad nueva, un orador frente a una cultura ajena.

```ts
interface Familiarity {
  with: FamiliarityKey;                      // material:"bronze", opponentStyle:"<styleId>", terrain:"marsh", tool:"<itemClass>", culture:"<cultureId>"
  level: number;                             // 0..1, sube con la exposición percibida y se olvida
}
```

La familiaridad sube rápido y se pierde rápido. Es la parte de "acostumbrarse" que separa al veterano del talentoso recién llegado.

### 2.4 El saber explícito es creencia

La faceta `knowledge` no es un número suelto: es el conjunto de creencias (information §1) del actor sobre el dominio, con su confianza y su fuente. "El ginseng de cien años cura la fiebre de invierno" puede ser falsa. El número de la faceta es una medida derivada de cuántas creencias útiles y correctas tiene, y se recalcula; las creencias equivocadas restan cuando se usan.

## 3. Cómo se aprende

### 3.1 Practicando

Cada vez que una acción usa una habilidad, su resolución (actions §7) deposita experiencia en las facetas que intervinieron:

```
Δfaceta = tasa(aptitudes, plasticidad(etapa))
        × feedback(lo percibido del resultado)
        × novedad(situación, familiaridad)
        × ajuste(dificultad − nivel)            // máximo cerca del borde: ni muy fácil ni imposible
        × foco(atención, fatiga, motivación)
        × (1 − nivel/techo)^k                    // rendimiento decreciente hacia el techo
```

- **El feedback sale de la autopercepción** (actions §7, paso 6). Si el actor percibe bien el resultado y su causa ("se me abrió la guardia porque bajé el codo"), aprende mucho; si solo percibe "salió mal", aprende poco. Si cree que salió bien y no (`failure_unnoticed`), aprende lo equivocado (§5).
- **Fracasar entendiendo enseña más que acertar sin entender**, como en crafts §1.
- **La práctica deliberada rinde más que la rutina.** Hacer lo mismo de la misma forma tiene novedad casi cero: el campesino que ara treinta años es bueno arando pero dejó de mejorar a los cinco. Buscar la dificultad justa (el verbo `train`, un maestro que plantea ejercicios) mantiene el aprendizaje.
- **El sueño consolida** (npc-psychology §15): parte de lo practicado en el día se fija esa noche. Dormir mal reduce lo que queda.

### 3.2 Mirando

Mirar a alguien hacer algo (perception) deposita experiencia en `reading` y `knowledge`, y un poco en `execution` si el que mira ya tiene base. Cuánto se aprende depende de qué se percibió: un aprendiz ve el gesto, un maestro ve el porqué. Así se roban técnicas en un duelo y se aprende un oficio desde la puerta del taller.

### 3.3 Con algo en juego

Practicar sin riesgo y hacer con riesgo no son lo mismo. `composure` y `pressureExperience` solo suben con presión real (un duelo, una venta grande, un examen, una operación difícil). El que entrenó años sin pelear de verdad rinde menos en su primer combate real, según su temperamento.

### 3.4 Con un maestro

```ts
interface TeachingSession {
  teacher: AgentId;
  student: AgentId;
  skill: SkillId;
  method: "demonstrate" | "correct" | "explain" | "drill" | "spar" | "assign";
  pieces?: PieceRef[];
  duration: Duration;
}
```

- **Demostrar** da percepts de calidad (aprendizaje por mirar, §3.2, con el maestro mostrando lo importante).
- **Corregir** es lo que más vale: el maestro percibe el error del alumno (con su `reading`) y se lo marca. El feedback del alumno pasa a ser el del maestro, que ve más. Corregir pronto evita los vicios.
- **Explicar** transmite saber explícito (creencias), con la fidelidad del maestro y la comprensión del alumno, y en la lengua que comparten.
- **Ejercitar** plantea la dificultad justa: mantiene el aprendizaje en el borde.
- **Combatir con el alumno** da presión moderada y familiaridad con el estilo del maestro.
- **Asignar tareas** es práctica supervisada a distancia: barato para el maestro, más lento para el alumno.

**La calidad de un maestro** sale de su nivel en la habilidad, su habilidad de enseñar (que también es una habilidad social de este modelo, `teaching`), su paciencia y temperamento, y la relación con el alumno (organizations §9). Un genio que no sabe enseñar forma malos discípulos; un maestro mediocre con paciencia forma buenos artesanos.

**Enseñar cuesta.** Es tiempo del maestro (que deja de practicar o de producir), y por eso se paga con dinero, servicio, lealtad o contribución a la secta (organizations §9, contracts). Enseñar también le enseña al maestro (`judgment`, `knowledge`): al explicar descubre lo que no sabía que sabía.

### 3.5 Con libros y manuales

Un manual es un objeto con una versión del saber (crafts §9, cultivation §8, information §4):
- Da **saber explícito** con la fidelidad de esa copia y con los errores del autor y de los copistas.
- No da **saber tácito**: leer sobre la forja no forma la mano. Cuanto mayor es la `tacitness` de la habilidad, menos rinde un libro solo.
- Exige **saber leer** esa escritura y esa lengua, y entender el vocabulario técnico (la faceta `knowledge` del dominio). Un manual de alquimia avanzado es ilegible para un principiante aunque sepa leer.
- Con un manual y práctica, se aprende despacio y con riesgo (sin nadie que corrija). Con un manual y un maestro, el manual acelera la parte explícita.

### 3.6 Descubriendo

Experimentar e intuir (discovery) produce saber nuevo: una hipótesis confirmada se vuelve `knowledge`; un insight (cultivation §9) sube techos y facetas en todas las habilidades de ese aspecto. Las piezas de repertorio inventadas tienen `author` = el actor.

## 4. Velocidad y techo

### 4.1 La curva

La curva de cada habilidad (en `content/`) da cuánto cuesta cada tramo: rápido al principio, lento en la mitad, muy lento cerca del techo. Valores orientativos para una persona con talento promedio, práctica deliberada y buen maestro:

| Tramo | Qué se ve | Tiempo |
|---|---|---|
| Novato a competente | Hace el trabajo sin arruinarlo | Meses |
| Competente a oficial | Vive de eso; nadie se queja | 2 a 5 años |
| Oficial a maestro | Lo buscan; corrige a otros | 10 años o más |
| Maestro a gran maestro | Lo recuerdan; inventa | Una vida, y casi nadie llega |

Los cultivadores longevos rompen la escala de tiempo, no la curva: con siglos de práctica llegan a lo que ningún mortal puede, si su techo lo permite.

### 4.2 El techo

```
techo(faceta) = base(aptitudes ponderadas por usesAptitudes)
              × cuerpo(capacidades ponderadas por usesCapabilities)
              × edad(curva de la especie)
              × cultivo(umbrales, constitución, insights del aspecto)
```

- **Es verdad oculta.** Nadie lo ve; se intuye por la velocidad de mejora y por los estancamientos. Un maestro con buen `reading` lo estima mejor que el alumno ("este chico tiene mano").
- **Cambia con el cuerpo.** Perder dos dedos baja el techo de la espada y de la caligrafía de inmediato, y el nivel queda arriba del techo: decae hasta él con la práctica, más rápido al principio. La vejez baja los techos de `execution` y `endurance` y no los de `judgment` ni `knowledge`; por eso el viejo maestro pierde fuerza y gana astucia.
- **El cultivo lo sube.** Refinar el cuerpo, abrir meridianos y comprender aspectos de la ley sube los techos de las habilidades que dependen de eso (cultivation §11). Un mortal y un cultivador con la misma práctica no llegan al mismo lugar.
- **Los talentos estrechos existen.** El genoma (family-lineage §4) y la crianza dan aptitudes, y las habilidades las ponderan distinto: alguien puede tener techo alto en música y bajo en espada.

## 5. Vicios y mañas

```ts
interface Habit {
  id: HabitId;
  skill: SkillId;
  facet: FacetKey;
  kind: "flaw" | "quirk" | "signature";
  effect: HabitEffect;                       // en qué situaciones resta (o suma), y cómo se ve
  strength: number;                          // cuánto está fijado
  originEventId: EventId;                    // la práctica sin corrección, el maestro con el mismo vicio, el accidente
  knownBy: Belief[];                         // quién sabe de él (el dueño puede no saberlo)
}
```

- **Los vicios nacen de practicar sin feedback correcto:** bajar el codo, apurar el fuego, mirar al suelo al mentir. Se fijan con la repetición y cuesta mucho más deshacerlos que no haberlos hecho. Un buen maestro los evita; uno malo los transmite (sus alumnos heredan sus vicios).
- **Se pueden ver y explotar:** un rival con buen `reading` detecta la guardia que se abre y espera ese momento; un comprador atento nota la duda del vendedor. Es información sobre la persona que circula (information): "el espadachín Lin baja la guardia después del tercer golpe".
- **Las mañas no son malas:** el gesto propio de un estilo, la firma de un herrero en su forma de templar (que permite reconocer su trabajo, deep-history), el ritmo de un narrador. Las `signature` hacen identificable el trabajo y la forma de pelear.
- **Deshacer un vicio** requiere que alguien lo perciba (el dueño o un maestro), práctica deliberada en contra y tiempo; mientras tanto el rendimiento baja.

## 6. Linajes, estilos y escuelas

- **Un estilo** (de espada, de caligrafía, de forja, de oratoria) es saber cultural: un conjunto de piezas de repertorio, un énfasis en ciertas facetas, mañas firma y familiaridades típicas. Vive en `content/` como plantilla por cultura y se modifica por la historia (deep-history, living-world).
- **El linaje de un saber** (quién le enseñó a quién) queda en `lineage`. Es la genealogía de un estilo y produce reputación ("discípulo de tercera generación del Maestro Gu"), legitimidad en las escuelas y transmisión de vicios y de errores de copia.
- **Las escuelas** (marciales, de oficio, de sectas) son organizaciones (organizations) cuyo bien central es su saber y sus maestros. Guardan secretos (piezas que solo se enseñan a internos), certifican (§9) y pelean por quién es el heredero verdadero de un estilo.
- **Estilos que se enfrentan:** pelear contra un estilo conocido da familiaridad; contra uno desconocido, sorpresa. Los estilos se roban mirando y se mezclan.

## 7. Olvido y oxidación

- **Lo tácito se oxida, lo explícito se olvida.** El nivel efectivo de cada faceta baja con el tiempo sin práctica (`decay.tacit`); las creencias del saber explícito se degradan con la memoria (npc-psychology §5, `decay.explicit`).
- **Recuperar es más rápido que aprender.** Con `peak` guardado, la práctica después de una pausa recupera hasta el pico mucho más rápido de lo que costó llegar ("es como andar en bicicleta"). Las habilidades muy tácitas y muy practicadas casi no se pierden; la familiaridad se pierde rápido.
- **El declive cognitivo** (npc-psychology) erosiona primero lo explícito y la memoria del repertorio; las mañas y los reflejos duran más.

## 8. Transferencia entre habilidades

- **Vecinas con peso:** saber espada ayuda con el sable (`transfer` 0.6), algo con la lanza (0.3); saber cocinar ayuda un poco con el fuego de la alquimia (faceta `execution` del fuego). La transferencia da un piso inicial y acelera el aprendizaje de la vecina.
- **Interferencia:** dos estilos con gestos opuestos se estorban (`interference`): el que aprendió un estilo de tierra tiene que desaprender para el de agua. La interferencia baja con el nivel (el maestro de ambos ya no los confunde).
- **Facetas generales:** `composure`, la lectura de personas y el estudio sistemático se transfieren entre dominios con poco peso. Una persona que domina un oficio aprende otro más rápido porque sabe aprender.

## 9. Saber cuánto sabe uno (y cuánto sabe el otro)

```ts
interface SkillBelief extends Belief {       // information §1
  about: AgentId;                            // uno mismo u otro
  skill: SkillId;
  estimate: { level: number; spread: number };
  ceilingGuess?: { level: number; spread: number };
  sources: Array<"own_results" | "observed" | "rumor" | "certification" | "teacher_said">;
}
```

- **La autoimagen sale de los resultados percibidos**, con sesgos del temperamento: el arrogante se sobreestima, el ansioso se subestima. El principiante que no sabe lo que no sabe se sobreestima más (su `reading` no alcanza para ver sus errores).
- **La opinión ajena sale de lo observado y de los rumores.** La reputación de habilidad viaja como cualquier creencia ("el mejor herrero del condado") y se infla o se pincha con hechos vistos.
- **Las decisiones usan estas creencias:** la utilidad (npc-psychology §7) estima la probabilidad de éxito con la autoimagen; un rival decide si pelear con lo que cree de vos. La resolución usa la verdad (actions §5): el que se creía mejor descubre que no lo es.
- **Esconder y aparentar habilidad** es posible: pelear por debajo del nivel propio, fingir torpeza, exagerar en público. Se resuelve como engaño (perception, information) contra el `reading` del que mira.

## 10. Vistas especializadas

Los sistemas que ya tenían su estructura la mantienen como vista de `SkillState`, para no duplicar estado:

| Estructura existente | Se calcula como |
|---|---|
| `CraftSkill` (crafts §1) | `control` = `execution`; `senses` = `reading`; `judgment` = `judgment`; `repertoire` = recetas del repertorio; `specialties` = familiaridad con clases de producto |
| `KnownTechnique` (cultivation §8) | entrada del repertorio de la habilidad esotérica correspondiente: `understanding` y `proficiency` |
| `ProcessKnowledge` (technology §2) | `fidelity` = fidelidad de la versión del repertorio; `skill` = facetas de la habilidad del oficio |
| `PopulationTech.meanSkill` | agregado de la distribución de habilidad de la ocupación (§13) |

## 11. En la resolución de acciones

La capacidad efectiva de actions §7 (paso 2) usa la habilidad así:

```
habilidadEfectiva(actor, skill, contexto) =
    combinación de facetas que pide el verbo (pesos del verbo en content/actions/)
  × familiaridad(contexto)                         // terreno, herramienta, material, estilo rival
  × repertorio(pieza usada, si la hay)
  × estado(fatiga → endurance, presión → composure, dolor, emoción)
  ± vicios y mañas que aplican a la situación
```

- **El verbo dice qué facetas pesan:** `strike` pesa `execution` y `reading`; `bargain` pesa `reading` y `judgment` de la habilidad social; `craft_step` pesa las tres de crafts.
- **Intentar sin saber** (actions §5) usa un piso: la transferencia de vecinas o nada, con mucho riesgo y mucho aprendizaje si sale (novedad máxima).

## 12. El jugador y el narrador

- **El jugador no ve números.** Ve la autoimagen de su personaje en palabras ("te sentís cómodo con la espada, pero los pies te traicionan cuando te apuran") y lo que otros le dijeron ("tu maestro dice que tenés mano para el fuego"). Si la autoimagen está equivocada, la ve equivocada.
- **El progreso se nota como se nota en la vida:** un día el corte sale limpio, el maestro deja de corregir algo, un cliente vuelve. El narrador lo cuenta cuando el personaje lo percibe.
- **Los vicios se descubren:** un rival que te gana siempre igual, un maestro que te lo marca, un fracaso que finalmente entendés.
- **El conocimiento real del jugador** (lo que el usuario sabe de herrería o de esgrima) no le da habilidad al personaje. Le puede dar ideas explícitas, que entran por discovery como hipótesis del personaje y se prueban como cualquier otra.
- **El inspector** muestra la verdad: niveles por faceta, techos, vicios, linaje y de dónde salió cada mejora (`why skill <agente> <habilidad>`).

## 13. Escala (LOD)

Con los tiers de simulation §4:
- **Tier 3-4:** `SkillState` completo con facetas, repertorio, familiaridades, vicios y linaje; aprendizaje por cada resolución.
- **Tier 2:** facetas y repertorio, sin familiaridades finas; el aprendizaje se acumula por tramo de rutina (una semana de trabajo es un depósito).
- **Tier 1 dormido:** la puesta al día (simulation §8) aplica la práctica de su rutina en forma cerrada (curva integrada por el tiempo dormido) más la oxidación de lo no practicado.
- **Tier 0 y agregados:** distribuciones de habilidad por ocupación, edad y escuela en cada asentamiento (media y dispersión por habilidad), que se mueven con la cantidad de maestros, aprendices y años de oficio. Son la fuente de `PopulationTech.meanSkill`.
- **Materialización** (simulation §6): al materializar a alguien, sus habilidades se muestrean de la distribución de su ocupación, edad y escuela, coherentes con su biografía sintetizada (de quién aprendió, cuántos años lleva) y con los hechos fijados ("el herrero que te hizo una buena espada" no puede materializarse torpe).

## 14. Implementación por fase

- **Fase 1:** `SkillDef` para las habilidades de los ~10 verbos; facetas `execution`, `reading`, `judgment`; aprendizaje por práctica desde la autopercepción con techo; habilidad en la resolución.
- **Fase 2:** autoimagen y opinión ajena como creencias (`SkillBelief`); el saber explícito como creencias del dominio; mirar y aprender.
- **Fase 3:** maestros y aprendices con métodos de enseñanza; manuales con tacitez; oxidación con pico; transferencia e interferencia; vicios; distribuciones por ocupación y puesta al día de dormidos; vistas de crafts y technology.
- **Fase 4:** técnicas de cultivo como repertorio; techos que suben con el cultivo; insights que mueven facetas; `composure` con presión real.
- **Fase 5:** muestreo coherente al materializar; distribuciones regionales.
- **Fase 6:** estilos y escuelas como organizaciones con secretos, linajes y certificaciones; robo de estilos.

## Implementación

**Hecho (Fase 1, Hito 1a, 2026-10-07) — `src/sim/skills/`:** habilidades de los verbos, techo, curva y aprender de lo percibido.
- `content/skills/core.json`: 8 habilidades (`wayfinding`, `observation`, `foraging`, `farming`, `conversation`, `brawling`, `bargaining`, `sleight`), todas con facetas `execution`/`reading`/`judgment`. Cada una tiene aptitudes (rasgos innatos con peso), capacidades del cuerpo que pesan en el techo, tacitez, curva (`rate` por hora, `k`) y `upbringing` opcional (desde qué edad, horas por año y cuán fácil es la tarea típica de un chico de la aldea). `catalog.ts` valida con Zod y `refs` hacia `traits`. `SkillCatalog` cruza con los verbos y falla al cargar si un verbo pide una faceta que su habilidad no tiene.
- En `content/actions/core.json` cada verbo nombra su habilidad, los pesos de facetas e `intensity`: cuántas horas de práctica vale una hora del verbo. Un golpe vale 60, robar 10 y comerciar 2. La contienda nombra la habilidad del otro: `strike` → `brawling` (lectura y mano), sigilo de `take` → `observation` (lectura).
- **Niveles** de 0 a 1 (~0,25 competente, ~0,5 oficial, ~0,75 maestro) en `SKILL_STATE` (`skills.state`, por agente), con `peak` y horas. En la tirada (`attempt.ts`) la habilidad entrenada suma `SKILL_SPAN = 2,5` desvíos por nivel al factor `skill`, además de la aptitud cruda. El otro de una contienda suma lo mismo con la suya.
- **Techo oculto** (`ceilingOf`), recalculado y nunca guardado. Es aptitud × cuerpo × edad:
  - Aptitud: `0,7 + 0,12·talento`, con talento = Σw·z/√Σw².
  - Cuerpo: Π capacidad^peso, solo para `execution`/`endurance`.
  - Edad (`ageFactor`): madura de los 3 a los 20 años. La mano baja 1,2 %/año después de los 40, la lectura 0,6 %/año después de los 55 y el juicio no baja.
  - Si el nivel quedó arriba del techo (perdió una mano, envejeció), la práctica lo baja hacia él (`OVER_CEILING_DECAY`). El pico queda.
- **Curva:** la forma cerrada de dL/dh = g·(1 − L/C)^k, con g = `rate` × talento (±25 %/desvío) × plasticidad de la edad (1,4 de chico, 1 a los 25, 0,6 a los 70) × feedback × ajuste. Un tramo largo da lo mismo que muchos cortos y nunca pasa el techo. Con práctica ideal da ~0,25 a las 1000 horas y ~0,55 a las 6000.
- **Aprender de lo percibido** (`learnFromAttempt`): el feedback sale solo de la autopercepción del `Attempt`.
  - Un fracaso entendido (con `cues` y no creído éxito) enseña 1, y ×1,4 a leer y a juzgar. Un fracaso no entendido enseña 0,5, uno sospechado 0,25 y uno no notado 0.
  - Un éxito enseña 0,6, un parcial notado 0,9 y un parcial creído éxito 0,3.
  - Faltar un requisito no es práctica.
  - **El borde:** el `Attempt` trae ahora `expected` (el margen sin ruido menos la oposición esperada) y `challengeFit` es una campana en `LEARNING_EDGE = 0,5` desvíos. La rutina fácil enseña cada vez menos y queda por debajo de la práctica en el borde.
  - Devuelve el `Skills` nuevo o `null`. **El turno lo escribe** con el evento del paso (`setComponent(SKILL_STATE, actor, …)`) y calcula `AttemptActor.skill`/`AttemptParty.skill` con `verbSkill`/`opposingSkill`. `resolve` no lo hace solo, porque actions no importa skills.
- **Siembra** (`upbringingSkills`, `seedSkills`): cada persona viva de la aldea practicó mes a mes, desde `fromAge`, con su talento, su plasticidad y su techo de cada edad. La tarea se vuelve más fácil a medida que mejora. Sin azar.
  - A los 15 años queda ~0,3 en lo cotidiano y a los 30 ~0,4. A los 60 llega a ~0,47 y a los 80 la mano baja.
  - Pelear y regatear quedan casi en cero si no se practican.
  - `seedSkills` se llama desde el armado de la vida (`game/life/create.ts`).
- **Autoimagen (Fase 2, 2026-10-08):** `selfimage.ts`, tabla `SELF_IMAGES` por agente y habilidad: estimación `{level, spread}`, muestras y fuente `own_results`. Cada paso la revisa con lo que el actor *cree* que pasó (`Attempt.believed`) contra la chance que esperaba (`RESULT_SWING`), más el sesgo de temperamento y de principiante (`selfBias`); la siembra la arranca en el nivel real más el sesgo (`seedSelfImages`). El panel `personaje` la muestra en palabras (`skillStandingOf`) y no las horas. Falta que las decisiones la usen, el saber explícito y mirar (ítems del ROADMAP).
- **Opinión ajena (Fase 2, 2026-10-09):** `opinion.ts`, tabla `OPINIONS` por quien opina (clave `about|skill`): `observeSkill` fusiona por precisión lo visto (nitidez = lo percibido × su lectura; ve el nivel *mostrado*, así la pose engaña), `hearSkill` lo oído (confianza, bocas, `slant`) y una sorpresa fuerte contra la fama la pincha; `reputationOf` agrega. `watchersLearn` la forma en cada espectador. Falta que viaje por conversación y que la usen `readRival` y la utilidad.
- **Mirar con percepción real (2026-10-09):** `watchersLearn` corre la fase de percepción (`perceive` con `actionStimulus`) para cada presente: distancia, paredes, luz, agudeza y atención; el gesto escondido emite menos. Lo aprendido y la opinión ajena salen de lo leído (`action` entero; solo `presence`, 30 %).
- **Pendiente:** mirar y maestros (Fases 2 y 3), vicios, oxidación con pico, transferencia, repertorio y familiaridades. La calibración (`LEARNING_WIDTH`, tasas, techos) sigue abierta: ítem de calibración del Hito 1c en el ROADMAP.

## Tests

- **Solo lo percibido enseña:** con el mismo resultado real, un actor que no percibió su error no aprende de él; uno que lo percibió sí.
- **Vicios:** practicar con `failure_unnoticed` repetido fija un `Habit` de tipo `flaw`; la misma práctica con un maestro que corrige no lo fija.
- **Techo:** ninguna cantidad de práctica sube una faceta por encima de su techo; perder una capacidad baja el techo y el nivel decae hacia él.
- **Rendimiento decreciente y rutina:** la misma tarea repetida sin novedad deja de subir el nivel; la práctica deliberada sigue subiendo.
- **Pico y recuperación:** después de una pausa larga, volver al pico cuesta menos práctica que la que costó alcanzarlo.
- **Manual vs maestro:** con una habilidad de tacitez alta, el manual solo sube `knowledge` y casi nada `execution`.
- **Transferencia:** un experto en espada aprende sable más rápido que un novato; dos estilos con interferencia se estorban en niveles bajos.
- **Autoimagen:** los sesgos de temperamento producen sobre y subestimación en la dirección esperada; las decisiones cambian con la autoimagen y la resolución no.
- **Agregado–individual:** la distribución de habilidad de una ocupación en agregado coincide, dentro de la tolerancia, con la de los individuos simulados en las mismas condiciones.
- **Determinismo:** misma práctica y mismo seed → mismos niveles y vicios.

## Decisiones tomadas en este borrador (revisables)

- **Un solo modelo** para combate, oficios, social, cuerpo, estudio, lenguas y técnicas, con las estructuras existentes como vistas.
- **Granularidad media con facetas**, repertorio y familiaridades; del orden de 60 a 100 habilidades más lenguas y escrituras.
- **Tácito y explícito separados:** lo explícito son creencias, lo tácito solo sale de practicar, mirar y ser corregido.
- **Aprendizaje desde la autopercepción**, con vicios cuando el feedback está equivocado.
- **Techo oculto** que sale de aptitudes, cuerpo, edad y cultivo.
- **Oxidación con pico** y recuperación rápida.
- **El jugador no ve números**, solo la autoimagen de su personaje y lo que otros le dicen; la verdad queda para el inspector (aprobado 2026-10-06).
- **Tiempos realistas** (meses para competente, años para vivir del oficio, décadas para maestro); la jugabilidad la dan los saltos y las rutinas, y el talento y el maestro pesan mucho (aprobado 2026-10-06).
- **Vicios activos desde la Fase 3** (aprobado 2026-10-06).
- **Lenguas y escrituras con este mismo modelo** y facetas propias; language.md define solo el contenido (aprobado 2026-10-06).

## Preguntas abiertas

- Calibración: tasas de aprendizaje y forma de las curvas por dominio; tiempos reales por tramo; oxidación tácita y explícita; pesos de transferencia e interferencia; fuerza de fijación de los vicios; tamaño de los sesgos de autoimagen; dispersión de las distribuciones por ocupación.

## Ampliación (2026-10-08): clases derivadas

Una "clase" u oficio (herrero, cocinero, mercader, mago, caballero) es una etiqueta derivada de lo que alguien hace y sabe, no una elección cerrada. Se muestra en el panel y se usa en reputación, gremios y estatus. Mundos con sistema visible (metaphysics) pueden otorgar clases formales; la lista incluye las de producción. Fase 3 (derivadas) y Fase 4 (otorgadas).
