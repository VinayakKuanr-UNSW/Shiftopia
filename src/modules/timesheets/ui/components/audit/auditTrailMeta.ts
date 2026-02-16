import {
    Plus, Check, FileClock, Users2, UserPlus, Loader2, RotateCcw, Clock,
    Pause, Pencil, Repeat, RotateCw, XCircle, AlertTriangle, Trash2,
    ShieldCheck,
} from "lucide-react";
import type { FC } from "react";
import type { TimesheetAuditAction } from "../../model/audit.types";

/*───────────────────────────────────────────────────────────*\
 ░█▀▄░█░█░█▀▄░█▀█░█▄█░▀█▀░█░░
 ░█▀▄░█░█░█▀▄░█░█░█░█░░█░░█░░
 ░▀▀░░▀▀▀░▀░▀░▀▀▀░▀░▀░▀▀▀░▀▀▀   All audit‑trail states
\*───────────────────────────────────────────────────────────*/

/* A11Y colours – AA contrast checked on #131516 background */
const blue400 = "text-sky-400";
const blue500 = "text-sky-500";
const indigo400 = "text-indigo-400";
const slGray = "text-slate-400";
const purple = "text-violet-400";
const teal400 = "text-teal-400";
const teal500 = "text-teal-500";
const green500 = "text-emerald-500";
const yellow400 = "text-amber-400";
const red400 = "text-rose-400";
const red500 = "text-rose-500";
const orange = "text-orange-400";

export const EVENT_META: Record<
    TimesheetAuditAction | string,
    { label: string; sub: string; color: string; Icon: FC<any> }
> = {
    /* 1 ── Creation ───────────────────────────────────────── */
    CREATED: { label: "Draft created", sub: "Template/manual", color: blue400, Icon: Plus },
    SUBMITTED: { label: "Submitted", sub: "By employee", color: blue500, Icon: Check },

    /* 2 ── Processing ─────────────────────────────────────── */
    APPROVED: { label: "Approved", sub: "By manager/system", color: green500, Icon: Check },
    REJECTED: { label: "Rejected", sub: "Needs correction", color: red400, Icon: XCircle },
    LOCKED: { label: "Locked", sub: "Payroll processed", color: slGray, Icon: ShieldCheck },

    /* 3 ── Edits ──────────────────────────────────────────── */
    EDITED: { label: "Edited", sub: "Adjustments made", color: purple, Icon: Pencil },

    /* Fallback */
    UNKNOWN: { label: "Unknown Action", sub: "System event", color: slGray, Icon: AlertTriangle },
};
