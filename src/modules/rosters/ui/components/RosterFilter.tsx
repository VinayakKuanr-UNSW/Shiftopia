
import React, { useState, useEffect } from 'react';
import { X, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/modules/core/ui/primitives/collapsible';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/modules/core/ui/primitives/accordion';

// Filter types
type FilterCategory = 
  | 'employee' 
  | 'region' 
  | 'location' 
  | 'department' 
  | 'role' 
  | 'area' 
  | 'assignment'
  | 'status'
  | 'shiftDefinition'
  | 'employmentType'
  | 'event'
  | 'function'
  | 'shiftType'
  | 'eventType';

interface FilterOption {
  id: string;
  label: string;
  category: FilterCategory;
}

interface RosterFilterProps {
  onFilterChange: (filters: Record<FilterCategory, string[]>) => void;
}

export const RosterFilter: React.FC<RosterFilterProps> = ({ onFilterChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Record<FilterCategory, string[]>>({
    employee: [],
    region: [],
    location: [],
    department: [],
    role: [],
    area: [],
    assignment: [],
    status: [],
    shiftDefinition: [],
    employmentType: [],
    event: [],
    function: [],
    shiftType: [],
    eventType: []
  });
  
  // Get total filter count
  const totalFilterCount = Object.values(activeFilters).reduce(
    (count, filters) => count + filters.length, 
    0
  );

  // Mock filter options - in a real app, this would come from an API
  const filterOptions: Record<FilterCategory, FilterOption[]> = {
    employee: [
      { id: 'emp1', label: 'Andrew Dauphin', category: 'employee' },
      { id: 'emp2', label: 'Bobby Blackman', category: 'employee' },
      { id: 'emp3', label: 'Andy Fowler', category: 'employee' }
    ],
    region: [
      { id: 'reg1', label: 'North', category: 'region' },
      { id: 'reg2', label: 'South', category: 'region' },
      { id: 'reg3', label: 'East', category: 'region' },
      { id: 'reg4', label: 'West', category: 'region' }
    ],
    location: [
      { id: 'loc1', label: 'Main Store', category: 'location' },
      { id: 'loc2', label: 'Downtown', category: 'location' },
      { id: 'loc3', label: 'Mall', category: 'location' }
    ],
    department: [
      { id: 'dep1', label: 'Retail', category: 'department' },
      { id: 'dep2', label: 'Stock', category: 'department' },
      { id: 'dep3', label: 'Management', category: 'department' }
    ],
    role: [
      { id: 'role1', label: 'Assistant Manager', category: 'role' },
      { id: 'role2', label: 'Retail Assistant', category: 'role' },
      { id: 'role3', label: 'Stock Assistant', category: 'role' },
      { id: 'role4', label: 'Supervisor', category: 'role' }
    ],
    area: [
      { id: 'area1', label: 'Front of House', category: 'area' },
      { id: 'area2', label: 'Back of House', category: 'area' }
    ],
    assignment: [
      { id: 'asg1', label: 'Assigned', category: 'assignment' },
      { id: 'asg2', label: 'Unassigned', category: 'assignment' }
    ],
    status: [
      { id: 'sts1', label: 'Confirmed', category: 'status' },
      { id: 'sts2', label: 'Pending', category: 'status' }
    ],
    shiftDefinition: [
      { id: 'def1', label: 'Regular', category: 'shiftDefinition' },
      { id: 'def2', label: 'Overtime', category: 'shiftDefinition' }
    ],
    employmentType: [
      { id: 'emp1', label: 'Full Time', category: 'employmentType' },
      { id: 'emp2', label: 'Part Time', category: 'employmentType' },
      { id: 'emp3', label: 'Casual', category: 'employmentType' }
    ],
    event: [
      { id: 'ev1', label: 'Sale', category: 'event' },
      { id: 'ev2', label: 'Holiday', category: 'event' }
    ],
    function: [
      { id: 'func1', label: 'Cashier', category: 'function' },
      { id: 'func2', label: 'Stocker', category: 'function' }
    ],
    shiftType: [
      { id: 'st1', label: 'Morning', category: 'shiftType' },
      { id: 'st2', label: 'Evening', category: 'shiftType' }
    ],
    eventType: [
      { id: 'et1', label: 'Special', category: 'eventType' },
      { id: 'et2', label: 'Regular', category: 'eventType' }
    ]
  };

  // Update parent component when filters change
  useEffect(() => {
    onFilterChange(activeFilters);
  }, [activeFilters, onFilterChange]);

  // Toggle a filter option
  const toggleFilter = (category: FilterCategory, id: string) => {
    setActiveFilters(prev => {
      const categoryFilters = [...prev[category]];
      
      if (categoryFilters.includes(id)) {
        return {
          ...prev,
          [category]: categoryFilters.filter(filterId => filterId !== id)
        };
      } else {
        return {
          ...prev,
          [category]: [...categoryFilters, id]
        };
      }
    });
  };

  // Clear all filters
  const clearAllFilters = () => {
    setActiveFilters({
      employee: [],
      region: [],
      location: [],
      department: [],
      role: [],
      area: [],
      assignment: [],
      status: [],
      shiftDefinition: [],
      employmentType: [],
      event: [],
      function: [],
      shiftType: [],
      eventType: []
    });
  };

  // Apply current filters
  const applyFilters = () => {
    // In a real implementation, you might call an API or update state in a parent component
    console.log('Applying filters:', activeFilters);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="relative"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Filter size={16} className="mr-2" />
        <span>Filter</span>
        {totalFilterCount > 0 && (
          <span className="ml-1 bg-purple-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {totalFilterCount}
          </span>
        )}
      </Button>

      {totalFilterCount > 0 && (
        <div
          className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full cursor-pointer hover:bg-red-600"
          onClick={clearAllFilters}
          title="Clear all filters"
        ></div>
      )}

      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleContent className="absolute z-50 top-full mt-2 bg-black/95 border border-white/20 rounded-md shadow-lg w-[350px] p-4 backdrop-blur-xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-medium text-lg">Filters</h3>
            <X size={16} className="cursor-pointer text-white/70 hover:text-white" onClick={() => setIsOpen(false)} />
          </div>

          <Accordion type="multiple" className="w-full">
            {(Object.keys(filterOptions) as FilterCategory[]).map((category) => (
              <AccordionItem key={category} value={category} className="border-white/10">
                <AccordionTrigger className="py-2 text-sm">
                  <span className="capitalize">{category.replace(/([A-Z])/g, ' $1').trim()}</span>
                  {activeFilters[category].length > 0 && (
                    <span className="ml-2 bg-purple-500/80 text-white px-2 py-0.5 rounded-full text-xs">
                      {activeFilters[category].length}
                    </span>
                  )}
                </AccordionTrigger>
                <AccordionContent>
                  <div className="pl-4 space-y-2">
                    {filterOptions[category].map(option => (
                      <div key={option.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`filter-${option.id}`}
                          checked={activeFilters[category].includes(option.id)}
                          onCheckedChange={() => toggleFilter(category, option.id)}
                        />
                        <label 
                          htmlFor={`filter-${option.id}`}
                          className="text-sm text-white/90 cursor-pointer"
                        >
                          {option.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className="flex justify-end space-x-2 mt-4">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={clearAllFilters}
            >
              Clear All
            </Button>
            <Button 
              size="sm" 
              onClick={applyFilters}
            >
              Apply
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
