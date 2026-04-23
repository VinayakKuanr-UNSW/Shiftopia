import React from 'react';
import { RefreshCw, BarChart2, Users, ShieldCheck } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

interface InsightsFunctionBarProps {
  preset: string;
  onPresetChange: (preset: string) => void;
  presetLabels: Record<string, string>;
  presets: string[];
  startDate: string;
  endDate: string;
  onRefresh: () => void;
  className?: string;
}

export const InsightsFunctionBar: React.FC<InsightsFunctionBarProps> = ({
  preset,
  onPresetChange,
  presetLabels,
  presets,
  startDate,
  endDate,
  onRefresh,
  className,
}) => {
  const { isDark } = useTheme();

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-4 w-full", className)}>
      <div className="flex items-center gap-4">
        {/* Tab List Integrated into Function Bar */}
        <TabsList className={cn(
          "h-10 lg:h-11 p-1 rounded-xl border transition-all shadow-sm",
          isDark ? "bg-[#111827]/60 border-white/5" : "bg-slate-100 border-slate-200/50"
        )}>
          <TabsTrigger value="overview" className="gap-2 px-4 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-bold text-[10px] lg:text-xs uppercase tracking-widest">
            <BarChart2 className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="workforce" className="gap-2 px-4 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-bold text-[10px] lg:text-xs uppercase tracking-widest">
            <Users className="h-4 w-4" />
            Workforce
          </TabsTrigger>
          <TabsTrigger value="compliance" className="gap-2 px-4 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-bold text-[10px] lg:text-xs uppercase tracking-widest">
            <ShieldCheck className="h-4 w-4" />
            Compliance
          </TabsTrigger>
        </TabsList>

        <div className="h-6 w-px bg-border/20 hidden md:block mx-2" />

        {/* Date Selector */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Period</span>
          <Select value={preset} onValueChange={onPresetChange}>
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
              {presets.map(p => (
                <SelectItem key={p} value={p} className="font-semibold">
                  {presetLabels[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className={cn(
            "text-[10px] font-black px-3 py-1.5 rounded-lg opacity-80",
            isDark ? "bg-white/5 text-muted-foreground" : "bg-slate-900/5 text-slate-500"
          )}>
            {startDate} → {endDate}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={onRefresh}
          className={cn(
            "h-10 lg:h-11 px-4 lg:px-6 rounded-xl gap-2 font-black uppercase text-[10px] tracking-wider transition-all border shadow-sm",
            isDark ? "bg-[#111827]/60 border-white/5" : "bg-slate-100 border-slate-200/50"
          )}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>
    </div>
  );
};
