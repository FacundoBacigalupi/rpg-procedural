# Bucle del jugador

> Principio: **el personaje del jugador es un agente más del mundo**: nace de padres simulados, tiene cuerpo, creencias, temperamento y memoria como cualquier NPC, y el mundo lo trata igual. Lo único distinto es de dónde salen sus decisiones: del texto del usuario en vez de la utilidad. El bucle del jugador es el puente: cuándo se le pregunta al usuario, cuánto tiempo pasa entre preguntas, qué lo despierta y qué ve.

> Estado: **borrador** (2026-10-06).

Depende de: [simulation.md](simulation.md) §3, §12 (`advanceUntil`, modos de avance), [actions.md](actions.md) (planes, posturas, parser), [narration.md](narration.md) (vista del jugador, modos de narración), [perception.md](perception.md) (interrupciones por lo que percibe), [npc-psychology.md](npc-psychology.md) (utilidad, objetivos, etapas de vida, memoria), [family-lineage.md](family-lineage.md) §13 (nacer en una familia), [information.md](information.md) §5, §10 (mapa y diario de creencias), [discovery.md](discovery.md) (diario de hipótesis), [contracts.md](contracts.md) (libro de deudas y promesas), [spirits.md](spirits.md) §0, §3c-§3e (morir, ser espíritu, cruzar), [chronicle.md](chronicle.md) (crónica, epílogo, archivo).
Lo usan: [tooling.md](tooling.md) (guardado, replay, inspector), la UI (CLI en Fase 1, web en Fase 9).

---

## Principios

1. **Mismo agente, otra fuente de decisiones.** Todo proceso que corre para un NPC corre para el personaje del jugador: cuerpo, percepción, memoria, emociones, relaciones. Las decisiones grandes las toma el usuario; las chicas, cuando el usuario delega, las toma la utilidad del propio personaje con su temperamento.
2. **El mundo no corre mientras el usuario piensa.** El tiempo avanza solo cuando el personaje hace algo (una acción, una rutina, esperar).
3. **Nada lo despierta si no lo percibe.** Las interrupciones son percepts del personaje (alguien le habla, oye un grito, le llega una carta), nunca el conocimiento del motor. Un cultivador encerrado no se entera de que atacaron su secta salvo que algo se lo haga saber.
4. **Todo lo que el usuario ve es creencia del personaje.** Paneles, mapas, inventario y relaciones muestran lo que él cree, con su incertidumbre y su antigüedad.
5. **Una sola vida, sin volver atrás.** Se guarda siempre; no hay cargar una partida anterior. Morir puede no ser el final (spirits); cruzar siempre lo es.
6. **El usuario no es el personaje.** Los comandos fuera del personaje (`meta`) no tocan el mundo, y lo que el usuario sabe no le da nada al personaje (VISION, principio 10).

---

## 1. Empezar una partida

La forma canónica de `NewGameSetup` está en [game-modes.md](game-modes.md) §1 (ARCHITECTURE §6): `seed`, `worldConstraints` (solo sobre el mundo: familia, era, ejes; nunca sobre el personaje), `mode` (`"realistic" | "novel"`, §16), `novel` (solo en modo novela), `entry` (§2), `narration: NarrationPrefs` (narration §7) y `llm: LlmConfig` (narration §1).

1. **Generar el mundo:** planeta, leyes, historia profunda corrida en modo agregado hasta el presente (simulation §16). El usuario ve el progreso por épocas, sin spoilers (solo "se forman las montañas", "surgen los primeros pueblos", "pasan 3.000 años").
2. **Elegir el nacimiento** (modo realista; el modo novela en §16): el personaje es **una persona que nace en el mundo simulado**, no un molde que se pone encima. Se elige un nacimiento real de la simulación con el rng de la partida, con un peso que refleja la población (la mayoría nace mortal, en una aldea, pobre). El usuario no elige familia, talento, lugar ni rasgos (VISION, principios 3 y 9).
3. **El personaje pasa a tier 4** desde el nacimiento y su zona a resolución de escena; el resto del mundo sigue su LOD.

## 2. Infancia y punto de entrada

```ts
type EntryMode =
  | { kind: "born"; vignettesFrom: Age }     // nacer y jugar la infancia en viñetas desde cierta edad
  | { kind: "age"; at: Age };                // entrar a una edad: la infancia se simula con el personaje como NPC
```

