import React from "react";
import { X, User, Calendar, Clock, Info } from "lucide-react";
import { ShiftStatusBadge } from "./ShiftStatusBadge";
import * as Dialog from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

interface ShiftHistoryDrawerProps {
    shiftId: string;
    isOpen: boolean;
    onClose: () => void;
    data: any;
}

export const ShiftHistoryDrawer: React.FC<ShiftHistoryDrawerProps> = ({
    shiftId,
    isOpen,
    onClose,
    data,
}) => {
    if (!data) return null;

    const hasReplacements =
        Array.isArray(data.replacementEmployees) &&
        data.replacementEmployees.length > 0;

    return (
        <Dialog.Root open={isOpen} onOpenChange={(open) => open || onClose()}>
            <Dialog.Portal>
                {/* Overlay */}
                <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />

                {/* Drawer */}
                <Dialog.Content
                    className="
            fixed right-0 top-0 bottom-0 z-50
            w-full sm:w-[400px]
            flex flex-col
            bg-black/80 backdrop-blur-lg
            border-l border-white/10
            overflow-auto
            animate-slide-in-right
          "
                    aria-describedby="shift-history-desc"
                >
                    {/**
            * 1️⃣ Dialog.Title must be an immediate child of Dialog.Content
            * 2️⃣ Wrapping in VisuallyHidden satisfies a11y without
            * altering your visible header
            */}
                    <Dialog.Title asChild>
                        <VisuallyHidden>History for Shift {shiftId}</VisuallyHidden>
                    </Dialog.Title>

                    {/* Visible Header & Close */}
                    <header
                        className="
              p-4 border-b border-white/10
              flex items-center justify-between
            "
                    >
                        <h2 className="text-lg font-medium text-white">
                            History for Shift {shiftId}
                        </h2>
                        <Dialog.Close asChild>
                            <button
                                aria-label="Close"
                                className="
                  p-1 rounded-full bg-white/10 hover:bg-white/20
                  transition-colors
                "
                            >
                                <X className="h-5 w-5 text-white" />
                            </button>
                        </Dialog.Close>
                    </header>

                    {/* Body */}
                    <div
                        id="shift-history-desc"
                        className="flex-1 p-4 space-y-6 text-white"
                    >
                        {/* Shift details */}
                        <section className="space-y-2">
                            <h3 className="text-sm font-medium text-white/70">
                                Shift Details
                            </h3>
                            <div className="bg-black/20 rounded-md p-4 border border-white/10 space-y-3">
                                <div className="flex items-start space-x-3">
                                    <Calendar className="h-5 w-5 text-white/60 mt-0.5" />
                                    <div>
                                        <div className="text-sm font-medium">ID: {shiftId}</div>
                                        <div className="text-xs text-white/60">{data.date}</div>
                                    </div>
                                </div>

                                <div className="flex items-start space-x-3">
                                    <Info className="h-5 w-5 text-white/60 mt-0.5" />
                                    <div>
                                        <div className="text-sm font-medium">{data.position}</div>
                                        <div className="text-xs text-white/60">
                                            {data.location} • {data.subGroup}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-start space-x-3">
                                    <Clock className="h-5 w-5 text-white/60 mt-0.5" />
                                    <div>
                                        <div className="text-sm font-medium">
                                            {data.startTime} – {data.endTime}
                                        </div>
                                        <div className="text-xs text-white/60">
                                            {data.duration} hours shift
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Employee history */}
                        <section className="space-y-2">
                            <h3 className="text-sm font-medium text-white/70">
                                Employee History
                            </h3>
                            <div className="relative pl-6 border-l-2 border-white/20 space-y-6 py-2">
                                {/* Original employee */}
                                <div className="relative">
                                    <div className="absolute -left-[29px] w-5 h-5 rounded-full bg-black border-2 border-white/20 flex items-center justify-center">
                                        <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
                                    </div>
                                    <div className="bg-black/20 rounded-md p-4 border border-white/10">
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center space-x-3">
                                                <User className="h-8 w-8 text-white/60 bg-black/40 p-1.5 rounded-full" />
                                                <div>
                                                    <div className="text-sm font-medium">
                                                        {data.originalEmployee.name}
                                                    </div>
                                                    <div className="mt-1">
                                                        <ShiftStatusBadge
                                                            status={data.originalEmployee.status}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-xs text-white/60">
                                                Originally Assigned
                                            </div>
                                        </div>
                                        {data.originalEmployee.reason && (
                                            <div className="mt-3 text-sm text-white/80 bg-black/30 p-2 rounded border border-white/10">
                                                <strong>Reason:</strong> {data.originalEmployee.reason}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Replacement chain */}
                                {hasReplacements &&
                                    data.replacementEmployees.map((rep: any, idx: number) => (
                                        <div className="relative" key={rep.id}>
                                            <div className="absolute -left-[29px] w-5 h-5 rounded-full bg-black border-2 border-white/20 flex items-center justify-center">
                                                <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
                                            </div>
                                            <div
                                                className={`
                          bg-black/20 rounded-md p-4 border
                          border-white/10
                          ${idx === data.replacementEmployees.length - 1
                                                        ? "border-green-500/30"
                                                        : ""
                                                    }
                        `}
                                            >
                                                <div className="flex items-start justify-between">
                                                    <div className="flex items-center space-x-3">
                                                        <User className="h-8 w-8 text-white/60 bg-black/40 p-1.5 rounded-full" />
                                                        <div>
                                                            <div className="text-sm font-medium">
                                                                {rep.name}
                                                            </div>
                                                            <div className="mt-1">
                                                                <ShiftStatusBadge status={rep.status} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-xs text-white/60">
                                                        {idx === 0
                                                            ? "First Replacement"
                                                            : idx === data.replacementEmployees.length - 1
                                                                ? "Final Employee"
                                                                : `Replacement #${idx + 1}`}
                                                    </div>
                                                </div>

                                                {rep.reason && (
                                                    <div className="mt-3 text-sm text-white/80 bg-black/30 p-2 rounded border border-white/10">
                                                        <strong>Reason:</strong> {rep.reason}
                                                    </div>
                                                )}
                                                {rep.notes && (
                                                    <div className="mt-2 text-sm text-white/80 bg-black/30 p-2 rounded border border-white/10">
                                                        <strong>Notes:</strong> {rep.notes}
                                                    </div>
                                                )}

                                                {(rep.clockIn || rep.clockOut) && (
                                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                                        <div className="bg-black/30 p-2 rounded border border-white/10">
                                                            <div className="text-xs text-white/60">
                                                                Clock In
                                                            </div>
                                                            <div className="text-sm">
                                                                {rep.clockIn || "N/A"}
                                                            </div>
                                                        </div>
                                                        <div className="bg-black/30 p-2 rounded border border-white/10">
                                                            <div className="text-xs text-white/60">
                                                                Clock Out
                                                            </div>
                                                            <div className="text-sm">
                                                                {rep.clockOut || "N/A"}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </section>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
