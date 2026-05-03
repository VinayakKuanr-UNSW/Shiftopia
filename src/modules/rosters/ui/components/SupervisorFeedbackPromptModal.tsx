import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/modules/core/ui/primitives/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import { Label } from '@/modules/core/ui/primitives/label';
import { RadioGroup, RadioGroupItem } from '@/modules/core/ui/primitives/radio-group';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Slider } from '@/modules/core/ui/primitives/slider';
import { Textarea } from '@/modules/core/ui/primitives/textarea';

import {
    FUNCTION_CODES,
    REASON_CODES,
    REASON_LABELS,
    type FeedbackVerdict,
    type FunctionCode,
    type ReasonCode,
} from '../../api/supervisorFeedback.dto';
import { useSubmitFeedback } from '../../state/useSupervisorFeedback';

/**
 * Demand Engine L5 — post-event supervisor feedback prompt.
 *
 * Designed to be shown right after an event completes. Captures one structured
 * feedback row at a time (one bucket: function + level + slice range).
 * For multi-bucket feedback, render the modal multiple times.
 */

export interface SupervisorFeedbackPromptModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** VenueOps event_id (text). Null is allowed for ad-hoc feedback. */
    eventId: string | null;
    /** Optional pre-fill: function this prompt is asking about. */
    defaultFunctionCode?: FunctionCode;
    /** Optional pre-fill: level (0–7). */
    defaultLevel?: number;
    /** Optional pre-fill: slice range (0–47, inclusive). */
    defaultSliceStart?: number;
    defaultSliceEnd?: number;
    /** Stamps rule_version_at_event so multipliers can be filtered by generation. */
    ruleVersionAtEvent?: number;
    /** Called after a successful submission. */
    onSubmitted?: () => void;
}

const VERDICT_OPTIONS: Array<{ value: FeedbackVerdict; label: string; hint: string }> = [
    { value: 'UNDER', label: 'Under-staffed', hint: 'We needed more people' },
    { value: 'OVER', label: 'Over-staffed', hint: 'We had too many people' },
    { value: 'OK', label: 'About right', hint: 'Staffing matched demand' },
];

