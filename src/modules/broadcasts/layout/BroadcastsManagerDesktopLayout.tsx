/**
 * Desktop Layout for Broadcasts Manager Page
 *
 * Thin wrapper that renders BroadcastsManagerScreen in desktop mode.
 * All logic is handled by the BroadcastsManagerScreen component.
 *
 * Layout: Three-column layout
 * - LEFT: Groups list with hierarchy filter
 * - MIDDLE: Analytics & Activity
 * - DRILL-IN: Control Room (when group selected)
 */

import React from 'react';
import { BroadcastsManagerScreen } from '../ui/screens/BroadcastsManagerScreen';

import { ScopeSelection } from '@/platform/auth/types';

interface LayoutProps {
  scope?: ScopeSelection;
}

export const BroadcastsManagerDesktopLayout: React.FC<LayoutProps> = ({ scope }) => {
  return <BroadcastsManagerScreen layout="desktop" scope={scope} />;
};

export default BroadcastsManagerDesktopLayout;
