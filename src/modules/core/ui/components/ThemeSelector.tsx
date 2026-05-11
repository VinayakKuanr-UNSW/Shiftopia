import React from 'react';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';

/* ============================================================
   THEME SELECTOR COMPONENT
   Simple toggle between Light and Dark themes
   ============================================================ */
export const ThemeSelector: React.FC = () => {
  const { theme, toggleTheme, isDark } = useTheme();
  const { toast } = useToast();

  const handleToggle = () => {
    toggleTheme();
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggle}
            className={cn(
              'relative rounded-full overflow-hidden',
              'hover:bg-accent transition-all duration-300',
              'hover:scale-105 active:scale-95'
            )}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={theme}
                initial={{ y: -20, opacity: 0, rotate: -90 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }}
                exit={{ y: 20, opacity: 0, rotate: 90 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
              >
                {isDark ? (
                  <Moon className="h-5 w-5 text-blue-400" />
                ) : (
                  <Sun className="h-5 w-5 text-amber-500" />
                )}
              </motion.div>
            </AnimatePresence>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Switch to {isDark ? 'Light' : 'Dark'} Mode</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/* ============================================================
   THEME TOGGLE SWITCH (Alternative Style)
   A more visual toggle switch component
   ============================================================ */
export const ThemeToggleSwitch: React.FC<{ className?: string }> = ({ className }) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        'relative inline-flex h-8 w-14 items-center rounded-full transition-colors duration-300',
        isDark ? 'bg-slate-700' : 'bg-amber-100',
        className
      )}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
    >
      {/* Track icons */}
      <Sun className="absolute left-1.5 h-4 w-4 text-amber-500" />
      <Moon className="absolute right-1.5 h-4 w-4 text-blue-400" />

      {/* Sliding thumb */}
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={cn(
          'absolute h-6 w-6 rounded-full bg-white shadow-md',
          'flex items-center justify-center',
          isDark ? 'left-7' : 'left-1'
        )}
      >
        {isDark ? (
          <Moon className="h-3.5 w-3.5 text-slate-700" />
        ) : (
          <Sun className="h-3.5 w-3.5 text-amber-500" />
        )}
      </motion.span>
    </button>
  );
};

export default ThemeSelector;
