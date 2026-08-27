/**
 * Hand-written database types.
 *
 * Kept in step with supabase/migrations/0001_init.sql by hand rather than generated with
 * `supabase gen types`, so that a checkout can typecheck without database credentials.
 * If you change the migration, change this too.
 */

export type ReportProcessingStatus =
  | 'discovered'
  | 'downloaded'
  | 'extracted'
  | 'needs_review'
  | 'approved'
  | 'failed'

export type PriceType = 'retail' | 'wholesale' | 'unknown'
export type SourceType = 'WFP_PDF' | 'WFP_HDX' | 'MANUAL'
export type ValidationStatus = 'pending' | 'approved' | 'rejected'
export type ScrapeRunStatus = 'running' | 'success' | 'partial' | 'failed'

/**
 * These are type ALIASES, not interfaces, and must stay that way. supabase-js constrains
 * each table's Row against `Record<string, unknown>`, and a TypeScript interface has no
 * implicit index signature, so an interface here fails the constraint and every query in
 * the app degrades to `never` with no error pointing back at this file.
 */
export type SourceReportRow = {
  id: string
  title: string
  publication_date: string | null
  source_url: string
  document_id: string | null
  file_hash: string | null
  processing_status: ReportProcessingStatus
  processing_error: string | null
  discovered_at: string
  processed_at: string | null
  created_at: string
  updated_at: string
}

export type ObservationRow = {
  id: string
  source_report_id: string | null
  observation_date: string
  commodity_original: string
  commodity_normalized: string
  unit_original: string
  unit_normalized: string
  price_khr: number
  geographic_scope: string
  province: string | null
  market: string | null
  price_type: PriceType
  source_type: SourceType
  extraction_confidence: number
  validation_status: ValidationStatus
  validation_notes: string | null
  created_at: string
  updated_at: string
}

export type ScrapeRunRow = {
  id: string
  started_at: string
  finished_at: string | null
  status: ScrapeRunStatus
  reports_found: number
  reports_processed: number
  records_extracted: number
  records_inserted: number
  records_rejected: number
  error_message: string | null
  created_at: string
}

/** Columns that accept NULL, and so may simply be left out of an insert. */
type NullableKeys<T> = { [K in keyof T]-?: null extends T[K] ? K : never }[keyof T]

/**
 * An insert shape: everything is required except columns the database fills in itself
 * (`Defaulted`) and columns that accept NULL. Without the nullable half, writing a row
 * means spelling out `file_hash: null, processing_error: null, processed_at: null` at
 * every call site, purely to satisfy the type.
 */
type Mutable<T, Defaulted extends keyof T> = Omit<T, Defaulted | NullableKeys<T>> &
  Partial<Pick<T, Defaulted | NullableKeys<T>>>

/**
 * `Relationships` is not optional: supabase-js constrains the schema against a
 * `GenericTable` that requires it, and omitting it silently degrades every query result to
 * `never` rather than producing a readable error. The entry below is also what lets
 * `select('..., source_reports(...)')` type-check as an embedded to-one relation.
 */
export type Database = {
  public: {
    Tables: {
      source_reports: {
        Row: SourceReportRow
        Insert: Mutable<
          SourceReportRow,
          'id' | 'discovered_at' | 'created_at' | 'updated_at' | 'processing_status'
        >
        Update: Partial<SourceReportRow>
        Relationships: []
      }
      food_price_observations: {
        Row: ObservationRow
        Insert: Mutable<
          ObservationRow,
          'id' | 'created_at' | 'updated_at' | 'validation_status' | 'extraction_confidence'
        >
        Update: Partial<ObservationRow>
        Relationships: [
          {
            foreignKeyName: 'food_price_observations_source_report_id_fkey'
            columns: ['source_report_id']
            isOneToOne: false
            referencedRelation: 'source_reports'
            referencedColumns: ['id']
          },
        ]
      }
      scrape_runs: {
        Row: ScrapeRunRow
        Insert: Mutable<
          ScrapeRunRow,
          | 'id'
          | 'started_at'
          | 'created_at'
          | 'status'
          | 'reports_found'
          | 'reports_processed'
          | 'records_extracted'
          | 'records_inserted'
          | 'records_rejected'
        >
        Update: Partial<ScrapeRunRow>
        Relationships: []
      }
    }
    // Supabase's own generated types spell "no views/functions" this way: an object type
    // with no keys at all. `Record<string, never>` looks equivalent but carries a string
    // index signature, which fails the GenericSchema constraint and silently collapses
    // every query result to `never`.
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: {
      report_processing_status: ReportProcessingStatus
      observation_price_type: PriceType
      observation_source_type: SourceType
      observation_validation: ValidationStatus
      scrape_run_status: ScrapeRunStatus
    }
    CompositeTypes: { [_ in never]: never }
  }
}
