import React from 'react';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Button } from '@/modules/core/ui/primitives/button';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';

export interface UnfilledShift {
  id: string;
  title: string;
  role: string;
  department?: string;
  date: string; // yyyy-MM-dd
  start: string; // HH:MM
  end: string;   // HH:MM
}

interface UnfilledShiftsPanelProps {
  unfilledShifts: UnfilledShift[];
  onPickShift?: (shift: UnfilledShift) => void;
  width?: string;
}

export const UnfilledShiftsPanel: React.FC<UnfilledShiftsPanelProps> = ({
  unfilledShifts,
  onPickShift,
  width = 'w-80'
}) => {
  return (
    <div className={cn(`${width} border-l border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1424] flex flex-col`)}>
      <div className="p-4 border-b border-slate-200 dark:border-white/10">
        <h3 className="font-semibold text-slate-800 dark:text-white text-sm">Unfilled Shifts</h3>
        <p className="text-xs text-slate-500 dark:text-white/60 mt-1">
          Drag or click to assign a shift
        </p>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {unfilledShifts.length === 0 && (
            <div className="text-slate-500 dark:text-white/60 text-sm">No unfilled shifts</div>
          )}

          {unfilledShifts.map((s) => {
            const dateObj = new Date(s.date);
            return (
              <div
                key={s.id}
                className="p-3 rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100 dark:hover:bg-white/5 transition-all cursor-move"
                role="button"
                onClick={() => onPickShift?.(s)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/json', JSON.stringify(s));
                }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 dark:text-white text-xs truncate">{s.title}</div>
                    <div className="text-slate-600 dark:text-white/80 text-[11px] truncate">{s.role}</div>
                  </div>
                  <div className={cn(
                    'w-2 h-8 rounded-full ml-2',
                    s.department === 'Convention' ? 'bg-blue-500' :
                    s.department === 'Exhibition' ? 'bg-green-500' :
                    s.department === 'Theatre' ? 'bg-red-500' : 'bg-slate-300 dark:bg-white/30'
                  )} />
                </div>

                <div className="text-slate-500 dark:text-white/70 text-[11px] mb-1">
                  {s.start} - {s.end}
                </div>
                <div className="text-slate-400 dark:text-white/60 text-[10px]">{format(dateObj, 'EEE, MMM d')}</div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-slate-200 dark:border-white/10">
        <Button size="sm" className="w-full">Create Unfilled Shift</Button>
      </div>
    </div>
  );
};

export default UnfilledShiftsPanel;