- **Los primeros años** (hasta ~4-5) son siempre un montaje: el bebé no toma decisiones que el usuario pueda escribir. La sim los corre completos (crianza, enfermedades, mudanzas, la familia que cambia) y quedan como pocas memorias muy deformadas.
- **Viñetas de infancia** (`born`): desde `vignettesFrom`, el tiempo avanza rápido (meses o un año por salto) y se detiene en **momentos de los períodos sensibles** (npc-psychology): una pelea con otro chico, un adulto que ofrece enseñar algo, una pérdida, una injusticia, la primera vez que ve a un cultivador. El usuario decide en esos momentos; entre medio, el chico vive con su propia utilidad. Lo que pasa en la infancia forma lo adquirido (esquemas, miedos, apegos) como a cualquier NPC.
- **Entrar a una edad** (`age`): la infancia corre con el personaje como NPC (su temperamento decide), y al llegar a la edad el usuario toma el control con lo que el personaje recuerda: un resumen desde **sus memorias** (deformadas, con huecos), no desde la verdad.
- **La escena de entrada** es como la de VISION: quién es, dónde está, su familia, lo que debe, lo que se rumorea; todo como creencia del personaje. Después: **¿qué hacés?**

## 3. El turno

```
usuario escribe
  → parser (narration §10) → IntentDraft
  → la sim resuelve referencias y factibilidad creída (actions §4, §5)
  → ¿hace falta confirmar? (ambigüedad, acto grave, partes sin mapear) → pregunta dentro del mundo
  → el plan entra al agente del personaje
  → advanceUntil(fin del plan, interrupciones)                     (simulation §3)
  → buildPlayerView → narración (narration §5)
  → usuario escribe
```

- **Un turno termina** cuando el plan del personaje termina, se interrumpe o llega a un punto donde hace falta decidir (alguien le habla, una bifurcación que el plan no cubría).
- **Planes con condiciones** (actions §3): "espero en la posada hasta que llegue el mercader; si no llega antes de la noche, me voy a dormir" es un solo turno largo.
- **Posturas** (actions, aprobado 2026-10-06): reglas permanentes del usuario ("si alguien me ataca, me defiendo y busco huir"; "no acepto pedidos de desconocidos") que actúan sin preguntar.

## 4. Ritmo: escena, día, estación, años

El usuario decide la escala con lo que escribe; la narración sigue (narration §7):

| Escala | Ejemplo | Qué avanza por turno | Modo de narración |
|---|---|---|---|
| Momento | una pelea, una charla | segundos a minutos | `action`, `dialogue` |
| Escena | explorar una cueva, regatear | minutos a horas | `scene` |
| Día | "trabajo en el campo y a la tarde voy al mercado" | horas | `scene` con elipsis |
| Rutina | "cultivo en la cueva hasta la primavera" | días a años | `montage` |

- **El paso de una escala a otra** lo marca el texto del usuario o una interrupción (de un montaje se cae a escena cuando pasa algo).
- **El tiempo siempre se anuncia** en la narración ("pasan tres semanas"), con el calendario que conoce el personaje.

## 5. Saltar tiempo con rutinas

```ts
interface Routine {
  policy: RoutinePolicy;                     // qué hace y cuándo: horario, actividades, prioridades (un ActionPlan repeat con alternativas)
  until: Tick | Condition;                   // "hasta la primavera", "hasta que se termine el arroz", "hasta romper el umbral"
  interrupts: InterruptRule[];               // las del usuario, además de las fijas (§6)
  delegation: DelegationLevel;               // qué decisiones chicas toma el personaje solo (§7)
}
```

- **Una rutina es una política del agente del personaje** que el scheduler ejecuta con `advanceUntil`. El mundo sigue al mismo ritmo para todos.
- **Lo que consume es real:** comida, dinero, salud, relaciones (una rutina que ignora a la familia la desgasta). Si algo de la rutina se vuelve imposible (se termina la comida, cierra la herrería), la rutina se interrumpe o se adapta según la delegación.
- **Al terminar o interrumpirse,** se narra un montaje con lo que el personaje vivió y percibió, y se ofrece **"qué pasó mientras"**: la lista de cosas que el personaje se enteró en ese tiempo (rumores, cambios de precio, cartas), con su fuente.
- **Encierros largos** (cultivo de años o décadas): igual, con zona de resolución baja alrededor del personaje (simulation §4) y el mundo corriendo en agregado. Lo que pasa afuera llega solo por lo que el personaje percibe o arregló para percibir (un discípulo que le avisa, una formación de alarma, una ficha de jade que se rompe si su maestro muere).

## 6. Interrupciones

