/**
 * Export the Users table as it stands (the rows in the page's scope) to Excel
 * or PDF. The libraries load only when an export is asked for. No dollar
 * figures: remuneration is the basis only.
 */
import { formatInTimezone, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { EXPORT_COLUMNS, type ExportRow } from '../domain/usersTable';

const stamp = () => formatInTimezone(new Date(), SYDNEY_TZ, 'yyyy-MM-dd');

function downloadBlob(blob: Blob, filename: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function exportUsersXLSX(rows: readonly ExportRow[], scopeLabel: string): Promise<void> {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows as ExportRow[], { header: [...EXPORT_COLUMNS] });
    // Columns as wide as their longest value, so the sheet reads without resizing.
    ws['!cols'] = EXPORT_COLUMNS.map((h) => ({
        wch: Math.min(48, Math.max(h.length, ...rows.map((r) => (r[h] ?? '').length)) + 2),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    wb.Props = { Title: `Users — ${scopeLabel}` };

    const filename = `users_${stamp()}.xlsx`;
    // Output clean binary Uint8Array to avoid string-encoding corruption in browser
    if (typeof XLSX.write === 'function') {
        const u8 = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([u8], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        downloadBlob(blob, filename);
    } else {
        XLSX.writeFile(wb, filename);
    }
}

export async function exportUsersPDF(rows: readonly ExportRow[], scopeLabel: string): Promise<void> {
    const jspdfModule = await import('jspdf');
    const autotableModule = await import('jspdf-autotable');

    // Robust constructor resolution across ESM/CJS/Vite bundles
    const anyJspdf = jspdfModule as unknown as Record<string, any>;
    const jsPdfConstructor = (anyJspdf.jsPDF || anyJspdf.default?.jsPDF || anyJspdf.default) as typeof import('jspdf').jsPDF;
    const autoTable = (autotableModule.default || autotableModule.autoTable || autotableModule) as unknown as (doc: any, options: any) => void;

    const doc = new jsPdfConstructor({ orientation: 'landscape', unit: 'mm', format: 'a3' });

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Users', 14, 18);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`${scopeLabel} · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} · exported ${formatInTimezone(new Date(), SYDNEY_TZ, 'd MMM yyyy, h:mm aaa')}`, 14, 25);
    doc.setTextColor(0);

    autoTable(doc, {
        startY: 31,
        head: [[...EXPORT_COLUMNS]],
        body: rows.map((r) => EXPORT_COLUMNS.map((h) => r[h] ?? '')),
        styles: { fontSize: 7, cellPadding: 1.6, overflow: 'linebreak' },
        headStyles: { fillColor: [240, 240, 248], textColor: 20, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [250, 250, 252] },
        margin: { left: 14, right: 14 },
    });

    const filename = `users_${stamp()}.pdf`;
    if (typeof doc.output === 'function' && typeof Blob !== 'undefined') {
        const blob = doc.output('blob');
        downloadBlob(blob, filename);
    } else {
        doc.save(filename);
    }
}

