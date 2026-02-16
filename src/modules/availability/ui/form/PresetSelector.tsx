import React, { useState, FC } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { Button } from '@/modules/core/ui/primitives/button';
import { CalendarIcon, ChevronDown } from 'lucide-react';
import { Calendar } from '@/modules/core/ui/primitives/calendar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/modules/core/ui/primitives/command';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAvailability } from '../../state/useAvailability';
import { cn } from '@/modules/core/lib/utils';
import { addDays, format } from 'date-fns';

/* ----------------- Types ----------------- */
interface AvailabilityPreset {
  id: string;
  name: string;
  description?: string;
}

interface DateRange {
  from: Date;
  to?: Date;
}

/* --------------------------------------------------- *
 *            1) DateRangePicker Subcomponent
 * --------------------------------------------------- */
interface DateRangePickerProps {
  dateRange: DateRange;
  onChange: (range: DateRange) => void;
}

/**
 * Renders a calendar-based picker for selecting a date range,
 * plus optional shortcut buttons (Next 7 Days, Next 30 Days).
 */
const DateRangePicker: FC<DateRangePickerProps> = ({ dateRange, onChange }) => {
  /**
   * When user selects a range on the calendar, if `range.to` is missing,
   * default it to the same as `range.from`.
   */
  const handleCalendarSelect = (
    range: { from?: Date; to?: Date } | undefined
  ) => {
    if (range && range.from) {
      onChange({
        from: range.from,
        to: range.to || range.from,
      });
    }
  };

  /** Shortcut for "Next 7 Days" */
  const selectNext7Days = () => {
    const from = new Date();
    const to = addDays(from, 6);
    onChange({ from, to });
  };

  /** Shortcut for "Next 30 Days" */
  const selectNext30Days = () => {
    const from = new Date();
    const to = addDays(from, 29);
    onChange({ from, to });
  };

  return (
    <div className="flex flex-col items-center space-y-3">
      {/* Example shortcuts row */}
      <div className="flex gap-2">
        <Button variant="secondary" size="xs" onClick={selectNext7Days}>
          Next 7 days
        </Button>
        <Button variant="secondary" size="xs" onClick={selectNext30Days}>
          Next 30 days
        </Button>
      </div>

      {/* Calendar for picking a custom date range */}
      <Calendar
        initialFocus
        mode="range"
        defaultMonth={dateRange.from}
        selected={dateRange}
        onSelect={handleCalendarSelect}
        numberOfMonths={1}
        className={cn('p-3 pointer-events-auto')}
      />
    </div>
  );
};

/* --------------------------------------------------- *
 *            2) PresetComboBox Subcomponent
 * --------------------------------------------------- */
interface PresetComboBoxProps {
  presets: AvailabilityPreset[];
  selectedPresetId: string | null;
  onSelectPreset: (presetId: string) => void;
}

