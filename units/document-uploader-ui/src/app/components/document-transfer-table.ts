/** Shared column sizing for upload file rows and processing document tables. */
export const documentTransferTableColumns = {
  status: 'min-w-28 w-28',
  document: 'min-w-0 flex-1',
  size: 'min-w-24 w-24 shrink-0 whitespace-nowrap text-right tabular-nums',
} as const;

export const documentTransferFileGridClass =
  'grid grid-cols-[minmax(0,1fr)_7rem_6rem_2rem] items-center gap-x-4';
