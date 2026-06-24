# ============================================================
# Build e Push — Ambiente de HOMOLOGAÇÃO
# Repositório: aplicativosempresa/evolution-qrcode
# Tags: *-homolog
# ============================================================

$VERSION = "1.7.5-homolog"
$REPO = "aplicativosempresa/evolution-qrcode"

# --- BACKEND ---
Write-Host ">>> [HOMOLOG] Construindo Backend..."
docker build -f ./backend/Dockerfile -t "${REPO}:portal-backend-${VERSION}" ./backend
Write-Host ">>> [HOMOLOG] Enviando Backend..."
docker push "${REPO}:portal-backend-${VERSION}"

# --- FRONTEND (com nginx de homolog) ---
Write-Host ">>> [HOMOLOG] Construindo Frontend..."
docker build -f ./frontend/Dockerfile.frontend -t "${REPO}:portal-frontend-${VERSION}" ./frontend
Write-Host ">>> [HOMOLOG] Enviando Frontend..."
docker push "${REPO}:portal-frontend-${VERSION}"

Write-Host ">>> [HOMOLOG] Processo concluído com sucesso!"
Write-Host ""
Write-Host "Para subir o ambiente de homolog:"
Write-Host "  docker-compose -f docker-compose.homolog.yml up -d"
