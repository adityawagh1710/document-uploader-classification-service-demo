import { useEffect, useState, type PropsWithChildren } from 'react';
import { OpusLogo } from '@opus2-platform/codex';
import { Menu02, X as CloseIcon } from '@opus2-platform/icons';

/** Mobile nav header — uses Opus logo (Codex default mobile header shows the Codex design-system logo). */
export function AppMobileNavigationHeader({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-secondary bg-primary p-3 pl-4 lg:hidden">
        <OpusLogo className="h-6" />

        <button
          type="button"
          aria-label={open ? 'Close navigation menu' : 'Expand navigation menu'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="relative flex items-center justify-center rounded-lg bg-primary p-2 text-fg-secondary outline-hidden hover:bg-primary_hover hover:text-fg-secondary_hover focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Menu02 className={`size-6 transition duration-200 ease-in-out ${open ? 'opacity-0' : 'opacity-100'}`} />
          <CloseIcon className={`absolute size-6 transition duration-200 ease-in-out ${open ? 'opacity-100' : 'opacity-0'}`} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 cursor-pointer bg-overlay/70 backdrop-blur-md"
            onClick={() => setOpen(false)}
          />

          <div className="relative h-full w-full max-w-74 bg-primary shadow-xl">
            <button
              type="button"
              aria-label="Close navigation menu"
              onClick={() => setOpen(false)}
              className="absolute top-2.5 right-3 z-10 flex cursor-pointer items-center justify-center rounded-lg p-2 text-fg-secondary outline-hidden hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <CloseIcon className="size-6" />
            </button>

            <div className="h-dvh overflow-auto">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
