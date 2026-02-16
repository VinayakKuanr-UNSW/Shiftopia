
import React from 'react';
import { ProviderWrapper, ErrorBoundary } from '@/modules/core';
import AppRouter from './router/AppRouter';

const App = () => (
  <ErrorBoundary module="App">
    <ProviderWrapper>
      <AppRouter />
    </ProviderWrapper>
  </ErrorBoundary>
);

export default App;
