import React, { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Minus } from 'lucide-react';

export interface EstruturaItem {
  cod: string;
  text: string;
  level: number;
  tipo: string;
  qtdbase: number;
  unidade: string;
  fab?: string;
  parent1?: string;
  codest?: string;
}

interface Props {
  itens: EstruturaItem[];
  qtdProgramada?: number;
}

interface Node extends EstruturaItem { _id: number; children: Node[]; }

const INDENT_PX = 18;

const fmt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(n);

const th = "text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap";
const td = "px-3 py-1.5 text-slate-700 dark:text-slate-200 whitespace-nowrap";

// Monta a árvore a partir da lista plana usando o nível (level) como hierarquia.
function buildTree(itens: EstruturaItem[]): Node[] {
  const roots: Node[] = [];
  const stack: Node[] = [];
  itens.forEach((it, idx) => {
    const node: Node = { ...it, _id: idx, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  return roots;
}

const EstruturaArvore: React.FC<Props> = ({ itens, qtdProgramada }) => {
  const temNecessidade = qtdProgramada !== undefined && qtdProgramada !== null;
  const tree = useMemo(() => buildTree(itens), [itens]);
  const comFilhos = useMemo(() => {
    const ids: number[] = [];
    const walk = (ns: Node[]) => ns.forEach(n => { if (n.children.length) { ids.push(n._id); walk(n.children); } });
    walk(tree);
    return ids;
  }, [tree]);

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setCollapsed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const recolherTudo = () => setCollapsed(new Set(comFilhos));
  const expandirTudo = () => setCollapsed(new Set());

  // Lista de linhas visíveis (DFS, pulando subárvores recolhidas).
  const visiveis: Node[] = [];
  const walk = (ns: Node[]) => ns.forEach(n => { visiveis.push(n); if (n.children.length && !collapsed.has(n._id)) walk(n.children); });
  walk(tree);

  return (
    <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
      <div className="flex items-center justify-end gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700">
        <button type="button" onClick={expandirTudo} className="text-[11px] font-medium text-blue-600 dark:text-blue-300 hover:underline">Expandir tudo</button>
        <span className="text-slate-300">·</span>
        <button type="button" onClick={recolherTudo} className="text-[11px] font-medium text-blue-600 dark:text-blue-300 hover:underline">Recolher tudo</button>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0 z-10">
            <tr>
              <th className={th}>Código</th>
              <th className={th}>Descrição</th>
              <th className={th}>Tipo</th>
              <th className={`${th} text-right`}>Qtd. base</th>
              {temNecessidade && <th className={`${th} text-right`}>Necessidade</th>}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((it) => {
              const indent = Math.max(0, (it.level - 1)) * INDENT_PX;
              const necessidade = temNecessidade ? Number(it.qtdbase) * (qtdProgramada as number) : 0;
              const tem = it.children.length > 0;
              const aberto = !collapsed.has(it._id);
              return (
                <tr key={it._id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-700/20">
                  <td className={`${td} font-mono text-xs`}>
                    <span className="inline-flex items-center" style={{ paddingLeft: indent }}>
                      {tem ? (
                        <button type="button" onClick={() => toggle(it._id)} title={aberto ? 'Recolher' : 'Expandir'}
                          className="mr-1 grid place-items-center w-4 h-4 rounded border border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
                          {aberto ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                      ) : (
                        <span className="mr-1 grid place-items-center w-4 h-4 text-slate-300 dark:text-slate-600"><Minus className="w-2.5 h-2.5" /></span>
                      )}
                      {it.cod}
                    </span>
                  </td>
                  <td className={`${td} truncate max-w-[360px]`} title={it.text}>{it.text}</td>
                  <td className={td}>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-xs text-slate-600 dark:text-slate-300">{it.tipo}</span>
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {fmt(Number(it.qtdbase))} <span className="text-slate-400 text-xs">{it.unidade}</span>
                  </td>
                  {temNecessidade && (
                    <td className={`${td} text-right tabular-nums font-semibold text-blue-700 dark:text-blue-300`}>
                      {fmt(necessidade)} <span className="text-slate-400 text-xs font-normal">{it.unidade}</span>
                    </td>
                  )}
                </tr>
              );
            })}
            {itens.length === 0 && (
              <tr><td colSpan={temNecessidade ? 5 : 4} className="px-3 py-6 text-center text-slate-400">Sem itens na estrutura.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default EstruturaArvore;
