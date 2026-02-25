export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          role: "owner" | "admin" | "member";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          role?: "owner" | "admin" | "member";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          role?: "owner" | "admin" | "member";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      events: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: "draft" | "active" | "completed" | "cancelled";
          location: string | null;
          start_date: string | null;
          end_date: string | null;
          budget: number | null;
          notes: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          status?: "draft" | "active" | "completed" | "cancelled";
          location?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          budget?: number | null;
          notes?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          status?: "draft" | "active" | "completed" | "cancelled";
          location?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          budget?: number | null;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      event_members: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          role: "owner" | "manager" | "member" | "viewer";
          joined_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          user_id: string;
          role?: "owner" | "manager" | "member" | "viewer";
          joined_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          user_id?: string;
          role?: "owner" | "manager" | "member" | "viewer";
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_members_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory: {
        Row: {
          id: string;
          event_id: string;
          category: "vehicle" | "equipment" | "swag" | "signage" | "other";
          name: string;
          description: string | null;
          quantity: number;
          unit_cost: number | null;
          status: "available" | "in_use" | "reserved" | "damaged" | "retired";
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          category?: "vehicle" | "equipment" | "swag" | "signage" | "other";
          name: string;
          description?: string | null;
          quantity?: number;
          unit_cost?: number | null;
          status?: "available" | "in_use" | "reserved" | "damaged" | "retired";
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          category?: "vehicle" | "equipment" | "swag" | "signage" | "other";
          name?: string;
          description?: string | null;
          quantity?: number;
          unit_cost?: number | null;
          status?: "available" | "in_use" | "reserved" | "damaged" | "retired";
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      deals: {
        Row: {
          id: string;
          event_id: string;
          company_name: string;
          contact_name: string | null;
          contact_email: string | null;
          stage: "lead" | "contacted" | "negotiating" | "committed" | "paid" | "lost";
          value: number | null;
          deal_type: "sponsorship" | "vendor" | "partnership" | "media" | "other";
          notes: string | null;
          closed_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          company_name: string;
          contact_name?: string | null;
          contact_email?: string | null;
          stage?: "lead" | "contacted" | "negotiating" | "committed" | "paid" | "lost";
          value?: number | null;
          deal_type?: "sponsorship" | "vendor" | "partnership" | "media" | "other";
          notes?: string | null;
          closed_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          company_name?: string;
          contact_name?: string | null;
          contact_email?: string | null;
          stage?: "lead" | "contacted" | "negotiating" | "committed" | "paid" | "lost";
          value?: number | null;
          deal_type?: "sponsorship" | "vendor" | "partnership" | "media" | "other";
          notes?: string | null;
          closed_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deals_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      campaigns: {
        Row: {
          id: string;
          event_id: string;
          name: string;
          channel: "email" | "social" | "paid_ads" | "sms" | "print" | "other";
          status: "draft" | "scheduled" | "active" | "paused" | "completed";
          budget: number | null;
          spend: number | null;
          impressions: number | null;
          clicks: number | null;
          conversions: number | null;
          start_date: string | null;
          end_date: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          name: string;
          channel?: "email" | "social" | "paid_ads" | "sms" | "print" | "other";
          status?: "draft" | "scheduled" | "active" | "paused" | "completed";
          budget?: number | null;
          spend?: number | null;
          impressions?: number | null;
          clicks?: number | null;
          conversions?: number | null;
          start_date?: string | null;
          end_date?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          name?: string;
          channel?: "email" | "social" | "paid_ads" | "sms" | "print" | "other";
          status?: "draft" | "scheduled" | "active" | "paused" | "completed";
          budget?: number | null;
          spend?: number | null;
          impressions?: number | null;
          clicks?: number | null;
          conversions?: number | null;
          start_date?: string | null;
          end_date?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaigns_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_log: {
        Row: {
          id: string;
          event_id: string;
          log_date: string;
          attendance: number | null;
          revenue: number | null;
          expenses: number | null;
          weather: string | null;
          highlights: string | null;
          issues: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          log_date: string;
          attendance?: number | null;
          revenue?: number | null;
          expenses?: number | null;
          weather?: string | null;
          highlights?: string | null;
          issues?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          log_date?: string;
          attendance?: number | null;
          revenue?: number | null;
          expenses?: number | null;
          weather?: string | null;
          highlights?: string | null;
          issues?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_log_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_log_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      roster: {
        Row: {
          id: string;
          event_id: string;
          user_id: string | null;
          name: string;
          email: string | null;
          phone: string | null;
          role: "lead" | "coordinator" | "staff" | "volunteer" | "vendor" | "security" | "medical";
          shift_start: string | null;
          shift_end: string | null;
          zone: string | null;
          checked_in: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          user_id?: string | null;
          name: string;
          email?: string | null;
          phone?: string | null;
          role?: "lead" | "coordinator" | "staff" | "volunteer" | "vendor" | "security" | "medical";
          shift_start?: string | null;
          shift_end?: string | null;
          zone?: string | null;
          checked_in?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          user_id?: string | null;
          name?: string;
          email?: string | null;
          phone?: string | null;
          role?: "lead" | "coordinator" | "staff" | "volunteer" | "vendor" | "security" | "medical";
          shift_start?: string | null;
          shift_end?: string | null;
          zone?: string | null;
          checked_in?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "roster_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roster_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_event_member: {
        Args: { p_event_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      event_status: "draft" | "active" | "completed" | "cancelled";
      event_role: "owner" | "manager" | "member" | "viewer";
      inventory_category: "vehicle" | "equipment" | "swag" | "signage" | "other";
      deal_stage: "lead" | "contacted" | "negotiating" | "committed" | "paid" | "lost";
      campaign_status: "draft" | "scheduled" | "active" | "paused" | "completed";
      campaign_channel: "email" | "social" | "paid_ads" | "sms" | "print" | "other";
      roster_role: "lead" | "coordinator" | "staff" | "volunteer" | "vendor" | "security" | "medical";
    };
    CompositeTypes: Record<string, never>;
  };
};
