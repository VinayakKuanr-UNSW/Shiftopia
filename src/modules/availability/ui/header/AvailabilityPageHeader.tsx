
import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/modules/core/ui/primitives/button';
import { CalendarIcon, List, RefreshCw, Zap } from 'lucide-react';
import { itemVariants } from '@/modules/core/ui/motion/presets';

interface AvailabilityPageHeaderProps {
  viewMode: 'calendar' | 'list';
  setViewMode: (mode: 'calendar' | 'list') => void;
  onRefresh: () => void;
  onBatchApply: () => void;
  isCalendarLocked: boolean;
}

export function AvailabilityPageHeader({
  viewMode,
  setViewMode,
  onRefresh,
  onBatchApply,
  isCalendarLocked
}: AvailabilityPageHeaderProps) {
  return (
    <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <h1 className="text-2xl font-black tracking-tight text-foreground">
        Availability Management
      </h1>

      <div className="flex items-center gap-2">
        {/* Refresh Button */}
        <Button variant="outline" size="sm" onClick={onRefresh} className="hidden sm:flex">
          <RefreshCw className="h-4 w-4" />
        </Button>

        {/* View Mode Toggle */}
        <div className="hidden sm:flex gap-2">
          <Button
            variant={viewMode === 'calendar' ? 'default' : 'outline'}
            onClick={() => setViewMode('calendar')}
            size="sm"
          >
            <CalendarIcon className="h-4 w-4 mr-2" />
            Calendar
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'outline'}
            onClick={() => setViewMode('list')}
            size="sm"
          >
            <List className="h-4 w-4 mr-2" />
            List
          </Button>
        </div>

        {/* Batch Apply Button */}
        <Button
          variant="outline"
          onClick={onBatchApply}
          disabled={isCalendarLocked}
          size="sm"
          className="bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20"
        >
          <Zap className="h-4 w-4 mr-2" />
          Batch Apply
        </Button>
      </div>
    </motion.div>
  );
}
