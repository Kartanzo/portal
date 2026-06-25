import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { RotateCcw, Activity } from 'lucide-react';
import { api } from '../../app_api';

// Paleta dark (mesmo visual do mockup aprovado / estilo LiveMES)
const C = {
  bg: '#0f172a', card: '#1e293b', border: '#334155',
  txt: '#e2e8f0', sub: '#94a3b8', mut: '#64748b',
  green: '#4ade80', yellow: '#facc15', red: '#f87171', orange: '#fb923c', blue: '#3b82f6',
};

const fmt = (v: number) => (v == null ? '0' : Math.round(v).toLocaleString('pt-BR'));

const statusBadge = (s: string) => {
  const m: Record<string, { bg: string; fg: string }> = {
    'Produzindo': { bg: '#14532d', fg: '#86efac' },
    'Em produção': { bg: '#14532d', fg: '#86efac' },
    'Setup': { bg: '#78350f', fg: '#fcd34d' },
    'Aguardando': { bg: '#78350f', fg: '#fcd34d' },
    'Parada': { bg: '#7f1d1d', fg: '#fca5a5' },
    'Interrompida': { bg: '#7f1d1d', fg: '#fca5a5' },
    'Concluída': { bg: '#334155', fg: '#cbd5e1' },
  };
  return m[s] || { bg: '#334155', fg: '#cbd5e1' };
};

const oeeColor = (v: number) => (v >= 80 ? C.green : v >= 60 ? C.yellow : C.red);

const Card: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className, style }) => (
  <div className={className} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, ...style }}>
    {children}
  </div>
);

const H2: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 16 }}>{children}</h2>
);

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0b1220', border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 12, color: C.txt }}>
      <div style={{ color: C.sub, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || p.fill }}>{p.name}: {fmt(p.value)}{String(p.name).includes('%') || ['OEE', 'Disp.', 'Perf.', 'Qual.'].includes(p.name) ? '%' : ''}</div>
      ))}
    </div>
  );
};

