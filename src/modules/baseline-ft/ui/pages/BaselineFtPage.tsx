/**
 * Baseline FT Schedule — the manager's surface.
 *
 * Four steps, in the order the questions actually arise: choose the team and
 * the pattern, check the pattern is lawful, read what the run proposes, apply
 * it as drafts.
 *
 * THE PATTERN CHECK IS THE MOST VALUABLE SCREEN HERE. The obvious full-time
 * week — Monday to Friday, 08:00–16:30 with a 30-minute break — is 40 hours,
 * against a ceiling of 38. Every full-time employee in production is currently
 * carrying that breach. Showing the arithmetic and the remedy BEFORE anything
 * is generated is what stops the generator reproducing it on every future
 * roster.
 *
 * APPLY IS THE ONLY THING THAT WRITES. Generating is free and repeatable; the
 * confirmation says exactly what will and will not happen, because "nothing
 * will be published" is the fact a manager most needs to be sure of before
 * pressing a button on a rostering tool.
 */

import React from 'react';
import { CalendarRange, Loader2, ShieldCheck, TriangleAlert, Wand2 } from 'lucide-react';
import { format, addDays } from 'date-fns';

import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageState } from '@/modules/core/ui/components/PageState';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { getSydneyNow } from '@/modules/core/lib/date.utils';

import {
    useApplyBaseline, useBaselinePatterns, useCreateBaselinePattern, useFtProfile,
    useGenerateBaseline, useRosterableSubDepartments,
} from '../../hooks/useBaselineFt';
import { designPattern } from '../../domain/patternDesigner';
import { PatternDesignerDialog } from '../components/PatternDesignerDialog';
import { resolveRosterTarget } from '../../api/rosterTarget';
import { BaselineLedgerTable, BaselineSummary, fmtHours } from '../components/BaselineLedger';
import { FindingList } from '../components/FindingList';
import type { GenerateRunResult } from '../../api/baselineFt.commands';

