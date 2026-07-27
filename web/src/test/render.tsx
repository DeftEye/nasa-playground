import { render, type RenderOptions } from '@testing-library/react';
import { type ReactElement, type ReactNode } from 'react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../auth/AuthProvider';
import { ThemeProvider } from '../theme/ThemeProvider';

/**
 * Test render helper: wraps the component under test in the same provider
 * stack the app uses — ThemeProvider (outermost, mirroring `main.tsx`),
 * QueryClientProvider, AuthProvider, and a MemoryRouter (so tests can drive
 * initial route state deterministically without touching the real browser
 * history).
 *
 * `ThemeProvider` is included so any component that calls `useTheme()`
 * (e.g. `ThemeToggle`) works in tests without each test re-wrapping the
 * tree. Mirroring the production provider order also keeps tests honest
 * about the real provider nesting.
 */

export interface RenderWithProvidersOptions extends RenderOptions {
  routerProps?: Omit<MemoryRouterProps, 'children'>;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  { routerProps, ...renderOptions }: RenderWithProvidersOptions = {},
) {
  const queryClient = makeQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <MemoryRouter {...routerProps}>{children}</MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

export { makeQueryClient };
