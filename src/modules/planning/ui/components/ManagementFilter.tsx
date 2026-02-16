
import React from 'react';
import { Button } from '@/modules/core/ui/primitives/button';

interface FilterOption {
  label: string;
  value: string;
}

interface ManagementFilterProps {
  options: FilterOption[];
  activeFilter: string;
  setActiveFilter: (filter: string) => void;
}

const ManagementFilter: React.FC<ManagementFilterProps> = ({ 
  options, 
  activeFilter,
  setActiveFilter
}) => {
  return (
    <div className="flex space-x-2 overflow-x-auto pb-2">
      {options.map((option) => (
        <Button 
          key={option.value}
          variant={activeFilter === option.value ? "outline" : "ghost"} 
          size="sm"
          className={activeFilter === option.value ? "bg-white/5 border-white/10" : ""}
          onClick={() => setActiveFilter(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
};

export default ManagementFilter;
