
import { supabase } from '@/platform/realtime/client';
import { BroadcastDbClient } from './db-client';
import { MockStorage } from './mock-storage';

export interface MigrationStatus {
  completed: boolean;
  inProgress: boolean;
  errors: string[];
  migratedItems: number;
}

export class DataMigrationService {
  // Check if user has real data or needs migration
  static async checkMigrationStatus(): Promise<MigrationStatus> {
    try {
      const isConnected = await BroadcastDbClient.testConnection();
      
      if (!isConnected) {
        return {
          completed: false,
          inProgress: false,
          errors: ['Database not connected'],
          migratedItems: 0
        };
      }

      // Check if we have any real data
      const groups = await BroadcastDbClient.fetchBroadcastGroups();
      const hasRealData = groups.length > 0;

      return {
        completed: hasRealData,
        inProgress: false,
        errors: [],
        migratedItems: groups.length
      };
    } catch (error) {
      return {
        completed: false,
        inProgress: false,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        migratedItems: 0
      };
    }
  }

  // Migrate mock broadcast groups to real database
  static async migrateBroadcastGroups(): Promise<MigrationStatus> {
    const errors: string[] = [];
    let migratedItems = 0;

    try {
      const mockGroups = MockStorage.getGroups();
      
      for (const group of mockGroups) {
        try {
          await BroadcastDbClient.createBroadcastGroup(group.name);
          migratedItems++;
        } catch (error) {
          errors.push(`Failed to migrate group ${group.name}: ${error}`);
        }
      }

      return {
        completed: errors.length === 0,
        inProgress: false,
        errors,
        migratedItems
      };
    } catch (error) {
      return {
        completed: false,
        inProgress: false,
        errors: [error instanceof Error ? error.message : 'Migration failed'],
        migratedItems
      };
    }
  }

  // Clear mock data after successful migration
  static clearMockData(): void {
    try {
      localStorage.removeItem('mockBroadcastGroups');
      localStorage.removeItem('mockGroupMembers');
      localStorage.removeItem('mockBroadcasts');
      console.log('Mock data cleared successfully');
    } catch (error) {
      console.error('Failed to clear mock data:', error);
    }
  }
}
