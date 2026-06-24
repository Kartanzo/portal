# Repositório Base: aplicativosempresa/evolution-qrcode

# --- BACKEND ---
Write-Host ">>> Construindo Backend..."
docker build -f Dockerfile.backend -t aplicativosempresa/evolution-qrcode:portal-backend-1.7.5 .
Write-Host ">>> Enviando Backend..."
docker push aplicativosempresa/evolution-qrcode:portal-backend-1.7.5

# --- FRONTEND ---
Write-Host ">>> Construindo Frontend..."
docker build -f Dockerfile.frontend -t aplicativosempresa/evolution-qrcode:portal-frontend-1.7.5 .

Write-Host ">>> Enviando Frontend..."
docker push aplicativosempresa/evolution-qrcode:portal-frontend-1.7.5

Write-Host ">>> Processo concluído com sucesso!"
