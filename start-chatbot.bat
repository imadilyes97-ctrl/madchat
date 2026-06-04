@echo off
chcp 65001 >nul
title Yasmine Chatbot
echo ============================================
echo   Demarrage de Yasmine Chatbot...
echo ============================================
echo.

:: Demarrer le serveur en arriere-plan
start /B node server.js

:: Attendre que le serveur soit pret
timeout /t 3 /nobreak >nul

:: Ouvrir le navigateur
start http://localhost:3579/chat.html

echo.
echo Interface chatbot ouverte dans votre navigateur.
echo Appuyez sur Ctrl+C pour arreter le serveur.
echo.
pause
