# -*- coding: utf-8 -*-
"""
Importa as planilhas de inventário de T.I. para a tabela rh_equipamentos (schema homolog).
Modelo híbrido: colunas comuns + atributos JSONB + credenciais criptografadas (Fernet).

Idempotente: remove e reinsere apenas as linhas marcadas com created_by='import_planilhas'.
Uso:  py backend/migrations/import_equipamentos_ti.py
Requer: .env.homolog (DB_* e EQUIP_CRYPTO_KEY) na raiz do projeto.
"""
import os, sys, json, re
import pandas as pd
import psycopg2
from psycopg2.extras import Json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ENV = os.path.join(ROOT, '.env.homolog')
DL = r"C:\Users\TI04\Downloads"
MARK = 'import_planilhas'

FILES = {
    'impressao': os.path.join(DL, 'Controle_Contadores_Impressao_blackd.xlsx'),
    'voz_ip':    os.path.join(DL, 'Aparelhos Voz_IP.xlsx'),
    'daniel':    os.path.join(DL, 'Atual_Inventario de Daniel.xls'),
    'celulares': os.path.join(DL, 'Controle de Celulares (usados).xlsx'),
    'vivo':      os.path.join(DL, 'NUMEROS_VIVO_3LACKD.xlsx'),
}

# ---------- env ----------
def load_env(path):
    env = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env

def ensure_crypto_key(env):
    if env.get('EQUIP_CRYPTO_KEY'):
        return env['EQUIP_CRYPTO_KEY']
    from cryptography.fernet import Fernet
    key = Fernet.generate_key().decode()
    with open(ENV, 'a', encoding='utf-8') as f:
        f.write(f"\nEQUIP_CRYPTO_KEY={key}\n")
    print(f"[+] EQUIP_CRYPTO_KEY gerada e gravada em .env.homolog")
    env['EQUIP_CRYPTO_KEY'] = key
    return key

# ---------- helpers ----------
def clean(v):
    try:
        if v is None or pd.isna(v):
            return None
    except (ValueError, TypeError):
        pass
    s = str(v).strip()
    if s.lower() in ('', 'nan', 'nat', 'none', 'null', '-', '—'):
        return None
    return s

# Normalização de nomes (coluna "com quem"): MAIÚSCULAS, sem honoríficos, typos conhecidos
_HONORIFICS = {'SR', 'SR.', 'SRA', 'SRA.', 'DR', 'DR.', 'DRA', 'DRA.', 'SENHOR', 'SENHORA'}
_TYPOS = {'BRUNNA': 'BRUNA'}

def norm_nome(v):
    s = clean(v)
    if not s:
        return None
    s = ' '.join(s.upper().split())
    parts = [p for p in s.split() if p not in _HONORIFICS]
    parts = [_TYPOS.get(p, p) for p in parts]
    return ' '.join(parts) or None

def attrs(d):
    return {k: clean(v) for k, v in d.items() if clean(v) is not None}

def only_digits(s):
    return re.sub(r'\D', '', s or '')

def read(file, sheet, header):
    return pd.read_excel(FILES[file], sheet_name=sheet, header=header)

