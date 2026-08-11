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
      adjudication_runs: {
        Row: {
          claim_id: string
          created_at: string
          is_retro: boolean
          org_id: string
          payload: Json
          run_id: string
          total_member_responsibility_cents: number
          total_plan_paid_cents: number
        }
        Insert: {
          claim_id: string
          created_at?: string
          is_retro?: boolean
          org_id: string
          payload: Json
          run_id: string
          total_member_responsibility_cents?: number
          total_plan_paid_cents?: number
        }
        Update: {
          claim_id?: string
          created_at?: string
          is_retro?: boolean
          org_id?: string
          payload?: Json
          run_id?: string
          total_member_responsibility_cents?: number
          total_plan_paid_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "adjudication_runs_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "adjudication_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      automation_jobs: {
        Row: {
          completed_at: string | null
          config: Json | null
          created_at: string
          created_by: string | null
          error_summary: string | null
          job_id: string
          job_type: string
          org_id: string
          parent_job_id: string | null
          pipeline_id: string | null
          records_failed: number
          records_processed: number
          records_succeeded: number
          recovery_value_cents: number
          result: Json | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          error_summary?: string | null
          job_id?: string
          job_type: string
          org_id: string
          parent_job_id?: string | null
          pipeline_id?: string | null
          records_failed?: number
          records_processed?: number
          records_succeeded?: number
          recovery_value_cents?: number
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          error_summary?: string | null
          job_id?: string
          job_type?: string
          org_id?: string
          parent_job_id?: string | null
          pipeline_id?: string | null
          records_failed?: number
          records_processed?: number
          records_succeeded?: number
          recovery_value_cents?: number
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      automation_rules: {
        Row: {
          configuration: Json
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          last_triggered_at: string | null
          org_id: string
          rule_id: string
          rule_name: string
          trigger_count: number
          trigger_type: string
          updated_at: string
        }
        Insert: {
          configuration?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          last_triggered_at?: string | null
          org_id: string
          rule_id?: string
          rule_name: string
          trigger_count?: number
          trigger_type: string
          updated_at?: string
        }
        Update: {
          configuration?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          last_triggered_at?: string | null
          org_id?: string
          rule_id?: string
          rule_name?: string
          trigger_count?: number
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      case_claim_links: {
        Row: {
          case_id: string
          claim_id: string
          linked_at: string
          org_id: string
        }
        Insert: {
          case_id: string
          claim_id: string
          linked_at?: string
          org_id: string
        }
        Update: {
          case_id?: string
          claim_id?: string
          linked_at?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_claim_links_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "case_claim_links_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "case_claim_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      case_events: {
        Row: {
          case_id: string
          claim_id: string | null
          description: string
          event_id: string
          event_type: string
          metadata: Json | null
          occurred_at: string
          org_id: string
        }
        Insert: {
          case_id: string
          claim_id?: string | null
          description: string
          event_id: string
          event_type: string
          metadata?: Json | null
          occurred_at?: string
          org_id: string
        }
        Update: {
          case_id?: string
          claim_id?: string | null
          description?: string
          event_id?: string
          event_type?: string
          metadata?: Json | null
          occurred_at?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "case_events_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "case_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      cases: {
        Row: {
          case_id: string
          created_at: string
          description: string | null
          member_id: string
          org_id: string
          status: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          description?: string | null
          member_id: string
          org_id: string
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          description?: string | null
          member_id?: string
          org_id?: string
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      claim_assignments: {
        Row: {
          assigned_at: string
          assigned_by_user_id: string | null
          assigned_to_user_id: string | null
          assignee: string | null
          claim_id: string
          created_at: string
          due_date: string | null
          org_id: string
          priority: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by_user_id?: string | null
          assigned_to_user_id?: string | null
          assignee?: string | null
          claim_id: string
          created_at?: string
          due_date?: string | null
          org_id: string
          priority?: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by_user_id?: string | null
          assigned_to_user_id?: string | null
          assignee?: string | null
          claim_id?: string
          created_at?: string
          due_date?: string | null
          org_id?: string
          priority?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_assignments_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: true
            referencedRelation: "claims"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "claim_assignments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      claim_source_links: {
        Row: {
          claim_id: string
          created_at: string
          link_id: string
          org_id: string
          payload: Json | null
          source_id: string | null
          source_row_number: number | null
          source_type: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          link_id?: string
          org_id: string
          payload?: Json | null
          source_id?: string | null
          source_row_number?: number | null
          source_type: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          link_id?: string
          org_id?: string
          payload?: Json | null
          source_id?: string | null
          source_row_number?: number | null
          source_type?: string
        }
        Relationships: []
      }
      claims: {
        Row: {
          claim_id: string
          created_at: string
          member_id: string
          org_id: string
          payload: Json
          provider_name: string | null
          service_date_from: string
          service_date_to: string | null
          status: string
          total_billed_cents: number
          updated_at: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          member_id: string
          org_id: string
          payload: Json
          provider_name?: string | null
          service_date_from: string
          service_date_to?: string | null
          status: string
          total_billed_cents?: number
          updated_at?: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          member_id?: string
          org_id?: string
          payload?: Json
          provider_name?: string | null
          service_date_from?: string
          service_date_to?: string | null
          status?: string
          total_billed_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claims_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      edi_errors: {
        Row: {
          created_at: string
          error_code: string | null
          error_id: string
          message: string
          org_id: string
          segment_id: string | null
          severity: string
          transaction_id: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_id?: string
          message: string
          org_id: string
          segment_id?: string | null
          severity?: string
          transaction_id: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_id?: string
          message?: string
          org_id?: string
          segment_id?: string | null
          severity?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edi_errors_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "edi_segments"
            referencedColumns: ["segment_id"]
          },
          {
            foreignKeyName: "edi_errors_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "edi_transactions"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      edi_segments: {
        Row: {
          created_at: string
          org_id: string
          parsed_json: Json
          raw_segment: string
          segment_id: string
          segment_type: string
          sequence_number: number
          transaction_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          parsed_json?: Json
          raw_segment: string
          segment_id?: string
          segment_type: string
          sequence_number: number
          transaction_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          parsed_json?: Json
          raw_segment?: string
          segment_id?: string
          segment_type?: string
          sequence_number?: number
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edi_segments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "edi_transactions"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      edi_transactions: {
        Row: {
          created_at: string
          error_count: number
          file_name: string
          functional_group_number: string | null
          interchange_control_number: string | null
          metadata: Json
          org_id: string
          raw_content: string | null
          received_at: string
          receiver_id: string | null
          segment_count: number
          sender_id: string | null
          status: string
          transaction_id: string
          transaction_set_number: string | null
          transaction_type: string
          updated_at: string
          validation_status: string
        }
        Insert: {
          created_at?: string
          error_count?: number
          file_name: string
          functional_group_number?: string | null
          interchange_control_number?: string | null
          metadata?: Json
          org_id: string
          raw_content?: string | null
          received_at?: string
          receiver_id?: string | null
          segment_count?: number
          sender_id?: string | null
          status?: string
          transaction_id?: string
          transaction_set_number?: string | null
          transaction_type: string
          updated_at?: string
          validation_status?: string
        }
        Update: {
          created_at?: string
          error_count?: number
          file_name?: string
          functional_group_number?: string | null
          interchange_control_number?: string | null
          metadata?: Json
          org_id?: string
          raw_content?: string | null
          received_at?: string
          receiver_id?: string | null
          segment_count?: number
          sender_id?: string | null
          status?: string
          transaction_id?: string
          transaction_set_number?: string | null
          transaction_type?: string
          updated_at?: string
          validation_status?: string
        }
        Relationships: []
      }
      evidence_documents: {
        Row: {
          claim_id: string | null
          created_at: string
          denial_id: string | null
          document_id: string
          document_type: string
          file_size: number
          filename: string
          mime_type: string
          notes: string | null
          org_id: string
          parent_document_id: string | null
          storage_bucket: string
          storage_path: string
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          uploaded_by_email: string | null
          version: number
        }
        Insert: {
          claim_id?: string | null
          created_at?: string
          denial_id?: string | null
          document_id?: string
          document_type?: string
          file_size?: number
          filename: string
          mime_type: string
          notes?: string | null
          org_id: string
          parent_document_id?: string | null
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_by_email?: string | null
          version?: number
        }
        Update: {
          claim_id?: string | null
          created_at?: string
          denial_id?: string | null
          document_id?: string
          document_type?: string
          file_size?: number
          filename?: string
          mime_type?: string
          notes?: string | null
          org_id?: string
          parent_document_id?: string | null
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_by_email?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "evidence_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "evidence_documents_parent_document_id_fkey"
            columns: ["parent_document_id"]
            isOneToOne: false
            referencedRelation: "evidence_documents"
            referencedColumns: ["document_id"]
          },
        ]
      }
      fee_schedules: {
        Row: {
          contract_id: string
          contracted_amount_cents: number
          created_at: string
          fee_schedule_id: string
          modifier: string | null
          org_id: string
          procedure_code: string
          reimbursement_method: string
          updated_at: string
        }
        Insert: {
          contract_id: string
          contracted_amount_cents?: number
          created_at?: string
          fee_schedule_id?: string
          modifier?: string | null
          org_id: string
          procedure_code: string
          reimbursement_method?: string
          updated_at?: string
        }
        Update: {
          contract_id?: string
          contracted_amount_cents?: number
          created_at?: string
          fee_schedule_id?: string
          modifier?: string | null
          org_id?: string
          procedure_code?: string
          reimbursement_method?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_schedules_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "payer_contracts"
            referencedColumns: ["contract_id"]
          },
        ]
      }
      field_mappings: {
        Row: {
          created_at: string
          mapping: Json
          mapping_id: string
          name: string
          org_id: string
          source_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          mapping?: Json
          mapping_id?: string
          name: string
          org_id: string
          source_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          mapping?: Json
          mapping_id?: string
          name?: string
          org_id?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_mappings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          actor: string
          claim_id: string
          consumed_at: string
          key: string
          operation: string | null
          org_id: string | null
          payload_hash: string | null
          result_id: string | null
        }
        Insert: {
          actor: string
          claim_id: string
          consumed_at?: string
          key: string
          operation?: string | null
          org_id?: string | null
          payload_hash?: string | null
          result_id?: string | null
        }
        Update: {
          actor?: string
          claim_id?: string
          consumed_at?: string
          key?: string
          operation?: string | null
          org_id?: string | null
          payload_hash?: string | null
          result_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      import_batches: {
        Row: {
          batch_id: string
          committed_at: string | null
          created_at: string
          error_count: number
          expected_recovery_cents: number
          file_name: string
          generated_claim_ids: Json
          import_score: number
          mapping: Json
          org_id: string
          record_count: number
          source_type: string
          status: string
          success_count: number
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          validation: Json
          warning_count: number
        }
        Insert: {
          batch_id?: string
          committed_at?: string | null
          created_at?: string
          error_count?: number
          expected_recovery_cents?: number
          file_name: string
          generated_claim_ids?: Json
          import_score?: number
          mapping?: Json
          org_id: string
          record_count?: number
          source_type: string
          status?: string
          success_count?: number
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          validation?: Json
          warning_count?: number
        }
        Update: {
          batch_id?: string
          committed_at?: string | null
          created_at?: string
          error_count?: number
          expected_recovery_cents?: number
          file_name?: string
          generated_claim_ids?: Json
          import_score?: number
          mapping?: Json
          org_id?: string
          record_count?: number
          source_type?: string
          status?: string
          success_count?: number
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          validation?: Json
          warning_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      import_exceptions: {
        Row: {
          batch_id: string
          created_at: string
          error_count: number
          exception_id: string
          generated_claim_id: string | null
          mapped_row: Json | null
          org_id: string
          resolved_at: string | null
          row_number: number
          severity: string
          source_row: Json
          status: string
          updated_at: string
          validation_errors: Json
          warning_count: number
        }
        Insert: {
          batch_id: string
          created_at?: string
          error_count?: number
          exception_id: string
          generated_claim_id?: string | null
          mapped_row?: Json | null
          org_id: string
          resolved_at?: string | null
          row_number: number
          severity: string
          source_row: Json
          status?: string
          updated_at?: string
          validation_errors?: Json
          warning_count?: number
        }
        Update: {
          batch_id?: string
          created_at?: string
          error_count?: number
          exception_id?: string
          generated_claim_id?: string | null
          mapped_row?: Json | null
          org_id?: string
          resolved_at?: string | null
          row_number?: number
          severity?: string
          source_row?: Json
          status?: string
          updated_at?: string
          validation_errors?: Json
          warning_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_exceptions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "import_exceptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      job_failures: {
        Row: {
          archived: boolean
          created_at: string
          error_message: string
          failure_id: string
          org_id: string
          queue_job_id: string
          retry_count: number
          stack_trace: string | null
        }
        Insert: {
          archived?: boolean
          created_at?: string
          error_message: string
          failure_id?: string
          org_id: string
          queue_job_id: string
          retry_count?: number
          stack_trace?: string | null
        }
        Update: {
          archived?: boolean
          created_at?: string
          error_message?: string
          failure_id?: string
          org_id?: string
          queue_job_id?: string
          retry_count?: number
          stack_trace?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_failures_queue_job_id_fkey"
            columns: ["queue_job_id"]
            isOneToOne: false
            referencedRelation: "job_queue"
            referencedColumns: ["queue_job_id"]
          },
        ]
      }
      job_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          job_type: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          next_attempt_at: string
          org_id: string
          payload: Json | null
          pipeline_id: string | null
          priority: number
          queue_job_id: string
          started_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          job_type: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          next_attempt_at?: string
          org_id: string
          payload?: Json | null
          pipeline_id?: string | null
          priority?: number
          queue_job_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          job_type?: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          next_attempt_at?: string
          org_id?: string
          payload?: Json | null
          pipeline_id?: string | null
          priority?: number
          queue_job_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      job_runs: {
        Row: {
          created_at: string
          duration_ms: number
          org_id: string
          queue_job_id: string
          records_failed: number
          records_processed: number
          records_succeeded: number
          result_summary: Json | null
          run_id: string
          status: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number
          org_id: string
          queue_job_id: string
          records_failed?: number
          records_processed?: number
          records_succeeded?: number
          result_summary?: Json | null
          run_id?: string
          status: string
          worker_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number
          org_id?: string
          queue_job_id?: string
          records_failed?: number
          records_processed?: number
          records_succeeded?: number
          result_summary?: Json | null
          run_id?: string
          status?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_runs_queue_job_id_fkey"
            columns: ["queue_job_id"]
            isOneToOne: false
            referencedRelation: "job_queue"
            referencedColumns: ["queue_job_id"]
          },
        ]
      }
      member_accumulators: {
        Row: {
          family_deductible_used_cents: number
          family_oop_used_cents: number
          individual_deductible_used_cents: number
          individual_oop_used_cents: number
          member_id: string
          org_id: string
          payload: Json | null
          plan_year: number
          updated_at: string
        }
        Insert: {
          family_deductible_used_cents?: number
          family_oop_used_cents?: number
          individual_deductible_used_cents?: number
          individual_oop_used_cents?: number
          member_id: string
          org_id: string
          payload?: Json | null
          plan_year: number
          updated_at?: string
        }
        Update: {
          family_deductible_used_cents?: number
          family_oop_used_cents?: number
          individual_deductible_used_cents?: number
          individual_oop_used_cents?: number
          member_id?: string
          org_id?: string
          payload?: Json | null
          plan_year?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_accumulators_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      ops_events: {
        Row: {
          actor: string | null
          actor_email: string | null
          actor_name: string | null
          actor_user_id: string | null
          claim_id: string | null
          created_at: string
          event_id: string
          kind: string
          occurred_at: string
          org_id: string
          payload: Json | null
          summary: string
        }
        Insert: {
          actor?: string | null
          actor_email?: string | null
          actor_name?: string | null
          actor_user_id?: string | null
          claim_id?: string | null
          created_at?: string
          event_id: string
          kind: string
          occurred_at?: string
          org_id: string
          payload?: Json | null
          summary: string
        }
        Update: {
          actor?: string | null
          actor_email?: string | null
          actor_name?: string | null
          actor_user_id?: string | null
          claim_id?: string | null
          created_at?: string
          event_id?: string
          kind?: string
          occurred_at?: string
          org_id?: string
          payload?: Json | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_events_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "ops_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          name: string
          org_id?: string
        }
        Update: {
          created_at?: string
          name?: string
          org_id?: string
        }
        Relationships: []
      }
      payer_contracts: {
        Row: {
          contract_id: string
          contract_name: string
          contract_type: string
          created_at: string
          effective_date: string
          org_id: string
          payer_name: string
          termination_date: string | null
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          version: string
        }
        Insert: {
          contract_id?: string
          contract_name: string
          contract_type?: string
          created_at?: string
          effective_date: string
          org_id: string
          payer_name: string
          termination_date?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          version?: string
        }
        Update: {
          contract_id?: string
          contract_name?: string
          contract_type?: string
          created_at?: string
          effective_date?: string
          org_id?: string
          payer_name?: string
          termination_date?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          version?: string
        }
        Relationships: []
      }
      recovery_lineage_events: {
        Row: {
          claim_id: string | null
          created_at: string
          dispute_id: string | null
          event_summary: string
          event_type: string
          lineage_event_id: string
          org_id: string
          outcome_id: string | null
          payload: Json | null
          remittance_line_id: string | null
        }
        Insert: {
          claim_id?: string | null
          created_at?: string
          dispute_id?: string | null
          event_summary: string
          event_type: string
          lineage_event_id?: string
          org_id: string
          outcome_id?: string | null
          payload?: Json | null
          remittance_line_id?: string | null
        }
        Update: {
          claim_id?: string | null
          created_at?: string
          dispute_id?: string | null
          event_summary?: string
          event_type?: string
          lineage_event_id?: string
          org_id?: string
          outcome_id?: string | null
          payload?: Json | null
          remittance_line_id?: string | null
        }
        Relationships: []
      }
      recovery_outcomes: {
        Row: {
          claim_id: string
          created_at: string
          denial_id: string | null
          denied_amount_cents: number
          notes: string | null
          org_id: string
          outcome_id: string
          payer_id: string | null
          payload: Json | null
          recovered_amount_cents: number
          resolution_date: string
          resolution_type: string
          unrecovered_amount_cents: number
          updated_at: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          denial_id?: string | null
          denied_amount_cents?: number
          notes?: string | null
          org_id: string
          outcome_id: string
          payer_id?: string | null
          payload?: Json | null
          recovered_amount_cents?: number
          resolution_date: string
          resolution_type: string
          unrecovered_amount_cents?: number
          updated_at?: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          denial_id?: string | null
          denied_amount_cents?: number
          notes?: string | null
          org_id?: string
          outcome_id?: string
          payer_id?: string | null
          payload?: Json | null
          recovered_amount_cents?: number
          resolution_date?: string
          resolution_type?: string
          unrecovered_amount_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recovery_outcomes_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "recovery_outcomes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      remittance_batches: {
        Row: {
          batch_id: string
          cob_count: number
          created_at: string
          denial_count: number
          expected_recovery_cents: number
          file_name: string
          id: string
          imported_by: string | null
          org_id: string
          payer_name: string | null
          record_count: number
          total_adjustment_cents: number
          total_billed_cents: number
          total_paid_cents: number
          underpayment_count: number
          updated_at: string
          uploaded_at: string
        }
        Insert: {
          batch_id: string
          cob_count?: number
          created_at?: string
          denial_count?: number
          expected_recovery_cents?: number
          file_name: string
          id?: string
          imported_by?: string | null
          org_id: string
          payer_name?: string | null
          record_count?: number
          total_adjustment_cents?: number
          total_billed_cents?: number
          total_paid_cents?: number
          underpayment_count?: number
          updated_at?: string
          uploaded_at?: string
        }
        Update: {
          batch_id?: string
          cob_count?: number
          created_at?: string
          denial_count?: number
          expected_recovery_cents?: number
          file_name?: string
          id?: string
          imported_by?: string | null
          org_id?: string
          payer_name?: string | null
          record_count?: number
          total_adjustment_cents?: number
          total_billed_cents?: number
          total_paid_cents?: number
          underpayment_count?: number
          updated_at?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "remittance_batches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      remittance_lines: {
        Row: {
          adjustment_amount_cents: number
          allowed_amount_cents: number
          billed_amount_cents: number
          carc_code: string | null
          claim_id: string | null
          classification: string | null
          created_at: string
          group_code: string | null
          import_batch_id: string | null
          modifier: string | null
          org_id: string
          paid_amount_cents: number
          patient_responsibility_cents: number
          payer_name: string | null
          payload: Json | null
          procedure_code: string | null
          rarc_code: string | null
          remittance_batch_id: string | null
          remittance_line_id: string
          service_date: string | null
          source_row_number: number | null
        }
        Insert: {
          adjustment_amount_cents?: number
          allowed_amount_cents?: number
          billed_amount_cents?: number
          carc_code?: string | null
          claim_id?: string | null
          classification?: string | null
          created_at?: string
          group_code?: string | null
          import_batch_id?: string | null
          modifier?: string | null
          org_id: string
          paid_amount_cents?: number
          patient_responsibility_cents?: number
          payer_name?: string | null
          payload?: Json | null
          procedure_code?: string | null
          rarc_code?: string | null
          remittance_batch_id?: string | null
          remittance_line_id?: string
          service_date?: string | null
          source_row_number?: number | null
        }
        Update: {
          adjustment_amount_cents?: number
          allowed_amount_cents?: number
          billed_amount_cents?: number
          carc_code?: string | null
          claim_id?: string | null
          classification?: string | null
          created_at?: string
          group_code?: string | null
          import_batch_id?: string | null
          modifier?: string | null
          org_id?: string
          paid_amount_cents?: number
          patient_responsibility_cents?: number
          payer_name?: string | null
          payload?: Json | null
          procedure_code?: string | null
          rarc_code?: string | null
          remittance_batch_id?: string | null
          remittance_line_id?: string
          service_date?: string | null
          source_row_number?: number | null
        }
        Relationships: []
      }
      replay_ledger_events: {
        Row: {
          actor: string
          claim_id: string
          details: Json
          event_hash: string
          event_id: string
          org_id: string | null
          prev_event_hash: string
          run_id: string | null
          snapshot_id: string | null
          timestamp: string
          type: string
        }
        Insert: {
          actor: string
          claim_id: string
          details?: Json
          event_hash: string
          event_id: string
          org_id?: string | null
          prev_event_hash: string
          run_id?: string | null
          snapshot_id?: string | null
          timestamp: string
          type: string
        }
        Update: {
          actor?: string
          claim_id?: string
          details?: Json
          event_hash?: string
          event_id?: string
          org_id?: string | null
          prev_event_hash?: string
          run_id?: string | null
          snapshot_id?: string | null
          timestamp?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "replay_ledger_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      replay_records: {
        Row: {
          claim_id: string
          created_at: string
          fingerprint: string
          org_id: string | null
          payload: Json
          run_id: string
          snapshot_id: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          fingerprint: string
          org_id?: string | null
          payload: Json
          run_id: string
          snapshot_id: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          fingerprint?: string
          org_id?: string | null
          payload?: Json
          run_id?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "replay_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      scheduler_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          jobs_discovered: number
          jobs_executed: number
          notes: string | null
          run_id: string
          scheduler_name: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          jobs_discovered?: number
          jobs_executed?: number
          notes?: string | null
          run_id?: string
          scheduler_name: string
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          jobs_discovered?: number
          jobs_executed?: number
          notes?: string | null
          run_id?: string
          scheduler_name?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      traces: {
        Row: {
          claim_id: string
          created_at: string
          org_id: string
          payload: Json
          run_id: string
          trace_id: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          org_id: string
          payload: Json
          run_id: string
          trace_id: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          org_id?: string
          payload?: Json
          run_id?: string
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "traces_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "traces_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "traces_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "adjudication_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      underpayment_disputes: {
        Row: {
          allowed_amount_cents: number
          claim_id: string
          contract_id: string | null
          created_at: string
          dedupe_key: string | null
          dispute_id: string
          expected_amount_cents: number
          explanation: string | null
          org_id: string
          paid_amount_cents: number
          payer_name: string
          procedure_code: string | null
          remittance_line_id: string | null
          service_date: string | null
          severity: string
          source_metadata: Json | null
          status: string
          updated_at: string
          variance_amount_cents: number
          variance_percent: number
        }
        Insert: {
          allowed_amount_cents?: number
          claim_id: string
          contract_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          dispute_id?: string
          expected_amount_cents?: number
          explanation?: string | null
          org_id: string
          paid_amount_cents?: number
          payer_name: string
          procedure_code?: string | null
          remittance_line_id?: string | null
          service_date?: string | null
          severity?: string
          source_metadata?: Json | null
          status?: string
          updated_at?: string
          variance_amount_cents?: number
          variance_percent?: number
        }
        Update: {
          allowed_amount_cents?: number
          claim_id?: string
          contract_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          dispute_id?: string
          expected_amount_cents?: number
          explanation?: string | null
          org_id?: string
          paid_amount_cents?: number
          payer_name?: string
          procedure_code?: string | null
          remittance_line_id?: string | null
          service_date?: string | null
          severity?: string
          source_metadata?: Json | null
          status?: string
          updated_at?: string
          variance_amount_cents?: number
          variance_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "underpayment_disputes_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "payer_contracts"
            referencedColumns: ["contract_id"]
          },
        ]
      }
      worker_registry: {
        Row: {
          jobs_failed: number
          jobs_processed: number
          last_heartbeat: string
          registered_at: string
          status: string
          updated_at: string
          version: string
          worker_id: string
        }
        Insert: {
          jobs_failed?: number
          jobs_processed?: number
          last_heartbeat?: string
          registered_at?: string
          status?: string
          updated_at?: string
          version?: string
          worker_id: string
        }
        Update: {
          jobs_failed?: number
          jobs_processed?: number
          last_heartbeat?: string
          registered_at?: string
          status?: string
          updated_at?: string
          version?: string
          worker_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_next_queue_job: {
        Args: { _worker_id: string }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          job_type: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          next_attempt_at: string
          org_id: string
          payload: Json | null
          pipeline_id: string | null
          priority: number
          queue_job_id: string
          started_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "job_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_org_id: { Args: never; Returns: string }
      has_org_role: {
        Args: { _org_id: string; _roles: string[]; _user_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      recover_stalled_queue_jobs: {
        Args: { _stale_minutes?: number }
        Returns: number
      }
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