```ts
interface InterruptRule {
  when: PerceptPattern;                      // sobre percepts y creencias del personaje, nunca sobre la verdad
  action: "stop" | "ask" | "note";           // detener, preguntar sin detener del todo, o anotar para el resumen
}
```

**Fijas (no se pueden apagar):** amenaza a la vida percibida (ataque, fuego, derrumbe), alguien le habla en persona, dolor o enfermedad que el personaje nota como grave, la muerte de alguien cercano de la que se entera, una decisión que la delegación no cubre (§7).

**Del usuario (configurables):** llega una carta o un mensajero, aparece alguien de su lista (un tier 4), percibe algo ligado a sus metas (§8), cambia algo de lo que cuida (precio del arroz, su campo, su casa), un rumor sobre un tema.

- **Las reglas leen percepts,** así que dependen de los sentidos y la atención del personaje: una carta que el personaje no ve no lo despierta.
- **Rutinas con muchas interrupciones** no se vuelven inútiles: `note` deja anotado sin detener.

## 7. Delegación: el personaje decide solo lo chico

Durante rutinas y planes largos aparecen decisiones que el plan no cubre: un vecino pide ayuda, un mercader ofrece algo, un chico lo insulta.
- **Lo chico lo decide el personaje** con su propia utilidad, como un NPC (su temperamento, sus valores, sus posturas). Queda anotado en el resumen ("le prestaste dos monedas a la vecina").
- **Lo grande interrumpe siempre:** compromisos (prometer, casarse, aceptar un maestro), violencia, gastos grandes, irse del lugar, cualquier acto que la sim marca como grave (actions §9).
- **El nivel de delegación** lo elige el usuario: `minimal` (casi todo interrumpe), `normal`, `wide` (solo lo grave interrumpe).

## 8. Metas del personaje

```ts
interface PlayerGoal {
  text: string;                              // lo que escribió el usuario ("quiero entrar a una secta")
  parsed: GoalSketch;                        // tipo de objetivo de npc-psychology (poder, riqueza, venganza, conocimiento, familia…), con referencias
  setAt: Tick;
  status: "active" | "abandoned" | "achieved_believed";   // "creída lograda": el personaje cree haberla cumplido
}
```

- **Las metas son del personaje,** no misiones del juego: no hay marcadores, pasos sugeridos ni recompensas. Entran a sus objetivos como los de cualquier NPC.
- **Sirven para:** la atención del personaje (perception: lo que le importa lo nota más), las interrupciones (§6), la delegación (decide lo chico a favor de sus metas), el diario y la crónica ("quería entrar a una secta; nunca lo logró").
- **Cambian** cuando el usuario las cambia; el personaje también puede ganar objetivos propios por lo que le pasa (un trauma, una deuda) que aparecen en su panel como "lo que sentís que tenés que hacer".

## 9. Lo que ve el usuario

Paneles (en CLI, comandos; en la web, pestañas). **Ninguno muestra números de la verdad** (skills, aprobado 2026-10-06):
- **El personaje:** cuerpo como lo siente (heridas, cansancio, hambre), emociones que reconoce, cómo cree que es su habilidad en cada cosa (autoimagen, skills §9), su cultivo como lo percibe.
- **Diario de creencias** (information §10) y **diario de hipótesis** (discovery): qué cree, con confianza, fuente y fecha.
- **Personas:** quiénes conoce, cómo los nombra, qué cree de ellos, cómo cree que está la relación.
- **Libro de deudas y promesas** (contracts): lo que debe, le deben y prometió, como él lo recuerda.
- **Inventario creído:** lo que cree tener y dónde; si le robaron sin que se diera cuenta, sigue figurando hasta que lo revisa.
- **Mapa creído** (information §5): lugares que conoce o le contaron, con errores.
- **Planes, rutinas, posturas y metas** en curso.
- **Bitácora:** el texto ya narrado, para releer. No agrega información (narration §14).
- **Notas del usuario:** texto libre fuera del mundo; el personaje no las sabe.

## 10. Comandos fuera del personaje

| Comando | Qué hace |
|---|---|
| `salir` | guarda y cierra; no hay cargar otra partida |
| `resumen` | resumen de lo último, armado con la memoria de narración y las memorias del personaje |
| `qué sé de X` | consulta el diario de creencias del personaje sobre X |
| `más detalle` / `más breve` | preferencias de narración (narration, aprobado 2026-10-06) |
| `interrupciones`, `delegación`, `posturas` | ver y editar las reglas |
| `ayuda` | cómo se escribe, qué comandos hay; nunca qué conviene hacer |
| `inspector` | el modo dios de tooling.md (§11) |
| `me gustó` / `no me gustó` | marca el último texto narrado para el corpus del fine-tune ([tooling.md](tooling.md) §10, aprobado 2026-10-06) |
| `restaurar` | recupera una copia de respaldo, con confirmación y marca "restaurada" ([tooling.md](tooling.md) §13) |
| `abandonar` | termina la vida sin morir: se archiva como "vida sin terminar" con crónica parcial |

