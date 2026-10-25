import { applyBrandColor } from '@/modules/core/lib/brandColor';
import { PageState } from '@/modules/core/ui/components/PageState';
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { cn } from '@/modules/core/lib/utils';
import { page, surface } from '@/modules/core/ui/layout/pageTokens';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { SettingsFunctionBar } from '../ui/components/SettingsFunctionBar';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Tabs, TabsContent } from '@/modules/core/ui/primitives/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Button } from '@/modules/core/ui/primitives/button';
import { Check, User, Shield, Bell, CreditCard, Link, Loader2, Save, Palette } from 'lucide-react';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { useSettings, SUPPORTED_LOCALES } from '../hooks/useSettings';
import { supabase } from '@/platform/supabase/client';
import { toast } from '@/modules/core/ui/primitives/use-toast';
import { useTranslation } from 'react-i18next';
import i18n from '@/platform/i18n';
import { useAuth } from '@/platform/auth/useAuth';
import { PayRatesSettings } from '@/modules/payroll/ui/rate-admin/PayRatesSettings';
import { BiometricToggle } from '@/modules/settings/ui/components/BiometricToggle';
import { NotificationToggle } from '@/modules/settings/ui/components/NotificationToggle';


/* ============================================================
   HELPERS
   ============================================================ */

const DEFAULT_BRAND_COLOR = '#A48AFB';

/* ============================================================
   APPEARANCE SETTINGS
   ============================================================ */
