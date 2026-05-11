import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/modules/core/ui/primitives/command';
import { Button } from '@/modules/core/ui/primitives/button';
import { Check, Search, ChevronRight, CornerDownLeft } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

interface CommandSelectorProps {
    label: string;
    placeholder: string;
    value: string;
    onValueChange: (value: string) => void;
    options: { id: string; name: string }[];
    disabled?: boolean;
    icon?: React.ReactNode;
    locked?: boolean;
}

export const CommandSelector: React.FC<CommandSelectorProps> = ({
    label,
    placeholder,
    value,
    onValueChange,
    options,
    disabled,
    icon,
    locked
}) => {
    const [open, setOpen] = useState(false);
    const selectedOption = options.find(opt => opt.id === value);

    if (locked) {
        return (
            <div className="flex flex-col gap-2 opacity-60">
                <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                        {label}
                    </span>
                </div>
                <div className="flex h-12 w-full items-center gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 text-sm transition-all duration-200">
                    <div className="text-muted-foreground/50">{icon}</div>
                    <span className="font-medium text-muted-foreground/80">
                        {selectedOption?.name || value || placeholder}
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1">
                <span className={cn(
                    "text-[10px] uppercase tracking-wider font-semibold transition-colors duration-300",
                    disabled ? "text-muted-foreground/30" : "text-muted-foreground/80"
                )}>
                    {label}
                </span>
            </div>
            
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        disabled={disabled}
                        className={cn(
                            "group relative flex h-14 w-full items-center justify-start gap-3 rounded-xl border border-border/50 bg-muted/10 px-4 text-sm transition-all duration-300 hover:bg-muted/20 hover:border-primary/30 active:scale-[0.98]",
                            open && "border-primary/50 bg-muted/20 ring-4 ring-primary/5 shadow-[0_0_20px_-5px_rgba(var(--primary),0.2)]",
                            !value && "text-muted-foreground",
                            disabled && "opacity-30 cursor-not-allowed border-dashed"
                        )}
                    >
                        <div className={cn(
                            "flex items-center justify-center rounded-lg bg-muted/50 p-1.5 transition-colors duration-300 group-hover:bg-primary/10 group-hover:text-primary",
                            open && "bg-primary/10 text-primary"
                        )}>
                            {icon}
                        </div>
                        <span className="flex-1 text-left font-medium">
                            {selectedOption ? selectedOption.name : placeholder}
                        </span>
                        <ChevronRight className={cn(
                            "h-4 w-4 text-muted-foreground/40 transition-transform duration-300",
                            open && "rotate-90 text-primary"
                        )} />
                    </Button>
                </PopoverTrigger>
                
                <PopoverContent 
                    side="right" 
                    align="start" 
                    sideOffset={12}
                    className="w-[320px] p-0 overflow-hidden rounded-2xl border border-border/50 bg-popover/95 backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-left-2 duration-300 pointer-events-auto"
                >
                    <Command className="bg-transparent">
                        <div className="flex items-center border-b border-border/50 px-3 py-2">
                            <Search className="mr-2 h-4 w-4 shrink-0 opacity-40" />
                            <CommandInput 
                                placeholder={`Search ${label.toLowerCase()}...`}
                                className="h-9 w-full bg-transparent text-sm focus:outline-none"
                            />
                        </div>
                        
                        <div className="px-2 py-3 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-bold">
                            {label}
                        </div>

                        <CommandList 
                            className="max-h-[280px] overflow-y-auto px-1 pb-2 custom-scrollbar touch-pan-y"
                            onWheel={(e) => e.stopPropagation()}
                        >
                            <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
                                No results found.
                            </CommandEmpty>
                            <CommandGroup>
                                {options.map((option) => (
                                    <CommandItem
                                        key={option.id}
                                        value={option.name}
                                        onSelect={() => {
                                            onValueChange(option.id);
                                            setOpen(false);
                                        }}
                                        className={cn(
                                            "group flex items-center justify-between rounded-lg px-3 py-3 text-sm transition-all duration-200 cursor-pointer mb-0.5",
                                            "hover:bg-primary/10 aria-selected:bg-primary/10",
                                            value === option.id && "bg-primary/10 text-primary font-medium"
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={cn(
                                                "flex h-5 w-5 items-center justify-center rounded-full border border-border/50 bg-muted/20 transition-all duration-300 group-hover:border-primary/50 group-hover:bg-primary/10",
                                                value === option.id && "border-primary bg-primary text-primary-foreground scale-110 shadow-[0_0_10px_rgba(var(--primary),0.4)]"
                                            )}>
                                                {value === option.id ? (
                                                    <Check className="h-3 w-3" />
                                                ) : (
                                                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/20 group-hover:bg-primary/40" />
                                                )}
                                            </div>
                                            <span>{option.name}</span>
                                        </div>
                                        <CornerDownLeft className="h-3 w-3 text-muted-foreground/0 transition-all duration-300 group-hover:text-muted-foreground/40 group-hover:translate-x-0 -translate-x-2" />
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                        
                        {/* Footer - Shortcuts Style */}
                        <div className="flex items-center justify-between border-t border-border/50 bg-muted/5 px-4 py-2.5 text-[10px] text-muted-foreground/60 font-medium">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1">
                                    <span className="rounded bg-muted/40 px-1 py-0.5 border border-border/50 shadow-sm">↑↓</span>
                                    <span>NAV</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="rounded bg-muted/40 px-1 py-0.5 border border-border/50 shadow-sm">↵</span>
                                    <span>SELECT</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="rounded bg-muted/40 px-1 py-0.5 border border-border/50 shadow-sm uppercase">Esc</span>
                                <span>CLOSE</span>
                            </div>
                        </div>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
};
