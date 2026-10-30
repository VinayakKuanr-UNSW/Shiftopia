import { Capacitor } from '@capacitor/core';
import { CalendarPlus } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import {
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  buildShiftCalendarFile,
  type ShiftCalendarOptions,
} from '@/modules/rosters/utils/shift-calendar';

const APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.replace(/\/$/, '');
const OBJECT_URL_LIFETIME_MS = 1_000;

type Props = {
  shift: Shift;
  groupName?: string;
  subGroupName?: string;
};

const buttonClass = cn(text.label, touch.target, 'flex-1 h-11 rounded-2xl');

/**
 * "Add to calendar" for one shift. Google and Outlook are plain links (the
 * native shell opens them in the system browser). The .ics file is web-only:
 * a Blob download does nothing inside the Android WebView.
 */
export function AddToCalendar({ shift, groupName, subGroupName }: Props) {
  const options: ShiftCalendarOptions = {
    shift,
    groupName,
    subGroupName,
    appUrl: APP_URL ? `${APP_URL}/my-roster` : undefined,
  };

  let googleUrl: string;
  let outlookUrl: string;
  try {
    googleUrl = buildGoogleCalendarUrl(options);
    outlookUrl = buildOutlookCalendarUrl(options);
  } catch {
    // Shift times that can't form an event (end not after start): nothing to export.
    return null;
  }

  const handleDownload = () => {
    const file = buildShiftCalendarFile(options);
    const url = URL.createObjectURL(new Blob([file.content], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
  };

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Add this shift to a calendar">
      <p className={cn(text.caption, 'flex items-center gap-1.5')}>
        <CalendarPlus size={14} aria-hidden="true" />
        Add to calendar
      </p>
      <div className="flex gap-2">
        {!Capacitor.isNativePlatform() && (
          <Button type="button" variant="outline" onClick={handleDownload} className={buttonClass}>
            Calendar file
          </Button>
        )}
        <Button asChild variant="outline" className={buttonClass}>
          <a href={googleUrl} target="_blank" rel="noopener noreferrer">Google</a>
        </Button>
        <Button asChild variant="outline" className={buttonClass}>
          <a href={outlookUrl} target="_blank" rel="noopener noreferrer">Outlook</a>
        </Button>
      </div>
    </div>
  );
}
