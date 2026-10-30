import React from "react";
import {
  User,
  Shield,
  Palette,
  Bell,
  CreditCard,
  Link,
  DollarSign,
} from "lucide-react";
import { cn } from "@/modules/core/lib/utils";
import { ToolbarRow, ToolbarSegmented, toolbar } from "@/modules/core/ui/components/Toolbar";
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
    <ToolbarRow
      className={cn(!transparent && toolbar.standalone)}
      views={
        <ToolbarSegmented
          value={activeSection}
          onValueChange={onSectionChange}
          options={sections.map((section) => ({
            id: section.id,
            label: section.label,
            icon: <section.icon className="h-3.5 w-3.5" aria-hidden="true" />,
          }))}
          itemAriaLabel={(label) => `${label} settings`}
          label="Settings section"
        />
      }
      actions={
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span>Status: Verified</span>
        </div>
      }
    />
  );
};
