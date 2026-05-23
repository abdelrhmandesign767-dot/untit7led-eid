@echo off
chcp 65001 >nul 2>&1
title untit7led — تشغيل السيرفر
cd /d "%~dp0New folder"
if errorlevel 1 (
  echo [خطأ] مجلد New folder غير موجود
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js غير مثبت — حمّله من https://nodejs.org
  pause
  exit /b 1
)

echo جاري إيقاف أي سيرفر قديم على المنفذ 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

if not exist node_modules (
  echo جاري تثبيت الحزم...
  call npm install
)

echo ========================================
echo   السيرفر يعمل — لا تغلق هذه النافذة
echo   http://localhost:3000/edit-mode.html
echo   100 ج.م | 01016380970
echo ========================================
node server.js
pause
