
import { BroadcastDbClient } from './db-client';
import { SchemaValidator } from './schema-validator';
import { DataMigrationService } from './data-migration';
import { ErrorHandler } from './error-handler';

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'critical';
  database: {
    connected: boolean;
    latency?: number;
    lastChecked: string;
  };
  schema: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  migration: {
    completed: boolean;
    inProgress: boolean;
    errors: string[];
  };
  errors: {
    total: number;
    critical: number;
    resolved: number;
  };
}

export class SystemMonitor {
  private static lastHealthCheck: SystemHealth | null = null;
  private static healthCheckInterval: number | null = null;

  // Perform comprehensive health check
  static async checkSystemHealth(): Promise<SystemHealth> {
    const startTime = Date.now();
    
    try {
      // Check database connectivity
      const dbConnected = await BroadcastDbClient.testConnection();
      const dbLatency = dbConnected ? Date.now() - startTime : undefined;

      // Validate schema
      const schemaValidation = await SchemaValidator.validateDatabaseSchema();

      // Check migration status
      const migrationStatus = await DataMigrationService.checkMigrationStatus();

      // Get error statistics
      const errorLogs = ErrorHandler.getErrorLogs();
      const criticalErrors = errorLogs.filter(log => log.severity === 'critical').length;
      const resolvedErrors = errorLogs.filter(log => log.resolved).length;

      // Determine overall health
      let overall: 'healthy' | 'degraded' | 'critical' = 'healthy';
      
      if (!dbConnected || criticalErrors > 0 || !schemaValidation.isValid) {
        overall = 'critical';
      } else if (
        schemaValidation.warnings.length > 0 || 
        !migrationStatus.completed ||
        errorLogs.length > 10
      ) {
        overall = 'degraded';
      }

      const health: SystemHealth = {
        overall,
        database: {
          connected: dbConnected,
          latency: dbLatency,
          lastChecked: new Date().toISOString()
        },
        schema: {
          valid: schemaValidation.isValid,
          errors: schemaValidation.errors,
          warnings: schemaValidation.warnings
        },
        migration: {
          completed: migrationStatus.completed,
          inProgress: migrationStatus.inProgress,
          errors: migrationStatus.errors
        },
        errors: {
          total: errorLogs.length,
          critical: criticalErrors,
          resolved: resolvedErrors
        }
      };

      this.lastHealthCheck = health;
      return health;

    } catch (error) {
      ErrorHandler.logError(
        error as Error,
        { component: 'SystemMonitor', action: 'checkSystemHealth' },
        'high'
      );

      return {
        overall: 'critical',
        database: {
          connected: false,
          lastChecked: new Date().toISOString()
        },
        schema: {
          valid: false,
          errors: ['Health check failed'],
          warnings: []
        },
        migration: {
          completed: false,
          inProgress: false,
          errors: ['Unable to check migration status']
        },
        errors: {
          total: 0,
          critical: 1,
          resolved: 0
        }
      };
    }
  }

  // Get cached health status
  static getLastHealthCheck(): SystemHealth | null {
    return this.lastHealthCheck;
  }

  // Start periodic health monitoring
  static startHealthMonitoring(intervalMinutes: number = 5): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = window.setInterval(() => {
      this.checkSystemHealth().then(health => {
        console.log('System health check:', health);
        
        if (health.overall === 'critical') {
          ErrorHandler.logError(
            'System health is critical',
            { component: 'SystemMonitor', action: 'periodicCheck' },
            'critical'
          );
        }
      });
    }, intervalMinutes * 60 * 1000);

    // Run initial check
    this.checkSystemHealth();
  }

  // Stop health monitoring
  static stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}
