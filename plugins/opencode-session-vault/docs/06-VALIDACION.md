# Informe de validación

Versión del paquete: 0.1.0. Fecha: 7 de septiembre de 2026.

## Entorno probado

Linux x64; Node.js 24.19.0; OpenCode 1.18.29, binario publicado `opencode-linux-x64`; Bun 1.4.2 para el renderizador de prueba; OpenTUI 0.4.5; Solid 1.9.12. Todas las operaciones destructivas se realizaron sobre datos sintéticos y directorios temporales aislados.

## Evidencia

| Comprobación | Resultado |
|---|---|
| `npm test` | 29 pruebas pasaron |
| `npm run typecheck` | Sin errores de TypeScript |
| `npm run build` | Bundle TUI y utilidades compiladas |
| Instalador precompilado | Registro local y dry-run comprobados |
| Conservación de configuración | JSONC, otros plugins, reinstalación y desinstalación verificados por pruebas |
| Renderizador OpenTUI real | Capturas y navegación de lista/perfiles/Mod/configuración/previa/candado |
| Terminal compacta | Distribución corregida y verificada a 80 × 30 |
| OpenCode TUI real | Comando `/session-vault`, ventana, configuración y regreso con Esc comprobados |
| API de OpenCode real | Inventario, estados, exportación y borrado de familias sintéticas |
| VACUUM offline sintético | 0,50 → 0,02 MiB, copia completa e integridad verificadas |
| Recuperación con CLI real | Importación del chat exportado y lectura de su mensaje original |

## Escenario de integración real

El script `scripts/integration.mjs` crea un entorno XDG temporal y un proyecto ficticio. Genera 14 sesiones principales y una hija, añade un mensaje sin ejecutar inferencia y cierra el servidor. Solo en esa base de prueba ajusta fechas para simular antigüedad, después reinicia el host.

Conserva una familia mediante candado y aplica Últimas 10. El resultado observado es **3 familias eliminadas y 11 sesiones principales conservadas**; la hija de una familia eliminada también desaparece. Se comprueba el respaldo de padre e hija y se importa el chat principal con `opencode import`. El contenido del mensaje se lee después por la API real.

El resultado estructurado se incluye en `assets/integration-result.json`. No se ensayó un turno real del modelo ni se utilizaron claves de proveedor.

## Cobertura relevante del motor

Actualización frente a creación; porcentajes 15/25/40; no erosión del cupo; candados fuera del cupo; protección por hija; propagación de actividad; estados ocupado/abierto/archivado; ámbito de proyecto; ciclos y padres ausentes; IDs duplicados; fechas inválidas; Mod y redondeo; empates; 10.000 sesiones; respaldo y lectura real desde disco; errores de copia; actividad durante el respaldo; modificación de candado tras la previa; sesión abierta después de la previa; exclusión mutua; estado corrupto; lote máximo; intervalo automático; cancelación al cerrar; hija nueva; borrado parcial.

## Alcance y pendientes

No se ejecutó el instalador `.cmd` en Windows nativo ni se probó macOS. Su lógica compartida y las rutas se revisaron; esto no sustituye una ejecución en esos sistemas. No se comprobó coexistencia ejecutando a la vez toda la suite SDD: se conserva su entrada y se evita modificar su código. No se validó OpenCode 2 ni versiones 1.x diferentes de 1.18.29.

La utilidad VACUUM se inspecciona y se comprueba sobre una base sintética; no constituye una prueba de recuperación frente a corte de energía. La carrera residual entre última comprobación y DELETE sigue dependiendo del host. La prueba de motor sobre 10.000 sesiones no mide la latencia del servidor ni la memoria de exportar conversaciones grandes.

Las capturas son frames del renderizador real con datos ficticios; las imágenes PNG se generan a partir de esos frames para poder verlas fuera de una terminal. No son fotos de una instalación del usuario.

## Repetir pruebas

```sh
npm ci
npm test
npm run typecheck
npm run build
node scripts/build-ui-smoke.mjs
bun --conditions=browser scripts/ui-smoke.mjs
```

Para la integración, establece `OPENCODE_TEST_BINARY` con la ruta absoluta al binario 1.18.29 y ejecuta:

```sh
node --experimental-strip-types scripts/integration.mjs
```

El script crea y elimina exclusivamente su propio entorno temporal. También requiere Python 3 para preparar fechas en la base sintética.
