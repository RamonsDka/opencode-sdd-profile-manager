# Origen y atribución

Session Vault se implementó para el encargo de un administrador de retención de sesiones de OpenCode. El boceto proporcionado por el usuario orienta la interfaz.

Se auditó [RamonsDka/opencode-sdd-profile-manager](https://github.com/RamonsDka/opencode-sdd-profile-manager), commit d209b489c6e2757f04968715ffb3d301738d2166, para comprender integración, arquitectura, ciclo de vida y presentación TUI. Ese proyecto declara licencia MIT y procedencia de j0k3r-dev-rgl/sdd-engram-plugin. No se distribuye el repositorio de referencia ni se atribuye su autoría a Session Vault.

Los algoritmos de retención, persistencia, respaldo, instalación y componentes de Session Vault son nuevos. Las llamadas a APIs siguen los contratos de OpenCode y OpenTUI. No existe afiliación oficial con OpenCode, Anomaly o los autores de la referencia.

El instalador precompilado incorpora jsonc-parser bajo MIT; se reproduce su licencia en THIRD-PARTY-NOTICES.txt. Las bibliotecas gráficas se resuelven desde el host y no se redistribuyen dentro del ZIP.
