# Historia profunda — simular por relevancia, no por años

> Problema planteado: algo de hace 100.000 años puede seguir afectando el mundo, mientras el resto de esa época no importa. Y hay cultivadores de 1.000 años vivos que sí hay que simular. No sirve "simular N años".

Estado: **borrador para discutir.**

---

## Idea: un embudo hacia el presente

La historia se simula **hacia adelante** (para respetar la causalidad), pero a una **resolución que crece a medida que nos acercamos al presente**. Al cerrar cada época, el mundo **olvida** todo lo que ya no tiene efecto.

```
   pasado profundo                                          presente
   ───────────────────────────────────────────────────────────────►
   [ eones ]  [ eras ]  [ milenios ]  [ siglos ]  [ décadas ]  [ días ]
    muy grueso ──────────── resolución creciente ─────────── individuos
         │          │           │           │           │
       olvido     olvido      olvido      olvido      olvido
```

El costo depende de **cuánto importa** cada época, no de cuántos años dura.

## Qué sobrevive entre épocas (los "legados")

Al cerrar una época, solo pasa a la siguiente lo que todavía **existe físicamente, vive o se recuerda**. Todo lo demás se compacta en un resumen sin detalle.

| Tipo de legado | Ejemplos | Cómo dura |
|---|---|---|
| **Geológico / metafísico** | Costa sumergida con sus ruinas, puente de tierra cerrado ([planet-gen.md](planet-gen.md) §8), cráter de una batalla de inmortales, vena de qi destrozada, sello sobre una bestia, cicatriz en el Cielo | Indefinidamente, se erosiona muy lento |
| **Objetos** | Ruinas, reinos secretos y lugares sellados ([secret-realms.md](secret-realms.md)), armas, manuscritos, arrays todavía activos, cadáveres de bestias antiguas | Se degradan con el tiempo; pueden destruirse o ser encontrados |
| **Seres longevos** | Cultivadores de 1.000 años, bestias antiguas, espíritus, almas selladas | **Se siguen simulando** como agentes Tier 3 a través de las épocas |
| **Conocimiento** | Técnicas, historia escrita, profecías | Mientras haya portadores o registros |
| **Cultura / memoria colectiva** | Leyendas (cada vez más distorsionadas), religiones, tabúes, odios ancestrales | Se transmite y se deforma |
| **Linajes** | Sangre de un ancestro poderoso, maldiciones, karma heredado | Se diluye por generación, puede reactivarse |
| **Estado del Cielo** | Su fuerza, sus heridas, su "memoria" de las rebeliones | Variable global de largo plazo |

Ejemplo: hace 100.000 años, una guerra entre inmortales y el Cielo. De toda esa era sobreviven solo tres cosas: el Cielo herido (que explica la era actual), un continente partido (geografía) y un sello en el fondo del mar (un objeto con un ser dentro). Los imperios, las personas y las ciudades de esa época se compactaron en "civilización X existió, cayó". Puede haber ruinas sueltas si su degradación todavía no terminó.

## Resolución según lo que se simula

- **Épocas profundas:** solo procesos planetarios y del Cielo, civilizaciones como bloques y los seres más poderosos. Pasos de siglos o milenios.
- **Épocas intermedias:** naciones, grandes sectas y linajes. Pasos de años o décadas. Personas solo si son Tier 3.
- **Últimos siglos:** organizaciones completas, asentamientos y familias importantes.
- **Últimas décadas:** población de la región inicial con individuos (lo que van a recordar los NPCs vivos).
- **Presente:** simulación completa alrededor del jugador.

Un ser longevo que vive en varias épocas **fuerza más resolución a su alrededor**. El maestro de 1.000 años necesita que su secta y sus enemigos tengan historia detallada; un imperio sin sobrevivientes no.

## Cuánto tiempo hacia atrás

No es fijo: lo decide el seed a partir de la cosmología, con cosas como la edad del planeta, cuándo apareció la vida inteligente y cuándo se descubrió el cultivo. Un mundo joven puede tener 5.000 años de historia relevante, y uno antiguo, cientos de miles (aunque casi todo compactado).

## Decisiones (2026-10-05)
- **El jugador no ve el pasado profundo directamente.** Solo lo descubre por legados (ruinas, leyendas, seres antiguos, textos) y a través de percepción e información, así que puede llegarle distorsionado o falso.
- **Criterio de olvido: puntaje de influencia.** Combina (a) cuántos agentes vivos lo recuerdan, (b) si existe algo físico (ruina, objeto, cuerpo, técnica escrita) y (c) cuánto karma sigue abierto. Un hecho se olvida entre épocas cuando los tres llegan a cero; los pesos se calibran con la sim headless.

## Preguntas abiertas
- Calibración de las reglas agregadas contra las individuales (ver causality.md §5.1): es trabajo técnico de la sim headless, no una decisión de diseño.
