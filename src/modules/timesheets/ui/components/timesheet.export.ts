import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { TimesheetRow } from '../../model/timesheet.types';

// ── Column definition (shared between both exporters) ─────────────────────────

const COLUMNS: { header: string; key: keyof TimesheetRow }[] = [
    { header: 'Employee ID',        key: 'employeeId' },
    { header: 'Employee',           key: 'employee' },
    { header: 'Group',              key: 'group' },
    { header: 'Sub-Group',          key: 'subGroup' },
    { header: 'Role',               key: 'role' },
    { header: 'Remuneration Level', key: 'remunerationLevel' },
    { header: 'Scheduled Start',    key: 'scheduledStart' },
    { header: 'Scheduled End',      key: 'scheduledEnd' },
    { header: 'Clock-In',           key: 'clockIn' },
    { header: 'Clock-Out',          key: 'clockOut' },
    { header: 'Adjusted Start',     key: 'adjustedStart' },
    { header: 'Adjusted End',       key: 'adjustedEnd' },
    { header: 'Length',             key: 'length' },
    { header: 'Paid Break (min)',    key: 'paidBreak' },
    { header: 'Unpaid Break (min)', key: 'unpaidBreak' },
    { header: 'Net Length',         key: 'netLength' },
    { header: 'Approx. Pay',        key: 'approximatePay' },
    { header: 'Variance (min)',      key: 'differential' },
    { header: 'Lifecycle',          key: 'liveStatus' },
    { header: 'Timesheet Status',   key: 'timesheetStatus' },
];

function cellValue(entry: TimesheetRow, key: keyof TimesheetRow): string {
    const v = entry[key];
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return format(v, 'yyyy-MM-dd');
    return String(v);
}

// ── XLSX export ───────────────────────────────────────────────────────────────

export function exportTimesheetXLSX(entries: TimesheetRow[], date: Date): void {
    const rows = entries.map(e =>
        Object.fromEntries(COLUMNS.map(c => [c.header, cellValue(e, c.key)])),
    );

    const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map(c => c.header) });

    // Auto-width columns
    const colWidths = COLUMNS.map(c => ({
        wch: Math.max(c.header.length, ...entries.map(e => cellValue(e, c.key).length)) + 2,
    }));
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Timesheets');
    XLSX.writeFile(wb, `timesheets_${format(date, 'yyyy-MM-dd')}.xlsx`);
}

// ── PDF export ────────────────────────────────────────────────────────────────

// Column groupings mirroring the table header groups
const PDF_GROUPS = [
    { label: 'Employee Info',       span: 2 },
    { label: 'Hierarchy',           span: 4 },
    { label: 'Scheduled',           span: 2 },
    { label: 'Attendance (Actual)', span: 2 },
    { label: 'Adjusted (Billable)', span: 6 },
    { label: 'Payroll',             span: 2 },
    { label: 'Status',              span: 2 },
];

export function exportTimesheetPDF(entries: TimesheetRow[], date: Date): void {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

    const dateLabel = format(date, 'EEEE, d MMMM yyyy');

    // Title
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Timesheets', 14, 18);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(dateLabel, 14, 25);
    doc.text(`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`, 14, 31);
    doc.setTextColor(0);

    // Group header row
    const groupRow: { content: string; colSpan: number; styles: object }[] = PDF_GROUPS.map(g => ({
        content: g.label,
        colSpan: g.span,
        styles: { halign: 'center', fontStyle: 'bold', fillColor: [240, 240, 248], fontSize: 7 },
    }));

    // Sub-header row (column names)
    const subHeader = COLUMNS.slice(0, 20).map(c => ({
        content: c.header,
        styles: { halign: 'center', fontStyle: 'bold', fontSize: 6.5, fillColor: [248, 248, 252] },
    }));

    // Data rows
    const body = entries.map(e =>
        COLUMNS.slice(0, 20).map(c => ({
            content: cellValue(e, c.key),
            styles: { fontSize: 6.5, halign: 'center' as const },
        })),
    );

    autoTable(doc, {
        startY: 36,
        head: [groupRow, subHeader],
        body,
        styles: {
            cellPadding: 1.5,
            fontSize: 6.5,
            lineColor: [220, 220, 220],
            lineWidth: 0.2,
        },
        headStyles: {
            fillColor: [245, 245, 250],
            textColor: [50, 50, 80],
        },
        alternateRowStyles: {
            fillColor: [252, 252, 255],
        },
        margin: { left: 10, right: 10 },
        didDrawPage: (data) => {
            // Footer: page number + date
            const pageCount = (doc as any).internal.getNumberOfPages();
            doc.setFontSize(7);
            doc.setTextColor(150);
            doc.text(
                `Page ${data.pageNumber} of ${pageCount}  ·  Exported ${format(new Date(), 'dd MMM yyyy, HH:mm')}`,
                data.settings.margin.left,
                doc.internal.pageSize.height - 6,
            );
        },
    });

    doc.save(`timesheets_${format(date, 'yyyy-MM-dd')}.pdf`);
}
