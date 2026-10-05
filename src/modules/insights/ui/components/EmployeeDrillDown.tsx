/**
 * EmployeeDrillDown — the row-click layer behind every KPI detail table.
 *
 * Built entirely from components that already existed and had zero importers:
 * PerformanceSection (12 metrics for one employee) and RiskAlertsSection
 * (expiring licences, expiring skills, cancellation and punctuality flags).
 * Both read get_employee_quarterly_performance, which is the same computation
 * feeding the tables they are opened from — so the drill-down cannot disagree
 * with the row that opened it.
 */

import React from 'react';
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import PerformanceSection from '@/modules/users/ui/components/PerformanceSection';
import RiskAlertsSection from '@/modules/users/ui/components/RiskAlertsSection';

interface EmployeeDrillDownProps {
    employeeId: string | null;
    employeeName: string;
    /** Quarter in the "Q3 2026" shape the KPI page uses. */
    periodLabel: string;
    year: number;
    quarter: number;
    onClose: () => void;
}

export const EmployeeDrillDown: React.FC<EmployeeDrillDownProps> = ({
    employeeId,
    employeeName,
    periodLabel,
    year,
    quarter,
    onClose,
}) => {
    // usePerformanceMetrics keys on the "Q3_2026" shape, not (year, quarter).
    const quarterKey = `Q${quarter}_${year}`;

    return (
        <Dialog open={!!employeeId} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{employeeName}</DialogTitle>
                    <DialogDescription>
                        Performance and risk for {periodLabel}.
                    </DialogDescription>
                </DialogHeader>

                {employeeId && (
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
                        <PerformanceSection employeeId={employeeId} quarterYear={quarterKey} />
                        <RiskAlertsSection employeeId={employeeId} quarterYear={quarterKey} />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default EmployeeDrillDown;
