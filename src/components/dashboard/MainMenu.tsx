import React from 'react';
import { SidebarContent, type SidebarContentProps } from './SidebarContent';

export { SIDEBAR_WIDTH_COLLAPSED, SIDEBAR_WIDTH_EXPANDED } from './appShellBehavior';

export const MainMenu = (props: SidebarContentProps) => <SidebarContent {...props} />;
