import { Component, type ReactNode } from 'react';

/**
 * GlobeErrorBoundary — wraps the react-globe.gl `<Globe>` so a render-phase
 * three.js/WebGL failure does NOT blank the page (architecture §16.2 /
 * VAL-GLOBE-022).
 *
 * On error it renders the `data-testid="globe-webgl-unavailable"` fallback.
 * The surrounding DOM mirror layer (filters, `globe-events-count`,
 * `globe-event-point` mirrors) lives OUTSIDE this boundary in the page
 * shell, so it keeps rendering even when the canvas cannot (VAL-GLOBE-023).
 */
interface GlobeErrorBoundaryProps {
  children: ReactNode;
  /** Optional override for the fallback label. */
  fallbackLabel?: string;
}

interface GlobeErrorBoundaryState {
  hasError: boolean;
}

export class GlobeErrorBoundary extends Component<
  GlobeErrorBoundaryProps,
  GlobeErrorBoundaryState
> {
  state: GlobeErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): GlobeErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Swallow the WebGL/three.js error — the fallback renders instead.
    // Intentionally not rethrowing; the boundary's whole purpose is to keep
    // the page usable/testable when the canvas cannot initialize.
    console.warn('GlobeErrorBoundary caught a render error:', error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          data-testid="globe-webgl-unavailable"
          role="status"
          className="flex h-full w-full items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-6 text-center dark:border-gray-700 dark:bg-gray-800"
        >
          <div>
            <div className="mb-2 text-3xl">🌐</div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {this.props.fallbackLabel ??
                '3D globe is unavailable in this browser (WebGL is disabled or unsupported).'}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Filters and the event list below still work.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
