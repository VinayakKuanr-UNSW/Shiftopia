
import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';

interface ManagementSearchProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  placeholder?: string;
}

const ManagementSearch: React.FC<ManagementSearchProps> = ({ 
  searchQuery, 
  setSearchQuery,
  placeholder = "Search..." 
}) => {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-white/40" />
      <Input
        type="text"
        placeholder={placeholder}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="bg-white/5 border-white/10 pl-9 text-white"
      />
    </div>
  );
};

export default ManagementSearch;
