
import React from 'react';
import { ProviderWrapper, ErrorBoundary } from '@/modules/core';
import AppRouter from './router/AppRouter';
import { DevPerfOverlayGate } from '@/modules/core/ui/components/DevPerfOverlay';
import { PWAInstallPrompt } from '@/modules/core/ui/components/PWAInstallPrompt';
import { BiometricLockGate } from '@/modules/core/ui/components/BiometricLockGate';

const App = () => (
  <ErrorBoundary module="App">
    <ProviderWrapper>
      <AppRouter />
      {/* Biometric app-lock (native only; gates access when the user enables it) */}
      <BiometricLockGate />
      {/* PWA "Add to Home Screen" prompt (web only; hidden in the native shell) */}
      <PWAInstallPrompt />
      {/* Dev-only performance overlay — zero production cost (tree-shaken) */}
      <DevPerfOverlayGate />
    </ProviderWrapper>
  </ErrorBoundary>
);

export default App;
