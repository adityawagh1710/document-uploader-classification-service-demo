import type { ComponentProps } from 'react';
import { TableCard } from '@opus2-platform/codex';

export function AppTableCard({
  className,
  ...props
}: ComponentProps<typeof TableCard.Root>) {
  return <TableCard.Root {...props} className={className ? `app-table ${className}` : 'app-table'} />;
}
