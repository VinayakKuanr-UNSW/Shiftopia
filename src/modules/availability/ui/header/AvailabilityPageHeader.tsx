
import React from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { CalendarIcon, List, RefreshCw, Zap } from 'lucide-react';

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
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <h1 className="text-2xl font-bold tracking-tight">
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
          variant="default" 
          onClick={onBatchApply} 
          disabled={isCalendarLocked} 
          size="sm" 
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Zap className="h-4 w-4 mr-2" />
          Batch Apply
        </Button>
      </div>
    </div>
  );
}
