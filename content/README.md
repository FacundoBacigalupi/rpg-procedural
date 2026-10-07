# content/

Datos del juego validados con Zod al cargar (verbos, bienes, biomas, culturas, lenguas, familias de mundo…). Nada de esto va hardcodeado en la lógica. Estructura prevista en [ARCHITECTURE.md](../docs/ARCHITECTURE.md) §2.

## Formato

- **Cada carpeta es un tipo de contenido**, declarado en el código con `defineContent("<carpeta>", esquema, refs)` (`src/core/schema`). Las carpetas anidadas valen como tipo (`families/xianxia/realms`); un archivo pertenece al tipo registrado más profundo de su ruta. Una carpeta sin tipo registrado es un error.
- **Cada `.json` es una lista de entradas**, y cada entrada tiene un `id` (minúsculas, dígitos, `-`, `_`, `.`) único dentro de su tipo. Cómo se reparten las entradas en archivos no importa. Lo que no es `.json` (como este README) se ignora.
- **Esquemas estrictos** (`z.strictObject`): una clave de más es un error, así un typo no pasa callado.
- **Referencias:** si una entrada nombra a otra (una receta que pide una hierba), el tipo lo declara en `refs` y una referencia rota impide arrancar. Todos los problemas se informan juntos, con archivo, índice y ruta.
- **Versión:** el hash canónico de todo el contenido validado es su versión (tooling §4) y entra en el replay.
