import { useEffect } from 'react';
import { useNavigate } from 'react-router';

/** Intercepts in-app `<a href="/...">` clicks inside `root` so Codex nav/breadcrumb links use React Router. */
export function useSpaLinkNavigation(root: React.RefObject<HTMLElement | null>) {
  const navigate = useNavigate();

  useEffect(() => {
    const element = root.current;
    if (!element) return;

    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest('a[href]');
      if (!anchor || !element.contains(anchor)) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) {
        return;
      }

      if (href.startsWith('/')) {
        event.preventDefault();
        navigate(href);
      }
    };

    element.addEventListener('click', onClick);
    return () => element.removeEventListener('click', onClick);
  }, [navigate, root]);
}
