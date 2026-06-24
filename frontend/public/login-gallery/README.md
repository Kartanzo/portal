# Galeria da tela de Login (Novo Layout)

Coloque aqui 5 imagens com os nomes exatos:

- `1.jpg` — foto em Yiwu (pessoa na estação)
- `2.jpg` — banner EMPRESA (logo vermelho + "Detalhes que fazem a diferença")
- `3.jpg` — infográfico "Nosso Propósito" (torii vermelho)
- `4.jpg` — foto da equipe ("Nova Era")
- `5.jpg` — foto do reconhecimento internacional (família + certificado)

Formatos aceitos: `.jpg`, `.jpeg`, `.png`, `.webp` — mas o código aponta para `.jpg`. Se usar outro formato, edite `frontend/src/components/Login.tsx` linhas 12–16.

## Reverter ao layout antigo

O layout anterior está salvo em `frontend/src/components/Login.original.tsx`.

```bash
# Volta para o layout anterior
cp frontend/src/components/Login.original.tsx frontend/src/components/Login.tsx
git add frontend/src/components/Login.tsx
git commit -m "revert: volta layout antigo do login"
git push origin homolog
```