const AppearanceSettings: React.FC = () => {
  const { t } = useTranslation();
  const { orgBranding, updateBranding, updateLanguage, isOrgLoading } = useSettings();
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [chartStyle, setChartStyle] = useState('default');
  const [language, setLanguage] = useState('en-GB');
  const [cookieBanner, setCookieBanner] = useState('default');
  const [enableGroupColoring, setEnableGroupColoring] = useState(false);
  const [hexError, setHexError] = useState(false);

  useEffect(() => {
    if (orgBranding && !updateBranding.isPending && !updateLanguage.isPending) {
      const b = orgBranding as any;
      setBrandColor(b.brand_color || DEFAULT_BRAND_COLOR);
      setChartStyle(b.chart_style || 'default');
      setLanguage(b.language || 'en-GB');
      setCookieBanner(b.cookie_banner || 'default');
      setEnableGroupColoring(b.enable_group_coloring || false);
    }
  }, [orgBranding, updateBranding.isPending]);

  // Live Preview Effect
  const updateLivePreview = (color: string) => {
    setHexError(!applyBrandColor(color));
  };

  const handleBrandColorChange = (value: string) => {
    const sanitized = value.toUpperCase().replace(/[^0-9A-F]/g, '').substring(0, 6);
    const newColor = `#${sanitized}`;
    setBrandColor(newColor);
    updateLivePreview(newColor);
  };

  const handleReset = () => {
    setBrandColor(DEFAULT_BRAND_COLOR);
    updateLivePreview(DEFAULT_BRAND_COLOR);
  };

  const handleSave = () => {
    if (hexError) {
      toast({ title: "Invalid brand color", description: "Please enter a valid 6-character hex code.", variant: "destructive" });
      return;
    }
    updateBranding.mutate({
      brand_color: brandColor,
      chart_style: chartStyle,
      cookie_banner: cookieBanner,
      enable_group_coloring: enableGroupColoring,
    });
  };

  if (isOrgLoading) {
    return (
      <PageState state="loading" title="Loading settings" />
    );
  }

  return (
    <div className="space-y-10">
      {/* Brand Color Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 md:gap-8 items-start">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">{t('settings.brand_color')}</h3>
          <p className="text-[13px] text-muted-foreground mt-1">
            Global color for your organization.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4 p-4 sm:p-5 rounded-2xl bg-card border border-border/80 shadow-xs">
            <div 
              className="h-11 w-11 rounded-xl ring-2 ring-border shadow-xs transition-colors duration-300 flex-shrink-0" 
              style={{ backgroundColor: /^[0-9A-F]{6}$/i.test(brandColor.replace('#','')) ? brandColor : '#333' }}
              aria-label="Current brand color preview"
            />
            <div className="relative flex-1 max-w-[200px]">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground font-mono text-[13px]">
                #
              </div>
              <Input
                value={brandColor.replace('#', '')}
                onChange={(e) => handleBrandColorChange(e.target.value)}
                maxLength={6}
                aria-label="Hex color value"
                className={cn(
                  "pl-7 h-10 bg-background border-input text-foreground font-mono tracking-wide transition-all",
                  hexError ? "border-destructive ring-1 ring-destructive/30" : "focus:border-primary"
                )}
              />
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleReset}
              className="text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {t('common.cancel')}
            </Button>
          </div>
          {hexError && <p className="text-[11px] text-destructive ml-1">Please enter a valid hex code (e.g. A48AFB)</p>}
        </div>
      </div>

      <div className="h-px bg-border/60 w-full" />

      {/* Chart Style Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 md:gap-8 items-start">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">{t('settings.chart_style')}</h3>
          <p className="text-[13px] text-muted-foreground mt-1">
            Visual style for analytics.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            { id: 'default', label: 'Default', desc: 'Standard multi-bar display' },
            { id: 'simplified', label: 'Simplified', desc: 'Minimal clean presentation' },
            { id: 'custom-css', label: 'Custom CSS', desc: 'Organization custom styles' },
          ].map(({ id: style, label, desc }) => {
            const isSelected = chartStyle === style;
            return (
              <button
                key={style}
                type="button"
                onClick={() => setChartStyle(style)}
                aria-pressed={isSelected}
                className={cn(
                  "relative group text-left cursor-pointer transition-all duration-200 rounded-xl overflow-hidden border-2 bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  isSelected
                    ? "border-primary shadow-sm ring-1 ring-primary/20"
                    : "border-border/80 hover:border-foreground/30 hover:shadow-xs"
                )}
              >
                {/* Header */}
                <div className={cn(
                  "pl-4 pr-11 py-2.5 text-[11px] font-semibold border-b transition-colors flex items-center justify-between",
                  isSelected
                    ? "bg-primary/5 text-primary border-primary/20"
                    : "bg-muted/40 text-muted-foreground border-border/70 group-hover:text-foreground"
                )}>
                  <span>{label}</span>
                  {isSelected && <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Active</span>}
                </div>

                {/* Preview Box */}
                <div className="p-4 h-32 flex flex-col justify-between bg-muted/15">
                  <div className={cn(
                    "w-full h-20 rounded-lg p-2.5 flex items-end gap-2 transition-all border",
                    isSelected ? "bg-card border-border/80 shadow-xs" : "bg-muted/30 border-border/40 opacity-70 group-hover:opacity-100"
                  )}>
                    {style === 'default' && (
                      <>
                        <div className="w-1/4 h-[40%] bg-primary/35 rounded-sm" />
                        <div className="w-1/4 h-[75%] bg-primary/60 rounded-sm" />
                        <div className="w-1/4 h-[50%] bg-primary/45 rounded-sm" />
                        <div className="w-1/4 h-[95%] bg-primary rounded-sm shadow-xs" />
                      </>
                    )}
                    {style === 'simplified' && (
                      <>
                        <div className="w-1/3 h-[45%] bg-primary/35 rounded-sm" />
                        <div className="w-1/3 h-[65%] bg-primary/60 rounded-sm" />
                        <div className="w-1/3 h-[85%] bg-primary rounded-sm shadow-xs" />
                      </>
                    )}
                    {style === 'custom-css' && (
                      <div className="w-full h-full flex flex-col justify-center items-center gap-1.5 border border-dashed border-border rounded-sm">
                        <span className="font-mono text-[11px] font-semibold text-muted-foreground">{'/* custom.css */'}</span>
                        <div className="w-24 h-1.5 bg-primary/50 rounded-full" />
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground/80 line-clamp-1">{desc}</span>
                </div>

                {/* Selection Checkmark Badge */}
                {isSelected && (
                  <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xs">
                    <Check className="h-3 w-3 stroke-[3]" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-border/60 w-full" />

      {/* Language Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 md:gap-8 items-start">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">{t('settings.language')}</h3>
          <p className="text-[13px] text-muted-foreground mt-1">
            {t('settings.language_description')}
          </p>
        </div>
        <div>
          <Select value={language} onValueChange={(newLang) => {
            const previous = language;
            setLanguage(newLang);
            i18n.changeLanguage(newLang);
            window.dispatchEvent(new CustomEvent('branding-updated', { detail: { language: newLang } }));
            updateLanguage.mutate(
              { language: newLang },
              {
                onError: () => {
                  setLanguage(previous);
                  i18n.changeLanguage(previous);
                  window.dispatchEvent(new CustomEvent('branding-updated', { detail: { language: previous } }));
                },
              }
            );
          }}>
            {/* SelectValue renders the chosen item — flag included — so the
                trigger adds nothing of its own (it used to show the flag twice). */}
            <SelectTrigger className="w-full sm:w-[280px] text-foreground hover:bg-accent/40 focus:ring-2 focus:ring-primary/20 focus:border-primary">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-popover-foreground shadow-lg">
              {SUPPORTED_LOCALES.map(({ code, label, flag }) => (
                <SelectItem key={code} value={code} className="focus:bg-accent focus:text-accent-foreground cursor-pointer">
                  <span className="mr-2" aria-hidden="true">{flag}</span> {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="h-px bg-border/60 w-full" />

      {/* Cookie Banner Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 md:gap-8 items-start">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">{t('settings.cookie_banner')}</h3>
          <p className="text-[13px] text-muted-foreground mt-1">
            Display cookie banners to visitors.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            { id: 'default', label: 'Default', desc: 'Full width banner with details' },
            { id: 'simplified', label: 'Simplified', desc: 'Compact bottom toast' },
            { id: 'none', label: 'None', desc: 'Do not show cookie consent banner' },
          ].map(({ id: option, label, desc }) => {
            const isSelected = cookieBanner === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setCookieBanner(option)}
                aria-pressed={isSelected}
                className={cn(
                  "relative group text-left cursor-pointer transition-all duration-200 rounded-xl overflow-hidden border-2 bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  isSelected
                    ? "border-primary shadow-sm ring-1 ring-primary/20"
                    : "border-border/80 hover:border-foreground/30 hover:shadow-xs"
                )}
              >
                {/* Header */}
                <div className={cn(
                  "pl-4 pr-11 py-2.5 text-[11px] font-semibold border-b transition-colors flex items-center justify-between",
                  isSelected
                    ? "bg-primary/5 text-primary border-primary/20"
                    : "bg-muted/40 text-muted-foreground border-border/70 group-hover:text-foreground"
                )}>
                  <span>{label}</span>
                  {isSelected && <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Active</span>}
                </div>

                {/* Preview Box */}
                <div className="p-4 h-32 flex flex-col justify-between bg-muted/15">
                  <div className="w-full h-20 rounded-lg p-2.5 flex items-end justify-center bg-muted/30 border border-border/40">
                    {option === 'none' ? (
                      <span className="text-[11px] text-muted-foreground font-medium px-3 py-1 bg-card rounded-full border border-border/60 shadow-2xs mb-2">
                        No banner
                      </span>
                    ) : (
                      <div className={cn(
                        "w-full bg-card rounded-md border border-border/80 shadow-xs flex items-center justify-between px-2.5 py-1.5 mb-1 transition-all",
                        option === 'simplified' ? "w-3/4" : "w-full"
                      )}>
                        <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full" />
                        <div className="w-4 h-2 bg-primary/80 rounded-xs" />
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground/80 line-clamp-1">{desc}</span>
                </div>

                {/* Selection Checkmark Badge */}
                {isSelected && (
                  <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xs">
                    <Check className="h-3 w-3 stroke-[3]" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-border/60 w-full" />

      {/* Group Coloring Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 md:gap-8 items-start">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">Advanced coloring</h3>
          <p className="text-[13px] text-muted-foreground mt-1">
            Group-based card themes.
          </p>
        </div>
        <div className="p-5 sm:p-6 rounded-2xl bg-card border border-border/80 shadow-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <Palette className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-foreground">Group-based Card Coloring</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Automatically color-code timecards by center (Convention, Exhibition, Theatre).</p>
            </div>
          </div>
          <Switch 
            checked={enableGroupColoring} 
            onCheckedChange={setEnableGroupColoring}
            aria-label="Toggle group-based card coloring"
          />
        </div>
      </div>

      <div className="pt-6 border-t border-border/60 flex justify-end">
        <Button 
          onClick={handleSave} 
          disabled={updateBranding.isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-11 px-8 rounded-xl shadow-sm transition-all"
        >
          {updateBranding.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
};

/* ============================================================
   PROFILE SETTINGS
   ============================================================ */
const ProfileSettings: React.FC = () => {
  const { user, updateProfile } = useSettings();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });

  useEffect(() => {
    if (user) {
      setFormData({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        phone: (user as any).phone || '',
      });
    }
  }, [user]);

  const handleSave = () => {
    updateProfile.mutate({
      ...formData,
      fullName: `${formData.firstName} ${formData.lastName}`.trim(),
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-foreground text-[13px] font-semibold">First name</Label>
          <Input 
            value={formData.firstName} 
            onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
            className="bg-background border-input text-foreground focus-visible:ring-primary" 
          />
        </div>
        <div className="space-y-2">
          <Label className="text-foreground text-[13px] font-semibold">Last name</Label>
          <Input 
            value={formData.lastName} 
            onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
            className="bg-background border-input text-foreground focus-visible:ring-primary" 
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-foreground text-[13px] font-semibold">Email address</Label>
        <Input 
          value={formData.email} 
          disabled
          className="bg-muted/50 border-input text-muted-foreground cursor-not-allowed" 
        />
        <p className="text-[11px] text-muted-foreground">Email cannot be changed directly for security reasons.</p>
      </div>
      <div className="space-y-2">
        <Label className="text-foreground text-[13px] font-semibold">Phone number</Label>
        <Input 
          value={formData.phone} 
          onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
          className="bg-background border-input text-foreground focus-visible:ring-primary" 
        />
      </div>
      <div className="pt-4 flex justify-end">
        <Button 
          onClick={handleSave} 
          disabled={updateProfile.isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 rounded-xl h-11 shadow-sm"
        >
          {updateProfile.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Update Profile
        </Button>
      </div>
    </div>
  );
};

/* ============================================================
   SECURITY SETTINGS
   ============================================================ */
const SecuritySettings: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);

  const handleResetPassword = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("User not found");
      
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/settings/security`,
      });
      if (error) throw error;
      toast({ title: "Reset email sent", description: "Please check your inbox." });
    } catch (e: any) {
      toast({ title: "Failed to send reset email", description: e.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-2xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h4 className="text-foreground font-semibold">Password</h4>
            <p className="text-[13px] text-muted-foreground mt-1">Change your account password regularly for better security.</p>
          </div>
          <Button 
            variant="outline" 
            onClick={handleResetPassword}
            disabled={isLoading}
            className="border-input text-foreground hover:bg-accent hover:text-accent-foreground sm:flex-shrink-0"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Request Password Reset"}
          </Button>
        </div>
      </div>

      {/* Native-only: renders nothing in a browser (see BiometricToggle). */}
      <BiometricToggle />

      <div className="p-6 rounded-2xl bg-card/50 border border-border/60 opacity-60 cursor-not-allowed">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h4 className="text-foreground font-semibold">Two-factor Authentication</h4>
            <p className="text-[13px] text-muted-foreground mt-1">Add an extra layer of security to your account.</p>
          </div>
          <Button variant="ghost" disabled className="text-muted-foreground sm:flex-shrink-0">Coming Soon</Button>
        </div>
      </div>
    </div>
  );
};

const NotificationSettings: React.FC = () => (
  <div className="space-y-6">
    <div className="flex items-center gap-3">
      <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
        <Bell className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h3 className="text-[15px] font-semibold text-foreground">Notifications</h3>
        <p className="text-[13px] text-muted-foreground">Choose how Shiftopia reaches you on this device.</p>
      </div>
    </div>
    <NotificationToggle />
  </div>
);

/* ============================================================
   MAIN SETTINGS PAGE
   ============================================================ */
const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const { section = 'appearance' } = useParams<{ section?: string }>();

  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  // Pay Rates is a management/configuration surface (EBA wage schedule).
  const canManageRates = hasPermission('configurations');

  const handleSectionChange = (newSection: string) => {
    navigate(`/settings/${newSection}`);
  };

  return (
    <PageLayout>
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <GoldStandardHeader
        title={t('settings.title')}
        Icon={Palette}
        mode="managerial" // Settings is usually org-wide/managerial
        functionBar={
          <SettingsFunctionBar
            activeSection={section}
            onSectionChange={handleSectionChange}
            transparent
            showPayRates={canManageRates}
          />
        }
      />

      {/* ── Main Content Area ─────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={cn(
            "h-full overflow-auto",
            page.bodyInset,
            surface.bodyCard
        )}>
          <Tabs value={section} className="w-full">
            <TabsContent value="appearance">
              <AppearanceSettings />
            </TabsContent>
            <TabsContent value="profile">
              <ProfileSettings />
            </TabsContent>
            <TabsContent value="security">
              <SecuritySettings />
            </TabsContent>
            <TabsContent value="pay-rates">
              {canManageRates ? (
                <PayRatesSettings />
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                  <div className="p-4 rounded-full bg-muted border border-border">
                    <Shield className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-semibold text-foreground">Not authorised</h3>
                    <p className="text-muted-foreground max-w-sm mt-1 text-[13px]">Pay-rate administration is restricted to managers.</p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="notifications">
              <NotificationSettings />
            </TabsContent>

            {/* Static placeholders for pending features */}
            {['account', 'billing', 'integrations'].map(tab => (
              <TabsContent key={tab} value={tab}>
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                  <div className="p-4 rounded-full bg-muted border border-border">
                    {tab === 'notifications' ? <Bell className="h-8 w-8 text-muted-foreground" /> : 
                     tab === 'billing' ? <CreditCard className="h-8 w-8 text-muted-foreground" /> : 
                     tab === 'integrations' ? <Link className="h-8 w-8 text-muted-foreground" /> :
                     <User className="h-8 w-8 text-muted-foreground" />}
                  </div>
                  <div>
                    <h3 className="text-[15px] font-semibold text-foreground capitalize">{tab} Settings</h3>
                    <p className="text-muted-foreground max-w-sm mt-1 text-[13px]">This section is currently under development.</p>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </PageLayout>
  );
};

export default SettingsPage;