const PresetComboBox: FC<PresetComboBoxProps> = ({
  presets,
  selectedPresetId,
  onSelectPreset,
}) => {
  const [open, setOpen] = useState(false);

  // Find the current preset object by ID
  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const displayedName = selectedPreset ? selectedPreset.name : 'Select Preset';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select an availability preset"
          className="w-full justify-between"
        >
          {displayedName}
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-full p-0" side="bottom">
        <Command>
          <CommandInput placeholder="Search presets..." />
          <CommandEmpty>No presets found.</CommandEmpty>
          <CommandList>
            <CommandGroup>
              {presets.map((preset) => (
                <CommandItem
                  key={preset.id}
                  value={preset.id}
                  onSelect={() => {
                    onSelectPreset(preset.id);
                    setOpen(false);
                  }}
                >
                  <div>
                    <div className="font-medium">{preset.name}</div>
                    {preset.description && (
                      <div className="text-xs opacity-70">
                        {preset.description}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/* --------------------------------------------------- *
 *            3) PresetApplyFooter Subcomponent
 * --------------------------------------------------- */
interface PresetApplyFooterProps {
  isDisabled: boolean;
  onCancel: () => void;
  onApply: () => void;
  selectedPresetName: string;
  dateRangeLabel: string;
}

const PresetApplyFooter: FC<PresetApplyFooterProps> = ({
  isDisabled,
  onCancel,
  onApply,
  selectedPresetName,
  dateRangeLabel,
}) => {
  const hasRange = dateRangeLabel !== '';

  return (
    <div className="flex flex-col space-y-2">
      <div className="text-sm text-muted-foreground">
        {selectedPresetName !== 'Select Preset' && hasRange ? (
          <>
            Apply <span className="font-medium">{selectedPresetName}</span>{' '}
            {dateRangeLabel}
          </>
        ) : (
          'Please select a date range and a preset.'
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          aria-label="Cancel preset selection"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onApply}
          disabled={isDisabled}
          aria-label="Apply the selected preset"
        >
          Apply
        </Button>
      </div>
    </div>
  );
};

/* --------------------------------------------------- *
 *           4) Main PresetSelector Component
 * --------------------------------------------------- */
interface PresetSelectorProps {
  /** Called when the user applies a preset, passing presetId + date range. */
  onApplyPreset: (
    presetId: string,
    startDate: Date,
    endDate: Date
  ) => Promise<void>;
  /**
   * If true, the entire "Apply Preset" is disabled (locked).
   */
  disabled?: boolean;
}

export const PresetSelector: FC<PresetSelectorProps> = ({
  onApplyPreset,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>({
    from: new Date(),
    to: addDays(new Date(), 1),
  });

  const { toast } = useToast();
  const { availabilityPresets } = useAvailability();

  const currentPresetObj = availabilityPresets.find(
    (p) => p.id === selectedPreset
  );
  const selectedPresetName = currentPresetObj
    ? currentPresetObj.name
    : 'Select Preset';

  let dateRangeLabel = '';
  if (dateRange.from && dateRange.to) {
    const fromStr = format(dateRange.from, 'PP');
    const toStr = format(dateRange.to, 'PP');
    dateRangeLabel = `from ${fromStr} to ${toStr}`;
  }

  const handleApply = async () => {
    if (!selectedPreset) {
      toast({
        title: 'No Preset Selected',
        description: 'Please select an availability preset.',
        variant: 'destructive',
      });
      return;
    }
    if (!dateRange.from || !dateRange.to) {
      toast({
        title: 'Date Range Required',
        description: 'Please select both a start and end date.',
        variant: 'destructive',
      });
      return;
    }

    // Ensure end >= start
    if (dateRange.to < dateRange.from) {
      toast({
        title: 'Invalid Date Range',
        description: 'End date cannot be before the start date.',
        variant: 'destructive',
      });
      return;
    }

    await onApplyPreset(selectedPreset, dateRange.from, dateRange.to);
    setOpen(false);
  };

  // If disabled, show a button that does nothing
  if (disabled) {
    return (
      <Button variant="outline" disabled className="flex items-center gap-2">
        <CalendarIcon className="h-4 w-4" aria-hidden="true" />
        Apply Preset (Locked)
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="flex items-center gap-2"
          aria-label="Open preset selector"
        >
          <CalendarIcon className="h-4 w-4" aria-hidden="true" />
          Apply Preset
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-80 max-h-[80vh] overflow-auto"
        align="end"
        side="bottom"
        aria-label="Preset Selector"
      >
        <div className="grid gap-4 p-4">
          {/* 1) Date Range Picker */}
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Date Range</h4>
            <DateRangePicker
              dateRange={dateRange}
              onChange={(range) => setDateRange(range)}
            />
          </div>

          {/* 2) Preset Combobox */}
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Select Preset</h4>
            <PresetComboBox
              presets={availabilityPresets}
              selectedPresetId={selectedPreset}
              onSelectPreset={(id) => setSelectedPreset(id)}
            />
          </div>

          {/* 3) Footer */}
          <PresetApplyFooter
            isDisabled={!selectedPreset || !dateRange.from || !dateRange.to}
            onApply={handleApply}
            onCancel={() => setOpen(false)}
            selectedPresetName={selectedPresetName}
            dateRangeLabel={dateRangeLabel}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};
