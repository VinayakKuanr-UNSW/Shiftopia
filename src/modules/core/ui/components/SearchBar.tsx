import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';
import { useNavigate } from 'react-router-dom';
import { useHotkeys } from 'react-hotkeys-hook';

export const SearchBar: React.FC = () => {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  // Handle keyboard shortcut (Ctrl+K or Cmd+K)
  useHotkeys('mod+k', (e) => {
    e.preventDefault();
    navigate('/search');
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query)}`);
    } else {
      navigate('/search');
    }
  };

  return (
    <form onSubmit={handleSearch} className="relative w-full max-w-sm mx-4">
      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search... (⌘K)"
        className="pl-8 w-full"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </form>
  );
};
