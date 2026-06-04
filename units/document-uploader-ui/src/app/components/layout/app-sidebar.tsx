import { useState, type CSSProperties, type FC, type ReactNode } from 'react';
import {
  ButtonUtility,
  Input,
  NavAccountCard,
  NavButton,
  NavItemBase,
  NavList,
} from '@opus2-platform/codex';
import { Opus2Logo, Opus2LogoMark } from '../opus2-logo';
import type { NavItemType } from '@opus2-platform/codex';
import { LayoutLeft, LayoutRight, SearchLg } from '@opus2-platform/icons';
import { AppMobileNavigationHeader } from './app-mobile-header';
import { useCommandMenu } from './command-menu-provider';

function CommandMenuTriggerInput({ className }: { className?: string }) {
  const { open } = useCommandMenu();

  return (
    <Input
      size="sm"
      shortcut
      isReadOnly
      aria-label="Open command menu"
      placeholder="Search"
      icon={SearchLg}
      className={className}
      onFocus={(event) => {
        event.target.blur();
        open();
      }}
      onClick={open}
    />
  );
}
const SIDEBAR_COLLAPSED_KEY = 'doc-uploader-sidebar-collapsed';
const EXPANDED_WIDTH = 280;
const COLLAPSED_WIDTH = 68;

type NavItemWithIcon = NavItemType & { icon: FC<{ className?: string }> };

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  });

  const toggle = () => {
    setCollapsed((previous) => {
      const next = !previous;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  return {
    collapsed,
    toggle,
    width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
  };
}

interface AppSidebarProps {
  activeUrl?: string;
  items: NavItemType[];
  footerItems?: NavItemType[];
  featureCard?: ReactNode;
  showAccountCard?: boolean;
}

function SidebarToggle({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <ButtonUtility
      size="sm"
      color="tertiary"
      icon={collapsed ? LayoutRight : LayoutLeft}
      tooltip={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      tooltipPlacement="right"
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      onClick={onToggle}
      className={className}
    />
  );
}

function CollapsedNavItems({
  items,
  activeUrl,
}: {
  items: NavItemWithIcon[];
  activeUrl?: string;
}) {
  return (
    <ul className="flex list-none flex-col gap-0.5 px-2">
      {items.map((item) => (
        <li key={item.label}>
          <NavButton
            current={item.href === activeUrl}
            href={item.href}
            label={item.label}
            icon={item.icon}
            tooltipPlacement="right"
          />
        </li>
      ))}
    </ul>
  );
}

export function AppSidebar({
  activeUrl,
  items,
  footerItems = [],
  featureCard,
  showAccountCard = true,
}: AppSidebarProps) {
  const { collapsed, toggle, width } = useSidebarCollapsed();
  const mainItems = items as NavItemWithIcon[];
  const footerItemsWithIcons = footerItems as NavItemWithIcon[];

  const mobileContent = (
    <aside className="flex h-full w-full max-w-full flex-col justify-between overflow-auto border-secondary bg-primary pt-4 md:border-r">
      <div className="flex flex-col gap-5 px-4 lg:px-5">
        <Opus2Logo className="h-6" />

        <CommandMenuTriggerInput />
      </div>

      <NavList activeUrl={activeUrl} items={items} />

      <div className="mt-auto flex flex-col gap-3 px-4 py-4 lg:py-5">
        {footerItems.length > 0 && (
          <ul className="flex flex-col">
            {footerItems.map((item) => (
              <li key={item.label} className="py-px">
                <NavItemBase
                  badge={item.badge}
                  icon={item.icon}
                  href={item.href}
                  type="link"
                  current={item.href === activeUrl}
                >
                  {item.label}
                </NavItemBase>
              </li>
            ))}
          </ul>
        )}

        {featureCard}

        {showAccountCard && <NavAccountCard />}
      </div>
    </aside>
  );

  const desktopContent = (
    <aside
      style={{ width, '--width': `${width}px` } as CSSProperties}
      className="flex h-full max-w-full flex-col justify-between overflow-x-hidden overflow-y-auto border-r border-secondary bg-primary transition-[width] duration-300 ease-in-out"
    >
      <div className="flex flex-col gap-5 pt-5">
        <div
          className={`flex items-center px-3 ${collapsed ? 'flex-col gap-3' : 'justify-between pl-5 pr-3'}`}
        >
          {collapsed ? (
            <Opus2LogoMark className="size-6" aria-label="Opus 2" />
          ) : (
            <Opus2Logo className="h-6 shrink-0" aria-label="Opus 2" />
          )}
          <SidebarToggle collapsed={collapsed} onToggle={toggle} />
        </div>

        {!collapsed && (
          <div className="px-5">
            <CommandMenuTriggerInput />
          </div>
        )}

        {collapsed ? (
          <CollapsedNavItems items={mainItems} activeUrl={activeUrl} />
        ) : (
          <NavList activeUrl={activeUrl} items={items} className="pt-0" />
        )}
      </div>

      <div
        className={`mt-auto flex flex-col gap-3 py-4 ${collapsed ? 'items-center px-2' : 'px-4 lg:px-5 lg:py-5'}`}
      >
        {collapsed ? (
          <CollapsedNavItems items={footerItemsWithIcons} activeUrl={activeUrl} />
        ) : (
          footerItems.length > 0 && (
            <ul className="flex flex-col">
              {footerItems.map((item) => (
                <li key={item.label} className="py-px">
                  <NavItemBase
                    badge={item.badge}
                    icon={item.icon}
                    href={item.href}
                    type="link"
                    current={item.href === activeUrl}
                  >
                    {item.label}
                  </NavItemBase>
                </li>
              ))}
            </ul>
          )
        )}

        {!collapsed && featureCard}

        {!collapsed && showAccountCard && <NavAccountCard selectedAccountId='gokul' />}
      </div>
    </aside>
  );

  return (
    <>
      <AppMobileNavigationHeader>{mobileContent}</AppMobileNavigationHeader>

      <div
        className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex"
        style={{ width }}
      >
        {desktopContent}
      </div>

      <div
        style={{ width, paddingLeft: width }}
        className="hidden shrink-0 transition-[width,padding] duration-300 ease-in-out lg:block"
        aria-hidden="true"
      />
    </>
  );
}
