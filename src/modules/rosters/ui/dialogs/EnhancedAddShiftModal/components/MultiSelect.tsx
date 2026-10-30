import React, { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { CommandItem, CommandShortcut } from '@/modules/core/ui/primitives/command';
import { PICKER_CONTENT_CLASS, PICKER_ROW, PickerPanel, PickerTick, PickerTrigger } from '@/modules/core/ui/components/PickerField';

interface MultiSelectProps {
    label?: string;
    options: Array<{ id: string; name: string }>;
    selected: string[];
    onChange: (selected: string[]) => void;
    placeholder?: string;
    isLoading?: boolean;
    disabled?: boolean;
    className?: string;
    compact?: boolean;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
    label = 'Select',
    options,
    selected,
    onChange,
    placeholder = 'None',
    isLoading,
    disabled,
    className,
}) => {
    const [isOpen, setIsOpen] = useState(false);

    const selectedItems = useMemo(() => options.filter((opt) => selected.includes(opt.id)), [options, selected]);
    const displayText = isLoading ? 'Loading...'
        : selectedItems.length === 0 ? placeholder
        : selectedItems.length === 1 ? selectedItems[0].name
        : `${selectedItems.length} selected`;

    const toggleOption = (optionId: string) =>
        onChange(selected.includes(optionId) ? selected.filter((s) => s !== optionId) : [...selected, optionId]);

    return (
        <Popover open={isOpen && !disabled} onOpenChange={setIsOpen} modal={false}>
            <PopoverTrigger asChild>
                <PickerTrigger
                    label={label}
                    display={displayText}
                    isEmpty={selectedItems.length === 0}
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
                    selectVerb="Toggle"
                >
                    {options.map((opt) => {
                        const isSelected = selected.includes(opt.id);
                        return (
                            <CommandItem
                                key={opt.id}
                                value={`${opt.name} ${opt.id}`.toLowerCase()}
                                onSelect={() => toggleOption(opt.id)}
                                aria-checked={isSelected}
                                className={PICKER_ROW}
                            >
                                <div className="flex items-center gap-3">
                                    <PickerTick on={isSelected} shape="square" />
                                    <span className="font-semibold text-[13px] sm:text-[14px] capitalize">{opt.name}</span>
                                </div>
                                <CommandShortcut className="group-aria-selected:text-white/60" aria-hidden="true">↵</CommandShortcut>
                            </CommandItem>
                        );
                    })}
                </PickerPanel>
            </PopoverContent>
        </Popover>
    );
};
