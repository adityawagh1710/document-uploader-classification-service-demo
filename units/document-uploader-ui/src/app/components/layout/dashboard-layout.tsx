import { useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { AppToaster } from '../app-toaster';
import { footerNavItems, mainNavItems } from '../../config/navigation';
import { useSpaLinkNavigation } from '../../hooks/use-spa-link-navigation';
import { AppSidebar } from './app-sidebar';
import { CommandMenuProvider } from './command-menu-provider';

export function DashboardLayout() {
  const location = useLocation();
  const layoutRef = useRef<HTMLDivElement>(null);
  const hasFixedFooter =
    location.pathname === '/document-transfer' || location.pathname === '/admin';

  useSpaLinkNavigation(layoutRef);

  return (
    <CommandMenuProvider>
      <div ref={layoutRef} className="flex h-dvh flex-col bg-secondary lg:flex-row">
        <AppSidebar
          activeUrl={location.pathname}
          items={mainNavItems}
          footerItems={footerNavItems}
          showAccountCard
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-secondary">
          <div
            className={
              hasFixedFooter
                ? 'flex min-h-0 flex-1 flex-col overflow-hidden pt-6 lg:pt-8'
                : 'flex-1 overflow-y-auto pt-6 pb-10 lg:pt-8 lg:pb-12'
            }
          >
            <Outlet />
          </div>
        </main>

        <AppToaster />
      </div>
    </CommandMenuProvider>
  );
}
