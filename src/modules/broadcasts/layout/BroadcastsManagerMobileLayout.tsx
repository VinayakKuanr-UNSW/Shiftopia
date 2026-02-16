/**
 * Mobile Layout for Broadcasts Manager Page
 *
 * Thin wrapper that renders BroadcastsManagerScreen in mobile mode.
 * All logic is handled by the BroadcastsManagerScreen component.
 *
 * Layout: Single column with bottom navigation
 * - Tabs: Groups | Analytics | Activity
 * - Only one section visible at a time
 * - DRILL-IN: Control Room (when group selected)
 */

import React from 'react';
import { BroadcastsManagerScreen } from '../ui/screens/BroadcastsManagerScreen';

import { ScopeSelection } from '@/platform/auth/types';

interface LayoutProps {
  scope?: ScopeSelection;
}

export const BroadcastsManagerMobileLayout: React.FC<LayoutProps> = ({ scope }) => {
  return <BroadcastsManagerScreen layout="mobile" scope={scope} />;
};

export default BroadcastsManagerMobileLayout;
