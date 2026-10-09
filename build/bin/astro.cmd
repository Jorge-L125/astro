@echo off
rem Abre Astro desde cualquier terminal sin bloquearla, trabajando en la carpeta actual (--here).
rem Si ya esta abierto, lo muestra y se coloca en esa carpeta.
setlocal
rem La terminal de VS Code define ELECTRON_RUN_AS_NODE=1: con ella Astro.exe arrancaria como Node.
set "ELECTRON_RUN_AS_NODE="
start "" "%~dp0..\Astro.exe" --here %*