## 11. El inspector durante la partida

El inspector (tooling.md) ve la verdad. Es una herramienta del autor para revisar la simulación, y usarlo con una vida en curso arruina la información limitada. Se puede abrir, con una confirmación, y la vida queda marcada en el archivo como "vista con inspector". La marca vale **también en modo novela** (aprobado 2026-10-06): las ventajas del personaje no son saber la verdad.

## 12. Sesiones y guardado

- **Guardado automático** después de cada turno (estado + log de planes validados). No hay ranuras ni cargar atrás.
- **Al volver,** la sesión arranca con un recuento corto: dónde está el personaje, qué estaba haciendo, lo último que pasó, desde sus memorias.
- **Si algo falla** (corte de luz, error), se recupera el último turno guardado; el replay desde seed y planes (tooling) es para depurar, no para jugar de nuevo.

## 13. Morir, ser espíritu y cruzar

1. **El momento de la muerte** se narra con los últimos percepts del personaje (narration `aftermath` o `action`): lo que vio, sintió y oyó, y nada que no supiera.
2. **¿Queda como espíritu?** La sim evalúa las condiciones de spirits §0. Si se cumplen, el bucle sigue con el personaje como espíritu: otras capacidades, otros sentidos, el mismo bucle (spirits §3c).
3. **Seguir en otro cuerpo** solo si lo ganó en vida (cultivation §14, spirits §3e): el bucle sigue con el cuerpo nuevo.
4. **Cruzar las Fuentes o disiparse** termina la partida: una escena breve del cruce y del cobro como la percibe el alma, y después la crónica (chronicle §3-§6), el epílogo (§7) y el archivo de vidas (§9).
5. **Después:** volver al menú para un mundo nuevo.

## 14. Escala (LOD)

- El personaje es tier 4 siempre; su zona está en resolución de escena cuando actúa y baja cuando salta tiempo (simulation §4, §12).
- Las rutinas largas no simulan cada minuto del personaje: se resuelven por tramos (un día de trabajo, una semana de cultivo) salvo que algo interrumpa.
- Los NPCs ligados al personaje (familia, maestro, rivales) siguen siendo tier 4 aunque él esté encerrado.

## 15. Implementación por fase

- **Fase 0:** loop CLI con stub: leer, parsear a mano, avanzar, imprimir. **Hecho** (`src/game/stub/`, `src/ui/cli/`): el plan entra al personaje como componente `intent` más un ítem agendado para cuando termina (la forma en que el replay también lo aplica: enviar en su tick y avanzar); solo las esperas se interrumpen, cuando alguien se mete con el personaje; cada turno se guarda entero (plan + estado) y deja un snapshot con su hash como checkpoint. Todo lo del stub (aldea, verbos, etiquetas `aldeano N`) se reemplaza en la Fase 1.
- **Fase 1:** **hecho el mínimo** (`src/game/life/`, `src/ui/cli/`).
  - **Entrada y turno:** el personaje entra por edad (`age`, 14-16 años) desde la pre-corrida. `Life.turn` mete el plan como el componente `life.plan` y el proceso `life.act` ejecuta hoja por hoja; cada hoja agenda la siguiente al terminar la anterior.
  - **Interrupciones fijas** (`interrupts.ts`, §6), siempre desde percepts: un golpe lo siente siempre; que le hablen o la muerte de alguien cercano, solo si perception dice que lo vio u oyó; un signo grave nuevo del cuerpo lo nota por `bodySigns`. Las configurables quedan para la Fase 3.
  - **Guardado:** se guarda cada turno sin cargar atrás, y el replay da el mismo hash.
  - **Paneles** (`panels.ts`, §9): personaje (cuerpo como signos, gente por relación, habilidades por cuánto las practicó), inventario creído (a ojo; hasta la Fase 2 es lo que tiene, redondeado) y bitácora (tabla `narration`).
  - **La gente de la aldea** sigue una rutina fija (`routine.ts`: duerme, trabaja en el campo, come de la despensa con su asiento), que reemplaza la decisión de los NPC hasta la Fase 2. El personaje no tiene rutina: decide.
  - **Falta:** el parser y el narrador con el modelo local en la CLI, planes con `until` desde texto libre y la muerte con crónica mínima (Hito 1c).
