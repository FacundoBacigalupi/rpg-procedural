# Visión

Un simulador narrativo de fantasía procedural, con el xianxia como familia principal: cada mundo genera sus propias leyes (ver [metaphysics.md](systems/metaphysics.md)). Te ponen en el cuerpo de un mortal con un talento aleatorio en un mundo generado, y escribís libremente qué hacés. No hay misión principal: la pregunta es **¿qué vas a hacer con esta vida?** (inmortal, comerciante, alquimista, bandido, granjero, líder de secta… o morir a los 17 en una cueva).

Es para un solo jugador (el autor). Se prioriza profundidad y realismo sobre diversión "de juego"; está bien que sea lento.

## Pilares
1. **Texto libre → simulación → narración.** El jugador escribe una intención; el LLM la convierte en acciones estructuradas; el simulador las resuelve con probabilidades sobre muchas variables; el LLM narra los eventos resultantes.
2. **Mundo con historia causal.** Se genera la historia, no solo el mapa: seed → cosmología → leyes espirituales → geografía → recursos → civilizaciones → sistemas de cultivo → historia (guerras, migraciones, desastres) → naciones → sectas/clanes → asentamientos → familias → NPCs. Una ruina existe porque hubo una guerra.
3. **Eras distintas por partida.** Variables como densidad espiritual, conocimiento de cultivo, edad de la civilización, estabilidad política. Un mundo puede tener como máximo Qi Gathering 8 y otro tener inmortales y sectas milenarias. Los reinos de cultivo también pueden ser procedurales (meridianos, cuerpo, alma, híbridos).
4. **NPCs psicológicamente profundos.**
   - Rasgos innatos (inteligencia, empatía, impulsividad, ambición, orgullo, miedo, codicia, paciencia…) = predisposición.
   - Rasgos adquiridos por su vida (padres, pobreza, traumas, círculos sociales) → desconfianza, protección de familia, odio a bandidos…
   - Relaciones multidimensionales: confianza, respeto, afecto, miedo, atracción, deuda, gratitud, celos, resentimiento, familiaridad, dependencia.
   - Memoria de **eventos** (con intensidad emocional, confianza, degradación, posibles errores) → rumores, mentiras, propaganda.
   - Motivaciones en capas (inmediatas, corto, medio, largo plazo, núcleo) que compiten; se decide por utilidad (valor del objetivo × compatibilidad con personalidad × probabilidad de éxito × recompensa − riesgo − resistencia moral − costo).
5. **Información limitada.** Verdad del mundo ≠ lo que sabe cada NPC (p.ej. creen que sos Qi Gathering 9 con 60% de confianza). Permite engaño, secretos, espionaje.
6. **El mundo vive sin vos.** NPCs y organizaciones actúan offscreen: el discípulo humillado puede vengarse, olvidarte o morir antes. Tesoros pueden ser encontrados por otros. El "protagonista Xianxia" puede existir y no ser vos.
7. **Resultados con matices.** No éxito/fallo: éxito, éxito parcial, fallo, fallo sin detección, fallo con sospecha, descubierto, consecuencia crítica.
8. **Una sola vida.** Sin load. Morir puede no ser el final: si las circunstancias lo permiten, quedás como espíritu (ver [spirits.md](systems/spirits.md)). Cuando tu alma cruza al ciclo o se disipa: crónica (`Li Wei, 16–53, Mortal → Core Formation, fundador de la Escuela del Río Negro, murió en el asedio de Yunshan`) y nuevo mundo. **Cruzar siempre es el final:** no hay "continuar" gratis; seguir en otro cuerpo es un poder que se gana en vida ([cultivation.md](systems/cultivation.md) §14), y para un cultivador cruzar cuesta caro, porque el Cielo cobra en las Fuentes lo que le robó ([heaven-karma.md](systems/heaven-karma.md)).
9. **Talento oculto.** Stats generados por el seed, no elegidos. Algunos ocultos (suerte, constituciones raras) que se descubren jugando.

