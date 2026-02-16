
export interface BroadcastGroup {
  id: string;
  name: string;
  created_at?: string;
  is_admin?: boolean;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  is_admin: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
    department: string;
  }
}

export interface Broadcast {
  id: string;
  group_id: string;
  sender_id: string;
  message: string;
  created_at: string;
  sender?: {
    id: string;
    name: string;
  };
  group?: {
    id: string;
    name: string;
  };
}

export interface Notification {
  id: string;
  user_id: string;
  broadcast_id: string;
  read: boolean;
  created_at: string;
  broadcast?: Broadcast;
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
}
