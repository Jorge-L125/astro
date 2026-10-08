@echo off
rem Abre Astro desde cualquier terminal sin bloquearla, trabajando en la carpeta actual (--here).
rem Si ya esta abierto, lo muestra y se coloca en esa carpeta.
start "" "%~dp0..\Astro.exe" --here %*
