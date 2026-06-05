import { Toaster as SonnerToaster } from 'sonner';

export function AppToaster() {
  return (
    <SonnerToaster
      position="top-right"
      style={
        {
          '--width': '400px',
        } as React.CSSProperties
      }
    />
  );
}
