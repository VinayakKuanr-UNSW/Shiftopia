import React, { useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Zap, ShieldCheck, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/modules/core/ui/primitives/button";
import { Badge } from "@/modules/core/ui/primitives/badge";
import { cn } from "@/modules/core/lib/utils";

export interface GenerationOptions {
  mergeMicroPeaks: boolean;
  enforceMinMax: boolean; // 3h/12h bounds
  enforceSupervisorRatios: boolean;
  enforceMinimumStaff: boolean;
}

export const DEFAULT_OPTIONS: GenerationOptions = {
  mergeMicroPeaks: true,
  enforceMinMax: true,
  enforceSupervisorRatios: true,
  enforceMinimumStaff: true,
};

export interface PreviewGroup {
  roleName: string;
  count: number;
  totalHours: number;
}

export interface ComplianceWarning {
  severity: "warn" | "info";
  message: string;
}

interface ConfirmGenerationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (options: GenerationOptions) => void;
  isPending: boolean;

  scopeLabel: string; // e.g. "F&B · 2026-04-10"
  previewGroups: PreviewGroup[];
  deletionGroups?: PreviewGroup[];
  totalShifts: number;
  totalHours: number;
  suggestedDeletionsCount?: number;
  isIdempotent?: boolean;
  complianceWarnings: ComplianceWarning[];
  hasMlError: boolean;
}

export const ConfirmGenerationModal: React.FC<ConfirmGenerationModalProps> = ({
  open,
  onClose,
  onConfirm,
  isPending,
  scopeLabel,
  previewGroups,
  deletionGroups,
  totalShifts,
  totalHours,
  suggestedDeletionsCount = 0,
  isIdempotent = false,
  complianceWarnings,
  hasMlError,
}) => {
  const [options, setOptions] = useState<GenerationOptions>(DEFAULT_OPTIONS);

  if (!open) return null;

  const disabled =
    isPending ||
    (totalShifts === 0 && !suggestedDeletionsCount) ||
    isIdempotent;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-gen-modal-title"
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3
              id="confirm-gen-modal-title"
              className="font-bold text-foreground"
            >
              {totalShifts === 0 && suggestedDeletionsCount > 0
                ? "Confirm & Adjust"
                : "Confirm & Inject"}
            </h3>
            <p className="text-xs text-muted-foreground">{scopeLabel}</p>
          </div>
        </div>

        {/* Summary — short, since full preview is already on the page */}
        <div className="bg-background/50 border border-border/40 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">About to create</span>
            <Badge className="text-xs bg-primary/15 text-primary border border-primary/30">
              {totalShifts} shifts · {totalHours.toFixed(1)}h
            </Badge>
          </div>
          {previewGroups.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-1">
              {isIdempotent
                ? "This generation has already been applied. No new shifts needed."
                : "No shifts to generate — demand is already covered."}
            </p>
          ) : (
            <div className="space-y-0.5 max-h-32 overflow-auto text-xs">
              {previewGroups.map((g, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-foreground">{g.roleName}</span>
                  <span className="text-muted-foreground">
                    {g.count} · {g.totalHours.toFixed(1)}h
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {suggestedDeletionsCount > 0 && (
          <div className="bg-background/50 border border-border/40 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-amber-500">
                About to delete
              </span>
              <Badge className="text-xs bg-amber-500/15 text-amber-500 border border-amber-500/30">
                {suggestedDeletionsCount} unassigned shifts
              </Badge>
            </div>
            {deletionGroups && deletionGroups.length > 0 ? (
              <div className="space-y-0.5 max-h-32 overflow-auto text-xs">
                {deletionGroups.map((g, i) => (
                  <div
                    key={`del-${i}`}
                    className="flex items-center justify-between"
                  >
                    <span className="text-foreground">{g.roleName}</span>
                    <span className="text-muted-foreground">
                      {g.count} · {g.totalHours.toFixed(1)}h
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-2 flex items-start gap-2 mt-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <div className="text-xs text-amber-400">
                  To meet new demand constraints, these unassigned draft shifts
                  will be safely replaced.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Generation Options (PRD task 7) */}
        <div className="bg-background/50 border border-border/40 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold">Options</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5 text-xs">
            {(
              [
                ["mergeMicroPeaks", "Merge micro peaks (<1h)"],
                ["enforceMinMax", "Enforce 3h min / 12h max"],
                ["enforceSupervisorRatios", "Enforce supervisor ratios"],
                ["enforceMinimumStaff", "Enforce minimum staff"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-2 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) =>
                    setOptions((o) => ({ ...o, [key]: e.target.checked }))
                  }
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Compliance warnings (PRD task 8) */}
        {(complianceWarnings.length > 0 || hasMlError) && (
          <div className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-3 mb-4 space-y-1.5">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs font-semibold text-amber-400">
                Warnings
              </span>
            </div>
            {hasMlError && (
              <div className="flex items-start gap-2 text-[11px] text-amber-400">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  ML service returned errors. Demand may be incomplete.
                </span>
              </div>
            )}
            {complianceWarnings.map((w, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2 text-[11px]",
                  w.severity === "warn"
                    ? "text-amber-400"
                    : "text-muted-foreground",
                )}
              >
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer (PRD task 9) */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 gap-2"
            onClick={() => onConfirm(options)}
            disabled={disabled}
          >
            {isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            {isPending
              ? "Generating…"
              : totalShifts === 0 && suggestedDeletionsCount > 0
                ? "Confirm & Adjust"
                : "Confirm & Inject"}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
};
