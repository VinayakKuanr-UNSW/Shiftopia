import React from 'react';
import { 
  User, 
  Shield, 
  Palette, 
  Bell, 
  CreditCard, 
  Link,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { useTranslation } from 'react-i18next';

interface SettingsFunctionBarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  transparent?: boolean;
}


export const SettingsFunctionBar: React.FC<SettingsFunctionBarProps> = ({
  activeSection,
  onSectionChange,
  transparent
}) => {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const sections = [
    { id: 'profile', label: t('settings.profile'), icon: User },
    { id: 'security', label: t('settings.security'), icon: Shield },
    { id: 'notifications', label: t('settings.notifications'), icon: Bell },
    { id: 'appearance', label: t('settings.appearance'), icon: Palette },
    { id: 'billing', label: t('settings.billing'), icon: CreditCard },
    { id: 'integrations', label: t('settings.integrations'), icon: Link },
  ];

  return (
    <div className={cn(
      "flex flex-row items-center gap-2 w-full transition-all overflow-hidden",
      !transparent && (isDark ? "bg-[#111827]/40" : "bg-white/40 shadow-sm border border-white/20"),
      !transparent && "rounded-2xl p-1.5"
    )}>
      {/* Scrollable Tabs Container */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-none py-0.5">
        {sections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          
          return (
            <button
              key={section.id}
              onClick={() => onSectionChange(section.id)}
              className={cn(
                "flex items-center gap-2 h-10 lg:h-11 px-4 rounded-xl text-[10px] lg:text-[11px] font-black transition-all flex-shrink-0 uppercase tracking-widest",
                isActive
                  ? (isDark 
                      ? "bg-primary text-white shadow-lg shadow-primary/20" 
                      : "bg-primary text-white shadow-md shadow-primary/20")
                  : (isDark 
                      ? "bg-[#111827]/60 text-white/40 hover:text-white hover:bg-[#1c2333]" 
                      : "bg-white/60 text-slate-900/40 hover:text-slate-900 hover:bg-white border border-slate-200/50")
              )}
            >
              <Icon className={cn("h-3.5 w-3.5 lg:h-4 lg:w-4", isActive ? "text-white" : "opacity-50")} />
              <span>{section.label}</span>
            </button>
          );
        })}
      </div>

      {/* Right side info/status if needed */}
      <div className="hidden md:flex items-center gap-3 px-3">
        <div className="h-6 w-px bg-border/20 mx-1" />
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]"></span>
          <span>Status: Verified</span>
        </div>
      </div>
    </div>
  );
};
