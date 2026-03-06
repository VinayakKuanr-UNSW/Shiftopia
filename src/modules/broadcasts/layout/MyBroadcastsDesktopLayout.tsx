/**
 * Desktop Layout for My Broadcasts (Employee View)
 *
 * Thin wrapper that renders MyBroadcastsScreen in desktop mode.
 * All logic is handled by the MyBroadcastsScreen component.
 *
 * Layout: Two-column layout
 * - Groups view: Card grid with hierarchy filter
 * - Detail view: Channel sidebar + Message feed
 */

import React from 'react';
import { MyBroadcastsScreen } from '../ui/screens/MyBroadcastsScreen';
import { ScopeSelection } from '@/platform/auth/types';

interface LayoutProps {
  scope: ScopeSelection;
}

export const MyBroadcastsDesktopLayout: React.FC<LayoutProps> = ({ scope }) => {
  return <MyBroadcastsScreen layout="desktop" scope={scope} />;
};


export default MyBroadcastsDesktopLayout;
