import React from 'react';
import { Shield } from 'lucide-react';
import { ComplianceTabContent } from '@/modules/rosters/ui/components/ComplianceTabContent';
import { ComplianceStepProps } from '../types';

export const ComplianceStep: React.FC<ComplianceStepProps> = ({
    isTemplateMode,
    watchEmployeeId,
    hardValidation,
    complianceResults,
    setComplianceResults,
    buildComplianceInput,
    complianceNeedsRerun,
    onChecksComplete,
    shiftId,
}) => {
    return (
        <div className="space-y-6">
            {isTemplateMode && !watchEmployeeId ? (
                <div className="text-center py-10 border border-white/10 rounded-lg bg-white/5">
                    <Shield className="h-10 w-10 text-emerald-500 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">Compliance Checks Passed</h3>
                    <p className="text-foreground/50 max-w-sm mx-auto text-sm">
                        Templated shifts are validated when assigned to an employee.
                        You can proceed without further checks.
                    </p>
                </div>
            ) : (
                <ComplianceTabContent
                    hardValidation={hardValidation}
                    ruleResults={complianceResults}
                    setRuleResults={setComplianceResults}
                    buildComplianceInput={buildComplianceInput}
                    needsRerun={complianceNeedsRerun}
                    onChecksComplete={onChecksComplete}
                    shiftId={shiftId}
                />
            )}
        </div>
    );
};
