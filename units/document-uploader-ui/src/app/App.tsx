import { ThemeProvider } from '@opus2-platform/codex';
import { RouterProvider } from 'react-router';
import { router } from './routes';

export default function App() {
  return (
    <ThemeProvider defaultTheme="light">
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}