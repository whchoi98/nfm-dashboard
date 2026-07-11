import {
  Activity,
  ArrowLeftRight,
  Bell,
  Bot,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Network,
  Route,
  Search,
  Settings,
  Stethoscope,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  key: string; // translation key: nav.*
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', key: 'nav.overview', icon: LayoutDashboard },
  { href: '/topology', key: 'nav.topology', icon: Network },
  { href: '/flows', key: 'nav.flows', icon: ArrowLeftRight },
  { href: '/paths', key: 'nav.paths', icon: Route },
  { href: '/insights', key: 'nav.insights', icon: Lightbulb },
  { href: '/workload', key: 'nav.workload', icon: Layers },
  { href: '/monitors', key: 'nav.monitors', icon: Activity },
  { href: '/alerts', key: 'nav.alerts', icon: Bell },
  { href: '/cost', key: 'nav.cost', icon: Wallet },
  { href: '/diagnose', key: 'nav.diagnose', icon: Stethoscope },
  { href: '/agents', key: 'nav.agents', icon: Bot },
  { href: '/search', key: 'nav.search', icon: Search },
  { href: '/settings', key: 'nav.settings', icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
