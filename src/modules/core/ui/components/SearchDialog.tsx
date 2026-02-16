import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { Dialog, DialogContent } from '@/modules/core/ui/primitives/dialog';
import { useSearch } from '@/modules/core/contexts/SearchContext';
import { Calendar, Clock, FileText, Users } from 'lucide-react';

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SearchDialog: React.FC<SearchDialogProps> = ({ open, onOpenChange }) => {
  const { searchTerm, setSearchTerm, searchResults, performSearch, isSearching } = useSearch();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (open) {
      setInputValue('');
    }
  }, [open]);

  const handleSearch = (value: string) => {
    setInputValue(value);
    setSearchTerm(value);
    if (value.length >= 2) {
      performSearch(value);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'template':
        return <FileText className="h-4 w-4" />;
      case 'roster':
        return <Users className="h-4 w-4" />;
      case 'timesheet':
        return <Clock className="h-4 w-4" />;
      case 'bid':
        return <Calendar className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const handleSelect = (item: any) => {
    switch (item.type) {
      case 'template':
        navigate(`/rostering/templates/${item.id}`);
        break;
      case 'roster':
        navigate(`/rostering/rosters/${item.id}`);
        break;
      case 'timesheet':
        navigate(`/rostering/timesheets/${item.id}`);
        break;
      case 'bid':
        navigate(`/management/bids/${item.id}`);
        break;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 bg-gray-900/95 backdrop-blur-xl border-gray-800">
        <Command className="rounded-lg border-0">
          <div className="flex items-center border-b border-gray-800 px-3">
            <Command.Input
              value={inputValue}
              onValueChange={handleSearch}
              placeholder="Search templates, rosters, timesheets..."
              className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            {isSearching ? (
              <Command.Loading>Searching...</Command.Loading>
            ) : searchResults.length > 0 ? (
              searchResults.map((item) => (
                <Command.Item
                  key={`${item.type}-${item.id}`}
                  onSelect={() => handleSelect(item)}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md cursor-pointer hover:bg-white/5"
                >
                  {getIcon(item.type)}
                  <span>{item.name || item.employee}</span>
                  {item.department && (
                    <span className="ml-auto text-xs text-gray-500">{item.department}</span>
                  )}
                  {item.date && (
                    <span className="ml-auto text-xs text-gray-500">{item.date}</span>
                  )}
                </Command.Item>
              ))
            ) : inputValue.length > 0 ? (
              <Command.Empty>No results found.</Command.Empty>
            ) : (
              <Command.Empty>Start typing to search...</Command.Empty>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
};

export default SearchDialog;
