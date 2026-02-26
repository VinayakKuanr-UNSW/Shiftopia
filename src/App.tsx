
import React from 'react';
import { ProviderWrapper, ErrorBoundary } from '@/modules/core';
import AppRouter from './router/AppRouter';
import { DevPerfOverlayGate } from '@/modules/core/ui/components/DevPerfOverlay';

const App = () => (
  <ErrorBoundary module="App">
    <ProviderWrapper>
      <AppRouter />
      {/* Dev-only performance overlay — zero production cost (tree-shaken) */}
      <DevPerfOverlayGate />
    </ProviderWrapper>
  </ErrorBoundary>
);

export default App;
