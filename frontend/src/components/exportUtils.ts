
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ActionPlanItem } from '../types';

/* ============================================================================
 * PADRAO OFICIAL DE PDF DO PORTAL 3LACKD
 * ----------------------------------------------------------------------------
 * Este e o layout padrao de TODOS os PDFs do portal, extraido do modelo da
 * Dashboard da Fabrica (S&OP) e da Programacao de Producao.
 *
 * TODA nova exportacao de PDF DEVE usar estes helpers para manter o visual
 * consistente: cabecalho com logo + barra vermelha, rodape com empresa +
 * numeracao de pagina, e tema de tabela (autoTable) padronizado.
 *
 * Uso tipico:
 *   const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
 *   const layout = await aplicarLayoutBlackd(doc, { titulo: 'Meu Relatorio', subtitulo: '...' });
 *   autoTable(doc, { startY: 35, head, body, ...temaTabelaBlackd });
 *   layout.finalizar(); // carimba header+footer em todas as paginas
 *   doc.save('arquivo.pdf');
 * ==========================================================================*/

/** Cor de destaque vermelha 3LACKD (RGB). */
export const 3LACKD_ACCENT: [number, number, number] = [231, 76, 60];
/** Cor escura (slate-800) usada em titulos e cabecalho de tabela. */
export const 3LACKD_DARK: [number, number, number] = [30, 41, 59];
/** Cor suave (slate-100) usada no rodape de tabelas/totais. */
export const 3LACKD_SOFT: [number, number, number] = [241, 245, 249];

/**
 * Carrega o logo oficial 3LACKD (public/Logo-3LACKD.png) como dataURL base64.
 * Retorna null se nao for possivel carregar (PDF segue sem logo).
 */
