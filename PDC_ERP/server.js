const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS = path.join(ROOT, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

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
`);
try { db.exec("ALTER TABLE users ADD COLUMN google_id TEXT DEFAULT ''"); } catch(e) {}

const now = () => new Date().toISOString();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Kolkata' }).format(new Date());
const istHM = (iso = new Date().toISOString()) => new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
const uid = () => crypto.randomBytes(18).toString('hex');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
function passwordHash(password){ const salt=crypto.randomBytes(16).toString('hex'); const derived=crypto.pbkdf2Sync(password,salt,150000,32,'sha256').toString('hex'); return `${salt}:${derived}`; }
function verifyPassword(password, stored){ const [salt,storedHash]=stored.split(':'); const derived=crypto.pbkdf2Sync(password,salt,150000,32,'sha256').toString('hex'); return crypto.timingSafeEqual(Buffer.from(derived,'hex'),Buffer.from(storedHash,'hex')); }
function escJson(v){ return JSON.stringify(v ?? ''); }
function getSetting(key, fallback){ const r=db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r ? r.value : fallback; }
function setSetting(key,value){ db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value)); }
const defaultSettings={office_start:'11:00',office_end:'19:00',lunch_start:'13:00',lunch_end:'14:00',report_deadline:'18:00',work_week:'1,2,3,4,5,6',salary_divisor:'working_days',google_client_id:''};
for(const [k,v] of Object.entries(defaultSettings)) if(getSetting(k,null)===null) setSetting(k,v);
if(getSetting('salary_divisor','')==='30') setSetting('salary_divisor','working_days');

function generateEmployeeCode(){
 const countRow=db.prepare('SELECT COUNT(*) as cnt FROM users').get();
 let num=(countRow?countRow.cnt:0)+1001;
 let code=`EMP${num}`;
 while(db.prepare('SELECT id FROM users WHERE employee_code=?').get(code)){ num++; code=`EMP${num}`; }
 return code;
}

function executeLoginSession(u, res){
 const token=uid(); const expires=new Date(Date.now()+7*864e5).toISOString(); db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hash(token),u.id,expires,now());
 const when=now(); db.prepare('INSERT INTO login_sessions(user_id,login_at) VALUES(?,?)').run(u.id,when);
 const d=today(); const existing=db.prepare('SELECT * FROM attendance_days WHERE user_id=? AND date=?').get(u.id,d);
 const approvedToday=db.prepare("SELECT id,leave_type FROM leave_requests WHERE user_id=? AND leave_date=? AND status='Approved'").get(u.id,d);
 const firstStatus=approvedToday?(approvedToday.leave_type==='Half Day'?'Half Day':'Leave'):(istHM(when)>getSetting('office_start','11:00')?'Late / Half Day':'Present');
 if(!existing){ db.prepare('INSERT INTO attendance_days(user_id,date,status,first_login,manual_note) VALUES(?,?,?,?,?)').run(u.id,d,firstStatus,istHM(when),approvedToday?'Approved leave':'Automatic login attendance'); }
 else if(!existing.first_login){ db.prepare('UPDATE attendance_days SET status=?,first_login=?,manual_note=? WHERE id=?').run(firstStatus,istHM(when),approvedToday?'Approved leave':'Automatic login attendance',existing.id); }
 notify(u.id,'attendance_checkin','Attendance recorded',`Your ${firstStatus} attendance was recorded at ${istHM(when)}.`,'attendance',existing?.id||null,`attendance_checkin:${u.id}:${d}`);
 if(u.role!=='Admin') notifyAdmins('attendance_checkin','Employee checked in',`${u.name} checked in at ${istHM(when)} — ${firstStatus}.`,'attendance',existing?.id||null,`attendance_admin:${u.id}:${d}`);
 audit(u,'LOGIN','session',null,'Login successful');
 send(res,200,{token,user:{id:u.id,name:u.name,employee_code:u.employee_code,role:u.role,department:u.department,designation:u.designation,email:u.email,phone:u.phone}});
}

function seed(){
 const count=db.prepare('SELECT COUNT(*) c FROM users').get().c;
 if(count===0){
  const users=[
   ['Tanish','admin','Pdc@2026','Admin','Management','Admin / Operations'],
   ['Sidhant','sidhant','Sidhant@2026','Employee','Production','Video Production / Shoot'],
   ['Nitin','nitin','Nitin@2026','Employee','Production','Video Production Executive'],
   ['Zaki','zaki','Zaki@2026','Employee','Creative','Graphic + Motion Graphics Designer'],
   ['Saijal','saijal','Saijal@2026','Employee','Client Relations','Client Relations Executive'],
   ['Ram','ram','Ram@2026','Employee','Client Management','Client Management Executive'],
   ['Sandhya','sandhya','Sandhya@2026','Employee','HR / Operations','HR / Operations Executive'],
   ['Priya','priya','Priya@2026','Employee','Sales','Sales / Business Development']
  ];
  const ins=db.prepare(`INSERT INTO users(name,employee_code,password_hash,role,department,designation,joining_date,employment_type,monthly_salary,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  for(const u of users) ins.run(u[0],u[1],passwordHash(u[2]),u[3],u[4],u[5],today(),'Full Time',0,now(),now());
 }
 const c=db.prepare('SELECT COUNT(*) c FROM clients').get().c;
 if(c===0){
  const clients=[['Rasagola Express','RE'],['Chai Theatre','CT'],['White Mantra','WM'],['Dantastra Dental Hub','DDH'],['MyCA Desk','CA Desk'],['Meenal Personal Branding','Meenal'],['The Cosmo Experience','Cosmo']];
  const ins=db.prepare('INSERT INTO clients(name,short_name,created_at) VALUES(?,?,?)'); for(const x of clients) ins.run(x[0],x[1],now());
 }
}
seed();

