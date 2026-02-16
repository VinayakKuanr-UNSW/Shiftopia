
import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { Search, UserPlus, X } from 'lucide-react';

interface RosterSidebarProps {
  readOnly?: boolean;
}

export const RosterSidebar: React.FC<RosterSidebarProps> = ({ readOnly }) => {
  // Sample staff data
  const staffMembers = [
    { id: 1, name: 'Alex Johnson', department: 'Convention', role: 'Event Coordinator', avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=Alex' },
    { id: 2, name: 'Sam Wilson', department: 'Exhibition', role: 'Tour Guide', avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=Sam' },
    { id: 3, name: 'Jamie Smith', department: 'Theatre', role: 'Sound Engineer', avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=Jamie' },
    { id: 4, name: 'Taylor Brown', department: 'Convention', role: 'Security Officer', avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=Taylor' },
    { id: 5, name: 'Jordan Davis', department: 'Exhibition', role: 'Information Desk', avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=Jordan' },
    { id: 6, name: 'Casey Miller', department: 'Theatre', role: 'Lighting Technician', avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=Casey' },
  ];
  
  return (
    <div className="w-80 h-[calc(100vh-4rem)] bg-black/40 backdrop-blur-xl border-l border-white/10 overflow-y-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Staff Members</h3>
      </div>
      
      <div className="relative mb-4">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-white/50" />
        <input 
          type="text" 
          placeholder="Search staff..." 
          className="w-full bg-white/5 border border-white/10 rounded-md py-2 pl-8 pr-4 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 text-sm"
        />
      </div>
      
      {!readOnly && (
        <button className="w-full flex items-center justify-center space-x-2 mb-4 p-2 rounded-md bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-sm transition-all duration-200 border border-purple-500/30">
          <UserPlus size={16} />
          <span>Add New Staff Member</span>
        </button>
      )}
      
      <div className="space-y-1">
        {staffMembers.map((staff) => (
          <div 
            key={staff.id}
            className="flex items-center p-2 hover:bg-white/5 rounded-md transition-all duration-200 group cursor-pointer"
          >
            <Avatar className="h-8 w-8 mr-3">
              <AvatarImage src={staff.avatar} />
              <AvatarFallback>{staff.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="font-medium text-sm">{staff.name}</div>
              <div className="text-xs text-white/60">{staff.role}</div>
            </div>
            {!readOnly && (
              <button className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-white/10">
                <X size={14} className="text-white/60" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
