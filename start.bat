@echo off
cd /d "%~dp0"
where node >nul 2>nul && (node serve.mjs & goto :eof)
where python >nul 2>nul && (start "" http://localhost:8080 & python -m http.server 8080 & goto :eof)
echo Please install Node.js (https://nodejs.org) or Python (https://python.org), then run this again.
pause
