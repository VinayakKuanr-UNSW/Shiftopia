import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  User,
  Shield,
  Palette,
  Bell,
  CreditCard,
  Link,
  MoreVertical,
  ExternalLink
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/modules/core/ui/primitives/card';
import { Tabs, TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';

interface SettingsLayoutProps {
  children: React.ReactNode;
  title: string;
  description?: string;
}

const SettingsLayout: React.FC<SettingsLayoutProps> = ({
  children,
  title,
  description
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(() => {
    const path = location.pathname.split('/').pop() || 'appearance';
    return path;
  });

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    navigate(`/settings/${value}`);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">{title}</h1>
          {description && <p className="text-blue-200/60 mt-1 max-w-2xl">{description}</p>}
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="glass" className="bg-white/5 text-blue-200/40 border-white/10 hidden md:flex items-center gap-1.5 px-3 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"></span>
            System Operational
          </Badge>
          <div className="h-8 w-px bg-white/10 mx-1 hidden md:block"></div>
          <Button variant="outline" size="sm" className="bg-white/5 border-white/10 hover:bg-white/10 text-white gap-2">
            <ExternalLink className="h-4 w-4 text-blue-300" />
            Public Dashboard
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
        {/* Sidebar Navigation */}
        <div className="space-y-6">
          <div className="bg-[#1a2744]/30 backdrop-blur-xl border border-white/5 rounded-2xl p-4 space-y-1">
            <div className="text-xs font-semibold text-blue-200/40 uppercase tracking-wider px-3 mb-2 mt-1">
              Account
            </div>
            <NavButton
              active={activeTab === 'profile'}
              onClick={() => handleTabChange('profile')}
              icon={<User className="h-4 w-4" />}
              label="Profile"
            />
            <NavButton
              active={activeTab === 'security'}
              onClick={() => handleTabChange('security')}
              icon={<Shield className="h-4 w-4" />}
              label="Security"
            />
            <NavButton
              active={activeTab === 'notifications'}
              onClick={() => handleTabChange('notifications')}
              icon={<Bell className="h-4 w-4" />}
              label="Notifications"
            />

            <div className="h-px bg-white/5 my-4 mx-2"></div>

            <div className="text-xs font-semibold text-blue-200/40 uppercase tracking-wider px-3 mb-2">
              Workspace
            </div>
            <NavButton
              active={activeTab === 'appearance'}
              onClick={() => handleTabChange('appearance')}
              icon={<Palette className="h-4 w-4" />}
              label="Appearance"
            />
            <NavButton
              active={activeTab === 'billing'}
              onClick={() => handleTabChange('billing')}
              icon={<CreditCard className="h-4 w-4" />}
              label="Billing & Plans"
            />
            <NavButton
              active={activeTab === 'integrations'}
              onClick={() => handleTabChange('integrations')}
              icon={<Link className="h-4 w-4" />}
              label="Integrations"
            />
          </div>

          <div className="bg-gradient-to-br from-purple-900/20 to-indigo-900/20 border border-white/5 rounded-2xl p-6 relative overflow-hidden group hover:border-white/10 transition-colors">
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
            <h3 className="text-white font-medium relative z-10">Need help?</h3>
            <p className="text-sm text-blue-200/60 mt-1 mb-4 relative z-10">Check our documentation or contact support.</p>
            <Button size="sm" variant="secondary" className="w-full bg-white/10 hover:bg-white/20 text-white border-0">
              Contact Support
            </Button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="min-w-0">
          <div className="bg-[#1a2744]/30 backdrop-blur-xl border border-white/5 rounded-3xl p-6 md:p-8 min-h-[600px] relative overflow-hidden">
            {/* Subtle background glow */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

            <div className="relative z-10">
              {children}
            </div>
          </div>

          <div className="flex justify-end mt-6 space-x-3">
            <Button variant="ghost" className="text-white/60 hover:text-white hover:bg-white/5">Discard Changes</Button>
            <Button className="bg-primary hover:bg-primary/90 text-white shadow-glow">Save Preferences</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper component for Nav Buttons
const NavButton = ({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
      active
        ? "bg-primary text-white shadow-glow/30"
        : "text-blue-200/60 hover:text-white hover:bg-white/5"
    )}
  >
    {React.cloneElement(icon as React.ReactElement, {
      className: cn("h-4 w-4", active ? "text-white" : "text-current opacity-70")
    })}
    {label}
  </button>
);

export default SettingsLayout;
