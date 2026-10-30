import React, { useState } from 'react';
import { format } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { listItemSpring } from '@/modules/core/ui/motion/presets';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import { isTodayInTimezone } from '@/modules/core/lib/date.utils';
import { ShiftWithDetails } from '@/modules/rosters';
import { useNavigate } from 'react-router-dom';
import { CalendarX2 } from 'lucide-react';
import { PageState } from '@/modules/core/ui/components/PageState';
import { MobileShiftCard } from './MobileShiftCard';
import ShiftDetailsDialog from './ShiftDetailsDialog';
import './MobileRosterAgendaView.css';

interface MobileRosterAgendaViewProps {
  days: Date[];
  getShiftsForDate: (
    date: Date,
    options?: { includeContinuations?: boolean },
  ) => ShiftWithDetails[];
  includeContinuations?: boolean;
}

const SYDNEY_TZ = 'Australia/Sydney';

/**
 * My Roster — mobile agenda.
 *
 * Every day in the selected range gets a row, always. There used to be a
 * `totalShifts === 0` short-circuit that replaced the whole agenda with a
 * single centred "No shifts scheduled" panel, which meant an empty week lost
 * its structure entirely: no dates, no today marker, nothing to orient
 * against or scroll through — just a lone icon where a calendar should be.
 * An empty day is just its date row reading "No shifts" — it used to add a
 * dashed placeholder box too, so an empty week was a stack of seven boxes.
 * When the whole range is empty one PageState says so, with the next step.
 */
const MobileRosterAgendaView: React.FC<MobileRosterAgendaViewProps> = ({
  days,
  getShiftsForDate,
  includeContinuations,
}) => {
  const navigate = useNavigate();
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
      {/* Spoken once for the whole range, so a screen-reader user learns the
          range is empty without swiping through every day row to find out. */}
      <p className="sr-only" role="status">
        {totalShifts === 0
          ? `No shifts scheduled across ${dayGroups.length} ${dayGroups.length === 1 ? 'day' : 'days'}.`
          : `${totalShifts} ${totalShifts === 1 ? 'shift' : 'shifts'} across ${dayGroups.length} ${dayGroups.length === 1 ? 'day' : 'days'}.`}
      </p>

      {totalShifts === 0 && (
        <PageState
          state="empty"
          scope="inline"
          icon={CalendarX2}
          title="No shifts in this range"
          description="Open shifts you can bid on are listed in My Bids."
          action={{ label: 'Find open shifts', onClick: () => navigate('/my-bids') }}
          className="mb-4"
        />
      )}

      <div className="space-y-4">
        {dayGroups.map(({ day, shifts }) => {
          const isToday = isTodayInTimezone(day, SYDNEY_TZ);

          return (
            <section key={day.toISOString()} className="space-y-2" aria-label={format(day, 'EEEE d MMMM')}>
              <div
                className={cn(
                  'mobile-roster-date-glass sticky top-0 z-30 flex items-center justify-between overflow-hidden px-3 py-2.5',
                  isToday ? 'text-primary' : 'text-foreground',
                )}
              >
                <div>
                  <h3 className={text.label}>{format(day, 'EEE, d MMM')}</h3>
                  {isToday && (
                    <p className={cn(text.overlineBare, 'mt-0.5')}>Today</p>
                  )}
                </div>
                <span className={cn(text.overline, isToday ? 'text-primary' : shifts.length === 0 && 'text-muted-foreground')}>
                  {shifts.length === 0 ? 'No shifts' : `${shifts.length} ${shifts.length === 1 ? 'shift' : 'shifts'}`}
                </span>
              </div>

              <AnimatePresence mode="popLayout">
                {shifts.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {shifts.map((shiftData) => (
                      <motion.div
                        key={shiftData.shift.id}
                        {...listItemSpring}
                      >
                        <MobileShiftCard
                          shiftData={shiftData}
                          selectedDay={day}
                          onClick={() => setSelectedShift({ data: shiftData, date: day })}
                        />
                      </motion.div>
                    ))}
                  </div>
                ) : null}
              </AnimatePresence>
            </section>
          );
        })}
      </div>

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
