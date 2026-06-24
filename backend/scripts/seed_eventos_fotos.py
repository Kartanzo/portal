"""
Script ONE-SHOT: carrega as 13 fotos iniciais do álbum "Seleção EMPRESA"
direto no banco (BYTEA).

Pré-requisitos:
  - DATABASE_URL / DB_HOST etc. configurados via env (mesmo do backend)
  - As 13 fotos em C:\\Users\\Diego\\Downloads\\Nova pasta

Uso:
  cd backend
  python scripts/seed_eventos_fotos.py [--pasta "C:/caminho/com/fotos"]

Por padrão, NÃO duplica: se já existir foto no álbum, ele aborta. Use --force pra recarregar.
"""

import os
import sys
import argparse
import mimetypes
from pathlib import Path

# permite importar db_utils de backend/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db_utils import get_db_connection  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pasta", default=r"C:\Users\Diego\Downloads\Nova pasta",
                        help="Pasta com as fotos a importar")
    parser.add_argument("--force", action="store_true",
                        help="Apaga fotos existentes antes de inserir")
    args = parser.parse_args()

    pasta = Path(args.pasta)
    if not pasta.exists():
        print(f"❌ Pasta não encontrada: {pasta}")
        sys.exit(1)

    # Lista arquivos de imagem suportados
    exts = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    arquivos = sorted([p for p in pasta.iterdir() if p.is_file() and p.suffix.lower() in exts])
    if not arquivos:
        print(f"❌ Nenhuma imagem encontrada em: {pasta}")
        sys.exit(1)

    print(f"📂 {len(arquivos)} arquivos encontrados em {pasta}")

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        cur.execute("SELECT COUNT(*) FROM eventos_album_fotos")
        atual = cur.fetchone()[0]
        if atual > 0:
            if not args.force:
                print(f"⚠️  Já existem {atual} fotos no álbum. Use --force pra recarregar.")
                sys.exit(2)
            cur.execute("DELETE FROM eventos_album_fotos")
            print(f"🗑️  {atual} fotos removidas (--force)")

        inseridos = 0
        for ordem, path in enumerate(arquivos, start=1):
            mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
            with open(path, "rb") as f:
                data = f.read()
            cur.execute(
                """INSERT INTO eventos_album_fotos (foto, mime_type, ordem)
                   VALUES (%s, %s, %s)""",
                (data, mime, ordem),
            )
            inseridos += 1
            print(f"  ✓ ({ordem}/{len(arquivos)}) {path.name} — {len(data)} bytes — {mime}")

        conn.commit()
        print(f"\n✅ {inseridos} fotos inseridas no álbum 'Seleção EMPRESA'")
    except Exception as e:
        conn.rollback()
        print(f"❌ Erro: {e}")
        sys.exit(3)
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
