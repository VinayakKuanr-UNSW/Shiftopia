
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Edit, Trash, Copy, Plus } from 'lucide-react';
import SubGroupSection from './SubGroupSection';

type GroupColor = 'blue' | 'green' | 'red';

interface GroupProps {
  id: number;
  name: string;
  subGroups: number;
  color: GroupColor;
}

const GroupSection: React.FC<GroupProps> = ({ id, name, subGroups, color }) => {
  const [expanded, setExpanded] = useState(false);
  
  // Fake data for subgroups
  const fakeSubGroups = Array.from({ length: subGroups }, (_, i) => ({
    id: i + 1,
    name: `${name} Sub-Group ${i + 1}`,
    shifts: Math.floor(Math.random() * 5) + 1
  }));
  
  // Get group card class based on color
  const getGroupCardClass = () => {
    switch (color) {
      case 'blue':
        return 'group-card-blue';
      case 'green':
        return 'group-card-green';
      case 'red':
        return 'group-card-red';
      default:
        return 'glass-panel';
    }
  };
  
  return (
    <div className={`animate-float mb-6 rounded-lg overflow-hidden shadow-2xl ${getGroupCardClass()} hover-glow transition-all duration-500`}>
      <div className="relative p-6 flex items-center justify-between">
        <div className="fade-slide-up">
          <h3 className="text-xl font-medium">{name}</h3>
          <p className="text-white/70 text-sm mt-1">{subGroups} Sub-Groups</p>
        </div>
        
        <div className="flex items-center space-x-3">
          <button className="p-2 rounded-lg bg-black/20 hover:bg-black/40 text-white/80 hover:text-blue-400 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <Edit size={18} className="transition-transform hover:scale-110" />
          </button>
          <button className="p-2 rounded-lg bg-black/20 hover:bg-black/40 text-white/80 hover:text-red-400 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <Trash size={18} className="transition-transform hover:scale-110" />
          </button>
          <button className="p-2 rounded-lg bg-black/20 hover:bg-black/40 text-white/80 hover:text-purple-400 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <Copy size={18} className="transition-transform hover:scale-110" />
          </button>
          <button 
            className="p-2 rounded-lg bg-black/20 hover:bg-black/40 text-white/80 hover:text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 
              <ChevronUp size={18} className="transition-transform duration-300" /> : 
              <ChevronDown size={18} className="transition-transform duration-300" />
            }
          </button>
        </div>
      </div>
      
      {expanded && (
        <div className="px-6 pb-6 animate-fade-in bg-black/40 backdrop-blur-lg">
          <div className="border-t border-white/20 pt-4 mb-4">
            {fakeSubGroups.map(subGroup => (
              <SubGroupSection 
                key={subGroup.id}
                id={subGroup.id}
                name={subGroup.name}
                shifts={subGroup.shifts}
              />
            ))}
          </div>
          
          <button className="flex items-center space-x-2 text-white/80 hover:text-white transition-all duration-300 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 w-full justify-center group">
            <Plus size={16} className="group-hover:rotate-90 transition-transform duration-300" />
            <span>Add Sub-Group</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default GroupSection;
