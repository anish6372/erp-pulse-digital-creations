'use client';
import { useEffect, useState } from 'react';
import { api } from '../legacy/lib/api.js';
import { useApp } from './AuthContext';

const DEPARTMENTS = ['General', 'Production', 'Creative', 'Client Relations', 'HR / Operations', 'Sales'];

export default function Login() {
  const { signIn } = useApp();
  const [mode, setMode] = useState('login'); // login | register | otp
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ id: '', pass: '', name: '', email: '', regPass: '', dept: 'General', phone: '', otpPhone: '', otp: '' });
  const [otpSent, setOtpSent] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const run = async (fn) => {
    setErr('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  // Google sign-in: load Google's script only if the server has it enabled.
  useEffect(() => {
    let script;
    api('/api/auth/google/config')
      .then((cfg) => {
        if (!cfg.enabled || !cfg.clientId) return;
        script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.onload = () => {
          window.google?.accounts.id.initialize({
            client_id: cfg.clientId,
            callback: async (resp) => {
              if (!resp.credential) return;
              try {
                const d = await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: resp.credential }) });
                await signIn(d.token);
              } catch (e) {
                setErr('Google sign-in failed: ' + e.message);
              }
            },
          });
        };
        document.head.appendChild(script);
      })
      .catch(() => {});
    return () => script?.remove();
  }, [signIn]);

  const googleClick = async () => {
    try {
      const cfg = await api('/api/auth/google/config');
      if (cfg.enabled && cfg.clientId && window.google) return window.google.accounts.id.prompt();
    } catch (e) {
      /* fall through */
    }
    setErr('Google sign-in is not available. Ask your admin to enable it.');
  };

  const onLogin = (e) => {
    e.preventDefault();
    run(async () => {
      const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ user_id: f.id, password: f.pass }) });
      await signIn(d.token);
    });
  };
  const onRegister = (e) => {
    e.preventDefault();
    run(async () => {
      const d = await api('/api/register', { method: 'POST', body: JSON.stringify({ name: f.name, email: f.email, password: f.regPass, department: f.dept, phone: f.phone }) });
      await signIn(d.token);
    });
  };
  const onOtp = (e) => {
    e.preventDefault();
    run(async () => {
      if (!otpSent) {
        await api('/api/auth/otp/send', { method: 'POST', body: JSON.stringify({ phone: f.otpPhone }) });
        setOtpSent(true);
      } else {
        const d = await api('/api/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone: f.otpPhone, otp: f.otp }) });
        await signIn(d.token);
      }
    });
  };
  const switchMode = (m) => {
    setMode(m);
    setErr('');
    setOtpSent(false);
  };

  return (
    <div className="login">
      <div className="login-card">
        <img className="login-logo" src="/pdc-logo.png" alt="Pulse Digital Creation" />
        <div className="brand">
          <div>
            <h1>Pulse Digital Creation</h1>
            <p>ERP &bull; HRMS &bull; ATS &bull; Payroll &bull; Attendance</p>
          </div>
        </div>

        <div className="auth-tabs">
          <button className={'auth-tab ' + (mode !== 'register' ? 'active' : '')} type="button" onClick={() => switchMode('login')}>Sign In</button>
          <button className={'auth-tab ' + (mode === 'register' ? 'active' : '')} type="button" onClick={() => switchMode('register')}>Create Account</button>
        </div>

        {mode === 'login' && (
          <form onSubmit={onLogin}>
            <div className="field"><label>Employee Code or Email</label><input value={f.id} onChange={set('id')} placeholder="e.g. admin or EMP1001" autoComplete="username" required /></div>
            <div className="field"><label>Password</label><input type="password" value={f.pass} onChange={set('pass')} placeholder="••••••••" autoComplete="current-password" required /></div>
            {err && <div className="err">{err}</div>}
            <button className="btn" style={{ width: '100%', marginTop: 6 }} disabled={busy}>Sign in securely</button>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={onRegister}>
            <div className="field"><label>Full Name *</label><input value={f.name} onChange={set('name')} placeholder="e.g. Rahul Sharma" required /></div>
            <div className="field"><label>Email Address *</label><input type="email" value={f.email} onChange={set('email')} placeholder="rahul@company.com" required /></div>
            <div className="field"><label>Password * (min 6 characters)</label><input type="password" value={f.regPass} onChange={set('regPass')} placeholder="Create password" required minLength={6} /></div>
            <div className="fgrid">
              <div className="field"><label>Department</label><select value={f.dept} onChange={set('dept')}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></div>
              <div className="field"><label>Phone Number</label><input value={f.phone} onChange={set('phone')} placeholder="+91 9876543210" /></div>
            </div>
            <div className="notice ok" style={{ fontSize: 11, margin: '8px 0' }}>Employee Code (e.g. EMP1001) will be generated automatically.</div>
            {err && <div className="err">{err}</div>}
            <button className="btn success" style={{ width: '100%', marginTop: 6 }} disabled={busy}>Create Account &amp; Sign In</button>
          </form>
        )}

        {mode === 'otp' && (
          <form onSubmit={onOtp} style={{ marginTop: 12 }}>
            <div className="field"><label>Mobile Number</label><input value={f.otpPhone} onChange={set('otpPhone')} readOnly={otpSent} placeholder="10-digit mobile number" autoComplete="tel" inputMode="numeric" required /></div>
            {otpSent && <div className="field"><label>OTP</label><input value={f.otp} onChange={set('otp')} placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code" autoFocus /></div>}
            {err && <div className="err">{err}</div>}
            <button className="btn" style={{ width: '100%', marginTop: 6 }} type="submit" disabled={busy}>{otpSent ? 'Verify & Sign In' : 'Send OTP'}</button>
            <button className="btn alt" style={{ width: '100%', marginTop: 6 }} type="button" onClick={() => switchMode('login')}>Use password instead</button>
          </form>
        )}

        {mode !== 'otp' && (
          <div className="oauth-section" style={{ marginTop: 16, textAlign: 'center' }}>
            <div className="oauth-divider"><span>OR CONTINUE WITH</span></div>
            <button className="btn alt oauth-btn" type="button" onClick={googleClick} style={{ width: '100%', marginTop: 8 }}>Sign in with Google</button>
            <button className="btn alt oauth-btn" type="button" onClick={() => switchMode('otp')} style={{ width: '100%', marginTop: 8 }}>Sign in with Mobile OTP</button>
          </div>
        )}

        <div className="mini" style={{ marginTop: 14, textAlign: 'center' }}>Secure multi-tenant authentication &bull; PDC ERP 2026</div>
      </div>
    </div>
  );
}
