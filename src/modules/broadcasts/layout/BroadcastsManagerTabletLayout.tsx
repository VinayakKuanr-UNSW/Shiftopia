/**
 * Tablet Layout for Broadcasts Manager Page
 *
 * Thin wrapper that renders BroadcastsManagerScreen in tablet mode.
 * All logic is handled by the BroadcastsManagerScreen component.
 *
 * Layout: Two-column layout with stacked elements
 * - TOP: Hierarchy filter bar
 * - MAIN: Groups grid (full width)
 * - BOTTOM: Analytics collapsed/expandable
 * - DRILL-IN: Control Room (when group selected)
 */

import React from 'react';
import { BroadcastsManagerScreen } from '../ui/screens/BroadcastsManagerScreen';

import { ScopeSelection } from '@/platform/auth/types';

interface LayoutProps {
  scope?: ScopeSelection;
}

export const BroadcastsManagerTabletLayout: React.FC<LayoutProps> = ({ scope }) => {
  return <BroadcastsManagerScreen layout="tablet" scope={scope} />;
};

export default BroadcastsManagerTabletLayout;
