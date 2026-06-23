import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { BarChart2, Upload, Maximize2, Minimize2, FileDown, Trash2, Eye, EyeOff, ChevronRight, ChevronDown, X, Search, Loader2, MessageSquare } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { MobileLandscapeHint } from '../ui/MobileLandscapeHint';

interface Props { user: any; }

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTH_KEYS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const TRIM_LABELS = ['1T25','2T25','3T25','4T25'];
const SEM_LABELS = ['1S25','2S25'];

// Hierarquia DRE conforme MD
interface DRERow {
  id: string;
  code: string;
  label: string;
  level: number;       // 0=header, 1=grupo, 2=subgrupo, 3=item
  type: 'header' | 'group' | 'subgroup' | 'item' | 'percent';
  parentId?: string;
  values: number[];    // 12 meses
  formula?: string;    // como calcular (sum_children, manual, etc)
  bgColor?: string;
  children?: string[];
  sourceSheet?: string; // qual aba do XLSX alimenta
}

// Definição da estrutura DRE
const DRE_STRUCTURE: Omit<DRERow, 'values'>[] = [
  // RECEITA BRUTA
  { id: 'receita_bruta', code: '', label: 'RECEITA BRUTA', level: 0, type: 'header', bgColor: '#fef2f2', formula: 'from_sheet', sourceSheet: 'Receita', children: [] },
  // IMPOSTOS
  { id: 'impostos', code: '', label: '(-) Impostos', level: 1, type: 'group', bgColor: '#fdf2f7', formula: 'sum_children', parentId: 'receita_bruta',
    children: ['icms','ipi','icms_st','pis','cofins'] },
  { id: 'icms', code: '', label: '(-) ICMS', level: 2, type: 'item', parentId: 'impostos', bgColor: '#fdf2f7' },
  { id: 'ipi', code: '', label: 'IPI', level: 2, type: 'item', parentId: 'impostos', bgColor: '#fdf2f7' },
  { id: 'icms_st', code: '', label: '(-) ICMS ST', level: 2, type: 'item', parentId: 'impostos', bgColor: '#fdf2f7' },
  { id: 'pis', code: '', label: '(-) PIS', level: 2, type: 'item', parentId: 'impostos', bgColor: '#fdf2f7' },
  { id: 'cofins', code: '', label: '(-) COFINS', level: 2, type: 'item', parentId: 'impostos', bgColor: '#fdf2f7' },
  // DEVOLUÇÕES
  { id: 'devolucoes', code: '', label: '(-) Devoluções e cancelamentos', level: 1, type: 'group', bgColor: '#fdf2f7', formula: 'sum_children', parentId: 'receita_bruta',
    children: ['devolucao','cancelamentos'] },
  { id: 'devolucao', code: '', label: '(-) Devolução', level: 2, type: 'item', parentId: 'devolucoes', bgColor: '#fdf2f7', sourceSheet: 'Devoluções' },
  { id: 'cancelamentos', code: '', label: '(-) Cancelamentos', level: 2, type: 'item', parentId: 'devolucoes', bgColor: '#fdf2f7', sourceSheet: 'Cancelamento' },
  // RECEITA LÍQUIDA
  { id: 'receita_liquida', code: '', label: 'RECEITA LÍQUIDA', level: 0, type: 'header', bgColor: '#f0fdf4', formula: 'receita_bruta+impostos+devolucoes' },
  // CPV
  { id: 'cpv_total', code: '', label: '(-) Custos dos produtos vendidos', level: 1, type: 'group', bgColor: '#f0f9ff', formula: 'sum_children',
    children: ['cpv','outros_custos','bonificacao','cred_icms','cred_ipi','cred_pis','cred_cofins'] },
  { id: 'cpv', code: '', label: '(-) Custos dos Produtos Vendidos (CPV)', level: 2, type: 'item', parentId: 'cpv_total', bgColor: '#f0f9ff', sourceSheet: 'Custos MP' },
  { id: 'outros_custos', code: '5.1.1.008', label: '(-) Outros custos de produção', level: 2, type: 'item', parentId: 'cpv_total', bgColor: '#f0f9ff', sourceSheet: 'Base Analítica' },
  { id: 'bonificacao', code: '', label: '(+) Bonificação', level: 2, type: 'item', parentId: 'cpv_total', bgColor: '#f0f9ff', sourceSheet: 'Receita' },
  { id: 'cred_icms', code: '', label: '(+) Créditos de ICMS', level: 2, type: 'item', parentId: 'cpv_total', bgColor: '#f0f9ff' },
  { id: 'cred_ipi', code: '', label: 'Crédito de IPI', level: 2, type: 'item', parentId: 'cpv_total', bgColor: '#f0f9ff' },
  { id: 'cred_pis', code: '', label: '(+) Crédito de PIS', level: 2, type: 'item', parentId: 'cpv_total', bgColor: '#f0f9ff' },
  { id: 'cred_cofins', code: '', label: '(+) Crédito de COFINS', level: 2, type: 'item', parentId: 'cpv_total', bgColor: '#f0f9ff' },
  // RESULTADO BRUTO
  { id: 'resultado_bruto', code: '', label: 'RESULTADO BRUTO', level: 0, type: 'header', bgColor: '#f0fdf4', formula: 'receita_liquida+cpv_total' },
  { id: 'margem_bruta', code: '', label: '(%) Margem bruta', level: 0, type: 'percent', formula: 'resultado_bruto/receita_liquida' },
  // DESPESAS OPERACIONAIS
  { id: 'desp_operacionais', code: '', label: '(=) Despesas operacionais', level: 0, type: 'header', bgColor: '#f9fafb', formula: 'desp_vendas+desp_admin' },
  // DESPESAS COM VENDAS
  { id: 'desp_vendas', code: '', label: '(=) Despesas com vendas', level: 1, type: 'group', bgColor: '#f9fafb', formula: 'sum_children',
    children: ['desp_comerciais','desp_marketing','desp_neg_digitais'] },
  // 6.1.1 Comerciais
  { id: 'desp_comerciais', code: '6.1.1', label: '(-) Despesas comerciais', level: 2, type: 'subgroup', parentId: 'desp_vendas', bgColor: '#f9fafb', formula: 'sum_children',
    children: ['611001','611002','611003','611004','611005','611006','611007','611008','611009','611010','611011'] },
  { id: '611001', code: '6.1.1.001', label: 'Despesa com comissões', level: 3, type: 'item', parentId: 'desp_comerciais', sourceSheet: 'Base Analítica' },
  { id: '611002', code: '6.1.1.002', label: 'Despesa com serviços de fretes e carretos', level: 3, type: 'item', parentId: 'desp_comerciais', sourceSheet: 'Base Analítica' },
  { id: '611003', code: '6.1.1.003', label: 'Despesa com prêmios e bônus', level: 3, type: 'item', parentId: 'desp_comerciais', sourceSheet: 'Base Analítica' },
  { id: '611004', code: '6.1.1.004', label: 'Despesa com pedágios e estacionamentos', level: 3, type: 'item', parentId: 'desp_comerciais', sourceSheet: 'Base Analítica' },
  { id: '611005', code: '6.1.1.005', label: 'Despesa com serviços de uber e táxi', level: 3, type: 'item', parentId: 'desp_comerciais', sourceSheet: 'Base Analítica' },
  { id: '611006', code: '6.1.1.006', label: 'Despesa com serviços de hotelaria', level: 3, type: 'item', parentId: 'desp_comerciais', sourceSheet: 'Base Analítica' },
  { id: '611007', code: '6.1.1.007', label: 'Despesa com brindes e presentes', level: 3, type: 'item', parentId: 'desp_comerciais', sourceSheet: 'Base Analítica' },
  { id: '611008', code: '6.1.1.008', label: 'Despesa com lanches e refeições', level: 3, type: 'item', parentId: 'desp_comerciais', sourceSheet: 'Base Analítica' },
  { id: '611009', code: '6.1.1.009', label: 'Despesa com passagens aéreas', level: 3, type: 'item', parentId: 'desp_comerciais', sourceSheet: 'Base Analítica' },
  { id: '611010', code: '6.1.1.010', label: 'Despesa com feiras e eventos', level: 3, type: 'item', parentId: 'desp_comerciais', sourceSheet: 'Base Analítica' },
  { id: '611011', code: '6.1.1.011', label: 'Despesa com indenizações', level: 3, type: 'item', parentId: 'desp_comerciais', sourceSheet: 'Base Analítica' },
  // 6.1.2 Marketing
  { id: 'desp_marketing', code: '6.1.2', label: '(-) Despesas de marketing', level: 2, type: 'subgroup', parentId: 'desp_vendas', bgColor: '#f9fafb', formula: 'sum_children',
    children: ['612001','612002','612003','612004','612005','612006','612007','612008','612009','612010','612011','612012','612013','612014'] },
  { id: '612001', code: '6.1.2.001', label: 'Despesa com materiais gráficos e papelaria', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612002', code: '6.1.2.002', label: 'Despesa com displays e mostruários', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612003', code: '6.1.2.003', label: 'Despesa com serviços de produção áudio-visual', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612004', code: '6.1.2.004', label: 'Despesa com feiras e eventos', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612005', code: '6.1.2.005', label: 'Despesa com materiais de marketing e propaganda', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612006', code: '6.1.2.006', label: 'Despesa com amostras', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612007', code: '6.1.2.007', label: 'Despesa com pesquisa e desenvolvimento', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612008', code: '6.1.2.008', label: 'Despesa com serviços de uber e táxi', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612009', code: '6.1.2.009', label: 'Despesa com prêmios e bônus', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612010', code: '6.1.2.010', label: 'Despesa com lanches e refeições', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612011', code: '6.1.2.011', label: 'Despesa com passagens aéreas', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612012', code: '6.1.2.012', label: 'Despesa com passagens rodoviárias', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612013', code: '6.1.2.013', label: 'Despesa com serviços de hotelaria', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  { id: '612014', code: '6.1.2.014', label: 'Despesas com tráfego pago', level: 3, type: 'item', parentId: 'desp_marketing', sourceSheet: 'Base Analítica' },
  // 6.1.3 Negócios Digitais
  { id: 'desp_neg_digitais', code: '6.1.3', label: '(-) Despesas com negócios digitais', level: 2, type: 'subgroup', parentId: 'desp_vendas', bgColor: '#f9fafb', formula: 'sum_children',
    children: ['613001','613002','613003','613004','613005','613006','613007','613008','613009','613010','613011','613012'] },
  { id: '613001', code: '6.1.3.001', label: 'Despesa com taxa de gestão comercial', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  { id: '613002', code: '6.1.3.002', label: 'Despesa com taxa comercial', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  { id: '613003', code: '6.1.3.003', label: 'Despesa com taxa de manutenção mensal', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  { id: '613004', code: '6.1.3.004', label: 'Despesa com comissão de marketplace', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  { id: '613005', code: '6.1.3.005', label: 'Despesa com armazenagem', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  { id: '613006', code: '6.1.3.006', label: 'Despesas com malotes e embalagens', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  { id: '613007', code: '6.1.3.007', label: 'Despesa com diferencial de alíquota', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  { id: '613008', code: '6.1.3.008', label: 'Despesa com serviços de uber e táxi', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  { id: '613009', code: '6.1.3.009', label: 'Despesa com feiras e eventos', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  { id: '613010', code: '6.1.3.010', label: 'Despesa com prêmios e bônus', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  { id: '613011', code: '6.1.3.011', label: 'Despesa com lanches e refeições', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  { id: '613012', code: '6.1.3.012', label: 'Despesa com serviços de fretes e carretos', level: 3, type: 'item', parentId: 'desp_neg_digitais', sourceSheet: 'Base Analítica' },
  // MARGEM DE CONTRIBUIÇÃO
  { id: 'margem_contrib', code: '', label: '($) Margem de contribuição', level: 0, type: 'header', bgColor: '#f0fdf4', formula: 'resultado_bruto+desp_vendas' },
  { id: 'margem_contrib_pct', code: '', label: '(%) Margem de contribuição', level: 0, type: 'percent', formula: 'margem_contrib/receita_liquida' },
  // DESPESAS ADMINISTRATIVAS
  { id: 'desp_admin', code: '6.2', label: '(=) Despesas administrativas', level: 1, type: 'group', bgColor: '#f9fafb', formula: 'sum_children',
    children: ['desp_pessoal','desp_terceiros','desp_ocupacao','desp_gerais'] },
  // 6.2.1 Pessoal
  { id: 'desp_pessoal', code: '6.2.1', label: '(-) Despesas com pessoal', level: 2, type: 'subgroup', parentId: 'desp_admin', bgColor: '#f9fafb', formula: 'sum_children',
    children: ['621001','621002','621003','621004','621005','621006','621007','621008','621009','621010','621011','621012','621013','621014','621015','621016','621017','621018','621019','621020'] },
  { id: '621001', code: '6.2.1.001', label: 'Despesa com salários', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621002', code: '6.2.1.002', label: 'Despesa com verbas variáveis', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621003', code: '6.2.1.003', label: 'Despesa com rescisões', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621004', code: '6.2.1.004', label: 'Despesa com verbas variáveis sobre rescisões', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621005', code: '6.2.1.005', label: 'Despesa com pró labore', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621006', code: '6.2.1.006', label: 'Despesa com VR', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621007', code: '6.2.1.007', label: 'Despesa com VT', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621008', code: '6.2.1.008', label: 'Despesa com refeições', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621009', code: '6.2.1.009', label: 'Despesa com assistência médica', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621010', code: '6.2.1.010', label: 'Despesa com cesta básica', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621011', code: '6.2.1.011', label: 'Despesa com seguro de vida', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621012', code: '6.2.1.012', label: 'Despesa com auxílio-combustível', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621013', code: '6.2.1.013', label: 'Despesa com auxílio-educação', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621014', code: '6.2.1.014', label: 'Despesa com férias', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621015', code: '6.2.1.015', label: 'Despesa com 13º salário', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621016', code: '6.2.1.016', label: 'Despesa com INSS', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621017', code: '6.2.1.017', label: 'Despesa com FGTS', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621018', code: '6.2.1.018', label: 'Despesa com FGTS sobre rescisões', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621019', code: '6.2.1.019', label: 'Despesa com PLR', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  { id: '621020', code: '6.2.1.020', label: 'Despesa com sindicatos', level: 3, type: 'item', parentId: 'desp_pessoal', sourceSheet: 'Base Analítica' },
  // 6.2.2 Serviços Terceiros
  { id: 'desp_terceiros', code: '6.2.2', label: '(-) Despesas com serviços de terceiros', level: 2, type: 'subgroup', parentId: 'desp_admin', bgColor: '#f9fafb', formula: 'sum_children',
    children: ['622001','622002','622003','622004','622005','622006','622007','622008','622009','622010','622011','622012','622013','622014','622015','622016','622017','622018','622019','622020','622021','622022','622023','622024'] },
  { id: '622001', code: '6.2.2.001', label: 'Despesa com serviços locação de mão de obra', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622002', code: '6.2.2.002', label: 'Despesa com serviços locação de veículos', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622003', code: '6.2.2.003', label: 'Despesa com serviços locação de máquinas e equipamentos', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622004', code: '6.2.2.004', label: 'Despesa com serviços de assessoria e consultoria', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622005', code: '6.2.2.005', label: 'Despesa com serviços PJ', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622006', code: '6.2.2.006', label: 'Despesa com serviços de manutenção de máquinas e equipamentos', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622007', code: '6.2.2.007', label: 'Despesa com serviços de manutenção e conservação predial', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622008', code: '6.2.2.008', label: 'Despesa com serviços de manutenção de veículos', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622009', code: '6.2.2.009', label: 'Despesa com serviços de manutenção de equipamentos de TI', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622010', code: '6.2.2.010', label: 'Despesa com serviços de segurança da informação', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622011', code: '6.2.2.011', label: 'Despesa com serviços de dedetização e desratização', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622012', code: '6.2.2.012', label: 'Despesa com serviços de motoboy', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622013', code: '6.2.2.013', label: 'Despesa com serviços de uber e táxi', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622014', code: '6.2.2.014', label: 'Despesa com serviços de monitoramento e segurança', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622015', code: '6.2.2.015', label: 'Despesa com serviços de correios e despachos', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622016', code: '6.2.2.016', label: 'Despesa com serviços de telefonia', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622017', code: '6.2.2.017', label: 'Despesa com serviços de internet', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622018', code: '6.2.2.018', label: 'Despesa com serviços de coleta de lixos e resíduos', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622019', code: '6.2.2.019', label: 'Despesa com serviços de lavanderia', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622020', code: '6.2.2.020', label: 'Despesa com serviços de cartório', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622021', code: '6.2.2.021', label: 'Despesa com serviços de cursos e treinamentos', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622022', code: '6.2.2.022', label: 'Despesa com serviços de fretes e carretos', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622023', code: '6.2.2.023', label: 'Despesa com serviços de reciclagem', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  { id: '622024', code: '6.2.2.024', label: 'Despesa com serviços de descarte de documentos', level: 3, type: 'item', parentId: 'desp_terceiros', sourceSheet: 'Base Analítica' },
  // 6.2.3 Ocupação
  { id: 'desp_ocupacao', code: '6.2.3', label: '(-) Despesas com ocupação', level: 2, type: 'subgroup', parentId: 'desp_admin', bgColor: '#f9fafb', formula: 'sum_children',
    children: ['623001','623002','623003','623004','623005','623006'] },
  { id: '623001', code: '6.2.3.001', label: 'Despesa com aluguéis', level: 3, type: 'item', parentId: 'desp_ocupacao', sourceSheet: 'Base Analítica' },
  { id: '623002', code: '6.2.3.002', label: 'Despesa com águas e esgostos', level: 3, type: 'item', parentId: 'desp_ocupacao', sourceSheet: 'Base Analítica' },
  { id: '623003', code: '6.2.3.003', label: 'Despesa com energia', level: 3, type: 'item', parentId: 'desp_ocupacao', sourceSheet: 'Base Analítica' },
  { id: '623004', code: '6.2.3.004', label: 'Despesa com IPTU', level: 3, type: 'item', parentId: 'desp_ocupacao', sourceSheet: 'Base Analítica' },
  { id: '623005', code: '6.2.3.005', label: 'Despesa com seguro-predial', level: 3, type: 'item', parentId: 'desp_ocupacao', sourceSheet: 'Base Analítica' },
  { id: '623006', code: '6.2.3.006', label: 'Despesa com seguro-garantia', level: 3, type: 'item', parentId: 'desp_ocupacao', sourceSheet: 'Base Analítica' },
  // 6.2.4 Gerais
  { id: 'desp_gerais', code: '6.2.4', label: '(-) Despesas gerais', level: 2, type: 'subgroup', parentId: 'desp_admin', bgColor: '#f9fafb', formula: 'sum_children',
    children: ['624001','624002','624003','624004','624005','624006','624007','624008','624009','624010','624011','624012','624013','624014','624015','624016','624017','624018','624019','624020','624021','624022','624023','624024','624025','624026','624027','624029'] },
  { id: '624001', code: '6.2.4.001', label: 'Despesa com softwares e sistemas', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624002', code: '6.2.4.002', label: 'Despesa com combustível', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624003', code: '6.2.4.003', label: 'Despesa com seguros', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624004', code: '6.2.4.004', label: 'Despesa com filtros e refis', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624005', code: '6.2.4.005', label: 'Despesa com alimentação', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624006', code: '6.2.4.006', label: 'Despesa com materiais de copa e cozinha', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624007', code: '6.2.4.007', label: 'Despesa com medicamentos', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624008', code: '6.2.4.008', label: 'Despesa com equipamentos proteção coletiva', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624009', code: '6.2.4.009', label: 'Despesa com ferramentas gerais', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624010', code: '6.2.4.010', label: 'Despesa com materiais de escritório', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624011', code: '6.2.4.011', label: 'Despesa com incentivos e patrocínios', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624012', code: '6.2.4.012', label: 'Despesa com materiais de limpeza e conservação', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624013', code: '6.2.4.013', label: 'Despesa com óleos e lubrificantes', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624014', code: '6.2.4.014', label: 'Despesa com material de papelaria e adesivos', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624015', code: '6.2.4.015', label: 'Despesa com uniformes e EPIs', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624016', code: '6.2.4.016', label: 'Despesa com peças e acessórios', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624017', code: '6.2.4.017', label: 'Despesa com armazenagem virtual', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624018', code: '6.2.4.018', label: 'Despesa com materiais de segurança predial', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624019', code: '6.2.4.019', label: 'Despesa com suprimentos de informática', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624020', code: '6.2.4.020', label: 'Despesa com lanches e refeições', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624021', code: '6.2.4.021', label: 'Despesa com segurança do trabalho', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624022', code: '6.2.4.022', label: 'Despesa com embalagens', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624023', code: '6.2.4.023', label: 'Despesa com equipamentos eletrônicos', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624024', code: '6.2.4.024', label: 'Despesa com brindes e presentes', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624025', code: '6.2.4.025', label: 'Despesa com festas e confraternizações', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624026', code: '6.2.4.026', label: 'Despesa com ações de endomarketing', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624027', code: '6.2.4.027', label: 'Despesas com feiras e eventos', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  { id: '624029', code: '6.2.4.029', label: 'Despesas com Licenças e Alvarás', level: 3, type: 'item', parentId: 'desp_gerais', sourceSheet: 'Base Analítica' },
  // RESULTADO OPERACIONAL
  { id: 'resultado_operacional', code: '', label: 'RESULTADO OPERACIONAL', level: 0, type: 'header', bgColor: '#f0fdf4', formula: 'resultado_bruto+desp_operacionais' },
  { id: 'margem_operacional', code: '', label: '(%) Margem operacional', level: 0, type: 'percent', formula: 'resultado_operacional/receita_liquida' },
];

const fmt = (v: number) => {
  if (v === 0) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const fmtPct = (v: number) => {
  if (isNaN(v) || !isFinite(v)) return '—';
  return (v * 100).toFixed(1) + '%';
};

const DRE2025: React.FC<Props> = ({ user }) => {
  const { showToast } = useToast();
  const confirmar = useConfirm();
  const [bases, setBases] = useState<any[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState('');
  const [dreData, setDreData] = useState<Record<string, number[]>>({});
  const [sheetsData, setSheetsData] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [excludedRows, setExcludedRows] = useState<Set<string>>(new Set());
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [periodMode, setPeriodMode] = useState<'mensal' | 'trimestral' | 'semestral'>('mensal');
  const [expandedPeriods, setExpandedPeriods] = useState<Set<number>>(new Set());

  // Drill-down
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillRow, setDrillRow] = useState<any>(null);
  const [drillMonth, setDrillMonth] = useState(0);
  const [drillData, setDrillData] = useState<any[]>([]);
  const [drillFilter, setDrillFilter] = useState('');
  const [drillExpandedGroups, setDrillExpandedGroups] = useState<Set<string>>(new Set());
  // Observações: chave = "rowId_monthIdx_descricao", valor = texto
  const [observations, setObservations] = useState<Record<string, string>>({});
  const [editingObs, setEditingObs] = useState<string | null>(null);
  const [obsText, setObsText] = useState('');

  // Upload modal
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Load bases on mount
  useEffect(() => {
    loadBases();
  }, []);

  const loadBases = async () => {
    try {
      const res = await fetch('/api/dre2025/bases', { credentials: 'include',  headers: { 'user-id': user.id } });
      if (res.ok) {
        const data = await res.json();
        setBases(data);
        if (data.length > 0 && !selectedBaseId) setSelectedBaseId(data[0].id);
      }
    } catch { }
  };

  // Load base data when selected
  useEffect(() => {
    if (!selectedBaseId) return;
    setLoading(true);
    fetch(`/api/dre2025/bases/${selectedBaseId}`, { credentials: 'include',  headers: { 'user-id': user.id } })
      .then(r => r.json())
      .then(data => {
        setDreData(data.dre_data || {});
        setSheetsData(data.sheets_data || {});
        setObservations(data.observations || {});
      })
      .catch(() => showToast('Erro ao carregar base.', 'error'))
      .finally(() => setLoading(false));
  }, [selectedBaseId]);

  // Process XLSX file
  const processXLSX = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });

        // Read DRE sheet — map row values to structure IDs
        const dreSheet = wb.Sheets['DRE'];
        if (!dreSheet) { showToast('Aba "DRE" não encontrada no arquivo.', 'error'); return; }

        const range = XLSX.utils.decode_range(dreSheet['!ref'] || 'A1');
        const rowValues: Record<string, number[]> = {};

        // Map each DRE_STRUCTURE row to its values from the sheet
        // Column J=9 (Jan), K=10 (Feb), ... T=19 (Sep)
        // J=Jan(9), K=Fev(10), L=Mar(11), skip M(12)=1T, N=Abr(13), O=Mai(14), P=Jun(15), skip Q(16)=2T, R=Jul(17), S=Ago(18), T=Set(19), skip U(20)=3T, V=Out(21), W=Nov(22), X=Dez(23)
        const monthCols = [9, 10, 11, 13, 14, 15, 17, 18, 19, 21, 22, 23];

        // Leitura de valores por índice de linha do Excel (mapeamento fixo conforme DRE_MD)
        const readRow = (rowIdx: number): number[] => {
          return monthCols.map(mc => {
            const cell = dreSheet[XLSX.utils.encode_cell({ r: rowIdx, c: mc })];
            if (!cell) return 0;
            const v = cell.v;
            if (v === undefined || v === null || v === '') return 0;
            return typeof v === 'number' ? v : (parseFloat(String(v)) || 0);
          });
        };

        // Mapeamento direto: ID → linha do Excel (conforme análise do MD)
        const ROW_MAP: Record<string, number> = {
          receita_bruta: 3,
          // Impostos (leaf items)
          icms: 6, ipi: 7, icms_st: 8, pis: 9, cofins: 10,
          // Devoluções
          devolucao: 12, cancelamentos: 13,
          // CPV
          cpv: 18, outros_custos: 19, bonificacao: 20, cred_icms: 21, cred_ipi: 22, cred_pis: 23, cred_cofins: 24,
          // 6.1.1 Comerciais
          '611001': 33, '611002': 34, '611003': 35, '611004': 36, '611005': 37, '611006': 38,
          '611007': 39, '611008': 40, '611009': 41, '611010': 42, '611011': 43,
          // 6.1.2 Marketing
          '612001': 45, '612002': 46, '612003': 47, '612004': 48, '612005': 49, '612006': 50,
          '612007': 51, '612008': 52, '612009': 53, '612010': 54, '612011': 55, '612012': 56, '612013': 57, '612014': 58,
          // 6.1.3 Negócios Digitais
          '613001': 60, '613002': 61, '613003': 62, '613004': 63, '613005': 64, '613006': 65,
          '613007': 66, '613008': 67, '613009': 68, '613010': 69, '613011': 70, '613012': 71,
          // 6.2.1 Pessoal
          '621001': 78, '621002': 79, '621003': 80, '621004': 81, '621005': 82, '621006': 83,
          '621007': 84, '621008': 85, '621009': 86, '621010': 87, '621011': 88, '621012': 89,
          '621013': 90, '621014': 91, '621015': 92, '621016': 93, '621017': 94, '621018': 95, '621019': 96, '621020': 97,
          // 6.2.2 Terceiros
          '622001': 99, '622002': 100, '622003': 101, '622004': 102, '622005': 103, '622006': 104,
          '622007': 105, '622008': 106, '622009': 107, '622010': 108, '622011': 109, '622012': 110,
          '622013': 111, '622014': 112, '622015': 113, '622016': 114, '622017': 115, '622018': 116,
          '622019': 117, '622020': 118, '622021': 119, '622022': 120, '622023': 121, '622024': 122,
          // 6.2.3 Ocupação
          '623001': 124, '623002': 125, '623003': 126, '623004': 127, '623005': 128, '623006': 129,
          // 6.2.4 Gerais
          '624001': 131, '624002': 132, '624003': 133, '624004': 134, '624005': 135, '624006': 136,
          '624007': 137, '624008': 138, '624009': 139, '624010': 140, '624011': 141, '624012': 142,
          '624013': 143, '624014': 144, '624015': 145, '624016': 146, '624017': 147, '624018': 148,
          '624019': 149, '624020': 150, '624021': 151, '624022': 152, '624023': 153, '624024': 154,
          '624025': 155, '624026': 156, '624027': 157, '624029': 158,
        };

        // Ler valores diretamente por linha — sem fuzzy matching
        for (const structRow of DRE_STRUCTURE) {
          if (structRow.type === 'percent' || (structRow.formula && structRow.id !== 'receita_bruta')) {
            rowValues[structRow.id] = new Array(12).fill(0);
            continue;
          }
          const excelRow = ROW_MAP[structRow.id];
          if (excelRow !== undefined) {
            rowValues[structRow.id] = readRow(excelRow);
          } else {
            rowValues[structRow.id] = new Array(12).fill(0);
          }
        }

        // Read other sheets for drill-down
        const sheets: Record<string, any[]> = {};
        for (const sheetName of ['Receita', 'Base Analítica', 'Devoluções', 'Cancelamento', 'Custos MP']) {
          const ws = wb.Sheets[sheetName];
          if (ws) {
            const jsonData = XLSX.utils.sheet_to_json(ws, { defval: '' });
            // Limit to first 5000 rows to avoid memory issues
            sheets[sheetName] = jsonData;
          }
        }

        setDreData(rowValues);
        setSheetsData(sheets);
        showToast('Arquivo processado com sucesso!', 'success');
      } catch (err) {
        showToast('Erro ao processar arquivo XLSX.', 'error');
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  // Save base to backend
  const handleSaveBase = async () => {
    if (!uploadName.trim()) { showToast('Informe um nome para a base.', 'error'); return; }
    if (Object.keys(dreData).length === 0) { showToast('Processe um arquivo antes de salvar.', 'error'); return; }

    setUploading(true);
    try {
      const res = await fetch('/api/dre2025/bases', { credentials: 'include', 
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'user-id': user.id },
        body: JSON.stringify({ name: uploadName.trim(), dre_data: dreData, sheets_data: sheetsData })
      });
      if (!res.ok) throw new Error('Erro ao salvar');
      const result = await res.json();
      showToast('Base salva com sucesso!', 'success');
      setShowUpload(false);
      setUploadName('');
      setPendingFile(null);
      await loadBases();
      setSelectedBaseId(result.id);
    } catch { showToast('Erro ao salvar base.', 'error'); }
    finally { setUploading(false); }
  };

  // Delete base
  const handleDeleteBase = async () => {
    if (!selectedBaseId) return;
    const ok = await confirmar({
      title: 'Remover base',
      message: 'Tem certeza que deseja remover esta base?',
      confirmText: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await fetch(`/api/dre2025/bases/${selectedBaseId}`, { credentials: 'include',  method: 'DELETE', headers: { 'user-id': user.id } });
      showToast('Base removida.', 'success');
      setSelectedBaseId('');
      setDreData({});
      setSheetsData({});
      await loadBases();
    } catch { showToast('Erro ao remover.', 'error'); }
  };

  // Compute effective data with hierarchy
  const effectiveData = useMemo(() => {
    const result: Record<string, number[]> = {};

    // Start with raw values
    for (const row of DRE_STRUCTURE) {
      result[row.id] = [...(dreData[row.id] || new Array(12).fill(0))];
      // Zero excluded rows
      if (excludedRows.has(row.id)) {
        result[row.id] = new Array(12).fill(0);
      }
    }

    // Aggregate children (sum_children)
    for (const row of [...DRE_STRUCTURE].reverse()) {
      if (row.formula === 'sum_children' && row.children) {
        for (let m = 0; m < 12; m++) {
          result[row.id][m] = row.children.reduce((sum, childId) => sum + (result[childId]?.[m] || 0), 0);
        }
      }
    }

    // DRE formulas
    for (let m = 0; m < 12; m++) {
      result['receita_liquida'] = result['receita_liquida'] || new Array(12).fill(0);
      result['receita_liquida'][m] = (result['receita_bruta']?.[m] || 0) + (result['impostos']?.[m] || 0) + (result['devolucoes']?.[m] || 0);

      result['resultado_bruto'] = result['resultado_bruto'] || new Array(12).fill(0);
      result['resultado_bruto'][m] = (result['receita_liquida']?.[m] || 0) + (result['cpv_total']?.[m] || 0);

      result['desp_operacionais'] = result['desp_operacionais'] || new Array(12).fill(0);
      result['desp_operacionais'][m] = (result['desp_vendas']?.[m] || 0) + (result['desp_admin']?.[m] || 0);

      result['margem_contrib'] = result['margem_contrib'] || new Array(12).fill(0);
      result['margem_contrib'][m] = (result['resultado_bruto']?.[m] || 0) + (result['desp_vendas']?.[m] || 0);

      result['resultado_operacional'] = result['resultado_operacional'] || new Array(12).fill(0);
      result['resultado_operacional'][m] = (result['resultado_bruto']?.[m] || 0) + (result['desp_operacionais']?.[m] || 0);
    }

    // Percent rows
    for (let m = 0; m < 12; m++) {
      const rl = result['receita_liquida']?.[m] || 0;
      result['margem_bruta'] = result['margem_bruta'] || new Array(12).fill(0);
      result['margem_bruta'][m] = rl !== 0 ? (result['resultado_bruto']?.[m] || 0) / rl : 0;

      result['margem_contrib_pct'] = result['margem_contrib_pct'] || new Array(12).fill(0);
      result['margem_contrib_pct'][m] = rl !== 0 ? (result['margem_contrib']?.[m] || 0) / rl : 0;

      result['margem_operacional'] = result['margem_operacional'] || new Array(12).fill(0);
      result['margem_operacional'][m] = rl !== 0 ? (result['resultado_operacional']?.[m] || 0) / rl : 0;
    }

    return result;
  }, [dreData, excludedRows]);

  // Visibility helpers
  const isVisible = (row: typeof DRE_STRUCTURE[0]) => {
    if (row.level === 0) return true;
    if (!row.parentId) return true;
    // Check if all ancestors are expanded
    let parent = DRE_STRUCTURE.find(r => r.id === row.parentId);
    while (parent) {
      if (!expandedRows.has(parent.id)) return false;
      parent = parent.parentId ? DRE_STRUCTURE.find(r => r.id === parent!.parentId) : undefined;
    }
    return true;
  };

  const hasChildren = (id: string) => DRE_STRUCTURE.some(r => r.parentId === id);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleExclusion = (id: string) => {
    setExcludedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Period columns
  const getColumns = () => {
    if (periodMode === 'mensal') return MONTHS.map((m, i) => ({ label: m, months: [i], expanded: false, periodIdx: i }));
    if (periodMode === 'trimestral') {
      return TRIM_LABELS.map((label, ti) => {
        const months = [ti * 3, ti * 3 + 1, ti * 3 + 2];
        const expanded = expandedPeriods.has(ti);
        return { label, months, expanded, periodIdx: ti };
      });
    }
    return SEM_LABELS.map((label, si) => {
      const months = Array.from({ length: 6 }, (_, i) => si * 6 + i);
      const expanded = expandedPeriods.has(si);
      return { label, months, expanded, periodIdx: si };
    });
  };

  const togglePeriod = (idx: number) => {
    setExpandedPeriods(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const getTotal = (id: string) => (effectiveData[id] || []).reduce((a, b) => a + b, 0);
  const getPeriodValue = (id: string, months: number[]) => months.reduce((sum, m) => sum + (effectiveData[id]?.[m] || 0), 0);

  // Observação helpers
  const obsKey = (rowId: string, monthIdx: number, desc: string) => `${rowId}_${monthIdx}_${desc}`;
  const hasObsForCell = (rowId: string, monthIdx: number) => {
    const prefix = `${rowId}_${monthIdx}_`;
    return Object.keys(observations).some(k => k.startsWith(prefix) && observations[k]);
  };
  const saveObs = (key: string, text: string) => {
    const updated = { ...observations, [key]: text };
    if (!text) delete updated[key];
    setObservations(updated);
    setEditingObs(null);
    setObsText('');
    // Salvar no backend
    if (selectedBaseId) {
      fetch(`/api/dre2025/bases/${selectedBaseId}/observations`, { credentials: 'include', 
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'user-id': user.id },
        body: JSON.stringify({ observations: updated })
      }).catch(() => {});
    }
  };

  // Get all leaf codes from a row (including descendants)
  const getLeafCodes = (rowId: string): string[] => {
    const row = DRE_STRUCTURE.find(r => r.id === rowId);
    if (!row) return [];
    if (row.type === 'item' && row.code) return [row.code];
    if (!row.children) return row.code ? [row.code] : [];
    const codes: string[] = [];
    for (const childId of row.children) {
      codes.push(...getLeafCodes(childId));
    }
    return codes;
  };

  // Drill-down — mostra linhas da Base Analítica (só para items e subgroups com código)
  const canDrillDown = (row: typeof DRE_STRUCTURE[0]) => {
    if (row.type === 'percent' || row.type === 'header') return false;
    // Só abre se tem código contábil ou sourceSheet ou children com códigos
    const codes = getLeafCodes(row.id);
    return codes.length > 0 || (row.sourceSheet && sheetsData[row.sourceSheet]);
  };

  const handleCellDoubleClick = (row: typeof DRE_STRUCTURE[0], monthIdx: number) => {
    if (!canDrillDown(row)) return;

    const monthName = MONTHS[monthIdx]?.toLowerCase() || '';
    const baseAnalitica = sheetsData['Base Analítica'] || [];
    let data: any[] = [];

    // Buscar todos os códigos contábeis desta linha (incluindo filhos)
    const codes = getLeafCodes(row.id);

    if (codes.length > 0 && baseAnalitica.length > 0) {
      data = baseAnalitica.filter((r: any) => {
        const conta = String(r['Código da Conta'] || '').trim();
        const comp = String(r['COMPETÊNCIA '] || r['COMPETÊNCIA'] || '').toLowerCase().trim();
        return codes.includes(conta) && comp === monthName;
      }).map((r: any) => ({
        'Código da Conta': r['Código da Conta'] || '',
        'CÓDIGO': r['CÓDIGO'] || '',
        'DESCRIÇÃO': r['DESCRIÇÃO'] || '',
        'TIPO DE DESPESA': r['TIPO DE DESPESA'] || '',
        'COMPETÊNCIA': r['COMPETÊNCIA '] || r['COMPETÊNCIA'] || '',
        'TÍTULO': r['TÍTULO'] || '',
        'EMISSÃO': r['EMISSÃO'] || '',
        'V_LÍQUIDO_A': r['V_LÍQUIDO_A'] || 0,
      }));
    }

    // Para linhas da aba Receita (Receita Bruta, Bonificação)
    if (data.length === 0 && row.sourceSheet === 'Receita' && sheetsData['Receita']) {
      const receitaData = sheetsData['Receita'];
      if (row.id === 'bonificacao') {
        // Filtrar por BONIFICACAO + mês
        data = receitaData.filter((r: any) => {
          const tipo = String(r['TIPO_DE_DOCUMENTO'] || r['TIPO DE DOCUMENTO'] || '');
          const comp = String(r['COMPETÊNCIA'] || r['COMPETENCIA'] || '').toLowerCase().trim();
          return tipo === 'BONIFICACAO' && comp === monthName;
        });
      } else {
        // Receita Bruta: excluir BONIFICACAO e MOSTRUARIO
        data = receitaData.filter((r: any) => {
          const tipo = String(r['TIPO_DE_DOCUMENTO'] || r['TIPO DE DOCUMENTO'] || '');
          const comp = String(r['COMPETÊNCIA'] || r['COMPETENCIA'] || '').toLowerCase().trim();
          return comp === monthName && tipo !== 'BONIFICACAO' && tipo !== 'MOSTRUARIO';
        });
      }
    }

    // Fallback para Devoluções e Cancelamentos
    if (data.length === 0 && row.sourceSheet && sheetsData[row.sourceSheet]) {
      const sheetData = sheetsData[row.sourceSheet];
      data = sheetData.filter((r: any) => {
        const comp = String(r['COMPETÊNCIA'] || r['COMPETENCIA'] || r['COMPETÊNCIA '] || '').toLowerCase().trim();
        return comp === monthName;
      });
    }

    // Fallback final — mostrar breakdown dos filhos
    if (data.length === 0 && row.children) {
      const allLeaves = DRE_STRUCTURE.filter(r => {
        let p = r.parentId;
        while (p) {
          if (p === row.id) return true;
          const parent = DRE_STRUCTURE.find(x => x.id === p);
          p = parent?.parentId;
        }
        return false;
      });
      data = allLeaves.map(cr => ({
        'Código da Conta': cr.code,
        'DESCRIÇÃO': cr.label,
        'TIPO DE DESPESA': cr.type === 'item' ? 'Item' : 'Subtotal',
        'COMPETÊNCIA': MONTHS[monthIdx],
        'V_LÍQUIDO_A': effectiveData[cr.id]?.[monthIdx] || 0,
      })).filter(d => d.V_LÍQUIDO_A !== 0);
    }

    setDrillRow(row);
    setDrillMonth(monthIdx);
    setDrillData(data);
    setDrillFilter('');
    setDrillExpandedGroups(new Set());
    setDrillOpen(true);
  };

  // Export Excel
  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();
    const rows: any[][] = [];
    rows.push(['Código', 'Descrição', ...MONTHS, 'Total']);

    for (const row of DRE_STRUCTURE) {
      const vals = effectiveData[row.id] || new Array(12).fill(0);
      const total = vals.reduce((a, b) => a + b, 0);
      if (row.type === 'percent') {
        rows.push([row.code, row.label, ...vals.map(v => fmtPct(v)), fmtPct(total / 12)]);
      } else {
        rows.push([row.code, row.label, ...vals.map(v => Math.round(v)), Math.round(total)]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'DRE 2025');
    XLSX.writeFile(wb, 'DRE_2025.xlsx');
    showToast('Excel exportado!', 'success');
  };


  return (
    <div className={`space-y-4 ${isFullScreen ? 'fixed inset-0 z-50 bg-white p-4 overflow-auto' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart2 className="w-6 h-6 text-red-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">DRE 2025</h1>
            <p className="text-gray-500 text-sm">Demonstrativo de Resultado do Exercício</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsFullScreen(!isFullScreen)} className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button onClick={exportToExcel} className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg border border-green-200 text-sm font-medium transition-colors">
            <FileDown className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        {/* Period mode */}
        <div className="flex rounded-lg overflow-hidden border border-gray-200">
          {(['mensal', 'trimestral', 'semestral'] as const).map(mode => (
            <button key={mode} onClick={() => { setPeriodMode(mode); setExpandedPeriods(new Set()); }}
              className={`px-3 py-1.5 text-xs font-bold uppercase ${periodMode === mode ? 'bg-red-600 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>
              {mode}
            </button>
          ))}
        </div>

        {/* Base selector */}
        <select value={selectedBaseId} onChange={e => setSelectedBaseId(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:outline-none">
          <option value="">Selecione uma base...</option>
          {bases.map(b => <option key={b.id} value={b.id}>{b.name} ({b.created_by_name})</option>)}
        </select>

        {selectedBaseId && (
          <button onClick={handleDeleteBase} className="p-2 text-red-400 hover:text-red-600 transition-colors" title="Remover base">
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        <button onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 transition-colors">
          <Upload className="w-4 h-4" /> Carregar XLSX
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
        </div>
      ) : Object.keys(dreData).length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-16 text-center">
          <BarChart2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Selecione uma base ou carregue um arquivo XLSX para visualizar a DRE.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-auto">
          <MobileLandscapeHint />
          <table className="w-full border-collapse text-[10px]">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr className="text-[9px] font-black text-gray-400 uppercase tracking-wider">
                <th className="sticky left-0 z-20 bg-gray-50 px-2 py-2 text-left w-16 border-b border-gray-200">Código</th>
                <th className="sticky left-16 z-20 bg-gray-50 px-3 py-2 text-left min-w-[250px] border-b border-gray-200">Descrição</th>
                {getColumns().map((col, ci) => (
                  <React.Fragment key={ci}>
                    <th onClick={() => col.periodIdx !== undefined ? togglePeriod(col.periodIdx) : undefined}
                      className={`px-2 py-2 text-right border-b border-gray-200 whitespace-nowrap ${col.periodIdx !== undefined ? 'cursor-pointer hover:bg-gray-100' : ''}`}>
                      {col.periodIdx !== undefined && (col.expanded ? '▼ ' : '▶ ')}{col.label}
                    </th>
                    {col.expanded && col.months.map(m => (
                      <th key={m} className="px-2 py-2 text-right border-b border-gray-200 whitespace-nowrap text-[8px] text-gray-300">
                        {MONTHS[m]?.substring(0, 3)}
                      </th>
                    ))}
                  </React.Fragment>
                ))}
                <th className="sticky right-0 z-20 bg-gray-100 px-2 py-2 text-right border-b border-gray-200 font-black">Total</th>
              </tr>
            </thead>
            <tbody>
              {DRE_STRUCTURE.filter(isVisible).map(row => {
                const vals = effectiveData[row.id] || new Array(12).fill(0);
                const total = vals.reduce((a, b) => a + b, 0);
                const isExcluded = excludedRows.has(row.id);
                const isHeader = row.type === 'header';
                const isPercent = row.type === 'percent';
                const indent = row.level * 16;

                return (
                  <tr key={row.id}
                    className={`border-b border-gray-50 hover:bg-blue-50/50 transition-colors ${isExcluded ? 'opacity-40' : ''} ${isHeader ? 'font-black' : ''}`}
                    style={{ backgroundColor: isExcluded ? undefined : row.bgColor }}>
                    {/* Code */}
                    <td className="sticky left-0 z-10 px-2 py-1.5 text-gray-400 bg-inherit border-r border-gray-100 text-[9px]">
                      {row.code}
                    </td>
                    {/* Label */}
                    <td className={`sticky left-16 z-10 px-3 py-1.5 bg-inherit border-r border-gray-100 ${isHeader ? 'border-l-4 border-l-red-600' : ''}`}>
                      <div className="flex items-center gap-1" style={{ paddingLeft: indent }}>
                        {hasChildren(row.id) && (
                          <button onClick={() => toggleRow(row.id)} className="p-0.5 text-gray-400 hover:text-gray-600">
                            {expandedRows.has(row.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                        )}
                        <span className={`${isHeader ? 'uppercase text-gray-900' : 'text-gray-700'} ${isExcluded ? 'line-through' : ''}`}>
                          {row.label}
                        </span>
                        {row.type === 'item' && (
                          <button onClick={() => toggleExclusion(row.id)} className="ml-1 p-0.5 text-gray-300 hover:text-gray-500">
                            {isExcluded ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    </td>
                    {/* Values */}
                    {getColumns().map((col, ci) => (
                      <React.Fragment key={ci}>
                        <td className={`px-2 py-1.5 text-right whitespace-nowrap ${canDrillDown(row) ? 'cursor-pointer hover:underline' : ''}`}
                          onDoubleClick={() => col.months.length === 1 && handleCellDoubleClick(row, col.months[0])}>
                          <span className="inline-flex items-center gap-0.5">
                            {col.months.length === 1 && hasObsForCell(row.id, col.months[0]) && (
                              <MessageSquare className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                            )}
                            {isPercent ? fmtPct(getPeriodValue(row.id, col.months) / (col.months.length || 1)) : fmt(getPeriodValue(row.id, col.months))}
                          </span>
                        </td>
                        {col.expanded && col.months.map(m => (
                          <td key={m} className={`px-2 py-1.5 text-right whitespace-nowrap text-gray-400 ${canDrillDown(row) ? 'cursor-pointer hover:underline' : ''}`}
                            onDoubleClick={() => handleCellDoubleClick(row, m)}>
                            {isPercent ? fmtPct(vals[m]) : fmt(vals[m])}
                          </td>
                        ))}
                      </React.Fragment>
                    ))}
                    {/* Total */}
                    <td className="sticky right-0 z-10 px-2 py-1.5 text-right font-bold bg-gray-50 border-l border-gray-200 whitespace-nowrap">
                      {isPercent ? fmtPct(total / 12) : fmt(total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowUpload(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Carregar Arquivo DRE</h3>
              <button onClick={() => setShowUpload(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">Nome da Base *</label>
                <input type="text" value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="Ex: DRE Gerencial 2025 v1"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">Arquivo XLSX *</label>
                <div className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${pendingFile ? 'border-green-500 bg-green-50/10' : 'border-gray-200 hover:border-red-300'}`}
                  onClick={() => fileInputRef.current?.click()}>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) { setPendingFile(f); processXLSX(f); } e.target.value = ''; }} />
                  {pendingFile ? (
                    <div>
                      <Upload className="w-8 h-8 text-green-500 mx-auto mb-2" />
                      <p className="text-sm font-bold text-green-700">{pendingFile.name}</p>
                      <p className="text-xs text-green-500 mt-1">Arquivo processado com sucesso</p>
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Clique para selecionar o arquivo</p>
                      <p className="text-[10px] text-gray-300 mt-1">Formato: .xlsx (MBK_DRE gerencial)</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button onClick={() => { setShowUpload(false); setPendingFile(null); setUploadName(''); }}
                className="px-4 py-2 text-sm font-bold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={handleSaveBase} disabled={uploading || !uploadName.trim() || !pendingFile}
                className="flex items-center gap-2 px-5 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Salvar Base
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drill-Down Modal */}
      {drillOpen && drillRow && (() => {
        // Preparar dados: filtrar, agrupar, calcular percentual
        const filtered = drillData.filter(row => {
          if (!drillFilter) return true;
          const q = drillFilter.toLowerCase();
          return Object.values(row).some(v => String(v).toLowerCase().includes(q));
        });

        const grandTotal = filtered.reduce((s, r) => s + Math.abs(Number(r['V_LÍQUIDO_A'] || r['V_FINANCEIRO'] || 0)), 0);

        // Agrupar por TIPO DE DESPESA
        const groups: Record<string, any[]> = {};
        filtered.forEach(row => {
          const tipo = String(row['TIPO DE DESPESA'] || row['TIPO_DE_DOCUMENTO'] || row['TIPO'] || 'Outros');
          if (!groups[tipo]) groups[tipo] = [];
          groups[tipo].push(row);
        });

        // Ordenar cada grupo por DESCRIÇÃO alfabeticamente
        Object.values(groups).forEach(g => g.sort((a, b) => String(a['DESCRIÇÃO'] || a['DESCRIÇÃO_DO_ITEM'] || '').localeCompare(String(b['DESCRIÇÃO'] || b['DESCRIÇÃO_DO_ITEM'] || ''))));

        // Ordenar nomes dos grupos
        const sortedGroupNames = Object.keys(groups).sort();

        const fmtVal = (v: any) => {
          const n = Number(v);
          if (isNaN(n) || n === 0) return '—';
          return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
        };

        const fmtDate = (v: any) => {
          if (!v) return '—';
          if (typeof v === 'number') {
            // Excel serial date
            const d = new Date((v - 25569) * 86400000);
            return d.toLocaleDateString('pt-BR');
          }
          return String(v);
        };

        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setDrillOpen(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <div>
                  <div className="flex items-center gap-2">
                    <Search className="w-5 h-5 text-red-600" />
                    <h3 className="text-lg font-bold text-gray-900">
                      {drillRow.label}
                    </h3>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {MONTHS[drillMonth]} — {filtered.length} lançamentos — Total: {fmtVal(grandTotal)}
                  </p>
                </div>
                <button onClick={() => setDrillOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 bg-gray-50 rounded-lg"><X className="w-5 h-5" /></button>
              </div>

              {/* Filter */}
              <div className="px-5 py-3 border-b border-gray-100">
                <input type="text" value={drillFilter} onChange={e => setDrillFilter(e.target.value)} placeholder="Buscar por descrição, código, fornecedor..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>

              {/* Data */}
              <div className="flex-1 overflow-auto">
                {filtered.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-16">Nenhum dado disponível para detalhamento.</p>
                ) : (
                  <div className="p-5 space-y-4">
                    {sortedGroupNames.map(groupName => {
                      const items = groups[groupName];
                      const groupTotal = items.reduce((s, r) => s + Math.abs(Number(r['V_LÍQUIDO_A'] || r['V_FINANCEIRO'] || 0)), 0);
                      const groupPct = grandTotal > 0 ? (groupTotal / grandTotal * 100).toFixed(1) : '0';

                      return (
                        <div key={groupName} className="border border-gray-100 rounded-xl overflow-hidden">
                          {/* Group header — clicável para expandir/recolher */}
                          <button
                            type="button"
                            onClick={() => setDrillExpandedGroups(prev => {
                              const next = new Set(prev);
                              next.has(groupName) ? next.delete(groupName) : next.add(groupName);
                              return next;
                            })}
                            className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100 hover:bg-gray-100 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              {drillExpandedGroups.has(groupName)
                                ? <ChevronDown className="w-4 h-4 text-red-500" />
                                : <ChevronRight className="w-4 h-4 text-gray-400" />
                              }
                              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">{groupName}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                              <span className="text-gray-500">{items.length} itens</span>
                              <span className="font-bold text-gray-700">{fmtVal(groupTotal)}</span>
                              <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-bold text-[10px]">{groupPct}%</span>
                            </div>
                          </button>
                          {/* Items table — visível só quando expandido */}
                          {drillExpandedGroups.has(groupName) && (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-[9px] font-bold text-gray-400 uppercase bg-white border-b border-gray-50">
                                  <th className="px-3 py-2 text-left w-[25%]">Descrição</th>
                                  <th className="px-3 py-2 text-left w-[14%]">Código</th>
                                  <th className="px-3 py-2 text-left w-[10%]">Competência</th>
                                  <th className="px-3 py-2 text-left w-[9%]">Emissão</th>
                                  <th className="px-3 py-2 text-right w-[11%]">Valor</th>
                                  <th className="px-3 py-2 text-right w-[6%]">%</th>
                                  <th className="px-3 py-2 text-center w-[25%]">Observação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {items.map((row, i) => {
                                  const valor = Math.abs(Number(row['V_LÍQUIDO_A'] || row['V_FINANCEIRO'] || 0));
                                  const pct = grandTotal > 0 ? (valor / grandTotal * 100).toFixed(1) : '0';
                                  const desc = row['DESCRIÇÃO'] || row['DESCRIÇÃO_DO_ITEM'] || '—';
                                  const oKey = drillRow ? obsKey(drillRow.id, drillMonth, `${desc}_${i}`) : '';
                                  const existingObs = observations[oKey] || '';
                                  const isEditingThis = editingObs === oKey;
                                  return (
                                    <tr key={i} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                                      <td className="px-3 py-1.5 text-gray-800 font-medium truncate">{desc}</td>
                                      <td className="px-3 py-1.5 text-gray-500">{row['CÓDIGO'] || row['CÓDIGO_DO_ITEM'] || row['Código da Conta'] || '—'}</td>
                                      <td className="px-3 py-1.5 text-gray-500 capitalize">{String(row['COMPETÊNCIA'] || row['COMPETÊNCIA '] || '—').toLowerCase()}</td>
                                      <td className="px-3 py-1.5 text-gray-500">{fmtDate(row['EMISSÃO'] || row['EMISSAO'])}</td>
                                      <td className="px-3 py-1.5 text-right text-gray-800 font-medium tabular-nums">{fmtVal(valor)}</td>
                                      <td className="px-3 py-1.5 text-right text-gray-400 tabular-nums">{pct}%</td>
                                      <td className="px-3 py-1">
                                        {isEditingThis ? (
                                          <div className="flex items-center gap-1">
                                            <input type="text" value={obsText} onChange={e => setObsText(e.target.value)}
                                              onKeyDown={e => { if (e.key === 'Enter') saveObs(oKey, obsText); if (e.key === 'Escape') setEditingObs(null); }}
                                              autoFocus placeholder="Digite a observação..."
                                              className="flex-1 px-2 py-0.5 border border-gray-200 rounded text-[10px] focus:outline-none focus:ring-1 focus:ring-red-500" />
                                            <button onClick={() => saveObs(oKey, obsText)} className="text-green-500 hover:text-green-700 p-0.5" title="Salvar">
                                              <ChevronDown className="w-3 h-3" />
                                            </button>
                                            <button onClick={() => setEditingObs(null)} className="text-gray-400 hover:text-gray-600 p-0.5" title="Cancelar">
                                              <X className="w-3 h-3" />
                                            </button>
                                          </div>
                                        ) : existingObs ? (
                                          <button onClick={() => { setEditingObs(oKey); setObsText(existingObs); }}
                                            className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 max-w-full" title={existingObs}>
                                            <MessageSquare className="w-3 h-3 shrink-0" />
                                            <span className="truncate">{existingObs}</span>
                                          </button>
                                        ) : (
                                          <button onClick={() => { setEditingObs(oKey); setObsText(''); }}
                                            className="text-gray-300 hover:text-blue-500 transition-colors p-0.5 mx-auto block" title="Adicionar observação">
                                            <MessageSquare className="w-3 h-3" />
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default DRE2025;
