import React, { useState } from 'react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/modules/core/ui/primitives/command';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { Check, ChevronsUpDown, X } from 'lucide-react';

interface MultiSelectProps {
    options: Array<{ id: string; name: string }>;
    selected: string[];
    onChange: (selected: string[]) => void;
    placeholder?: string;
    isLoading?: boolean;
    disabled?: boolean;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
    options,
    selected,
    onChange,
    placeholder = 'Select...',
    isLoading,
    disabled
}) => {
    const [open, setOpen] = useState(false);
    const selectedItems = options.filter((opt) => selected.includes(opt.id));

    return (
        <Popover open={open && !disabled} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <div
                    className={cn(
                        "flex w-full items-center justify-between min-h-[42px] px-3 py-2 rounded-lg border bg-[#1e293b] border-white/10 text-white transition-colors",
                        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-white/20"
                    )}
                >
                    <div className="flex flex-wrap gap-1 flex-1">
                        {isLoading ? (
                            <span className="text-white/40">Loading...</span>
                        ) : selectedItems.length > 0 ? (
                            selectedItems.map((item) => (
                                <Badge key={item.id} variant="secondary" className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                                    {item.name}
                                    <span
                                        role="button"
                                        className="ml-1 cursor-pointer hover:text-white"
                                        onClick={(e) => {
                                            if (disabled) return;
                                            e.stopPropagation();
                                            onChange(selected.filter((s) => s !== item.id));
                                        }}
                                    >
                                        <X className="h-3 w-3" />
                                    </span>
                                </Badge>
                            ))
                        ) : (
                            <span className="text-white/40">{placeholder}</span>
                        )}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 text-white/40" />
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0 bg-[#1e293b] border-white/10">
                <Command>
                    <CommandInput placeholder="Search..." className="text-white" />
                    <CommandList>
                        <CommandEmpty>No items found.</CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => (
                                <CommandItem
                                    key={option.id}
                                    onSelect={() => {
                                        if (selected.includes(option.id)) {
                                            onChange(selected.filter((s) => s !== option.id));
                                        } else {
                                            onChange([...selected, option.id]);
                                        }
                                    }}
                                    className="text-white"
                                >
                                    <Check className={cn('mr-2 h-4 w-4', selected.includes(option.id) ? 'opacity-100' : 'opacity-0')} />
                                    {option.name}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};
