import React from 'react';
import { useParams } from 'react-router-dom';
import SettingsLayout from '@/modules/core/ui/layout/SettingsLayout';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Tabs, TabsContent } from '@/modules/core/ui/primitives/tabs';
import { RadioGroup, RadioGroupItem } from '@/modules/core/ui/primitives/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Card, CardContent } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { Check, User, Shield, Bell, CreditCard, Link } from 'lucide-react';

const AppearanceSettings: React.FC = () => {
  return (
    <div className="space-y-10">
      {/* Brand Color Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
        <div>
          <h3 className="text-base font-semibold text-white">Brand color</h3>
          <p className="text-sm text-blue-200/60 mt-1">
            Select or customize your brand color.
          </p>
        </div>
        <div className="flex items-center gap-4 p-6 rounded-2xl bg-white/5 border border-white/5">
          <div className="h-12 w-12 rounded-xl bg-[#A48AFB] shadow-[0_0_15px_rgba(164,138,251,0.3)] ring-2 ring-white/10"></div>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-white/40 font-mono">
              #
            </div>
            <Input
              value="A48AFB"
              className="pl-8 h-12 w-36 bg-black/20 border-white/10 text-white font-mono tracking-wide focus:border-primary/50"
            />
          </div>
        </div>
      </div>

      <div className="h-px bg-white/5 w-full"></div>

      {/* Dashboard Charts Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
        <div>
          <h3 className="text-base font-semibold text-white">Dashboard charts</h3>
          <p className="text-sm text-blue-200/60 mt-1">
            How charts are displayed.
          </p>
          <Button variant="link" className="px-0 text-primary text-sm mt-1 h-auto p-0 hover:text-primary/80">View examples</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Default Option */}
          <div className="relative group">
            <div className="overflow-hidden rounded-xl border-2 border-primary bg-[#1a2744]/50 cursor-pointer shadow-glow/20 transition-all duration-300">
              <div className="bg-white/5 p-3 text-xs font-medium text-white/80 border-b border-white/5">
                Dashboard
              </div>
              <div className="p-6 h-36 flex items-center justify-center">
                <div className="w-full h-full bg-primary/20 rounded-lg flex items-end gap-1 p-2">
                  <div className="w-1/4 h-[40%] bg-primary/40 rounded-sm"></div>
                  <div className="w-1/4 h-[70%] bg-primary/60 rounded-sm"></div>
                  <div className="w-1/4 h-[50%] bg-primary/40 rounded-sm"></div>
                  <div className="w-1/4 h-[90%] bg-primary rounded-sm shadow-[0_0_10px_rgba(var(--primary),0.5)]"></div>
                </div>
              </div>
            </div>
            <div className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-primary border-4 border-[#0d1424] flex items-center justify-center shadow-lg z-10">
              <Check className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="mt-3 text-center">
              <div className="font-medium text-sm text-white">Default</div>
              <div className="text-xs text-blue-200/40">Default company branding.</div>
            </div>
          </div>

          {/* Simplified Option */}
          <div className="relative group">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer transition-all duration-300 hover:border-white/20">
              <div className="bg-white/5 p-3 text-xs font-medium text-white/50 border-b border-white/5 group-hover:text-white/80">
                Dashboard
              </div>
              <div className="p-6 h-36 flex items-center justify-center">
                <div className="w-full h-full bg-white/5 rounded-lg flex items-end gap-1 p-2">
                  <div className="w-1/4 h-[40%] bg-white/10 rounded-sm"></div>
                  <div className="w-1/4 h-[70%] bg-white/10 rounded-sm"></div>
                  <div className="w-1/4 h-[50%] bg-white/10 rounded-sm"></div>
                  <div className="w-1/4 h-[90%] bg-white/20 rounded-sm"></div>
                </div>
              </div>
            </div>
            <div className="mt-3 text-center">
              <div className="font-medium text-sm text-white/80">Simplified</div>
              <div className="text-xs text-blue-200/40">Minimal and modern.</div>
            </div>
          </div>

          {/* Custom CSS Option */}
          <div className="relative group">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer transition-all duration-300 hover:border-white/20">
              <div className="bg-white/5 p-3 text-xs font-medium text-white/50 border-b border-white/5 group-hover:text-white/80">
                Dashboard
              </div>
              <div className="p-6 h-36 flex items-center justify-center relative">
                <div className="w-full h-16 bg-white/5 rounded-md border border-dashed border-white/10"></div>
                <Button className="absolute inset-0 m-auto w-max h-9 opacity-0 group-hover:opacity-100 transition-opacity bg-white text-black hover:bg-white/90" size="sm">
                  Edit CSS
                </Button>
              </div>
            </div>
            <div className="mt-3 text-center">
              <div className="font-medium text-sm text-white/80">Custom CSS</div>
              <div className="text-xs text-blue-200/40">Manage styling with CSS.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-white/5 w-full"></div>

      {/* Language Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
        <div>
          <h3 className="text-base font-semibold text-white">Language</h3>
          <p className="text-sm text-blue-200/60 mt-1">
            Default language for public dashboard.
          </p>
        </div>
        <div>
          <Select defaultValue="en-GB">
            <SelectTrigger className="w-full sm:w-[280px] h-11 bg-white/5 border-white/10 text-white hover:bg-white/10 focus:border-primary/50">
              <div className="flex items-center gap-3">
                <span className="text-lg">🇬🇧</span>
                <SelectValue placeholder="Select language" />
              </div>
            </SelectTrigger>
            <SelectContent className="bg-[#1a2744] border-white/10 text-white backdrop-blur-xl">
              <SelectItem value="en-GB" className="focus:bg-white/10 focus:text-white">
                <div className="flex items-center gap-3">
                  <span className="text-lg">🇬🇧</span>
                  <span>English (UK)</span>
                </div>
              </SelectItem>
              <SelectItem value="en-US" className="focus:bg-white/10 focus:text-white">
                <div className="flex items-center gap-3">
                  <span className="text-lg">🇺🇸</span>
                  <span>English (US)</span>
                </div>
              </SelectItem>
              <SelectItem value="fr-FR" className="focus:bg-white/10 focus:text-white">
                <div className="flex items-center gap-3">
                  <span className="text-lg">🇫🇷</span>
                  <span>French (FR)</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="h-px bg-white/5 w-full"></div>

      {/* Cookie Banner Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
        <div>
          <h3 className="text-base font-semibold text-white">Cookie banner</h3>
          <p className="text-sm text-blue-200/60 mt-1">
            Display cookie banners to visitors.
          </p>
          <Button variant="link" className="px-0 text-primary text-sm mt-1 h-auto p-0 hover:text-primary/80">View examples</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Default Option */}
          <div className="relative group">
            <div className="overflow-hidden rounded-xl border-2 border-primary bg-[#1a2744]/50 cursor-pointer shadow-glow/20 transition-all duration-300">
              <div className="bg-white/5 p-3 text-xs font-medium text-white/80 border-b border-white/5">
                Browser
              </div>
              <div className="p-4 h-32 flex items-end">
                <div className="w-full h-12 bg-primary/20 rounded-md border border-primary/30 flex items-center justify-center">
                  <div className="w-16 h-2 bg-primary/40 rounded-full"></div>
                </div>
              </div>
            </div>
            <div className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-primary border-4 border-[#0d1424] flex items-center justify-center shadow-lg z-10">
              <Check className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="mt-3 text-center">
              <div className="font-medium text-sm text-white">Default</div>
              <div className="text-xs text-blue-200/40">Cookie controls for visitors.</div>
            </div>
          </div>

          {/* Simplified Option */}
          <div className="relative group">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer transition-all duration-300 hover:border-white/20">
              <div className="bg-white/5 p-3 text-xs font-medium text-white/50 border-b border-white/5 group-hover:text-white/80">
                Browser
              </div>
              <div className="p-4 h-32 flex items-end">
                <div className="w-full h-8 bg-white/10 rounded-md border border-white/5"></div>
              </div>
            </div>
            <div className="mt-3 text-center">
              <div className="font-medium text-sm text-white/80">Simplified</div>
              <div className="text-xs text-blue-200/40">Show a simplified banner.</div>
            </div>
          </div>

          {/* None Option */}
          <div className="relative group">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer transition-all duration-300 hover:border-white/20">
              <div className="bg-white/5 p-3 text-xs font-medium text-white/50 border-b border-white/5 group-hover:text-white/80">
                Browser
              </div>
              <div className="p-4 h-32 flex items-center justify-center">
                <div className="text-xs text-white/30 font-medium px-3 py-1 bg-white/5 rounded-full">No banner</div>
              </div>
            </div>
            <div className="mt-3 text-center">
              <div className="font-medium text-sm text-white/80">None</div>
              <div className="text-xs text-blue-200/40">Don't show any banners.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SettingsPage: React.FC = () => {
  const { section = 'appearance' } = useParams<{ section?: string }>();

  return (
    <SettingsLayout
      title="Settings"
      description="Manage your account settings and preferences."
    >
      <Tabs value={section} className="w-full">
        <TabsContent value="appearance">
          <AppearanceSettings />
        </TabsContent>
        <TabsContent value="account">
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <div className="p-4 rounded-full bg-white/5 border border-white/10">
              <User className="h-8 w-8 text-white/40" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-white">Account Settings Test</h3>
              <p className="text-blue-200/60 max-w-sm mt-1">This section is currently under development.</p>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="profile">
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <div className="p-4 rounded-full bg-white/5 border border-white/10">
              <User className="h-8 w-8 text-white/40" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-white">Profile Settings</h3>
              <p className="text-blue-200/60 max-w-sm mt-1">Manage your public profile information.</p>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="security">
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <div className="p-4 rounded-full bg-white/5 border border-white/10">
              <Shield className="h-8 w-8 text-white/40" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-white">Security</h3>
              <p className="text-blue-200/60 max-w-sm mt-1">Password, 2FA, and session management.</p>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="notifications">
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <div className="p-4 rounded-full bg-white/5 border border-white/10">
              <Bell className="h-8 w-8 text-white/40" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-white">Notifications</h3>
              <p className="text-blue-200/60 max-w-sm mt-1">Configure how you receive alerts.</p>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="billing">
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <div className="p-4 rounded-full bg-white/5 border border-white/10">
              <CreditCard className="h-8 w-8 text-white/40" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-white">Billing & Plans</h3>
              <p className="text-blue-200/60 max-w-sm mt-1">Manage subscription and payment methods.</p>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="integrations">
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <div className="p-4 rounded-full bg-white/5 border border-white/10">
              <Link className="h-8 w-8 text-white/40" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-white">Integrations</h3>
              <p className="text-blue-200/60 max-w-sm mt-1">Connect with third-party services.</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </SettingsLayout>
  );
};

export default SettingsPage;
