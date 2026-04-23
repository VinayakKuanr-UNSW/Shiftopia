import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

interface PerformanceFunctionBarProps {
  selectedQuarterLabel: string;
  quarterOptions: { label: string }[];
  onQuarterChange: (label: string) => void;
  onRefresh: () => void;
  isLoading?: boolean;
  className?: string;
}

export const PerformanceFunctionBar: React.FC<PerformanceFunctionBarProps> = ({
  selectedQuarterLabel,
  quarterOptions,
  onQuarterChange,
  onRefresh,
  isLoading,
  className,
}) => {
  const { isDark } = useTheme();

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-4 w-full", className)}>
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Period</span>
        <Select
          value={selectedQuarterLabel}
          onValueChange={onQuarterChange}
        >
          <SelectTrigger className={cn(
            "w-40 h-10 lg:h-11 border-none font-bold text-sm rounded-xl transition-all shadow-sm",
            isDark ? "bg-white/5" : "bg-slate-900/5"
          )}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={cn(
            "border-none rounded-xl shadow-2xl",
            isDark ? "bg-[#1c2333] text-foreground" : "bg-white"
          )}>
            {quarterOptions.map(o => (
              <SelectItem key={o.label} value={o.label} className="font-semibold">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={onRefresh}
          disabled={isLoading}
          className={cn(
            "h-10 lg:h-11 px-4 lg:px-6 rounded-xl gap-2 font-black uppercase text-[10px] tracking-wider transition-all border shadow-sm",
            isDark ? "bg-[#111827]/60 border-white/5" : "bg-slate-100 border-slate-200/50"
          )}
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          Refresh All
        </Button>
      </div>
    </div>
  );
};
