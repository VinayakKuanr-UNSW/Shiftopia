
import { useState, useMemo } from 'react';

interface FilterConfig<T> {
  searchBy?: (item: T, query: string) => boolean;
  filterBy?: (item: T, filter: string) => boolean;
}

export const useManagementFilter = <T>(
  items: T[],
  config: FilterConfig<T> = {}
) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');

  const filteredItems = useMemo(() => {
    let result = [...items];
    
    // Apply search filtering
    if (searchQuery && config.searchBy) {
      result = result.filter(item => config.searchBy!(item, searchQuery));
    }
    
    // Apply category filtering
    if (activeFilter !== 'all' && config.filterBy) {
      result = result.filter(item => config.filterBy!(item, activeFilter));
    }
    
    return result;
  }, [items, searchQuery, activeFilter, config]);

  return {
    searchQuery,
    setSearchQuery,
    activeFilter,
    setActiveFilter,
    filteredItems
  };
};