# ---------- parse cada planilha -> lista de dicts ----------
def parse_all():
    recs = []

    # 1) Impressoras (aba Resumo, header linha 5)
    df = read('impressao', 'Resumo', 5)
    df.columns = [str(c).strip() for c in df.columns]
    meses = [c for c in df.columns if str(c).startswith('2026')]
    for _, r in df.iterrows():
        modelo = clean(r.get('Modelo da Impressora'))
        if not modelo or 'modelo' in modelo.lower():
            continue
        at = attrs({'modelo_toner': r.get('Modelo Toner'), 'cilindro': r.get('Cilindro'),
                    'total_anual': r.get('Total Anual')})
        cont = {str(m)[:7]: clean(r.get(m)) for m in meses}
        cont = {k: v for k, v in cont.items() if v}
        if cont:
            at['contadores_2026'] = cont
        recs.append(dict(tipo='impressora', modelo=modelo, setor=clean(r.get('Setor')),
                         ip=clean(r.get('IP')), atributos=at))

    # 2) Telefones IP (aba Página1, header linha 1)
    df = read('voz_ip', 'Página1', 1)
    df.columns = [str(c).strip() for c in df.columns]
    for _, r in df.iterrows():
        modelo = clean(r.get('Modelo')); usuario = clean(r.get('usuario'))
        if not (modelo or usuario):
            continue
        recs.append(dict(tipo='telefone_ip', modelo=modelo, usuario_nome=usuario,
                         setor=clean(r.get('Setor/Local')), ramal=clean(r.get('Ramal')),
                         atributos=attrs({'qtde': r.get('Qtde')})))

    # 3a) Computadores (Daniel, aba 2022-2026, header 0)
    df = read('daniel', '2022-2026', 0)
    df.columns = [str(c).strip() for c in df.columns]
    for _, r in df.iterrows():
        tag = clean(r.get('Etiqueta TAG')); usr = clean(r.get('Usuário')); mod = clean(r.get('Modelo'))
        if not (tag or usr or mod):
            continue
        recs.append(dict(tipo='computador', patrimonio=tag, usuario_nome=usr, modelo=mod,
                         setor=clean(r.get('Departamento')), nota_fiscal=clean(r.get('Nota Fiscal')),
                         nome_estacao=clean(r.get('Nome Estação')), observacoes=clean(r.get('Observações')),
                         atributos=attrs({'fonte': '2022-2026', 'rev': r.get('REV.'), 'bios_tag': r.get('Bios TAG'),
                                          'mac_cabeada': r.get('MAC Rede Cabeada'), 'mac_semfio': r.get('MAC Rede Sem Fio'),
                                          'dominio': r.get('3LACKD Domain'), 'hard_drive': r.get('Hard Drive'),
                                          'capacidade': r.get('Capacidade'), 'hardware': r.get('Hardware'),
                                          'linha': r.get('Linha'), 'processador': r.get('Processador'),
                                          'memoria': r.get('Memoria'), 'so_instalado': r.get('S.O. Instalado'),
                                          'serial_so_instalado': r.get('Serial S.O. Instalado'),
                                          'serial_so_foto': r.get('Serial S.O. Etiqueta Foto'),
                                          'office_instalado': r.get('Office Instalado'), 'serial_office': r.get('Serial Office'),
                                          'n_instalacoes': r.get('Nº de Instalações'), 'data_entrega': r.get('Data Entrega'),
                                          'precisa_ser': r.get('Precisa ser'), 'anydesk': r.get('AnyDesk'),
                                          'bitdefender': r.get('Bitdefender'), 'garantia_datas': r.get('Garantia datas'),
                                          'garantia': r.get('Garantia')}),
                         credenciais=attrs({'user_ad': r.get('User AD'), 'user_win_local': r.get('User Win local'),
                                            'senha_win_local': r.get('Senha Win Local'), 'senha_pin_local': r.get('Senha / PIN local'),
                                            'senha_microsoft': r.get('Senha Microsoft'), 'authenticator': r.get('Authenticator / Linha')})))

    # 3b) Computadores (Daniel, aba Inventario T.I., header 0)
    df = read('daniel', 'Inventario T.I.', 0)
    df.columns = [str(c).strip() for c in df.columns]
    for _, r in df.iterrows():
        usr = clean(r.get('Usuário')); mod = clean(r.get('Modelo')); ser = clean(r.get('Serial'))
        if not (usr or mod or ser):
            continue
        ativo = (clean(r.get('Ativo')) or '').lower()
        status = 'ativo' if ativo in ('sim', 'ativo', 's', 'x', '1') else 'estoque'
        recs.append(dict(tipo='computador', usuario_nome=usr, modelo=mod, serial_number=ser, status=status,
                         ramal=clean(r.get('Ramal')), nota_fiscal=clean(r.get('NF Compra')),
                         nome_estacao=clean(r.get('Nome Estação')), descricao=clean(r.get('Descrição Estação')),
                         atributos=attrs({'fonte': 'Inventario T.I.', 'capacidade': r.get('Capacidade'),
                                          'so': r.get('S.O.'), 'office': r.get('Office'), 'serial_so': r.get('Serial S.O.'),
                                          'serial_office': r.get('Serial Office'), 'detalhe_versao': r.get('Detalhe da Versão'),
                                          'processador': r.get('Processador'), 'memoria': r.get('Memoria'),
                                          'anydesk': r.get('AnyDesk'), 'acesso_nao_controlado': r.get('Acesso Não Controlado'),
                                          'email': r.get('E-Mail')}),
                         credenciais=attrs({'user_win': r.get('User Win'), 'senha_win_local': r.get('Senha Win Local'),
                                            'user_ad': r.get('User AD'), 'senha_ad': r.get('Senha AD')})))

    # 4) Celulares (aba Página1, header 0)
    df = read('celulares', 'Página1', 0)
    df.columns = [str(c).strip() for c in df.columns]
    for _, r in df.iterrows():
        mod = clean(r.get('Modelo'))
        if not mod or mod.lower() == 'modelo':
            continue
        recs.append(dict(tipo='celular', modelo=mod, serial_number=clean(r.get('IMEI SIM1')),
                         numero_linha=clean(r.get('Chip')),
                         atributos=attrs({'tela': r.get('Tela'), 'processador': r.get('Processador'),
                                          'memoria': r.get('Memoria'), 'armazenamento': r.get('Armazenam'),
                                          'cam_traseira': r.get('Cam Traseira'), 'cam_frontal': r.get('Cam Frontal'),
                                          'bateria_mah': r.get('Bateria (mAh)'), 'so': r.get('SO'),
                                          'conectividade': r.get('Conectividade'), 'dual_sim': r.get('Dual SIM'),
                                          'tipo_carregador': r.get('Tipo de Carregador'), 'condicao': r.get('Condição')})))

    # 5) Linhas Vivo — merge ATIVO + VIVO_LINHAS_REGISTRADAS por número
    linhas = {}  # numero_digits -> rec
    df = read('vivo', 'ATIVO', 0)
    df.columns = [str(c).strip() for c in df.columns]
    for _, r in df.iterrows():
        num = clean(r.get('NUMERO'))
        if not num:
            continue
        key = only_digits(num)
        linhas[key] = dict(tipo='linha_movel', numero_linha=num, usuario_nome=clean(r.get('USUARIO')),
                           setor=clean(r.get('SETOR')), observacoes=clean(r.get('OBS')),
                           atributos=attrs({'aparelho_blackd': r.get('APARELHO_3LACKD'),
                                            'registro_vivo': r.get('registro_vivo'), 'contador': r.get('contador')}))
    df = read('vivo', 'VIVO_LINHAS_REGISTRADAS', 0)
    df.columns = [str(c).strip() for c in df.columns]
    for _, r in df.iterrows():
        num = clean(r.get('Linha'))
        if not num:
            continue
        key = only_digits(num)
        extra = attrs({'tipo_chip': r.get('Tipo de Chip'), 'situacao': r.get('Situação'), 'lista_equipe': r.get('lista_equipe')})
        if key in linhas:
            linhas[key]['atributos'].update(extra)
        else:
            linhas[key] = dict(tipo='linha_movel', numero_linha=num, atributos=extra)
    recs.extend(linhas.values())

    # Normalização final: nomes em MAIÚSCULAS (sem honoríficos/typos) e setor em MAIÚSCULAS
    for rec in recs:
        if rec.get('usuario_nome'):
            rec['usuario_nome'] = norm_nome(rec['usuario_nome'])
        if rec.get('setor'):
            rec['setor'] = (clean(rec['setor']) or '').upper() or None
    return recs

