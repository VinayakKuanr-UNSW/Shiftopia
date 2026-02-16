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

export const MyBroadcastsDesktopLayout: React.FC = () => {
  return <MyBroadcastsScreen layout="desktop" />;
};

export default MyBroadcastsDesktopLayout;
