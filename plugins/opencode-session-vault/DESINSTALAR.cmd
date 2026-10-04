@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Necesitas Node.js 22.6 o posterior. Descarga el instalador desde https://nodejs.org/
  pause
  exit /b 1
)
node "%~dp0dist\install.mjs" --uninstall
if errorlevel 1 echo La operacion no se completo. Lee el mensaje de arriba.
pause
