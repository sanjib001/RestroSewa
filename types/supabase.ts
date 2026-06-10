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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          order_id: string | null
          payment_id: string | null
          performed_by: string | null
          restaurant_id: string
          session_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          order_id?: string | null
          payment_id?: string | null
          performed_by?: string | null
          restaurant_id: string
          session_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          order_id?: string | null
          payment_id?: string | null
          performed_by?: string | null
          restaurant_id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "session_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "session_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      additional_charges: {
        Row: {
          amount: number
          charge_type: string
          created_at: string
          id: string
          name: string
          restaurant_id: string
          session_id: string
        }
        Insert: {
          amount: number
          charge_type?: string
          created_at?: string
          id?: string
          name: string
          restaurant_id: string
          session_id: string
        }
        Update: {
          amount?: number
          charge_type?: string
          created_at?: string
          id?: string
          name?: string
          restaurant_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "additional_charges_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "additional_charges_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      addons: {
        Row: {
          additional_price: number
          id: string
          is_active: boolean
          menu_item_id: string
          name: string
          restaurant_id: string
        }
        Insert: {
          additional_price?: number
          id?: string
          is_active?: boolean
          menu_item_id: string
          name: string
          restaurant_id: string
        }
        Update: {
          additional_price?: number
          id?: string
          is_active?: boolean
          menu_item_id?: string
          name?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addons_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addons_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_requests: {
        Row: {
          acknowledged_by: string | null
          created_at: string
          id: string
          restaurant_id: string
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          restaurant_id: string
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          restaurant_id?: string
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_requests_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_requests_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      discounts: {
        Row: {
          applied_by: string
          created_at: string
          discount_type: string
          id: string
          restaurant_id: string
          session_id: string
          value: number
        }
        Insert: {
          applied_by: string
          created_at?: string
          discount_type: string
          id?: string
          restaurant_id: string
          session_id: string
          value: number
        }
        Update: {
          applied_by?: string
          created_at?: string
          discount_type?: string
          id?: string
          restaurant_id?: string
          session_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discounts_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discounts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discounts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      help_requests: {
        Row: {
          claimed_by: string | null
          created_at: string
          id: string
          resolved_by: string | null
          restaurant_id: string
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          claimed_by?: string | null
          created_at?: string
          id?: string
          resolved_by?: string | null
          restaurant_id: string
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          claimed_by?: string | null
          created_at?: string
          id?: string
          resolved_by?: string | null
          restaurant_id?: string
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "help_requests_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "help_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "help_requests_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "help_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          base_price: number
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_special: boolean
          is_veg: boolean
          name: string
          restaurant_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          base_price?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_special?: boolean
          is_veg?: boolean
          name: string
          restaurant_id: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          base_price?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_special?: boolean
          is_veg?: boolean
          name?: string
          restaurant_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string | null
          order_id: string | null
          read_by: string | null
          restaurant_id: string
          session_id: string | null
          status: string
          table_id: string | null
          triggered_by: string | null
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          order_id?: string | null
          read_by?: string | null
          restaurant_id: string
          session_id?: string | null
          status?: string
          table_id?: string | null
          triggered_by?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          order_id?: string | null
          read_by?: string | null
          restaurant_id?: string
          session_id?: string | null
          status?: string
          table_id?: string | null
          triggered_by?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "session_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_read_by_fkey"
            columns: ["read_by"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_templates: {
        Row: {
          created_at: string
          id: string
          name: string
          permissions: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          permissions?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          permissions?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      restaurant_settings: {
        Row: {
          cleaning_required: boolean
          created_at: string
          default_service_charge_percent: number
          id: string
          restaurant_id: string
          sound_notifications_enabled: boolean
          updated_at: string
        }
        Insert: {
          cleaning_required?: boolean
          created_at?: string
          default_service_charge_percent?: number
          id?: string
          restaurant_id: string
          sound_notifications_enabled?: boolean
          updated_at?: string
        }
        Update: {
          cleaning_required?: boolean
          created_at?: string
          default_service_charge_percent?: number
          id?: string
          restaurant_id?: string
          sound_notifications_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_tables: {
        Row: {
          assigned_user_id: string | null
          created_at: string
          display_name: string
          id: string
          position: number
          qr_token: string
          restaurant_id: string
          status: string
          table_group_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          created_at?: string
          display_name: string
          id?: string
          position?: number
          qr_token?: string
          restaurant_id: string
          status?: string
          table_group_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          created_at?: string
          display_name?: string
          id?: string
          position?: number
          qr_token?: string
          restaurant_id?: string
          status?: string
          table_group_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_tables_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_tables_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_tables_table_group_id_fkey"
            columns: ["table_group_id"]
            isOneToOne: false
            referencedRelation: "table_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_users: {
        Row: {
          auth_user_id: string
          created_at: string
          display_title: string
          employee_id: string
          id: string
          is_active: boolean
          name: string
          permission_template_id: string | null
          restaurant_id: string
          role: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          display_title?: string
          employee_id: string
          id?: string
          is_active?: boolean
          name: string
          permission_template_id?: string | null
          restaurant_id: string
          role?: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          display_title?: string
          employee_id?: string
          id?: string
          is_active?: boolean
          name?: string
          permission_template_id?: string | null
          restaurant_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_users_permission_template_id_fkey"
            columns: ["permission_template_id"]
            isOneToOne: false
            referencedRelation: "permission_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_users_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          address: string | null
          capabilities: string[]
          created_at: string
          email: string | null
          id: string
          logo_url: string | null
          name: string
          phone: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          capabilities?: string[]
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          name: string
          phone?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          capabilities?: string[]
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          phone?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      session_order_items: {
        Row: {
          addons_snapshot: Json
          id: string
          menu_item_id: string | null
          menu_item_name: string
          notes: string | null
          order_id: string
          quantity: number
          restaurant_id: string
          serving_status: string
          unit_price: number
          variant_id: string | null
          variant_name: string | null
        }
        Insert: {
          addons_snapshot?: Json
          id?: string
          menu_item_id?: string | null
          menu_item_name: string
          notes?: string | null
          order_id: string
          quantity?: number
          restaurant_id: string
          serving_status?: string
          unit_price: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Update: {
          addons_snapshot?: Json
          id?: string
          menu_item_id?: string | null
          menu_item_name?: string
          notes?: string | null
          order_id?: string
          quantity?: number
          restaurant_id?: string
          serving_status?: string
          unit_price?: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "session_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_order_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      session_orders: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          id: string
          notes: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          restaurant_id: string
          session_id: string
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          restaurant_id: string
          session_id: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          restaurant_id?: string
          session_id?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_orders_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_orders_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          payment_method: string
          processed_by: string
          reference: string | null
          restaurant_id: string
          session_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          payment_method: string
          processed_by: string
          reference?: string | null
          restaurant_id: string
          session_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          payment_method?: string
          processed_by?: string
          reference?: string | null
          restaurant_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_payments_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          activated_by: string | null
          bill_requested: boolean
          completed_at: string | null
          id: string
          ordering_locked: boolean
          restaurant_id: string
          started_at: string
          status: string
          table_id: string
        }
        Insert: {
          activated_by?: string | null
          bill_requested?: boolean
          completed_at?: string | null
          id?: string
          ordering_locked?: boolean
          restaurant_id: string
          started_at?: string
          status?: string
          table_id: string
        }
        Update: {
          activated_by?: string | null
          bill_requested?: boolean
          completed_at?: string | null
          id?: string
          ordering_locked?: boolean
          restaurant_id?: string
          started_at?: string
          status?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "restaurant_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      table_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_groups_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      variants: {
        Row: {
          additional_price: number
          id: string
          is_active: boolean
          menu_item_id: string
          name: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          additional_price?: number
          id?: string
          is_active?: boolean
          menu_item_id: string
          name: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          additional_price?: number
          id?: string
          is_active?: boolean
          menu_item_id?: string
          name?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "variants_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variants_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
