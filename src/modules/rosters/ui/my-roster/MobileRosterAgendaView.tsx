import React, { useState } from 'react';
import { format } from 'date-fns';
import { Calendar } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { listItemSpring } from '@/modules/core/ui/motion/presets';
import { cn } from '@/modules/core/lib/utils';
import { isTodayInTimezone } from '@/modules/core/lib/date.utils';
import { Shift } from '@/modules/rosters';
import { MobileShiftCard } from './MobileShiftCard';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import './MobileRosterAgendaView.css';

interface ShiftWithDetails {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
}

interface MobileRosterAgendaViewProps {
  days: Date[];
  getShiftsForDate: (
    date: Date,
    options?: { includeContinuations?: boolean },
  ) => ShiftWithDetails[];
  includeContinuations?: boolean;
}

const SYDNEY_TZ = 'Australia/Sydney';

const MobileRosterAgendaView: React.FC<MobileRosterAgendaViewProps> = ({
  days,
  getShiftsForDate,
  includeContinuations,
}) => {
  const [selectedShift, setSelectedShift] = useState<{
    data: ShiftWithDetails;
    date: Date;
  } | null>(null);

  const dayGroups = days.map((day) => ({
    day,
    shifts: getShiftsForDate(
      day,
      includeContinuations === undefined ? undefined : { includeContinuations },
    ),
  }));

  const totalShifts = dayGroups.reduce((sum, group) => sum + group.shifts.length, 0);

  return (
    <div className="h-full min-h-0 overflow-y-auto px-3 py-3 pb-32 scrollbar-none">
      {totalShifts === 0 ? (
        <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/20">
            <Calendar className="h-8 w-8 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-black uppercase tracking-widest text-muted-foreground/35">
            No shifts scheduled
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {dayGroups.map(({ day, shifts }) => {
            const isToday = isTodayInTimezone(day, SYDNEY_TZ);

            return (
              <section key={day.toISOString()} className="space-y-2">
                <div
                  className={cn(
                    'mobile-roster-date-glass sticky top-0 z-30 flex items-center justify-between overflow-hidden px-3 py-2',
                    isToday
                      ? 'text-primary'
                      : 'text-foreground',
                  )}
                >
                  <div>
                    <h3 className="text-[12px] font-black uppercase tracking-[0.16em]">
                      {format(day, 'EEE, d MMM')}
                    </h3>
                    {isToday && (
                      <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em]">
                        Today
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                    {shifts.length} {shifts.length === 1 ? 'shift' : 'shifts'}
                  </span>
                </div>

                <AnimatePresence mode="popLayout">
                  {shifts.length > 0 ? (
                    <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/40">
                      {shifts.map((shiftData) => (
                        <motion.div
                          key={shiftData.shift.id}
                          {...listItemSpring}
                          className="border-b border-foreground/[0.03] last:border-b-0"
                        >
                          <MobileShiftCard
                            shiftData={shiftData}
                            selectedDay={day}
                            onClick={() => setSelectedShift({ data: shiftData, date: day })}
                          />
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <motion.div
                      key={`${day.toISOString()}-empty`}
                      {...listItemSpring}
                      className="rounded-2xl border border-dashed border-border/50 px-4 py-5 text-center"
                    >
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
                        No shifts
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            );
          })}
        </div>
      )}

      <ShiftDetailsDialog
        isOpen={!!selectedShift}
        onClose={() => setSelectedShift(null)}
        shiftData={selectedShift?.data || null}
        shiftDate={selectedShift?.date || new Date()}
      />
    </div>
  );
};

export default MobileRosterAgendaView;
