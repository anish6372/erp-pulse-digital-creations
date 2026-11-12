'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../legacy/lib/api.js';
import { state, setToken } from '../legacy/lib/state.js';
import { registerRouter } from '../legacy/router.js';
import { connectSocket, disconnectSocket } from '../legacy/lib/socket.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function pageFromPath(pathname) {
  return (pathname || '/').split('/')[1] || 'dashboard';
}

export default function AuthProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState('loading'); // loading | out | in
  const [me, setMe] = useState(null);
  const [version, setVersion] = useState(0); // bump to make the current page re-render/reload
  const waiters = useRef({});
  const current = useRef('dashboard');
  current.current = pageFromPath(pathname);

  const bootstrap = useCallback(async () => {
    const d = await api('/api/bootstrap');
    state.boot = d;
    state.me = d.user;
    setMe(d.user);
    return d;
  }, []);

  const signIn = useCallback(
    async (token) => {
      setToken(token);
      await bootstrap();
      connectSocket();
      setStatus('in');
    },
    [bootstrap]
  );

  const signOut = useCallback(async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (e) {
      /* ignore */
    }
    disconnectSocket();
    setToken('');
    window.location.href = '/';
  }, []);

  // Pages tell us when they finished rendering so navigate()/refresh() can be awaited,
  // which the old imperative page code relies on (e.g. open a page, then open a chat in it).
  const markRendered = useCallback((page) => {
    const w = waiters.current[page];
    if (w) {
      delete waiters.current[page];
      w();
    }
  }, []);

  const navigate = useCallback(
    (page) =>
      new Promise((resolve) => {
        waiters.current[page] = resolve;
        state.currentPage = page;
        if (current.current === page) setVersion((v) => v + 1);
        else router.push('/' + page);
      }),
    [router]
  );

  const refresh = useCallback(async () => {
    await bootstrap();
    const p = current.current;
    const done = new Promise((resolve) => (waiters.current[p] = resolve));
    setVersion((v) => v + 1);
    try {
      const { updateNotifications } = await import('../legacy/pages/notifications.js');
      await updateNotifications();
    } catch (e) {
      /* badge refresh is best effort */
    }
    await done;
  }, [bootstrap]);

  useEffect(() => {
    registerRouter({ renderPage: navigate, refresh });
  }, [navigate, refresh]);

  useEffect(() => {
    document.body.classList.add('app');
    try {
      if (localStorage.getItem('pdc_theme') === 'dark') document.body.classList.add('dark');
    } catch (e) {
      /* storage blocked */
    }
    if (!state.token) {
      setStatus('out');
      return;
    }
    bootstrap()
      .then(() => {
        connectSocket();
        setStatus('in');
      })
      .catch(() => {
        setToken('');
        setStatus('out');
      });
  }, [bootstrap]);

  return <Ctx.Provider value={{ status, me, version, setVersion, signIn, signOut, navigate, refresh, markRendered }}>{children}</Ctx.Provider>;
}
