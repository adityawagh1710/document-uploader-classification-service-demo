import type { ReactNode } from 'react';
import { Breadcrumbs } from '@opus2-platform/codex';
import { HomeLine } from '@opus2-platform/icons';
import type { BreadcrumbConfig } from '../../config/navigation';

export const dashboardContentWidthClassName = 'mx-auto w-full max-w-7xl';

interface PageFrameProps {
  title: string;
  /** Badge rendered inline next to the page title. */
  titleBadge?: ReactNode;
  description?: string;
  breadcrumbs?: BreadcrumbConfig[];
  actions?: ReactNode;
  /** Optional tabs rendered below the title, inside the header padding. */
  tabs?: ReactNode;
  children: ReactNode;
  /** Skip default horizontal padding on the content region (e.g. full-bleed wizards). */
  flush?: boolean;
}

export function PageFrame({
  title,
  titleBadge,
  description,
  breadcrumbs,
  actions,
  tabs,
  children,
  flush = false,
}: PageFrameProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="px-6 lg:px-10">
        <div className={`flex flex-col gap-4 ${dashboardContentWidthClassName}`}>
          {breadcrumbs && breadcrumbs.length > 0 && (
            <Breadcrumbs>
              {breadcrumbs.map((crumb, index) =>
                index === 0 ? (
                  <Breadcrumbs.Item
                    key="home"
                    href={crumb.href || undefined}
                    icon={HomeLine}
                    isCurrent={breadcrumbs.length === 1}
                  />
                ) : (
                  <Breadcrumbs.Item
                    key={`${crumb.label}-${index}`}
                    href={crumb.href || undefined}
                    isCurrent={index === breadcrumbs.length - 1}
                  >
                    {crumb.label}
                  </Breadcrumbs.Item>
                )
              )}
            </Breadcrumbs>
          )}

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-semibold text-primary">{title}</h1>
                {titleBadge}
              </div>
              {description && <p className="text-sm text-tertiary">{description}</p>}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
          </div>

          {tabs && (
            <div className="scrollbar-hide flex overflow-auto">
              {tabs}
            </div>
          )}
        </div>
      </div>

      <div className={flush ? undefined : 'px-6 lg:px-10'}>
        <div className={flush ? undefined : dashboardContentWidthClassName}>{children}</div>
      </div>
    </div>
  );
}