const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export function SupervisorFeedbackPromptModal({
    open,
    onOpenChange,
    eventId,
    defaultFunctionCode,
    defaultLevel,
    defaultSliceStart,
    defaultSliceEnd,
    ruleVersionAtEvent,
    onSubmitted,
}: SupervisorFeedbackPromptModalProps) {
    const submit = useSubmitFeedback();

    const [verdict, setVerdict] = useState<FeedbackVerdict>('OK');
    const [functionCode, setFunctionCode] = useState<FunctionCode>(
        defaultFunctionCode ?? 'F&B',
    );
    const [level, setLevel] = useState<number>(defaultLevel ?? 1);
    const [sliceStart, setSliceStart] = useState<number>(defaultSliceStart ?? 0);
    const [sliceEnd, setSliceEnd] = useState<number>(defaultSliceEnd ?? 47);
    const [severity, setV8Severity] = useState<number>(3);
    const [reasonCode, setReasonCode] = useState<ReasonCode>('peak_underestimated');
    const [reasonNote, setReasonNote] = useState<string>('');

    // OK verdicts have no meaningful severity / reason — disable those inputs.
    const verdictNeedsReason = verdict !== 'OK';
    const noteRequired = reasonCode === 'other_with_note';

    const sliceRangeLabel = useMemo(() => {
        return `${formatSliceTime(sliceStart)} – ${formatSliceTime(sliceEnd + 1)}`;
    }, [sliceStart, sliceEnd]);

    const canSubmit =
        sliceStart <= sliceEnd &&
        (!noteRequired || reasonNote.trim().length > 0) &&
        !submit.isPending;

    const handleSubmit = async () => {
        try {
            await submit.mutateAsync({
                event_id: eventId,
                function_code: functionCode,
                level,
                slice_start: sliceStart,
                slice_end: sliceEnd,
                verdict,
                // OK verdicts get severity=1 server-side (constraint requires 1–5).
                severity: verdictNeedsReason ? severity : 1,
                // OK still records a reason for completeness, but UI hides it.
                reason_code: verdictNeedsReason ? reasonCode : 'peak_underestimated',
                reason_note: reasonNote.trim().length > 0 ? reasonNote.trim() : null,
                rule_version_at_event: ruleVersionAtEvent ?? null,
            });
            toast.success('Feedback recorded — thank you.');
            onSubmitted?.();
            onOpenChange(false);
            resetForm();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            toast.error(`Could not save feedback: ${msg}`);
        }
    };

    const resetForm = () => {
        setVerdict('OK');
        setV8Severity(3);
        setReasonCode('peak_underestimated');
        setReasonNote('');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>How was staffing?</DialogTitle>
                    <DialogDescription>
                        Quick post-event check. This feeds the demand engine so future events
                        of this type are predicted better.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Verdict */}
                    <div>
                        <Label className="mb-2 block">Verdict</Label>
                        <RadioGroup
                            value={verdict}
                            onValueChange={(v) => setVerdict(v as FeedbackVerdict)}
                            className="grid grid-cols-3 gap-2"
                        >
                            {VERDICT_OPTIONS.map((opt) => (
                                <label
                                    key={opt.value}
                                    htmlFor={`verdict-${opt.value}`}
                                    className="flex cursor-pointer flex-col rounded-md border border-border p-3 hover:bg-accent"
                                >
                                    <div className="flex items-center gap-2">
                                        <RadioGroupItem value={opt.value} id={`verdict-${opt.value}`} />
                                        <span className="font-medium">{opt.label}</span>
                                    </div>
                                    <span className="ml-6 text-xs text-muted-foreground">{opt.hint}</span>
                                </label>
                            ))}
                        </RadioGroup>
                    </div>

                    {/* Function + Level */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label htmlFor="function" className="mb-2 block">Function</Label>
                            <Select
                                value={functionCode}
                                onValueChange={(v) => setFunctionCode(v as FunctionCode)}
                            >
                                <SelectTrigger id="function">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {FUNCTION_CODES.map((fc) => (
                                        <SelectItem key={fc} value={fc}>{fc}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label htmlFor="level" className="mb-2 block">Level</Label>
                            <Select
                                value={String(level)}
                                onValueChange={(v) => setLevel(Number(v))}
                            >
                                <SelectTrigger id="level">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {LEVELS.map((l) => (
                                        <SelectItem key={l} value={String(l)}>
                                            L{l} {l <= 4 ? '(Casual)' : '(Full Time)'}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Slice range */}
                    <div>
                        <div className="mb-2 flex items-center justify-between">
                            <Label>Time range</Label>
                            <span className="text-xs text-muted-foreground">{sliceRangeLabel}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <Select
                                value={String(sliceStart)}
                                onValueChange={(v) => setSliceStart(Number(v))}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {sliceOptions().map((s) => (
                                        <SelectItem key={s.value} value={String(s.value)}>
                                            {s.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select
                                value={String(sliceEnd)}
                                onValueChange={(v) => setSliceEnd(Number(v))}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {sliceOptions().map((s) => (
                                        <SelectItem key={s.value} value={String(s.value)}>
                                            {s.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* V8Severity (UNDER/OVER only) */}
                    {verdictNeedsReason && (
                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <Label htmlFor="severity">V8Severity</Label>
                                <span className="text-xs text-muted-foreground">{severity} / 5</span>
                            </div>
                            <Slider
                                id="severity"
                                min={1}
                                max={5}
                                step={1}
                                value={[severity]}
                                onValueChange={(v) => setV8Severity(v[0] ?? 3)}
                            />
                            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                                <span>Mild</span><span>Significant</span><span>Critical</span>
                            </div>
                        </div>
                    )}

                    {/* Reason (UNDER/OVER only) */}
                    {verdictNeedsReason && (
                        <div>
                            <Label htmlFor="reason" className="mb-2 block">Reason</Label>
                            <Select
                                value={reasonCode}
                                onValueChange={(v) => setReasonCode(v as ReasonCode)}
                            >
                                <SelectTrigger id="reason">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {REASON_CODES.map((rc) => (
                                        <SelectItem key={rc} value={rc}>
                                            {REASON_LABELS[rc]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Note (always visible; required when reason = other_with_note) */}
                    <div>
                        <Label htmlFor="note" className="mb-2 block">
                            Note{noteRequired ? ' (required)' : ' (optional)'}
                        </Label>
                        <Textarea
                            id="note"
                            value={reasonNote}
                            onChange={(e) => setReasonNote(e.target.value)}
                            placeholder={
                                noteRequired
                                    ? 'Describe what happened — required when reason is "Other".'
                                    : 'Anything else worth recording?'
                            }
                            rows={3}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!canSubmit}>
                        {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Submit feedback
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Slice index 0..47 → "HH:mm" (30-min grid, 0 = 00:00). */
function formatSliceTime(sliceIdx: number): string {
    const clamped = Math.max(0, Math.min(48, sliceIdx));
    const totalMin = clamped * 30;
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return `${pad2(h)}:${pad2(m)}`;
}

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

function sliceOptions(): Array<{ value: number; label: string }> {
    const out: Array<{ value: number; label: string }> = [];
    for (let i = 0; i < 48; i++) {
        out.push({ value: i, label: formatSliceTime(i) });
    }
    return out;
}