10. **Lo que el usuario aprendió en otras partidas no es un truco.** Entre partidas no hay recetas que repetir:
    - **Cada mundo tiene sus propias leyes, y varían mucho.** No solo el contenido (reinos, técnicas, hierbas) sino la metafísica entera: de dónde sale el poder, cómo se usa, qué cuesta, si hay un Cielo, dioses o nada. Un mundo puede ser xianxia clásico y otro uno de magia y espadas occidental. Ver [metaphysics.md](systems/metaphysics.md).
    - **No hay disparadores secretos.** Ninguna acción concreta ("hacer esta maniobra") desbloquea algo. El progreso es continuo y sale de simular cuerpo, qi y aprendizaje. Si entrenar de cierta forma ayuda, es porque tiene sentido en la física de ese mundo, y entender cómo funciona el mundo es habilidad legítima del usuario, como en el ajedrez.
    - **Experimentar cuesta.** Probar cosas a ciegas (maniobras, respiraciones, mezclas, rituales) gasta tiempo y tiene riesgo real según el mundo: lesiones, desviación de energía, envenenamiento, locura. Repetir lo de otra partida sin que tenga sentido en esta es caro.
    - **Los talentos se descubren, no se crean.** Los talentos ocultos se generan al nacer. El entrenamiento puede revelar uno que ya tenías, nunca producir uno que no tenés.
    - **Las técnicas vienen de una fuente.** Describir en texto una técnica de otra partida no te la da: el parser traduce a acciones del catálogo y la IA nunca crea técnicas ni habilidades. Inventar una técnica propia es posible, pero lo resuelve la sim con la comprensión, la experiencia y el tiempo del personaje, no con lo detallada que sea tu descripción.

11. **Dos modos de juego: realista y novela** (pedido 2026-10-06; diseño en [game-modes.md] futuro, ROADMAP #35). Todo lo de arriba es el **modo realista**, que es el de por defecto. El **modo novela** se elige antes de empezar y permite jugar como en una novela de cultivo: decidir cosas del personaje (familia, lugar, talento, rasgos) y sumarle **dedos de oro** (金手指) configurables, como un sistema que muestra stats o una alquimia que nunca falla. Relaja los principios 8 a 10 para esa partida, pero no las reglas del motor: el dedo de oro es una entidad del mundo con origen y efectos que aplica la simulación (determinista, con causas, con conservación), el LLM sigue sin decidir nada, la verdad sigue separada de las creencias y el mundo sigue sin girar alrededor del jugador salvo en lo que el dedo de oro haga explícitamente. La partida queda marcada como novela en el archivo de vidas.

## Escala
- **Tiempo dinámico:** combate en segundos, conversación en minutos, viaje en horas/días, entrenamiento en meses, cultivo en años, historia en siglos.
- **Niveles de simulación (LOD) de NPCs:**
  - Tier 0 — población estadística (una aldea lejana es "438 habitantes").
  - Tier 1 — NPC generado al acercarse, coherente con la estadística.
  - Tier 2 — NPC activo en la zona del jugador.
  - Tier 3 — NPC importante (líderes, genios, cultivadores fuertes), siempre simulado.
  - Tier 4 — NPC conectado al jugador (persistente, máxima resolución).
  - Asignación, zonas de resolución y materialización: [systems/simulation.md](systems/simulation.md).
  - Un NPC con el que interactuás nunca vuelve a desaparecer.

## Ejemplo de inicio
> Año 314 del Calendario de la Grulla Celestial. Sos **Li Wei**, 16 años, hijo de cazadores de la aldea de Qingshui. Talento espiritual: bajo. Afinidad: Agua 63%, Madera 21%. Era de recuperación espiritual; el cultivador más fuerte de la región está en Foundation Establishment. Tu familia debe 14 taels a los Zhao; tu padre está herido. Rumor: la Secta del Río Sereno toma pruebas en seis meses.
>
> **¿Qué hacés?**
