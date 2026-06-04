import { IconNotification } from '@opus2-platform/codex';
import { toast } from 'sonner';

type ToastColor = 'default' | 'brand' | 'gray' | 'error' | 'warning' | 'success';

interface ShowToastOptions {
  title: string;
  description?: string;
  color?: ToastColor;
  duration?: number;
}

function showToast({
  title,
  description = '',
  color = 'default',
  duration = 4000,
}: ShowToastOptions) {
  return toast.custom(
    (toastId) => (
      <IconNotification
        title={title}
        description={description}
        color={color}
        hideDismissLabel
        onClose={() => toast.dismiss(toastId)}
      />
    ),
    { duration, position: 'top-right' },
  );
}

export const appToast = {
  success: (title: string, description?: string) =>
    showToast({ title, description, color: 'success' }),
  error: (title: string, description?: string) =>
    showToast({ title, description, color: 'error' }),
  info: (title: string, description?: string) =>
    showToast({ title, description, color: 'default' }),
  warning: (title: string, description?: string) =>
    showToast({ title, description, color: 'warning' }),
};
