/**
 * Phase 21 — X12 EDI types
 */

export type EdiTransactionType = '835' | '837P' | '837I' | 'unknown';
export type EdiStatus = 'received' | 'parsed' | 'validated' | 'normalized' | 'imported' | 'rejected';
export type EdiValidationStatus = 'pending' | 'valid' | 'invalid';
export type EdiErrorSeverity = 'error' | 'warning' | 'info';
export type EdiErrorStatus = 'open' | 'resolved' | 'ignored';

export interface EdiSegment {
  segment_id?: string;
  segment_type: string;
  sequence_number: number;
  raw_segment: string;
  parsed_json: Record<string, string>;
}

export interface EdiEnvelope {
  sender_id?: string;
  receiver_id?: string;
  interchange_control_number?: string;
  functional_group_number?: string;
  transaction_set_number?: string;
  transaction_type: EdiTransactionType;
}

export interface ParsedX12 {
  envelope: EdiEnvelope;
  segments: EdiSegment[];
  element_separator: string;
  segment_terminator: string;
  sub_element_separator: string;
}

export interface EdiValidationIssue {
  severity: EdiErrorSeverity;
  error_code?: string;
  message: string;
  segment_id?: string;
  segment_sequence?: number;
}

export interface EdiValidationResult {
  valid: boolean;
  issues: EdiValidationIssue[];
}

export interface EdiTransactionRow {
  transaction_id: string;
  org_id: string;
  transaction_type: EdiTransactionType;
  file_name: string;
  sender_id: string | null;
  receiver_id: string | null;
  interchange_control_number: string | null;
  functional_group_number: string | null;
  transaction_set_number: string | null;
  status: EdiStatus;
  validation_status: EdiValidationStatus;
  segment_count: number;
  error_count: number;
  received_at: string;
}

export interface EdiErrorRow {
  error_id: string;
  transaction_id: string;
  segment_id: string | null;
  severity: EdiErrorSeverity;
  error_code: string | null;
  message: string;
  created_at: string;
  status: EdiErrorStatus;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}
