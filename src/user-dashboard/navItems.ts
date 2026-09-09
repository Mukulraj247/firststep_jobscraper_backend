import type { SvgIconComponent } from '@mui/icons-material';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import ExploreOutlined from '@mui/icons-material/ExploreOutlined';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import SendOutlined from '@mui/icons-material/SendOutlined';
import CreditCardOutlined from '@mui/icons-material/CreditCardOutlined';
import AccountCircleOutlined from '@mui/icons-material/AccountCircleOutlined';

export type NavItem = {
  label: string;
  shortLabel?: string;
  path: string;
  icon: SvgIconComponent;
  /** Optional live badge shown in the sidebar (e.g. "2h live"). */
  badgeKey?: 'feed' | 'saved' | 'requests';
};

export type NavSection = {
  heading?: string;
  items: NavItem[];
};

/** Flat Stitch nav — no section headings, matches the HTML prototype. */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Home', path: '/user', icon: HomeOutlined },
      { label: 'Browse Clusters', shortLabel: 'Clusters', path: '/user/clusters', icon: ExploreOutlined },
      { label: 'My Feed', shortLabel: 'Feed', path: '/user/feed', icon: BoltOutlined, badgeKey: 'feed' },
      { label: 'Saved Jobs', shortLabel: 'Saved', path: '/user/saved', icon: BookmarkBorder, badgeKey: 'saved' },
      { label: 'My Requests', shortLabel: 'Requests', path: '/user/requests', icon: SendOutlined, badgeKey: 'requests' },
      { label: 'Subscriptions', shortLabel: 'Plans', path: '/user/subscriptions', icon: CreditCardOutlined },
      { label: 'Profile & Settings', shortLabel: 'Profile', path: '/user/profile', icon: AccountCircleOutlined },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export const BOTTOM_NAV_PATHS = ['/user', '/user/clusters', '/user/feed', '/user/saved', '/user/profile'];

export const BOTTOM_NAV_ITEMS: NavItem[] = BOTTOM_NAV_PATHS.map(
  (path) => ALL_NAV_ITEMS.find((item) => item.path === path)!,
);

export function isNavItemActive(itemPath: string, pathname: string): boolean {
  if (itemPath === '/user') return pathname === '/user' || pathname === '/user/';
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

export function activeNavItem(pathname: string): NavItem | undefined {
  return [...ALL_NAV_ITEMS]
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => isNavItemActive(item.path, pathname));
}
