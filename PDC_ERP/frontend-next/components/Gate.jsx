'use client';
import { useApp } from './AuthContext';
import Login from './Login';
import Shell from './Shell';

export default function Gate() {
  const { status } = useApp();
  if (status === 'loading') return <div className="empty" style={{ padding: 40 }}>Loading…</div>;
  if (status === 'out') return <Login />;
  return <Shell />;
}
