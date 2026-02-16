import { toast } from 'sonner';

export interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  timestamp: string;
  userAgent: string;
  url: string;
}

export interface ErrorLog {
  id: string;
  error: Error | string;
  context: ErrorContext;
  severity: 'low' | 'medium' | 'high' | 'critical';
  resolved: boolean;
}

export class ErrorHandler {
  private static errorLogs: ErrorLog[] = [];
  private static maxLogs = 100;

  // Log error with context
  static logError(
    error: Error | string, 
    context: Partial<ErrorContext> = {},
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): string {
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const fullContext: ErrorContext = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      ...context
    };

    const errorLog: ErrorLog = {
      id: errorId,
      error,
      context: fullContext,
      severity,
      resolved: false
    };

    this.errorLogs.unshift(errorLog);
    
    // Keep only the most recent logs
    if (this.errorLogs.length > this.maxLogs) {
      this.errorLogs = this.errorLogs.slice(0, this.maxLogs);
    }

    // Log to console for debugging
    console.error(`[${severity.toUpperCase()}] ${errorId}:`, error, fullContext);

    // Show user-friendly message for high/critical errors
    if (severity === 'high' || severity === 'critical') {
      this.showUserNotification(error, severity);
    }

    return errorId;
  }

  // Show user-friendly error notification
  private static showUserNotification(error: Error | string, severity: string): void {
    const message = this.getDisplayMessage(error);
    
    if (severity === 'critical') {
      toast.error('Critical Error', {
        description: message + ' Please refresh the page or contact support.',
        duration: 10000
      });
    } else {
      toast.error('Something went wrong', {
        description: message,
        duration: 5000
      });
    }
  }

  // Convert technical errors to user-friendly messages
  private static getDisplayMessage(error: Error | string): string {
    const errorMessage = error instanceof Error ? error.message : error;
    
    // Common error patterns and their user-friendly alternatives
    const errorMappings: Record<string, string> = {
      'network': 'Connection issue. Please check your internet connection.',
      'timeout': 'Request timed out. Please try again.',
      'unauthorized': 'You need to log in to perform this action.',
      'forbidden': 'You don\'t have permission to perform this action.',
      'not found': 'The requested resource was not found.',
      'validation': 'Please check your input and try again.',
      'database': 'Database error. Please try again later.'
    };

    for (const [key, message] of Object.entries(errorMappings)) {
      if (errorMessage.toLowerCase().includes(key)) {
        return message;
      }
    }

    return 'An unexpected error occurred. Please try again.';
  }

  // Get error logs for debugging
  static getErrorLogs(): ErrorLog[] {
    return [...this.errorLogs];
  }

  // Clear resolved errors
  static clearResolvedErrors(): void {
    this.errorLogs = this.errorLogs.filter(log => !log.resolved);
  }

  // Mark error as resolved
  static markErrorResolved(errorId: string): void {
    const errorLog = this.errorLogs.find(log => log.id === errorId);
    if (errorLog) {
      errorLog.resolved = true;
    }
  }

  // Async error boundary wrapper
  static async withErrorHandling<T>(
    operation: () => Promise<T>,
    context: Partial<ErrorContext> = {},
    fallbackValue?: T
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      this.logError(error as Error, context, 'high');
      return fallbackValue;
    }
  }
}

// Global error handler for unhandled promises
window.addEventListener('unhandledrejection', (event) => {
  ErrorHandler.logError(
    event.reason,
    { component: 'Global', action: 'unhandledRejection' },
    'high'
  );
});

// Global error handler for JavaScript errors
window.addEventListener('error', (event) => {
  ErrorHandler.logError(
    event.error || event.message,
    { component: 'Global', action: 'globalError' },
    'high'
  );
});
