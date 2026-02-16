
// Simple in-memory storage for mock data to persist across components
export class MockStorage {
  private static groups: any[] = [
    { id: '1', name: 'General Announcements', created_at: new Date().toISOString() },
    { id: '2', name: 'Team Updates', created_at: new Date().toISOString() }
  ];

  private static members: any[] = [
    {
      id: '1',
      group_id: '1',
      user_id: '1',
      is_admin: true,
      user: {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        role: 'admin',
        department: 'IT'
      }
    },
    {
      id: '2',
      group_id: '1',
      user_id: '2',
      is_admin: false,
      user: {
        id: '2',
        name: 'Jane Smith',
        email: 'jane@example.com',
        role: 'member',
        department: 'HR'
      }
    },
    {
      id: '3',
      group_id: '2',
      user_id: '1',
      is_admin: true,
      user: {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        role: 'admin',
        department: 'IT'
      }
    }
  ];

  private static broadcasts: any[] = [
    {
      id: '1',
      group_id: '1',
      sender_id: '1',
      message: 'Welcome to the broadcast system! This is a test message.',
      created_at: new Date().toISOString(),
      sender: { id: '1', name: 'John Doe' },
      group: { id: '1', name: 'General Announcements' }
    }
  ];

  // Groups
  static getGroups() {
    return [...this.groups];
  }

  static addGroup(group: any) {
    this.groups.push(group);
    return [group];
  }

  static updateGroup(id: string, name: string) {
    const index = this.groups.findIndex(g => g.id === id);
    if (index !== -1) {
      this.groups[index].name = name;
    }
  }

  static deleteGroup(id: string) {
    this.groups = this.groups.filter(g => g.id !== id);
    this.members = this.members.filter(m => m.group_id !== id);
    this.broadcasts = this.broadcasts.filter(b => b.group_id !== id);
  }

  // Members
  static getGroupMembers(groupId: string) {
    return this.members.filter(m => m.group_id === groupId);
  }

  static addMember(member: any) {
    this.members.push(member);
  }

  static removeMember(memberId: string) {
    this.members = this.members.filter(m => m.id !== memberId);
  }

  static updateMemberAdminStatus(memberId: string, isAdmin: boolean) {
    const index = this.members.findIndex(m => m.id === memberId);
    if (index !== -1) {
      this.members[index].is_admin = isAdmin;
    }
  }

  // User groups
  static getUserGroups(userId: string) {
    const userMemberships = this.members.filter(m => m.user_id === userId);
    return userMemberships.map(membership => {
      const group = this.groups.find(g => g.id === membership.group_id);
      return group ? {
        id: group.id,
        name: group.name,
        is_admin: membership.is_admin
      } : null;
    }).filter(Boolean);
  }

  // Broadcasts
  static addBroadcast(broadcast: any) {
    this.broadcasts.push(broadcast);
    return broadcast;
  }

  static getGroupBroadcasts(groupId: string) {
    return this.broadcasts
      .filter(b => b.group_id === groupId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
}
