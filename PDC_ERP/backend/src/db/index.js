const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { passwordHash } = require('../utils/crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'pdc_erp.sqlite'));

db.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 employee_code TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'Employee',
 department TEXT DEFAULT '',
 designation TEXT DEFAULT '',
 joining_date TEXT DEFAULT '',
 employment_type TEXT DEFAULT 'Full Time',
 manager_id INTEGER,
 phone TEXT DEFAULT '',
 email TEXT DEFAULT '',
 google_id TEXT DEFAULT '',
 monthly_salary REAL DEFAULT 0,
 monthly_target_tasks REAL DEFAULT 0,
 monthly_target_hours REAL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(manager_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS clients(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 short_name TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attendance_days(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Present',
 first_login TEXT,
 manual_note TEXT DEFAULT '',
 UNIQUE(user_id,date), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS login_sessions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 login_at TEXT NOT NULL,
 logout_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS work_sessions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 task_id INTEGER,
 started_at TEXT NOT NULL,
 ended_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS tasks(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 description TEXT DEFAULT '',
 assignee_id INTEGER NOT NULL,
 client_id INTEGER,
 priority TEXT NOT NULL DEFAULT 'Medium',
 category TEXT NOT NULL DEFAULT 'Other',
 status TEXT NOT NULL DEFAULT 'Not Started',
 due_date TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 completed_at TEXT,
 FOREIGN KEY(assignee_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS work_reports(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 task_id INTEGER,
 client_id INTEGER,
 work_date TEXT NOT NULL,
 work_text TEXT NOT NULL,
 hours REAL DEFAULT 0,
 work_drive_link TEXT DEFAULT '',
 poster_drive_link TEXT DEFAULT '',
 attachment_path TEXT DEFAULT '',
 attachment_name TEXT DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL,
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS leave_requests(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 leave_date TEXT NOT NULL,
 leave_type TEXT NOT NULL,
 reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Pending',
 requested_at TEXT NOT NULL,
 reviewed_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS payroll_adjustments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 month TEXT NOT NULL,
 amount REAL NOT NULL DEFAULT 0,
 note TEXT DEFAULT '',
 created_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS payroll_payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 month TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Pending',
 paid_at TEXT,
 note TEXT DEFAULT '',
 UNIQUE(user_id,month),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS payroll_closures(
 month TEXT PRIMARY KEY,
 closed_at TEXT NOT NULL,
 closed_by INTEGER,
 FOREIGN KEY(closed_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS candidates(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 position TEXT NOT NULL,
 phone TEXT DEFAULT '',
 email TEXT DEFAULT '',
 source TEXT DEFAULT '',
 stage TEXT NOT NULL DEFAULT 'Applied',
 interview_date TEXT DEFAULT '',
 resume_link TEXT DEFAULT '',
 notes TEXT DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender_id INTEGER NOT NULL,
 receiver_id INTEGER NOT NULL,
 body TEXT NOT NULL,
 created_at TEXT NOT NULL,
 read_at TEXT,
 FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notifications(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 recipient_id INTEGER NOT NULL,
 type TEXT NOT NULL,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 entity_type TEXT DEFAULT '',
 entity_id INTEGER,
 dedupe_key TEXT DEFAULT '',
 created_at TEXT NOT NULL,
 read_at TEXT,
 FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, read_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(recipient_id, dedupe_key) WHERE dedupe_key<>'';
CREATE TABLE IF NOT EXISTS audit_logs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id INTEGER,
 action TEXT NOT NULL,
 entity_type TEXT NOT NULL,
 entity_id INTEGER,
 meta TEXT DEFAULT '',
 created_at TEXT NOT NULL,
 FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 token_hash TEXT UNIQUE NOT NULL,
 user_id INTEGER NOT NULL,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audit_failed_login ON audit_logs(action, created_at);
CREATE TABLE IF NOT EXISTS chat_groups(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 created_by INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chat_group_members(
 group_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL,
 joined_at TEXT NOT NULL,
 PRIMARY KEY(group_id, user_id),
 FOREIGN KEY(group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS group_messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 group_id INTEGER NOT NULL,
 sender_id INTEGER NOT NULL,
 body TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
 FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS group_message_reads(
 group_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL,
 last_read_message_id INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(group_id, user_id)
);
CREATE TABLE IF NOT EXISTS meetings(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 description TEXT DEFAULT '',
 meeting_link TEXT NOT NULL,
 scheduled_at TEXT NOT NULL,
 duration_minutes INTEGER NOT NULL DEFAULT 30,
 status TEXT NOT NULL DEFAULT 'Scheduled',
 created_by INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS marketing_reels(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 client_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 reel_url TEXT DEFAULT '',
 posted_at TEXT NOT NULL,
 reach INTEGER NOT NULL DEFAULT 0,
 plays INTEGER NOT NULL DEFAULT 0,
 likes INTEGER NOT NULL DEFAULT 0,
 comments INTEGER NOT NULL DEFAULT 0,
 shares INTEGER NOT NULL DEFAULT 0,
 saves INTEGER NOT NULL DEFAULT 0,
 created_by INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
 FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS marketing_audience_geo(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 client_id INTEGER NOT NULL,
 snapshot_date TEXT NOT NULL,
 scope TEXT NOT NULL,
 label TEXT NOT NULL,
 percentage REAL NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS marketing_growth(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 client_id INTEGER NOT NULL,
 month TEXT NOT NULL,
 followers INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 UNIQUE(client_id, month),
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS marketing_instagram_accounts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 client_id INTEGER NOT NULL UNIQUE,
 ig_user_id TEXT NOT NULL,
 ig_username TEXT DEFAULT '',
 page_id TEXT DEFAULT '',
 access_token TEXT NOT NULL,
 token_expires_at TEXT,
 connected_by INTEGER,
 connected_at TEXT NOT NULL,
 last_synced_at TEXT,
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
 FOREIGN KEY(connected_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS onboardings(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 token_hash TEXT UNIQUE NOT NULL,
 token_expires_at TEXT NOT NULL,
 full_name TEXT NOT NULL,
 email TEXT DEFAULT '',
 phone TEXT DEFAULT '',
 department TEXT DEFAULT '',
 designation TEXT DEFAULT '',
 joining_date TEXT DEFAULT '',
 employment_type TEXT DEFAULT 'Full Time',
 monthly_salary REAL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'Invited',
 dob TEXT DEFAULT '',
 address TEXT DEFAULT '',
 emergency_name TEXT DEFAULT '',
 emergency_phone TEXT DEFAULT '',
 aadhaar_last4 TEXT DEFAULT '',
 aadhaar_front_path TEXT DEFAULT '',
 aadhaar_back_path TEXT DEFAULT '',
 selfie_path TEXT DEFAULT '',
 face_score REAL,
 face_match INTEGER,
 consent_at TEXT,
 nda_text TEXT DEFAULT '',
 nda_text_hash TEXT DEFAULT '',
 nda_signed_name TEXT DEFAULT '',
 nda_signature_path TEXT DEFAULT '',
 nda_signed_at TEXT,
 nda_ip TEXT DEFAULT '',
 nda_user_agent TEXT DEFAULT '',
 opened_at TEXT,
 submitted_at TEXT,
 reviewed_by INTEGER,
 reviewed_at TEXT,
 review_note TEXT DEFAULT '',
 user_id INTEGER,
 created_by INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
 FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
 FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);
`);
try { db.exec('ALTER TABLE hunter_leads ADD COLUMN lat REAL'); } catch(e) {}
try { db.exec('ALTER TABLE hunter_leads ADD COLUMN lng REAL'); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN address TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN business_type TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN contact_person TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN phone TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE clients ADD COLUMN email TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN google_id TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN last_seen TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE marketing_reels ADD COLUMN source TEXT DEFAULT 'manual'"); } catch(e) {}
try { db.exec("ALTER TABLE marketing_reels ADD COLUMN ig_media_id TEXT"); } catch(e) {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_reels_ig_media ON marketing_reels(client_id, ig_media_id) WHERE ig_media_id IS NOT NULL"); } catch(e) {}
try { db.exec("ALTER TABLE marketing_audience_geo ADD COLUMN source TEXT DEFAULT 'manual'"); } catch(e) {}
// Post type (Reel / Image / Video / Carousel) now that every post is synced, not only reels.
try { db.exec("ALTER TABLE marketing_reels ADD COLUMN post_type TEXT DEFAULT 'Reel'"); } catch(e) {}
// 'followers' = who follows the account, 'reached' = who the content was shown to. Manual rows are follower data.
try { db.exec("ALTER TABLE marketing_audience_geo ADD COLUMN audience TEXT DEFAULT 'followers'"); } catch(e) {}
db.exec(`CREATE TABLE IF NOT EXISTS marketing_reach_daily(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 client_id INTEGER NOT NULL,
 day TEXT NOT NULL,
 reach INTEGER NOT NULL DEFAULT 0,
 UNIQUE(client_id, day),
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
)`);

// --- Growth: sales leads, service packages, content calendar, client review links, monthly outcomes ---
db.exec(`
CREATE TABLE IF NOT EXISTS packages(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 reels_per_month INTEGER NOT NULL DEFAULT 0,
 price INTEGER NOT NULL DEFAULT 0,
 description TEXT DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS leads(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 business_name TEXT NOT NULL,
 business_type TEXT NOT NULL DEFAULT 'Cafe',
 contact_name TEXT DEFAULT '',
 phone TEXT DEFAULT '',
 email TEXT DEFAULT '',
 area TEXT DEFAULT '',
 source TEXT DEFAULT '',
 stage TEXT NOT NULL DEFAULT 'New',
 package_id INTEGER,
 monthly_value INTEGER NOT NULL DEFAULT 0,
 next_follow_up TEXT DEFAULT '',
 owner_id INTEGER,
 notes TEXT DEFAULT '',
 lost_reason TEXT DEFAULT '',
 converted_client_id INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE SET NULL,
 FOREIGN KEY(package_id) REFERENCES packages(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS lead_activities(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 lead_id INTEGER NOT NULL,
 user_id INTEGER,
 kind TEXT NOT NULL DEFAULT 'note',
 text TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS content_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 client_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'Reel',
 stage TEXT NOT NULL DEFAULT 'Idea',
 scheduled_date TEXT DEFAULT '',
 assignee_id INTEGER,
 script TEXT DEFAULT '',
 caption TEXT DEFAULT '',
 media_link TEXT DEFAULT '',
 review_note TEXT DEFAULT '',
 reviewed_by TEXT DEFAULT '',
 reviewed_at TEXT DEFAULT '',
 created_by INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
 FOREIGN KEY(assignee_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS client_review_links(
 client_id INTEGER PRIMARY KEY,
 token TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 last_viewed_at TEXT DEFAULT '',
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS client_outcomes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 client_id INTEGER NOT NULL,
 month TEXT NOT NULL,
 offer_redemptions INTEGER NOT NULL DEFAULT 0,
 new_customers INTEGER NOT NULL DEFAULT 0,
 notes TEXT DEFAULT '',
 updated_at TEXT NOT NULL,
 UNIQUE(client_id, month),
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
-- Contacts (by email or phone) that must never be reached out to again - checked before
-- any new outreach, kept separately from the lead/candidate rows themselves so it survives
-- even if the original record is deleted later.
CREATE TABLE IF NOT EXISTS do_not_contact(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 type TEXT NOT NULL,
 value TEXT NOT NULL,
 reason TEXT DEFAULT '',
 added_by INTEGER,
 created_at TEXT NOT NULL,
 UNIQUE(type, value),
 FOREIGN KEY(added_by) REFERENCES users(id) ON DELETE SET NULL
);
-- A data subject's access/erasure request (India's DPDP Act, GDPR) - "access" snapshots
-- every record held under that contact's email/phone; "delete" anonymizes the contact
-- fields on those same records rather than removing the rows outright, so the business
-- history (deal stage, what was discussed) survives while the actual personal data doesn't.
CREATE TABLE IF NOT EXISTS data_requests(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL,
 contact_value TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Fulfilled',
 result TEXT NOT NULL DEFAULT '{}',
 requested_by INTEGER,
 created_at TEXT NOT NULL,
 FOREIGN KEY(requested_by) REFERENCES users(id) ON DELETE SET NULL
);

-- One AI-generated prospect report per business pitched - website signals collected
-- automatically, Instagram entered by hand (scraping a prospect's Instagram who hasn't
-- authorized anything would violate their ToS), both fed to the strategy write-up.
CREATE TABLE IF NOT EXISTS prospect_reports(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 business_name TEXT NOT NULL,
 website_url TEXT DEFAULT '',
 instagram_handle TEXT DEFAULT '',
 instagram_followers INTEGER,
 instagram_last_post TEXT DEFAULT '',
 instagram_posting_frequency TEXT DEFAULT '',
 instagram_notes TEXT DEFAULT '',
 website_signals TEXT NOT NULL DEFAULT '{}',
 swot TEXT NOT NULL DEFAULT '{}',
 strategy TEXT NOT NULL DEFAULT '',
 created_by INTEGER,
 created_at TEXT NOT NULL,
 FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Client Hunter: businesses Pulse is prospecting - scored (fit/need/intent/reach) into
-- hot/warm/parked tiers from real, observed or hand-entered channel signals. "channels"
-- and "swot" are JSON; contact fields are only ever what the team found publicly.
CREATE TABLE IF NOT EXISTS hunter_leads(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 niche TEXT NOT NULL DEFAULT 'other',
 city TEXT DEFAULT '',
 website TEXT DEFAULT '',
 instagram TEXT DEFAULT '',
 linkedin TEXT DEFAULT '',
 email TEXT DEFAULT '',
 phone TEXT DEFAULT '',
 contact_name TEXT DEFAULT '',
 contact_role TEXT DEFAULT '',
 signal_type TEXT NOT NULL DEFAULT 'manual',
 signal_title TEXT DEFAULT '',
 signal_source TEXT DEFAULT '',
 signal_at TEXT,
 gmb_rating REAL,
 gmb_reviews INTEGER,
 ig_followers INTEGER,
 ig_last_post_days INTEGER,
 ig_posting_frequency TEXT DEFAULT '',
 channels TEXT NOT NULL DEFAULT '{}',
 swot TEXT NOT NULL DEFAULT '{}',
 elevator_pitch TEXT DEFAULT '',
 score INTEGER NOT NULL DEFAULT 0,
 tier TEXT NOT NULL DEFAULT 'parked',
 status TEXT NOT NULL DEFAULT 'new',
 owner_id INTEGER,
 notes TEXT DEFAULT '',
 created_by INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE SET NULL,
 FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);
-- One draft/sent outreach message per channel per lead. Nothing is ever sent
-- automatically - a person approves (and can edit) every message before it moves to Tasks.
CREATE TABLE IF NOT EXISTS hunter_touches(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 lead_id INTEGER NOT NULL,
 channel TEXT NOT NULL,
 subject TEXT DEFAULT '',
 body TEXT NOT NULL DEFAULT '',
 to_value TEXT DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft',
 outcome TEXT DEFAULT '',
 outcome_note TEXT DEFAULT '',
 approved_by INTEGER,
 approved_at TEXT,
 created_at TEXT NOT NULL,
 FOREIGN KEY(lead_id) REFERENCES hunter_leads(id) ON DELETE CASCADE,
 FOREIGN KEY(approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- A saved "search for this niche in this area" job, run on demand (or later, on a
-- schedule) against Apify's Google Maps actor - kept separate from hunter_leads so the
-- same search can be re-run without re-typing it.
CREATE TABLE IF NOT EXISTS hunter_hunts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 niche TEXT NOT NULL DEFAULT 'other',
 city TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 last_run_at TEXT,
 kept_count INTEGER NOT NULL DEFAULT 0,
 found_count INTEGER NOT NULL DEFAULT 0,
 created_by INTEGER,
 created_at TEXT NOT NULL,
 FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Admin override for the report's top-line numbers and summary text, per client/month.
-- NULL in any numeric column means "use the auto-computed value" - this is a correction
-- layer on top of real synced data, not a replacement for it.
CREATE TABLE IF NOT EXISTS client_report_overrides(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 client_id INTEGER NOT NULL,
 month TEXT NOT NULL,
 reach INTEGER,
 views INTEGER,
 interactions INTEGER,
 followers INTEGER,
 highlights TEXT,
 updated_at TEXT NOT NULL,
 UNIQUE(client_id, month),
 FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_content_client ON content_items(client_id, stage);
`);
// Starter packages: editable placeholders — set your real prices on the Leads screen.
if (db.prepare('SELECT COUNT(*) c FROM packages').get().c === 0) {
  const ins = db.prepare('INSERT INTO packages(name,reels_per_month,price,description) VALUES(?,?,?,?)');
  ins.run('Starter', 8, 15000, '8 reels a month, basic captions');
  ins.run('Growth', 12, 25000, '12 reels, monthly strategy call, content calendar');
  ins.run('Premium', 16, 40000, '16 reels, strategy, ads support, monthly report');
}

function getSetting(key, fallback) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

const defaultSettings = {
  office_start: '11:00',
  office_end: '19:00',
  lunch_start: '13:00',
  lunch_end: '14:00',
  report_deadline: '18:00',
  work_week: '1,2,3,4,5,6',
  salary_divisor: 'working_days',
  google_client_id: '',
};

for (const [k, v] of Object.entries(defaultSettings)) {
  if (getSetting(k, null) === null) setSetting(k, v);
}
if (getSetting('salary_divisor', '') === '30') setSetting('salary_divisor', 'working_days');

function seed() {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const now = () => new Date().toISOString();
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  if (count === 0) {
    const users = [
      ['Tanish', 'admin', 'Pdc@2026', 'Admin', 'Management', 'Admin / Operations'],
      ['Sidhant', 'sidhant', 'Sidhant@2026', 'Employee', 'Production', 'Video Production / Shoot'],
      ['Nitin', 'nitin', 'Nitin@2026', 'Employee', 'Production', 'Video Production Executive'],
      ['Zaki', 'zaki', 'Zaki@2026', 'Employee', 'Creative', 'Graphic + Motion Graphics Designer'],
      ['Saijal', 'saijal', 'Saijal@2026', 'Employee', 'Client Relations', 'Client Relations Executive'],
      ['Ram', 'ram', 'Ram@2026', 'Employee', 'Client Management', 'Client Management Executive'],
      ['Sandhya', 'sandhya', 'Sandhya@2026', 'Employee', 'HR / Operations', 'HR / Operations Executive'],
      ['Priya', 'priya', 'Priya@2026', 'Employee', 'Sales', 'Sales / Business Development'],
    ];
    const ins = db.prepare(
      `INSERT INTO users(name,employee_code,password_hash,role,department,designation,joining_date,employment_type,monthly_salary,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const u of users) ins.run(u[0], u[1], passwordHash(u[2]), u[3], u[4], u[5], today(), 'Full Time', 0, now(), now());
  }
  const c = db.prepare('SELECT COUNT(*) c FROM clients').get().c;
  if (c === 0) {
    const clients = [
      ['Rasagola Express', 'RE'],
      ['Chai Theatre', 'CT'],
      ['White Mantra', 'WM'],
      ['Dantastra Dental Hub', 'DDH'],
      ['MyCA Desk', 'CA Desk'],
      ['Meenal Personal Branding', 'Meenal'],
      ['The Cosmo Experience', 'Cosmo'],
    ];
    const ins = db.prepare('INSERT INTO clients(name,short_name,created_at) VALUES(?,?,?)');
    for (const x of clients) ins.run(x[0], x[1], now());
  }
}
seed();

module.exports = { db, getSetting, setSetting, defaultSettings };
