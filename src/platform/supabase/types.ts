// =============================================================================
// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Regenerate with:  npm run db:types
//
// Every edit made here is silently reverted by the next regeneration, and in
// the meantime the type checker is asserting things about the database that
// are not true. If a type here is wrong, the schema is what needs changing.
// =============================================================================

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
      access_certificate_events: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          certificate_id: string
          id: number
          occurred_at: string
          organization_id: string | null
          subject_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          certificate_id: string
          id?: never
          occurred_at?: string
          organization_id?: string | null
          subject_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          certificate_id?: string
          id?: never
          occurred_at?: string
          organization_id?: string | null
          subject_id?: string
        }
        Relationships: []
      }
      allowed_locations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          lat: number
          lng: number
          name: string
          org_id: string
          radius_m: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          lat: number
          lng: number
          name: string
          org_id: string
          radius_m?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          lat?: number
          lng?: number
          name?: string
          org_id?: string
          radius_m?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "allowed_locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      app_access_certificates: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"]
          certificate_type: string
          contract_id: string
          created_at: string | null
          created_by: string | null
          department_id: string | null
          id: string
          is_active: boolean
          organization_id: string | null
          sub_department_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_level: Database["public"]["Enums"]["access_level"]
          certificate_type?: string
          contract_id: string
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["access_level"]
          certificate_type?: string
          contract_id?: string
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_access_certificates_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: true
            referencedRelation: "user_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_access_certificates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_access_certificates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_access_certificates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_access_certificates_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_access_certificates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_snapshots: {
        Row: {
          attended: boolean
          auto_clock_out: boolean
          became_active_at: string
          department_id: string | null
          early_in: boolean
          early_out: boolean
          employee_id: string
          end_reason: string | null
          ended_at: string | null
          episode_seq: number
          id: string
          is_current: boolean
          late_in: boolean
          late_out: boolean
          on_time_in: boolean
          on_time_out: boolean
          organization_id: string | null
          refreshed_at: string
          scheduled_start: string | null
          shift_date: string | null
          shift_id: string
          source: string
          sub_department_id: string | null
        }
        Insert: {
          attended?: boolean
          auto_clock_out?: boolean
          became_active_at: string
          department_id?: string | null
          early_in?: boolean
          early_out?: boolean
          employee_id: string
          end_reason?: string | null
          ended_at?: string | null
          episode_seq: number
          id?: string
          is_current?: boolean
          late_in?: boolean
          late_out?: boolean
          on_time_in?: boolean
          on_time_out?: boolean
          organization_id?: string | null
          refreshed_at?: string
          scheduled_start?: string | null
          shift_date?: string | null
          shift_id: string
          source: string
          sub_department_id?: string | null
        }
        Update: {
          attended?: boolean
          auto_clock_out?: boolean
          became_active_at?: string
          department_id?: string | null
          early_in?: boolean
          early_out?: boolean
          employee_id?: string
          end_reason?: string | null
          ended_at?: string | null
          episode_seq?: number
          id?: string
          is_current?: boolean
          late_in?: boolean
          late_out?: boolean
          on_time_in?: boolean
          on_time_out?: boolean
          organization_id?: string | null
          refreshed_at?: string
          scheduled_start?: string | null
          shift_date?: string | null
          shift_id?: string
          source?: string
          sub_department_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignment_snapshots_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
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
          status: string | null
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
          status?: string | null
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
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      autoschedule_assignments: {
        Row: {
          committed_at: string | null
          created_at: string | null
          employee_id: string
          id: string
          session_id: string
          shift_id: string
          status: string
        }
        Insert: {
          committed_at?: string | null
          created_at?: string | null
          employee_id: string
          id?: string
          session_id: string
          shift_id: string
          status?: string
        }
        Update: {
          committed_at?: string | null
          created_at?: string | null
          employee_id?: string
          id?: string
          session_id?: string
          shift_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "autoschedule_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autoschedule_assignments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "autoschedule_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autoschedule_assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      autoschedule_sessions: {
        Row: {
          created_at: string | null
          created_by: string | null
          date_end: string
          date_start: string
          department_id: string | null
          id: string
          organization_id: string
          scope: string
          selected_shift_ids: Json
          simulation_result: Json | null
          snapshot_version: string
          soft_constraints: Json
          solver_hash: string | null
          status: string
          strategy: string
          sub_department_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          date_end: string
          date_start: string
          department_id?: string | null
          id?: string
          organization_id: string
          scope?: string
          selected_shift_ids?: Json
          simulation_result?: Json | null
          snapshot_version: string
          soft_constraints?: Json
          solver_hash?: string | null
          status?: string
          strategy?: string
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          date_end?: string
          date_start?: string
          department_id?: string | null
          id?: string
          organization_id?: string
          scope?: string
          selected_shift_ids?: Json
          simulation_result?: Json | null
          snapshot_version?: string
          soft_constraints?: Json
          solver_hash?: string | null
          status?: string
          strategy?: string
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autoschedule_sessions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autoschedule_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autoschedule_sessions_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
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
            foreignKeyName: "availabilities_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_exceptions: {
        Row: {
          created_at: string
          created_by: string | null
          end_time: string
          exception_date: string | null
          id: string
          profile_id: string
          reason: string | null
          severity: string
          start_time: string
          sub_department_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_time: string
          exception_date?: string | null
          id?: string
          profile_id: string
          reason?: string | null
          severity?: string
          start_time: string
          sub_department_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_time?: string
          exception_date?: string | null
          id?: string
          profile_id?: string
          reason?: string | null
          severity?: string
          start_time?: string
          sub_department_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exceptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exceptions_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_requests: {
        Row: {
          cancelled_at: string | null
          created_at: string
          id: string
          note: string | null
          period_end: string
          period_start: string
          profile_id: string
          requested_by: string
          responded_at: string | null
          responded_rule_id: string | null
          status: string
          sub_department_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          period_end: string
          period_start: string
          profile_id: string
          requested_by: string
          responded_at?: string | null
          responded_rule_id?: string | null
          status?: string
          sub_department_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          period_end?: string
          period_start?: string
          profile_id?: string
          requested_by?: string
          responded_at?: string | null
          responded_rule_id?: string | null
          status?: string
          sub_department_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_requests_responded_rule_id_fkey"
            columns: ["responded_rule_id"]
            isOneToOne: false
            referencedRelation: "availability_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_requests_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          created_at: string | null
          end_time: string
          id: string
          profile_id: string
          repeat_days: number[] | null
          repeat_end_date: string | null
          repeat_type: string
          start_date: string
          start_time: string
          sub_department_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          end_time: string
          id?: string
          profile_id: string
          repeat_days?: number[] | null
          repeat_end_date?: string | null
          repeat_type?: string
          start_date: string
          start_time: string
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          end_time?: string
          id?: string
          profile_id?: string
          repeat_days?: number[] | null
          repeat_end_date?: string | null
          repeat_type?: string
          start_date?: string
          start_time?: string
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules_archive: {
        Row: {
          archived_at: string
          archived_reason: string
          created_at: string | null
          end_time: string
          id: string
          profile_id: string
          repeat_days: number[] | null
          repeat_end_date: string | null
          repeat_type: string
          start_date: string
          start_time: string
          sub_department_id: string | null
          updated_at: string | null
        }
        Insert: {
          archived_at?: string
          archived_reason?: string
          created_at?: string | null
          end_time: string
          id: string
          profile_id: string
          repeat_days?: number[] | null
          repeat_end_date?: string | null
          repeat_type: string
          start_date: string
          start_time: string
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Update: {
          archived_at?: string
          archived_reason?: string
          created_at?: string | null
          end_time?: string
          id?: string
          profile_id?: string
          repeat_days?: number[] | null
          repeat_end_date?: string | null
          repeat_type?: string
          start_date?: string
          start_time?: string
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      availability_slots: {
        Row: {
          created_at: string | null
          end_time: string
          id: string
          profile_id: string
          rule_id: string | null
          slot_date: string
          source: string
          start_time: string
          sub_department_id: string | null
        }
        Insert: {
          created_at?: string | null
          end_time: string
          id?: string
          profile_id: string
          rule_id?: string | null
          slot_date: string
          source?: string
          start_time: string
          sub_department_id?: string | null
        }
        Update: {
          created_at?: string | null
          end_time?: string
          id?: string
          profile_id?: string
          rule_id?: string | null
          slot_date?: string
          source?: string
          start_time?: string
          sub_department_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_slots_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "availability_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_slots_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_slots_archive: {
        Row: {
          archived_at: string
          archived_reason: string
          created_at: string | null
          end_time: string
          id: string
          profile_id: string
          rule_id: string | null
          slot_date: string
          source: string
          start_time: string
          sub_department_id: string | null
        }
        Insert: {
          archived_at?: string
          archived_reason?: string
          created_at?: string | null
          end_time: string
          id: string
          profile_id: string
          rule_id?: string | null
          slot_date: string
          source: string
          start_time: string
          sub_department_id?: string | null
        }
        Update: {
          archived_at?: string
          archived_reason?: string
          created_at?: string | null
          end_time?: string
          id?: string
          profile_id?: string
          rule_id?: string | null
          slot_date?: string
          source?: string
          start_time?: string
          sub_department_id?: string | null
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: [
          {
            foreignKeyName: "broadcast_attachments_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
          sub_department_id: string | null
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
          organization_id?: string | null
          sub_department_id?: string | null
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
          organization_id?: string | null
          sub_department_id?: string | null
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
            foreignKeyName: "broadcast_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_groups_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
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
        Relationships: []
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
        Relationships: []
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
            foreignKeyName: "broadcasts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "broadcasts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "cancellation_history_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_reasons: {
        Row: {
          code: string
          created_at: string
          description: string | null
          is_active: boolean
          label: string
          requires_note: boolean
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          label: string
          requires_note?: boolean
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          label?: string
          requires_note?: boolean
          sort_order?: number
        }
        Relationships: []
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
        ]
      }
      compliance_rejections: {
        Row: {
          affected_shifts: string[]
          bypassed: boolean
          calculation: Json | null
          created_at: string
          details: string | null
          employee_id: string
          id: string
          mode: string
          operation_type: string
          rule_id: string
          rule_status: string
          stage: string | null
          summary: string
          user_id: string | null
        }
        Insert: {
          affected_shifts?: string[]
          bypassed?: boolean
          calculation?: Json | null
          created_at?: string
          details?: string | null
          employee_id: string
          id?: string
          mode: string
          operation_type: string
          rule_id: string
          rule_status: string
          stage?: string | null
          summary: string
          user_id?: string | null
        }
        Update: {
          affected_shifts?: string[]
          bypassed?: boolean
          calculation?: Json | null
          created_at?: string
          details?: string | null
          employee_id?: string
          id?: string
          mode?: string
          operation_type?: string
          rule_id?: string
          rule_status?: string
          stage?: string | null
          summary?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_rejections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      demand_forecasts: {
        Row: {
          corrected_count: number | null
          correction_factor: number | null
          created_at: string | null
          event_id: string | null
          feature_payload: Json | null
          id: string
          is_locked: boolean | null
          model_version: string | null
          predicted_count: number
          role: string | null
          role_id: string | null
          scenario_id: string | null
          source: string | null
          synthesis_run_id: string | null
          time_slot: number | null
          version: number
        }
        Insert: {
          corrected_count?: number | null
          correction_factor?: number | null
          created_at?: string | null
          event_id?: string | null
          feature_payload?: Json | null
          id?: string
          is_locked?: boolean | null
          model_version?: string | null
          predicted_count?: number
          role?: string | null
          role_id?: string | null
          scenario_id?: string | null
          source?: string | null
          synthesis_run_id?: string | null
          time_slot?: number | null
          version?: number
        }
        Update: {
          corrected_count?: number | null
          correction_factor?: number | null
          created_at?: string | null
          event_id?: string | null
          feature_payload?: Json | null
          id?: string
          is_locked?: boolean | null
          model_version?: string | null
          predicted_count?: number
          role?: string | null
          role_id?: string | null
          scenario_id?: string | null
          source?: string | null
          synthesis_run_id?: string | null
          time_slot?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "demand_forecasts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "demand_forecasts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_forecasts_synthesis_run_id_fkey"
            columns: ["synthesis_run_id"]
            isOneToOne: false
            referencedRelation: "synthesis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      demand_rules: {
        Row: {
          applies_when: Json
          created_at: string
          created_by: string | null
          formula: string
          function_code: string
          id: string
          is_active: boolean
          level: number
          notes: string | null
          priority: number
          rule_code: string
          updated_at: string
          version: number
        }
        Insert: {
          applies_when?: Json
          created_at?: string
          created_by?: string | null
          formula: string
          function_code: string
          id?: string
          is_active?: boolean
          level: number
          notes?: string | null
          priority?: number
          rule_code: string
          updated_at?: string
          version?: number
        }
        Update: {
          applies_when?: Json
          created_at?: string
          created_by?: string | null
          formula?: string
          function_code?: string
          id?: string
          is_active?: boolean
          level?: number
          notes?: string | null
          priority?: number
          rule_code?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      demand_templates: {
        Row: {
          cluster_key: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_seeded: boolean
          shifts: Json
          source_event_ids: string[]
          superseded_by: string | null
          template_code: string
          updated_at: string
        }
        Insert: {
          cluster_key: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_seeded?: boolean
          shifts: Json
          source_event_ids?: string[]
          superseded_by?: string | null
          template_code: string
          updated_at?: string
        }
        Update: {
          cluster_key?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_seeded?: boolean
          shifts?: Json
          source_event_ids?: string[]
          superseded_by?: string | null
          template_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demand_templates_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "demand_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      demand_tensor: {
        Row: {
          baseline: number
          binding_constraint: string | null
          coverage_confidence: number | null
          created_at: string
          demand_buffer: number | null
          event_id: string | null
          execution_timestamp: string
          explanation: Json
          feedback_multiplier_used: number
          function_code: string
          headcount: number
          id: string
          level: number
          rule_version_id: string | null
          service_level: number | null
          slice_idx: number
          synthesis_run_id: string | null
          timecard_ratio_used: number
        }
        Insert: {
          baseline: number
          binding_constraint?: string | null
          coverage_confidence?: number | null
          created_at?: string
          demand_buffer?: number | null
          event_id?: string | null
          execution_timestamp?: string
          explanation?: Json
          feedback_multiplier_used?: number
          function_code: string
          headcount: number
          id?: string
          level: number
          rule_version_id?: string | null
          service_level?: number | null
          slice_idx: number
          synthesis_run_id?: string | null
          timecard_ratio_used?: number
        }
        Update: {
          baseline?: number
          binding_constraint?: string | null
          coverage_confidence?: number | null
          created_at?: string
          demand_buffer?: number | null
          event_id?: string | null
          execution_timestamp?: string
          explanation?: Json
          feedback_multiplier_used?: number
          function_code?: string
          headcount?: number
          id?: string
          level?: number
          rule_version_id?: string | null
          service_level?: number | null
          slice_idx?: number
          synthesis_run_id?: string | null
          timecard_ratio_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "demand_tensor_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "demand_tensor_synthesis_run_id_fkey"
            columns: ["synthesis_run_id"]
            isOneToOne: false
            referencedRelation: "synthesis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      department_budgets: {
        Row: {
          budgeted_cost: number | null
          budgeted_hours: number | null
          created_at: string
          created_by: string | null
          currency: string
          dept_id: string
          id: string
          period_end: string
          period_start: string
          updated_at: string
        }
        Insert: {
          budgeted_cost?: number | null
          budgeted_hours?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          dept_id: string
          id?: string
          period_end: string
          period_start: string
          updated_at?: string
        }
        Update: {
          budgeted_cost?: number | null
          budgeted_hours?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          dept_id?: string
          id?: string
          period_end?: string
          period_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_budgets_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
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
        ]
      }
      device_push_tokens: {
        Row: {
          created_at: string
          disabled_at: string | null
          id: string
          last_seen_at: string
          platform: string
          profile_id: string
          token: string
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          id?: string
          last_seen_at?: string
          platform?: string
          profile_id: string
          token: string
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          id?: string
          last_seen_at?: string
          platform?: string
          profile_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_push_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      eba_allowance: {
        Row: {
          amount: number
          code: string
          created_at: string
          effective_from: string
          id: string
          source: string | null
          unit: string
        }
        Insert: {
          amount: number
          code: string
          created_at?: string
          effective_from: string
          id?: string
          source?: string | null
          unit: string
        }
        Update: {
          amount?: number
          code?: string
          created_at?: string
          effective_from?: string
          id?: string
          source?: string | null
          unit?: string
        }
        Relationships: []
      }
      eba_rate: {
        Row: {
          classification: string
          created_at: string
          effective_from: string
          employment_basis: string
          id: string
          ordinary_hourly_rate: number
          paid_hourly_rate: number
          source: string | null
        }
        Insert: {
          classification: string
          created_at?: string
          effective_from: string
          employment_basis: string
          id?: string
          ordinary_hourly_rate: number
          paid_hourly_rate: number
          source?: string | null
        }
        Update: {
          classification?: string
          created_at?: string
          effective_from?: string
          employment_basis?: string
          id?: string
          ordinary_hourly_rate?: number
          paid_hourly_rate?: number
          source?: string | null
        }
        Relationships: []
      }
      eba_trainee_schedule: {
        Row: {
          created_at: string
          effective_from: string
          label: string | null
          matrix: Json
          source: string | null
        }
        Insert: {
          created_at?: string
          effective_from: string
          label?: string | null
          matrix: Json
          source?: string | null
        }
        Update: {
          created_at?: string
          effective_from?: string
          label?: string | null
          matrix?: Json
          source?: string | null
        }
        Relationships: []
      }
      employee_licenses: {
        Row: {
          created_at: string | null
          employee_id: string
          expiration_date: string | null
          has_restricted_work_limit: boolean | null
          id: string
          issue_date: string | null
          last_checked_at: string | null
          license_id: string
          license_type: string | null
          status: string | null
          updated_at: string | null
          verification_metadata: Json | null
          verification_status: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          expiration_date?: string | null
          has_restricted_work_limit?: boolean | null
          id?: string
          issue_date?: string | null
          last_checked_at?: string | null
          license_id: string
          license_type?: string | null
          status?: string | null
          updated_at?: string | null
          verification_metadata?: Json | null
          verification_status?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          expiration_date?: string | null
          has_restricted_work_limit?: boolean | null
          id?: string
          issue_date?: string | null
          last_checked_at?: string | null
          license_id?: string
          license_type?: string | null
          status?: string | null
          updated_at?: string | null
          verification_metadata?: Json | null
          verification_status?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_licenses_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_licenses_profile_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_performance_metrics: {
        Row: {
          acceptance_rate: number | null
          al_accrual_ratio: number | null
          al_utilization_ratio: number | null
          attendance_rate: number | null
          auto_clock_out_rate: number
          auto_clock_outs: number
          calculated_at: string | null
          cancellation_rate_late: number | null
          cancellation_rate_standard: number | null
          created_at: string | null
          early_clock_in_rate: number
          early_clock_ins: number
          early_clock_out_rate: number | null
          early_clock_outs: number | null
          emergency_assignments: number | null
          employee_id: string
          id: string
          is_locked: boolean | null
          late_cancellations: number | null
          late_clock_in_rate: number | null
          late_clock_ins: number | null
          late_clock_out_rate: number
          late_clock_outs: number
          metric_version: number | null
          no_show_rate: number | null
          no_shows: number | null
          offer_expiration_rate: number | null
          offer_expirations: number | null
          on_time_in: number
          on_time_in_rate: number
          on_time_out: number
          on_time_out_rate: number
          period_end: string
          period_start: string
          punctuality_rate: number | null
          quarter_year: string
          rejection_rate: number | null
          reliability_score: number | null
          shifts_accepted: number | null
          shifts_assigned: number | null
          shifts_offered: number | null
          shifts_rejected: number | null
          shifts_swapped: number | null
          shifts_worked: number | null
          standard_cancellations: number | null
          swap_ratio: number | null
          updated_at: string | null
        }
        Insert: {
          acceptance_rate?: number | null
          al_accrual_ratio?: number | null
          al_utilization_ratio?: number | null
          attendance_rate?: number | null
          auto_clock_out_rate?: number
          auto_clock_outs?: number
          calculated_at?: string | null
          cancellation_rate_late?: number | null
          cancellation_rate_standard?: number | null
          created_at?: string | null
          early_clock_in_rate?: number
          early_clock_ins?: number
          early_clock_out_rate?: number | null
          early_clock_outs?: number | null
          emergency_assignments?: number | null
          employee_id: string
          id?: string
          is_locked?: boolean | null
          late_cancellations?: number | null
          late_clock_in_rate?: number | null
          late_clock_ins?: number | null
          late_clock_out_rate?: number
          late_clock_outs?: number
          metric_version?: number | null
          no_show_rate?: number | null
          no_shows?: number | null
          offer_expiration_rate?: number | null
          offer_expirations?: number | null
          on_time_in?: number
          on_time_in_rate?: number
          on_time_out?: number
          on_time_out_rate?: number
          period_end: string
          period_start: string
          punctuality_rate?: number | null
          quarter_year: string
          rejection_rate?: number | null
          reliability_score?: number | null
          shifts_accepted?: number | null
          shifts_assigned?: number | null
          shifts_offered?: number | null
          shifts_rejected?: number | null
          shifts_swapped?: number | null
          shifts_worked?: number | null
          standard_cancellations?: number | null
          swap_ratio?: number | null
          updated_at?: string | null
        }
        Update: {
          acceptance_rate?: number | null
          al_accrual_ratio?: number | null
          al_utilization_ratio?: number | null
          attendance_rate?: number | null
          auto_clock_out_rate?: number
          auto_clock_outs?: number
          calculated_at?: string | null
          cancellation_rate_late?: number | null
          cancellation_rate_standard?: number | null
          created_at?: string | null
          early_clock_in_rate?: number
          early_clock_ins?: number
          early_clock_out_rate?: number | null
          early_clock_outs?: number | null
          emergency_assignments?: number | null
          employee_id?: string
          id?: string
          is_locked?: boolean | null
          late_cancellations?: number | null
          late_clock_in_rate?: number | null
          late_clock_ins?: number | null
          late_clock_out_rate?: number
          late_clock_outs?: number
          metric_version?: number | null
          no_show_rate?: number | null
          no_shows?: number | null
          offer_expiration_rate?: number | null
          offer_expirations?: number | null
          on_time_in?: number
          on_time_in_rate?: number
          on_time_out?: number
          on_time_out_rate?: number
          period_end?: string
          period_start?: string
          punctuality_rate?: number | null
          quarter_year?: string
          rejection_rate?: number | null
          reliability_score?: number | null
          shifts_accepted?: number | null
          shifts_assigned?: number | null
          shifts_offered?: number | null
          shifts_rejected?: number | null
          shifts_swapped?: number | null
          shifts_worked?: number | null
          standard_cancellations?: number | null
          swap_ratio?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_performance_metrics_profile_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_performance_snapshots: {
        Row: {
          acceptance_rate: number | null
          cancel_rate: number | null
          captured_at: string | null
          employee_id: string
          id: string
          no_show_rate: number | null
          reliability_score: number | null
          window_days: number
        }
        Insert: {
          acceptance_rate?: number | null
          cancel_rate?: number | null
          captured_at?: string | null
          employee_id: string
          id?: string
          no_show_rate?: number | null
          reliability_score?: number | null
          window_days: number
        }
        Update: {
          acceptance_rate?: number | null
          cancel_rate?: number | null
          captured_at?: string | null
          employee_id?: string
          id?: string
          no_show_rate?: number | null
          reliability_score?: number | null
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_performance_snapshots_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_skills: {
        Row: {
          created_at: string | null
          employee_id: string | null
          expiration_date: string | null
          id: string
          issue_date: string | null
          notes: string | null
          proficiency_level: string | null
          skill_id: string | null
          status: string | null
          updated_at: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id?: string | null
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          notes?: string | null
          proficiency_level?: string | null
          skill_id?: string | null
          status?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string | null
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          notes?: string | null
          proficiency_level?: string | null
          skill_id?: string | null
          status?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_skills_profile_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
      fairness_ledger: {
        Row: {
          debt: number
          employee_id: string
          id: string
          last_updated_at: string
          metric: string
          organization_id: string
          rolling_value: number
          team_average: number
          updated_by_run: string | null
          window_end: string
          window_start: string
        }
        Insert: {
          debt?: number
          employee_id: string
          id?: string
          last_updated_at?: string
          metric: string
          organization_id: string
          rolling_value?: number
          team_average?: number
          updated_by_run?: string | null
          window_end: string
          window_start: string
        }
        Update: {
          debt?: number
          employee_id?: string
          id?: string
          last_updated_at?: string
          metric?: string
          organization_id?: string
          rolling_value?: number
          team_average?: number
          updated_by_run?: string | null
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      first_aid_appointments: {
        Row: {
          appointed_by: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          employee_id: string
          id: string
          notes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          appointed_by?: string | null
          created_at?: string
          effective_from: string
          effective_to?: string | null
          employee_id: string
          id?: string
          notes?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          appointed_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "first_aid_appointments_appointed_by_fkey"
            columns: ["appointed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "first_aid_appointments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "first_aid_appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      function_map: {
        Row: {
          created_at: string
          function_code: string
          sub_department_id: string
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          function_code: string
          sub_department_id: string
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          function_code?: string
          sub_department_id?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "function_map_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      gross_pay_records: {
        Row: {
          computed_at: string
          computed_by: string | null
          created_at: string
          employee_id: string
          gross_pay: number
          id: string
          lines: Json
          paid_hours: number
          pay_period_id: string
          period_end_date: string
          period_start_date: string
          shift_count: number
          source: string
          source_shift_payroll_record_ids: string[]
          status: string
          updated_at: string
        }
        Insert: {
          computed_at?: string
          computed_by?: string | null
          created_at?: string
          employee_id: string
          gross_pay?: number
          id?: string
          lines?: Json
          paid_hours?: number
          pay_period_id: string
          period_end_date: string
          period_start_date: string
          shift_count?: number
          source?: string
          source_shift_payroll_record_ids?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          computed_at?: string
          computed_by?: string | null
          created_at?: string
          employee_id?: string
          gross_pay?: number
          id?: string
          lines?: Json
          paid_hours?: number
          pay_period_id?: string
          period_end_date?: string
          period_start_date?: string
          shift_count?: number
          source?: string
          source_shift_payroll_record_ids?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gross_pay_records_computed_by_fkey"
            columns: ["computed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gross_pay_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gross_pay_records_pay_period_id_fkey"
            columns: ["pay_period_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "profiles"
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
        ]
      }
      labor_correction_factors: {
        Row: {
          correction_factor: number
          event_type: string
          id: string
          last_updated: string
          role: string
        }
        Insert: {
          correction_factor?: number
          event_type: string
          id?: string
          last_updated?: string
          role: string
        }
        Update: {
          correction_factor?: number
          event_type?: string
          id?: string
          last_updated?: string
          role?: string
        }
        Relationships: []
      }
      leave_balances: {
        Row: {
          accrued_hours: number
          as_of_date: string
          balance_hours: number
          created_at: string | null
          employee_id: string
          id: string
          leave_type: string
          updated_at: string | null
          used_hours: number
        }
        Insert: {
          accrued_hours?: number
          as_of_date?: string
          balance_hours?: number
          created_at?: string | null
          employee_id: string
          id?: string
          leave_type: string
          updated_at?: string | null
          used_hours?: number
        }
        Update: {
          accrued_hours?: number
          as_of_date?: string
          balance_hours?: number
          created_at?: string | null
          employee_id?: string
          id?: string
          leave_type?: string
          updated_at?: string | null
          used_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          approval_date: string | null
          approved_by: string | null
          certificate_url: string | null
          created_at: string | null
          election_mode: string | null
          employee_id: string
          end_date: string
          id: string
          leave_type: string
          reason: string | null
          rejection_reason: string | null
          requested_hours: number | null
          start_date: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          approval_date?: string | null
          approved_by?: string | null
          certificate_url?: string | null
          created_at?: string | null
          election_mode?: string | null
          employee_id: string
          end_date: string
          id?: string
          leave_type: string
          reason?: string | null
          rejection_reason?: string | null
          requested_hours?: number | null
          start_date: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          approval_date?: string | null
          approved_by?: string | null
          certificate_url?: string | null
          created_at?: string | null
          election_mode?: string | null
          employee_id?: string
          end_date?: string
          id?: string
          leave_type?: string
          reason?: string | null
          rejection_reason?: string | null
          requested_hours?: number | null
          start_date?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
          requires_expiration: boolean | null
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
          requires_expiration?: boolean | null
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
          requires_expiration?: boolean | null
          updated_at?: string | null
          validity_period_months?: number | null
        }
        Relationships: []
      }
      ml_prediction_log: {
        Row: {
          corrected: number
          correction_factor: number
          created_at: string
          endpoint: string
          event_id: string | null
          feature_payload: Json
          id: string
          is_preview: boolean
          latency_ms: number | null
          model_version: string
          predicted: number
          request_id: string
          role: string
          scenario_id: string | null
          synthesis_run_id: string | null
        }
        Insert: {
          corrected: number
          correction_factor?: number
          created_at?: string
          endpoint: string
          event_id?: string | null
          feature_payload: Json
          id?: string
          is_preview: boolean
          latency_ms?: number | null
          model_version: string
          predicted: number
          request_id: string
          role: string
          scenario_id?: string | null
          synthesis_run_id?: string | null
        }
        Update: {
          corrected?: number
          correction_factor?: number
          created_at?: string
          endpoint?: string
          event_id?: string | null
          feature_payload?: Json
          id?: string
          is_preview?: boolean
          latency_ms?: number | null
          model_version?: string
          predicted?: number
          request_id?: string
          role?: string
          scenario_id?: string | null
          synthesis_run_id?: string | null
        }
        Relationships: []
      }
      model_manifests: {
        Row: {
          encoders_hash: string | null
          encoders_version: string | null
          file_hashes: Json
          id: string
          is_active: boolean
          manifest_id: string
          models: Json
          notes: string | null
          registered_at: string
          registered_by: string | null
        }
        Insert: {
          encoders_hash?: string | null
          encoders_version?: string | null
          file_hashes: Json
          id?: string
          is_active?: boolean
          manifest_id: string
          models: Json
          notes?: string | null
          registered_at?: string
          registered_by?: string | null
        }
        Update: {
          encoders_hash?: string | null
          encoders_version?: string | null
          file_hashes?: Json
          id?: string
          is_active?: boolean
          manifest_id?: string
          models?: Json
          notes?: string | null
          registered_at?: string
          registered_by?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          dedup_key: string | null
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
          dedup_key?: string | null
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
          dedup_key?: string | null
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
        ]
      }
      organizations: {
        Row: {
          address: string | null
          branding: Json | null
          code: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          jurisdiction: string
          logo_url: string | null
          name: string
          phone: string | null
          updated_at: string | null
          venue_lat: number | null
          venue_lon: number | null
          website: string | null
        }
        Insert: {
          address?: string | null
          branding?: Json | null
          code?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          jurisdiction?: string
          logo_url?: string | null
          name: string
          phone?: string | null
          updated_at?: string | null
          venue_lat?: number | null
          venue_lon?: number | null
          website?: string | null
        }
        Update: {
          address?: string | null
          branding?: Json | null
          code?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          jurisdiction?: string
          logo_url?: string | null
          name?: string
          phone?: string | null
          updated_at?: string | null
          venue_lat?: number | null
          venue_lon?: number | null
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
      planning_periods: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string
          end_date: string
          id: string
          organization_id: string
          published_at: string | null
          seeded_at: string | null
          start_date: string
          status: string
          sub_department_ids: string[]
          template_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id: string
          end_date: string
          id?: string
          organization_id: string
          published_at?: string | null
          seeded_at?: string | null
          start_date: string
          status?: string
          sub_department_ids?: string[]
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string
          end_date?: string
          id?: string
          organization_id?: string
          published_at?: string | null
          seeded_at?: string | null
          start_date?: string
          status?: string
          sub_department_ids?: string[]
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_periods_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_periods_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_periods_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
        ]
      }
      predicted_labor_demand: {
        Row: {
          corrected_count: number
          created_at: string
          event_id: string
          id: string
          model_version: string
          predicted_count: number
          role: string
          time_slot: number
        }
        Insert: {
          corrected_count?: number
          created_at?: string
          event_id: string
          id?: string
          model_version?: string
          predicted_count?: number
          role: string
          time_slot: number
        }
        Update: {
          corrected_count?: number
          created_at?: string
          event_id?: string
          id?: string
          model_version?: string
          predicted_count?: number
          role?: string
          time_slot?: number
        }
        Relationships: [
          {
            foreignKeyName: "predicted_labor_demand_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      profiles: {
        Row: {
          availability: Json | null
          avatar_url: string | null
          can_access_all_departments: boolean | null
          continuous_service_start: string | null
          created_at: string | null
          date_of_birth: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_code: string | null
          employee_id: number | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          first_name: string
          full_name: string | null
          hire_date: string | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          last_name: string | null
          legacy_department_id: string | null
          legacy_employee_id: string | null
          legacy_organization_id: string | null
          legacy_system_role: Database["public"]["Enums"]["system_role"] | null
          middle_name: string | null
          phone: string | null
          preferences: Json | null
          rest_gap_agreement_8h: boolean
          status: string | null
          termination_date: string | null
          updated_at: string | null
        }
        Insert: {
          availability?: Json | null
          avatar_url?: string | null
          can_access_all_departments?: boolean | null
          continuous_service_start?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_code?: string | null
          employee_id?: number | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          first_name: string
          full_name?: string | null
          hire_date?: string | null
          id: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          legacy_department_id?: string | null
          legacy_employee_id?: string | null
          legacy_organization_id?: string | null
          legacy_system_role?: Database["public"]["Enums"]["system_role"] | null
          middle_name?: string | null
          phone?: string | null
          preferences?: Json | null
          rest_gap_agreement_8h?: boolean
          status?: string | null
          termination_date?: string | null
          updated_at?: string | null
        }
        Update: {
          availability?: Json | null
          avatar_url?: string | null
          can_access_all_departments?: boolean | null
          continuous_service_start?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_code?: string | null
          employee_id?: number | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          first_name?: string
          full_name?: string | null
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          legacy_department_id?: string | null
          legacy_employee_id?: string | null
          legacy_organization_id?: string | null
          legacy_system_role?: Database["public"]["Enums"]["system_role"] | null
          middle_name?: string | null
          phone?: string | null
          preferences?: Json | null
          rest_gap_agreement_8h?: boolean
          status?: string | null
          termination_date?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      public_holidays: {
        Row: {
          created_at: string | null
          holiday_date: string
          id: string
          jurisdiction: string
          name: string
        }
        Insert: {
          created_at?: string | null
          holiday_date: string
          id?: string
          jurisdiction?: string
          name: string
        }
        Update: {
          created_at?: string | null
          holiday_date?: string
          id?: string
          jurisdiction?: string
          name?: string
        }
        Relationships: []
      }
      rbac_actions: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
        }
        Relationships: []
      }
      rbac_permissions: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"]
          action_code: string
          scope: Database["public"]["Enums"]["rbac_scope"]
        }
        Insert: {
          access_level: Database["public"]["Enums"]["access_level"]
          action_code: string
          scope: Database["public"]["Enums"]["rbac_scope"]
        }
        Update: {
          access_level?: Database["public"]["Enums"]["access_level"]
          action_code?: string
          scope?: Database["public"]["Enums"]["rbac_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "rbac_permissions_action_code_fkey"
            columns: ["action_code"]
            isOneToOne: false
            referencedRelation: "rbac_actions"
            referencedColumns: ["code"]
          },
        ]
      }
      role_ml_class_map: {
        Row: {
          ml_class: string
          role_id: string
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ml_class: string
          role_id: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ml_class?: string
          role_id?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_ml_class_map_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: true
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_groups: {
        Row: {
          created_at: string | null
          external_id: string | null
          id: string
          name: string
          roster_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          external_id?: string | null
          id?: string
          name: string
          roster_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          external_id?: string | null
          id?: string
          name?: string
          roster_id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_groups_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "rosters"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_subgroups: {
        Row: {
          created_at: string | null
          id: string
          min_headcount: number
          name: string
          required_headcount: number
          roster_group_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          min_headcount?: number
          name: string
          required_headcount?: number
          roster_group_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          min_headcount?: number
          name?: string
          required_headcount?: number
          roster_group_id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_subgroups_roster_group_id_fkey"
            columns: ["roster_group_id"]
            isOneToOne: false
            referencedRelation: "roster_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_template_applications: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          id: string
          roster_id: string
          template_id: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          id?: string
          roster_id: string
          template_id: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          id?: string
          roster_id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_template_applications_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "rosters"
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
        ]
      }
      roster_template_batches: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          created_at: string | null
          end_date: string
          id: string
          source: string
          start_date: string
          template_id: string
          updated_at: string | null
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string | null
          end_date: string
          id?: string
          source: string
          start_date: string
          template_id: string
          updated_at?: string | null
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string | null
          end_date?: string
          id?: string
          source?: string
          start_date?: string
          template_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_template_batches_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_template_batches_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_template_batches_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_templates: {
        Row: {
          applied_count: number | null
          created_at: string
          created_by: string | null
          created_from: string | null
          department_id: string | null
          description: string | null
          end_date: string | null
          id: string
          is_active: boolean | null
          is_base_template: boolean | null
          last_edited_by: string | null
          last_used_at: string | null
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
          applied_count?: number | null
          created_at?: string
          created_by?: string | null
          created_from?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          is_base_template?: boolean | null
          last_edited_by?: string | null
          last_used_at?: string | null
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
          applied_count?: number | null
          created_at?: string
          created_by?: string | null
          created_from?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          is_base_template?: boolean | null
          last_edited_by?: string | null
          last_used_at?: string | null
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
            foreignKeyName: "roster_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
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
            foreignKeyName: "roster_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      rosters: {
        Row: {
          created_at: string | null
          created_by: string | null
          department_id: string | null
          description: string | null
          end_date: string
          id: string
          is_locked: boolean
          organization_id: string
          planning_period_id: string | null
          published_at: string | null
          published_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id: string | null
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          end_date: string
          id?: string
          is_locked?: boolean
          organization_id: string
          planning_period_id?: string | null
          published_at?: string | null
          published_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string
          id?: string
          is_locked?: boolean
          organization_id?: string
          planning_period_id?: string | null
          published_at?: string | null
          published_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id?: string | null
          template_id?: string | null
          updated_at?: string | null
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
            foreignKeyName: "rosters_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_planning_period_id_fkey"
            columns: ["planning_period_id"]
            isOneToOne: false
            referencedRelation: "planning_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_bids: {
        Row: {
          allocation_reason: string | null
          bid_priority: number | null
          bid_rank: number | null
          created_at: string
          employee_id: string
          hours_limit_valid: boolean | null
          id: string
          notes: string | null
          rest_period_valid: boolean | null
          reviewed_at: string | null
          reviewed_by: string | null
          shift_id: string
          skill_match_percentage: number | null
          status: string
          suitability_score: number | null
          updated_at: string
        }
        Insert: {
          allocation_reason?: string | null
          bid_priority?: number | null
          bid_rank?: number | null
          created_at?: string
          employee_id: string
          hours_limit_valid?: boolean | null
          id?: string
          notes?: string | null
          rest_period_valid?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id: string
          skill_match_percentage?: number | null
          status?: string
          suitability_score?: number | null
          updated_at?: string
        }
        Update: {
          allocation_reason?: string | null
          bid_priority?: number | null
          bid_rank?: number | null
          created_at?: string
          employee_id?: string
          hours_limit_valid?: boolean | null
          id?: string
          notes?: string | null
          rest_period_valid?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id?: string
          skill_match_percentage?: number | null
          status?: string
          suitability_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_bids_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_profile_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      shift_compliance_snapshots: {
        Row: {
          checked_at: string | null
          checked_by_user_id: string | null
          compliance_snapshot: Json | null
          created_at: string
          eligibility_snapshot: Json | null
          id: string
          is_overridden: boolean
          overridden_at: string | null
          overridden_by_user_id: string | null
          override_reason: string | null
          shift_id: string
          updated_at: string
        }
        Insert: {
          checked_at?: string | null
          checked_by_user_id?: string | null
          compliance_snapshot?: Json | null
          created_at?: string
          eligibility_snapshot?: Json | null
          id?: string
          is_overridden?: boolean
          overridden_at?: string | null
          overridden_by_user_id?: string | null
          override_reason?: string | null
          shift_id: string
          updated_at?: string
        }
        Update: {
          checked_at?: string | null
          checked_by_user_id?: string | null
          compliance_snapshot?: Json | null
          created_at?: string
          eligibility_snapshot?: Json | null
          id?: string
          is_overridden?: boolean
          overridden_at?: string | null
          overridden_by_user_id?: string | null
          override_reason?: string | null
          shift_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_compliance_snapshots_checked_by_user_id_fkey"
            columns: ["checked_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_compliance_snapshots_overridden_by_user_id_fkey"
            columns: ["overridden_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_compliance_snapshots_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_events: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          causation_id: string | null
          correlation_id: string | null
          created_at: string | null
          domain: string | null
          employee_id: string | null
          episode_seq: number | null
          event_time: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          id: string
          idempotency_key: string | null
          metadata: Json | null
          shift_id: string | null
          shift_version: number | null
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          causation_id?: string | null
          correlation_id?: string | null
          created_at?: string | null
          domain?: string | null
          employee_id?: string | null
          episode_seq?: number | null
          event_time?: string
          event_type: Database["public"]["Enums"]["shift_event_type"]
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          shift_id?: string | null
          shift_version?: number | null
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          causation_id?: string | null
          correlation_id?: string | null
          created_at?: string | null
          domain?: string | null
          employee_id?: string | null
          episode_seq?: number | null
          event_time?: string
          event_type?: Database["public"]["Enums"]["shift_event_type"]
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          shift_id?: string | null
          shift_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
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
      shift_offers: {
        Row: {
          created_at: string | null
          employee_id: string
          id: string
          offer_expires_at: string | null
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
          offer_expires_at?: string | null
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
          offer_expires_at?: string | null
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
            referencedRelation: "profiles"
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
      shift_payroll_records: {
        Row: {
          actual_end: string | null
          actual_net_minutes: number | null
          actual_start: string | null
          created_at: string
          id: string
          payroll_exported: boolean
          payroll_exported_at: string | null
          payroll_exported_by: string | null
          shift_id: string
          timesheet_id: string | null
          updated_at: string
        }
        Insert: {
          actual_end?: string | null
          actual_net_minutes?: number | null
          actual_start?: string | null
          created_at?: string
          id?: string
          payroll_exported?: boolean
          payroll_exported_at?: string | null
          payroll_exported_by?: string | null
          shift_id: string
          timesheet_id?: string | null
          updated_at?: string
        }
        Update: {
          actual_end?: string | null
          actual_net_minutes?: number | null
          actual_start?: string | null
          created_at?: string
          id?: string
          payroll_exported?: boolean
          payroll_exported_at?: string | null
          payroll_exported_by?: string | null
          shift_id?: string
          timesheet_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_payroll_records_payroll_exported_by_fkey"
            columns: ["payroll_exported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_payroll_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_payroll_records_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
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
      shift_swaps: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          auto_decision_id: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          manager_approved: boolean | null
          reason: string | null
          rejection_reason: string | null
          requester_id: string
          requester_shift_id: string
          review_flag: boolean | null
          status: Database["public"]["Enums"]["swap_request_status"] | null
          status_changed_at: string | null
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
          auto_decision_id?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          manager_approved?: boolean | null
          reason?: string | null
          rejection_reason?: string | null
          requester_id: string
          requester_shift_id: string
          review_flag?: boolean | null
          status?: Database["public"]["Enums"]["swap_request_status"] | null
          status_changed_at?: string | null
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
          auto_decision_id?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          manager_approved?: boolean | null
          reason?: string | null
          rejection_reason?: string | null
          requester_id?: string
          requester_shift_id?: string
          review_flag?: boolean | null
          status?: Database["public"]["Enums"]["swap_request_status"] | null
          status_changed_at?: string | null
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
            foreignKeyName: "shift_swaps_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "shift_swaps_target_shift_id_fkey"
            columns: ["target_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          actual_end: string | null
          actual_hourly_rate: number | null
          actual_net_minutes: number | null
          actual_start: string | null
          assigned_at: string | null
          assigned_employee_id: string | null
          assignment_outcome:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_source: string | null
          assignment_status: Database["public"]["Enums"]["shift_assignment_status"]
          attendance_note: string | null
          attendance_status: Database["public"]["Enums"]["shift_attendance_status"]
          bidding_close_at: string | null
          bidding_open_at: string | null
          bidding_status: Database["public"]["Enums"]["shift_bidding_status"]
          break_end: string | null
          break_minutes: number | null
          break_start: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          compliance_checked_at: string | null
          compliance_override: boolean | null
          compliance_override_reason: string | null
          compliance_snapshot: Json | null
          confirmed_at: string | null
          created_at: string | null
          created_by_user_id: string | null
          creation_source: string | null
          currency: string | null
          deleted_at: string | null
          demand_group_id: string | null
          demand_source: string | null
          department_id: string
          display_order: number | null
          dropped_by_id: string | null
          eligibility_snapshot: Json | null
          emergency_assigned_at: string | null
          emergency_assigned_by: string | null
          end_at: string | null
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
          is_training: boolean | null
          last_dropped_by: string | null
          last_modified_by: string | null
          last_modified_reason: string | null
          last_rejected_by: string | null
          lifecycle_status: Database["public"]["Enums"]["shift_lifecycle"]
          locked_at: string | null
          net_length_minutes: number | null
          notes: string | null
          offer_expires_at: string | null
          offer_sent_at: string | null
          organization_id: string
          paid_break_minutes: number | null
          payroll_exported: boolean | null
          published_at: string | null
          published_by_user_id: string | null
          remuneration_level: number | null
          remuneration_rate: number | null
          required_licenses: Json | null
          required_skills: Json | null
          role_id: string | null
          roster_date: string | null
          roster_id: string
          roster_subgroup_id: string
          scheduled_length_minutes: number | null
          shift_date: string
          shift_group_id: string | null
          start_at: string | null
          start_time: string
          sub_department_id: string | null
          sub_group_name: string | null
          synthesis_run_id: string | null
          tags: Json | null
          target_employment_type: string
          target_requires_flexible: boolean
          template_batch_id: string | null
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
          trading_status: Database["public"]["Enums"]["shift_trading"]
          tz_identifier: string | null
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
          assignment_outcome?:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_source?: string | null
          assignment_status?: Database["public"]["Enums"]["shift_assignment_status"]
          attendance_note?: string | null
          attendance_status?: Database["public"]["Enums"]["shift_attendance_status"]
          bidding_close_at?: string | null
          bidding_open_at?: string | null
          bidding_status?: Database["public"]["Enums"]["shift_bidding_status"]
          break_end?: string | null
          break_minutes?: number | null
          break_start?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          compliance_checked_at?: string | null
          compliance_override?: boolean | null
          compliance_override_reason?: string | null
          compliance_snapshot?: Json | null
          confirmed_at?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          creation_source?: string | null
          currency?: string | null
          deleted_at?: string | null
          demand_group_id?: string | null
          demand_source?: string | null
          department_id: string
          display_order?: number | null
          dropped_by_id?: string | null
          eligibility_snapshot?: Json | null
          emergency_assigned_at?: string | null
          emergency_assigned_by?: string | null
          end_at?: string | null
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
          is_training?: boolean | null
          last_dropped_by?: string | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          last_rejected_by?: string | null
          lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle"]
          locked_at?: string | null
          net_length_minutes?: number | null
          notes?: string | null
          offer_expires_at?: string | null
          offer_sent_at?: string | null
          organization_id: string
          paid_break_minutes?: number | null
          payroll_exported?: boolean | null
          published_at?: string | null
          published_by_user_id?: string | null
          remuneration_level?: number | null
          remuneration_rate?: number | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          roster_date?: string | null
          roster_id: string
          roster_subgroup_id: string
          scheduled_length_minutes?: number | null
          shift_date: string
          shift_group_id?: string | null
          start_at?: string | null
          start_time: string
          sub_department_id?: string | null
          sub_group_name?: string | null
          synthesis_run_id?: string | null
          tags?: Json | null
          target_employment_type: string
          target_requires_flexible?: boolean
          template_batch_id?: string | null
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
          trading_status?: Database["public"]["Enums"]["shift_trading"]
          tz_identifier?: string | null
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
          assignment_outcome?:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_source?: string | null
          assignment_status?: Database["public"]["Enums"]["shift_assignment_status"]
          attendance_note?: string | null
          attendance_status?: Database["public"]["Enums"]["shift_attendance_status"]
          bidding_close_at?: string | null
          bidding_open_at?: string | null
          bidding_status?: Database["public"]["Enums"]["shift_bidding_status"]
          break_end?: string | null
          break_minutes?: number | null
          break_start?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          compliance_checked_at?: string | null
          compliance_override?: boolean | null
          compliance_override_reason?: string | null
          compliance_snapshot?: Json | null
          confirmed_at?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          creation_source?: string | null
          currency?: string | null
          deleted_at?: string | null
          demand_group_id?: string | null
          demand_source?: string | null
          department_id?: string
          display_order?: number | null
          dropped_by_id?: string | null
          eligibility_snapshot?: Json | null
          emergency_assigned_at?: string | null
          emergency_assigned_by?: string | null
          end_at?: string | null
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
          is_training?: boolean | null
          last_dropped_by?: string | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          last_rejected_by?: string | null
          lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle"]
          locked_at?: string | null
          net_length_minutes?: number | null
          notes?: string | null
          offer_expires_at?: string | null
          offer_sent_at?: string | null
          organization_id?: string
          paid_break_minutes?: number | null
          payroll_exported?: boolean | null
          published_at?: string | null
          published_by_user_id?: string | null
          remuneration_level?: number | null
          remuneration_rate?: number | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          roster_date?: string | null
          roster_id?: string
          roster_subgroup_id?: string
          scheduled_length_minutes?: number | null
          shift_date?: string
          shift_group_id?: string | null
          start_at?: string | null
          start_time?: string
          sub_department_id?: string | null
          sub_group_name?: string | null
          synthesis_run_id?: string | null
          tags?: Json | null
          target_employment_type?: string
          target_requires_flexible?: boolean
          template_batch_id?: string | null
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
          trading_status?: Database["public"]["Enums"]["shift_trading"]
          tz_identifier?: string | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          user_contract_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_shifts_assigned_profile"
            columns: ["assigned_employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_shifts_organization"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
            foreignKeyName: "shifts_dropped_by_id_fkey"
            columns: ["dropped_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_last_dropped_by_fkey"
            columns: ["last_dropped_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_last_rejected_by_fkey"
            columns: ["last_rejected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_remuneration_level_fkey"
            columns: ["remuneration_level"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["level_number"]
          },
          {
            foreignKeyName: "shifts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "rosters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_subgroup_id_fkey"
            columns: ["roster_subgroup_id"]
            isOneToOne: false
            referencedRelation: "roster_subgroups"
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
            foreignKeyName: "shifts_synthesis_run_id_fkey"
            columns: ["synthesis_run_id"]
            isOneToOne: false
            referencedRelation: "synthesis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_template_batch_id_fkey"
            columns: ["template_batch_id"]
            isOneToOne: false
            referencedRelation: "roster_template_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
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
          default_validity_months: number | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          requires_expiration: boolean | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          default_validity_months?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          requires_expiration?: boolean | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          default_validity_months?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          requires_expiration?: boolean | null
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
        ]
      }
      supervisor_feedback: {
        Row: {
          created_at: string
          event_id: string | null
          function_code: string
          id: string
          level: number
          reason_code: string
          reason_note: string | null
          rule_version_at_event: number | null
          severity: number
          slice_end: number
          slice_start: number
          supervisor_id: string | null
          verdict: Database["public"]["Enums"]["feedback_verdict"]
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          function_code: string
          id?: string
          level: number
          reason_code: string
          reason_note?: string | null
          rule_version_at_event?: number | null
          severity: number
          slice_end: number
          slice_start: number
          supervisor_id?: string | null
          verdict: Database["public"]["Enums"]["feedback_verdict"]
        }
        Update: {
          created_at?: string
          event_id?: string | null
          function_code?: string
          id?: string
          level?: number
          reason_code?: string
          reason_note?: string | null
          rule_version_at_event?: number | null
          severity?: number
          slice_end?: number
          slice_start?: number
          supervisor_id?: string | null
          verdict?: Database["public"]["Enums"]["feedback_verdict"]
        }
        Relationships: [
          {
            foreignKeyName: "supervisor_feedback_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "supervisor_feedback_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_offers: {
        Row: {
          compliance_snapshot: Json | null
          created_at: string | null
          id: string
          offered_shift_id: string | null
          offerer_id: string
          status: Database["public"]["Enums"]["swap_offer_status"]
          swap_request_id: string
          updated_at: string | null
        }
        Insert: {
          compliance_snapshot?: Json | null
          created_at?: string | null
          id?: string
          offered_shift_id?: string | null
          offerer_id: string
          status?: Database["public"]["Enums"]["swap_offer_status"]
          swap_request_id: string
          updated_at?: string | null
        }
        Update: {
          compliance_snapshot?: Json | null
          created_at?: string | null
          id?: string
          offered_shift_id?: string | null
          offerer_id?: string
          status?: Database["public"]["Enums"]["swap_offer_status"]
          swap_request_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "swap_offers_offered_shift_id_fkey"
            columns: ["offered_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_offers_offerer_id_fkey"
            columns: ["offerer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_offers_swap_request_id_fkey"
            columns: ["swap_request_id"]
            isOneToOne: false
            referencedRelation: "shift_swaps"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_requests: {
        Row: {
          approved_by_manager_id: string | null
          created_at: string | null
          department_id: string | null
          id: string
          manager_approved_at: string | null
          offered_shift_id: string | null
          open_swap: boolean | null
          organization_id: string | null
          original_shift_id: string
          priority: string | null
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
          department_id?: string | null
          id?: string
          manager_approved_at?: string | null
          offered_shift_id?: string | null
          open_swap?: boolean | null
          organization_id?: string | null
          original_shift_id: string
          priority?: string | null
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
          department_id?: string | null
          id?: string
          manager_approved_at?: string | null
          offered_shift_id?: string | null
          open_swap?: boolean | null
          organization_id?: string | null
          original_shift_id?: string
          priority?: string | null
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
            foreignKeyName: "swap_requests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_offered_shift_id_fkey"
            columns: ["offered_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_original_shift_id_fkey"
            columns: ["original_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      synthesis_runs: {
        Row: {
          attempted_count: number
          created_at: string
          created_by: string
          created_count: number
          deleted_count: number
          department_id: string
          id: string
          options: Json
          organization_id: string
          rolled_back_at: string | null
          rolled_back_by: string | null
          rolled_back_count: number | null
          roster_id: string
          shift_date: string
          status: Database["public"]["Enums"]["synthesis_run_status"]
          sub_department_id: string | null
        }
        Insert: {
          attempted_count?: number
          created_at?: string
          created_by: string
          created_count?: number
          deleted_count?: number
          department_id: string
          id?: string
          options?: Json
          organization_id: string
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          rolled_back_count?: number | null
          roster_id: string
          shift_date: string
          status?: Database["public"]["Enums"]["synthesis_run_status"]
          sub_department_id?: string | null
        }
        Update: {
          attempted_count?: number
          created_at?: string
          created_by?: string
          created_count?: number
          deleted_count?: number
          department_id?: string
          id?: string
          options?: Json
          organization_id?: string
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          rolled_back_count?: number | null
          roster_id?: string
          shift_date?: string
          status?: Database["public"]["Enums"]["synthesis_run_status"]
          sub_department_id?: string | null
        }
        Relationships: []
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
      template_groups: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          name: string
          sort_order: number | null
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          sort_order?: number | null
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          template_id?: string | null
          updated_at?: string | null
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
          break_end: string | null
          break_start: string | null
          created_at: string | null
          day_of_week: number | null
          end_time: string | null
          event_tags: string[] | null
          id: string
          name: string | null
          net_length_hours: number | null
          notes: string | null
          paid_break_minutes: number | null
          remuneration_level: number | null
          remuneration_level_name: string | null
          required_licenses: string[] | null
          required_skills: string[] | null
          role_id: string | null
          role_name: string | null
          site_tags: string[] | null
          sort_order: number | null
          start_time: string | null
          subgroup_id: string | null
          target_employment_type: string
          target_requires_flexible: boolean
          unpaid_break_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          break_end?: string | null
          break_start?: string | null
          created_at?: string | null
          day_of_week?: number | null
          end_time?: string | null
          event_tags?: string[] | null
          id?: string
          name?: string | null
          net_length_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          remuneration_level?: number | null
          remuneration_level_name?: string | null
          required_licenses?: string[] | null
          required_skills?: string[] | null
          role_id?: string | null
          role_name?: string | null
          site_tags?: string[] | null
          sort_order?: number | null
          start_time?: string | null
          subgroup_id?: string | null
          target_employment_type: string
          target_requires_flexible?: boolean
          unpaid_break_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          break_end?: string | null
          break_start?: string | null
          created_at?: string | null
          day_of_week?: number | null
          end_time?: string | null
          event_tags?: string[] | null
          id?: string
          name?: string | null
          net_length_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          remuneration_level?: number | null
          remuneration_level_name?: string | null
          required_licenses?: string[] | null
          required_skills?: string[] | null
          role_id?: string | null
          role_name?: string | null
          site_tags?: string[] | null
          sort_order?: number | null
          start_time?: string | null
          subgroup_id?: string | null
          target_employment_type?: string
          target_requires_flexible?: boolean
          unpaid_break_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_shifts_remuneration_level_fkey"
            columns: ["remuneration_level"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["level_number"]
          },
          {
            foreignKeyName: "template_shifts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_shifts_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "template_subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      template_subgroups: {
        Row: {
          created_at: string | null
          description: string | null
          group_id: string | null
          id: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
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
      timesheets: {
        Row: {
          actual_break_end: string | null
          actual_break_start: string | null
          approved_at: string | null
          approved_by: string | null
          arrival_variance_reason: string | null
          assignment_id: string | null
          break_minutes: number | null
          clock_in: string
          clock_out: string | null
          created_at: string | null
          departure_variance_reason: string | null
          edit_count: number
          employee_id: string | null
          end_time: string | null
          id: string
          net_hours: number | null
          notes: string | null
          paid_break_minutes: number | null
          profile_id: string
          rejected_reason: string | null
          shift_id: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["timesheet_status"] | null
          submitted_at: string | null
          total_hours: number | null
          unpaid_break_minutes: number | null
          updated_at: string | null
          version: number
          work_date: string
        }
        Insert: {
          actual_break_end?: string | null
          actual_break_start?: string | null
          approved_at?: string | null
          approved_by?: string | null
          arrival_variance_reason?: string | null
          assignment_id?: string | null
          break_minutes?: number | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string | null
          departure_variance_reason?: string | null
          edit_count?: number
          employee_id?: string | null
          end_time?: string | null
          id?: string
          net_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          profile_id: string
          rejected_reason?: string | null
          shift_id?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"] | null
          submitted_at?: string | null
          total_hours?: number | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          version?: number
          work_date: string
        }
        Update: {
          actual_break_end?: string | null
          actual_break_start?: string | null
          approved_at?: string | null
          approved_by?: string | null
          arrival_variance_reason?: string | null
          assignment_id?: string | null
          break_minutes?: number | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string | null
          departure_variance_reason?: string | null
          edit_count?: number
          employee_id?: string | null
          end_time?: string | null
          id?: string
          net_hours?: number | null
          notes?: string | null
          paid_break_minutes?: number | null
          profile_id?: string
          rejected_reason?: string | null
          shift_id?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"] | null
          submitted_at?: string | null
          total_hours?: number | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          version?: number
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
            foreignKeyName: "timesheets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      toil_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          effective_date: string
          employee_id: string
          entry_type: string
          id: string
          leave_request_id: string | null
          minutes: number
          reason: string | null
          source_timesheet_ids: string[]
          threshold_minutes: number | null
          user_contract_id: string
          worked_minutes: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_date: string
          employee_id: string
          entry_type: string
          id?: string
          leave_request_id?: string | null
          minutes: number
          reason?: string | null
          source_timesheet_ids?: string[]
          threshold_minutes?: number | null
          user_contract_id: string
          worked_minutes?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_date?: string
          employee_id?: string
          entry_type?: string
          id?: string
          leave_request_id?: string | null
          minutes?: number
          reason?: string | null
          source_timesheet_ids?: string[]
          threshold_minutes?: number | null
          user_contract_id?: string
          worked_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "toil_ledger_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toil_ledger_leave_request_id_fkey"
            columns: ["leave_request_id"]
            isOneToOne: false
            referencedRelation: "employee_leave_days"
            referencedColumns: ["request_id"]
          },
          {
            foreignKeyName: "toil_ledger_leave_request_id_fkey"
            columns: ["leave_request_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toil_ledger_user_contract_id_fkey"
            columns: ["user_contract_id"]
            isOneToOne: false
            referencedRelation: "user_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      venueops_booked_spaces: {
        Row: {
          attendance: number
          booked_status: string
          created_at: string
          description: string | null
          end_date: string | null
          end_time: string | null
          event_id: string
          id: string
          is_all_day: boolean
          is_invoiced: boolean
          number_of_hours: number
          option_number: number | null
          room_capacity: number | null
          room_id: string | null
          room_name: string | null
          room_setup: string | null
          space_usage_id: string | null
          space_usage_name: string | null
          square_footage: number | null
          start_date: string | null
          start_time: string | null
          usage_type: string | null
          venue_id: string | null
        }
        Insert: {
          attendance?: number
          booked_status?: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          event_id: string
          id: string
          is_all_day?: boolean
          is_invoiced?: boolean
          number_of_hours?: number
          option_number?: number | null
          room_capacity?: number | null
          room_id?: string | null
          room_name?: string | null
          room_setup?: string | null
          space_usage_id?: string | null
          space_usage_name?: string | null
          square_footage?: number | null
          start_date?: string | null
          start_time?: string | null
          usage_type?: string | null
          venue_id?: string | null
        }
        Update: {
          attendance?: number
          booked_status?: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          event_id?: string
          id?: string
          is_all_day?: boolean
          is_invoiced?: boolean
          number_of_hours?: number
          option_number?: number | null
          room_capacity?: number | null
          room_id?: string | null
          room_name?: string | null
          room_setup?: string | null
          space_usage_id?: string | null
          space_usage_name?: string | null
          square_footage?: number | null
          start_date?: string | null
          start_time?: string | null
          usage_type?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venueops_booked_spaces_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "venueops_booked_spaces_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "venueops_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      venueops_event_types: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
        Relationships: []
      }
      venueops_events: {
        Row: {
          actual_total_attendance: number | null
          alcohol: boolean | null
          bump_in_min: number | null
          bump_out_min: number | null
          created_at: string
          end_date_time: string
          estimated_total_attendance: number
          event_id: string
          event_type_id: string | null
          event_type_name: string | null
          is_canceled: boolean
          is_definite: boolean
          is_prospect: boolean
          is_tentative: boolean
          layout_complexity: string | null
          name: string
          number_of_event_days: number
          room_ids: string | null
          room_names: string | null
          series_id: string | null
          service_type: string | null
          start_date_time: string
          venue_ids: string | null
          venue_names: string | null
        }
        Insert: {
          actual_total_attendance?: number | null
          alcohol?: boolean | null
          bump_in_min?: number | null
          bump_out_min?: number | null
          created_at?: string
          end_date_time: string
          estimated_total_attendance?: number
          event_id: string
          event_type_id?: string | null
          event_type_name?: string | null
          is_canceled?: boolean
          is_definite?: boolean
          is_prospect?: boolean
          is_tentative?: boolean
          layout_complexity?: string | null
          name: string
          number_of_event_days?: number
          room_ids?: string | null
          room_names?: string | null
          series_id?: string | null
          service_type?: string | null
          start_date_time: string
          venue_ids?: string | null
          venue_names?: string | null
        }
        Update: {
          actual_total_attendance?: number | null
          alcohol?: boolean | null
          bump_in_min?: number | null
          bump_out_min?: number | null
          created_at?: string
          end_date_time?: string
          estimated_total_attendance?: number
          event_id?: string
          event_type_id?: string | null
          event_type_name?: string | null
          is_canceled?: boolean
          is_definite?: boolean
          is_prospect?: boolean
          is_tentative?: boolean
          layout_complexity?: string | null
          name?: string
          number_of_event_days?: number
          room_ids?: string | null
          room_names?: string | null
          series_id?: string | null
          service_type?: string | null
          start_date_time?: string
          venue_ids?: string | null
          venue_names?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venueops_events_event_type_id_fkey"
            columns: ["event_type_id"]
            isOneToOne: false
            referencedRelation: "venueops_event_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venueops_events_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "venueops_series"
            referencedColumns: ["series_id"]
          },
        ]
      }
      venueops_function_types: {
        Row: {
          id: string
          is_performance: boolean
          name: string
          room_setup: string | null
          show_on_calendar: boolean
        }
        Insert: {
          id: string
          is_performance?: boolean
          name: string
          room_setup?: string | null
          show_on_calendar?: boolean
        }
        Update: {
          id?: string
          is_performance?: boolean
          name?: string
          room_setup?: string | null
          show_on_calendar?: boolean
        }
        Relationships: []
      }
      venueops_functions: {
        Row: {
          created_at: string
          date: string
          end_date_time: string
          end_time: string | null
          event_id: string
          event_type_name: string | null
          expected_attendance: number
          function_id: string
          function_type_id: string | null
          function_type_name: string | null
          is_canceled: boolean
          is_performance: boolean
          name: string
          number_of_hours: number
          room_id: string | null
          room_name: string | null
          start_date_time: string
          start_time: string | null
          venue_id: string | null
          venue_name: string | null
        }
        Insert: {
          created_at?: string
          date: string
          end_date_time: string
          end_time?: string | null
          event_id: string
          event_type_name?: string | null
          expected_attendance?: number
          function_id: string
          function_type_id?: string | null
          function_type_name?: string | null
          is_canceled?: boolean
          is_performance?: boolean
          name: string
          number_of_hours?: number
          room_id?: string | null
          room_name?: string | null
          start_date_time: string
          start_time?: string | null
          venue_id?: string | null
          venue_name?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          end_date_time?: string
          end_time?: string | null
          event_id?: string
          event_type_name?: string | null
          expected_attendance?: number
          function_id?: string
          function_type_id?: string | null
          function_type_name?: string | null
          is_canceled?: boolean
          is_performance?: boolean
          name?: string
          number_of_hours?: number
          room_id?: string | null
          room_name?: string | null
          start_date_time?: string
          start_time?: string | null
          venue_id?: string | null
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venueops_functions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "venueops_functions_function_type_id_fkey"
            columns: ["function_type_id"]
            isOneToOne: false
            referencedRelation: "venueops_function_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venueops_functions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "venueops_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      venueops_ml_features: {
        Row: {
          created_at: string
          day_of_week: number
          entry_peak_flag: boolean
          event_id: string | null
          event_type: string | null
          exit_peak_flag: boolean
          expected_attendance: number
          function_end_datetime: string
          function_id: string | null
          function_start_datetime: string
          function_type: string | null
          id: string
          meal_window_flag: boolean
          month: number
          room_capacity: number
          room_count: number
          simultaneous_event_count: number
          target_role: string
          target_staff_count: number
          time_slice_index: number
          total_sqm: number
          total_venue_attendance_same_time: number
        }
        Insert: {
          created_at?: string
          day_of_week: number
          entry_peak_flag?: boolean
          event_id?: string | null
          event_type?: string | null
          exit_peak_flag?: boolean
          expected_attendance?: number
          function_end_datetime: string
          function_id?: string | null
          function_start_datetime: string
          function_type?: string | null
          id?: string
          meal_window_flag?: boolean
          month: number
          room_capacity?: number
          room_count?: number
          simultaneous_event_count?: number
          target_role: string
          target_staff_count?: number
          time_slice_index: number
          total_sqm?: number
          total_venue_attendance_same_time?: number
        }
        Update: {
          created_at?: string
          day_of_week?: number
          entry_peak_flag?: boolean
          event_id?: string | null
          event_type?: string | null
          exit_peak_flag?: boolean
          expected_attendance?: number
          function_end_datetime?: string
          function_id?: string | null
          function_start_datetime?: string
          function_type?: string | null
          id?: string
          meal_window_flag?: boolean
          month?: number
          room_capacity?: number
          room_count?: number
          simultaneous_event_count?: number
          target_role?: string
          target_staff_count?: number
          time_slice_index?: number
          total_sqm?: number
          total_venue_attendance_same_time?: number
        }
        Relationships: [
          {
            foreignKeyName: "venueops_ml_features_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "venueops_ml_features_function_id_fkey"
            columns: ["function_id"]
            isOneToOne: false
            referencedRelation: "venueops_functions"
            referencedColumns: ["function_id"]
          },
        ]
      }
      venueops_rooms: {
        Row: {
          conflicting_room_ids: string[]
          id: string
          is_active: boolean
          is_combo_room: boolean
          item_code: string | null
          max_capacity: number | null
          name: string
          room_group: string | null
          square_footage: number | null
          sub_room_ids: string[]
          venue_id: string | null
          venue_name: string | null
        }
        Insert: {
          conflicting_room_ids?: string[]
          id: string
          is_active?: boolean
          is_combo_room?: boolean
          item_code?: string | null
          max_capacity?: number | null
          name: string
          room_group?: string | null
          square_footage?: number | null
          sub_room_ids?: string[]
          venue_id?: string | null
          venue_name?: string | null
        }
        Update: {
          conflicting_room_ids?: string[]
          id?: string
          is_active?: boolean
          is_combo_room?: boolean
          item_code?: string | null
          max_capacity?: number | null
          name?: string
          room_group?: string | null
          square_footage?: number | null
          sub_room_ids?: string[]
          venue_id?: string | null
          venue_name?: string | null
        }
        Relationships: []
      }
      venueops_series: {
        Row: {
          announce_date_time: string | null
          name: string
          on_sale_date_time: string | null
          series_id: string
          unique_id: string | null
        }
        Insert: {
          announce_date_time?: string | null
          name: string
          on_sale_date_time?: string | null
          series_id: string
          unique_id?: string | null
        }
        Update: {
          announce_date_time?: string | null
          name?: string
          on_sale_date_time?: string | null
          series_id?: string
          unique_id?: string | null
        }
        Relationships: []
      }
      venueops_tasks: {
        Row: {
          assigned_to: Json
          completion_date: string | null
          creation_date: string
          description: string | null
          due_date: string | null
          event_id: string | null
          event_name: string | null
          id: string
          is_completed: boolean
          result: string | null
          task_type: string | null
          title: string
          venue_ids: string[]
        }
        Insert: {
          assigned_to?: Json
          completion_date?: string | null
          creation_date?: string
          description?: string | null
          due_date?: string | null
          event_id?: string | null
          event_name?: string | null
          id: string
          is_completed?: boolean
          result?: string | null
          task_type?: string | null
          title: string
          venue_ids?: string[]
        }
        Update: {
          assigned_to?: Json
          completion_date?: string | null
          creation_date?: string
          description?: string | null
          due_date?: string | null
          event_id?: string | null
          event_name?: string | null
          id?: string
          is_completed?: boolean
          result?: string | null
          task_type?: string | null
          title?: string
          venue_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "venueops_tasks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venueops_events"
            referencedColumns: ["event_id"]
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
      employee_leave_days: {
        Row: {
          employee_id: string | null
          leave_date: string | null
          leave_type: string | null
          request_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      remuneration_levels: {
        Row: {
          description: string | null
          level_name: string | null
          level_number: number | null
        }
        Insert: {
          description?: string | null
          level_name?: string | null
          level_number?: number | null
        }
        Update: {
          description?: string | null
          level_name?: string | null
          level_number?: number | null
        }
        Relationships: []
      }
      roles: {
        Row: {
          code: string | null
          created_at: string | null
          description: string | null
          eba_level_max: number | null
          eba_level_min: number | null
          employment_type: string | null
          forecasting_bucket: string | null
          id: string | null
          is_active: boolean | null
          is_baseline_eligible: boolean | null
          name: string | null
          remuneration_level: number | null
          responsibilities: string[] | null
          subdepartment_id: string | null
          supervision_ratio_max: number | null
          supervision_ratio_min: number | null
          typically_salaried: boolean | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          description?: string | null
          eba_level_max?: number | null
          eba_level_min?: number | null
          employment_type?: string | null
          forecasting_bucket?: string | null
          id?: string | null
          is_active?: boolean | null
          is_baseline_eligible?: boolean | null
          name?: string | null
          remuneration_level?: number | null
          responsibilities?: string[] | null
          subdepartment_id?: string | null
          supervision_ratio_max?: number | null
          supervision_ratio_min?: number | null
          typically_salaried?: boolean | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          description?: string | null
          eba_level_max?: number | null
          eba_level_min?: number | null
          employment_type?: string | null
          forecasting_bucket?: string | null
          id?: string | null
          is_active?: boolean | null
          is_baseline_eligible?: boolean | null
          name?: string | null
          remuneration_level?: number | null
          responsibilities?: string[] | null
          subdepartment_id?: string | null
          supervision_ratio_max?: number | null
          supervision_ratio_min?: number | null
          typically_salaried?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_contracts: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"] | null
          annual_guaranteed_hours: number | null
          annual_salary: number | null
          apprentice_type: string | null
          apprentice_year: number | null
          contracted_weekly_hours: number | null
          created_at: string | null
          created_by: string | null
          department_id: string | null
          eba_exclusion_reason: string | null
          employment_status:
            | Database["public"]["Enums"]["employment_status"]
            | null
          end_date: string | null
          engagement_kind: string | null
          has_completed_year_12: boolean | null
          id: string | null
          is_apprentice: boolean | null
          is_sws: boolean | null
          is_sws_trial: boolean | null
          is_trainee: boolean | null
          is_training_on_job: boolean | null
          multi_hire_request_ref: string | null
          notes: string | null
          ordinary_days: number[] | null
          ordinary_hours_cycle_anchor: string | null
          ordinary_hours_cycle_weeks: number | null
          ordinary_span_end: string | null
          ordinary_span_start: string | null
          organization_id: string | null
          pay_basis: string | null
          position_id: string | null
          prefers_sba_loading: boolean | null
          remuneration_level: number | null
          role_id: string | null
          start_date: string | null
          status: string | null
          sub_department_id: string | null
          sws_capacity_percentage: number | null
          sws_trial_start_date: string | null
          trainee_aqf_level: number | null
          trainee_category: string | null
          trainee_exit_year: number | null
          trainee_level: string | null
          trainee_year: number | null
          trainee_years_out: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          access_level?: Database["public"]["Enums"]["access_level"] | null
          annual_guaranteed_hours?: number | null
          annual_salary?: number | null
          apprentice_type?: string | null
          apprentice_year?: number | null
          contracted_weekly_hours?: number | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          eba_exclusion_reason?: string | null
          employment_status?:
            | Database["public"]["Enums"]["employment_status"]
            | null
          end_date?: string | null
          engagement_kind?: string | null
          has_completed_year_12?: boolean | null
          id?: string | null
          is_apprentice?: boolean | null
          is_sws?: boolean | null
          is_sws_trial?: boolean | null
          is_trainee?: boolean | null
          is_training_on_job?: boolean | null
          multi_hire_request_ref?: string | null
          notes?: string | null
          ordinary_days?: number[] | null
          ordinary_hours_cycle_anchor?: string | null
          ordinary_hours_cycle_weeks?: number | null
          ordinary_span_end?: string | null
          ordinary_span_start?: string | null
          organization_id?: string | null
          pay_basis?: string | null
          position_id?: string | null
          prefers_sba_loading?: boolean | null
          remuneration_level?: number | null
          role_id?: string | null
          start_date?: string | null
          status?: string | null
          sub_department_id?: string | null
          sws_capacity_percentage?: number | null
          sws_trial_start_date?: string | null
          trainee_aqf_level?: number | null
          trainee_category?: string | null
          trainee_exit_year?: number | null
          trainee_level?: string | null
          trainee_year?: number | null
          trainee_years_out?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          access_level?: Database["public"]["Enums"]["access_level"] | null
          annual_guaranteed_hours?: number | null
          annual_salary?: number | null
          apprentice_type?: string | null
          apprentice_year?: number | null
          contracted_weekly_hours?: number | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          eba_exclusion_reason?: string | null
          employment_status?:
            | Database["public"]["Enums"]["employment_status"]
            | null
          end_date?: string | null
          engagement_kind?: string | null
          has_completed_year_12?: boolean | null
          id?: string | null
          is_apprentice?: boolean | null
          is_sws?: boolean | null
          is_sws_trial?: boolean | null
          is_trainee?: boolean | null
          is_training_on_job?: boolean | null
          multi_hire_request_ref?: string | null
          notes?: string | null
          ordinary_days?: number[] | null
          ordinary_hours_cycle_anchor?: string | null
          ordinary_hours_cycle_weeks?: number | null
          ordinary_span_end?: string | null
          ordinary_span_start?: string | null
          organization_id?: string | null
          pay_basis?: string | null
          position_id?: string | null
          prefers_sba_loading?: boolean | null
          remuneration_level?: number | null
          role_id?: string | null
          start_date?: string | null
          status?: string | null
          sub_department_id?: string | null
          sws_capacity_percentage?: number | null
          sws_trial_start_date?: string | null
          trainee_aqf_level?: number | null
          trainee_category?: string | null
          trainee_exit_year?: number | null
          trainee_level?: string | null
          trainee_year?: number | null
          trainee_years_out?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
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
          organization_id: string | null
          participant_count: number | null
          sub_department_id: string | null
          total_broadcast_count: number | null
          updated_at: string | null
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
            foreignKeyName: "broadcast_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_groups_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
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
          last_broadcast_at: string | null
          name: string | null
          total_broadcast_count: number | null
          updated_at: string | null
        }
        Insert: {
          active_broadcast_count?: never
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string | null
          is_active?: boolean | null
          last_broadcast_at?: never
          name?: string | null
          total_broadcast_count?: never
          updated_at?: string | null
        }
        Update: {
          active_broadcast_count?: never
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string | null
          is_active?: boolean | null
          last_broadcast_at?: never
          name?: string | null
          total_broadcast_count?: never
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
        ]
      }
      v_group_all_participants: {
        Row: {
          employee_id: string | null
          group_id: string | null
          is_explicit: boolean | null
          role: string | null
        }
        Relationships: []
      }
      v_shift_assignment_episodes: {
        Row: {
          attended: boolean | null
          auto_clock_out: boolean | null
          became_active_at: string | null
          closed_at: string | null
          department_id: string | null
          early_in: boolean | null
          early_out: boolean | null
          employee_id: string | null
          episode_seq: number | null
          had_accept: boolean | null
          had_assign: boolean | null
          had_emergency: boolean | null
          had_offer: boolean | null
          had_swap_in: boolean | null
          late_in: boolean | null
          late_out: boolean | null
          on_time_in: boolean | null
          on_time_out: boolean | null
          opened_at: string | null
          opening_event: string | null
          organization_id: string | null
          scheduled_start: string | null
          shift_date: string | null
          shift_id: string | null
          sub_department_id: string | null
          terminal_outcome: string | null
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
            foreignKeyName: "shift_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
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
            foreignKeyName: "shifts_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      v_template_full: {
        Row: {
          applied_count: number | null
          created_at: string | null
          created_by: string | null
          department_id: string | null
          description: string | null
          end_date: string | null
          groups: Json | null
          id: string | null
          is_base_template: boolean | null
          last_edited_by: string | null
          name: string | null
          organization_id: string | null
          published_at: string | null
          published_by: string | null
          published_month: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["template_status"] | null
          sub_department_id: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          applied_count?: never
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          groups?: never
          id?: string | null
          is_base_template?: boolean | null
          last_edited_by?: string | null
          name?: string | null
          organization_id?: string | null
          published_at?: string | null
          published_by?: string | null
          published_month?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["template_status"] | null
          sub_department_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          applied_count?: never
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          end_date?: string | null
          groups?: never
          id?: string | null
          is_base_template?: boolean | null
          last_edited_by?: string | null
          name?: string | null
          organization_id?: string | null
          published_at?: string | null
          published_by?: string | null
          published_month?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["template_status"] | null
          sub_department_id?: string | null
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
            foreignKeyName: "roster_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
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
            foreignKeyName: "roster_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
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
        Relationships: []
      }
    }
    Functions: {
      _apply_shift_op_write: {
        Args: {
          p_actor: string
          p_op: string
          p_payload: Json
          p_shift_id: string
        }
        Returns: Json
      }
      _shift_delete_refusal: {
        Args: { p_shift: Database["public"]["Tables"]["shifts"]["Row"] }
        Returns: string
      }
      access_level_label: {
        Args: { p_level: Database["public"]["Enums"]["access_level"] }
        Returns: string
      }
      accrue_leave_balances: { Args: never; Returns: undefined }
      activate_roster_for_range: {
        Args: {
          p_dept_id: string
          p_end_date: string
          p_org_id: string
          p_start_date: string
          p_sub_dept_id: string
        }
        Returns: Json
      }
      add_roster_subgroup_range:
        | {
            Args: {
              p_dept_id: string
              p_end_date: string
              p_group_external_id: string
              p_name: string
              p_org_id: string
              p_start_date: string
              p_sub_dept_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_end_date: string
              p_group_external_id: string
              p_name: string
              p_org_id: string
              p_start_date: string
            }
            Returns: undefined
          }
      apply_template_to_date_range_v2: {
        Args: {
          p_end_date: string
          p_source?: string
          p_start_date: string
          p_target_department_id?: string
          p_target_sub_department_id?: string
          p_template_id: string
          p_user_id: string
        }
        Returns: Json
      }
      auth_can_create_template: {
        Args: {
          p_department_id: string
          p_organization_id: string
          p_sub_department_id: string
        }
        Returns: boolean
      }
      auth_can_manage_templates: { Args: never; Returns: boolean }
      can_act_in_dept: {
        Args: { p_action: string; p_department_id: string }
        Returns: boolean
      }
      can_act_in_subdept: {
        Args: { p_action: string; p_sub_department_id: string }
        Returns: boolean
      }
      can_act_on_employee: {
        Args: { p_action: string; p_employee_id: string }
        Returns: boolean
      }
      can_act_on_shift: {
        Args: { p_action: string; p_shift_id: string }
        Returns: boolean
      }
      can_act_on_swap: {
        Args: { p_action: string; p_swap_id: string }
        Returns: boolean
      }
      can_act_on_timesheet: {
        Args: { p_action: string; p_employee_id: string; p_shift_id: string }
        Returns: boolean
      }
      can_change_certificate: {
        Args: {
          p_level: Database["public"]["Enums"]["access_level"]
          p_org_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      can_edit_roster: { Args: { p_roster_id: string }; Returns: boolean }
      can_edit_roster_group: {
        Args: { p_roster_group_id: string }
        Returns: boolean
      }
      can_edit_template: { Args: { p_template_id: string }; Returns: boolean }
      can_edit_template_group: {
        Args: { p_group_id: string }
        Returns: boolean
      }
      can_edit_template_subgroup: {
        Args: { p_subgroup_id: string }
        Returns: boolean
      }
      can_grant_certificate: {
        Args: {
          p_level: Database["public"]["Enums"]["access_level"]
          p_org_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      can_manage_contract: {
        Args: {
          p_dept_id: string
          p_org_id: string
          p_sub_dept_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      can_manage_employee_record: {
        Args: { p_employee_id: string }
        Returns: boolean
      }
      can_manage_first_aid_appointment: {
        Args: { p_employee_id: string; p_org_id: string }
        Returns: boolean
      }
      can_read_certificates_in: { Args: { p_org_id: string }; Returns: boolean }
      can_view_contract: { Args: { p_contract_id: string }; Returns: boolean }
      can_view_employee_schedule: {
        Args: { p_employee_id: string }
        Returns: boolean
      }
      can_write_contract: {
        Args: {
          p_level: Database["public"]["Enums"]["access_level"]
          p_org_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      check_in_shift: {
        Args: { p_lat: number; p_lon: number; p_shift_id: string }
        Returns: Json
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
      delete_roster_subgroup_v2: {
        Args: {
          p_dept_id: string
          p_dry_run?: boolean
          p_end_date: string
          p_group_external_id: string
          p_name: string
          p_org_id: string
          p_start_date: string
          p_sub_dept_id: string
        }
        Returns: Json
      }
      delete_user_entirely: { Args: { user_uuid: string }; Returns: undefined }
      eba_check_assignment: {
        Args: {
          p_employee_id: string
          p_end_time?: string
          p_role_id?: string
          p_shift_date?: string
          p_shift_id: string
          p_start_time?: string
          p_unpaid_break_mins?: number
        }
        Returns: {
          details: string
          is_compliant: boolean
          payload: Json
          rule_id: string
          rule_name: string
          summary: string
          tier: string
        }[]
      }
      employee_on_approved_leave: {
        Args: { p_date: string; p_employee_id: string }
        Returns: boolean
      }
      fn_eba_estimate_shift_cost: {
        Args: {
          p_base_rate: number
          p_break_start?: string
          p_employment_type: string
          p_first_aid?: boolean
          p_higher_duties?: boolean
          p_is_training?: boolean
          p_net_minutes: number
          p_requires_flexible?: boolean
          p_scheduled_minutes: number
          p_shift_date: string
          p_start_time: string
          p_unpaid_break_minutes?: number
        }
        Returns: number
      }
      fn_eba_min_engagement_minutes: {
        Args: {
          p_employment_type: string
          p_is_public_holiday: boolean
          p_is_sunday: boolean
          p_is_training: boolean
          p_requires_flexible: boolean
        }
        Returns: number
      }
      fn_eba_night_minutes: {
        Args: { p_from: number; p_to: number }
        Returns: number
      }
      fn_eba_night_multiplier: {
        Args: { p_conclusion_dow: number; p_is_casual: boolean }
        Returns: number
      }
      fn_eba_penalty_loading: {
        Args: { p_dow: number; p_is_holiday: boolean }
        Returns: number
      }
      fn_eba_resolve_shift_rate: {
        Args: {
          p_remuneration_level: number
          p_shift_date: string
          p_target_employment_type: string
        }
        Returns: number
      }
      fn_eba_shift_cost: {
        Args: { s: Database["public"]["Tables"]["shifts"]["Row"] }
        Returns: number
      }
      fn_normalize_employment_type: {
        Args: { p_value: string }
        Returns: string
      }
      fn_process_offer_expirations: {
        Args: never
        Returns: {
          from_state: string
          res_shift_id: string
          to_state: string
        }[]
      }
      fsm_op_is_legal: {
        Args: { p_op: string; p_state: string }
        Returns: boolean
      }
      get_bidding_kpis: {
        Args: {
          p_dept_ids?: string[]
          p_from: string
          p_org_ids?: string[]
          p_subdept_ids?: string[]
          p_to: string
        }
        Returns: {
          avg_bids_per_open_shift: number
          bid_success_rate: number
          open_bidding_shifts: number
          open_shift_fill_rate: number
          total_bids: number
          unfilled_open_shift_rate: number
          unfilled_open_shifts: number
          winners_selected: number
        }[]
      }
      get_broadcast_ack_stats: {
        Args: { broadcast_uuid: string }
        Returns: {
          ack_percentage: number
          acknowledged_count: number
          pending_count: number
          total_recipients: number
        }[]
      }
      get_broadcast_analytics: { Args: never; Returns: Json }
      get_broadcast_channel_group_id: {
        Args: { p_channel_id: string }
        Returns: string
      }
      get_broadcast_group_role: {
        Args: { p_group_id: string }
        Returns: string
      }
      get_cancellation_reason_breakdown: {
        Args: {
          p_dept_ids?: string[]
          p_from: string
          p_org_ids?: string[]
          p_subdept_ids?: string[]
          p_to: string
        }
        Returns: {
          avg_notice_hours: number
          critical_count: number
          emergent_count: number
          reason_code: string
          reason_label: string
          share_pct: number
          standard_count: number
          total: number
        }[]
      }
      get_dept_insights_breakdown: {
        Args: {
          p_dept_ids?: string[]
          p_end_date: string
          p_org_ids?: string[]
          p_start_date: string
          p_subdept_ids?: string[]
        }
        Returns: {
          dept_id: string
          dept_name: string
          emergency_count: number
          estimated_cost: number
          fill_rate: number
          no_show_count: number
          shifts_assigned: number
          shifts_total: number
        }[]
      }
      get_employee_quarterly_performance: {
        Args: { p_employee_id: string; p_quarter: number; p_year: number }
        Returns: {
          acceptance_rate: number
          accepted: number
          assigned: number
          attendance_compliance_rate: number
          bid_success_rate: number
          bids_accepted: number
          calculated_at: string
          cancel_rate: number
          completed: number
          early_clock_out_rate: number
          emergency_assigned: number
          employee_id: string
          engagement_score: number
          expired: number
          ignorance_rate: number
          late_cancel_rate: number
          late_clock_in_rate: number
          no_show: number
          no_show_rate: number
          performance_score: number
          rejected: number
          rejection_rate: number
          reliability_score: number
          swap_out: number
          swap_rate: number
          total_bids: number
          total_offers: number
          trade_requests: number
        }[]
      }
      get_employee_shift_window: {
        Args: {
          p_employee_id: string
          p_end_date: string
          p_exclude_id?: string
          p_start_date: string
        }
        Returns: {
          end_time: string
          id: string
          paid_break_minutes: number
          shift_date: string
          start_time: string
          unpaid_break_minutes: number
          user_contract_id: string
        }[]
      }
      get_employees_shift_window_bulk: {
        Args: {
          p_employee_ids: string[]
          p_end_date: string
          p_start_date: string
        }
        Returns: {
          assigned_employee_id: string
          end_time: string
          id: string
          paid_break_minutes: number
          shift_date: string
          start_time: string
          unpaid_break_minutes: number
          user_contract_id: string
        }[]
      }
      get_fairness_debts_latest: {
        Args: { p_as_of?: string; p_employee_ids?: string[]; p_org_id: string }
        Returns: {
          debt: number
          employee_id: string
          metric: string
          rolling_value: number
          team_average: number
          window_end: string
          window_start: string
        }[]
      }
      get_insights_summary: {
        Args: {
          p_dept_ids?: string[]
          p_end_date: string
          p_org_ids?: string[]
          p_start_date: string
          p_subdept_ids?: string[]
        }
        Returns: Json
      }
      get_insights_trend: {
        Args: {
          p_dept_ids?: string[]
          p_end_date: string
          p_org_ids?: string[]
          p_start_date: string
          p_subdept_ids?: string[]
        }
        Returns: {
          dept_id: string
          dept_name: string
          estimated_cost: number
          fill_rate: number
          period_date: string
          shifts_assigned: number
          shifts_total: number
        }[]
      }
      get_kpi_behaviour_summary: {
        Args: {
          p_dept_ids?: string[]
          p_from: string
          p_org_ids?: string[]
          p_subdept_ids?: string[]
          p_to: string
        }
        Returns: {
          attendance_compliance_rate: number
          attendance_compliant: number
          auto_clock_out: number
          auto_clock_out_rate: number
          critical_cancel_rate: number
          critical_cancellations: number
          early_clock_in: number
          early_clock_in_rate: number
          early_clock_out: number
          early_clock_out_rate: number
          emergency_assigned: number
          employees: number
          held: number
          late_clock_in: number
          late_clock_in_rate: number
          late_clock_out: number
          late_clock_out_rate: number
          no_show: number
          no_show_rate: number
          on_time_in: number
          on_time_in_rate: number
          on_time_out: number
          on_time_out_rate: number
          reassigned: number
          standard_cancel_rate: number
          standard_cancellations: number
          swapped_out: number
          total_cancel_rate: number
          worked: number
        }[]
      }
      get_kpi_behaviour_trend: {
        Args: {
          p_dept_ids?: string[]
          p_from: string
          p_grain?: string
          p_org_ids?: string[]
          p_subdept_ids?: string[]
          p_to: string
        }
        Returns: {
          attendance_compliance_rate: number
          attendance_compliant: number
          auto_clock_out: number
          bucket_start: string
          critical_cancel_rate: number
          critical_cancellations: number
          early_clock_out: number
          held: number
          late_clock_in: number
          no_show: number
          no_show_rate: number
          on_time_in: number
          standard_cancel_rate: number
          standard_cancellations: number
          swapped_out: number
          worked: number
        }[]
      }
      get_kpi_marketplace_trend: {
        Args: {
          p_dept_ids?: string[]
          p_from: string
          p_grain?: string
          p_org_ids?: string[]
          p_subdept_ids?: string[]
          p_to: string
        }
        Returns: {
          award_rate: number
          bids_placed: number
          bucket_start: string
          open_shifts: number
          swap_completion_rate: number
          swaps_cancelled: number
          swaps_completed: number
          swaps_initiated: number
          swaps_rejected: number
          winners_selected: number
        }[]
      }
      get_manager_scorecard: {
        Args: {
          p_dept_ids?: string[]
          p_from: string
          p_org_ids?: string[]
          p_subdept_ids?: string[]
          p_to: string
        }
        Returns: {
          avg_publish_lead_time_hours: number
          churn_rate: number
          covered_open_shifts: number
          distinct_shifts: number
          emergency_fill_count: number
          emergency_fill_rate: number
          employee_actions: number
          fill_rate: number
          filled_shifts: number
          managed_published_shifts: number
          manager_actions: number
          open_coverage_rate: number
          open_shifts: number
          published_snapshots: number
          reassignment_count: number
          system_actions: number
        }[]
      }
      get_marketplace_kpis: {
        Args: {
          p_dept_ids?: string[]
          p_from: string
          p_org_ids?: string[]
          p_subdept_ids?: string[]
          p_to: string
        }
        Returns: {
          avg_time_to_fill_hours: number
          churn_rate: number
          covered_open_shifts: number
          distinct_filled_shifts: number
          fill_rate: number
          filled_shifts: number
          marketplace_eligible_shifts: number
          marketplace_used_shifts: number
          marketplace_utilization_rate: number
          offer_accept_rate: number
          offer_ignore_rate: number
          offer_reject_rate: number
          offers_resolved: number
          open_coverage_rate: number
          open_shifts: number
          published_shifts: number
          published_snapshots: number
          trade_cancellation_rate: number
          trade_completion_rate: number
          trade_expiry_rate: number
          trade_rejection_rate: number
          trades_initiated: number
        }[]
      }
      get_metric_detailed_analysis: {
        Args: {
          p_dept_ids?: string[]
          p_end_date: string
          p_metric_id: string
          p_org_ids?: string[]
          p_start_date: string
        }
        Returns: Json
      }
      get_my_private_profile: {
        Args: never
        Returns: {
          date_of_birth: string
          emergency_contact_name: string
          emergency_contact_phone: string
          phone: string
        }[]
      }
      get_prospective_pay_terms: {
        Args: { p_employee_ids: string[]; p_shift_ids: string[] }
        Returns: {
          employee_id: string
          pay_terms: Json
          shift_id: string
        }[]
      }
      get_quarterly_performance_report: {
        Args: {
          p_dept_ids?: string[]
          p_org_ids?: string[]
          p_quarter: number
          p_subdept_ids?: string[]
          p_year: number
        }
        Returns: {
          acceptance_rate: number
          accepted: number
          assigned: number
          assignment_changes: number
          attendance_compliance_rate: number
          auto_clock_out: number
          auto_clock_out_rate: number
          bid_success_rate: number
          bids_accepted: number
          cancel_late: number
          cancel_rate: number
          cancel_standard: number
          completed: number
          drop_rate: number
          early_clock_in: number
          early_clock_in_rate: number
          early_clock_out: number
          early_clock_out_rate: number
          emergency_assigned: number
          employee_id: string
          employee_name: string
          engagement_score: number
          expired: number
          ignorance_rate: number
          late_cancel_rate: number
          late_clock_in: number
          late_clock_in_rate: number
          late_clock_out: number
          late_clock_out_rate: number
          no_show: number
          no_show_rate: number
          on_time_in: number
          on_time_in_rate: number
          on_time_out: number
          on_time_out_rate: number
          performance_score: number
          rejected: number
          rejection_rate: number
          reliability_score: number
          standard_drop_rate: number
          swap_out: number
          swap_rate: number
          total_bids: number
          total_offers: number
          trade_cancellation_rate: number
          trade_completion_rate: number
          trade_requests: number
          urgent_drop_rate: number
        }[]
      }
      get_roster_planner_stats: {
        Args: {
          p_department_ids?: string[]
          p_end_date: string
          p_organization_id: string
          p_start_date: string
          p_sub_department_ids?: string[]
        }
        Returns: {
          actual_cost: number
          actual_net_minutes: number
          actual_shifts: number
          assigned_shifts: number
          budget_cost: number
          cancelled_shifts: number
          costed_shifts: number
          est_cost: number
          open_shifts: number
          published_shifts: number
          scheduled_cost: number
          total_net_minutes: number
          total_shifts: number
          uncosted_shifts: number
          unique_employees: number
        }[]
      }
      get_roster_summary: {
        Args: {
          p_department_ids?: string[]
          p_end_date: string
          p_organization_id: string
          p_start_date: string
          p_sub_department_ids?: string[]
        }
        Returns: {
          assigned_shifts: number
          cancelled_shifts: number
          draft_shifts: number
          group_type: string
          open_shifts: number
          published_shifts: number
          shift_date: string
          sub_group_name: string
          total_net_minutes: number
          total_shifts: number
          unique_employees: number
        }[]
      }
      get_shift_delta: {
        Args: {
          p_dept_ids?: string[]
          p_end_date?: string
          p_org_id: string
          p_since: string
          p_start_date?: string
        }
        Returns: {
          assigned_employee_id: string
          assignment_status: Database["public"]["Enums"]["shift_assignment_status"]
          deleted_at: string
          department_id: string
          end_time: string
          id: string
          lifecycle_status: Database["public"]["Enums"]["shift_lifecycle"]
          role_id: string
          shift_date: string
          start_time: string
          sub_department_id: string
          updated_at: string
          version: number
        }[]
      }
      get_shift_fsm_state: {
        Args: {
          p_assignment_outcome: Database["public"]["Enums"]["shift_assignment_outcome"]
          p_assignment_status: Database["public"]["Enums"]["shift_assignment_status"]
          p_bidding_status?: Database["public"]["Enums"]["shift_bidding_status"]
          p_is_cancelled: boolean
          p_lifecycle_status: Database["public"]["Enums"]["shift_lifecycle"]
          p_trading_status: Database["public"]["Enums"]["shift_trading"]
        }
        Returns: string
      }
      get_shift_pay_terms: {
        Args: { p_shift_ids: string[] }
        Returns: {
          pay_terms: Json
          shift_id: string
        }[]
      }
      get_shift_start_time: { Args: { p_shift_id: string }; Returns: string }
      get_shift_state_id: { Args: { p_shift_id: string }; Returns: string }
      get_time_category: {
        Args: { p_scheduled_start: string }
        Returns: string
      }
      get_toil_balances: {
        Args: { p_employee_ids: string[] }
        Returns: {
          balance_minutes: number
          earned_minutes: number
          eligible: boolean
          employee_id: string
          has_history: boolean
          held_minutes: number
          next_expiry_date: string
          next_expiry_minutes: number
          paid_out_minutes: number
          taken_minutes: number
        }[]
      }
      get_toil_lots: {
        Args: { p_employee: string }
        Returns: {
          earned_minutes: number
          expires_on: string
          lot_date: string
          remaining_minutes: number
        }[]
      }
      has_shift_started: { Args: { p_shift_id: string }; Returns: boolean }
      holds_action: { Args: { p_action: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_broadcast_system_manager: { Args: never; Returns: boolean }
      is_first_aid_duty: {
        Args: { s: Database["public"]["Tables"]["shifts"]["Row"] }
        Returns: boolean
      }
      is_manager_or_above: { Args: never; Returns: boolean }
      is_org_admin: { Args: { p_org_id: string }; Returns: boolean }
      is_shift_timesheet_reviewable: {
        Args: { p_shift_id: string }
        Returns: boolean
      }
      is_zeta: { Args: never; Returns: boolean }
      jurisdiction_is_known: {
        Args: { p_jurisdiction: string }
        Returns: boolean
      }
      leave_accrual_days: {
        Args: { p_employee: string; p_from: string }
        Returns: number
      }
      my_shift_pay_terms: {
        Args: { s: Database["public"]["Tables"]["shifts"]["Row"] }
        Returns: Json
      }
      notify_user:
        | {
            Args: {
              p_dedup_key: string
              p_entity_id: string
              p_entity_type: string
              p_link: string
              p_message: string
              p_profile_id: string
              p_title: string
              p_type: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_arg2?: string
              p_arg3?: string
              p_arg5?: string
              p_arg6?: string
              p_text1?: string
              p_text2?: string
              p_user_id: string
            }
            Returns: undefined
          }
        | { Args: { args?: string[] }; Returns: undefined }
      preview_template_application: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_target_department_id?: string
          p_target_sub_department_id?: string
          p_template_id: string
        }
        Returns: Json
      }
      process_shift_timers: {
        Args: never
        Returns: {
          affected: number
          operation: string
        }[]
      }
      prune_fairness_ledger: {
        Args: { p_retain_days?: number }
        Returns: number
      }
      public_holiday_calendar_horizon: {
        Args: { p_jurisdiction?: string }
        Returns: string
      }
      quarter_date_range: {
        Args: { p_quarter: number; p_year: number }
        Returns: Record<string, unknown>
      }
      recompute_all_fairness_ledgers: { Args: never; Returns: number }
      recompute_fairness_ledger: {
        Args: {
          p_as_of?: string
          p_department_id?: string
          p_jurisdiction?: string
          p_org_id: string
          p_window_days?: number
        }
        Returns: number
      }
      register_push_token: {
        Args: { p_platform?: string; p_token: string }
        Returns: undefined
      }
      rename_roster_subgroup_v2: {
        Args: {
          p_dept_id: string
          p_dry_run?: boolean
          p_end_date: string
          p_group_external_id: string
          p_new_name: string
          p_old_name: string
          p_org_id: string
          p_start_date: string
          p_sub_dept_id: string
        }
        Returns: Json
      }
      request_fairness_ledger_recompute: {
        Args: { p_as_of?: string; p_org_id: string }
        Returns: number
      }
      resolve_user_permissions: { Args: never; Returns: Json }
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
      shares_organisation_with: { Args: { p_other: string }; Returns: boolean }
      shift_break_window_breach: {
        Args: {
          p_break_end: string
          p_break_start: string
          p_end_time: string
          p_start_time: string
          p_unpaid_break: number
        }
        Returns: string
      }
      shift_day_typed_shortfall: {
        Args: {
          p_end_time: string
          p_is_training: boolean
          p_jurisdiction?: string
          p_role_id: string
          p_shift_date: string
          p_start_time: string
          p_target_employment_type: string
          p_target_requires_flexible: boolean
          p_unpaid_break_minutes: number
        }
        Returns: string
      }
      shift_is_security_role: { Args: { p_role_id: string }; Returns: boolean }
      shift_minutes_after_start: {
        Args: { p_start: string; p_t: string }
        Returns: number
      }
      shift_net_minutes: {
        Args: {
          p_end_time: string
          p_start_time: string
          p_unpaid_break: number
        }
        Returns: number
      }
      shift_pay_terms: {
        Args: { s: Database["public"]["Tables"]["shifts"]["Row"] }
        Returns: Json
      }
      shift_pay_terms_for: {
        Args: {
          p_employee: string
          s: Database["public"]["Tables"]["shifts"]["Row"]
        }
        Returns: Json
      }
      sm_accept_offer: {
        Args: { p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_accept_trade: {
        Args: {
          p_compliance_snapshot?: Json
          p_offer_id: string
          p_offer_shift_id?: string
          p_offerer_id: string
          p_swap_id: string
        }
        Returns: Json
      }
      sm_all_active_contracts_ft_in: {
        Args: { p_profile_id: string; p_sub_department_id: string }
        Returns: boolean
      }
      sm_apply_shift_op: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_op: string
          p_payload?: Json
          p_shift_id: string
        }
        Returns: Json
      }
      sm_approve_peer_swap: {
        Args: {
          p_offered_shift_id: string
          p_offerer_id: string
          p_requester_id: string
          p_requester_shift_id: string
        }
        Returns: undefined
      }
      sm_bulk_assign_atomic: {
        Args: {
          p_assignments: Json
          p_expected_versions?: Json
          p_user_id?: string
        }
        Returns: Json
      }
      sm_bulk_delete_shifts: {
        Args: {
          p_deleted_by?: string
          p_reason?: string
          p_shift_ids: string[]
        }
        Returns: Json
      }
      sm_bulk_publish_shifts: {
        Args: {
          p_actor_id?: string
          p_expected_versions?: Json
          p_shift_ids: string[]
        }
        Returns: Json
      }
      sm_cancel_swap_request: { Args: { p_swap_id: string }; Returns: Json }
      sm_cert_at_least: {
        Args: {
          p_min: Database["public"]["Enums"]["access_level"]
          p_org?: string
          p_user?: string
        }
        Returns: boolean
      }
      sm_clock_in: {
        Args: { p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_clock_out_shift: {
        Args: {
          p_lat?: number
          p_lon?: number
          p_shift_id: string
          p_user_id: string
        }
        Returns: Json
      }
      sm_create_shift: {
        Args: { p_shift_data: Json; p_user_id: string }
        Returns: string
      }
      sm_create_swap_request: {
        Args: {
          p_reason?: string
          p_requester_shift_id: string
          p_target_id?: string
        }
        Returns: Json
      }
      sm_delete_shift: {
        Args: {
          p_expected_version?: number
          p_reason?: string
          p_shift_id: string
          p_user_id?: string
        }
        Returns: Json
      }
      sm_emergency_assign: {
        Args: {
          p_employee_id: string
          p_reason?: string
          p_shift_id: string
          p_user_id?: string
        }
        Returns: Json
      }
      sm_employee_drop_shift: {
        Args: {
          p_employee_id?: string
          p_reason?: string
          p_reason_code?: string
          p_shift_id: string
        }
        Returns: Json
      }
      sm_expire_offer_now: { Args: { p_shift_id: string }; Returns: Json }
      sm_handle_auto_clock_out: {
        Args: never
        Returns: {
          affected_shift_id: string
          previous_status: string
        }[]
      }
      sm_holds_active_contract_in: {
        Args: { p_profile_id: string; p_sub_department_id: string }
        Returns: boolean
      }
      sm_holds_active_ft_contract: {
        Args: { p_profile_id: string }
        Returns: boolean
      }
      sm_holds_active_ft_contract_in: {
        Args: { p_profile_id: string; p_sub_department_id: string }
        Returns: boolean
      }
      sm_legacy_manager: { Args: { p_user?: string }; Returns: boolean }
      sm_materialize_contract_envelope: {
        Args: { p_from?: string; p_profile_ids?: string[]; p_to?: string }
        Returns: {
          profiles_touched: number
          slots_removed: number
          slots_written: number
        }[]
      }
      sm_move_shift: {
        Args: {
          p_group_type?: string
          p_roster_subgroup_id?: string
          p_shift_date?: string
          p_shift_group_id?: string
          p_shift_id: string
          p_sub_group_name?: string
          p_user_id?: string
        }
        Returns: Json
      }
      sm_refresh_shift_snapshots: {
        Args: { p_shift_id: string }
        Returns: undefined
      }
      sm_reject_offer:
        | { Args: { p_shift_id: string; p_user_id: string }; Returns: Json }
        | {
            Args: { p_reason: string; p_shift_id: string; p_user_id: string }
            Returns: Json
          }
      sm_request_is_system: { Args: never; Returns: boolean }
      sm_require_assignee_or: {
        Args: { p_actor: string; p_manager_action: string; p_shift_id: string }
        Returns: undefined
      }
      sm_require_scope: {
        Args: {
          p_action: string
          p_dept_id: string
          p_org_id: string
          p_sub_dept_id: string
        }
        Returns: undefined
      }
      sm_require_shift_action: {
        Args: { p_action: string; p_shift_id: string }
        Returns: undefined
      }
      sm_require_shift_data_action: {
        Args: { p_action: string; p_shift_data: Json }
        Returns: undefined
      }
      sm_require_template_apply: {
        Args: {
          p_target_dept_id: string
          p_target_sub_dept_id: string
          p_template_id: string
        }
        Returns: undefined
      }
      sm_require_template_create_in: {
        Args: { p_sub_department_id: string }
        Returns: undefined
      }
      sm_require_template_edit: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      sm_select_bid_winner: {
        Args: { p_shift_id: string; p_user_id?: string; p_winner_id: string }
        Returns: Json
      }
      sm_unassign_shift: {
        Args: { p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      sm_unpublish_shift: {
        Args: { p_reason?: string; p_shift_id: string; p_user_id?: string }
        Returns: Json
      }
      toil_adjust: {
        Args: { p_employee: string; p_minutes: number; p_reason: string }
        Returns: string
      }
      toil_process_expiries: { Args: never; Returns: number }
      toil_request_payout: {
        Args: { p_employee: string; p_minutes: number; p_note?: string }
        Returns: string
      }
      undo_template_batch: {
        Args: { p_batch_id: string; p_dry_run?: boolean; p_user_id?: string }
        Returns: Json
      }
      user_has_access_to_swap: {
        Args: { _requester_shift_id: string; _user_id: string }
        Returns: boolean
      }
      user_has_action_in_scope: {
        Args: {
          p_action_code: string
          p_dept_id?: string
          p_org_id: string
          p_sub_dept_id?: string
        }
        Returns: boolean
      }
      user_has_delta_access: { Args: { _user_id: string }; Returns: boolean }
      user_has_swap_offer: {
        Args: { _swap_request_id: string; _user_id: string }
        Returns: boolean
      }
      user_owns_swap_request_for_offer: {
        Args: { _swap_request_id: string; _user_id: string }
        Returns: boolean
      }
      validate_template_name: {
        Args: {
          p_department_id: string
          p_exclude_id?: string
          p_name: string
          p_organization_id: string
          p_sub_department_id: string
        }
        Returns: Json
      }
      withdraw_bid_rpc: {
        Args: { p_bid_id: string; p_employee_id: string }
        Returns: Json
      }
    }
    Enums: {
      access_level: "alpha" | "beta" | "gamma" | "delta" | "epsilon" | "zeta"
      actor_type: "USER" | "SYSTEM"
      assignment_method: "manual" | "template" | "bid" | "trade" | "auto"
      assignment_status:
        | "assigned"
        | "confirmed"
        | "swapped"
        | "dropped"
        | "no_show"
      availability_type: "available" | "unavailable" | "preferred" | "limited"
      bid_status: "pending" | "accepted" | "rejected" | "withdrawn"
      bidding_priority: "normal" | "urgent" | "critical"
      broadcast_priority: "low" | "normal" | "high" | "urgent"
      broadcast_status: "draft" | "scheduled" | "sent" | "cancelled"
      bulk_operation_status: "running" | "completed" | "failed"
      cancellation_type: "standard" | "late" | "critical" | "no_show"
      compliance_status:
        | "compliant"
        | "warning"
        | "violation"
        | "pending"
        | "overridden"
      employment_status:
        | "Full-Time"
        | "Part-Time"
        | "Casual"
        | "Flexible Part-Time"
      employment_type:
        | "full_time"
        | "part_time"
        | "casual"
        | "contractual"
        | "Full-Time"
        | "Part-Time"
        | "Casual"
      event_source: "UI" | "API" | "AUTO_JOB" | "SYSTEM_RULE"
      feedback_verdict: "UNDER" | "OVER" | "OK"
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
        | "swap_expired"
        | "leave_approved"
        | "leave_rejected"
        | "timesheet_adjusted"
      rbac_scope: "SELF" | "SUB_DEPT" | "DEPT" | "ORG" | "CONTRACTED"
      roster_day_status: "draft" | "published" | "locked"
      roster_status: "draft" | "published" | "archived"
      shift_assignment_outcome:
        | "pending"
        | "offered"
        | "confirmed"
        | "emergency_assigned"
        | "no_show"
      shift_assignment_status: "assigned" | "unassigned"
      shift_attendance_status:
        | "unknown"
        | "checked_in"
        | "no_show"
        | "late"
        | "excused"
        | "auto_clock_out"
      shift_bidding_status:
        | "not_on_bidding"
        | "on_bidding_normal"
        | "on_bidding_urgent"
        | "bidding_closed_no_winner"
        | "on_bidding"
      shift_event_type:
        | "OFFERED"
        | "ACCEPTED"
        | "REJECTED"
        | "IGNORED"
        | "ASSIGNED"
        | "UNASSIGNED"
        | "EMERGENCY_ASSIGNED"
        | "CANCELLED"
        | "LATE_CANCELLED"
        | "SWAPPED_OUT"
        | "SWAPPED_IN"
        | "CHECKED_IN"
        | "LATE_IN"
        | "EARLY_OUT"
        | "NO_SHOW"
        | "OP_APPLIED"
      shift_fulfillment_status: "scheduled" | "bidding" | "offered" | "none"
      shift_lifecycle:
        | "Draft"
        | "Published"
        | "InProgress"
        | "Completed"
        | "Cancelled"
      shift_lifecycle_status:
        | "draft"
        | "published"
        | "in_progress"
        | "completed"
        | "cancelled"
      shift_status:
        | "open"
        | "assigned"
        | "confirmed"
        | "completed"
        | "cancelled"
      shift_trading:
        | "NoTrade"
        | "TradeRequested"
        | "TradeAccepted"
        | "TradeApproved"
      swap_auto_decision_kind: "AUTO_APPROVE" | "MANUAL_REVIEW" | "AUTO_REJECT"
      swap_offer_status:
        | "SUBMITTED"
        | "SELECTED"
        | "REJECTED"
        | "WITHDRAWN"
        | "EXPIRED"
      swap_request_status:
        | "OPEN"
        | "OFFER_SELECTED"
        | "MANAGER_PENDING"
        | "APPROVED"
        | "REJECTED"
        | "CANCELLED"
        | "EXPIRED"
      swap_status:
        | "pending"
        | "approved"
        | "rejected"
        | "cancelled"
        | "completed"
        | "pending_employee"
        | "pending_manager"
      synthesis_run_status: "draft" | "generated" | "reviewed" | "locked"
      system_role: "admin" | "manager" | "team_lead" | "team_member"
      template_group_type:
        | "convention_centre"
        | "exhibition_centre"
        | "theatre"
        | "the_cutaway"
        | "office"
      template_status: "draft" | "published" | "archived"
      timesheet_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "no_show"
    }
    CompositeTypes: {
      publish_batch_result: {
        success: boolean | null
        total_processed: number | null
        shifts_created: number | null
        shifts_updated: number | null
        shifts_skipped: number | null
        errors: Json | null
      }
      shift_validation_result: {
        is_valid: boolean | null
        error_code: string | null
        error_message: string | null
        warnings: Json | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      access_level: ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"],
      actor_type: ["USER", "SYSTEM"],
      assignment_method: ["manual", "template", "bid", "trade", "auto"],
      assignment_status: [
        "assigned",
        "confirmed",
        "swapped",
        "dropped",
        "no_show",
      ],
      availability_type: ["available", "unavailable", "preferred", "limited"],
      bid_status: ["pending", "accepted", "rejected", "withdrawn"],
      bidding_priority: ["normal", "urgent", "critical"],
      broadcast_priority: ["low", "normal", "high", "urgent"],
      broadcast_status: ["draft", "scheduled", "sent", "cancelled"],
      bulk_operation_status: ["running", "completed", "failed"],
      cancellation_type: ["standard", "late", "critical", "no_show"],
      compliance_status: [
        "compliant",
        "warning",
        "violation",
        "pending",
        "overridden",
      ],
      employment_status: [
        "Full-Time",
        "Part-Time",
        "Casual",
        "Flexible Part-Time",
      ],
      employment_type: [
        "full_time",
        "part_time",
        "casual",
        "contractual",
        "Full-Time",
        "Part-Time",
        "Casual",
      ],
      event_source: ["UI", "API", "AUTO_JOB", "SYSTEM_RULE"],
      feedback_verdict: ["UNDER", "OVER", "OK"],
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
        "swap_expired",
        "leave_approved",
        "leave_rejected",
        "timesheet_adjusted",
      ],
      rbac_scope: ["SELF", "SUB_DEPT", "DEPT", "ORG", "CONTRACTED"],
      roster_day_status: ["draft", "published", "locked"],
      roster_status: ["draft", "published", "archived"],
      shift_assignment_outcome: [
        "pending",
        "offered",
        "confirmed",
        "emergency_assigned",
        "no_show",
      ],
      shift_assignment_status: ["assigned", "unassigned"],
      shift_attendance_status: [
        "unknown",
        "checked_in",
        "no_show",
        "late",
        "excused",
        "auto_clock_out",
      ],
      shift_bidding_status: [
        "not_on_bidding",
        "on_bidding_normal",
        "on_bidding_urgent",
        "bidding_closed_no_winner",
        "on_bidding",
      ],
      shift_event_type: [
        "OFFERED",
        "ACCEPTED",
        "REJECTED",
        "IGNORED",
        "ASSIGNED",
        "UNASSIGNED",
        "EMERGENCY_ASSIGNED",
        "CANCELLED",
        "LATE_CANCELLED",
        "SWAPPED_OUT",
        "SWAPPED_IN",
        "CHECKED_IN",
        "LATE_IN",
        "EARLY_OUT",
        "NO_SHOW",
        "OP_APPLIED",
      ],
      shift_fulfillment_status: ["scheduled", "bidding", "offered", "none"],
      shift_lifecycle: [
        "Draft",
        "Published",
        "InProgress",
        "Completed",
        "Cancelled",
      ],
      shift_lifecycle_status: [
        "draft",
        "published",
        "in_progress",
        "completed",
        "cancelled",
      ],
      shift_status: ["open", "assigned", "confirmed", "completed", "cancelled"],
      shift_trading: [
        "NoTrade",
        "TradeRequested",
        "TradeAccepted",
        "TradeApproved",
      ],
      swap_auto_decision_kind: ["AUTO_APPROVE", "MANUAL_REVIEW", "AUTO_REJECT"],
      swap_offer_status: [
        "SUBMITTED",
        "SELECTED",
        "REJECTED",
        "WITHDRAWN",
        "EXPIRED",
      ],
      swap_request_status: [
        "OPEN",
        "OFFER_SELECTED",
        "MANAGER_PENDING",
        "APPROVED",
        "REJECTED",
        "CANCELLED",
        "EXPIRED",
      ],
      swap_status: [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "completed",
        "pending_employee",
        "pending_manager",
      ],
      synthesis_run_status: ["draft", "generated", "reviewed", "locked"],
      system_role: ["admin", "manager", "team_lead", "team_member"],
      template_group_type: [
        "convention_centre",
        "exhibition_centre",
        "theatre",
        "the_cutaway",
        "office",
      ],
      template_status: ["draft", "published", "archived"],
      timesheet_status: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "no_show",
      ],
    },
  },
} as const
