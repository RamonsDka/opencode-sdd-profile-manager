# Auditoría técnica de referencia

Fecha: 7 de septiembre de 2026. Alcance: revisión de arquitectura, integración, interfaz, almacenamiento y semántica de borrado. No es una auditoría exhaustiva de seguridad de todos los plugins integrados en el repositorio.

## Fuentes y versiones fijadas

| Fuente primaria | Referencia examinada |
|---|---|
| [SDD Profile Manager](https://github.com/RamonsDka/opencode-sdd-profile-manager) | Commit `d209b489c6e2757f04968715ffb3d301738d2166`; package.json 2.1.0 |
| [OpenCode](https://github.com/anomalyco/opencode/tree/v1.18.29) | Tag v1.18.29, commit `16747470f976aca3d362ad730bcd3fe82ecc2c9a` |
| SDK y contrato TUI publicados | `@opencode-ai/plugin` y `@opencode-ai/sdk` 1.18.29 |
| OpenTUI usado para validación | core/solid/keymap 0.4.5; Solid 1.9.12 |
| [Documentación de plugins](https://opencode.ai/docs/plugins/) | Separación entre plugins del servidor y de interfaz |
| [Documentación CLI v2](https://opencode.ai/v2/docs/build/plugins/cli/) | Consultada para identificar una API diferente; no es la API de este paquete |
| [SQLite VACUUM](https://www.sqlite.org/lang_vacuum.html) | Semántica de compactación y necesidad de espacio temporal |

La lectura del código se hizo mediante clones Git públicos. El visor web no pudo abrir algunas páginas GitHub; esto no impidió revisar los archivos del repositorio ni probar el binario publicado.

## Qué se verificó en SDD Profile Manager

- `index.tsx`: exporta un módulo `{ id, tui }`; recibe la API del host, registra comandos, gestiona el ciclo de vida y aporta componentes Solid.
- `tsup.config.ts`: compila TSX con generación universal para OpenTUI y mantiene Solid/OpenTUI como dependencias del host. Esto evita empaquetar una segunda instancia del renderizador.
- `src/dialogs.tsx`: diálogos, selección, validación y operaciones sobre perfiles. Sirve para comprender el estilo de interacción, aunque concentra muchas responsabilidades en un solo archivo.
- `src/host-compat.ts`: adaptación de tamaños y contención de fallos de interfaz. Sus avisos distinguen una función opcional fallida de una acción central.
- `src/config.ts` y `src/profiles.ts`: separación de rutas y persistencia respecto a la interfaz.
- `src/plugins/registry.ts`: catálogo de componentes integrados; el paquete sirve como contenedor de herramientas con funciones diferentes.
- `plugins/suite-de-agentes/src/tui/`: interfaz dividida en pantallas, controlador y primitivas visuales; montaje de diálogos con ErrorBoundary, teclado y acciones de ratón.

**Lo que se adopta:** módulo TUI nativo, Solid/OpenTUI, comandos directos sin pedirle trabajo al modelo, dependencias del host, errores legibles y módulos separados.

**Lo que se mejora para este caso:** motor de reglas puro, plan revisable, respaldo antes del borrado, aislamiento del adaptador OpenCode, persistencia atómica, protección de familias y pruebas de comportamiento destructivo.

**Observación documental:** el package.json auditado declara 2.1.0 mientras partes del README y su tabla conservan 2.0.1. La versión del manifiesto y el código prevalecen sobre esos textos. No se asumió que todos los tests anunciados por su README se ejecutaron en esta auditoría.

## Correcciones a la propuesta SQL inicial

1. `opencode session list` y `opencode session delete <sessionID>` existen en 1.18.29. El listado CLI admite `--format json`; es un listado de raíces del contexto de proyecto, no un inventario universal completo de todas las sesiones hijas.
2. Para antigüedad se usa `time.updated`, mapeado a `time_updated`. `time_created` mediría cuándo nació el chat. La fecha de actualización es un proxy: cambios de metadatos también pueden alterarla; no equivale exclusivamente al último mensaje humano.
3. La tabla `session` de la versión examinada contiene campos de costo, tokens, agente y modelo. No se presupone que existan en todas las versiones históricas.
4. **El borrado de una fila session por SQL no equivale al borrado del host.** `parent_id` no tiene una clave foránea de cascada en el esquema examinado. `Session.remove()` recorre hijos y ejecuta la limpieza de eventos. Un DELETE masivo puede dejar hijos o saltarse trabajo del host aunque message/part tengan cascadas.
5. El endpoint global experimental pagina con un cursor temporal exclusivo. Una frontera con fechas iguales puede omitir registros. Session Vault aumenta el límite de una consulta completa, verifica su fin y rechaza inventarios parciales; no avanza con ese cursor.
6. `Session.remove()` captura algunos errores internamente. Por eso un HTTP correcto no basta: se comprueba después que la familia haya desaparecido.
7. Borrar datos puede dejar páginas libres dentro del archivo SQLite. VACUUM reconstruye la base; consume tiempo y espacio temporal. Se ofrece fuera de la TUI, con copia previa y OpenCode cerrado.
8. No se adopta `rm -rf tool-output/*`: salidas externas referenciadas por conversaciones conservadas pueden perderse. No se promete que esa carpeta se pueda vaciar sin consecuencias.

## Decisión de compatibilidad

OpenCode 1.x proporciona `TuiPluginModule`, `api.keymap.registerLayer`, `api.ui.dialog.replace` y SDK v2 de la rama 1.x. La documentación beta de OpenCode 2 muestra `Plugin.define`, `context.keymap.layer` y otros contratos. El sufijo `/v2` del SDK 1.x **no significa** que el plugin sea compatible con OpenCode 2.

El resultado es un plugin independiente que coexiste con SDD Profile Manager en `tui.json`. Añadir un acceso dentro de su menú interno requeriría modificar ese otro repositorio: no se hizo sin necesidad.
