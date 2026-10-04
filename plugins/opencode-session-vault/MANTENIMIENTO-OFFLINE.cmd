@echo off
setlocal enabledelayedexpansion
title OpenCode Session Vault - Mantenimiento Offline

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta disponible en el PATH del sistema.
  echo Se requiere Node.js 22.6 o posterior con soporte nativo de node:sqlite.
  echo Descargalo desde https://nodejs.org/
  pause
  exit /b 1
)

node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (major < 22 || (major === 22 && minor < 6)) process.exit(1); try { const { DatabaseSync } = require('node:sqlite'); if (!DatabaseSync) process.exit(2); } catch { process.exit(2); }" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Se requiere Node.js 22.6 o posterior con modulo nativo 'node:sqlite'.
  echo La version actual de Node.js instalada no es compatible o no soporta node:sqlite.
  pause
  exit /b 1
)

if not exist "%~dp0dist\offline-vault.mjs" (
  echo [ERROR] No se encontro el archivo compilado: "%~dp0dist\offline-vault.mjs"
  echo Ejecuta 'npm run build' en la raiz del proyecto antes de usar este lanzador.
  pause
  exit /b 1
)

:MENU
cls
echo ======================================================================
echo           OPENCODE SESSION VAULT - MANTENIMIENTO FUERA DE LINEA
echo ======================================================================
echo  OpenCode DEBE estar COMPLETAMENTE CERRADO durante estas operaciones.
echo ======================================================================
echo.
echo   [1] Inspeccionar base de datos (tamano, sesiones, integridad - SOLO LECTURA)
echo   [2] Generar plan de limpieza (SIMULACION / DRY-RUN, no modifica nada)
echo   [3] Aplicar limpieza y compactacion (VACUUM con respaldo previo)
echo   [4] Salir
echo.
set /p OPCION="Selecciona una opcion (1-4): "

if "%OPCION%"=="1" goto INSPECT
if "%OPCION%"=="2" goto PLAN
if "%OPCION%"=="3" goto APPLY
if "%OPCION%"=="4" goto FIN
goto MENU

:INSPECT
cls
echo [1] Inspeccionando base de datos...
echo.
node "%~dp0dist\offline-vault.mjs" inspect
echo.
pause
goto MENU

:PLAN
cls
echo [2] Generando plan de limpieza (simulacion)...
echo.
node "%~dp0dist\offline-vault.mjs" plan
echo.
pause
goto MENU

:APPLY
cls
echo [3] Aplicar limpieza y compactacion
echo.
echo Esta operacion requiere confirmacion explicita en la terminal.
echo.
node "%~dp0dist\offline-vault.mjs" apply
echo.
pause
goto MENU

:FIN
echo.
echo Finalizado.
exit /b 0