function userBySession(req){
 const auth=req.headers.authorization||''; if(!auth.startsWith('Bearer ')) return null;
 const tokenHash=hash(auth.slice(7));
 const r=db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(tokenHash,now());
 return r||null;
}
function requireAuth(req,res){ const u=userBySession(req); if(!u){ send(res,401,{error:'Unauthorized'}); return null; } return u; }
function requireAdmin(req,res){ const u=requireAuth(req,res); if(u && u.role!=='Admin'){ send(res,403,{error:'Admin only'}); return null; } return u; }
function audit(actor,action,type,id,meta=''){ db.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,meta,created_at) VALUES(?,?,?,?,?,?)').run(actor?.id||null,action,type,id,meta,now()); }
function notify(recipientId,type,title,body,entityType='',entityId=null,dedupeKey=''){
 const existing=dedupeKey?db.prepare('SELECT id FROM notifications WHERE recipient_id=? AND dedupe_key=?').get(recipientId,dedupeKey):null;
 if(existing) return existing.id;
 const r=db.prepare('INSERT INTO notifications(recipient_id,type,title,body,entity_type,entity_id,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?,?)').run(recipientId,type,title,body,entityType,entityId,dedupeKey,now());
 return r.lastInsertRowid;
}
function notifyAdmins(type,title,body,entityType='',entityId=null,dedupeKey=''){
 const admins=db.prepare("SELECT id FROM users WHERE role='Admin' AND active=1").all();
 for(const a of admins) notify(a.id,type,title,body,entityType,entityId,dedupeKey?`${dedupeKey}:admin:${a.id}`:'');
}
function parseBody(req){ return new Promise((resolve,reject)=>{ let d=''; req.on('data',c=>{d+=c; if(d.length>15*1024*1024){req.destroy(); reject(new Error('Payload too large'));}}); req.on('end',()=>{try{resolve(d?JSON.parse(d):{})}catch(e){reject(e)}}); }); }
function send(res,status,data,headers={}){ const out=JSON.stringify(data); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(out); }
function sendFile(res,file){ const ext=path.extname(file); const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json'}; res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'}); fs.createReadStream(file).pipe(res); }
function workingDay(date){ const d=new Date(date+'T00:00:00Z'); const day=d.getUTCDay(); const n=day===0?7:day; return getSetting('work_week',defaultSettings.work_week).split(',').map(Number).includes(n); }
function lastDateForPayroll(month){ const [y,m]=month.split('-').map(Number); const last=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10); const current=today(); return month===current.slice(0,7) ? current : last; }
function firstOfMonth(month){ return month+'-01'; }
function dateRange(start,end){ const out=[]; let d=new Date(start+'T00:00:00Z'); const e=new Date(end+'T00:00:00Z'); while(d<=e){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1)} return out; }
function calcMonthly(userId,month){
 const u=db.prepare('SELECT * FROM users WHERE id=?').get(userId); if(!u) return null;
 const start=firstOfMonth(month);
 const lastDay=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
 const currentMonth=today().slice(0,7); const asOf=month===currentMonth?today():lastDay;
 const elapsedDates=dateRange(start,asOf).filter(workingDay);
 const fullMonthWorkingDays=dateRange(start,lastDay).filter(workingDay);
 const salary=Number(u.monthly_salary||0);
 const divisorSetting=String(getSetting('salary_divisor','working_days'));
 const salaryDivisor=divisorSetting==='working_days'?Math.max(fullMonthWorkingDays.length,1):Math.max(Number(divisorSetting)||fullMonthWorkingDays.length,1);
 const approved=db.prepare("SELECT * FROM leave_requests WHERE user_id=? AND leave_date BETWEEN ? AND ? AND status='Approved'").all(userId,start,asOf);
 const approvedMap=new Map(approved.map(x=>[x.leave_date,x]));
 const atts=db.prepare('SELECT * FROM attendance_days WHERE user_id=? AND date BETWEEN ? AND ?').all(userId,start,asOf);
 const attMap=new Map(atts.map(x=>[x.date,x]));
 let present=0,half=0,fullLeave=0,absent=0,pending=0;
 for(const d of elapsedDates){
  const approvedLeave=approvedMap.get(d); const st=attMap.get(d)?.status;
  if(approvedLeave?.leave_type==='Full Day'||(!approvedLeave&&st==='Leave')) fullLeave++;
  else if(approvedLeave?.leave_type==='Half Day'||(!approvedLeave&&['Half Day','Late / Half Day'].includes(st))) half++;
  else if(st==='Present') present++;
  else if(st==='Absent') absent++;
  else if(!st) pending++;
  else absent++;
 }
 const perDay=salary/salaryDivisor;
 const deductionUnits=absent+fullLeave+half*0.5;
 const rawAttendanceDeduction=deductionUnits*perDay;
 const adjustment=Number(db.prepare('SELECT COALESCE(SUM(amount),0) total FROM payroll_adjustments WHERE user_id=? AND month=?').get(userId,month).total||0);
 const allowance=Math.max(0,adjustment); const adjustmentDeduction=Math.max(0,-adjustment);
 const closure=db.prepare('SELECT closed_at FROM payroll_closures WHERE month=?').get(month);
 const isClosed=!!closure;
 const attendanceDeduction=isClosed?rawAttendanceDeduction:0;
 const appliedAdjustment=isClosed?adjustment:0;
 const totalDeductions=isClosed?(attendanceDeduction+adjustmentDeduction):0;
 const net=isClosed?Math.max(0,salary-totalDeductions+allowance):salary;
 const taskStats=db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status='Done' THEN 1 ELSE 0 END) done FROM tasks WHERE assignee_id=? AND due_date BETWEEN ? AND ?`).get(userId,start,asOf);
 const workHours=db.prepare(`SELECT COALESCE(SUM((julianday(COALESCE(ended_at,datetime('now')))-julianday(started_at))*24),0) h FROM work_sessions WHERE user_id=? AND substr(started_at,1,7)=?`).get(userId,month).h;
 const reportHours=db.prepare('SELECT COALESCE(SUM(hours),0) h FROM work_reports WHERE user_id=? AND work_date BETWEEN ? AND ?').get(userId,start,asOf).h;
 const paidUnits=present+half*0.5; const attendancePct=elapsedDates.length?Math.round((paidUnits/elapsedDates.length)*100):0;
 return {user_id:userId,month,as_of:asOf,working_days:fullMonthWorkingDays.length,elapsed_working_days:elapsedDates.length,salary_divisor:salaryDivisor,salary_divisor_type:divisorSetting==='working_days'?'working_days':'fixed',is_closed:isClosed,closed_at:closure?.closed_at||null,present,absent,half_day:half,full_leave:fullLeave,half_leave:half,pending_days:pending,base_salary:salary,per_day:Math.round(perDay*100)/100,deduction_units:Math.round(deductionUnits*100)/100,absent_deduction:Math.round((isClosed?absent*perDay:0)*100)/100,half_day_deduction:Math.round((isClosed?(fullLeave*perDay+half*perDay*0.5):0)*100)/100,deduction:Math.round(attendanceDeduction*100)/100,adjustment:Math.round(appliedAdjustment*100)/100,raw_adjustment:Math.round(adjustment*100)/100,adjustment_deduction:Math.round((isClosed?adjustmentDeduction:0)*100)/100,allowances:Math.round((isClosed?allowance:0)*100)/100,total_deductions:Math.round(totalDeductions*100)/100,net_payable:Math.round(net*100)/100,tasks_assigned:taskStats.total||0,tasks_done:taskStats.done||0,work_hours:Math.round(Number(workHours||0)*100)/100,reported_hours:Math.round(Number(reportHours||0)*100)/100,attendance_pct:attendancePct};
}

async function handle(req,res){
 const parsed=url.parse(req.url,true); const p=parsed.pathname; const method=req.method||'GET';
 try{
  if(method==='GET' && p==='/'){ return sendFile(res,path.join(PUBLIC,'index.html')); }
  if(method==='GET' && p.startsWith('/static/')) { const f=path.join(PUBLIC,p.slice(8)); return fs.existsSync(f)?sendFile(res,f):send(res,404,{error:'Not found'}); }
  if(method==='GET' && p.startsWith('/uploads/')) { const f=path.join(UPLOADS,path.basename(p)); return fs.existsSync(f)?sendFile(res,f):send(res,404,{error:'Not found'}); }

  if(method==='GET' && p==='/api/auth/google/config'){
   const clientId=process.env.GOOGLE_CLIENT_ID || getSetting('google_client_id','');
   return send(res,200,{enabled:Boolean(clientId),clientId:clientId||null});
  }
  if(method==='POST' && p==='/api/login'){
   const b=await parseBody(req); const queryVal=String(b.user_id||'').trim().toLowerCase();
   const user=db.prepare('SELECT * FROM users WHERE (LOWER(employee_code)=? OR LOWER(email)=?) AND active=1').get(queryVal,queryVal);
   if(!user || !verifyPassword(String(b.password||''),user.password_hash)){ audit(null,'LOGIN_FAILED','session',null,queryVal); return send(res,401,{error:'Invalid User ID or Password'}); }
   return executeLoginSession(user,res);
  }
  if(method==='POST' && p==='/api/register'){
   const b=await parseBody(req);
   const name=String(b.name||'').trim(), email=String(b.email||'').trim().toLowerCase(), password=String(b.password||''), department=String(b.department||'General').trim(), phone=String(b.phone||'').trim();
   if(!name) return send(res,400,{error:'Full name is required.'});
   if(!email || !email.includes('@')) return send(res,400,{error:'A valid email address is required.'});
   if(!password || password.length<6) return send(res,400,{error:'Password must be at least 6 characters long.'});
   const existing=db.prepare('SELECT id FROM users WHERE LOWER(email)=? OR LOWER(employee_code)=?').get(email,email);
   if(existing) return send(res,400,{error:'An account with this email address already exists.'});
   const empCode=generateEmployeeCode();
   const pHash=passwordHash(password);
   const currentTime=now(); const joiningDate=today();
   const info=db.prepare(`INSERT INTO users(name,employee_code,password_hash,role,department,designation,joining_date,employment_type,phone,email,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(name,empCode,pHash,'Employee',department||'General','Team Member',joiningDate,'Full Time',phone,email,currentTime,currentTime);
   const newUser=db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
   audit(newUser,'REGISTER','user',newUser.id,`User registered with code ${empCode}`);
   return executeLoginSession(newUser,res);
  }
  if(method==='POST' && p==='/api/auth/google'){
   const b=await parseBody(req);
   let userEmail='', userName='', subId='';
   if(b.credential){
    try{
     const parts=b.credential.split('.');
     if(parts.length===3){ const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')); userEmail=payload.email||''; userName=payload.name||(payload.email?payload.email.split('@')[0]:''); subId=payload.sub||''; }
    }catch(e){ return send(res,400,{error:'Invalid Google token payload.'}); }
   }else if(b.email && b.name){ userEmail=b.email; userName=b.name; subId=b.google_id || `google_${hash(b.email).slice(0,12)}`; }
   else return send(res,400,{error:'Google sign-in information incomplete.'});
   if(!userEmail || !userEmail.includes('@')) return send(res,400,{error:'Valid Google email is required.'});
   const cleanEmail=userEmail.trim().toLowerCase();
   let user=db.prepare('SELECT * FROM users WHERE LOWER(email)=? OR (google_id<>"" AND google_id=?)').get(cleanEmail,subId);
   if(!user){
    const empCode=generateEmployeeCode(); const dummyPassword=passwordHash(uid()); const currentTime=now(); const joiningDate=today();
    const info=db.prepare(`INSERT INTO users(name,employee_code,password_hash,role,department,designation,joining_date,employment_type,phone,email,google_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(userName.trim(),empCode,dummyPassword,'Employee','General','Team Member',joiningDate,'Full Time','',cleanEmail,subId,currentTime,currentTime);
    user=db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    audit(user,'OAUTH_REGISTER','user',user.id,`User registered via Google OAuth (${empCode})`);
   }else if(!user.google_id && subId){ db.prepare('UPDATE users SET google_id=?, updated_at=? WHERE id=?').run(subId,now(),user.id); }
   if(!user.active) return send(res,403,{error:'Account is inactive. Contact administrator.'});
   return executeLoginSession(user,res);
  }
  if(method==='POST' && p==='/api/logout'){
   const u=requireAuth(req,res); if(!u)return;
   db.prepare(`UPDATE login_sessions SET logout_at=? WHERE id=(SELECT id FROM login_sessions WHERE user_id=? AND logout_at IS NULL ORDER BY login_at DESC LIMIT 1)`).run(now(),u.id);
   const auth=req.headers.authorization||''; db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(auth.slice(7))); audit(u,'LOGOUT','session',null,'Logout'); return send(res,200,{ok:true});
  }
  const u=requireAuth(req,res); if(!u)return;

  if(method==='GET' && p==='/api/me') return send(res,200,{user:{id:u.id,name:u.name,employee_code:u.employee_code,role:u.role,department:u.department,designation:u.designation,email:u.email,phone:u.phone,joining_date:u.joining_date,employment_type:u.employment_type,monthly_salary:u.monthly_salary,monthly_target_tasks:u.monthly_target_tasks,monthly_target_hours:u.monthly_target_hours}});
  if(method==='GET' && p==='/api/bootstrap'){
   const users=u.role==='Admin'?db.prepare('SELECT id,name,employee_code,role,department,designation,joining_date,employment_type,manager_id,phone,email,monthly_salary,monthly_target_tasks,monthly_target_hours,active FROM users ORDER BY name').all():db.prepare('SELECT id,name,employee_code,role,department,designation,active FROM users WHERE active=1 ORDER BY name').all();
   const clients=db.prepare('SELECT * FROM clients ORDER BY name').all();
   const tasks=u.role==='Admin'?db.prepare(`SELECT t.*,u.name assignee_name,c.short_name client_short FROM tasks t JOIN users u ON u.id=t.assignee_id LEFT JOIN clients c ON c.id=t.client_id ORDER BY CASE t.status WHEN 'Blocked' THEN 1 WHEN 'In Progress' THEN 2 WHEN 'Not Started' THEN 3 ELSE 4 END,t.due_date`).all():db.prepare(`SELECT t.*,u.name assignee_name,c.short_name client_short FROM tasks t JOIN users u ON u.id=t.assignee_id LEFT JOIN clients c ON c.id=t.client_id WHERE t.assignee_id=? ORDER BY CASE t.status WHEN 'Blocked' THEN 1 WHEN 'In Progress' THEN 2 WHEN 'Not Started' THEN 3 ELSE 4 END,t.due_date`).all(u.id);
   const leaves=u.role==='Admin'?db.prepare(`SELECT l.*,u.name user_name,u.employee_code FROM leave_requests l JOIN users u ON u.id=l.user_id ORDER BY CASE l.status WHEN 'Pending' THEN 1 ELSE 2 END,l.leave_date DESC`).all():db.prepare(`SELECT * FROM leave_requests WHERE user_id=? ORDER BY requested_at DESC`).all(u.id);
   const reports=u.role==='Admin'?db.prepare(`SELECT w.*,u.name user_name,t.title task_title,c.short_name client_short FROM work_reports w JOIN users u ON u.id=w.user_id LEFT JOIN tasks t ON t.id=w.task_id LEFT JOIN clients c ON c.id=w.client_id ORDER BY w.work_date DESC,w.created_at DESC LIMIT 200`).all():db.prepare(`SELECT w.*,t.title task_title,c.short_name client_short FROM work_reports w LEFT JOIN tasks t ON t.id=w.task_id LEFT JOIN clients c ON c.id=w.client_id WHERE w.user_id=? ORDER BY w.work_date DESC,w.created_at DESC LIMIT 100`).all(u.id);
   const chats=db.prepare(`SELECT m.*,s.name sender_name,r.name receiver_name FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id WHERE m.sender_id=? OR m.receiver_id=? ORDER BY m.created_at DESC LIMIT 300`).all(u.id,u.id);
   return send(res,200,{user:{id:u.id,name:u.name,employee_code:u.employee_code,role:u.role,department:u.department,designation:u.designation},users,clients,tasks,leaves,reports,chats,settings:Object.fromEntries(Object.keys(defaultSettings).map(k=>[k,getSetting(k,defaultSettings[k])] ))});
  }
  if(method==='GET' && p==='/api/attendance'){
   const month=parsed.query.month||today().slice(0,7); const target=u.role==='Admin'?(parsed.query.user_id?Number(parsed.query.user_id):null):u.id;
   const users=target?[db.prepare('SELECT * FROM users WHERE id=?').get(target)]:db.prepare('SELECT * FROM users WHERE active=1 ORDER BY name').all();
   const out=users.filter(Boolean).map(x=>({user_id:x.id,name:x.name,employee_code:x.employee_code,rows:db.prepare('SELECT * FROM attendance_days WHERE user_id=? AND date LIKE ? ORDER BY date DESC').all(x.id,month+'-%'),summary:calcMonthly(x.id,month)}));
   return send(res,200,{month,data:out});
  }
  if(method==='POST' && p==='/api/work/toggle'){
   if(u.role!=='Admin' && !u.id) return send(res,403,{error:'Forbidden'});
   const b=await parseBody(req); const isOn=!!b.on; if(isOn && b.task_id && u.role!=='Admin'){ const owned=db.prepare('SELECT id FROM tasks WHERE id=? AND assignee_id=?').get(Number(b.task_id),u.id); if(!owned)return send(res,403,{error:'Task is not assigned to you'}); } const open=db.prepare('SELECT * FROM work_sessions WHERE user_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(u.id);
   if(isOn){ if(open)return send(res,400,{error:'Work session already ON'}); db.prepare('INSERT INTO work_sessions(user_id,task_id,started_at) VALUES(?,?,?)').run(u.id,b.task_id||null,now()); audit(u,'WORK_ON','work_session',null,String(b.task_id||'')); return send(res,200,{ok:true,status:'ON'}); }
   if(!open)return send(res,400,{error:'No active work session'}); db.prepare('UPDATE work_sessions SET ended_at=? WHERE id=?').run(now(),open.id); audit(u,'WORK_OFF','work_session',open.id); return send(res,200,{ok:true,status:'OFF'});
  }
  if(method==='GET' && p==='/api/work/status'){
   const target=u.role==='Admin' && parsed.query.user_id ? Number(parsed.query.user_id):u.id; const open=db.prepare(`SELECT ws.*,t.title task_title FROM work_sessions ws LEFT JOIN tasks t ON t.id=ws.task_id WHERE ws.user_id=? AND ws.ended_at IS NULL ORDER BY ws.started_at DESC LIMIT 1`).get(target); return send(res,200,{on:!!open,session:open||null});
  }
  if(method==='GET' && p==='/api/work/time'){
   const month=parsed.query.month||today().slice(0,7); const target=u.role==='Admin'?(parsed.query.user_id?Number(parsed.query.user_id):null):u.id;
   const q=target?db.prepare(`SELECT user_id,COALESCE(SUM((julianday(COALESCE(ended_at,datetime('now')))-julianday(started_at))*24),0) h FROM work_sessions WHERE user_id=? AND substr(started_at,1,7)=? GROUP BY user_id`):db.prepare(`SELECT user_id,COALESCE(SUM((julianday(COALESCE(ended_at,datetime('now')))-julianday(started_at))*24),0) h FROM work_sessions WHERE substr(started_at,1,7)=? GROUP BY user_id`);
   return send(res,200,{month,data:target?q.all(target,month):q.all(month)});
  }
  if(method==='POST' && p==='/api/tasks'){
   const admin=requireAdmin(req,res); if(!admin)return; const b=await parseBody(req);
   const assigneeId=Number(b.assignee_id); const assignee=db.prepare("SELECT id,name FROM users WHERE id=? AND active=1").get(assigneeId); if(!assignee)return send(res,400,{error:'Invalid assignee'});
   const r=db.prepare(`INSERT INTO tasks(title,description,assignee_id,client_id,priority,category,status,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(b.title,b.description||'',assigneeId,b.client_id?Number(b.client_id):null,b.priority||'Medium',b.category||'Other',b.status||'Not Started',b.due_date,now(),now());
   notify(assigneeId,'task_assigned','New task assigned',`You have been assigned: ${b.title}`, 'task', Number(r.lastInsertRowid), `task_assigned:${r.lastInsertRowid}:${assigneeId}`);
   audit(admin,'CREATE','task',r.lastInsertRowid,b.title); return send(res,201,{id:r.lastInsertRowid});
  }
  if(method==='PUT' && p.startsWith('/api/tasks/')){
   const id=Number(p.split('/').pop()); const b=await parseBody(req); const existing=db.prepare('SELECT * FROM tasks WHERE id=?').get(id); if(!existing)return send(res,404,{error:'Task not found'}); if(u.role!=='Admin'&&existing.assignee_id!==u.id)return send(res,403,{error:'Forbidden'});
   const status=b.status??existing.status; const nextAssignee=Number(b.assignee_id??existing.assignee_id); const completed=status==='Done'?(existing.completed_at||today()):null;
   db.prepare(`UPDATE tasks SET title=?,description=?,assignee_id=?,client_id=?,priority=?,category=?,status=?,due_date=?,updated_at=?,completed_at=? WHERE id=?`).run(b.title??existing.title,b.description??existing.description,nextAssignee,b.client_id===null?null:Number(b.client_id??existing.client_id),b.priority??existing.priority,b.category??existing.category,status,b.due_date??existing.due_date,now(),completed,id);
   if(u.role==='Admin' && nextAssignee!==existing.assignee_id) notify(nextAssignee,'task_assigned','Task reassigned',`You have been assigned: ${b.title??existing.title}`,'task',id,`task_reassigned:${id}:${nextAssignee}:${Date.now()}`);
   if(status!==existing.status && status!=='Done' && nextAssignee===existing.assignee_id && u.role==='Admin') notify(nextAssignee,'task_status','Task updated',`${b.title??existing.title} is now ${status}.`,'task',id,`task_status:${id}:${status}:${today()}`);
   if(status==='Done' && existing.status!=='Done'){
     notifyAdmins('task_done','Work completed',`${existing.title} was marked Done by ${u.name}.`,'task',id,`task_done:${id}:${today()}`);
     if(u.role==='Admin') notify(nextAssignee,'task_done','Work marked done',`${existing.title} was marked Done by Admin.`,'task',id,`task_done_employee:${id}:${today()}`);
   }
   audit(u,'UPDATE','task',id,status); return send(res,200,{ok:true});
  }
  if(method==='DELETE' && p.startsWith('/api/tasks/')){ const admin=requireAdmin(req,res);if(!admin)return;const id=Number(p.split('/').pop());db.prepare('DELETE FROM tasks WHERE id=?').run(id);audit(admin,'DELETE','task',id);return send(res,200,{ok:true}); }
  if(method==='POST' && p==='/api/uploads'){
   const b=await parseBody(req); const name=String(b.name||'file'); const data=String(b.data||''); if(!data.startsWith('data:')) return send(res,400,{error:'Invalid file payload'});
   const m=data.match(/^data:([^;]+);base64,(.*)$/s); if(!m)return send(res,400,{error:'Invalid data URL'}); const buf=Buffer.from(m[2],'base64'); if(buf.length>10*1024*1024)return send(res,400,{error:'File too large (10 MB max)'});
   const safe=name.replace(/[^a-zA-Z0-9._-]/g,'_'); const filename=`${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safe}`; fs.writeFileSync(path.join(UPLOADS,filename),buf); audit(u,'UPLOAD','file',null,name); return send(res,201,{name,url:`/uploads/${filename}`});
  }
  if(method==='POST' && p==='/api/reports'){
   const b=await parseBody(req);
   if(!String(b.work_text||'').trim()) return send(res,400,{error:'Work description is required'});
   const hours=Number(b.hours||0); if(!Number.isFinite(hours)||hours<0||hours>24)return send(res,400,{error:'Hours must be between 0 and 24'});
   if(u.role!=='Admin' && b.user_id && Number(b.user_id)!==u.id)return send(res,403,{error:'Forbidden'});
   const uid2=u.role==='Admin'&&b.user_id?Number(b.user_id):u.id;
   let task=null; if(b.task_id){ task=db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(b.task_id)); if(!task)return send(res,404,{error:'Task not found'}); if(u.role!=='Admin' && task.assignee_id!==u.id)return send(res,403,{error:'Task is not assigned to you'}); }
   const r=db.prepare(`INSERT INTO work_reports(user_id,task_id,client_id,work_date,work_text,hours,work_drive_link,poster_drive_link,attachment_path,attachment_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid2,b.task_id?Number(b.task_id):null,b.client_id?Number(b.client_id):null,b.work_date||today(),b.work_text.trim(),hours,b.work_drive_link||'',b.poster_drive_link||'',b.attachment_path||'',b.attachment_name||'',now(),now());
   if(b.task_id && b.mark_done){ db.prepare("UPDATE tasks SET status='Done',completed_at=?,updated_at=? WHERE id=?").run(today(),now(),Number(b.task_id)); notifyAdmins('task_done','Work completed',`${u.name} submitted work and marked “${task.title}” as Done.`,'task',Number(b.task_id),`task_done:${b.task_id}:${today()}`); }
   notifyAdmins('work_submitted','New work submitted',`${u.name} submitted a daily work report${task?' for '+task.title:''}.`,'work_report',Number(r.lastInsertRowid),`work_submitted:${r.lastInsertRowid}`);
   audit(u,'SUBMIT','work_report',r.lastInsertRowid,b.work_text.trim().slice(0,80)||''); return send(res,201,{id:r.lastInsertRowid});
  }
  if(method==='POST' && p==='/api/leaves'){
   const b=await parseBody(req); if(!b.leave_date||!['Full Day','Half Day'].includes(b.leave_type)||!String(b.reason||'').trim())return send(res,400,{error:'Date, type and reason are required'});
   const r=db.prepare(`INSERT INTO leave_requests(user_id,leave_date,leave_type,reason,status,requested_at) VALUES(?,?,?,?, 'Pending',?)`).run(u.id,b.leave_date,b.leave_type,b.reason.trim(),now());
   notifyAdmins('leave_request','New leave request',`${u.name} requested ${b.leave_type} for ${b.leave_date}.`,'leave',Number(r.lastInsertRowid),`leave_request:${r.lastInsertRowid}`);
   audit(u,'REQUEST','leave',r.lastInsertRowid,b.leave_type); return send(res,201,{id:r.lastInsertRowid});
  }
  if(method==='PUT' && p.startsWith('/api/leaves/')){
   const admin=requireAdmin(req,res);if(!admin)return;const id=Number(p.split('/').pop());const b=await parseBody(req);if(!['Approved','Rejected'].includes(b.status))return send(res,400,{error:'Invalid status'});const lr=db.prepare('SELECT * FROM leave_requests WHERE id=?').get(id);if(!lr)return send(res,404,{error:'Not found'});db.prepare('UPDATE leave_requests SET status=?,reviewed_at=? WHERE id=?').run(b.status,now(),id);if(b.status==='Approved'){const prior=db.prepare('SELECT * FROM attendance_days WHERE user_id=? AND date=?').get(lr.user_id,lr.leave_date);const st=lr.leave_type==='Half Day'?'Half Day':'Leave'; if(prior) db.prepare('UPDATE attendance_days SET status=?,manual_note=? WHERE id=?').run(st,'Approved leave',prior.id); else db.prepare('INSERT INTO attendance_days(user_id,date,status,first_login,manual_note) VALUES(?,?,?,NULL,?)').run(lr.user_id,lr.leave_date,st,'Approved leave');} notify(lr.user_id,'leave_decision',`Leave ${b.status.toLowerCase()}`,`Your ${lr.leave_type} request for ${lr.leave_date} was ${b.status.toLowerCase()}.`,'leave',id,`leave_decision:${id}:${b.status}`); audit(admin,b.status.toUpperCase(),'leave',id);return send(res,200,{ok:true});
  }
  if(method==='PUT' && p.startsWith('/api/attendance/')){
   const admin=requireAdmin(req,res);if(!admin)return;const parts=p.split('/');const id=Number(parts[3]);const b=await parseBody(req);const r=db.prepare('SELECT * FROM attendance_days WHERE id=?').get(id);if(!r)return send(res,404,{error:'Attendance record not found'});
   const allowed=['Present','Absent','Leave','Half Day','Late / Half Day'];if(!allowed.includes(b.status))return send(res,400,{error:'Invalid attendance status'});db.prepare('UPDATE attendance_days SET status=?,manual_note=? WHERE id=?').run(b.status,b.manual_note||'',id);notify(r.user_id,'attendance_update','Attendance updated',`Your attendance for ${r.date} was updated to ${b.status}.`,'attendance',id,`attendance_update:${id}:${b.status}`);audit(admin,'UPDATE','attendance',id,b.status);return send(res,200,{ok:true});
  }
  if(method==='GET' && p==='/api/payroll'){
   const admin=requireAdmin(req,res);if(!admin)return;const month=parsed.query.month||today().slice(0,7);const users=db.prepare("SELECT * FROM users WHERE active=1 ORDER BY name").all();const rows=users.map(x=>{const r=calcMonthly(x.id,month); const pay=db.prepare('SELECT status,paid_at,note FROM payroll_payments WHERE user_id=? AND month=?').get(x.id,month); r.payment_status=pay?.status||'Pending'; r.paid_at=pay?.paid_at||null; r.payment_note=pay?.note||''; r.name=x.name; return r;});const total=rows.reduce((a,b)=>a+b.net_payable,0),gross=rows.reduce((a,b)=>a+b.base_salary,0),ded=rows.reduce((a,b)=>a+b.total_deductions,0);const closure=db.prepare('SELECT month,closed_at FROM payroll_closures WHERE month=?').get(month);return send(res,200,{month,closed:!!closure,closed_at:closure?.closed_at||null,rows,totals:{gross,net_payable:Math.round(total*100)/100,deductions:Math.round(ded*100)/100}});
  }
  if(method==='POST' && p==='/api/payroll/close'){
   const admin=requireAdmin(req,res);if(!admin)return;const b=await parseBody(req);const month=String(b.month||'');if(!/^\d{4}-\d{2}$/.test(month))return send(res,400,{error:'Valid month is required'});const existing=db.prepare('SELECT month FROM payroll_closures WHERE month=?').get(month);if(existing)return send(res,409,{error:'Payroll month is already finalized'});db.prepare('INSERT INTO payroll_closures(month,closed_at,closed_by) VALUES(?,?,?)').run(month,now(),admin.id);audit(admin,'CLOSE','payroll',null,month);return send(res,200,{ok:true,month});
  }
  if(method==='POST' && p==='/api/payroll/reopen'){
   const admin=requireAdmin(req,res);if(!admin)return;const b=await parseBody(req);const month=String(b.month||'');db.prepare('DELETE FROM payroll_closures WHERE month=?').run(month);db.prepare("UPDATE payroll_payments SET status='Pending',paid_at=NULL WHERE month=?").run(month);audit(admin,'REOPEN','payroll',null,month);return send(res,200,{ok:true,month});
  }
  if(method==='POST' && p==='/api/payroll/payment'){
   const admin=requireAdmin(req,res);if(!admin)return;const b=await parseBody(req);const uid=Number(b.user_id),month=b.month;const closed=db.prepare('SELECT month FROM payroll_closures WHERE month=?').get(month);if(b.status==='Paid'&&!closed)return send(res,400,{error:'Finalize the payroll month before marking salary as Paid'});const statusVal=b.status==='Paid'?'Paid':'Pending';db.prepare(`INSERT INTO payroll_payments(user_id,month,status,paid_at,note) VALUES(?,?,?,?,?) ON CONFLICT(user_id,month) DO UPDATE SET status=excluded.status,paid_at=excluded.paid_at,note=excluded.note`).run(uid,month,statusVal,statusVal==='Paid'?now():null,b.note||'');audit(admin,'PAYMENT_'+statusVal,'payroll',uid,`${month}:${statusVal}`);return send(res,200,{ok:true});
  }
  if(method==='POST' && p==='/api/payroll/adjustment'){const admin=requireAdmin(req,res);if(!admin)return;const b=await parseBody(req);const r=db.prepare('INSERT INTO payroll_adjustments(user_id,month,amount,note,created_at) VALUES(?,?,?,?,?)').run(Number(b.user_id),b.month,Number(b.amount||0),b.note||'',now());audit(admin,'CREATE','payroll_adjustment',r.lastInsertRowid);return send(res,201,{id:r.lastInsertRowid});}
  if(method==='PUT' && p.startsWith('/api/users/')){
   const admin=requireAdmin(req,res);if(!admin)return;const id=Number(p.split('/').pop());const existing=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!existing)return send(res,404,{error:'Not found'});const b=await parseBody(req); let ph=existing.password_hash; if(b.password)ph=passwordHash(String(b.password)); const fields=['name','employee_code','role','department','designation','joining_date','employment_type','phone','email','monthly_salary','monthly_target_tasks','monthly_target_hours','active','manager_id']; const vals=fields.map(k=>b[k]!==undefined?b[k]:existing[k]); const sql=`UPDATE users SET ${fields.map(k=>k+'=?').join(',')},password_hash=?,updated_at=? WHERE id=?`; db.prepare(sql).run(...vals,ph,now(),id);audit(admin,'UPDATE','user',id,JSON.stringify({salary:b.monthly_salary}));return send(res,200,{ok:true});
  }
  if(method==='POST' && p==='/api/users'){
   const admin=requireAdmin(req,res);if(!admin)return;const b=await parseBody(req);const r=db.prepare(`INSERT INTO users(name,employee_code,password_hash,role,department,designation,joining_date,employment_type,phone,email,monthly_salary,monthly_target_tasks,monthly_target_hours,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.name,b.employee_code,passwordHash(b.password||'Welcome@2026'),b.role||'Employee',b.department||'',b.designation||'',b.joining_date||today(),b.employment_type||'Full Time',b.phone||'',b.email||'',b.monthly_salary||0,b.monthly_target_tasks||0,b.monthly_target_hours||0,b.active===0?0:1,now(),now());audit(admin,'CREATE','user',r.lastInsertRowid,b.employee_code);return send(res,201,{id:r.lastInsertRowid});
  }
  if(method==='GET' && p==='/api/clients') return send(res,200,{clients:db.prepare('SELECT * FROM clients ORDER BY name').all()});
  if(method==='POST' && p==='/api/clients'){const admin=requireAdmin(req,res);if(!admin)return;const b=await parseBody(req);const r=db.prepare('INSERT INTO clients(name,short_name,created_at) VALUES(?,?,?)').run(b.name,b.short_name,now());audit(admin,'CREATE','client',r.lastInsertRowid,b.name);return send(res,201,{id:r.lastInsertRowid});}
  if(method==='PUT' && p.startsWith('/api/clients/')){const admin=requireAdmin(req,res);if(!admin)return;const id=Number(p.split('/').pop());const b=await parseBody(req);db.prepare('UPDATE clients SET name=?,short_name=?,active=? WHERE id=?').run(b.name,b.short_name,b.active===0?0:1,id);audit(admin,'UPDATE','client',id);return send(res,200,{ok:true});}
  if(method==='GET' && p==='/api/chat'){
   const withId=Number(parsed.query.with_id); if(!withId)return send(res,400,{error:'with_id required'}); const other=db.prepare('SELECT id,name,role FROM users WHERE id=?').get(withId); if(!other)return send(res,404,{error:'User not found'});
   const msgs=db.prepare(`SELECT m.*,s.name sender_name,r.name receiver_name FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at`).all(u.id,withId,withId,u.id); db.prepare('UPDATE messages SET read_at=? WHERE sender_id=? AND receiver_id=? AND read_at IS NULL').run(now(),withId,u.id);return send(res,200,{user:other,messages:msgs});
  }
  if(method==='POST' && p==='/api/chat'){
   const b=await parseBody(req);const receiver=Number(b.receiver_id);if(!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(receiver))return send(res,404,{error:'Receiver not found'});const body=String(b.body||'').trim();if(!body)return send(res,400,{error:'Message empty'});const r=db.prepare('INSERT INTO messages(sender_id,receiver_id,body,created_at) VALUES(?,?,?,?)').run(u.id,receiver,body,now());notify(receiver,'chat_message',`New message from ${u.name}`,body.slice(0,120),'message',Number(r.lastInsertRowid),`chat_message:${r.lastInsertRowid}`);return send(res,201,{id:r.lastInsertRowid});
  }
  if(method==='GET' && p==='/api/notifications'){
   const pending=u.role==='Admin'?db.prepare("SELECT l.id,l.leave_date,l.leave_type,l.reason,u.name FROM leave_requests l JOIN users u ON u.id=l.user_id WHERE l.status='Pending' ORDER BY l.requested_at DESC").all():[];
   const rows=db.prepare('SELECT id,type,title,body,entity_type,entity_id,created_at,read_at FROM notifications WHERE recipient_id=? ORDER BY created_at DESC LIMIT 50').all(u.id);
   const unread=db.prepare('SELECT COUNT(*) c FROM notifications WHERE recipient_id=? AND read_at IS NULL').get(u.id).c;
   const unreadMessages=db.prepare('SELECT COUNT(*) c FROM messages WHERE receiver_id=? AND read_at IS NULL').get(u.id).c;
   return send(res,200,{pending_leaves:pending,rows,unread_notifications:unread,unread_messages:unreadMessages,unread_total:unread});
  }
  if(method==='PUT' && p==='/api/notifications/read-all'){ db.prepare('UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL').run(now(),u.id); return send(res,200,{ok:true}); }
  if(method==='PUT' && p.startsWith('/api/notifications/')){
   const id=Number(p.split('/').pop()); const n=db.prepare('SELECT * FROM notifications WHERE id=? AND recipient_id=?').get(id,u.id); if(!n)return send(res,404,{error:'Notification not found'}); db.prepare('UPDATE notifications SET read_at=? WHERE id=?').run(now(),id); return send(res,200,{ok:true});
  }
  if(method==='GET' && p==='/api/ats') { const admin=requireAdmin(req,res);if(!admin)return;return send(res,200,{rows:db.prepare('SELECT * FROM candidates ORDER BY updated_at DESC').all()}); }
  if(method==='POST' && p==='/api/ats') { const admin=requireAdmin(req,res);if(!admin)return;const b=await parseBody(req);const r=db.prepare(`INSERT INTO candidates(name,position,phone,email,source,stage,interview_date,resume_link,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(b.name,b.position,b.phone||'',b.email||'',b.source||'',b.stage||'Applied',b.interview_date||'',b.resume_link||'',b.notes||'',now(),now());audit(admin,'CREATE','candidate',r.lastInsertRowid,b.name);return send(res,201,{id:r.lastInsertRowid}); }
  if(method==='PUT' && p.startsWith('/api/ats/')) { const admin=requireAdmin(req,res);if(!admin)return;const id=Number(p.split('/').pop());const b=await parseBody(req);const e=db.prepare('SELECT * FROM candidates WHERE id=?').get(id);if(!e)return send(res,404,{error:'Not found'});db.prepare(`UPDATE candidates SET name=?,position=?,phone=?,email=?,source=?,stage=?,interview_date=?,resume_link=?,notes=?,updated_at=? WHERE id=?`).run(b.name??e.name,b.position??e.position,b.phone??e.phone,b.email??e.email,b.source??e.source,b.stage??e.stage,b.interview_date??e.interview_date,b.resume_link??e.resume_link,b.notes??e.notes,now(),id);audit(admin,'UPDATE','candidate',id);return send(res,200,{ok:true}); }
  if(method==='GET' && p==='/api/admin/dashboard'){ const admin=requireAdmin(req,res);if(!admin)return; const d=today();const active=db.prepare('SELECT COUNT(*) c FROM users WHERE active=1 AND role<>\'Admin\'').get().c;const present=db.prepare("SELECT COUNT(*) c FROM attendance_days a JOIN users u ON u.id=a.user_id WHERE a.date=? AND a.status IN ('Present','Late / Half Day','Half Day') AND u.role<>'Admin'").get(d).c;const open=db.prepare("SELECT COUNT(*) c FROM tasks WHERE status<>'Done'").get().c;const done=db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='Done' AND updated_at LIKE ?").get(d+'%').c;const pending=db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status='Pending'").get().c;const unread=db.prepare('SELECT COUNT(*) c FROM messages WHERE receiver_id=? AND read_at IS NULL').get(admin.id).c;return send(res,200,{active,present,absent:Math.max(0,active-present),open_tasks:open,completed_today:done,pending_leaves:pending,unread_chat:unread}); }
  if(method==='PUT' && p==='/api/settings'){ const admin=requireAdmin(req,res);if(!admin)return;const b=await parseBody(req);for(const k of Object.keys(defaultSettings))if(b[k]!==undefined)setSetting(k,b[k]);audit(admin,'UPDATE','settings',null);return send(res,200,{ok:true}); }
  if(method==='GET' && p==='/api/export'){const admin=requireAdmin(req,res);if(!admin)return;const payload={exported_at:now(),users:db.prepare('SELECT id,name,employee_code,role,department,designation,joining_date,employment_type,manager_id,phone,email,monthly_salary,monthly_target_tasks,monthly_target_hours,active,created_at,updated_at FROM users').all(),clients:db.prepare('SELECT * FROM clients').all(),tasks:db.prepare('SELECT * FROM tasks').all(),attendance:db.prepare('SELECT * FROM attendance_days').all(),login_sessions:db.prepare('SELECT * FROM login_sessions').all(),work_sessions:db.prepare('SELECT * FROM work_sessions').all(),work_reports:db.prepare('SELECT * FROM work_reports').all(),leave_requests:db.prepare('SELECT * FROM leave_requests').all(),payroll_adjustments:db.prepare('SELECT * FROM payroll_adjustments').all(),candidates:db.prepare('SELECT * FROM candidates').all(),messages:db.prepare('SELECT * FROM messages').all()};res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':`attachment; filename="pdc_erp_backup_${today()}.json"`});res.end(JSON.stringify(payload,null,2));return;}
  return send(res,404,{error:'Not found'});
 }catch(e){ console.error(e); return send(res,500,{error:'Server error',detail:process.env.NODE_ENV==='development'?String(e):undefined}); }
}

function automationSweep(){
 try{
  const t=today(); const nowHMValue=istHM();
  const officeEnd=getSetting('office_end','19:00'); const reportDeadline=getSetting('report_deadline','18:00');
  const afterEnd=nowHMValue>=officeEnd; const afterReport=nowHMValue>=reportDeadline;
  const employees=db.prepare("SELECT id,name FROM users WHERE active=1 AND role='Employee'").all();
  if(afterEnd){
   for(const e of employees){
    const att=db.prepare('SELECT id FROM attendance_days WHERE user_id=? AND date=?').get(e.id,t);
    const approved=db.prepare("SELECT id FROM leave_requests WHERE user_id=? AND leave_date=? AND status='Approved'").get(e.id,t);
    if(!att && !approved) db.prepare("INSERT OR IGNORE INTO attendance_days(user_id,date,status,first_login,manual_note) VALUES(?,?, 'Absent', NULL, 'Automatic end-of-day absence')").run(e.id,t);
   }
  }
  if(afterReport){
   for(const e of employees){
    const has=db.prepare('SELECT id FROM work_reports WHERE user_id=? AND work_date=?').get(e.id,t);
    const onLeave=db.prepare("SELECT id FROM leave_requests WHERE user_id=? AND leave_date=? AND status='Approved'").get(e.id,t);
    if(!has && !onLeave) notify(e.id,'report_reminder','Daily report pending',`Please submit today's work report before the day is closed.`,'work_report',null,`report_reminder:${t}:${e.id}`);
   }
  }
  // Once each calendar month reaches the month-end after office close, create one admin reminder that payroll is ready.
  const y=t.slice(0,4),m=t.slice(5,7); const lastDay=new Date(Date.UTC(Number(y),Number(m),0)).toISOString().slice(0,10);
  if(t===lastDay && afterEnd) notifyAdmins('payroll_ready','Payroll ready for review',`Automatic payroll calculation for ${t.slice(0,7)} is ready. Review deductions and mark payments when paid.`,'payroll',null,`payroll_ready:${t.slice(0,7)}`);
 }catch(e){ console.error('automationSweep',e.message); }
}
setInterval(automationSweep,60*1000); automationSweep();

const server=http.createServer(handle);
const port=Number(process.env.PORT||3000);
const host=process.env.HOST||'0.0.0.0'; server.listen(port,host,()=>console.log(`PDC ERP running at http://${host==='0.0.0.0'?'localhost':host}:${port}`));
