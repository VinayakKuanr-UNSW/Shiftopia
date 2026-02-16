import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '@/modules/core/lib/logger';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    module?: string;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Global Error Boundary
 * Catches JavaScript errors anywhere in the child component tree
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        const { onError, module = 'unknown' } = this.props;

        // Log the error with structured format
        logger.error('React component error caught', {
            module,
            operation: 'render',
            componentStack: errorInfo.componentStack || 'unavailable',
        }, error);

        // Call optional error handler
        onError?.(error, errorInfo);
    }

    render(): ReactNode {
        if (this.state.hasError) {
            // Custom fallback or default error UI
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="min-h-[200px] flex items-center justify-center p-8">
                    <div className="text-center max-w-md">
                        <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
                            <svg
                                className="h-8 w-8 text-red-500"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                />
                            </svg>
                        </div>
                        <h2 className="text-lg font-semibold text-foreground mb-2">
                            Something went wrong
                        </h2>
                        <p className="text-sm text-muted-foreground mb-4">
                            An unexpected error occurred. Please try refreshing the page.
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 transition-colors"
                        >
                            Refresh Page
                        </button>
                        {process.env.NODE_ENV === 'development' && this.state.error && (
                            <details className="mt-4 text-left">
                                <summary className="cursor-pointer text-xs text-muted-foreground">
                                    Error Details
                                </summary>
                                <pre className="mt-2 p-2 text-xs bg-muted rounded overflow-auto max-h-32">
                                    {this.state.error.message}
                                    {'\n\n'}
                                    {this.state.error.stack}
                                </pre>
                            </details>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