export const carregarLogoBlackd = async (): Promise<string | null> => {
    try {
        const resp = await fetch('/Logo-3LACKD.png');
        const blob = await resp.blob();
        return await new Promise<string>((res) => {
            const r = new FileReader();
            r.onloadend = () => res(r.result as string);
            r.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
};

/**
 * Desenha o cabecalho padrao 3LACKD: barra vermelha no topo, cartao do logo,
 * titulo, subtitulo (opcional), data de geracao e linha vermelha separadora.
 */
export const blackdPdfHeader = (
    doc: jsPDF,
    opts: { titulo: string; subtitulo?: string; logoB64?: string | null }
) => {
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(...3LACKD_ACCENT);
    doc.rect(0, 0, W, 3, 'F');
    if (opts.logoB64) {
        doc.setFillColor(...3LACKD_ACCENT);
        doc.roundedRect(8, 6, 46, 18, 2, 2, 'F');
        try { doc.addImage(opts.logoB64, 'PNG', 10, 8, 42, 14); } catch { /* */ }
    }
    doc.setTextColor(...3LACKD_DARK);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(opts.titulo, 60, 14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    if (opts.subtitulo) doc.text(opts.subtitulo, 60, 19);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 60, 23);
    doc.setDrawColor(...3LACKD_ACCENT); doc.setLineWidth(0.4);
    doc.line(10, 28, W - 10, 28);
};

/**
 * Desenha o rodape padrao 3LACKD: linha vermelha, texto da empresa,
 * numeracao de pagina e triangulo vermelho no canto inferior direito.
 */
export const blackdPdfFooter = (
    doc: jsPDF,
    opts: { pagina: number; totalPaginas: number; rodapeTexto?: string }
) => {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...3LACKD_ACCENT); doc.setLineWidth(0.5);
    doc.line(10, H - 10, W - 10, H - 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(opts.rodapeTexto || '3LACKD — Portal Corporativo', 10, H - 5);
    doc.text(`Página ${opts.pagina} de ${opts.totalPaginas}`, W - 10, H - 5, { align: 'right' });
    doc.setFillColor(...3LACKD_ACCENT);
    doc.triangle(W, H, W - 10, H, W, H - 10, 'F');
};

/**
 * Conveniencia: pre-carrega o logo e devolve uma funcao `finalizar()` que
 * carimba cabecalho + rodape padrao em TODAS as paginas do documento.
 * Chame APOS gerar todo o conteudo (autoTable etc.), antes de doc.save().
 */
export const aplicarLayoutBlackd = async (
    doc: jsPDF,
    opts: { titulo: string; subtitulo?: string; rodapeTexto?: string }
): Promise<{ logoB64: string | null; finalizar: () => void }> => {
    const logoB64 = await carregarLogoBlackd();
    const finalizar = () => {
        const total = doc.getNumberOfPages();
        for (let i = 1; i <= total; i++) {
            doc.setPage(i);
            blackdPdfHeader(doc, { titulo: opts.titulo, subtitulo: opts.subtitulo, logoB64 });
            blackdPdfFooter(doc, { pagina: i, totalPaginas: total, rodapeTexto: opts.rodapeTexto });
        }
    };
    return { logoB64, finalizar };
};

/**
 * Tema padrao de tabela (autoTable) 3LACKD: cabecalho escuro, zebra (striped),
 * fonte helvetica e rodape suave para totais. Espalhe no objeto do autoTable:
 *   autoTable(doc, { startY: 35, head, body, ...temaTabelaBlackd });
 * Para usar margem que respeita o cabecalho, ja inclui margin.top: 32.
 */
export const temaTabelaBlackd = {
    theme: 'striped' as const,
    styles: { font: 'helvetica' as const, fontSize: 8, cellPadding: 2, overflow: 'linebreak' as const },
    headStyles: { fillColor: 3LACKD_DARK, textColor: 255 as 255, fontSize: 8 },
    footStyles: { fillColor: 3LACKD_SOFT, textColor: 3LACKD_DARK, fontStyle: 'bold' as const },
    margin: { top: 32, left: 10, right: 10 },
};

/**
 * Exporta o Plano de Ação para Excel (XLSX)
 */
export const exportActionPlanToExcel = (data: ActionPlanItem[], filename: string = 'Plano_de_Acao.xlsx') => {
    const flattened: any[] = [];

    data.forEach(item => {
        item.subItems.forEach(sub => {
            flattened.push({
                'Setor': item.sector,
                'Objetivo Estratégico': item.objective,
                'Macro Tema': item.macro_theme || '',
                'Ação / Atividade': sub.actions,
                'Resultado Esperado': sub.expectedResult,
                'Projeto': sub.projects,
                'Responsável': Array.isArray(sub.responsible) ? sub.responsible.join(', ') : sub.responsible,
                'Status': sub.status,
                'Data Início': sub.scheduleStart ? new Date(sub.scheduleStart).toLocaleDateString('pt-BR') : '',
                'Data Fim': sub.scheduleEnd ? new Date(sub.scheduleEnd).toLocaleDateString('pt-BR') : '',
                'Orc. Planejado': sub.budgetPlanned || 0,
                'Orc. Real': sub.budgetActual || 0,
                'Horas Planejadas': sub.hoursPlanned || 0,
                'Horas Reais': sub.hoursActual || 0,
                'Observações': sub.observation || ''
            });
        });
    });

    const worksheet = XLSX.utils.json_to_sheet(flattened);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Plano de Ação");

    // Set column widths
    const wscols = [
        { wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 40 }, { wch: 30 },
        { wch: 25 }, { wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 12 },
        { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 40 }
    ];
    worksheet['!cols'] = wscols;

    XLSX.writeFile(workbook, filename);
};

/**
 * Exporta o Plano de Ação para PDF (Landscape)
 */
export const exportActionPlanToPDF = async (data: ActionPlanItem[], title: string = 'Plano de Ação') => {
    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
    });

    try {
        const base64 = "data:image/png;base64,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";
        // Red background for logo visibility
        doc.setFillColor(220, 38, 38);
        doc.roundedRect(12, 8, 54, 22, 3, 3, 'F');
        doc.addImage(base64, 'PNG', 14, 10, 50, 18);
    } catch (e) {
        console.warn("Could not load logo for PDF", e);
    }

    // Cabeçalho simplificado para o PDF para caber na folha
    const head = [[
        'Objetivo', 'Ação', 'Responsável', 'Criado por', 'Status', 'Início', 'Fim'
    ]];

    const body: any[] = [];
    data.forEach(item => {
        item.subItems.forEach(sub => {
            body.push([
                item.objective,
                sub.actions,
                Array.isArray(sub.responsible) ? sub.responsible.join(', ') : (sub.responsible || ''),
                sub.createdByName || '',
                sub.status,
                sub.scheduleStart ? new Date(sub.scheduleStart).toLocaleDateString('pt-BR') : '',
                sub.scheduleEnd ? new Date(sub.scheduleEnd).toLocaleDateString('pt-BR') : ''
            ]);
        });
    });

    const now = new Date().toLocaleString('pt-BR');
    doc.setFontSize(16);
    doc.text(title, 70, 18); // Moved text to the right of the logo
    doc.setFontSize(8);
    doc.text(`Gerado em: ${now}`, 70, 24);

    autoTable(doc, {
        head: head,
        body: body,
        startY: 32, // Adjusted startY to be below the logo
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
            0: { cellWidth: 50 }, // Objetivo
            1: { cellWidth: 75 }, // Ação
            2: { cellWidth: 35 }, // Responsável
            3: { cellWidth: 30 }, // Criado por
            4: { cellWidth: 25 }, // Status
            5: { cellWidth: 18 }, // Início
            6: { cellWidth: 18 }  // Fim
        },
        didDrawPage: (dataArg: any) => {
            // Footer
            doc.setFontSize(7);
            const str = "Página " + doc.getNumberOfPages();
            const pageSize = doc.internal.pageSize;
            const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
            doc.text(str, dataArg.settings.margin.left, pageHeight - 10);
        }
    });

    doc.save(`${title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
};
