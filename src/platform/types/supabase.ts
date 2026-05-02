export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      actual_labor_attendance: {
        Row: {
          assigned: number
          created_at: string
          event_id: string
          id: string
          present: number
          role: string
          time_slot: number
        }
        Insert: {
          assigned?: number
          created_at?: string
          event_id: string
          id?: string
          present?: number
          role: string
          time_slot: number
        }
        Update: {
          assigned?: number
          created_at?: string
          event_id?: string
          id?: string
          present?: number
          role?: string
          time_slot?: number
        }
        Relationships: []
      }
      app_access_certificates: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"]
          certificate_type: string
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
          certificate_type: string
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
            foreignKeyName: "app_access_certificates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_performance_data_quality_alerts"
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
            foreignKeyName: "attendance_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
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
          reason: string | null
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
          reason?: string | null
          repeat_days?: number[] | null
          repeat_end_date?: string | null
          repeat_type?: string
          start_date: string
          start_time: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          profile_id?: string
          reason?: string | null
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
          },
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
          },
        ]
      }
      broadcast_acknowledgements: {
        Row: {
          acknowledged_at: string
          broadcast_id: string
          employee_id: string
          id: string
        }
        Insert: {
          acknowledged_at?: string
          broadcast_id: string
          employee_id: string
          id?: string
        }
        Update: {
          acknowledged_at?: string
          broadcast_id?: string
          employee_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_acknowledgements_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_acknowledgements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_attachments: {
        Row: {
          broadcast_id: string
          created_at: string
          file_name: string
          file_size: number | null
          file_type: string
          file_url: string
          id: string
        }
        Insert: {
          broadcast_id: string
          created_at?: string
          file_name: string
          file_size?: number | null
          file_type: string
          file_url: string
          id?: string
        }
        Update: {
          broadcast_id?: string
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_type?: string
          file_url?: string
          id?: string
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
          created_at: string
          description: string | null
          group_id: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          group_id: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          group_id?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
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
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string | null
          sub_department_id: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string | null
          sub_department_id?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string | null
          sub_department_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "broadcast_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_performance_data_quality_alerts"
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
          author_name: string | null
          broadcast_id: string
          channel_id: string | null
          created_at: string
          employee_id: string
          id: string
          is_read: boolean
          priority: string | null
          subject: string | null
        }
        Insert: {
          author_name?: string | null
          broadcast_id: string
          channel_id?: string | null
          created_at?: string
          employee_id: string
          id?: string
          is_read?: boolean
          priority?: string | null
          subject?: string | null
        }
        Update: {
          author_name?: string | null
          broadcast_id?: string
          channel_id?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          is_read?: boolean
          priority?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_notifications_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_notifications_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "broadcast_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_notifications_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "v_channels_with_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_read_status: {
        Row: {
          broadcast_id: string
          employee_id: string
          id: string
          read_at: string
        }
        Insert: {
          broadcast_id: string
          employee_id: string
          id?: string
          read_at?: string
        }
        Update: {
          broadcast_id?: string
          employee_id?: string
          id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_read_status_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_read_status_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          author_id: string
          channel_id: string
          content: string
          created_at: string
          id: string
          is_archived: boolean
          is_pinned: boolean
          organization_id: string | null
          priority: string
          requires_acknowledgement: boolean
          subject: string
          updated_at: string
        }
        Insert: {
          author_id: string
          channel_id: string
          content: string
          created_at?: string
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          organization_id?: string | null
          priority?: string
          requires_acknowledgement?: boolean
          subject: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          channel_id?: string
          content?: string
          created_at?: string
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          organization_id?: string | null
          priority?: string
          requires_acknowledgement?: boolean
          subject?: string
          updated_at?: string
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
            foreignKeyName: "broadcasts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_performance_data_quality_alerts"
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
          {
            foreignKeyName: "cancellation_history_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_shifts: {
        Row: {
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          department_id: string | null
          id: string
          organization_id: string | null
          snapshot_data: Json
          template_id: string | null
        }
        Insert: {
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          department_id?: string | null
          id?: string
          organization_id?: string | null
          snapshot_data: Json
          template_id?: string | null
        }
        Update: {
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          department_id?: string | null
          id?: string
          organization_id?: string | null
          snapshot_data?: Json
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deleted_shifts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deleted_shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deleted_shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_performance_data_quality_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      demand_forecasts: {
        Row: {
          corrected_count: number
          correction_factor: number
          created_at: string | null
          created_by: string | null
          event_id: string | null
          feature_payload: Json | null
          id: string
          is_locked: boolean
          model_version: string | null
          predicted_count: number
          role: string
          role_id: string | null
          scenario_id: string | null
          source: string
          synthesis_run_id: string | null
          time_slot: number
          version: number
        }
        Insert: {
          corrected_count?: number
          correction_factor?: number
          created_at?: string | null
          created_by?: string | null
          event_id?: string | null
          feature_payload?: Json | null
          id?: string
          is_locked?: boolean
          model_version?: string | null
          predicted_count?: number
          role: string
          role_id?: string | null
          scenario_id?: string | null
          source?: string
          synthesis_run_id?: string | null
          time_slot?: number
          version?: number
        }
        Update: {
          corrected_count?: number
          correction_factor?: number
          created_at?: string | null
          created_by?: string | null
          event_id?: string | null
          feature_payload?: Json | null
          id?: string
          is_locked?: boolean
          model_version?: string | null
          predicted_count?: number
          role?: string
          role_id?: string | null
          scenario_id?: string | null
          source?: string
          synthesis_run_id?: string | null
          time_slot?: number
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
          created_at: string
          event_id: string | null
          execution_timestamp: string
          explanation: Json
          feedback_multiplier_used: number
          function_code: string
          headcount: number
          id: string
          level: number
          rule_version_id: string | null
          slice_idx: number
          synthesis_run_id: string | null
          timecard_ratio_used: number
        }
        Insert: {
          baseline: number
          binding_constraint?: string | null
          created_at?: string
          event_id?: string | null
          execution_timestamp?: string
          explanation?: Json
          feedback_multiplier_used: number
          function_code: string
          headcount: number
          id?: string
          level: number
          rule_version_id?: string | null
          slice_idx: number
          synthesis_run_id?: string | null
          timecard_ratio_used: number
        }
        Update: {
          baseline?: number
          binding_constraint?: string | null
          created_at?: string
          event_id?: string | null
          execution_timestamp?: string
          explanation?: Json
          feedback_multiplier_used?: number
          function_code?: string
          headcount?: number
          id?: string
          level?: number
          rule_version_id?: string | null
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
      departments: {
        Row: {
          code: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
        }
        Update: {
          code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
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
            referencedRelation: "v_performance_data_quality_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_performance_metrics: {
        Row: {
          acceptance_rate: number
          calculated_at: string
          cancellation_rate_late: number
          cancellation_rate_standard: number
          early_clock_out_rate: number
          early_clock_outs: number
          emergency_assignments: number
          employee_id: string
          id: string
          is_locked: boolean
          late_cancellations: number
          late_clock_in_rate: number
          late_clock_ins: number
          no_show_rate: number
          no_shows: number
          offer_expiration_rate: number
          offer_expirations: number
          period_end: string
          period_start: string
          quarter_year: string
          rejection_rate: number
          reliability_score: number
          shifts_accepted: number
          shifts_assigned: number
          shifts_offered: number
          shifts_rejected: number
          shifts_swapped: number
          shifts_worked: number
          standard_cancellations: number
          swap_ratio: number
        }
        Insert: {
          acceptance_rate?: number
          calculated_at?: string
          cancellation_rate_late?: number
          cancellation_rate_standard?: number
          early_clock_out_rate?: number
          early_clock_outs?: number
          emergency_assignments?: number
          employee_id: string
          id?: string
          is_locked?: boolean
          late_cancellations?: number
          late_clock_in_rate?: number
          late_clock_ins?: number
          no_show_rate?: number
          no_shows?: number
          offer_expiration_rate?: number
          offer_expirations?: number
          period_end: string
          period_start: string
          quarter_year: string
          rejection_rate?: number
          reliability_score?: number
          shifts_accepted?: number
          shifts_assigned?: number
          shifts_offered?: number
          shifts_rejected?: number
          shifts_swapped?: number
          shifts_worked?: number
          standard_cancellations?: number
          swap_ratio?: number
        }
        Update: {
          acceptance_rate?: number
          calculated_at?: string
          cancellation_rate_late?: number
          cancellation_rate_standard?: number
          early_clock_out_rate?: number
          early_clock_outs?: number
          emergency_assignments?: number
          employee_id?: string
          id?: string
          is_locked?: boolean
          late_cancellations?: number
          late_clock_in_rate?: number
          late_clock_ins?: number
          no_show_rate?: number
          no_shows?: number
          offer_expiration_rate?: number
          offer_expirations?: number
          period_end?: string
          period_start?: string
          quarter_year?: string
          rejection_rate?: number
          reliability_score?: number
          shifts_accepted?: number
          shifts_assigned?: number
          shifts_offered?: number
          shifts_rejected?: number
          shifts_swapped?: number
          shifts_worked?: number
          standard_cancellations?: number
          swap_ratio?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_performance_metrics_employee_id_fkey"
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
        Relationships: []
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
        Relationships: [
          {
            foreignKeyName: "events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_performance_data_quality_alerts"
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
      group_participants: {
        Row: {
          employee_id: string
          group_id: string
          id: string
          joined_at: string
          role: string
        }
        Insert: {
          employee_id: string
          group_id: string
          id?: string
          joined_at?: string
          role?: string
        }
        Update: {
          employee_id?: string
          group_id?: string
          id?: string
          joined_at?: string
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
          profile_id: string | null
          read_at: string | null
          title: string | null
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
          profile_id?: string | null
          read_at?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
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
          profile_id?: string | null
          read_at?: string | null
          title?: string | null
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
          avatar_url: string | null
          created_at: string | null
          email: string
          employment_type: string | null
          first_name: string
          full_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          employment_type?: string | null
          first_name: string
          full_name?: string | null
          id: string
          last_name?: string | null
          phone?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          employment_type?: string | null
          first_name?: string
          full_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          status?: string | null
          updated_at?: string | null
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
          created_at: string | null
          scope: string | null
        }
        Insert: {
          access_level: Database["public"]["Enums"]["access_level"]
          action_code: string
          created_at?: string | null
          scope?: string | null
        }
        Update: {
          access_level?: Database["public"]["Enums"]["access_level"]
          action_code?: string
          created_at?: string | null
          scope?: string | null
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
      roles: {
        Row: {
          code: string | null
          created_at: string | null
          department_id: string | null
          description: string | null
          employment_type: string | null
          forecasting_bucket: string | null
          id: string
          is_active: boolean | null
          is_baseline_eligible: boolean | null
          level: number
          name: string
          remuneration_level_id: string | null
          responsibilities: string[] | null
          sub_department_id: string | null
          supervision_ratio_max: number | null
          supervision_ratio_min: number | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          employment_type?: string | null
          forecasting_bucket?: string | null
          id?: string
          is_active?: boolean | null
          is_baseline_eligible?: boolean | null
          level?: number
          name: string
          remuneration_level_id?: string | null
          responsibilities?: string[] | null
          sub_department_id?: string | null
          supervision_ratio_max?: number | null
          supervision_ratio_min?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          employment_type?: string | null
          forecasting_bucket?: string | null
          id?: string
          is_active?: boolean | null
          is_baseline_eligible?: boolean | null
          level?: number
          name?: string
          remuneration_level_id?: string | null
          responsibilities?: string[] | null
          sub_department_id?: string | null
          supervision_ratio_max?: number | null
          supervision_ratio_min?: number | null
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
        ]
      }
      roster_days: {
        Row: {
          created_at: string | null
          date: string
          department_id: string | null
          id: string
          organization_id: string
          roster_id: string
          sub_department_id: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          department_id?: string | null
          id?: string
          organization_id: string
          roster_id: string
          sub_department_id?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          department_id?: string | null
          id?: string
          organization_id?: string
          roster_id?: string
          sub_department_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_days_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "rosters"
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
          roster_day_id: string
          roster_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          external_id?: string | null
          id?: string
          name: string
          roster_day_id: string
          roster_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          external_id?: string | null
          id?: string
          name?: string
          roster_day_id?: string
          roster_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
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
            foreignKeyName: "roster_groups_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "rosters"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_shift_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          confirmed_at: string | null
          employee_id: string | null
          id: string
          roster_shift_id: string | null
          status: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          confirmed_at?: string | null
          employee_id?: string | null
          id?: string
          roster_shift_id?: string | null
          status?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          confirmed_at?: string | null
          employee_id?: string | null
          id?: string
          roster_shift_id?: string | null
          status?: string | null
        }
        Relationships: [
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
          created_at: string | null
          end_time: string
          id: string
          lifecycle:
            | Database["public"]["Enums"]["shift_lifecycle_status"]
            | null
          name: string | null
          paid_break_minutes: number | null
          published_at: string | null
          published_by: string | null
          published_to_shift_id: string | null
          role_id: string | null
          roster_subgroup_id: string
          start_time: string
          unpaid_break_minutes: number | null
        }
        Insert: {
          created_at?: string | null
          end_time: string
          id?: string
          lifecycle?:
            | Database["public"]["Enums"]["shift_lifecycle_status"]
            | null
          name?: string | null
          paid_break_minutes?: number | null
          published_at?: string | null
          published_by?: string | null
          published_to_shift_id?: string | null
          role_id?: string | null
          roster_subgroup_id: string
          start_time: string
          unpaid_break_minutes?: number | null
        }
        Update: {
          created_at?: string | null
          end_time?: string
          id?: string
          lifecycle?:
            | Database["public"]["Enums"]["shift_lifecycle_status"]
            | null
          name?: string | null
          paid_break_minutes?: number | null
          published_at?: string | null
          published_by?: string | null
          published_to_shift_id?: string | null
          role_id?: string | null
          roster_subgroup_id?: string
          start_time?: string
          unpaid_break_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_shifts_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_roster_subgroup_id_fkey"
            columns: ["roster_subgroup_id"]
            isOneToOne: false
            referencedRelation: "roster_subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_subgroups: {
        Row: {
          created_at: string | null
          id: string
          min_headcount: number | null
          name: string
          required_headcount: number | null
          roster_group_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          min_headcount?: number | null
          name: string
          required_headcount?: number | null
          roster_group_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          min_headcount?: number | null
          name?: string
          required_headcount?: number | null
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
      roster_template_batches: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          created_at: string | null
          end_date: string | null
          id: string
          source: string | null
          start_date: string | null
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string | null
          end_date?: string | null
          id?: string
          source?: string | null
          start_date?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string | null
          end_date?: string | null
          id?: string
          source?: string | null
          start_date?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
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
          created_at: string | null
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
          applied_count?: number | null
          created_at?: string | null
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
          applied_count?: number | null
          created_at?: string | null
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
            foreignKeyName: "roster_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_performance_data_quality_alerts"
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
          start_date: string
          status: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id: string | null
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
          start_date: string
          status?: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id?: string | null
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
          start_date?: string
          status?: Database["public"]["Enums"]["roster_status"] | null
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
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
            foreignKeyName: "rosters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_performance_data_quality_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_bids: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          shift_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          shift_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          shift_id?: string
          status?: string
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
            foreignKeyName: "shift_bids_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bids_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_swaps: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          manager_approved: boolean | null
          reason: string | null
          rejection_reason: string | null
          requester_id: string
          requester_shift_id: string
          status: Database["public"]["Enums"]["swap_request_status"] | null
          status_changed_at: string | null
          swap_type: string | null
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
          expires_at?: string | null
          id?: string
          manager_approved?: boolean | null
          reason?: string | null
          rejection_reason?: string | null
          requester_id: string
          requester_shift_id: string
          status?: Database["public"]["Enums"]["swap_request_status"] | null
          status_changed_at?: string | null
          swap_type?: string | null
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
          expires_at?: string | null
          id?: string
          manager_approved?: boolean | null
          reason?: string | null
          rejection_reason?: string | null
          requester_id?: string
          requester_shift_id?: string
          status?: Database["public"]["Enums"]["swap_request_status"] | null
          status_changed_at?: string | null
          swap_type?: string | null
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
            foreignKeyName: "shift_swaps_requester_shift_id_fkey"
            columns: ["requester_shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
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
          {
            foreignKeyName: "shift_swaps_target_shift_id_fkey"
            columns: ["target_shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          actual_end: string | null
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
          bidding_enabled: boolean | null
          bidding_open_at: string | null
          bidding_status: Database["public"]["Enums"]["shift_bidding_status"]
          break_minutes: number | null
          cancellation_reason: string | null
          compliance_checked_at: string | null
          compliance_override: boolean | null
          confirmed_at: string | null
          created_at: string | null
          creation_source: string | null
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
          event_tags: Json | null
          fulfillment_status: Database["public"]["Enums"]["shift_fulfillment_status"]
          group_type: Database["public"]["Enums"]["template_group_type"] | null
          id: string
          is_cancelled: boolean
          is_draft: boolean | null
          is_from_template: boolean
          is_on_bidding: boolean | null
          is_overnight: boolean
          is_published: boolean | null
          is_urgent: boolean | null
          last_dropped_by: string | null
          last_modified_by: string | null
          last_modified_reason: string | null
          last_rejected_by: string | null
          lifecycle_status: Database["public"]["Enums"]["shift_lifecycle"]
          net_length_minutes: number | null
          notes: string | null
          offer_expires_at: string | null
          organization_id: string
          paid_break_minutes: number | null
          published_at: string | null
          published_by_user_id: string | null
          remuneration_level_id: string | null
          remuneration_rate: number | null
          required_licenses: Json | null
          required_skills: Json | null
          role_id: string | null
          roster_date: string | null
          roster_id: string
          roster_shift_id: string | null
          roster_subgroup_id: string | null
          roster_template_id: string | null
          scheduled_end: string | null
          scheduled_length_minutes: number | null
          scheduled_start: string | null
          shift_date: string
          shift_group_id: string | null
          shift_subgroup_id: string | null
          start_at: string | null
          start_time: string
          sub_department_id: string | null
          sub_group_name: string | null
          synthesis_run_id: string | null
          tags: Json | null
          target_employment_type: string | null
          template_batch_id: string | null
          template_group:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id: string | null
          template_instance_id: string | null
          template_sub_group: string | null
          timezone: string | null
          total_hours: number | null
          trading_status: Database["public"]["Enums"]["shift_trading"]
          unpaid_break_minutes: number | null
          updated_at: string | null
          user_contract_id: string | null
          version: number
        }
        Insert: {
          actual_end?: string | null
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
          bidding_enabled?: boolean | null
          bidding_open_at?: string | null
          bidding_status?: Database["public"]["Enums"]["shift_bidding_status"]
          break_minutes?: number | null
          cancellation_reason?: string | null
          compliance_checked_at?: string | null
          compliance_override?: boolean | null
          confirmed_at?: string | null
          created_at?: string | null
          creation_source?: string | null
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
          event_tags?: Json | null
          fulfillment_status?: Database["public"]["Enums"]["shift_fulfillment_status"]
          group_type?: Database["public"]["Enums"]["template_group_type"] | null
          id?: string
          is_cancelled?: boolean
          is_draft?: boolean | null
          is_from_template?: boolean
          is_on_bidding?: boolean | null
          is_overnight?: boolean
          is_published?: boolean | null
          is_urgent?: boolean | null
          last_dropped_by?: string | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          last_rejected_by?: string | null
          lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle"]
          net_length_minutes?: number | null
          notes?: string | null
          offer_expires_at?: string | null
          organization_id: string
          paid_break_minutes?: number | null
          published_at?: string | null
          published_by_user_id?: string | null
          remuneration_level_id?: string | null
          remuneration_rate?: number | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          roster_date?: string | null
          roster_id: string
          roster_shift_id?: string | null
          roster_subgroup_id?: string | null
          roster_template_id?: string | null
          scheduled_end?: string | null
          scheduled_length_minutes?: number | null
          scheduled_start?: string | null
          shift_date: string
          shift_group_id?: string | null
          shift_subgroup_id?: string | null
          start_at?: string | null
          start_time: string
          sub_department_id?: string | null
          sub_group_name?: string | null
          synthesis_run_id?: string | null
          tags?: Json | null
          target_employment_type?: string | null
          template_batch_id?: string | null
          template_group?:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id?: string | null
          template_instance_id?: string | null
          template_sub_group?: string | null
          timezone?: string | null
          total_hours?: number | null
          trading_status?: Database["public"]["Enums"]["shift_trading"]
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          user_contract_id?: string | null
          version?: number
        }
        Update: {
          actual_end?: string | null
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
          bidding_enabled?: boolean | null
          bidding_open_at?: string | null
          bidding_status?: Database["public"]["Enums"]["shift_bidding_status"]
          break_minutes?: number | null
          cancellation_reason?: string | null
          compliance_checked_at?: string | null
          compliance_override?: boolean | null
          confirmed_at?: string | null
          created_at?: string | null
          creation_source?: string | null
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
          event_tags?: Json | null
          fulfillment_status?: Database["public"]["Enums"]["shift_fulfillment_status"]
          group_type?: Database["public"]["Enums"]["template_group_type"] | null
          id?: string
          is_cancelled?: boolean
          is_draft?: boolean | null
          is_from_template?: boolean
          is_on_bidding?: boolean | null
          is_overnight?: boolean
          is_published?: boolean | null
          is_urgent?: boolean | null
          last_dropped_by?: string | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          last_rejected_by?: string | null
          lifecycle_status?: Database["public"]["Enums"]["shift_lifecycle"]
          net_length_minutes?: number | null
          notes?: string | null
          offer_expires_at?: string | null
          organization_id?: string
          paid_break_minutes?: number | null
          published_at?: string | null
          published_by_user_id?: string | null
          remuneration_level_id?: string | null
          remuneration_rate?: number | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          roster_date?: string | null
          roster_id?: string
          roster_shift_id?: string | null
          roster_subgroup_id?: string | null
          roster_template_id?: string | null
          scheduled_end?: string | null
          scheduled_length_minutes?: number | null
          scheduled_start?: string | null
          shift_date?: string
          shift_group_id?: string | null
          shift_subgroup_id?: string | null
          start_at?: string | null
          start_time?: string
          sub_department_id?: string | null
          sub_group_name?: string | null
          synthesis_run_id?: string | null
          tags?: Json | null
          target_employment_type?: string | null
          template_batch_id?: string | null
          template_group?:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id?: string | null
          template_instance_id?: string | null
          template_sub_group?: string | null
          timezone?: string | null
          total_hours?: number | null
          trading_status?: Database["public"]["Enums"]["shift_trading"]
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          user_contract_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "shifts_assigned_employee_id_fkey"
            columns: ["assigned_employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_performance_data_quality_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_remuneration_level_id_fkey"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
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
            foreignKeyName: "shifts_roster_shift_id_fkey"
            columns: ["roster_shift_id"]
            isOneToOne: false
            referencedRelation: "roster_shifts"
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
            foreignKeyName: "shifts_roster_template_id_fkey"
            columns: ["roster_template_id"]
            isOneToOne: false
            referencedRelation: "roster_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_template_id_fkey"
            columns: ["roster_template_id"]
            isOneToOne: false
            referencedRelation: "v_template_full"
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
            foreignKeyName: "shifts_user_contract_id_fkey"
            columns: ["user_contract_id"]
            isOneToOne: false
            referencedRelation: "user_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_departments: {
        Row: {
          code: string | null
          created_at: string | null
          department_id: string
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          department_id: string
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          code?: string | null
          created_at?: string | null
          department_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
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
            foreignKeyName: "swap_offers_offered_shift_id_fkey"
            columns: ["offered_shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
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
      synthesis_runs: {
        Row: {
          attempted_count: number
          created_at: string
          created_by: string
          created_count: number
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
      template_groups: {
        Row: {
          color: string | null
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
          color?: string | null
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
          color?: string | null
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
          day_of_week: number
          end_time: string
          event_tags: Json | null
          id: string
          name: string | null
          notes: string | null
          paid_break_minutes: number | null
          required_licenses: Json | null
          required_skills: Json | null
          role_id: string | null
          site_tags: Json | null
          sort_order: number
          start_time: string
          subgroup_id: string
          unpaid_break_minutes: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week?: number
          end_time: string
          event_tags?: Json | null
          id?: string
          name?: string | null
          notes?: string | null
          paid_break_minutes?: number | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          site_tags?: Json | null
          sort_order?: number
          start_time: string
          subgroup_id: string
          unpaid_break_minutes?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          event_tags?: Json | null
          id?: string
          name?: string | null
          notes?: string | null
          paid_break_minutes?: number | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          site_tags?: Json | null
          sort_order?: number
          start_time?: string
          subgroup_id?: string
          unpaid_break_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
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
      timesheets: {
        Row: {
          clock_in: string | null
          clock_out: string | null
          created_at: string
          employee_id: string
          end_time: string | null
          id: string
          notes: string | null
          rejected_reason: string | null
          shift_id: string
          start_time: string | null
          status: string
          updated_at: string
        }
        Insert: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          employee_id: string
          end_time?: string | null
          id?: string
          notes?: string | null
          rejected_reason?: string | null
          shift_id: string
          start_time?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          employee_id?: string
          end_time?: string | null
          id?: string
          notes?: string | null
          rejected_reason?: string | null
          shift_id?: string
          start_time?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_grouped"
            referencedColumns: ["id"]
          },
        ]
      }
      user_contracts: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"] | null
          created_at: string | null
          created_by: string | null
          custom_hourly_rate: number | null
          department_id: string | null
          employment_status: string | null
          end_date: string | null
          id: string
          notes: string | null
          organization_id: string
          rem_level_id: string | null
          role_id: string | null
          start_date: string | null
          status: string | null
          sub_department_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_level?: Database["public"]["Enums"]["access_level"] | null
          created_at?: string | null
          created_by?: string | null
          custom_hourly_rate?: number | null
          department_id?: string | null
          employment_status?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          rem_level_id?: string | null
          role_id?: string | null
          start_date?: string | null
          status?: string | null
          sub_department_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["access_level"] | null
          created_at?: string | null
          created_by?: string | null
          custom_hourly_rate?: number | null
          department_id?: string | null
          employment_status?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          rem_level_id?: string | null
          role_id?: string | null
          start_date?: string | null
          status?: string | null
          sub_department_id?: string | null
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
            referencedRelation: "v_performance_data_quality_alerts"
            referencedColumns: ["id"]
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
            foreignKeyName: "user_contracts_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "sub_departments"
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
    }
    Views: {
      employee_daily_metrics: {
        Row: {
          accepted: number | null
          assigned: number | null
          cancelled: number | null
          early_out: number | null
          emergency: number | null
          employee_id: string | null
          event_date: string | null
          ignored: number | null
          late_cancelled: number | null
          late_in: number | null
          no_show: number | null
          offered: number | null
          rejected: number | null
          swapped: number | null
          worked: number | null
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
            foreignKeyName: "broadcast_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "broadcast_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_performance_data_quality_alerts"
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
      v_performance_data_quality_alerts: {
        Row: {
          id: string | null
        }
        Insert: {
          id?: string | null
        }
        Update: {
          id?: string | null
        }
        Relationships: []
      }
      v_shifts_grouped: {
        Row: {
          assigned_at: string | null
          assigned_employee_id: string | null
          assignment_outcome:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_source: string | null
          assignment_status:
            | Database["public"]["Enums"]["shift_assignment_status"]
            | null
          attendance_status:
            | Database["public"]["Enums"]["shift_attendance_status"]
            | null
          bidding_close_at: string | null
          bidding_enabled: boolean | null
          bidding_open_at: string | null
          bidding_status:
            | Database["public"]["Enums"]["shift_bidding_status"]
            | null
          cancellation_reason: string | null
          compliance_checked_at: string | null
          confirmed_at: string | null
          created_at: string | null
          creation_source: string | null
          deleted_at: string | null
          department_id: string | null
          display_order: number | null
          dropped_by_id: string | null
          eligibility_snapshot: Json | null
          emergency_assigned_at: string | null
          emergency_assigned_by: string | null
          end_time: string | null
          event_tags: Json | null
          fulfillment_status:
            | Database["public"]["Enums"]["shift_fulfillment_status"]
            | null
          group_type: Database["public"]["Enums"]["template_group_type"] | null
          id: string | null
          is_cancelled: boolean | null
          is_draft: boolean | null
          is_from_template: boolean | null
          is_on_bidding: boolean | null
          is_overnight: boolean | null
          is_published: boolean | null
          is_urgent: boolean | null
          last_modified_by: string | null
          last_modified_reason: string | null
          lifecycle_status:
            | Database["public"]["Enums"]["shift_lifecycle"]
            | null
          notes: string | null
          organization_id: string | null
          paid_break_minutes: number | null
          published_at: string | null
          published_by_user_id: string | null
          remuneration_level_id: string | null
          required_licenses: Json | null
          required_skills: Json | null
          role_id: string | null
          roster_date: string | null
          roster_id: string | null
          roster_shift_id: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          shift_date: string | null
          shift_group_id: string | null
          shift_subgroup_id: string | null
          start_time: string | null
          sub_department_id: string | null
          sub_group_name: string | null
          synthesis_run_id: string | null
          tags: Json | null
          template_group:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id: string | null
          template_instance_id: string | null
          template_sub_group: string | null
          trading_status: Database["public"]["Enums"]["shift_trading"] | null
          unpaid_break_minutes: number | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_employee_id?: string | null
          assignment_outcome?:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_source?: string | null
          assignment_status?:
            | Database["public"]["Enums"]["shift_assignment_status"]
            | null
          attendance_status?:
            | Database["public"]["Enums"]["shift_attendance_status"]
            | null
          bidding_close_at?: string | null
          bidding_enabled?: boolean | null
          bidding_open_at?: string | null
          bidding_status?:
            | Database["public"]["Enums"]["shift_bidding_status"]
            | null
          cancellation_reason?: string | null
          compliance_checked_at?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          creation_source?: string | null
          deleted_at?: string | null
          department_id?: string | null
          display_order?: number | null
          dropped_by_id?: string | null
          eligibility_snapshot?: Json | null
          emergency_assigned_at?: string | null
          emergency_assigned_by?: string | null
          end_time?: string | null
          event_tags?: Json | null
          fulfillment_status?:
            | Database["public"]["Enums"]["shift_fulfillment_status"]
            | null
          group_type?: Database["public"]["Enums"]["template_group_type"] | null
          id?: string | null
          is_cancelled?: boolean | null
          is_draft?: boolean | null
          is_from_template?: boolean | null
          is_on_bidding?: boolean | null
          is_overnight?: boolean | null
          is_published?: boolean | null
          is_urgent?: boolean | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          lifecycle_status?:
            | Database["public"]["Enums"]["shift_lifecycle"]
            | null
          notes?: string | null
          organization_id?: string | null
          paid_break_minutes?: number | null
          published_at?: string | null
          published_by_user_id?: string | null
          remuneration_level_id?: string | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          roster_date?: string | null
          roster_id?: string | null
          roster_shift_id?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          shift_date?: string | null
          shift_group_id?: string | null
          shift_subgroup_id?: string | null
          start_time?: string | null
          sub_department_id?: string | null
          sub_group_name?: string | null
          synthesis_run_id?: string | null
          tags?: Json | null
          template_group?:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id?: string | null
          template_instance_id?: string | null
          template_sub_group?: string | null
          trading_status?: Database["public"]["Enums"]["shift_trading"] | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          assigned_at?: string | null
          assigned_employee_id?: string | null
          assignment_outcome?:
            | Database["public"]["Enums"]["shift_assignment_outcome"]
            | null
          assignment_source?: string | null
          assignment_status?:
            | Database["public"]["Enums"]["shift_assignment_status"]
            | null
          attendance_status?:
            | Database["public"]["Enums"]["shift_attendance_status"]
            | null
          bidding_close_at?: string | null
          bidding_enabled?: boolean | null
          bidding_open_at?: string | null
          bidding_status?:
            | Database["public"]["Enums"]["shift_bidding_status"]
            | null
          cancellation_reason?: string | null
          compliance_checked_at?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          creation_source?: string | null
          deleted_at?: string | null
          department_id?: string | null
          display_order?: number | null
          dropped_by_id?: string | null
          eligibility_snapshot?: Json | null
          emergency_assigned_at?: string | null
          emergency_assigned_by?: string | null
          end_time?: string | null
          event_tags?: Json | null
          fulfillment_status?:
            | Database["public"]["Enums"]["shift_fulfillment_status"]
            | null
          group_type?: Database["public"]["Enums"]["template_group_type"] | null
          id?: string | null
          is_cancelled?: boolean | null
          is_draft?: boolean | null
          is_from_template?: boolean | null
          is_on_bidding?: boolean | null
          is_overnight?: boolean | null
          is_published?: boolean | null
          is_urgent?: boolean | null
          last_modified_by?: string | null
          last_modified_reason?: string | null
          lifecycle_status?:
            | Database["public"]["Enums"]["shift_lifecycle"]
            | null
          notes?: string | null
          organization_id?: string | null
          paid_break_minutes?: number | null
          published_at?: string | null
          published_by_user_id?: string | null
          remuneration_level_id?: string | null
          required_licenses?: Json | null
          required_skills?: Json | null
          role_id?: string | null
          roster_date?: string | null
          roster_id?: string | null
          roster_shift_id?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          shift_date?: string | null
          shift_group_id?: string | null
          shift_subgroup_id?: string | null
          start_time?: string | null
          sub_department_id?: string | null
          sub_group_name?: string | null
          synthesis_run_id?: string | null
          tags?: Json | null
          template_group?:
            | Database["public"]["Enums"]["template_group_type"]
            | null
          template_id?: string | null
          template_instance_id?: string | null
          template_sub_group?: string | null
          trading_status?: Database["public"]["Enums"]["shift_trading"] | null
          unpaid_break_minutes?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_assigned_employee_id_fkey"
            columns: ["assigned_employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_performance_data_quality_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_remuneration_level_id_fkey"
            columns: ["remuneration_level_id"]
            isOneToOne: false
            referencedRelation: "remuneration_levels"
            referencedColumns: ["id"]
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
            foreignKeyName: "shifts_roster_shift_id_fkey"
            columns: ["roster_shift_id"]
            isOneToOne: false
            referencedRelation: "roster_shifts"
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
        ]
      }
      v_template_full: {
        Row: {
          applied_count: number | null
          created_at: string | null
          created_by: string | null
          created_from: string | null
          department_id: string | null
          department_name: string | null
          description: string | null
          end_date: string | null
          groups: Json | null
          id: string | null
          is_active: boolean | null
          is_base_template: boolean | null
          last_edited_by: string | null
          last_used_at: string | null
          name: string | null
          organization_id: string | null
          organization_name: string | null
          published_at: string | null
          published_by: string | null
          published_month: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["template_status"] | null
          sub_department_id: string | null
          sub_department_name: string | null
          updated_at: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "v_performance_data_quality_alerts"
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
      apply_template_to_date_range: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_template_id: string
          p_user_id: string
        }
        Returns: Json
      }
      cancel_shift: {
        Args: { p_reason: string; p_shift_id: string }
        Returns: Json
      }
      check_shift_compliance: {
        Args: { a: string; b: string }
        Returns: Record<string, unknown>
      }
      compute_employee_quarter_metrics: {
        Args: { p_employee_id: string; p_quarter_year: string }
        Returns: undefined
      }
      create_test_shift: {
        Args: { p_days_ahead: number; p_employee_id?: string; p_state: string }
        Returns: string
      }
      create_test_shift_v3: {
        Args: {
          p_employee_id?: string
          p_start_offset: string
          p_state: string
        }
        Returns: string
      }
      get_broadcast_ack_stats: {
        Args: { broadcast_uuid: string }
        Returns: {
          acknowledged: number
          pending: number
          percent: number
          total: number
        }[]
      }
      get_broadcast_group_role: {
        Args: { p_group_id: string }
        Returns: string
      }
      get_dept_insights_breakdown: {
        Args: {
          p_dept_ids?: string[]
          p_end_date: string
          p_org_ids?: string[]
          p_start_date: string
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
      get_publish_target_state: {
        Args: { a: boolean; b: boolean; c: number }
        Returns: Record<string, unknown>
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
          cancel_late: number
          cancel_rate: number
          cancel_standard: number
          completed: number
          drop_rate: number
          early_clock_out: number
          early_clock_out_rate: number
          emergency_assigned: number
          employee_id: string
          employee_name: string
          expired: number
          ignorance_rate: number
          late_cancel_rate: number
          late_clock_in: number
          late_clock_in_rate: number
          no_show: number
          no_show_rate: number
          rejected: number
          rejection_rate: number
          reliability_score: number
          swap_out: number
          swap_rate: number
          total_offers: number
        }[]
      }
      get_roster_shift_state: {
        Args: { a: string; b: boolean; c: boolean }
        Returns: string
      }
      has_permission: { Args: { p_action_code: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      log_shift_event: {
        Args: { a: string; b: string; c: string; d: string; e: Json }
        Returns: undefined
      }
      publish_roster_shift: {
        Args: {
          p_published_by_user_id: string
          p_roster_shift_id: string
          p_skip_compliance?: boolean
        }
        Returns: Database["public"]["CompositeTypes"]["publish_shift_result"]
        SetofOptions: {
          from: "*"
          to: "publish_shift_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      push_shift_to_bidding_on_cancel: {
        Args: { p_reason: string; p_shift_id: string }
        Returns: Json
      }
      quarter_date_range: {
        Args: { p_quarter: number; p_year: number }
        Returns: Record<string, unknown>
      }
      refresh_all_performance_metrics: { Args: never; Returns: undefined }
      resolve_user_permissions: { Args: never; Returns: Json }
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
      sm_emergency_assign:
        | {
            Args: {
              p_employee_id: string
              p_reason?: string
              p_shift_id: string
              p_user_id?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_employee_id: string
              p_reason?: string
              p_shift_id: string
              p_user_id?: string
            }
            Returns: Json
          }
      sm_expire_offer_now: { Args: { p_shift_id: string }; Returns: Json }
      sm_select_bid_winner: {
        Args: { p_shift_id: string; p_winner_id: string }
        Returns: Json
      }
      unpublish_roster_shift: {
        Args: {
          p_reason: string
          p_roster_shift_id: string
          p_unpublished_by_user_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["publish_shift_result"]
        SetofOptions: {
          from: "*"
          to: "publish_shift_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_has_action_in_scope: {
        Args: {
          p_action_code: string
          p_department_id?: string
          p_organization_id: string
          p_sub_department_id?: string
        }
        Returns: boolean
      }
      validate_roster_shift_for_publish: {
        Args: { p_id: string }
        Returns: Database["public"]["CompositeTypes"]["shift_validation_result"]
        SetofOptions: {
          from: "*"
          to: "shift_validation_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      withdraw_bid_rpc: {
        Args: { p_bid_id: string; p_employee_id: string }
        Returns: undefined
      }
    }
    Enums: {
      access_level: "alpha" | "beta" | "gamma" | "delta" | "epsilon" | "zeta"
      feedback_verdict: "UNDER" | "OVER" | "OK"
      notification_type:
        | "bid_accepted"
        | "bid_rejected"
        | "broadcast"
        | "general"
        | "shift_assigned"
        | "shift_cancelled"
        | "shift_updated"
        | "swap_approved"
        | "swap_rejected"
        | "swap_request"
        | "timesheet_approved"
        | "timesheet_rejected"
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
      shift_trading:
        | "NoTrade"
        | "TradeRequested"
        | "TradeAccepted"
        | "TradeApproved"
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
      synthesis_run_status: "draft" | "generated" | "reviewed" | "locked"
      template_group_type: "convention_centre" | "exhibition_centre" | "theatre"
      template_status: "archived" | "draft" | "published"
    }
    CompositeTypes: {
      publish_shift_result: {
        success: boolean | null
        shift_id: string | null
        roster_shift_id: string | null
        action: string | null
        from_state: string | null
        to_state: string | null
        error_code: string | null
        error_message: string | null
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      access_level: ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"],
      feedback_verdict: ["UNDER", "OVER", "OK"],
      notification_type: [
        "bid_accepted",
        "bid_rejected",
        "broadcast",
        "general",
        "shift_assigned",
        "shift_cancelled",
        "shift_updated",
        "swap_approved",
        "swap_rejected",
        "swap_request",
        "timesheet_approved",
        "timesheet_rejected",
      ],
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
      shift_trading: [
        "NoTrade",
        "TradeRequested",
        "TradeAccepted",
        "TradeApproved",
      ],
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
      synthesis_run_status: ["draft", "generated", "reviewed", "locked"],
      template_group_type: [
        "convention_centre",
        "exhibition_centre",
        "theatre",
      ],
      template_status: ["archived", "draft", "published"],
    },
  },
} as const

