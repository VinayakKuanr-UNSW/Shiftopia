export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      attendance_records: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          created_at: string | null
          employee_id: string
          id: string
          minutes_late: number | null
          notes: string | null
          scheduled_end: string
          scheduled_start: string
          shift_id: string
          status: string
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          created_at?: string | null
          employee_id: string
          id?: string
          minutes_late?: number | null
          notes?: string | null
          scheduled_end: string
          scheduled_start: string
          shift_id: string
          status?: string
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          created_at?: string | null
          employee_id?: string
          id?: string
          minutes_late?: number | null
          notes?: string | null
          scheduled_end?: string
          scheduled_start?: string
          shift_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          changed_at: string | null
          changed_by_user_id: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          new_data: Json | null
          new_values: Json | null
          old_data: Json | null
          old_values: Json | null
          record_id: string | null
          table_name: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          changed_at?: string | null
          changed_by_user_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          new_values?: Json | null
          old_data?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          changed_at?: string | null
          changed_by_user_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          new_values?: Json | null
          old_data?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
        ]
      }
      availabilities: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          availability_type: Database["public"]["Enums"]["availability_type"]
          created_at: string | null
          end_date: string
          end_time: string | null
          id: string
          is_approved: boolean | null
          is_recurring: boolean | null
          profile_id: string
          reason: string | null
          recurrence_rule: string | null
          start_date: string
          start_time: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          availability_type?: Database["public"]["Enums"]["availability_type"]
          created_at?: string | null
          end_date: string
          end_time?: string | null
          id?: string
          is_approved?: boolean | null
          is_recurring?: boolean | null
          profile_id: string
          reason?: string | null
          recurrence_rule?: string | null
          start_date: string
          start_time?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          availability_type?: Database["public"]["Enums"]["availability_type"]
          created_at?: string | null
          end_date?: string
          end_time?: string | null
          id?: string
          is_approved?: boolean | null
          is_recurring?: boolean | null
          profile_id?: string
          reason?: string | null
          recurrence_rule?: string | null
          start_date?: string
          start_time?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availabilities_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availabilities_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availabilities_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availabilities_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          created_at: string
          end_time: string
          id: string
          profile_id: string
          repeat_days: number[] | null
          repeat_end_date: string | null
          repeat_type: string
          start_date: string
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          profile_id: string
          repeat_days?: number[] | null
          repeat_end_date?: string | null
          repeat_type: string
          start_date: string
          start_time: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          profile_id?: string
          repeat_days?: number[] | null
          repeat_end_date?: string | null
          repeat_type?: string
          start_date?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      availability_slots: {
        Row: {
          created_at: string
          end_time: string
          id: string
          profile_id: string
          rule_id: string
          slot_date: string
          start_time: string
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          profile_id: string
          rule_id: string
          slot_date: string
          start_time: string
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          profile_id?: string
          rule_id?: string
          slot_date?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_slots_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_slots_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "availability_rules"
            referencedColumns: ["id"]
          }
        ]
      }
      bid_allocation_log: {
        Row: {
          algorithm_version: string | null
          allocated_to_employee_id: string
          allocation_algorithm: string | null
          allocation_date: string | null
          id: string
          shift_id: string
          total_bids_received: number | null
        }
        Insert: {
          algorithm_version?: string | null
          allocated_to_employee_id: string
          allocation_algorithm?: string | null
          allocation_date?: string | null
          id?: string
          shift_id: string
          total_bids_received?: number | null
        }
        Update: {
          algorithm_version?: string | null
          allocated_to_employee_id?: string
          allocation_algorithm?: string | null
          allocation_date?: string | null
          id?: string
          shift_id?: string
          total_bids_received?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bid_allocation_log_allocated_to_employee_id_fkey"
            columns: ["allocated_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_allocation_log_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_eligibility_checks: {
        Row: {
          availability_check: boolean | null
          bid_id: string
          checked_at: string | null
          eligibility_errors: Json | null
          employee_id: string
          hours_limit_check: boolean | null
          id: string
          is_eligible: boolean | null
          rest_period_check: boolean | null
          shift_id: string
          skills_check: boolean | null
        }
        Insert: {
          availability_check?: boolean | null
          bid_id: string
          checked_at?: string | null
          eligibility_errors?: Json | null
          employee_id: string
          hours_limit_check?: boolean | null
          id?: string
          is_eligible?: boolean | null
          rest_period_check?: boolean | null
          shift_id: string
          skills_check?: boolean | null
        }
        Update: {
          availability_check?: boolean | null
          bid_id?: string
          checked_at?: string | null
          eligibility_errors?: Json | null
          employee_id?: string
          hours_limit_check?: boolean | null
          id?: string
          is_eligible?: boolean | null
          rest_period_check?: boolean | null
          shift_id?: string
          skills_check?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "bid_eligibility_checks_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "shift_bids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_eligibility_checks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_eligibility_checks_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_acknowledgements: {
        Row: {
          acknowledged_at: string | null
          broadcast_id: string
          employee_id: string
          id: string
        }
        Insert: {
          acknowledged_at?: string | null
          broadcast_id: string
          employee_id: string
          id?: string
        }
        Update: {
          acknowledged_at?: string | null
          broadcast_id?: string
          employee_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_acknowledgements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_attachments: {
        Row: {
          broadcast_id: string
          created_at: string | null
          file_name: string
          file_size: number | null
          file_type: string
          file_url: string
          id: string
          storage_path: string | null
        }
        Insert: {
          broadcast_id: string
          created_at?: string | null
          file_name: string
          file_size?: number | null
          file_type: string
          file_url: string
          id?: string
          storage_path?: string | null
        }
        Update: {
          broadcast_id?: string
          created_at?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string
          file_url?: string
          id?: string
          storage_path?: string | null
        }
        Relationships: []
      }
      broadcast_channels: {
        Row: {
          created_at: string | null
          description: string | null
          group_id: string
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          group_id: string
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          group_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "broadcast_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_broadcast_groups_with_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_unread_broadcasts_by_group"
            referencedColumns: ["group_id"]
          },
        ]
      }
      broadcast_group_members: {
        Row: {
          employee_id: string
          group_id: string
          id: string
          is_admin: boolean | null
          joined_at: string | null
        }
        Insert: {
          employee_id: string
          group_id: string
          id?: string
          is_admin?: boolean | null
          joined_at?: string | null
        }
        Update: {
          employee_id?: string
          group_id?: string
          id?: string
          is_admin?: boolean | null
          joined_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_group_members_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "broadcast_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_broadcast_groups_with_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_unread_broadcasts_by_group"
            referencedColumns: ["group_id"]
          },
        ]
      }
      broadcast_groups: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string
          department_id: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by: string
          department_id?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string
          department_id?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_groups_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_groups_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_department_stats"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "broadcast_groups_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["department_id"]
          },
        ]
      }
      broadcast_notifications: {
        Row: {
          broadcast_id: string
          created_at: string | null
          employee_id: string
          id: string
          is_read: boolean | null
          read_at: string | null
        }
        Insert: {
          broadcast_id: string
          created_at?: string | null
          employee_id: string
          id?: string
          is_read?: boolean | null
          read_at?: string | null
        }
        Update: {
          broadcast_id?: string
          created_at?: string | null
          employee_id?: string
          id?: string
          is_read?: boolean | null
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_read_status: {
        Row: {
          broadcast_id: string
          employee_id: string
          id: string
          read_at: string | null
        }
        Insert: {
          broadcast_id: string
          employee_id: string
          id?: string
          read_at?: string | null
        }
        Update: {
          broadcast_id?: string
          employee_id?: string
          id?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_read_status_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_recipients: {
        Row: {
          acknowledged_at: string | null
          broadcast_id: string
          delivered_at: string | null
          id: string
          profile_id: string
          read_at: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          broadcast_id: string
          delivered_at?: string | null
          id?: string
          profile_id: string
          read_at?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          broadcast_id?: string
          delivered_at?: string | null
          id?: string
          profile_id?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          archived_by: string | null
          author_id: string | null
          channel_id: string | null
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          is_archived: boolean | null
          is_pinned: boolean | null
          organization_id: string | null
          priority: string | null
          requires_acknowledgement: boolean | null
          subject: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          archived_by?: string | null
          author_id?: string | null
          channel_id?: string | null
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_archived?: boolean | null
          is_pinned?: boolean | null
          organization_id?: string | null
          priority?: string | null
          requires_acknowledgement?: boolean | null
          subject?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          archived_by?: string | null
          author_id?: string | null
          channel_id?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_archived?: boolean | null
          is_pinned?: boolean | null
          organization_id?: string | null
          priority?: string | null
          requires_acknowledgement?: boolean | null
          subject?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcasts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "broadcast_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "v_channels_with_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_history: {
        Row: {
          cancelled_at: string | null
          created_at: string | null
          employee_id: string
          id: string
          notice_period_hours: number | null
          penalty_applied: number | null
          reason: string | null
          shift_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string | null
          employee_id: string
          id?: string
          notice_period_hours?: number | null
          penalty_applied?: number | null
          reason?: string | null
          shift_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string | null
          employee_id?: string
          id?: string
          notice_period_hours?: number | null
          penalty_applied?: number | null
          reason?: string | null
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_history_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          issuing_body: string | null
          name: string
          organization_id: string | null
          requires_expiration: boolean | null
          updated_at: string | null
          validity_period_months: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          issuing_body?: string | null
          name: string
          organization_id?: string | null
          requires_expiration?: boolean | null
          updated_at?: string | null
          validity_period_months?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          issuing_body?: string | null
          name?: string
          organization_id?: string | null
          requires_expiration?: boolean | null
          updated_at?: string | null
          validity_period_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "certifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      daily_hours_summary: {
        Row: {
          actual_worked_hours: number | null
          created_at: string | null
          date: string
          employee_id: string
          exceeds_daily_limit: boolean | null
          id: string
          total_scheduled_hours: number | null
          updated_at: string | null
        }
        Insert: {
          actual_worked_hours?: number | null
          created_at?: string | null
          date: string
          employee_id: string
          exceeds_daily_limit?: boolean | null
          id?: string
          total_scheduled_hours?: number | null
          updated_at?: string | null
        }
        Update: {
          actual_worked_hours?: number | null
          created_at?: string | null
          date?: string
          employee_id?: string
          exceeds_daily_limit?: boolean | null
          id?: string
          total_scheduled_hours?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_hours_summary_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string | null
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      employee_assignments: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"] | null
          created_at: string | null
          department_id: string
          end_date: string | null
          fte_percentage: number | null
          id: string
          is_primary: boolean | null
          notes: string | null
          organization_id: string
          profile_id: string
          remuneration_level_id: string | null
          role_id: string | null
          role_level_id: string | null
          start_date: string | null
          sub_department_id: string | null
          updated_at: string | null
        }
        Insert: {
          access_level?: Database["public"]["Enums"]["access_level"] | null
          created_at?: string | null
          department_id: string
          end_date?: string | null
          fte_percentage?: number | null
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          organization_id: string
          profile_id: string
          remuneration_level_id?: string | null
          role_id?: string | null
          role_level_id?: string | null
          start_date?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Update: {
          access_level?: Database["public"]["Enums"]["access_level"] | null
          created_at?: string | null
          department_id?: string
          end_date?: string | null
          fte_percentage?: number | null
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          organization_id?: string
          profile_id?: string
          remuneration_level_id?: string | null
          role_id?: string | null
          role_level_id?: string | null
          start_date?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_department_stats"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "employee_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "employee_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "employee_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_assignments_remuneration_level_id_fkey"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["role_id"]
          },
          {
            foreignKeyName: "employee_assignments_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_assignments_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["sub_department_id"]
          },
        ]
      }
      employee_certifications: {
        Row: {
          certification_id: string
          created_at: string | null
          employee_id: string
          expiration_date: string | null
          id: string
          issue_date: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          certification_id: string
          created_at?: string | null
          employee_id: string
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          certification_id?: string
          created_at?: string | null
          employee_id?: string
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_certifications_certification_id_fkey"
            columns: ["certification_id"]
            isOneToOne: false
            referencedRelation: "certifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_certifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_licenses: {
        Row: {
          created_at: string | null
          employee_id: string
          expiration_date: string | null
          id: string
          issue_date: string | null
          license_id: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          license_id: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          license_id?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_licenses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_licenses_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_reliability_metrics: {
        Row: {
          cancellation_rate: number | null
          created_at: string | null
          employee_id: string
          id: string
          last_updated_at: string | null
          on_time_percentage: number | null
          swap_completion_rate: number | null
          total_cancellations: number | null
          total_late_arrivals: number | null
          total_no_shows: number | null
          total_shifts_assigned: number | null
          total_shifts_completed: number | null
          total_swaps_accepted: number | null
          total_swaps_completed: number | null
        }
        Insert: {
          cancellation_rate?: number | null
          created_at?: string | null
          employee_id: string
          id?: string
          last_updated_at?: string | null
          on_time_percentage?: number | null
          swap_completion_rate?: number | null
          total_cancellations?: number | null
          total_late_arrivals?: number | null
          total_no_shows?: number | null
          total_shifts_assigned?: number | null
          total_shifts_completed?: number | null
          total_swaps_accepted?: number | null
          total_swaps_completed?: number | null
        }
        Update: {
          cancellation_rate?: number | null
          created_at?: string | null
          employee_id?: string
          id?: string
          last_updated_at?: string | null
          on_time_percentage?: number | null
          swap_completion_rate?: number | null
          total_cancellations?: number | null
          total_late_arrivals?: number | null
          total_no_shows?: number | null
          total_shifts_assigned?: number | null
          total_shifts_completed?: number | null
          total_swaps_accepted?: number | null
          total_swaps_completed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_reliability_metrics_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_skills: {
        Row: {
          created_at: string | null
          employee_id: string | null
          id: string
          proficiency_level: number | null
          skill_id: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id?: string | null
          id?: string
          proficiency_level?: number | null
          skill_id?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string | null
          id?: string
          proficiency_level?: number | null
          skill_id?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_suitability_scores: {
        Row: {
          attendance_score: number | null
          availability_adherence: number | null
          cancellation_penalty: number | null
          created_at: string | null
          employee_id: string
          id: string
          last_calculated_at: string | null
          overall_score: number | null
          skill_match_score: number | null
          swap_reliability: number | null
          updated_at: string | null
        }
        Insert: {
          attendance_score?: number | null
          availability_adherence?: number | null
          cancellation_penalty?: number | null
          created_at?: string | null
          employee_id: string
          id?: string
          last_calculated_at?: string | null
          overall_score?: number | null
          skill_match_score?: number | null
          swap_reliability?: number | null
          updated_at?: string | null
        }
        Update: {
          attendance_score?: number | null
          availability_adherence?: number | null
          cancellation_penalty?: number | null
          created_at?: string | null
          employee_id?: string
          id?: string
          last_calculated_at?: string | null
          overall_score?: number | null
          skill_match_score?: number | null
          swap_reliability?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_suitability_scores_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          availability: Json | null
          created_at: string | null
          email: string
          employee_id: string
          employment_type: string | null
          first_name: string
          id: string
          last_name: string
          middle_name: string | null
          phone: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          availability?: Json | null
          created_at?: string | null
          email: string
          employee_id: string
          employment_type?: string | null
          first_name: string
          id?: string
          last_name: string
          middle_name?: string | null
          phone?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          availability?: Json | null
          created_at?: string | null
          email?: string
          employee_id?: string
          employment_type?: string | null
          first_name?: string
          id?: string
          last_name?: string
          middle_name?: string | null
          phone?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      event_tags: {
        Row: {
          category: string | null
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          name: string
          organization_id: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          name: string
          organization_id?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string | null
          description: string | null
          end_date: string
          end_time: string | null
          event_type: string | null
          expected_attendance: number | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string | null
          start_date: string
          start_time: string | null
          status: string | null
          updated_at: string | null
          venue: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          end_date: string
          end_time?: string | null
          event_type?: string | null
          expected_attendance?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id?: string | null
          start_date: string
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
          venue?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          end_date?: string
          end_time?: string | null
          event_type?: string | null
          expected_attendance?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string | null
          start_date?: string
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
          venue?: string | null
        }
        Relationships: []
      }
      group_participants: {
        Row: {
          employee_id: string
          group_id: string
          id: string
          joined_at: string | null
          role: string
        }
        Insert: {
          employee_id: string
          group_id: string
          id?: string
          joined_at?: string | null
          role?: string
        }
        Update: {
          employee_id?: string
          group_id?: string
          id?: string
          joined_at?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_participants_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "broadcast_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_broadcast_groups_with_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_unread_broadcasts_by_group"
            referencedColumns: ["group_id"]
          },
        ]
      }
      licenses: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          issuing_authority: string | null
          name: string
          updated_at: string | null
          validity_period_months: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          issuing_authority?: string | null
          name: string
          updated_at?: string | null
          validity_period_months?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          issuing_authority?: string | null
          name?: string
          updated_at?: string | null
          validity_period_months?: number | null
        }
        Relationships: []
      }
      login_audit: {
        Row: {
          id: string
          ip_address: string | null
          login_at: string | null
          logout_at: string | null
          session_duration: unknown
          user_agent: string | null
          user_id: string
        }
        Insert: {
          id?: string
          ip_address?: string | null
          login_at?: string | null
          logout_at?: string | null
          session_duration?: unknown
          user_agent?: string | null
          user_id: string
        }
        Update: {
          id?: string
          ip_address?: string | null
          login_at?: string | null
          logout_at?: string | null
          session_duration?: unknown
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      monthly_hours_summary: {
        Row: {
          actual_worked_hours: number | null
          created_at: string | null
          employee_id: string
          exceeds_monthly_limit: boolean | null
          hours_remaining: number | null
          id: string
          month: number
          total_scheduled_hours: number | null
          updated_at: string | null
          year: number
        }
        Insert: {
          actual_worked_hours?: number | null
          created_at?: string | null
          employee_id: string
          exceeds_monthly_limit?: boolean | null
          hours_remaining?: number | null
          id?: string
          month: number
          total_scheduled_hours?: number | null
          updated_at?: string | null
          year: number
        }
        Update: {
          actual_worked_hours?: number | null
          created_at?: string | null
          employee_id?: string
          exceeds_monthly_limit?: boolean | null
          hours_remaining?: number | null
          id?: string
          month?: number
          total_scheduled_hours?: number | null
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_hours_summary_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_queue: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          notification_type: string
          reference_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          notification_type: string
          reference_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          notification_type?: string
          reference_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          dismissed_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          link: string | null
          message: string | null
          profile_id: string
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          message?: string | null
          profile_id: string
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          message?: string | null
          profile_id?: string
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          code: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          phone: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          code?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          phone?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          code?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      pay_periods: {
        Row: {
          created_at: string | null
          cutoff_date: string
          id: string
          locked_at: string | null
          locked_by: string | null
          period_end_date: string
          period_start_date: string
          status: string
        }
        Insert: {
          created_at?: string | null
          cutoff_date: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          period_end_date: string
          period_start_date: string
          status?: string
        }
        Update: {
          created_at?: string | null
          cutoff_date?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          period_end_date?: string
          period_start_date?: string
          status?: string
        }
        Relationships: []
      }
      pay_rate_rules: {
        Row: {
          created_at: string | null
          day_type: string
          effective_from: string | null
          effective_to: string | null
          hourly_rate: number
          id: string
          multiplier: number
          remuneration_level_id: string
        }
        Insert: {
          created_at?: string | null
          day_type: string
          effective_from?: string | null
          effective_to?: string | null
          hourly_rate: number
          id?: string
          multiplier?: number
          remuneration_level_id: string
        }
        Update: {
          created_at?: string | null
          day_type?: string
          effective_from?: string | null
          effective_to?: string | null
          hourly_rate?: number
          id?: string
          multiplier?: number
          remuneration_level_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_rate_rules_remuneration_level_id_fkey"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          availability: Json | null
          avatar_url: string | null
          created_at: string | null
          date_of_birth: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_code: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          first_name: string
          full_name: string | null
          hire_date: string | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          last_name: string | null
          legacy_employee_id: string | null
          middle_name: string | null
          organization_id: string | null
          phone: string | null
          status: string | null
          system_role: Database["public"]["Enums"]["system_role"]
          termination_date: string | null
          updated_at: string | null
        }
        Insert: {
          availability?: Json | null
          avatar_url?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_code?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          first_name: string
          full_name?: string | null
          hire_date?: string | null
          id: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          legacy_employee_id?: string | null
          middle_name?: string | null
          organization_id?: string | null
          phone?: string | null
          status?: string | null
          system_role?: Database["public"]["Enums"]["system_role"]
          termination_date?: string | null
          updated_at?: string | null
        }
        Update: {
          availability?: Json | null
          avatar_url?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_code?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          first_name?: string
          full_name?: string | null
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          legacy_employee_id?: string | null
          middle_name?: string | null
          organization_id?: string | null
          phone?: string | null
          status?: string | null
          system_role?: Database["public"]["Enums"]["system_role"]
          termination_date?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      public_holidays: {
        Row: {
          applies_to_state: string | null
          created_at: string | null
          holiday_date: string
          holiday_name: string
          id: string
          is_national: boolean | null
        }
        Insert: {
          applies_to_state?: string | null
          created_at?: string | null
          holiday_date: string
          holiday_name: string
          id?: string
          is_national?: boolean | null
        }
        Update: {
          applies_to_state?: string | null
          created_at?: string | null
          holiday_date?: string
          holiday_name?: string
          id?: string
          is_national?: boolean | null
        }
        Relationships: []
      }
      remuneration_levels: {
        Row: {
          annual_salary_max: number | null
          annual_salary_min: number | null
          created_at: string | null
          description: string | null
          hourly_rate_max: number | null
          hourly_rate_min: number | null
          id: string
          level_name: string
          level_number: number
          updated_at: string | null
        }
        Insert: {
          annual_salary_max?: number | null
          annual_salary_min?: number | null
          created_at?: string | null
          description?: string | null
          hourly_rate_max?: number | null
          hourly_rate_min?: number | null
          id?: string
          level_name: string
          level_number: number
          updated_at?: string | null
        }
        Update: {
          annual_salary_max?: number | null
          annual_salary_min?: number | null
          created_at?: string | null
          description?: string | null
          hourly_rate_max?: number | null
          hourly_rate_min?: number | null
          id?: string
          level_name?: string
          level_number?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      rest_period_violations: {
        Row: {
          employee_id: string
          first_shift_end: string
          first_shift_id: string
          id: string
          rest_hours: number
          second_shift_id: string
          second_shift_start: string
          violation_detected_at: string | null
        }
        Insert: {
          employee_id: string
          first_shift_end: string
          first_shift_id: string
          id?: string
          rest_hours: number
          second_shift_id: string
          second_shift_start: string
          violation_detected_at?: string | null
        }
        Update: {
          employee_id?: string
          first_shift_end?: string
          first_shift_id?: string
          id?: string
          rest_hours?: number
          second_shift_id?: string
          second_shift_start?: string
          violation_detected_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rest_period_violations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rest_period_violations_first_shift_id_fkey"
            columns: ["first_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rest_period_violations_second_shift_id_fkey"
            columns: ["second_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      role_levels: {
        Row: {
          hierarchy_rank: number
          id: string
          level_code: string
          remuneration_level_id: string
          role_id: string
        }
        Insert: {
          hierarchy_rank: number
          id?: string
          level_code: string
          remuneration_level_id: string
          role_id: string
        }
        Update: {
          hierarchy_rank?: number
          id?: string
          level_code?: string
          remuneration_level_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_levels_remuneration_level_id_fkey"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_levels_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_levels_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["role_id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string | null
          created_at: string | null
          department_id: string | null
          description: string | null
          id: string
          is_active: boolean | null
          level: number
          name: string
          remuneration_level_id: string | null
          responsibilities: string[] | null
          sub_department_id: string | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          level: number
          name: string
          remuneration_level_id?: string | null
          responsibilities?: string[] | null
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          level?: number
          name?: string
          remuneration_level_id?: string | null
          responsibilities?: string[] | null
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_department_stats"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "roles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "roles_remuneration_level_id_fkey"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["sub_department_id"]
          },
        ]
      }
      roster_audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          entity_id: string | null
          entity_type: string
          id: string
          new_data: Json | null
          notes: string | null
          old_data: Json | null
          roster_day_id: string | null
          roster_shift_id: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          new_data?: Json | null
          notes?: string | null
          old_data?: Json | null
          roster_day_id?: string | null
          roster_shift_id?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_data?: Json | null
          notes?: string | null
          old_data?: Json | null
          roster_day_id?: string | null
          roster_shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_audit_log_roster_day_id_fkey"
            columns: ["roster_day_id"]
            isOneToOne: false
            referencedRelation: "roster_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_audit_log_roster_day_id_fkey"
            columns: ["roster_day_id"]
            isOneToOne: false
            referencedRelation: "v_roster_day_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_audit_log_roster_shift_id_fkey"
            columns: ["roster_shift_id"]
            isOneToOne: false
            referencedRelation: "roster_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_days: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          locked_at: string | null
          locked_by: string | null
          notes: string | null
          organization_id: string
          status: Database["public"]["Enums"]["roster_day_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["roster_day_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["roster_day_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_days_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_days_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      roster_groups: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          roster_day_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          roster_day_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          roster_day_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_groups_roster_day_id_fkey"
            columns: ["roster_day_id"]
            isOneToOne: false
            referencedRelation: "roster_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_groups_roster_day_id_fkey"
            columns: ["roster_day_id"]
            isOneToOne: false
            referencedRelation: "v_roster_day_full"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_shift_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          confirmed_at: string | null
          employee_id: string
          id: string
          notes: string | null
          roster_shift_id: string
          status: Database["public"]["Enums"]["assignment_status"]
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          confirmed_at?: string | null
          employee_id: string
          id?: string
          notes?: string | null
          roster_shift_id: string
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          confirmed_at?: string | null
          employee_id?: string
          id?: string
          notes?: string | null
          roster_shift_id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "roster_shift_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shift_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shift_assignments_roster_shift_id_fkey"
            columns: ["roster_shift_id"]
            isOneToOne: false
            referencedRelation: "roster_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_shifts: {
        Row: {
          created_at: string
          end_time: string
          event_tags: string[] | null
          id: string
          is_manual: boolean | null
          name: string | null
          net_hours: number | null
          notes: string | null
          paid_break_minutes: number | null
          remuneration_level: string | null
          remuneration_level_id: string | null
          required_licenses: string[] | null
          required_skills: string[] | null
          role_id: string | null
          role_name: string | null
          roster_subgroup_id: string
          site_tags: string[] | null
          sort_order: number
          start_time: string
          template_shift_id: string | null
          unpaid_break_minutes: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_time: string
          event_tags?: string[] | null
          id?: string
          is_manual?: boolean | null
          name?: string | null
          net_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          remuneration_level?: string | null
          remuneration_level_id?: string | null
          required_licenses?: string[] | null
          required_skills?: string[] | null
          role_id?: string | null
          role_name?: string | null
          roster_subgroup_id: string
          site_tags?: string[] | null
          sort_order?: number
          start_time: string
          template_shift_id?: string | null
          unpaid_break_minutes?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_time?: string
          event_tags?: string[] | null
          id?: string
          is_manual?: boolean | null
          name?: string | null
          net_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          remuneration_level?: string | null
          remuneration_level_id?: string | null
          required_licenses?: string[] | null
          required_skills?: string[] | null
          role_id?: string | null
          role_name?: string | null
          roster_subgroup_id?: string
          site_tags?: string[] | null
          sort_order?: number
          start_time?: string
          template_shift_id?: string | null
          unpaid_break_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_shifts_roster_subgroup_id_fkey"
            columns: ["roster_subgroup_id"]
            isOneToOne: false
            referencedRelation: "roster_subgroups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_template_shift_id_fkey"
            columns: ["template_shift_id"]
            isOneToOne: false
            referencedRelation: "template_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_subgroups: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          roster_group_id: string
          sort_order: number
          template_subgroup_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          roster_group_id: string
          sort_order?: number
          template_subgroup_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          roster_group_id?: string
          sort_order?: number
          template_subgroup_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_subgroups_roster_group_id_fkey"
            columns: ["roster_group_id"]
            isOneToOne: false
            referencedRelation: "roster_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_subgroups_template_subgroup_id_fkey"
            columns: ["template_subgroup_id"]
            isOneToOne: false
            referencedRelation: "template_subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_template_applications: {
        Row: {
          applied_at: string
          applied_by: string | null
          id: string
          mode: string | null
          roster_day_id: string
          shifts_created: number | null
          shifts_skipped: number | null
          template_id: string
          template_snapshot_id: string | null
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          id?: string
          mode?: string | null
          roster_day_id: string
          shifts_created?: number | null
          shifts_skipped?: number | null
          template_id: string
          template_snapshot_id?: string | null
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          id?: string
          mode?: string | null
          roster_day_id?: string
          shifts_created?: number | null
          shifts_skipped?: number | null
          template_id?: string
          template_snapshot_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_template_applications_roster_day_id_fkey"
            columns: ["roster_day_id"]
            isOneToOne: false
            referencedRelation: "roster_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_template_applications_roster_day_id_fkey"
            columns: ["roster_day_id"]
            isOneToOne: false
            referencedRelation: "v_roster_day_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_template_applications_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_template_applications_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_template_applications_template_snapshot_id_fkey"
            columns: ["template_snapshot_id"]
            isOneToOne: false
            referencedRelation: "template_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_templates: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string | null
          end_date: string | null
          id: string
          is_base_template: boolean | null
          last_edited_by: string | null
          name: string
          organization_id: string
          published_at: string | null
          published_by: string | null
          published_month: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["template_status"]
          sub_department_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_base_template?: boolean | null
          last_edited_by?: string | null
          name: string
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          published_month?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["template_status"]
          sub_department_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_base_template?: boolean | null
          last_edited_by?: string | null
          name?: string
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          published_month?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["template_status"]
          sub_department_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "roster_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_department_stats"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "roster_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "roster_templates_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["sub_department_id"]
          },
        ]
      }
      rosters: {
        Row: {
          created_at: string | null
          created_by: string | null
          date: string
          department_id: string | null
          description: string | null
          end_date: string
          groups: Json
          id: string
          is_locked: boolean
          name: string
          organization_id: string
          published_at: string | null
          published_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id: string | null
          template_id: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          date?: string
          department_id?: string | null
          description?: string | null
          end_date: string
          groups?: Json
          id?: string
          is_locked?: boolean
          name: string
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id?: string | null
          template_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          date?: string
          department_id?: string | null
          description?: string | null
          end_date?: string
          groups?: Json
          id?: string
          is_locked?: boolean
          name?: string
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id?: string | null
          template_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rosters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_department_stats"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "rosters_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "rosters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "rosters_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_audit_events: {
        Row: {
          batch_id: string | null
          created_at: string | null
          event_category: string
          event_type: string
          field_changed: string | null
          id: string
          ip_address: unknown
          metadata: Json | null
          new_data: Json | null
          new_value: string | null
          old_data: Json | null
          old_value: string | null
          performed_by_id: string | null
          performed_by_name: string
          performed_by_role: string
          shift_id: string
          user_agent: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string | null
          event_category: string
          event_type: string
          field_changed?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_data?: Json | null
          new_value?: string | null
          old_data?: Json | null
          old_value?: string | null
          performed_by_id?: string | null
          performed_by_name?: string
          performed_by_role?: string
          shift_id: string
          user_agent?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string | null
          event_category?: string
          event_type?: string
          field_changed?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_data?: Json | null
          new_value?: string | null
          old_data?: Json | null
          old_value?: string | null
          performed_by_id?: string | null
          performed_by_name?: string
          performed_by_role?: string
          shift_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_audit_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_audit_events_archive: {
        Row: {
          batch_id: string | null
          created_at: string | null
          event_category: string
          event_type: string
          field_changed: string | null
          id: string
          ip_address: unknown
          metadata: Json | null
          new_data: Json | null
          new_value: string | null
          old_data: Json | null
          old_value: string | null
          performed_by_id: string | null
          performed_by_name: string
          performed_by_role: string
          shift_id: string
          user_agent: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string | null
          event_category: string
          event_type: string
          field_changed?: string | null
          id: string
          ip_address?: unknown
          metadata?: Json | null
          new_data?: Json | null
          new_value?: string | null
          old_data?: Json | null
          old_value?: string | null
          performed_by_id?: string | null
          performed_by_name?: string
          performed_by_role?: string
          shift_id: string
          user_agent?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string | null
          event_category?: string
          event_type?: string
          field_changed?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_data?: Json | null
          new_value?: string | null
          old_data?: Json | null
          old_value?: string | null
          performed_by_id?: string | null
          performed_by_name?: string
          performed_by_role?: string
          shift_id?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      shift_audit_log: {
        Row: {
          action: string
          change_reason: string | null
          changed_by_name: string | null
          changed_by_user_id: string | null
          changes: Json | null
          created_at: string | null
          event_type: string | null
          field_name: string | null
          id: string
          metadata: Json | null
          new_data: Json | null
          new_value: string | null
          notes: string | null
          old_data: Json | null
          old_value: string | null
          performed_at: string
          performed_by: string | null
          performed_by_name: string | null
          shift_id: string
        }
        Insert: {
          action: string
          change_reason?: string | null
          changed_by_name?: string | null
          changed_by_user_id?: string | null
          changes?: Json | null
          created_at?: string | null
          event_type?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          new_value?: string | null
          notes?: string | null
          old_data?: Json | null
          old_value?: string | null
          performed_at?: string
          performed_by?: string | null
          performed_by_name?: string | null
          shift_id: string
        }
        Update: {
          action?: string
          change_reason?: string | null
          changed_by_name?: string | null
          changed_by_user_id?: string | null
          changes?: Json | null
          created_at?: string | null
          event_type?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          new_value?: string | null
          notes?: string | null
          old_data?: Json | null
          old_value?: string | null
          performed_at?: string
          performed_by?: string | null
          performed_by_name?: string | null
          shift_id?: string
        }
        Relationships: []
      }
      shift_bid_windows: {
        Row: {
          closes_at: string
          created_at: string | null
          id: string
          opens_at: string
          shift_id: string
          status: string
          total_bids: number | null
        }
        Insert: {
          closes_at: string
          created_at?: string | null
          id?: string
          opens_at: string
          shift_id: string
          status?: string
          total_bids?: number | null
        }
        Update: {
          closes_at?: string
          created_at?: string | null
          id?: string
          opens_at?: string
          shift_id?: string
          status?: string
          total_bids?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_bid_windows_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_bids: {
        Row: {
          allocation_reason: string | null
          bid_rank: number | null
          created_at: string | null
          employee_id: string | null
          hours_limit_valid: boolean | null
          id: string
          notes: string | null
          priority: number | null
          profile_id: string
          responded_at: string | null
          responded_by: string | null
          response_notes: string | null
          rest_period_valid: boolean | null
          shift_id: string
          skill_match_percentage: number | null
          status: Database["public"]["Enums"]["bid_status"] | null
          suitability_score: number | null
          updated_at: string | null
        }
        Insert: {
          allocation_reason?: string | null
          bid_rank?: number | null
          created_at?: string | null
          employee_id?: string | null
          hours_limit_valid?: boolean | null
          id?: string
          notes?: string | null
          priority?: number | null
          profile_id: string
          responded_at?: string | null
          responded_by?: string | null
          response_notes?: string | null
          rest_period_valid?: boolean | null
          shift_id: string
          skill_match_percentage?: number | null
          status?: Database["public"]["Enums"]["bid_status"] | null
          suitability_score?: number | null
          updated_at?: string | null
        }
        Update: {
          allocation_reason?: string | null
          bid_rank?: number | null
          created_at?: string | null
          employee_id?: string | null
          hours_limit_valid?: boolean | null
          id?: string
          notes?: string | null
          priority?: number | null
          profile_id?: string
          responded_at?: string | null
          responded_by?: string | null
          response_notes?: string | null
          rest_period_valid?: boolean | null
          shift_id?: string
          skill_match_percentage?: number | null
          status?: Database["public"]["Enums"]["bid_status"] | null
          suitability_score?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_bids_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_certifications: {
        Row: {
          certification_id: string
          created_at: string | null
          id: string
          is_required: boolean | null
          shift_id: string
        }
        Insert: {
          certification_id: string
          created_at?: string | null
          id?: string
          is_required?: boolean | null
          shift_id: string
        }
        Update: {
          certification_id?: string
          created_at?: string | null
          id?: string
          is_required?: boolean | null
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_certifications_certification_id_fkey"
            columns: ["certification_id"]
            isOneToOne: false
            referencedRelation: "certifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_certifications_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_event_tags: {
        Row: {
          created_at: string | null
          event_tag_id: string
          id: string
          shift_id: string
        }
        Insert: {
          created_at?: string | null
          event_tag_id: string
          id?: string
          shift_id: string
        }
        Update: {
          created_at?: string | null
          event_tag_id?: string
          id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_event_tags_event_tag_id_fkey"
            columns: ["event_tag_id"]
            isOneToOne: false
            referencedRelation: "event_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_event_tags_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_events: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_state: Json | null
          before_state: Json | null
          correlation_id: string | null
          created_at: string
          event_id: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          metadata: Json
          occurred_at: string
          reason: string | null
          shift_id: string
          source: Database["public"]["Enums"]["event_source"]
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          event_id: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          metadata: Json
          occurred_at: string
          reason?: string | null
          shift_id: string
          source: Database["public"]["Enums"]["event_source"]
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          event_id?: string
          event_type?: Database["public"]["Enums"]["shift_event_type"]
          metadata?: Json
          occurred_at?: string
          reason?: string | null
          shift_id?: string
          source?: Database["public"]["Enums"]["event_source"]
        }
        Relationships: []
      }
      shift_events_2026_01: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_state: Json | null
          before_state: Json | null
          correlation_id: string | null
          created_at: string
          event_id: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          metadata: Json
          occurred_at: string
          reason: string | null
          shift_id: string
          source: Database["public"]["Enums"]["event_source"]
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          event_id: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          metadata: Json
          occurred_at: string
          reason?: string | null
          shift_id: string
          source: Database["public"]["Enums"]["event_source"]
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          event_id?: string
          event_type?: Database["public"]["Enums"]["shift_event_type"]
          metadata?: Json
          occurred_at?: string
          reason?: string | null
          shift_id?: string
          source?: Database["public"]["Enums"]["event_source"]
        }
        Relationships: []
      }
      shift_events_2026_02: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_state: Json | null
          before_state: Json | null
          correlation_id: string | null
          created_at: string
          event_id: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          metadata: Json
          occurred_at: string
          reason: string | null
          shift_id: string
          source: Database["public"]["Enums"]["event_source"]
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          event_id: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          metadata: Json
          occurred_at: string
          reason?: string | null
          shift_id: string
          source: Database["public"]["Enums"]["event_source"]
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          event_id?: string
          event_type?: Database["public"]["Enums"]["shift_event_type"]
          metadata?: Json
          occurred_at?: string
          reason?: string | null
          shift_id?: string
          source?: Database["public"]["Enums"]["event_source"]
        }
        Relationships: []
      }
      shift_events_2026_03: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_state: Json | null
          before_state: Json | null
          correlation_id: string | null
          created_at: string
          event_id: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          metadata: Json
          occurred_at: string
          reason: string | null
          shift_id: string
          source: Database["public"]["Enums"]["event_source"]
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          event_id: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          metadata: Json
          occurred_at: string
          reason?: string | null
          shift_id: string
          source: Database["public"]["Enums"]["event_source"]
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          event_id?: string
          event_type?: Database["public"]["Enums"]["shift_event_type"]
          metadata?: Json
          occurred_at?: string
          reason?: string | null
          shift_id?: string
          source?: Database["public"]["Enums"]["event_source"]
        }
        Relationships: []
      }
      shift_flags: {
        Row: {
          created_at: string | null
          enabled: boolean | null
          flag_type: string
          id: string
          metadata: Json | null
          shift_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean | null
          flag_type: string
          id?: string
          metadata?: Json | null
          shift_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          enabled?: boolean | null
          flag_type?: string
          id?: string
          metadata?: Json | null
          shift_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_flags_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_groups: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      shift_licenses: {
        Row: {
          created_at: string | null
          id: string
          is_required: boolean | null
          license_id: string
          shift_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_required?: boolean | null
          license_id: string
          shift_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_required?: boolean | null
          license_id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_licenses_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_licenses_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_lifecycle_log: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          created_at: string | null
          id: string
          new_status: Database["public"]["Enums"]["lifecycle_status_enum"]
          old_status:
          | Database["public"]["Enums"]["lifecycle_status_enum"]
          | null
          reason: string | null
          shift_id: string
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          created_at?: string | null
          id?: string
          new_status: Database["public"]["Enums"]["lifecycle_status_enum"]
          old_status?:
          | Database["public"]["Enums"]["lifecycle_status_enum"]
          | null
          reason?: string | null
          shift_id: string
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          created_at?: string | null
          id?: string
          new_status?: Database["public"]["Enums"]["lifecycle_status_enum"]
          old_status?:
          | Database["public"]["Enums"]["lifecycle_status_enum"]
          | null
          reason?: string | null
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_lifecycle_log_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_offers: {
        Row: {
          created_at: string | null
          employee_id: string
          id: string
          offered_at: string | null
          responded_at: string | null
          response_notes: string | null
          shift_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          id?: string
          offered_at?: string | null
          responded_at?: string | null
          response_notes?: string | null
          shift_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          id?: string
          offered_at?: string | null
          responded_at?: string | null
          response_notes?: string | null
          shift_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_offers_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_offers_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_skills: {
        Row: {
          created_at: string | null
          id: string
          shift_id: string
          skill_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          shift_id: string
          skill_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          shift_id?: string
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_skills_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_subgroups: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_subgroups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "shift_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_swaps: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          id: string
          manager_approved: boolean | null
          reason: string | null
          rejection_reason: string | null
          requester_id: string
          requester_shift_id: string
          status: Database["public"]["Enums"]["swap_status"] | null
          swap_type: string
          target_accepted: boolean | null
          target_id: string | null
          target_response_at: string | null
          target_shift_id: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          id?: string
          manager_approved?: boolean | null
          reason?: string | null
          rejection_reason?: string | null
          requester_id: string
          requester_shift_id: string
          status?: Database["public"]["Enums"]["swap_status"] | null
          swap_type?: string
          target_accepted?: boolean | null
          target_id?: string | null
          target_response_at?: string | null
          target_shift_id?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          id?: string
          manager_approved?: boolean | null
          reason?: string | null
          rejection_reason?: string | null
          requester_id?: string
          requester_shift_id?: string
          status?: Database["public"]["Enums"]["swap_status"] | null
          swap_type?: string
          target_accepted?: boolean | null
          target_id?: string | null
          target_response_at?: string | null
          target_shift_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_swaps_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_requester_shift_id_fkey"
            columns: ["requester_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swaps_target_shift_id_fkey"
            columns: ["target_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          department_id: string
          description: string | null
          end_date: string | null
          groups: Json
          id: string
          is_draft: boolean
          name: string
          start_date: string | null
          sub_department_id: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          department_id: string
          description?: string | null
          end_date?: string | null
          groups?: Json
          id?: string
          is_draft?: boolean
          name: string
          start_date?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          department_id?: string
          description?: string | null
          end_date?: string | null
          groups?: Json
          id?: string
          is_draft?: boolean
          name?: string
          start_date?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      shifts: {
        Row: {
          actual_end: string | null
          actual_hourly_rate: number | null
          actual_net_minutes: number | null
          actual_start: string | null
          assigned_at: string | null
          assigned_employee_id: string | null
          assignment_id: string | null

          bidding_close_at: string | null
          bidding_deadline: string | null
          bidding_enabled: boolean | null
          bidding_end_at: string | null
          bidding_open_at: string | null
          bidding_priority_text: string | null
          bidding_start_at: string | null
          break_minutes: number | null
          cancellation_reason: string | null

          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_user_id: string | null
          compliance_checked_at: string | null
          compliance_override: boolean | null
          compliance_override_reason: string | null
          compliance_snapshot: Json | null

          confirmed_at: string | null
          cost_center_id: string | null
          created_at: string | null
          created_by_user_id: string | null
          currency: string | null
          deleted_at: string | null
          deleted_by: string | null
          department_id: string
          display_order: number | null
          eligibility_snapshot: Json | null

          end_time: string
          event_ids: Json | null
          event_tags: Json | null
          fulfillment_status: Database["public"]["Enums"]["shift_fulfillment_status"]
          group_type: Database["public"]["Enums"]["template_group_type"] | null
          id: string
          is_cancelled: boolean
          is_draft: boolean | null
          is_from_template: boolean
          is_locked: boolean | null
          is_on_bidding: boolean | null
          is_overnight: boolean
          is_published: boolean | null
          is_recurring: boolean | null

          last_modified_by: string | null
          last_modified_reason: string | null
          lifecycle_status: Database["public"]["Enums"]["shift_lifecycle"]
          assignment_outcome: Database["public"]["Enums"]["shift_assignment_outcome"] | null
          trading_status: Database["public"]["Enums"]["shift_trading"] | null
          attendance_status: Database["public"]["Enums"]["shift_attendance_status"] | null
          lock_reason_text: string | null
          net_length_minutes: number | null
          notes: string | null
          organization_id: string | null
          paid_break_minutes: number | null
          payroll_exported: boolean | null
          published_at: string | null
          published_by_user_id: string | null
          recurrence_rule: string | null
          remuneration_level_id: string | null
          remuneration_rate: number | null
          required_certifications: Json | null
          required_licenses: Json | null
          required_skills: Json | null
          role_id: string | null
          role_level: number | null
          roster_date: string | null
          roster_id: string
          scheduled_end: string | null
          scheduled_length_minutes: number | null
          scheduled_start: string | null
          shift_date: string
          shift_group_id: string | null
          shift_subgroup_id: string | null
          start_time: string
          status: Database["public"]["Enums"]["shift_status"] | null
          sub_department_id: string | null
          sub_group_name: string | null
          tags: Json | null
          template_group:
          | Database["public"]["Enums"]["template_group_type"]
          | null
          template_id: string | null
          template_instance_id: string | null
          template_sub_group: string | null
          timesheet_id: string | null
          timezone: string | null
          total_hours: number | null
          trade_requested_at: string | null
          unpaid_break_minutes: number | null
          updated_at: string | null
          user_contract_id: string | null
          version: number
        }
        Insert: {
          actual_end?: string | null
          actual_hourly_rate?: number | null
          actual_net_minutes?: number | null
          actual_start?: string | null
          assigned_at?: string | null
          assigned_employee_id?: string | null
          assignment_id?: string | null

          bidding_close_at?: string | null
          bidding_deadline?: string | null
          bidding_enabled?: boolean | null
          bidding_end_at?: string | null
          bidding_open_at?: string | null
          bidding_priority_text?: string | null
          bidding_start_at?: string | null
          break_minutes?: number | null
          cancellation_reason?: string | null

          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_user_id?: string | null
          compliance_checked_at?: string | null
          compliance_override?: boolean | null
          compliance_override_reason?: string | null
          compliance_snapshot?: Json | null

          confirmed_at?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          currency?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          department_id: string
          display_order?: number | null
          eligibility_snapshot?: Json | null

          end_time: string
          event_ids?: Json | null
          event_tags?: Json | null
          fulfillment_status?: Database["public"]["Enums"]["shift_fulfillment_status"]
          group_type?: Database["public"]["Enums"]["template_group_type"] | null
          id?: string
          is_cancelled?: boolean
          is_draft?: boolean | null
          is_from_template?: boolean
          is_locked?: boolean | null
          is_on_bidding?: boolean | null
          is_overnight?: boolean
          is_published?: boolean | null
          is_recurring?: boolean | null

          last_modified_by?: string | null
          last_modified_reason?: string | null
          lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle"]
          assignment_outcome?: Database["public"]["Enums"]["shift_assignment_outcome"] | null
          trading_status?: Database["public"]["Enums"]["shift_trading"] | null
          attendance_status?: Database["public"]["Enums"]["shift_attendance_status"] | null
          lock_reason_text?: string | null
          net_length_minutes?: number | null
          notes?: string | null
          organization_id?: string | null
          paid_break_minutes?: number | null
          payroll_exported?: boolean | null
          published_at?: string | null
          published_by_user_id?: string | null
          recurrence_rule?: string | null
          remuneration_level_id?: string | null
          remuneration_rate?: number | null
          required_certifications?: Json | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          role_level?: number | null
          roster_date?: string | null
          roster_id: string
          scheduled_end?: string | null
          scheduled_length_minutes?: number | null
          scheduled_start?: string | null
          shift_date: string
          shift_group_id?: string | null
          shift_subgroup_id?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["shift_status"] | null
          sub_department_id?: string | null
          sub_group_name?: string | null
          tags?: Json | null
          template_group?:
          | Database["public"]["Enums"]["template_group_type"]
          | null
          template_id?: string | null
          template_instance_id?: string | null
          template_sub_group?: string | null
          timesheet_id?: string | null
          timezone?: string | null
          total_hours?: number | null
          trade_requested_at?: string | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          user_contract_id?: string | null
          version?: number
        }
        Update: {
          actual_end?: string | null
          actual_hourly_rate?: number | null
          actual_net_minutes?: number | null
          actual_start?: string | null
          assigned_at?: string | null
          assigned_employee_id?: string | null
          assignment_id?: string | null

          bidding_close_at?: string | null
          bidding_deadline?: string | null
          bidding_enabled?: boolean | null
          bidding_end_at?: string | null
          bidding_open_at?: string | null
          bidding_priority_text?: string | null
          bidding_start_at?: string | null
          break_minutes?: number | null
          cancellation_reason?: string | null

          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_user_id?: string | null
          compliance_checked_at?: string | null
          compliance_override?: boolean | null
          compliance_override_reason?: string | null
          compliance_snapshot?: Json | null

          confirmed_at?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          currency?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string
          display_order?: number | null
          eligibility_snapshot?: Json | null

          end_time?: string
          event_ids?: Json | null
          event_tags?: Json | null
          fulfillment_status?: Database["public"]["Enums"]["shift_fulfillment_status"]
          group_type?: Database["public"]["Enums"]["template_group_type"] | null
          id?: string
          is_cancelled?: boolean
          is_draft?: boolean | null
          is_from_template?: boolean
          is_locked?: boolean | null
          is_on_bidding?: boolean | null
          is_overnight?: boolean
          is_published?: boolean | null
          is_recurring?: boolean | null

          last_modified_by?: string | null
          last_modified_reason?: string | null
          lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle"]
          assignment_outcome?: Database["public"]["Enums"]["shift_assignment_outcome"] | null
          trading_status?: Database["public"]["Enums"]["shift_trading"] | null
          attendance_status?: Database["public"]["Enums"]["shift_attendance_status"] | null
          lock_reason_text?: string | null
          net_length_minutes?: number | null
          notes?: string | null
          organization_id?: string | null
          paid_break_minutes?: number | null
          payroll_exported?: boolean | null
          published_at?: string | null
          published_by_user_id?: string | null
          recurrence_rule?: string | null
          remuneration_level_id?: string | null
          remuneration_rate?: number | null
          required_certifications?: Json | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          role_level?: number | null
          roster_date?: string | null
          roster_id?: string
          scheduled_end?: string | null
          scheduled_length_minutes?: number | null
          scheduled_start?: string | null
          shift_date?: string
          shift_group_id?: string | null
          shift_subgroup_id?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["shift_status"] | null
          sub_department_id?: string | null
          sub_group_name?: string | null
          tags?: Json | null
          template_group?:
          | Database["public"]["Enums"]["template_group_type"]
          | null
          template_id?: string | null
          template_instance_id?: string | null
          template_sub_group?: string | null
          timesheet_id?: string | null
          timezone?: string | null
          total_hours?: number | null
          trade_requested_at?: string | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          user_contract_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_shifts_organization"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_shifts_organization"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "fk_shifts_remuneration"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_assigned_to_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_assigned_to_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_department_stats"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "shifts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "shifts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["role_id"]
          },
          {
            foreignKeyName: "shifts_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "rosters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["sub_department_id"]
          },
          {
            foreignKeyName: "shifts_user_contract_id_fkey"
            columns: ["user_contract_id"]
            isOneToOne: false
            referencedRelation: "user_contract_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_user_contract_id_fkey"
            columns: ["user_contract_id"]
            isOneToOne: false
            referencedRelation: "user_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      sub_departments: {
        Row: {
          code: string | null
          created_at: string | null
          department_id: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          department_id: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          department_id?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sub_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_department_stats"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "sub_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["department_id"]
          },
        ]
      }
      swap_approvals: {
        Row: {
          action: string
          actioned_at: string | null
          approver_id: string
          comments: string | null
          id: string
          swap_request_id: string
        }
        Insert: {
          action: string
          actioned_at?: string | null
          approver_id: string
          comments?: string | null
          id?: string
          swap_request_id: string
        }
        Update: {
          action?: string
          actioned_at?: string | null
          approver_id?: string
          comments?: string | null
          id?: string
          swap_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "swap_approvals_swap_request_id_fkey"
            columns: ["swap_request_id"]
            isOneToOne: false
            referencedRelation: "swap_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          notification_type: string
          recipient_user_id: string
          swap_request_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          notification_type: string
          recipient_user_id: string
          swap_request_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          notification_type?: string
          recipient_user_id?: string
          swap_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "swap_notifications_swap_request_id_fkey"
            columns: ["swap_request_id"]
            isOneToOne: false
            referencedRelation: "swap_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_requests: {
        Row: {
          approved_by_manager_id: string | null
          created_at: string | null
          id: string
          manager_approved_at: string | null
          offered_shift_id: string | null
          original_shift_id: string
          reason: string | null
          rejection_reason: string | null
          requested_by_employee_id: string
          responded_at: string | null
          status: string
          swap_with_employee_id: string | null
          updated_at: string | null
        }
        Insert: {
          approved_by_manager_id?: string | null
          created_at?: string | null
          id?: string
          manager_approved_at?: string | null
          offered_shift_id?: string | null
          original_shift_id: string
          reason?: string | null
          rejection_reason?: string | null
          requested_by_employee_id: string
          responded_at?: string | null
          status?: string
          swap_with_employee_id?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_by_manager_id?: string | null
          created_at?: string | null
          id?: string
          manager_approved_at?: string | null
          offered_shift_id?: string | null
          original_shift_id?: string
          reason?: string | null
          rejection_reason?: string | null
          requested_by_employee_id?: string
          responded_at?: string | null
          status?: string
          swap_with_employee_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "swap_requests_offered_shift_id_fkey"
            columns: ["offered_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_original_shift_id_fkey"
            columns: ["original_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_requested_by_employee_id_fkey"
            columns: ["requested_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_swap_with_employee_id_fkey"
            columns: ["swap_with_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_validations: {
        Row: {
          daily_hours_check: boolean | null
          employee_id: string
          id: string
          is_valid: boolean | null
          monthly_hours_check: boolean | null
          rest_period_check: boolean | null
          skill_match_check: boolean | null
          swap_request_id: string
          validated_at: string | null
          validation_errors: Json | null
        }
        Insert: {
          daily_hours_check?: boolean | null
          employee_id: string
          id?: string
          is_valid?: boolean | null
          monthly_hours_check?: boolean | null
          rest_period_check?: boolean | null
          skill_match_check?: boolean | null
          swap_request_id: string
          validated_at?: string | null
          validation_errors?: Json | null
        }
        Update: {
          daily_hours_check?: boolean | null
          employee_id?: string
          id?: string
          is_valid?: boolean | null
          monthly_hours_check?: boolean | null
          rest_period_check?: boolean | null
          skill_match_check?: boolean | null
          swap_request_id?: string
          validated_at?: string | null
          validation_errors?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "swap_validations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_validations_swap_request_id_fkey"
            columns: ["swap_request_id"]
            isOneToOne: false
            referencedRelation: "swap_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: {
          config_key: string
          config_value: Json
          description: string | null
          id: string
          last_modified_at: string | null
          last_modified_by: string | null
        }
        Insert: {
          config_key: string
          config_value?: Json
          description?: string | null
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
        }
        Update: {
          config_key?: string
          config_value?: Json
          description?: string | null
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
        }
        Relationships: []
      }
      template_audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          changed_at: string
          changed_by: string | null
          id: string
          ip_address: unknown
          new_data: Json | null
          new_version: number | null
          notes: string | null
          old_data: Json | null
          old_version: number | null
          template_id: string
          user_agent: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          changed_at?: string
          changed_by?: string | null
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          new_version?: number | null
          notes?: string | null
          old_data?: Json | null
          old_version?: number | null
          template_id: string
          user_agent?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          changed_at?: string
          changed_by?: string | null
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          new_version?: number | null
          notes?: string | null
          old_data?: Json | null
          old_version?: number | null
          template_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
        ]
      }
      template_groups: {
        Row: {
          color: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          sort_order: number
          template_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          sort_order?: number
          template_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          sort_order?: number
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_groups_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_groups_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
        ]
      }
      template_shifts: {
        Row: {
          created_at: string
          end_time: string
          event_tags: string[] | null
          id: string
          name: string | null
          net_length_hours: number | null
          notes: string | null
          paid_break_minutes: number
          remuneration_level: string | null
          remuneration_level_id: string | null
          required_licenses: string[] | null
          required_skills: string[] | null
          role_id: string | null
          role_name: string | null
          site_tags: string[] | null
          sort_order: number
          start_time: string
          subgroup_id: string
          unpaid_break_minutes: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_time: string
          event_tags?: string[] | null
          id?: string
          name?: string | null
          net_length_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number
          remuneration_level?: string | null
          remuneration_level_id?: string | null
          required_licenses?: string[] | null
          required_skills?: string[] | null
          role_id?: string | null
          role_name?: string | null
          site_tags?: string[] | null
          sort_order?: number
          start_time: string
          subgroup_id: string
          unpaid_break_minutes?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_time?: string
          event_tags?: string[] | null
          id?: string
          name?: string | null
          net_length_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number
          remuneration_level?: string | null
          remuneration_level_id?: string | null
          required_licenses?: string[] | null
          required_skills?: string[] | null
          role_id?: string | null
          role_name?: string | null
          site_tags?: string[] | null
          sort_order?: number
          start_time?: string
          subgroup_id?: string
          unpaid_break_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_shifts_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "template_subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      template_snapshots: {
        Row: {
          end_date: string
          id: string
          published_at: string
          published_by: string | null
          published_for_month: string | null
          snapshot_data: Json
          start_date: string
          template_id: string
          template_version: number
        }
        Insert: {
          end_date: string
          id?: string
          published_at?: string
          published_by?: string | null
          published_for_month?: string | null
          snapshot_data: Json
          start_date: string
          template_id: string
          template_version: number
        }
        Update: {
          end_date?: string
          id?: string
          published_at?: string
          published_by?: string | null
          published_for_month?: string | null
          snapshot_data?: Json
          start_date?: string
          template_id?: string
          template_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "template_snapshots_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_snapshots_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_snapshots_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_snapshots_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
        ]
      }
      template_subgroups: {
        Row: {
          created_at: string
          description: string | null
          group_id: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          group_id: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          group_id?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_subgroups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "template_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_approval_workflow: {
        Row: {
          action: string
          approval_level: number | null
          approved_at: string | null
          approver_id: string
          comments: string | null
          id: string
          timesheet_id: string
        }
        Insert: {
          action: string
          approval_level?: number | null
          approved_at?: string | null
          approver_id: string
          comments?: string | null
          id?: string
          timesheet_id: string
        }
        Update: {
          action?: string
          approval_level?: number | null
          approved_at?: string | null
          approver_id?: string
          comments?: string | null
          id?: string
          timesheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_approval_workflow_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_pay_calculation: {
        Row: {
          base_hours: number | null
          base_rate: number | null
          calculated_at: string | null
          id: string
          public_holiday_hours: number | null
          public_holiday_pay: number | null
          timesheet_id: string
          total_pay: number | null
          weekday_hours: number | null
          weekday_pay: number | null
          weekend_hours: number | null
          weekend_pay: number | null
        }
        Insert: {
          base_hours?: number | null
          base_rate?: number | null
          calculated_at?: string | null
          id?: string
          public_holiday_hours?: number | null
          public_holiday_pay?: number | null
          timesheet_id: string
          total_pay?: number | null
          weekday_hours?: number | null
          weekday_pay?: number | null
          weekend_hours?: number | null
          weekend_pay?: number | null
        }
        Update: {
          base_hours?: number | null
          base_rate?: number | null
          calculated_at?: string | null
          id?: string
          public_holiday_hours?: number | null
          public_holiday_pay?: number | null
          timesheet_id?: string
          total_pay?: number | null
          weekday_hours?: number | null
          weekday_pay?: number | null
          weekend_hours?: number | null
          weekend_pay?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_pay_calculation_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: true
            referencedRelation: "timesheets"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          assignment_id: string | null
          break_minutes: number | null
          clock_in: string
          clock_out: string | null
          created_at: string | null
          employee_id: string | null
          end_time: string
          id: string
          net_hours: number | null
          notes: string | null
          paid_break_minutes: number | null
          profile_id: string
          rejected_reason: string | null
          shift_id: string | null
          start_time: string
          status: Database["public"]["Enums"]["timesheet_status"] | null
          submitted_at: string | null
          total_hours: number | null
          unpaid_break_minutes: number | null
          updated_at: string | null
          work_date: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          assignment_id?: string | null
          break_minutes?: number | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string | null
          employee_id?: string | null
          end_time: string
          id?: string
          net_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          profile_id: string
          rejected_reason?: string | null
          shift_id?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["timesheet_status"] | null
          submitted_at?: string | null
          total_hours?: number | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          work_date: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          assignment_id?: string | null
          break_minutes?: number | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string | null
          employee_id?: string | null
          end_time?: string
          id?: string
          net_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          profile_id?: string
          rejected_reason?: string | null
          shift_id?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["timesheet_status"] | null
          submitted_at?: string | null
          total_hours?: number | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "employee_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["assignment_id"]
          },
          {
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_requests: {
        Row: {
          approved_by: string | null
          created_at: string | null
          id: string
          manager_approved_at: string | null
          notes: string | null
          requesting_employee_id: string
          shift_id: string
          status: string | null
          target_accepted_at: string | null
          target_employee_id: string
          updated_at: string | null
        }
        Insert: {
          approved_by?: string | null
          created_at?: string | null
          id?: string
          manager_approved_at?: string | null
          notes?: string | null
          requesting_employee_id: string
          shift_id: string
          status?: string | null
          target_accepted_at?: string | null
          target_employee_id: string
          updated_at?: string | null
        }
        Update: {
          approved_by?: string | null
          created_at?: string | null
          id?: string
          manager_approved_at?: string | null
          notes?: string | null
          requesting_employee_id?: string
          shift_id?: string
          status?: string | null
          target_accepted_at?: string | null
          target_employee_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_requests_requesting_employee_id_fkey"
            columns: ["requesting_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_requests_target_employee_id_fkey"
            columns: ["target_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      user_contracts: {
        Row: {
          access_level: string
          created_at: string | null
          created_by: string | null
          custom_hourly_rate: number | null
          department_id: string
          end_date: string | null
          id: string
          notes: string | null
          organization_id: string
          rem_level_id: string
          role_id: string
          start_date: string | null
          status: string
          sub_department_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_level?: string
          created_at?: string | null
          created_by?: string | null
          custom_hourly_rate?: number | null
          department_id: string
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          rem_level_id: string
          role_id: string
          start_date?: string | null
          status?: string
          sub_department_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_level?: string
          created_at?: string | null
          created_by?: string | null
          custom_hourly_rate?: number | null
          department_id?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          rem_level_id?: string
          role_id?: string
          start_date?: string | null
          status?: string
          sub_department_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_contracts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_department_stats"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "user_contracts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "user_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "user_contracts_rem_level_id_fkey"
            columns: ["rem_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["role_id"]
          },
          {
            foreignKeyName: "user_contracts_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["sub_department_id"]
          },
        ]
      }
      user_profiles_archived: {
        Row: {
          availability: Json | null
          can_access_all_departments: boolean | null
          created_at: string | null
          department_id: string
          employee_id: string | null
          employee_number: string | null
          employment_type: string | null
          first_name: string | null
          id: string
          last_name: string | null
          middle_name: string | null
          organization_id: string
          phone: string | null
          role: string
          status: string | null
          sub_department_id: string | null
          updated_at: string | null
        }
        Insert: {
          availability?: Json | null
          can_access_all_departments?: boolean | null
          created_at?: string | null
          department_id: string
          employee_id?: string | null
          employee_number?: string | null
          employment_type?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          middle_name?: string | null
          organization_id: string
          phone?: string | null
          role: string
          status?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Update: {
          availability?: Json | null
          can_access_all_departments?: boolean | null
          created_at?: string | null
          department_id?: string
          employee_id?: string | null
          employee_number?: string | null
          employment_type?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          middle_name?: string | null
          organization_id?: string
          phone?: string | null
          role?: string
          status?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_department_stats"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "user_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "user_profiles_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "user_profiles_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["sub_department_id"]
          },
        ]
      }
      work_rules: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          rule_name: string
          rule_value: Json
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          rule_name: string
          rule_value?: Json
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          rule_name?: string
          rule_value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      user_contract_details: {
        Row: {
          access_level: string | null
          created_at: string | null
          created_by: string | null
          custom_hourly_rate: number | null
          department_id: string | null
          department_name: string | null
          email: string | null
          end_date: string | null
          first_name: string | null
          full_name: string | null
          hourly_rate_max: number | null
          hourly_rate_min: number | null
          id: string | null
          last_name: string | null
          level_name: string | null
          level_number: number | null
          notes: string | null
          organization_id: string | null
          organization_name: string | null
          rem_level_description: string | null
          rem_level_id: string | null
          role_id: string | null
          role_name: string | null
          start_date: string | null
          status: string | null
          sub_department_id: string | null
          sub_department_name: string | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_contracts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_department_stats"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "user_contracts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "user_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "user_contracts_rem_level_id_fkey"
            columns: ["rem_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["role_id"]
          },
          {
            foreignKeyName: "user_contracts_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contracts_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["sub_department_id"]
          },
        ]
      }
      v_broadcast_groups_with_stats: {
        Row: {
          active_broadcast_count: number | null
          channel_count: number | null
          color: string | null
          created_at: string | null
          created_by: string | null
          department_id: string | null
          description: string | null
          icon: string | null
          id: string | null
          is_active: boolean | null
          last_broadcast_at: string | null
          name: string | null
          participant_count: number | null
          updated_at: string | null
        }
        Insert: {
          active_broadcast_count?: never
          channel_count?: never
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          icon?: string | null
          id?: string | null
          is_active?: boolean | null
          last_broadcast_at?: never
          name?: string | null
          participant_count?: never
          updated_at?: string | null
        }
        Update: {
          active_broadcast_count?: never
          channel_count?: never
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          icon?: string | null
          id?: string | null
          is_active?: boolean | null
          last_broadcast_at?: never
          name?: string | null
          participant_count?: never
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_groups_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_groups_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_department_stats"
            referencedColumns: ["department_id"]
          },
          {
            foreignKeyName: "broadcast_groups_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["department_id"]
          },
        ]
      }
      v_channels_with_stats: {
        Row: {
          active_broadcast_count: number | null
          created_at: string | null
          description: string | null
          group_id: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          updated_at: string | null
        }
        Insert: {
          active_broadcast_count?: never
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          updated_at?: string | null
        }
        Update: {
          active_broadcast_count?: never
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "broadcast_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_broadcast_groups_with_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "v_unread_broadcasts_by_group"
            referencedColumns: ["group_id"]
          },
        ]
      }
      v_department_stats: {
        Row: {
          active_employee_count: number | null
          color: string | null
          department_id: string | null
          department_name: string | null
          employee_count: number | null
          role_count: number | null
          sub_department_count: number | null
        }
        Relationships: []
      }
      v_employee_full_details: {
        Row: {
          assignment_id: string | null
          department_id: string | null
          department_name: string | null
          email: string | null
          employee_code: string | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          first_name: string | null
          fte_percentage: number | null
          full_name: string | null
          hire_date: string | null
          hourly_rate_max: number | null
          hourly_rate_min: number | null
          id: string | null
          is_active: boolean | null
          is_primary: boolean | null
          last_name: string | null
          organization_id: string | null
          organization_name: string | null
          phone: string | null
          remuneration_level: string | null
          role_id: string | null
          role_level: number | null
          role_name: string | null
          sub_department_id: string | null
          sub_department_name: string | null
          system_role: Database["public"]["Enums"]["system_role"] | null
        }
        Relationships: []
      }
      v_roster_day_full: {
        Row: {
          applied_templates: Json | null
          assigned_count: number | null
          created_at: string | null
          date: string | null
          group_count: number | null
          groups: Json | null
          id: string | null
          locked_at: string | null
          locked_by: string | null
          notes: string | null
          organization_id: string | null
          shift_count: number | null
          status: Database["public"]["Enums"]["roster_day_status"] | null
          subgroup_count: number | null
          updated_at: string | null
        }
        Insert: {
          applied_templates?: never
          assigned_count?: never
          created_at?: string | null
          date?: string | null
          group_count?: never
          groups?: never
          id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          organization_id?: string | null
          shift_count?: never
          status?: Database["public"]["Enums"]["roster_day_status"] | null
          subgroup_count?: never
          updated_at?: string | null
        }
        Update: {
          applied_templates?: never
          assigned_count?: never
          created_at?: string | null
          date?: string | null
          group_count?: never
          groups?: never
          id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          organization_id?: string | null
          shift_count?: never
          status?: Database["public"]["Enums"]["roster_day_status"] | null
          subgroup_count?: never
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_days_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_days_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      v_template_full: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          end_date: string | null
          groups: Json | null
          id: string | null
          last_edited_by: string | null
          name: string | null
          organization_id: string | null
          published_at: string | null
          published_by: string | null
          published_month: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["template_status"] | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          groups?: never
          id?: string | null
          last_edited_by?: string | null
          name?: string | null
          organization_id?: string | null
          published_at?: string | null
          published_by?: string | null
          published_month?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["template_status"] | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          groups?: never
          id?: string | null
          last_edited_by?: string | null
          name?: string | null
          organization_id?: string | null
          published_at?: string | null
          published_by?: string | null
          published_month?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["template_status"] | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "v_employee_full_details"
            referencedColumns: ["id"]
          },
        ]
      }
      v_unread_broadcasts_by_group: {
        Row: {
          employee_id: string | null
          group_id: string | null
          has_pending_ack: boolean | null
          has_urgent_unread: boolean | null
          unread_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "group_participants_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acknowledge_broadcast: {
        Args: { broadcast_uuid: string; employee_uuid: string }
        Returns: boolean
      }
      add_roster_shift: {
        Args: {
          p_roster_subgroup_id: string
          p_shift_data: Json
          p_user_id: string
        }
        Returns: {
          error_message: string
          shift_id: string
          success: boolean
        }[]
      }
      apply_template_to_date_range: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_template_id: string
          p_user_id?: string
        }
        Returns: Json
      }
      archive_old_audit_events: { Args: never; Returns: undefined }
      assign_employee: {
        Args: {
          p_department_name: string
          p_is_primary?: boolean
          p_profile_id: string
          p_role_name?: string
          p_sub_department_name?: string
        }
        Returns: string
      }
      assign_employee_to_shift: {
        Args: {
          p_employee_id: string
          p_roster_shift_id: string
          p_user_id: string
        }
        Returns: {
          assignment_id: string
          error_message: string
          success: boolean
        }[]
      }
      auth_can_manage_rosters: { Args: never; Returns: boolean }
      auth_can_manage_templates: { Args: never; Returns: boolean }
      calculate_net_hours: {
        Args: {
          p_end_time: string
          p_start_time: string
          p_unpaid_break_minutes: number
        }
        Returns: number
      }
      calculate_shift_hours: {
        Args: {
          p_end_time: string
          p_paid_break_minutes: number
          p_start_time: string
          p_unpaid_break_minutes: number
        }
        Returns: {
          net_hours: number
          total_hours: number
        }[]
      }
      calculate_shift_length:
      | {
        Args: {
          p_end_time: string
          p_paid_break_minutes?: number
          p_start_time: string
          p_unpaid_break_minutes?: number
        }
        Returns: {
          net_length: number
          total_length: number
        }[]
      }
      | {
        Args: {
          p_end_time: string
          p_start_time: string
          p_unpaid_break_minutes?: number
        }
        Returns: number
      }
      calculate_suitability_score: {
        Args: { p_employee_id: string }
        Returns: number
      }
      calculate_weekly_hours: {
        Args: { p_employee_id: string; p_week_start_date: string }
        Returns: number
      }
      can_manage_templates: { Args: never; Returns: boolean }
      check_daily_hours_limit: {
        Args: {
          p_additional_hours: number
          p_date: string
          p_employee_id: string
        }
        Returns: boolean
      }
      check_monthly_hours_limit: {
        Args: {
          p_additional_hours: number
          p_date: string
          p_employee_id: string
        }
        Returns: boolean
      }
      check_rest_period: {
        Args: {
          p_employee_id: string
          p_end_time: string
          p_shift_date: string
          p_start_time: string
        }
        Returns: boolean
      }
      check_shift_overlap: {
        Args: {
          p_employee_id: string
          p_end_time: string
          p_exclude_shift_id?: string
          p_shift_date: string
          p_start_time: string
        }
        Returns: boolean
      }
      check_template_version: {
        Args: { p_expected_version: number; p_template_id: string }
        Returns: {
          current_version: number
          last_edited_at: string
          last_edited_by: string
          version_match: boolean
        }[]
      }
      create_profile_for_user: {
        Args: {
          p_employment_type?: Database["public"]["Enums"]["employment_type"]
          p_first_name?: string
          p_last_name?: string
          p_system_role?: Database["public"]["Enums"]["system_role"]
          p_user_id: string
        }
        Returns: string
      }
      ensure_shift_events_partitions: { Args: never; Returns: undefined }
      get_broadcast_ack_stats: {
        Args: { broadcast_uuid: string }
        Returns: {
          ack_percentage: number
          acknowledged_count: number
          pending_count: number
          total_recipients: number
        }[]
      }
      get_eligible_employees_for_shift: {
        Args: { p_shift_id: string }
        Returns: {
          current_weekly_hours: number
          employee_email: string
          employee_id: string
          employee_name: string
          has_availability: boolean
          has_required_skills: boolean
        }[]
      }
      get_my_department_ids: { Args: never; Returns: string[] }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["system_role"]
      }
      get_or_create_roster_day: {
        Args: { p_date: string; p_organization_id: string; p_user_id?: string }
        Returns: string
      }
      get_roster_days_in_range: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          assigned_count: number
          date: string
          has_template: boolean
          roster_day_id: string
          shift_count: number
          status: string
        }[]
      }
      get_shift_flags: { Args: { p_shift_id: string }; Returns: string[] }
      get_template_conflicts: {
        Args: {
          p_end_date: string
          p_exclude_template_id?: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          end_date: string
          id: string
          name: string
          start_date: string
          status: Database["public"]["Enums"]["template_status"]
        }[]
      }
      get_user_department_ids: { Args: never; Returns: string[] }
      get_user_role: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_manager_or_above: { Args: never; Returns: boolean }
      is_valid_uuid: { Args: { str: string }; Returns: boolean }
      mark_broadcast_read: {
        Args: { broadcast_uuid: string; employee_uuid: string }
        Returns: undefined
      }
      publish_template_range: {
        Args: {
          p_end_date: string
          p_expected_version?: number
          p_force_override?: boolean
          p_start_date: string
          p_template_id: string
          p_user_id: string
        }
        Returns: {
          error_message: string
          new_version: number
          roster_result: Json
          snapshot_id: string
          success: boolean
        }[]
      }
      safe_uuid: { Args: { str: string }; Returns: string }
      save_template_full: {
        Args: {
          p_description: string
          p_expected_version: number
          p_groups: Json
          p_name: string
          p_template_id: string
          p_user_id: string
        }
        Returns: {
          error_message: string
          new_version: number
          success: boolean
        }[]
      }
      set_batch_id: { Args: { batch_id: string }; Returns: undefined }
      set_roster_day_status: {
        Args: {
          p_roster_day_id: string
          p_status: Database["public"]["Enums"]["roster_day_status"]
          p_user_id: string
        }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      update_shift_lifecycle_status: { Args: never; Returns: undefined }
      user_has_delta_access: {
        Args: { check_user_id: string }
        Returns: boolean
      }
      user_has_gamma_access_for_subdept: {
        Args: { check_subdept_id: string; check_user_id: string }
        Returns: boolean
      }
      validate_rest_period: {
        Args: {
          p_employee_id: string
          p_end_time: string
          p_minimum_hours?: number
          p_shift_date: string
          p_start_time: string
        }
        Returns: boolean
      }
      validate_shift_swap: {
        Args: {
          p_employee_id: string
          p_shift_id: string
          p_swap_request_id: string
        }
        Returns: Json
      }
      validate_template_name: {
        Args: {
          p_exclude_id?: string
          p_name: string
          p_organization_id: string
        }
        Returns: {
          error_message: string
          is_valid: boolean
        }[]
      }
      check_in_shift: {
        Args: { p_shift_id: string; p_lat?: number; p_lon?: number }
        Returns: undefined
      }
      mark_shift_no_show: {
        Args: { p_shift_id: string }
        Returns: undefined
      }
      delete_shift_cascade: {
        Args: { p_shift_id: string }
        Returns: boolean
      }
      // V3 State Machine RPCs (Manually Added)
      sm_publish_shift: {
        Args: { p_shift_id: string }
        Returns: { success: boolean; new_status: string }
      }
      sm_unpublish_shift: {
        Args: { p_shift_id: string }
        Returns: { success: boolean; new_status: string }
      }
      sm_bulk_assign: {
        Args: { p_shift_ids: string[]; p_employee_id: string; p_assigned_by: string }
        Returns: { success: boolean; count: number }[]
      }
      sm_bulk_open_bidding: {
        Args: { p_shift_ids: string[]; p_open_at: string | null; p_close_at: string | null }
        Returns: { success: boolean; count: number }[]
      }
      sm_bulk_manager_cancel: {
        Args: { p_shift_ids: string[]; p_reason: string }
        Returns: { success: boolean; count: number }[]
      }
      sm_accept_offer: {
        Args: { p_shift_id: string }
        Returns: { success: boolean; message: string }
      }
      sm_reject_offer: {
        Args: { p_shift_id: string; p_reason: string }
        Returns: { success: boolean; message: string }
      }
      sm_close_bidding: {
        Args: { p_shift_id: string; p_reason: string }
        Returns: { success: boolean; new_status: string }
      }
      sm_manager_cancel: {
        Args: { p_shift_id: string; p_reason: string }
        Returns: { success: boolean; new_status: string }
      }
      sm_employee_cancel: {
        Args: { p_shift_id: string; p_reason: string }
        Returns: { success: boolean; new_status: string }
      }
      sm_select_bid_winner: {
        Args: { p_shift_id: string; p_bid_id: string }
        Returns: { success: boolean; new_status: string }
      }
      sm_emergency_assign: {
        Args: { p_shift_id: string; p_employee_id: string; p_reason: string; p_assigned_by: string }
        Returns: { success: boolean; new_status: string }
      }
      sm_request_trade: {
        Args: { p_shift_id: string; p_target_employee_id: string | null }
        Returns: { success: boolean; trade_id: string }
      }
      sm_accept_trade: {
        Args: { p_trade_id: string }
        Returns: { success: boolean }
      }
      sm_approve_trade: {
        Args: { p_trade_id: string }
        Returns: { success: boolean }
      }
      sm_reject_trade: {
        Args: { p_trade_id: string; p_reason: string }
        Returns: { success: boolean }
      }
      bulk_publish_shifts: {
        Args: { p_shift_ids: string[] }
        Returns: {
          success_count: number;
          failure_count: number;
          results: { id: string; status: 'success' | 'failed'; error?: string }[]
        }
      }
    }
    Enums: {
      access_level: "alpha" | "beta" | "gamma" | "delta"
      actor_type: "USER" | "SYSTEM"
      assignment_method: "manual" | "template" | "bid" | "trade" | "auto"
      assignment_status:
      | "assigned"
      | "confirmed"
      | "swapped"
      | "dropped"
      | "no_show"
      audit_action:
      | "create"
      | "update"
      | "delete"
      | "publish"
      | "unpublish"
      | "save"
      availability_type: "available" | "unavailable" | "preferred" | "limited"
      bid_status: "pending" | "accepted" | "rejected" | "withdrawn"
      bidding_priority: "normal" | "urgent" | "critical"
      broadcast_priority: "low" | "normal" | "high" | "urgent"
      broadcast_status: "draft" | "scheduled" | "sent" | "cancelled"
      cancellation_type: "standard" | "late" | "critical" | "no_show"
      compliance_status:
      | "compliant"
      | "warning"
      | "violation"
      | "pending"
      | "overridden"
      employment_type: "full_time" | "part_time" | "casual" | "contractual"
      event_source: "UI" | "API" | "AUTO_JOB" | "SYSTEM_RULE"
      lifecycle_status_enum:
      | "draft"
      | "scheduled"
      | "active"
      | "completed"
      | "cancelled"
      lock_reason: "published" | "timesheet" | "admin" | "payroll"
      notification_type:
      | "shift_assigned"
      | "shift_cancelled"
      | "shift_updated"
      | "swap_request"
      | "swap_approved"
      | "swap_rejected"
      | "bid_accepted"
      | "bid_rejected"
      | "broadcast"
      | "timesheet_approved"
      | "timesheet_rejected"
      | "general"
      roster_day_status: "draft" | "published" | "locked"
      roster_status: "draft" | "published" | "archived"
      shift_event_type:
      | "SHIFT_CREATED"
      | "SHIFT_GENERATED"
      | "SHIFT_GENERATION_FAILED"
      | "SHIFT_GROUP_CHANGED"
      | "SHIFT_SUBGROUP_CHANGED"
      | "SHIFT_ROLE_CHANGED"
      | "SHIFT_REQUIREMENTS_CHANGED"
      | "SHIFT_EVENT_TAGS_CHANGED"
      | "SHIFT_TIME_CHANGED"
      | "SHIFT_BREAKS_CHANGED"
      | "SHIFT_NET_LENGTH_RECALCULATED"
      | "SHIFT_ASSIGNED"
      | "SHIFT_UNASSIGNED"
      | "SHIFT_REASSIGNED"
      | "SHIFT_COMPLIANCE_CHECKED"
      | "SHIFT_COMPLIANCE_PASSED"
      | "SHIFT_COMPLIANCE_WARNING"
      | "SHIFT_COMPLIANCE_FAILED"
      | "SHIFT_COMPLIANCE_OVERRIDE_APPLIED"
      | "SHIFT_COMPLIANCE_OVERRIDE_REMOVED"
      | "SHIFT_BIDDING_OPENED"
      | "SHIFT_BIDDING_CLOSED"
      | "SHIFT_BID_PLACED"
      | "SHIFT_BID_WITHDRAWN"
      | "SHIFT_BID_SELECTED"
      | "SHIFT_BID_ACCEPTED"
      | "SHIFT_BID_REJECTED"
      | "SHIFT_TRADE_POSTED"
      | "SHIFT_TRADE_OFFER_PLACED"
      | "SHIFT_TRADE_APPROVED"
      | "SHIFT_TRADE_REJECTED"
      | "SHIFT_TRADE_CANCELLED"
      | "SHIFT_CANCELLED"
      | "SHIFT_CANCELLATION_REVERSED"
      | "SHIFT_STARTED"
      | "SHIFT_COMPLETED"
      | "SHIFT_PUBLISHED"
      | "SHIFT_LOCKED"
      | "SHIFT_UNLOCKED"
      | "SHIFT_VERSION_CONFLICT"
      | "SHIFT_DATA_CORRECTED"
      shift_status:
      | "open"
      | "assigned"
      | "confirmed"
      | "completed"
      | "cancelled"
      swap_status:
      | "pending"
      | "approved"
      | "rejected"
      | "cancelled"
      | "completed"
      system_role: "admin" | "manager" | "team_lead" | "team_member"
      template_group_type: "convention_centre" | "exhibition_centre" | "theatre"
      template_status: "draft" | "published" | "archived"
      timesheet_status: "draft" | "submitted" | "approved" | "rejected"
      shift_lifecycle: "Draft" | "Published" | "InProgress" | "Completed" | "Cancelled"
      shift_trading: "NoTrade" | "TradeRequested" | "TradeAccepted" | "TradeApproved"
      shift_assignment_outcome: "pending" | "offered" | "confirmed" | "emergency_assigned"
      shift_fulfillment_status: "scheduled" | "bidding" | "offered" | "none"
      shift_attendance_status: "unknown" | "checked_in" | "no_show" | "late" | "excused"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
  | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
  ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
    DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] &
    DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
  ? R
  : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I
  }
  ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Insert: infer I
  }
  ? I
  : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U
  }
  ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Update: infer U
  }
  ? U
  : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
  | keyof DefaultSchema["Enums"]
  | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
  : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
  | keyof DefaultSchema["CompositeTypes"]
  | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
  : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  public: {
    Enums: {
      access_level: ["alpha", "beta", "gamma", "delta"],
      actor_type: ["USER", "SYSTEM"],
      assignment_method: ["manual", "template", "bid", "trade", "auto"],
      assignment_status: [
        "assigned",
        "confirmed",
        "swapped",
        "dropped",
        "no_show",
      ],
      audit_action: [
        "create",
        "update",
        "delete",
        "publish",
        "unpublish",
        "save",
      ],
      availability_type: ["available", "unavailable", "preferred", "limited"],
      bid_status: ["pending", "accepted", "rejected", "withdrawn"],
      bidding_priority: ["normal", "urgent", "critical"],
      broadcast_priority: ["low", "normal", "high", "urgent"],
      broadcast_status: ["draft", "scheduled", "sent", "cancelled"],
      cancellation_type: ["standard", "late", "critical", "no_show"],
      compliance_status: [
        "compliant",
        "warning",
        "violation",
        "pending",
        "overridden",
      ],
      employment_type: ["full_time", "part_time", "casual", "contractual"],
      event_source: ["UI", "API", "AUTO_JOB", "SYSTEM_RULE"],
      lifecycle_status_enum: [
        "draft",
        "scheduled",
        "active",
        "completed",
        "cancelled",
      ],
      lock_reason: ["published", "timesheet", "admin", "payroll"],
      notification_type: [
        "shift_assigned",
        "shift_cancelled",
        "shift_updated",
        "swap_request",
        "swap_approved",
        "swap_rejected",
        "bid_accepted",
        "bid_rejected",
        "broadcast",
        "timesheet_approved",
        "timesheet_rejected",
        "general",
      ],
      roster_day_status: ["draft", "published", "locked"],
      roster_status: ["draft", "published", "archived"],
      shift_event_type: [
        "SHIFT_CREATED",
        "SHIFT_GENERATED",
        "SHIFT_GENERATION_FAILED",
        "SHIFT_GROUP_CHANGED",
        "SHIFT_SUBGROUP_CHANGED",
        "SHIFT_ROLE_CHANGED",
        "SHIFT_REQUIREMENTS_CHANGED",
        "SHIFT_EVENT_TAGS_CHANGED",
        "SHIFT_TIME_CHANGED",
        "SHIFT_BREAKS_CHANGED",
        "SHIFT_NET_LENGTH_RECALCULATED",
        "SHIFT_ASSIGNED",
        "SHIFT_UNASSIGNED",
        "SHIFT_REASSIGNED",
        "SHIFT_COMPLIANCE_CHECKED",
        "SHIFT_COMPLIANCE_PASSED",
        "SHIFT_COMPLIANCE_WARNING",
        "SHIFT_COMPLIANCE_FAILED",
        "SHIFT_COMPLIANCE_OVERRIDE_APPLIED",
        "SHIFT_COMPLIANCE_OVERRIDE_REMOVED",
        "SHIFT_BIDDING_OPENED",
        "SHIFT_BIDDING_CLOSED",
        "SHIFT_BID_PLACED",
        "SHIFT_BID_WITHDRAWN",
        "SHIFT_BID_SELECTED",
        "SHIFT_BID_ACCEPTED",
        "SHIFT_BID_REJECTED",
        "SHIFT_TRADE_POSTED",
        "SHIFT_TRADE_OFFER_PLACED",
        "SHIFT_TRADE_APPROVED",
        "SHIFT_TRADE_REJECTED",
        "SHIFT_TRADE_CANCELLED",
        "SHIFT_CANCELLED",
        "SHIFT_CANCELLATION_REVERSED",
        "SHIFT_STARTED",
        "SHIFT_COMPLETED",
        "SHIFT_PUBLISHED",
        "SHIFT_LOCKED",
        "SHIFT_UNLOCKED",
        "SHIFT_VERSION_CONFLICT",
        "SHIFT_DATA_CORRECTED",
      ],
      shift_status: ["open", "assigned", "confirmed", "completed", "cancelled"],
      swap_status: [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "completed",
      ],
      system_role: ["admin", "manager", "team_lead", "team_member"],
      template_group_type: [
        "convention_centre",
        "exhibition_centre",
        "theatre",
      ],
      template_status: ["draft", "published", "archived"],
      timesheet_status: ["draft", "submitted", "approved", "rejected"],
      shift_lifecycle: ["Draft", "Published", "InProgress", "Completed", "Cancelled"],
      shift_trading: ["NoTrade", "TradeRequested", "TradeAccepted", "TradeApproved"],
      shift_assignment_outcome: ["pending", "offered", "confirmed", "emergency_assigned"],
      shift_attendance_status: ["unknown", "checked_in", "no_show", "late", "excused"],
    },
  },
} as const
