import { useState, useCallback } from 'react';

/**
 * Hook que persiste o valor de um filtro no localStorage do navegador.
 * Aceita qualquer tipo serializável em JSON.
 *
 * Uso:
 *   const [filtro, setFiltro, limparFiltro] = useFiltroPersistente('filtros:fabrica:programacao', '');
 *
 * @param chave  chave única no localStorage (prefixe por tela, ex: 'filtros:fabrica:programacao')
 * @param padrao valor inicial quando não há nada salvo
 * @returns      [valor, setValor, limpar]  — limpar reseta para o padrão E remove a chave do storage
 */
export function useFiltroPersistente<T>(chave: string, padrao: T): [T, (v: T | ((prev: T) => T)) => void, () => void] {
  const [valor, setValorState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(chave);
      return raw !== null ? (JSON.parse(raw) as T) : padrao;
    } catch {
      return padrao;
    }
  });

  const setValor = useCallback((v: T | ((prev: T) => T)) => {
    setValorState(prev => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try { localStorage.setItem(chave, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, [chave]);

  const limpar = useCallback(() => {
    setValorState(padrao);
    try { localStorage.removeItem(chave); } catch { /* */ }
  }, [chave, padrao]);

  return [valor, setValor, limpar];
}
