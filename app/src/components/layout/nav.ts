import {
  Activity,
  ArrowLeftRight,
  Bell,
  Bot,
  FileText,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Network,
  Route,
  Search,
  Settings,
  Stethoscope,
  TriangleAlert,
  Wallet,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  key: string; // translation key: nav.*
  icon: LucideIcon;
}

export interface NavGroup {
  key: string;
  labelKey: string; // translation key: nav.group.*
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    labelKey: 'nav.group.overview',
    items: [{ href: '/', key: 'nav.overview', icon: LayoutDashboard }],
  },
  {
    key: 'network',
    labelKey: 'nav.group.network',
    items: [
      { href: '/topology', key: 'nav.topology', icon: Network },
      { href: '/network', key: 'nav.network', icon: Waypoints },
      { href: '/flows', key: 'nav.flows', icon: ArrowLeftRight },
      { href: '/paths', key: 'nav.paths', icon: Route },
    ],
  },
  {
    key: 'analysis',
    labelKey: 'nav.group.analysis',
    items: [
      { href: '/insights', key: 'nav.insights', icon: Lightbulb },
      { href: '/workload', key: 'nav.workload', icon: Layers },
      { href: '/monitors', key: 'nav.monitors', icon: Activity },
    ],
  },
  {
    key: 'ops',
    labelKey: 'nav.group.ops',
    items: [
      { href: '/alerts', key: 'nav.alerts', icon: Bell },
      { href: '/anomalies', key: 'nav.anomalies', icon: TriangleAlert },
      { href: '/diagnose', key: 'nav.diagnose', icon: Stethoscope },
      { href: '/agents', key: 'nav.agents', icon: Bot },
    ],
  },
  {
    key: 'business',
    labelKey: 'nav.group.business',
    items: [
      { href: '/cost', key: 'nav.cost', icon: Wallet },
      { href: '/reports', key: 'nav.reports', icon: FileText },
    ],
  },
  {
    key: 'tools',
    labelKey: 'nav.group.tools',
    items: [
      { href: '/search', key: 'nav.search', icon: Search },
      { href: '/settings', key: 'nav.settings', icon: Settings },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
