import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '@/modules/settings/hooks/useSettings';

interface LocaleProviderProps {
  children: React.ReactNode;
}

export const LocaleProvider: React.FC<LocaleProviderProps> = ({ children }) => {
  const { i18n } = useTranslation();
  const { orgBranding } = useSettings();

  useEffect(() => {
    if (orgBranding?.language) {
      console.log('[LocaleProvider] Syncing language:', orgBranding.language);
      i18n.changeLanguage(orgBranding.language);
    }
  }, [orgBranding?.language, i18n]);

  useEffect(() => {
    const handleUpdate = (e: any) => {
      if (e.detail?.language) {
        console.log('[LocaleProvider] Live sync language:', e.detail.language);
        i18n.changeLanguage(e.detail.language);
      }
    };

    window.addEventListener('branding-updated', handleUpdate);
    return () => window.removeEventListener('branding-updated', handleUpdate);
  }, [i18n]);

  return <>{children}</>;
};
