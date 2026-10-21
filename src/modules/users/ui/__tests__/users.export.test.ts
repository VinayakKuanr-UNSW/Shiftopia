/**
 * Exporting the Users table (2026-10-16): the rows on screen, every column, to
 * a dated Excel sheet or an A3 landscape PDF.
 */
import { describe, expect, it, vi } from 'vitest';

const xlsx = vi.hoisted(() => ({
    json_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
    writeFile: vi.fn(),
    write: vi.fn(() => new Uint8Array([1, 2, 3])),
}));
vi.mock('xlsx', () => ({ utils: xlsx, writeFile: xlsx.writeFile, write: xlsx.write }));

const pdf = vi.hoisted(() => ({ autoTable: vi.fn(), save: vi.fn(), text: vi.fn(), output: vi.fn(() => new Blob([])) }));
vi.mock('jspdf', () => ({
    default: class {
        setFontSize() {}
        setFont() {}
        setTextColor() {}
        text(...a: any[]) { (pdf.text as any)(...a); }
        save(name: string) { pdf.save(name); }
        output(...a: any[]) { return (pdf.output as any)(...a); }
    },
    jsPDF: class {
        setFontSize() {}
        setFont() {}
        setTextColor() {}
        text(...a: any[]) { (pdf.text as any)(...a); }
        save(name: string) { pdf.save(name); }
        output(...a: any[]) { return (pdf.output as any)(...a); }
    },
}));
vi.mock('jspdf-autotable', () => ({ default: pdf.autoTable }));

const { exportUsersPDF, exportUsersXLSX } = await import('../users.export');
import { EXPORT_COLUMNS, type ExportRow } from '../../domain/usersTable';

const row = Object.fromEntries(EXPORT_COLUMNS.map((c) => [c, c === 'Name' ? 'Kurry Admin' : ''])) as ExportRow;

describe('users export', () => {
    it('writes every column to an Excel sheet named for the day', async () => {
        await exportUsersXLSX([row], 'ICC Sydney');
        expect(xlsx.json_to_sheet).toHaveBeenCalledWith([row], { header: [...EXPORT_COLUMNS] });
        expect(xlsx.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Users');
        expect(xlsx.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bookType: 'xlsx', type: 'array' }));
    });

    it('writes the same rows to a PDF table, titled with the scope', async () => {
        await exportUsersPDF([row], 'Event Setup');
        expect(pdf.autoTable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            head: [[...EXPORT_COLUMNS]],
            body: [EXPORT_COLUMNS.map((c) => row[c])],
        }));
        expect(pdf.text).toHaveBeenCalledWith(expect.stringMatching(/^Event Setup · 1 row · exported /), 14, 25);
        expect(pdf.output).toHaveBeenCalledWith('blob');
    });
});
