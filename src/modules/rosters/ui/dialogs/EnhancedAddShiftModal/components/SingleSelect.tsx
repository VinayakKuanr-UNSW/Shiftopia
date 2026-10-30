import React, { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { CommandItem, CommandShortcut } from '@/modules/core/ui/primitives/command';
import { PICKER_CONTENT_CLASS, PICKER_ROW, PickerPanel, PickerTick, PickerTrigger } from '@/modules/core/ui/components/PickerField';

interface SingleSelectProps {
    label?: string;
    options: Array<{ id: string; name: string }>;
    value: string | null | undefined;
    onChange: (value: string) => void;
    placeholder?: string;
    isLoading?: boolean;
    disabled?: boolean;
    required?: boolean;
    className?: string;
    id?: string;
}

export const SingleSelect: React.FC<SingleSelectProps> = ({
    label = 'Select',
    options,
    value,
    onChange,
    placeholder = 'Select…',
    isLoading,
    disabled,
    required,
    className,
    id,
}) => {
    const [isOpen, setIsOpen] = useState(false);

    const selectedOption = useMemo(() => options.find((opt) => opt.id === value), [options, value]);
    const displayText = isLoading ? 'Loading...' : selectedOption?.name ?? placeholder;

    return (
        <Popover open={isOpen && !disabled} onOpenChange={setIsOpen} modal={false}>
            <PopoverTrigger asChild>
                <PickerTrigger
                    id={id}
                    label={label}
                    required={required}
                    display={displayText}
                    isEmpty={!selectedOption}
                    isOpen={isOpen}
                    disabled={disabled}
                    className={className}
                />
            </PopoverTrigger>

            <PopoverContent className={PICKER_CONTENT_CLASS} sideOffset={10} align="center">
                <PickerPanel
                    heading={label}
                    searchPlaceholder={`Search ${label.toLowerCase()}...`}
                    emptyText={`No ${label.toLowerCase()} found.`}
                    onClose={() => setIsOpen(false)}
                >
                    {options.map((opt) => (
                        <CommandItem
                            key={opt.id}
                            value={`${opt.name} ${opt.id}`.toLowerCase()}
                            onSelect={() => {
                                onChange(opt.id);
                                setIsOpen(false);
                            }}
                            aria-checked={value === opt.id}
                            className={PICKER_ROW}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <PickerTick on={value === opt.id} />
                                <span className="font-semibold text-[13px] sm:text-[14px] truncate">{opt.name}</span>
                            </div>
                            <CommandShortcut className="group-aria-selected:text-white/60" aria-hidden="true">↵</CommandShortcut>
                        </CommandItem>
                    ))}
                </PickerPanel>
            </PopoverContent>
        </Popover>
    );
};
