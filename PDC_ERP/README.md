PDC ERP — Pulse Digital Creation
================================

This is the production-oriented multi-user PDC ERP package.

Modules
-------
- Secure login / logout with employee IDs and password hashes
- Daily attendance: first login marks one attendance record per day
- Multiple login/logout sessions with exact session duration
- Work ON/OFF timer tied to an assigned task
- Task assignment, status, deadlines, priorities and ownership
- Employee daily work submission
- Work / Video Google Drive link field
- Poster / Image Google Drive link field
- Direct ERP attachment upload (up to 10 MB)
- Automatic notifications for task assignment, work submission, task completion, leave requests, leave decisions and chat messages
- Persistent in-app notification bell and unread counts
- Automatic daily report reminders after the configured report deadline
- Automatic end-of-day absent marking after office close
- Automatic month-end payroll-ready notification
- Payroll calculation with editable salary + deduction divisor
- Default payroll rule: monthly salary / 30 × (Absent + Full Leave + Half Day × 0.5)
- Admin salary edit, adjustments and Paid/Pending status
- HRMS employee master
- ATS candidate pipeline
- Company chat: every employee can chat with every other employee and Admin
- Admin-only leave approvals
- Attendance management and monthly summaries
- Sidebar collapse + fullscreen
- JSON backup export

Default login
-------------
Admin: admin / Pdc@2026
Employees:
- sidhant / Sidhant@2026
- nitin / Nitin@2026
- zaki / Zaki@2026
- saijal / Saijal@2026
- ram / Ram@2026
- sandhya / Sandhya@2026
- priya / Priya@2026

Default office rules
--------------------
- Office: 11:00–19:00
- Lunch: 13:00–14:00
- Daily report deadline: 18:00
- Work week: Monday–Saturday
- Salary divisor: 30 days

Run on Windows
--------------
1. Install Node.js 22 LTS or newer.
2. Extract the ZIP.
3. Open the pdc_erp folder.
4. Double-click start.bat.
5. Open http://localhost:3000 in Chrome/Edge.

For multiple office computers
-----------------------------
Run the server on one always-on office PC. Allow inbound TCP port 3000 in Windows Firewall if needed. Employees open:
http://<office-PC-IP>:3000

Important limitation
--------------------
The ERP is automatic inside the running server, but it does not silently detect physical presence or private computer activity. Attendance is based on ERP login; active work time is measured by the Work ON/OFF timer.

Google Drive
------------
Employees can paste Google Drive links and can upload evidence to the ERP itself. Direct one-click upload into each employee's Google Drive requires Google OAuth + Drive API credentials.

Production deployment
---------------------
For internet-facing deployment, use HTTPS, a real domain, a managed PostgreSQL database, secure secret storage, and a process manager/service. The current package is designed for an office/LAN deployment and local SQLite storage.
