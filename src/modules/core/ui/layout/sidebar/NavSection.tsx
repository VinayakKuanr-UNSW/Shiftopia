import React from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronRight, FolderKanban, UserCircle2, Shield } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { NavSectionProps } from './types';

const NavSection: React.FC<NavSectionProps> = ({
  title,
  isOpen,
  onToggle,
  children,
  collapsed,
  sectionColor = "primary"
}) => {
  const colorClass = sectionColor === "primary" ? "text-primary" : `text-${sectionColor}-400`;
  
  // Get section icon based on title
  const getSectionIcon = () => {
    switch (title.toLowerCase()) {
      case "my workspace":
        return <UserCircle2 className={cn("h-5 w-5", colorClass)} />;
      case "rostering":
        return <FolderKanban className={cn("h-5 w-5", colorClass)} />;
      case "management":
        return <Shield className={cn("h-5 w-5", colorClass)} />;
      default:
        return <FolderKanban className={cn("h-5 w-5", colorClass)} />;
    }
  };
  
  return (
    <div className="mb-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggle}
              className={cn(
                // Always keep space for icon + label on the left, arrow (chevron) on the right
                "flex items-center w-full px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors justify-between",
                "mt-4 first:mt-0" // add spacing between sections
              )}
            >
              {/* Left Side: Icon + Label */}
              <div className="flex items-center gap-2">
                {getSectionIcon()}
                {!collapsed && (
                  <span className="text-sm font-medium uppercase tracking-wider text-xs text-muted-foreground">
                    {title}
                  </span>
                )}
              </div>
              
              {/* Right Side: Chevron (only if not collapsed) */}
              {!collapsed && (
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    isOpen && "transform rotate-180",
                    colorClass
                  )}
                />
              )}
              
              {/* If collapsed, we show a small indicator or nothing at all */}
              {collapsed && (
                <motion.div 
                  className={cn(
                    "ml-1",
                    "relative"
                  )}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {/* optional: place a tiny dot or arrow if you want a visual clue */}
                </motion.div>
              )}
            </button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">{title}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
      
      {/* Sub-menu when expanded and not collapsed */}
      {!collapsed && isOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="border-l border-border ml-3 pl-2" // vertical border for visual grouping
        >
          {children}
        </motion.div>
      )}
      
      {/* Collapsed sub-menu items (for quick hover) */}
      {collapsed && isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col items-center gap-1 mt-1"
        >
          {children}
        </motion.div>
      )}
    </div>
  );
};

export default NavSection;