export default function DashboardProducao() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const { data } = await api.get('/producao/dashboard');
      setData(data);
    } catch (e: any) {
      setErr('Não foi possível carregar o dashboard de produção.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  if (loading && !data) {
    return <div style={{ background: C.bg, minHeight: '100vh', color: C.sub, padding: 24 }}>Carregando dashboard de produção…</div>;
  }
  if (err) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', color: C.txt, padding: 24 }}>
        <p style={{ color: C.red, marginBottom: 12 }}>{err}</p>
        <button onClick={carregar} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.txt, borderRadius: 8, padding: '6px 12px' }}>Tentar novamente</button>
      </div>
    );
  }

  const k = data?.kpis || {};
  const maquinas = data?.maquinas || [];
  const resumo = data?.resumo_maquinas || {};
  const oeeMaq = data?.oee_por_maquina || [];
  const volLinha = data?.volume_por_linha || [];
  const ordens = data?.ordens || [];
  const timeline = data?.timeline || { segmentos: [], eventos: [] };
  const refugo = data?.refugo || { por_tipo: [] };

  const kpis = [
    { label: 'OEE Geral', value: `${fmt(k.oee_geral)}%`, color: oeeColor(k.oee_geral || 0), sub: 'Meta: 85%' },
    { label: 'Volume Produzido', value: fmt(k.volume_produzido), color: C.txt, sub: `Meta: ${fmt(k.volume_meta)} pç · ${fmt(k.volume_pct)}%` },
    { label: 'Ordens em Andamento', value: fmt(k.ordens_total), color: C.txt, sub: `${k.ordens_producao || 0} produzindo · ${k.ordens_concluidas || 0} concluídas · ${k.ordens_aguardando || 0} aguardando` },
    { label: 'Refugo / Retrabalho', value: `${fmt(k.refugo_pct)}%`, color: C.red, sub: `${fmt(k.refugo_total)} pç rejeitadas` },
  ];

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.txt, padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity style={{ width: 20, height: 20 }} /> Dashboard de Produção
          </h1>
          <p style={{ color: C.sub, fontSize: 13, marginTop: 2 }}>Indicadores derivados da Programação de Produção · dados de demonstração</p>
        </div>
        <button onClick={carregar} title="Atualizar"
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card, border: `1px solid ${C.border}`, color: C.sub, borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>
          <RotateCcw style={{ width: 14, height: 14 }} /> Atualizar
        </button>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        {kpis.map((kpi, i) => (
          <Card key={i}>
            <p style={{ color: C.sub, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{kpi.label}</p>
            <p style={{ fontSize: 30, fontWeight: 700, color: kpi.color }}>{kpi.value}</p>
            <p style={{ color: C.mut, fontSize: 12, marginTop: 4 }}>{kpi.sub}</p>
          </Card>
        ))}
      </div>

      {/* Linha 1: status máquinas | OEE por máquina | volume por linha */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Card>
          <H2>Status das Máquinas</H2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {maquinas.map((m: any) => {
              const b = statusBadge(m.status);
              const dot = m.status === 'Produzindo' ? C.green : m.status === 'Setup' ? C.yellow : C.red;
              return (
                <div key={m.maquina} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 14 }}>{m.maquina}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: oeeColor(m.oee), fontWeight: 500 }}>OEE {fmt(m.oee)}%</span>
                    <span style={{ fontSize: 11, background: b.bg, color: b.fg, padding: '2px 8px', borderRadius: 999, fontWeight: 500 }}>{m.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}`, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, textAlign: 'center' }}>
            <div><p style={{ color: C.green, fontWeight: 700, fontSize: 18 }}>{resumo.Produzindo || 0}</p><p style={{ color: C.mut, fontSize: 12 }}>Produzindo</p></div>
            <div><p style={{ color: C.yellow, fontWeight: 700, fontSize: 18 }}>{resumo.Setup || 0}</p><p style={{ color: C.mut, fontSize: 12 }}>Setup</p></div>
            <div><p style={{ color: C.red, fontWeight: 700, fontSize: 18 }}>{resumo.Parada || 0}</p><p style={{ color: C.mut, fontSize: 12 }}>Paradas</p></div>
          </div>
        </Card>

        <Card>
          <H2>OEE por Máquina — Turno Atual</H2>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={oeeMaq} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="maquina" tick={{ fill: C.sub, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis domain={[0, 100]} tick={{ fill: C.sub, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="oee" name="OEE" radius={[6, 6, 0, 0]}>
                  {oeeMaq.map((e: any, i: number) => <Cell key={i} fill={oeeColor(e.oee)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <H2>Volume Produzido vs Meta (por Linha)</H2>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volLinha} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="linha" tick={{ fill: C.sub, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.sub, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Legend wrapperStyle={{ fontSize: 11, color: C.sub }} />
                <Bar dataKey="realizado" name="Realizado" fill={C.blue} radius={[6, 6, 0, 0]} />
                <Bar dataKey="meta" name="Meta" fill="#1e3a5f" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Ordens de Produção */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <H2>Ordens de Produção</H2>
          <span style={{ fontSize: 12, color: C.mut }}>{ordens.length} ordens</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: C.mut, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: `1px solid ${C.border}` }}>
                <th style={{ textAlign: 'left', padding: '0 8px 8px 0' }}>Ordem</th>
                <th style={{ textAlign: 'left', padding: '0 8px 8px 0' }}>Produto</th>
                <th style={{ textAlign: 'left', padding: '0 8px 8px 0' }}>Máquina</th>
                <th style={{ textAlign: 'right', padding: '0 8px 8px 0' }}>Qtd Prog.</th>
                <th style={{ textAlign: 'right', padding: '0 8px 8px 0' }}>Realizado</th>
                <th style={{ textAlign: 'left', padding: '0 8px 8px 16px' }}>Progresso</th>
                <th style={{ textAlign: 'left', padding: '0 0 8px 0' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {ordens.map((o: any, idx: number) => {
                const b = statusBadge(o.status);
                const barColor = o.progresso >= 100 ? C.green : o.progresso >= 70 ? C.green : o.progresso >= 40 ? C.yellow : C.red;
                return (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(51,65,85,0.5)' }}>
                    <td style={{ padding: '10px 8px 10px 0', fontFamily: 'ui-monospace, monospace', color: C.sub }}>{o.numero_op}</td>
                    <td style={{ padding: '10px 8px 10px 0', color: C.txt }}>{o.produto}</td>
                    <td style={{ padding: '10px 8px 10px 0', color: C.sub }}>{o.maquina}</td>
                    <td style={{ padding: '10px 8px 10px 0', textAlign: 'right', color: C.sub }}>{fmt(o.qtd_prog)} pç</td>
                    <td style={{ padding: '10px 8px 10px 0', textAlign: 'right', color: '#fff', fontWeight: 500 }}>{fmt(o.realizado)} pç</td>
                    <td style={{ padding: '10px 8px 10px 16px', width: 140 }}>
                      <div style={{ height: 6, borderRadius: 4, background: C.border }}>
                        <div style={{ height: 6, borderRadius: 4, background: barColor, width: `${Math.min(100, o.progresso)}%` }} />
                      </div>
                      <span style={{ fontSize: 12, color: C.mut, marginTop: 2, display: 'block' }}>{o.progresso}%</span>
                    </td>
                    <td style={{ padding: '10px 0' }}>
                      <span style={{ fontSize: 11, background: b.bg, color: b.fg, padding: '2px 8px', borderRadius: 999 }}>{o.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Linha 3: timeline | refugo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <Card>
          <H2>Linha do Tempo — Turno Manhã</H2>
          <div style={{ display: 'flex', height: 32, borderRadius: 8, overflow: 'hidden', fontSize: 11, fontWeight: 500 }}>
            {timeline.segmentos.map((s: any, i: number) => (
              <div key={i} title={s.tipo} style={{ width: `${s.pct}%`, background: s.cor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.tipo === 'Ocioso' ? C.sub : '#fff' }}>
                {s.pct >= 12 ? s.tipo : ''}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.mut, marginTop: 4 }}>
            <span>06:00</span><span>08:00</span><span>10:00</span><span>12:00</span><span>14:00</span>
          </div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            {timeline.eventos.map((e: any, i: number) => {
              const dot = e.tipo === 'ok' ? C.green : e.tipo === 'setup' ? C.yellow : C.red;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: C.mut, width: 40, flexShrink: 0 }}>{e.hora}</span>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, marginTop: 4, flexShrink: 0 }} />
                  <span style={{ color: C.sub }}>{e.texto}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <H2>Apontamento de Refugo / Retrabalho</H2>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={refugo.por_tipo} dataKey="valor" nameKey="tipo" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {(refugo.por_tipo || []).map((_: any, i: number) => <Cell key={i} fill={['#ef4444', '#f59e0b', '#f97316'][i % 3]} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, color: C.sub }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, fontSize: 12 }}>
            <div style={{ background: 'rgba(51,65,85,0.5)', borderRadius: 8, padding: 12 }}><p style={{ color: C.sub }}>Total refugo</p><p style={{ color: C.red, fontWeight: 700, fontSize: 18 }}>{fmt(refugo.refugo)} pç</p></div>
            <div style={{ background: 'rgba(51,65,85,0.5)', borderRadius: 8, padding: 12 }}><p style={{ color: C.sub }}>Total retrabalho</p><p style={{ color: C.yellow, fontWeight: 700, fontSize: 18 }}>{fmt(refugo.retrabalho)} pç</p></div>
            <div style={{ background: 'rgba(51,65,85,0.5)', borderRadius: 8, padding: 12 }}><p style={{ color: C.sub }}>Sucata gerada</p><p style={{ color: C.orange, fontWeight: 700, fontSize: 18 }}>{fmt(refugo.sucata)} kg</p></div>
            <div style={{ background: 'rgba(51,65,85,0.5)', borderRadius: 8, padding: 12 }}><p style={{ color: C.sub }}>Taxa de perda</p><p style={{ color: C.red, fontWeight: 700, fontSize: 18 }}>{fmt(refugo.taxa)}%</p></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