const BaselineFtPage: React.FC = () => {
    const { user } = useAuth();
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const { toast } = useToast();

    // Reference date is resolved ONCE per page load and passed into the run, so
    // a generation is reproducible and does not depend on when it happened to
    // execute. Sydney, because every roster date in this system is Sydney.
    const today = React.useMemo(() => format(getSydneyNow(), 'yyyy-MM-dd'), []);

    const [templateId, setTemplateId] = React.useState<string | null>(null);
    const [designerOpen, setDesignerOpen] = React.useState(false);
    const [periodStart, setPeriodStart] = React.useState(() =>
        format(addDays(getSydneyNow(), 7), 'yyyy-MM-dd'));
    const [periodEnd, setPeriodEnd] = React.useState(() =>
        format(addDays(getSydneyNow(), 34), 'yyyy-MM-dd'));
    const [result, setResult] = React.useState<GenerateRunResult | null>(null);
    const [confirmOpen, setConfirmOpen] = React.useState(false);

    // The scope header owns the org / department / sub-department choice, so
    // this page does not carry a second, rival picker. `singleSelectLevels`
    // constrains sub-department to one, because Baseline generates for one team.
    //
    // The selection is read as a SET, not as `[0]`. Reading the first entry of a
    // scope array is a known defect class here -- thirteen-plus pages silently
    // show one organisation's data to someone who can see several -- and this
    // feature writes shifts, so a wrong guess creates real rosters. More than
    // one selected is reported, never resolved.
    const selectedSubdeptIds = scope.subdept_ids ?? [];
    const subDepartmentId = selectedSubdeptIds.length === 1 ? selectedSubdeptIds[0] : null;
    const tooManySubDepts = selectedSubdeptIds.length > 1;

    const subDepts = useRosterableSubDepartments(selectedSubdeptIds);
    const patterns = useBaselinePatterns(subDepartmentId);
    const ftProfile = useFtProfile(subDepartmentId);
    const generate = useGenerateBaseline();
    const apply = useApplyBaseline();
    const createPattern = useCreateBaselinePattern();

    const selectedSubDept = subDepts.data?.find(s => s.id === subDepartmentId) ?? null;
    const selectedPattern = patterns.data?.find(p => p.id === templateId) ?? null;

    // Changing the team invalidates the pattern and any proposal built on it.
    React.useEffect(() => {
        setTemplateId(null);
        setResult(null);
    }, [subDepartmentId]);

    const handleCreatePattern = async (args: {
        name: string; days: import('../../domain/types').IsoWeekday[];
        startTime: string; unpaidBreakMinutes: number; roleId: string;
    }) => {
        if (!selectedSubDept || !ftProfile.data) return;
        const design = designPattern({
            weeklyHours: ftProfile.data.weeklyHours,
            days: args.days,
            startTime: args.startTime,
            unpaidBreakMinutes: args.unpaidBreakMinutes,
            roleId: args.roleId,
        });
        try {
            const res = await createPattern.mutateAsync({
                organizationId: selectedSubDept.organizationId,
                departmentId: selectedSubDept.departmentId,
                subDepartmentId: selectedSubDept.id,
                name: args.name,
                slots: design.slots,
                contractedWeeklyHours: ftProfile.data.weeklyHours,
                cycleWeeks: ftProfile.data.cycleWeeks,
                roleId: args.roleId,
            });
            if (res.templateId) {
                setDesignerOpen(false);
                setTemplateId(res.templateId);
                toast({
                    title: 'Pattern created',
                    description: `${design.slots.length} shifts a week at ${design.hoursPerDay.toFixed(1)}h each.`,
                });
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Could not create the pattern',
                    description: res.findings.find(f => f.severity === 'BLOCKING')?.plain,
                });
            }
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Could not create the pattern',
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const canGenerate = Boolean(
        selectedSubDept && selectedPattern?.eligible && periodStart && periodEnd
        && periodEnd >= periodStart && user?.id,
    );

    const handleGenerate = async () => {
        if (!selectedSubDept || !templateId || !user?.id) return;
        setResult(null);
        try {
            const res = await generate.mutateAsync({
                organizationId: selectedSubDept.organizationId,
                departmentId: selectedSubDept.departmentId,
                subDepartmentId: selectedSubDept.id,
                templateId,
                periodStart,
                periodEnd,
                referenceDate: today,
                actorId: user.id,
            });
            setResult(res);
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Could not generate a baseline',
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const handleApply = async () => {
        if (!result?.runId || !user?.id) return;
        setConfirmOpen(false);
        try {
            const res = await apply.mutateAsync({
                runId: result.runId,
                actorId: user.id,
                resolveTarget: resolveRosterTarget,
            });

            toast({
                title: res.skipped.length === 0
                    ? `${res.created} draft shift${res.created === 1 ? '' : 's'} created`
                    : `${res.created} created, ${res.skipped.length} skipped`,
                description: res.skipped.length === 0
                    ? 'Nothing has been published.'
                    : res.skipped[0].reason,
            });
            setResult(null);
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Could not apply the baseline',
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const proposal = result?.proposal ?? null;
    const blockingFindings = proposal?.runFindings.filter(f => f.severity === 'BLOCKING') ?? [];
    const otherFindings = proposal?.runFindings.filter(f => f.severity !== 'BLOCKING') ?? [];

    return (
        <div className="flex flex-col gap-5 p-3 sm:gap-6 sm:p-6">
            <GoldStandardHeader
                title="Baseline FT Schedule"
                Icon={CalendarRange}
                mode="managerial"
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                // Baseline generates for ONE team, so the sub-department is a
                // single choice. Org and department stay multi so the picker
                // behaves like every other page above that level.
                singleSelectLevels={['subdept']}
            />

            <p className={cn(text.bodyMuted, 'max-w-prose -mt-3')}>
                Work out what each full-time employee is contractually owed over a period,
                reconcile it against the roster and leave that already exist, and propose only the
                shifts that are valid under the Agreement.
            </p>

            {/* ── Step 1: scope ─────────────────────────────────────────── */}
            <section className="rounded-lg border bg-card p-4">
                <h2 className={cn(text.overline, 'mb-3')}>1 · Team and pattern</h2>

                <div className="grid gap-4 lg:grid-cols-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="bft-pattern" className={text.label}>Baseline pattern</Label>
                        <Select
                            value={templateId ?? undefined}
                            onValueChange={v => { setTemplateId(v); setResult(null); }}
                            disabled={!subDepartmentId || patterns.isLoading}
                        >
                            <SelectTrigger id="bft-pattern" className={touch.targetY}>
                                <SelectValue
                                    placeholder={subDepartmentId ? 'Choose a pattern' : 'Choose a team above'}
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {(patterns.data ?? []).map(p => (
                                    // Ineligible patterns stay VISIBLE and disabled with the
                                    // reason attached. A missing option is a support ticket;
                                    // a disabled one with a stated cause is a fixable problem.
                                    <SelectItem key={p.id} value={p.id} disabled={!p.eligible}>
                                        <span className="flex items-baseline gap-2">
                                            <span>{p.name}</span>
                                            <span className={text.subtle}>
                                                {p.eligible
                                                    ? `${p.usableShifts} full-time shift${p.usableShifts === 1 ? '' : 's'}`
                                                    : p.reason}
                                            </span>
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="bft-start" className={text.label}>Period starts</Label>
                        <Input
                            id="bft-start" type="date" value={periodStart}
                            className={touch.targetY}
                            onChange={e => { setPeriodStart(e.target.value); setResult(null); }}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="bft-end" className={text.label}>Period ends</Label>
                        <Input
                            id="bft-end" type="date" value={periodEnd}
                            className={touch.targetY}
                            onChange={e => { setPeriodEnd(e.target.value); setResult(null); }}
                        />
                    </div>
                </div>

                {tooManySubDepts && (
                    <p className={cn(text.caption, 'mt-3')}>
                        {selectedSubdeptIds.length} sub-departments are selected. Baseline generates
                        for one team at a time — narrow the scope above to choose which.
                    </p>
                )}

                {subDepartmentId && ftProfile.data?.employeeCount === 0 && (
                    <p className={cn(text.caption, 'mt-3')}>
                        No full-time employees are contracted to this team, so there is no baseline
                        to generate.
                    </p>
                )}

                {/* The pattern is the thing most likely to be missing, because
                    nothing else in the product creates one shaped for a
                    full-time contract. Offering to build it here is the
                    difference between an empty picker and a dead end. */}
                {subDepartmentId && !patterns.isLoading && (patterns.data ?? []).every(p => !p.eligible) && (
                    <div className="mt-3 rounded-lg border border-dashed p-3">
                        <p className={text.body}>
                            {(patterns.data ?? []).length === 0
                                ? 'This team has no baseline pattern yet.'
                                : 'None of this team’s templates can be used as a baseline pattern.'}
                        </p>
                        <p className={cn(text.caption, 'mt-0.5')}>
                            A pattern describes the normal full-time week. The day length is worked
                            out from the contract, so it adds up exactly.
                        </p>
                        <Button
                            variant="outline"
                            className={cn(touch.targetY, 'mt-2.5')}
                            disabled={!ftProfile.data || ftProfile.data.roles.length === 0}
                            onClick={() => setDesignerOpen(true)}
                        >
                            <Wand2 className="mr-2 h-4 w-4" aria-hidden="true" />
                            Design a pattern
                        </Button>
                        {ftProfile.data && ftProfile.data.roles.length === 0 && (
                            <p className={cn(text.caption, 'mt-1.5')}>
                                No full-time contracts here name a role, so there is nothing to
                                roster yet.
                            </p>
                        )}
                    </div>
                )}

                {ftProfile.data?.weeklyHoursVaries && (
                    <p className={cn(text.caption, 'mt-3')}>
                        Full-time contracts on this team do not all specify the same weekly hours.
                        A designed pattern uses the smallest, {ftProfile.data.weeklyHours}h, so it
                        cannot over-roster anyone.
                    </p>
                )}

                <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <Button
                        onClick={handleGenerate}
                        disabled={!canGenerate || generate.isPending}
                        className={touch.targetY}
                    >
                        {generate.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        )}
                        Generate baseline
                    </Button>
                    <span className={text.caption}>
                        Generating reads the roster. It does not change anything.
                    </span>
                </div>
            </section>

            {/* ── Step 2: pattern check ─────────────────────────────────── */}
            {proposal && blockingFindings.length > 0 && (
                <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                    <div className="mb-3 flex items-center gap-2">
                        <TriangleAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
                        <h2 className={cn(text.heading, 'text-destructive')}>
                            This pattern cannot be used
                        </h2>
                    </div>
                    <p className={cn(text.bodyMuted, 'mb-3 max-w-prose')}>
                        Nothing was generated. Fix the pattern and generate again — a baseline built
                        on an unlawful pattern would repeat it on every roster.
                    </p>
                    <FindingList findings={blockingFindings} showCalculation />
                </section>
            )}

            {/* ── Step 3: review ────────────────────────────────────────── */}
            {proposal && !result?.aborted && (
                <>
                    <section className="space-y-3">
                        <h2 className={text.overline}>
                            2 · {selectedSubDept?.name} · {proposal.periodStart} to {proposal.periodEnd}
                        </h2>
                        <BaselineSummary proposal={proposal} />
                    </section>

                    {proposal.ledgers.length === 0 ? (
                        <PageState
                            state="empty"
                            scope="section"
                            title="No full-time employees to schedule"
                            description="No wholly full-time contracts are active for this team in this period."
                        />
                    ) : (
                        <section className="space-y-3">
                            <BaselineLedgerTable proposal={proposal} />
                            <p className={cn(text.caption, 'max-w-prose')}>
                                A variance is not a failure. When the hours left are fewer than a
                                full working day, no shift is proposed — a full-time day cannot be
                                shorter than 7.6 hours (ICC EBA cl 35.1(c)). Open a row to see the
                                reasoning.
                            </p>
                        </section>
                    )}

                    {otherFindings.length > 0 && (
                        <section className="rounded-lg border bg-card p-4">
                            <h3 className={cn(text.overline, 'mb-2')}>About this run</h3>
                            <FindingList findings={otherFindings} showCalculation />
                        </section>
                    )}

                    {proposal.axioms.length > 0 && (
                        <section className="rounded-lg border border-dashed p-4">
                            <h3 className={cn(text.overline, 'mb-2')}>Assumptions</h3>
                            <ul className="space-y-1">
                                {proposal.axioms.map(a => (
                                    <li key={a} className={text.caption}>{a}</li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {/* ── Step 4: apply ─────────────────────────────────── */}
                    {proposal.totals.proposedShiftCount > 0 && (
                        <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
                            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            <span className={text.body}>
                                {proposal.totals.proposedShiftCount} shift
                                {proposal.totals.proposedShiftCount === 1 ? '' : 's'} for{' '}
                                {proposal.ledgers.filter(l => l.proposed.length > 0).length} employee
                                {proposal.ledgers.filter(l => l.proposed.length > 0).length === 1 ? '' : 's'},
                                totalling {fmtHours(proposal.totals.proposedHours)}.
                            </span>
                            <Button
                                className={cn(touch.targetY, 'w-full sm:ml-auto sm:w-auto')}
                                onClick={() => setConfirmOpen(true)}
                                disabled={apply.isPending || !result?.runId}
                            >
                                {apply.isPending && (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                )}
                                Create drafts
                            </Button>
                        </section>
                    )}
                </>
            )}

            {subDepts.isError && (
                <PageState
                    state="error"
                    scope="section"
                    title="Could not load your teams"
                    onRetry={() => void subDepts.refetch()}
                />
            )}

            {selectedSubDept && ftProfile.data && (
                <PatternDesignerDialog
                    open={designerOpen}
                    onOpenChange={setDesignerOpen}
                    roles={ftProfile.data.roles}
                    contractedWeeklyHours={ftProfile.data.weeklyHours}
                    subDepartmentName={selectedSubDept.name}
                    isSaving={createPattern.isPending}
                    onCreate={handleCreatePattern}
                />
            )}

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Create these shifts as drafts?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2">
                                <p>
                                    {proposal?.totals.proposedShiftCount} shift
                                    {proposal?.totals.proposedShiftCount === 1 ? '' : 's'} will be
                                    created as drafts and assigned to their employees.
                                </p>
                                <p>
                                    No existing shift will be changed or deleted, and nothing will
                                    be published. Anything that no longer fits will be skipped with
                                    a reason.
                                </p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className={touch.targetY}>Cancel</AlertDialogCancel>
                        <AlertDialogAction className={touch.targetY} onClick={handleApply}>
                            Create drafts
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default BaselineFtPage;
