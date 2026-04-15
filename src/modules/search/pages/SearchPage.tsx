import React, { useState, useEffect } from 'react';
import { useSearch } from '@/modules/core/contexts/SearchContext';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, X, ArrowLeft } from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';
import { Button } from '@/modules/core/ui/primitives/button';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { Card, CardContent } from '@/modules/core/ui/primitives/card';
import { useHotkeys } from 'react-hotkeys-hook';

const SearchPage: React.FC = () => {
  const { searchTerm, setSearchTerm, searchResults, performSearch, isSearching } = useSearch();
  const [inputValue, setInputValue] = useState(searchTerm);
  const navigate = useNavigate();

  // Focus the search input when the page loads
  useEffect(() => {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.focus();
    }
  }, []);

  // Perform search when input changes
  useEffect(() => {
    if (inputValue.length >= 2) {
      const timer = setTimeout(() => {
        setSearchTerm(inputValue);
        performSearch(inputValue);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [inputValue, setSearchTerm, performSearch]);

  // Handle keyboard shortcuts
  useHotkeys('escape', () => navigate(-1), { enableOnFormTags: true });

  // Get icon based on result type
  const getIcon = (type: string) => {
    switch (type) {
      case 'template':
        return <div className="w-8 h-8 rounded-md bg-blue-500/20 flex items-center justify-center text-blue-500">T</div>;
      case 'roster':
        return <div className="w-8 h-8 rounded-md bg-green-500/20 flex items-center justify-center text-green-500">R</div>;
      case 'timesheet':
        return <div className="w-8 h-8 rounded-md bg-purple-500/20 flex items-center justify-center text-purple-500">TS</div>;
      case 'bid':
        return <div className="w-8 h-8 rounded-md bg-amber-500/20 flex items-center justify-center text-amber-500">B</div>;
      default:
        return <div className="w-8 h-8 rounded-md bg-gray-500/20 flex items-center justify-center text-gray-500">?</div>;
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 w-full pb-24 md:pb-8">
      <div className="flex items-center mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="mr-2"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">Search</h1>
      </div>

      <div className="relative mb-8">
        <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          id="search-input"
          className="pl-10 pr-10 h-12 text-lg"
          placeholder="Search for templates, rosters, timesheets..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
        {inputValue && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 transform -translate-y-1/2"
            onClick={() => setInputValue('')}
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {isSearching ? (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : searchResults.length > 0 ? (
        <div className="space-y-4">
          {searchResults.map((result, index) => (
            <Card
              key={`${result.type}-${result.id}-${index}`}
              className="hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => {
                // Navigate based on result type
                switch (result.type) {
                  case 'template':
                    navigate(`/templates/${result.id}`);
                    break;
                  case 'roster':
                    navigate(`/rosters/${result.id}`);
                    break;
                  case 'timesheet':
                    navigate(`/timesheet/${result.id}`);
                    break;
                  case 'bid':
                    navigate(`/bids/${result.id}`);
                    break;
                }
              }}
            >
              <CardContent className="p-4 flex items-center">
                {getIcon(result.type)}
                <div className="ml-4 flex-1">
                  <div className="font-medium">{result.name || result.employee}</div>
                  <div className="text-sm text-muted-foreground">
                    {result.type.charAt(0).toUpperCase() + result.type.slice(1)}
                    {result.department && ` • ${result.department}`}
                    {result.date && ` • ${result.date}`}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : inputValue.length >= 2 ? (
        <div className="text-center py-12">
          <p className="text-lg text-muted-foreground">No results found for "{inputValue}"</p>
          <p className="text-sm text-muted-foreground mt-2">Try different keywords or check your spelling</p>
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-lg text-muted-foreground">Start typing to search</p>
          <p className="text-sm text-muted-foreground mt-2">Search for templates, rosters, timesheets, and more</p>
        </div>
      )}

      <div className="mt-8 text-sm text-muted-foreground">
        <p>Tip: Press <kbd className="px-2 py-1 bg-muted rounded">ESC</kbd> to go back</p>
      </div>
    </div>
  );
};

export default SearchPage;
