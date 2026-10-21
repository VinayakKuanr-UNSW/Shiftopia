import React from "react";
import {
  User,
  Shield,
  Palette,
  Bell,
  CreditCard,
  Link,
  ChevronRight,
  DollarSign,
} from "lucide-react";
import { cn } from "@/modules/core/lib/utils";
import { useTheme } from "@/modules/core/contexts/ThemeContext";
import { useTranslation } from "react-i18next";

interface SettingsFunctionBarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  transparent?: boolean;
  /** Show the manager-only Pay Rates section (gated by the caller). */
  showPayRates?: boolean;
}

export const SettingsFunctionBar: React.FC<SettingsFunctionBarProps> = ({
  activeSection,
  onSectionChange,
  transparent,
  showPayRates,
}) => {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const sections = [
    { id: "profile", label: t("settings.profile"), icon: User },
    { id: "security", label: t("settings.security"), icon: Shield },
    { id: "notifications", label: t("settings.notifications"), icon: Bell },
    { id: "appearance", label: t("settings.appearance"), icon: Palette },
    { id: "billing", label: t("settings.billing"), icon: CreditCard },
    { id: "integrations", label: t("settings.integrations"), icon: Link },
    ...(showPayRates ? [{ id: "pay-rates", label: t("settings.pay_rates"), icon: DollarSign }] : []),
  ];

  return (
    <div
      className={cn(
        "w-full transition-all overflow-visible sm:overflow-hidden",
        !transparent &&
          (isDark
            ? "bg-[#111827]/40"
            : "bg-white/40 shadow-sm border border-white/20"),
        !transparent && "rounded-2xl p-1.5",
      )}
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-row sm:items-center sm:overflow-x-auto sm:scrollbar-none sm:py-0.5">
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;

            return (
              <button
                key={section.id}
                onClick={() => onSectionChange(section.id)}
                className={cn(
                  "flex min-w-0 items-center justify-center gap-1.5 h-10 lg:h-11 px-2.5 sm:px-4 rounded-xl text-[9px] sm:text-[10px] lg:text-[11px] font-black transition-all uppercase tracking-widest sm:flex-shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                    : isDark
                      ? "bg-[#111827]/60 text-muted-foreground hover:text-foreground hover:bg-[#1c2333]"
                      : "bg-white/80 text-slate-700 hover:text-slate-950 hover:bg-white border border-slate-200/80 shadow-2xs",
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 lg:h-4 lg:w-4",
                    isActive ? "text-primary-foreground" : "opacity-70",
                  )}
                />
                <span className="min-w-0 truncate">{section.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right side info/status */}
        <div className="flex items-center gap-2 px-1 md:px-3 flex-shrink-0">
          <div className="hidden md:block h-6 w-px bg-border/40 mx-1" />
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
            <span>Status: Verified</span>
          </div>
        </div>
      </div>
    </div>
  );
};
