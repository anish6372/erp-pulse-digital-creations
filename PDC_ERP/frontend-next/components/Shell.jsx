'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { state } from '../legacy/lib/state.js';
import { initials } from '../legacy/lib/dom.js';
import { sectionsFor, TITLES, PAGE_IDS } from '../lib/nav';
import { useApp, pageFromPath } from './AuthContext';
import Icon from './Icon';
import LegacyPage, { hasLegacy } from './LegacyPage';
import HunterPage from './hunter/HunterPage';

const IDLE_LIMIT_MS = 15 * 60 * 1000;

function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function writeLS(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (e) {
    /* storage blocked: the setting still works for this visit */
  }
}

export default function Shell() {
  const { me, version, setVersion, signOut, navigate, refresh, markRendered } = useApp();
  const pathname = usePathname();
  const raw = pageFromPath(pathname);
  const page = PAGE_IDS.includes(raw) ? raw : 'dashboard';
  const isAdmin = me.role === 'Admin';
  const sections = useMemo(() => sectionsFor(me), [me]);

  const [slim, setSlim] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [closed, setClosed] = useState(() => new Set());
  const [dark, setDark] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQ, setCmdQ] = useState('');
  const [cmdIdx, setCmdIdx] = useState(0);
  const cmdInput = useRef(null);

  // ---- restore per-browser preferences ----
  useEffect(() => {
    setSlim(readLS('pdc_nav_slim', '0') === '1');
    setDark(readLS('pdc_theme', 'light') === 'dark');
    try {
      setClosed(new Set(JSON.parse(readLS('pdc_nav_closed', '[]'))));
    } catch (e) {
      /* start with every group open */
    }
  }, []);
  useEffect(() => {
    document.body.classList.toggle('dark', dark);
  }, [dark]);
  useEffect(() => {
    document.body.classList.toggle('slim-nav', slim);
  }, [slim]);

  // ---- current page bookkeeping ----
  const section = sections.find((s) => s.items.some((i) => i[0] === page)) || sections[0];
  const title = TITLES(isAdmin)[page] || page;
  useEffect(() => {
    state.currentPage = page;
    document.title = title + ' · PDC ERP';
    window.scrollTo({ top: 0 });
    setDrawer(false);
  }, [page, title]);

  // ---- notification badges + dashboard auto-refresh (same cadence as before) ----
  useEffect(() => {
    let tick = 0;
    const t = setInterval(async () => {
      try {
        const { updateNotifications } = await import('../legacy/pages/notifications.js');
        await updateNotifications();
        if (++tick % 6 === 0 && state.currentPage === 'dashboard' && isAdmin) setVersion((v) => v + 1);
      } catch (e) {
        /* ignore transient poll errors */
      }
    }, 5000);
    import('../legacy/pages/notifications.js').then((m) => m.updateNotifications()).catch(() => {});
    return () => clearInterval(t);
  }, [isAdmin, setVersion]);

  // ---- auto-logout after 15 idle minutes, including after sleep/lock ----
  useEffect(() => {
    let last = Date.now();
    let hiddenAt = null;
    const bump = () => (last = Date.now());
    const evs = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    evs.forEach((e) => document.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => {
      if (Date.now() - last >= IDLE_LIMIT_MS) signOut();
    }, 30000);
    const vis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else {
        const away = hiddenAt ? Date.now() - hiddenAt : 0;
        hiddenAt = null;
        last = Date.now();
        if (away >= IDLE_LIMIT_MS) signOut();
      }
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      evs.forEach((e) => document.removeEventListener(e, bump));
      document.removeEventListener('visibilitychange', vis);
      clearInterval(iv);
    };
  }, [signOut]);

  // ---- command palette (Ctrl/Cmd + K) ----
  const hits = useMemo(() => {
    const q = cmdQ.trim().toLowerCase();
    return sections.flatMap((s) => s.items.filter((i) => !q || i[2].toLowerCase().includes(q) || s.label.toLowerCase().includes(q)).map((i) => ({ i, s })));
  }, [sections, cmdQ]);
  const openCmd = useCallback(() => {
    setCmdQ('');
    setCmdIdx(0);
    setCmdOpen(true);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCmd();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openCmd]);
  useEffect(() => {
    if (cmdOpen) cmdInput.current?.focus();
  }, [cmdOpen]);
  const go = (id) => {
    setCmdOpen(false);
    navigate(id);
  };

  const toggleGroup = (id) => {
    if (slim) return setSlim(false);
    setClosed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      writeLS('pdc_nav_closed', JSON.stringify([...next]));
      return next;
    });
  };
  const toggleSlim = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 900) return setDrawer((d) => !d);
    setSlim((s) => {
      writeLS('pdc_nav_slim', s ? '0' : '1');
      return !s;
    });
  };
  const toggleTheme = () =>
    setDark((d) => {
      writeLS('pdc_theme', d ? 'light' : 'dark');
      return !d;
    });
  const fullscreen = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  };
  const openNotifications = async () => (await import('../legacy/pages/notifications.js')).openNotifications();

  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date());

  return (
    <>
      <div id="app" className="app">
        <aside className={'side' + (slim ? ' slim' : '') + (drawer ? ' drawer' : '')}>
          <div className="sb-brand">
            <img src="/pdc-logo.png" alt="Pulse Digital Creations" />
            <button className="sb-collapse" title="Collapse menu" onClick={toggleSlim}><Icon raw="menu" /></button>
          </div>
          <button className="sb-search" type="button" onClick={openCmd}>
            <span className="sb-search-ic"><Icon raw="search" /></span>
            <span className="sb-search-txt">Jump to a screen</span>
            <kbd>Ctrl K</kbd>
          </button>
          <nav className="sb-nav" aria-label="Main menu">
            {sections.map((s) => {
              const open = !closed.has(s.id) || s.items.some((i) => i[0] === page);
              return (
                <div key={s.id} className={'sb-group' + (open ? ' open' : '')}>
                  <button className="sb-head" title={s.label} onClick={() => toggleGroup(s.id)}>
                    <Icon name={s.icon} />
                    <span className="sb-label">{s.label}</span>
                    <i className="sb-chev" />
                  </button>
                  <div className="sb-items">
                    {s.items.map((x) => (
                      <button key={x[0]} className={'sb-item' + (x[0] === page ? ' active' : '')} title={x[2]} onClick={() => { setDrawer(false); navigate(x[0]); }}>
                        <Icon name={x[1]} />
                        <span className="sb-label">{x[2]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>
          <div className="sb-user">
            <div className="sb-avatar">{initials(me.name)}</div>
            <div className="sb-who"><b>{me.name}</b><span className="sb-role">{me.role}</span></div>
            <button className="sb-logout" title="Log out" onClick={signOut}><Icon raw="logout" /></button>
          </div>
        </aside>
        <div className={'shade' + (drawer ? ' show' : '')} onClick={() => setDrawer(false)} />

        <div className="shell">
          <header className="top">
            <div className="left">
              <button className="iconBtn" title="Menu" onClick={toggleSlim}><Icon raw="menu" /></button>
              <div className="crumb"><span>{section?.label}</span><i>/</i><strong>{title}</strong></div>
            </div>
            <div className="right">
              <span className="today">{today}</span>
              <button className="iconBtn" title="Light / dark" onClick={toggleTheme}><Icon raw={dark ? 'sun' : 'moon'} /></button>
              <button className="iconBtn" title="Full screen" onClick={fullscreen}><Icon raw="expand" /></button>
              <button className="iconBtn" title="Refresh" onClick={refresh}><Icon raw="refresh" /></button>
              <button className="iconBtn" title="Chat" onClick={() => navigate('chat')}><Icon raw="chat" /></button>
              <span id="chatBadge" className="badge red hidden">0</span>
              <button className="iconBtn" title="Notifications" onClick={openNotifications}><Icon raw="bell" /></button>
              <span id="notifBadge" className="badge red hidden">0</span>
            </div>
          </header>
          <main className="content">
            <div className="main">
              {page === 'hunter' ? <HunterPage key={'h' + version} markRendered={markRendered} /> : hasLegacy(page) ? <LegacyPage key={page} page={page} /> : null}
            </div>
          </main>
        </div>
      </div>

      {cmdOpen && (
        <div className="cmd" role="dialog" aria-label="Jump to a screen" onClick={(e) => e.target === e.currentTarget && setCmdOpen(false)}>
          <div className="cmd-box">
            <div className="cmd-field">
              <span><Icon raw="search" /></span>
              <input
                ref={cmdInput}
                value={cmdQ}
                onChange={(e) => { setCmdQ(e.target.value); setCmdIdx(0); }}
                placeholder="Where do you want to go?"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIdx((i) => (hits.length ? (i + 1) % hits.length : 0)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIdx((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0)); }
                  else if (e.key === 'Enter' && hits[cmdIdx]) go(hits[cmdIdx].i[0]);
                  else if (e.key === 'Escape') setCmdOpen(false);
                }}
              />
              <kbd>Esc</kbd>
            </div>
            <div className="cmd-list">
              {hits.length ? hits.map(({ i, s }, n) => (
                <button key={i[0]} className={'cmd-item' + (n === cmdIdx ? ' on' : '')} onClick={() => go(i[0])}>
                  <Icon name={i[1]} /><span>{i[2]}</span><em>{s.label}</em>
                </button>
              )) : <div className="empty">Nothing matches that.</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
