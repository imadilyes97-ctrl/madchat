@echo off
chcp 65001 >nul
echo ========================================
echo   Yasmine Chatbot - Test Server
echo ========================================
echo.

:: Test 1: Health check - send a text message
echo [Test 1] Envoi d'un message texte (Salam)...
curl -s -X POST http://localhost:3579/webhook ^
  -H "Content-Type: application/json" ^
  -d "{\"userId\":\"test123\",\"type\":\"text\",\"content\":\"Salam Yasmine, bghit ncommandi jean\"}"
echo.
echo.

:: Test 2: Reset session
echo [Test 2] Reset de la session...
curl -s -X POST http://localhost:3579/webhook/reset ^
  -H "Content-Type: application/json" ^
  -d "{\"userId\":\"test123\"}"
echo.
echo.

:: Test 3: Check API catalog
echo [Test 3] Lecture du catalogue...
curl -s http://localhost:3579/api/catalog
echo.
echo.

echo ========================================
echo   Tests terminés !
echo ========================================
pause
