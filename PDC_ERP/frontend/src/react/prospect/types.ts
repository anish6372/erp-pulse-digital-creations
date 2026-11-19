// Shapes of the Prospect Analyzer data, as returned by /api/prospect and /api/prospect/analyze.

export interface Swot {
  strengths?: string[];
  weaknesses?: string[];
  opportunities?: string[];
  elevator_pitch?: string;
}

/** What the server observed on the business's website (all optional: a site may be unreachable). */
export interface WebsiteSignals {
  reachable?: boolean;
  note?: string;
  is_https?: boolean;
  has_mobile_viewport_tag?: boolean;
  mentions_online_ordering?: boolean;
  has_menu_reference?: boolean;
  links_instagram?: boolean;
  links_facebook?: boolean;
  links_whatsapp?: boolean;
  has_contact_info?: boolean;
  source?: string;
}

export interface InstagramInfo {
  handle: string;
  followers: number | null;
  last_post: string;
  posting_frequency: string;
  notes: string;
}

/** One saved row from the prospect_reports table (JSON columns arrive as strings). */
export interface ReportRow {
  id: number;
  business_name: string;
  website_url: string;
  instagram_handle: string;
  instagram_followers: number | null;
  instagram_last_post: string;
  instagram_posting_frequency: string;
  instagram_notes: string;
  website_signals: string;
  swot: string;
  strategy: string;
  created_at: string;
  hunter_lead_id: number | null;
}

/** A report ready to display, with its JSON already parsed. */
export interface Report {
  id?: number;
  business_name: string;
  website_url: string;
  instagram: InstagramInfo;
  website_signals: WebsiteSignals;
  swot: Swot;
  strategy: string;
}

export interface ReportForm {
  business_name: string;
  website_url: string;
  instagram_handle: string;
  instagram_followers: string;
  instagram_last_post: string;
  instagram_posting_frequency: string;
  instagram_notes: string;
}

export const EMPTY_FORM: ReportForm = {
  business_name: '',
  website_url: '',
  instagram_handle: '',
  instagram_followers: '',
  instagram_last_post: '',
  instagram_posting_frequency: '',
  instagram_notes: '',
};

export const POSTING_FREQUENCIES = ['Daily', 'A few times a week', 'Weekly', 'Rarely', 'Looks abandoned'] as const;
