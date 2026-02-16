
import React from 'react';
import { Menu } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/modules/core/ui/primitives/button';
import { useSidebar } from '@/modules/core/ui/primitives/sidebar';

interface LogoSectionProps {
  isCollapsed: boolean;
}

const LogoSection: React.FC<LogoSectionProps> = ({ isCollapsed }) => {
  const { toggleSidebar } = useSidebar();
  
  return (
    <div className="flex items-center justify-between p-4 border-b border-border">
      <div className="flex items-center gap-3 overflow-hidden">
        {!isCollapsed && (
          <motion.span 
            className="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-400"
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -20, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            ShiftoPia
          </motion.span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className="rounded-full transition-all duration-200 hover:bg-muted/50 hover:rotate-180"
      >
        <Menu className="h-5 w-5" />
      </Button>
    </div>
  );
};

export default LogoSection;