# ---------- inserção ----------
COMMON = ['tipo', 'modelo', 'marca', 'patrimonio', 'serial_number', 'status', 'localizacao', 'descricao',
          'nota_fiscal', 'observacoes', 'setor', 'usuario_nome', 'numero_linha', 'ramal', 'ip', 'nome_estacao']

def main():
    env = load_env(ENV)
    key = ensure_crypto_key(env)
    from cryptography.fernet import Fernet
    fernet = Fernet(key.encode())

    recs = parse_all()
    print(f"[i] {len(recs)} registros parseados das planilhas")

    conn = psycopg2.connect(host=env['DB_HOST'], dbname=env['DB_NAME'], user=env['DB_USER'],
                            password=env['DB_PASSWORD'], port=env.get('DB_PORT', '5432'), connect_timeout=15)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute(f"SET search_path TO {env['DB_SCHEMA']}, public")

    # garante colunas (idempotente)
    for ddl in [
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS setor TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS usuario_nome TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS numero_linha TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS ramal TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS ip TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS nome_estacao TEXT",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS atributos JSONB DEFAULT '{}'::jsonb",
        "ALTER TABLE rh_equipamentos ADD COLUMN IF NOT EXISTS credenciais_enc TEXT",
    ]:
        cur.execute(ddl)

    # idempotência: remove import anterior
    cur.execute("DELETE FROM rh_equipamentos WHERE created_by = %s", (MARK,))
    print(f"[i] {cur.rowcount} linhas de import anterior removidas")

    inseridos = {}
    seen_pat = set()
    dup = 0
    for rec in recs:
        pat = rec.get('patrimonio')
        if pat:
            if pat in seen_pat:
                dup += 1
                # patrimônio duplicado: mantém só o 1º, evita violar índice único
                rec['patrimonio'] = None
                rec.setdefault('atributos', {})
                if isinstance(rec.get('atributos'), dict):
                    rec['atributos']['patrimonio_duplicado'] = pat
            else:
                seen_pat.add(pat)
        cred = rec.pop('credenciais', None)
        cred = {k: v for k, v in (cred or {}).items() if v}
        cred_enc = fernet.encrypt(json.dumps(cred, ensure_ascii=False).encode()).decode() if cred else None
        atributos = rec.pop('atributos', None) or {}
        rec.setdefault('status', 'ativo' if rec.get('usuario_nome') else 'estoque')
        cols = [c for c in COMMON if rec.get(c) is not None]
        vals = [rec[c] for c in cols]
        cols += ['atributos', 'credenciais_enc', 'created_by', 'updated_by']
        vals += [Json(atributos), cred_enc, MARK, MARK]
        cur.execute(
            f"INSERT INTO rh_equipamentos ({', '.join(cols)}) VALUES ({', '.join(['%s']*len(cols))})",
            vals,
        )
        inseridos[rec['tipo']] = inseridos.get(rec['tipo'], 0) + 1

    conn.commit()
    cur.close(); conn.close()
    print("[OK] Inserção concluída:")
    for t, n in sorted(inseridos.items()):
        print(f"     {t}: {n}")
    print(f"     TOTAL: {sum(inseridos.values())} (patrimônios duplicados realocados p/ atributos: {dup})")

if __name__ == '__main__':
    main()