- **Fase 2:** diario de creencias e hipótesis, personas, libro de deudas y promesas, `qué sé de X`, recuento al volver.
- **Fase 3:** rutinas con delegación, interrupciones configurables, montaje y "qué pasó mientras", metas del personaje, viñetas de infancia (`born`).
- **Fase 4:** encierros largos de cultivo con alarmas arregladas en el mundo; espíritu como modo de juego.
- **Fase 7:** generación del mundo con progreso por épocas; elección del nacimiento desde la población histórica.
- **Fase 9:** UI web con paneles; archivo de vidas con marca de inspector.

## 16. Modo realista y modo novela

Todo este documento describe el **modo realista**, el de por defecto. El **modo novela** (VISION, principio 11; diseño completo en [game-modes.md](game-modes.md)) se elige en `NewGameSetup` y cambia solo el arranque y lo que el personaje trae:
- **Elecciones del personaje antes de empezar:** familia, lugar, talento, rasgos, edad de entrada. Se resuelven **eligiendo o forzando un nacimiento** que cumpla lo pedido dentro del mundo simulado (o, si no existe, fijando esos hechos en la generación con su propio evento de origen), nunca pegando un personaje sin historia.
- **Dedos de oro:** entidades del mundo con origen y efectos aplicados por la sim.
- **El bucle es el mismo:** turno, rutinas, interrupciones y paneles funcionan igual; un dedo de oro que "muestra stats" agrega un panel con la verdad que ese dedo de oro revela, y nada más.

## Tests

- **Mismo agente:** el personaje del jugador corre los mismos procesos que un NPC (un test lista los procesos de un NPC tier 4 y del jugador y deben coincidir).
- **Interrupciones desde percepts:** un evento que el personaje no percibe nunca interrumpe una rutina; el mismo evento percibido sí.
- **Delegación:** con `normal`, un pedido chico se resuelve con la utilidad del personaje; prometer o pelear siempre interrumpe.
- **Determinismo:** misma partida con los mismos planes validados → mismo mundo, sin importar el texto ni las pausas del usuario.
- **Sin vuelta atrás:** no hay API para cargar un estado anterior en modo juego.
- **Paneles sin verdad:** con un mundo de prueba lleno de secretos (un robo no notado, un padre falso, un veneno lento), ningún panel muestra la verdad.

## Decisiones (aprobado 2026-10-06)
- **Entrada por defecto:** nacer y jugar la infancia en viñetas desde los 5-6 años; entrar a una edad fija queda como opción.
- **Elegir el mundo:** seed por defecto, con parámetros opcionales solo sobre el mundo (familia metafísica, era, tamaño). En modo realista nunca sobre el personaje; en modo novela, sí (§16).
- **Inspector con una vida en curso:** se puede abrir con confirmación; la vida queda marcada como "vista con inspector".
- **Delegación por defecto `normal`:** lo chico lo decide el personaje con su carácter; prometer, pelear, gastar mucho o irse interrumpe. Configurable a `minimal` o `wide`.
- **Modo novela** como opción explícita antes de empezar (§16), con su propio doc.
- **De dónde sale el personaje en la Fase 1 (aprobado 2026-10-07):**
  - Es un nacimiento real de la pre-corrida de la aldea (family-lineage §Implementación): sus padres, abuelos y vecinos también tienen causa.
  - Se elige con rng entre los vivos de 14-16 años al empezar, para la entrada por edad.
  - La entrada por nacimiento con viñetas usa la misma pre-corrida y llega después.

## Decisiones tomadas en este borrador (revisables)

- **El personaje es un nacimiento real** de la población, elegido con rng y pesos realistas (en modo realista).
- **Interrupciones solo desde percepts,** con un núcleo fijo que no se apaga.
- **Delegación de lo chico** a la utilidad del propio personaje; lo grande siempre interrumpe.
- **Metas como objetivos del personaje,** sin marcadores ni recompensas.
- **Guardado automático y sin cargar atrás;** replay solo para depurar.
- **Inspector disponible con marca** en el archivo de vidas.

## Preguntas abiertas

- Calibración: largo de cada salto de las viñetas de infancia; qué cuenta como "grave" para la delegación; cuántos ítems tiene "qué pasó mientras"; cada cuánto se parte una rutina larga en tramos.
