@echo off
rem RAPIFIX - arranca el WhatsApp automatico. Ponga un acceso directo a este archivo en la carpeta Inicio de Windows.
cd /d "%~dp0"
title RAPIFIX WhatsApp automatico
:loop
node wa-worker.mjs
echo El programa se detuvo. Se reinicia en 15 segundos... (cierre esta ventana para apagarlo)
timeout /t 15 /nobreak >nul
goto loop
