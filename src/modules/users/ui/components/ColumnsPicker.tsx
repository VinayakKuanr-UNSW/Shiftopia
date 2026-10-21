/**
 * The Columns picker (2026-10-17): the global scope selector's multi-select,
 * for table columns. Same parts in the same design: the search card, the list
 * card with "Select All" and a square tick per column, the ↵ hint per row and
 * the ↑↓ / ↵ / esc footer. Name always shows, so it isn't offered.
 *
 * Each row also says whether its column is shown (aria-checked): the list's
 * own aria-selected marks only the highlighted row.
 */
import React, { useState } from 'react';
import { Check, ChevronDown, Columns3 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandShortcut,
} from '@/modules/core/ui/primitives/command';
import { DESIGN_CARD, KeyHints } from './PageMenu';
import { HIDEABLE_COLUMNS, isColumnShown, type ColumnVisibility } from '../usersTableColumns';

interface ColumnsPickerProps {
    columns?: ColumnVisibility;
    onColumnsChange: (next: ColumnVisibility) => void;
    /** The function bar's pill look for the button. */
    triggerClassName?: string;
}

const ROW = 'flex items-center gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-primary aria-selected:text-primary-foreground group';

const Tick: React.FC<{ on: boolean }> = ({ on }) => (
    <div
        aria-hidden="true"
        className={cn(
            'w-5 h-5 rounded-md border flex items-center justify-center transition-all',
            on ? 'bg-white border-white text-primary' : 'border-muted-foreground/30 group-aria-selected:border-white/40',
        )}
    >
        {on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
    </div>
);

export const ColumnsPicker: React.FC<ColumnsPickerProps> = ({ columns = {}, onColumnsChange, triggerClassName }) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');

    const safeColumns = columns ?? {};
    const shownCount = HIDEABLE_COLUMNS.filter((c) => isColumnShown(safeColumns, c.id)).length;
    const allShown = shownCount === HIDEABLE_COLUMNS.length;

    const toggle = (id: (typeof HIDEABLE_COLUMNS)[number]['id']) =>
        onColumnsChange({ ...safeColumns, [id]: !isColumnShown(safeColumns, id) });
    const toggleAll = () =>
        onColumnsChange(Object.fromEntries(HIDEABLE_COLUMNS.map((c) => [c.id, !allShown])) as ColumnVisibility);

    return (
        <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(''); }}>
            <PopoverTrigger asChild>
                <Button variant="outline" className={triggerClassName}>
                    <Columns3 className="h-3.5 w-3.5 mr-2 text-primary" aria-hidden="true" />
                    Columns
                    <ChevronDown className={cn('h-3.5 w-3.5 ml-1.5 opacity-60 transition-transform', open && 'rotate-180')} aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                aria-label="Choose columns"
                align="end"
                sideOffset={10}
                collisionPadding={16}
                // Wide enough for the key-hint footer on one line.
                className="w-[21rem] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
            >
                <Command
                    // Names the search box and the list (the input's aria-label would be overridden by it).
                    label="Search columns"
                    className="bg-transparent overflow-visible w-full outline-none"
                    onKeyDown={(e) => {
                        // ⌘A / Ctrl+A, as the row says — unless there's search text to select.
                        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && !query) {
                            e.preventDefault();
                            toggleAll();
                        }
                    }}
                >
                    <div className="flex flex-col gap-1.5 w-full">
                        {/* Search Bar Container */}
                        <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                            <CommandInput
                                value={query}
                                onValueChange={setQuery}
                                placeholder="Search columns..."
                                className="h-14 text-base border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                                autoFocus
                            />
                        </div>

                        {/* Results Container */}
                        <div className={cn(DESIGN_CARD, 'animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300')}>
                            <CommandList className="max-h-[50vh] p-1.5 scrollbar-none overflow-x-hidden">
                                <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-sm">No columns found.</CommandEmpty>
                                <CommandGroup heading="Columns" className="px-1">
                                    <CommandItem
                                        value="Select All"
                                        onSelect={toggleAll}
                                        aria-checked={allShown ? true : shownCount > 0 ? 'mixed' : false}
                                        className={ROW}
                                    >
                                        <Tick on={allShown} />
                                        <span className="font-semibold text-sm sm:text-base">Select All</span>
                                        <CommandShortcut className="group-aria-selected:text-white/60" aria-hidden="true">⌘A</CommandShortcut>
                                    </CommandItem>
                                    {HIDEABLE_COLUMNS.map((col) => {
                                        const on = isColumnShown(safeColumns, col.id);
                                        return (
                                            <CommandItem
                                                key={col.id}
                                                value={col.label}
                                                onSelect={() => toggle(col.id)}
                                                aria-checked={on}
                                                className={ROW}
                                            >
                                                <Tick on={on} />
                                                <span className="font-semibold text-sm sm:text-base">{col.label}</span>
                                                <CommandShortcut className="group-aria-selected:text-white/60" aria-hidden="true">↵</CommandShortcut>
                                            </CommandItem>
                                        );
                                    })}
                                </CommandGroup>
                            </CommandList>
                            <KeyHints />
                        </div>
                    </div>
                </Command>
            </PopoverContent>
        </Popover>
    );
};
