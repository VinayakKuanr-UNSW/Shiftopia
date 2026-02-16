
import { supabase } from '@/platform/realtime/client';
import { BroadcastDbClient } from './db-client';
import { ErrorHandler } from './error-handler';
import { SchemaValidator } from './schema-validator';
import type { BroadcastGroup, GroupMember, Broadcast, Employee } from '@/types/broadcast';
import { MockStorage } from './mock-storage';

export class EnhancedBroadcastDbClient extends BroadcastDbClient {
  // Enhanced method with validation and error handling - uses mock data since tables don't exist
  static async fetchBroadcastGroupsEnhanced(): Promise<BroadcastGroup[]> {
    return ErrorHandler.withErrorHandling(
      async () => {
        const isConnected = await this.testConnection();
        if (!isConnected) {
          console.warn('Database connection failed, using mock data');
          return MockStorage.getGroups() as BroadcastGroup[];
        }

        // Since broadcast tables don't exist, use mock data with validation
        console.warn('Broadcast tables not available in database, using mock data with enhanced validation');
        const mockGroups = MockStorage.getGroups() as BroadcastGroup[];

        // Validate data structure
        const validation = SchemaValidator.validateRosterData({ groups: mockGroups });
        if (!validation.isValid) {
          ErrorHandler.logError(
            `Data validation failed: ${validation.errors.join(', ')}`,
            { component: 'EnhancedBroadcastDbClient', action: 'fetchGroups' },
            'medium'
          );
        }

        return mockGroups;
      },
      { component: 'EnhancedBroadcastDbClient', action: 'fetchBroadcastGroups' },
      [] // fallback value
    ) || [];
  }

  // Enhanced group creation with validation - uses mock data since tables don't exist
  static async createBroadcastGroupEnhanced(name: string): Promise<BroadcastGroup[]> {
    if (!name || name.trim().length === 0) {
      throw new Error('Group name is required');
    }

    if (name.length > 100) {
      throw new Error('Group name is too long (max 100 characters)');
    }

    return ErrorHandler.withErrorHandling(
      async () => {
        const isConnected = await this.testConnection();
        if (!isConnected) {
          console.warn('Database connection failed, using mock data');
          const newGroup = { id: Date.now().toString(), name: name.trim(), created_at: new Date().toISOString() };
          return MockStorage.addGroup(newGroup) as BroadcastGroup[];
        }

        // Since broadcast tables don't exist, use enhanced mock data creation
        console.warn('Broadcast tables not available in database, using enhanced mock creation');
        
        // Check for duplicate names in mock data
        const existing = MockStorage.getGroups().find(g => 
          g.name.toLowerCase() === name.trim().toLowerCase()
        );

        if (existing) {
          throw new Error('A group with this name already exists');
        }

        const newGroup = { 
          id: Date.now().toString(), 
          name: name.trim(), 
          created_at: new Date().toISOString() 
        };
        
        return MockStorage.addGroup(newGroup) as BroadcastGroup[];
      },
      { component: 'EnhancedBroadcastDbClient', action: 'createBroadcastGroup' }
    ) || [];
  }

  // Enhanced broadcast creation with better error handling - uses mock data since tables don't exist
  static async createBroadcastEnhanced(
    groupId: string, 
    senderId: string, 
    message: string
  ): Promise<Broadcast | null> {
    // Validation
    if (!groupId || !senderId || !message) {
      throw new Error('Group ID, sender ID, and message are required');
    }

    if (message.length > 5000) {
      throw new Error('Message is too long (max 5000 characters)');
    }

    return ErrorHandler.withErrorHandling(
      async () => {
        const isConnected = await this.testConnection();
        if (!isConnected) {
          console.warn('Database connection failed, using mock data');
          const newBroadcast = {
            id: Date.now().toString(),
            group_id: groupId,
            sender_id: senderId,
            message: message.trim(),
            created_at: new Date().toISOString(),
            sender: { id: senderId, name: 'Demo User' },
            group: { id: groupId, name: 'Demo Group' }
          };
          return MockStorage.addBroadcast(newBroadcast) as Broadcast;
        }

        // Since broadcast tables don't exist, use enhanced mock creation
        console.warn('Broadcast tables not available in database, using enhanced mock creation');

        // Verify group exists in mock data
        const groups = MockStorage.getGroups();
        const groupExists = groups.find(g => g.id === groupId);

        if (!groupExists) {
          throw new Error('Group not found');
        }

        // Create broadcast in mock storage
        const newBroadcast = {
          id: Date.now().toString(),
          group_id: groupId,
          sender_id: senderId,
          message: message.trim(),
          created_at: new Date().toISOString(),
          sender: { id: senderId, name: 'Demo User' },
          group: { id: groupId, name: groupExists.name }
        };

        return MockStorage.addBroadcast(newBroadcast) as Broadcast;
      },
      { 
        component: 'EnhancedBroadcastDbClient', 
        action: 'createBroadcast',
        userId: senderId 
      },
      null
    );
  }

  // Enhanced user fetching with caching - tries real database first
  static async fetchUsersEnhanced(): Promise<Employee[]> {
    return ErrorHandler.withErrorHandling(
      async () => {
        const isConnected = await this.testConnection();
        if (!isConnected) {
          // Return fallback users when database is not available
          console.warn('Database connection failed, using fallback users');
          return [
            { id: '1', name: 'Demo User', email: 'demo@example.com', role: 'admin', department: 'IT' },
            { id: '2', name: 'Test User', email: 'test@example.com', role: 'member', department: 'HR' }
          ];
        }

        // Try to fetch from employees table (which exists in the schema)
        const { data, error } = await supabase
          .from('employees')
          .select('id, first_name, last_name, email, status')
          .order('first_name');
        
        if (error) {
          console.error('Error fetching employees:', error);
          // Fall back to mock users
          return [
            { id: '1', name: 'Demo User', email: 'demo@example.com', role: 'admin', department: 'IT' },
            { id: '2', name: 'Test User', email: 'test@example.com', role: 'member', department: 'HR' }
          ];
        }
        
        // Validate users data
        if (!data || !Array.isArray(data)) {
          throw new Error('Invalid users data received');
        }

        // Map employees data to the Employee interface expected by broadcast functionality
        const mappedEmployees = data.map(emp => ({
          id: emp.id,
          name: `${emp.first_name} ${emp.last_name}`,
          email: emp.email,
          role: emp.status || 'member',
          department: 'General' // Since department info is in separate tables
        }));

        return mappedEmployees as Employee[];
      },
      { component: 'EnhancedBroadcastDbClient', action: 'fetchUsers' },
      [] // fallback value
    ) || [];
  }
}
