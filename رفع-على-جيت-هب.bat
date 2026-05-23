@echo off
chcp 65001 >nul
title رفع المشروع على GitHub
cd /d "%~dp0"

where git >nul 2>&1 || (echo ثبّت Git من https://git-scm.com & pause & exit /b 1)
where gh >nul 2>&1 || (echo ثبّت GitHub CLI من https://cli.github.com & pause & exit /b 1)

gh auth status || (echo سجّل دخول GitHub: gh auth login & pause & exit /b 1)

if not exist .git (
  git init
  git branch -M main
)

git add .gitignore README.txt edit-mode.html untit7led.html untit7led.vendor.js start.bat render.yaml "طريقة-الرفع-على-سيرفر.txt"
git add "New folder/server.js" "New folder/package.json" "New folder/package-lock.json" "New folder/.env.example" "New folder/public"

git status
echo.
set /p MSG=رسالة ال commit (Enter = Deploy untit7led): 
if "%MSG%"=="" set MSG=Deploy untit7led eid payment

git commit -m "%MSG%" 2>nul || echo لا توجد تغييرات جديدة أو commit موجود

echo.
set /p REPO=اسم المستودع على GitHub (Enter = untit7led-eid): 
if "%REPO%"=="" set REPO=untit7led-eid

gh repo view %REPO% >nul 2>&1
if errorlevel 1 (
  echo إنشاء مستودع جديد...
  gh repo create %REPO% --public --source=. --remote=origin --push
) else (
  git push -u origin main
)

echo.
echo تم الرفع. الخطوة التالية على Render:
echo 1) New ^+ Web Service ^> اختر المستودع %REPO%
echo 2) Root Directory: New folder
echo 3) Build: npm install  Start: npm start
echo 4) Env: WALLET_NUMBER=01016380970  PRODUCT_PRICE=100
echo.
pause
