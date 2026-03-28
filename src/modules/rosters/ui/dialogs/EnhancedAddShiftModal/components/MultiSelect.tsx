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
    className?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
    options,
    selected,
    onChange,
    placeholder = 'Select...',
    isLoading,
    disabled,
    className
}) => {
    const [open, setOpen] = useState(false);
    const selectedItems = options.filter((opt) => selected.includes(opt.id));

    return (
        <Popover open={open && !disabled} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <div
                    className={cn(
                        "flex w-full items-center justify-between min-h-[42px] px-3 py-2 rounded-lg border bg-muted/50 border-border text-foreground transition-colors",
                        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-foreground/20",
                        className
                    )}
                >
                    <div className="flex flex-wrap gap-1 flex-1">
                        {isLoading ? (
                            <span className="text-muted-foreground text-[11px]">Loading...</span>
                        ) : selectedItems.length > 0 ? (
                            <span className="text-sm font-bold text-foreground truncate max-w-[200px]" title={selectedItems.map(item => item.name).join(', ')}>
                                {selectedItems.length <= 2 
                                    ? selectedItems.map(item => item.name).join(', ')
                                    : `${selectedItems.length} selected`}
                            </span>
                        ) : (
                            <span className="text-muted-foreground text-sm font-bold">{placeholder}</span>
                        )}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 text-muted-foreground" />
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0 bg-popover border-border">
                <Command>
                    <CommandInput placeholder="Search..." className="text-foreground" />
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
                                    className="text-foreground"
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
