import { render, type RenderOptions } from '@testing-library/react';
import { type ReactElement, type ReactNode } from 'react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../auth/AuthProvider';

/**
 * Test render helper: wraps the component under test in the same provider
 * stack the app uses — QueryClientProvider, AuthProvider, and a
 * MemoryRouter (so tests can drive initial route state deterministically
 * without touching the real browser history).
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
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter {...routerProps}>{children}</MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

export { makeQueryClient };
