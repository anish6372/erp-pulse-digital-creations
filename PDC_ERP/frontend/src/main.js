import './style.css';

document.body.classList.add('app'); // editorial look on every screen, including login
import { api } from './lib/api.js';
import { state, setToken } from './lib/state.js';
import { $, closeModal } from './lib/dom.js';
import { bootApp, refresh, openCmd, setSlim, openDrawer, closeDrawer, renderPage } from './router.js';
import { openNotifications } from './pages/notifications.js';
import { icons } from './lib/icons.js';
import { connectSocket, disconnectSocket } from './lib/socket.js';
import { startOnboarding } from './pages/onboardingPublic.js';
import { startReview } from './pages/reviewPublic.js';

// A new joiner's personal link (#/onboard/<token>) opens the public onboarding wizard instead of the login screen.
const onboardMatch = location.hash.match(/^#\/onboard\/([A-Za-z0-9_-]+)$/);
// A cafe owner's private review link (#/review/<token>) opens the content review page instead of the login screen.
const reviewMatch = location.hash.match(/^#\/review\/([A-Za-z0-9_-]+)$/);
if (reviewMatch) {
  $('login').classList.add('hidden');
  startReview(reviewMatch[1]);
}

if (onboardMatch) {
  $('login').classList.add('hidden');
  startOnboarding(onboardMatch[1]);
}

$('fullBtn').innerHTML = icons.expand;
$('refreshBtn').innerHTML = icons.refresh;
$('notifBtn').innerHTML = icons.bell;
$('chatBtn').innerHTML = icons.chat;
$('logoutBtn').innerHTML = icons.logout;
$('collapseBtn').innerHTML = icons.menu;
$('menuBtn').innerHTML = icons.menu;

async function login(e) {
  e.preventDefault();
  $('loginErr').classList.add('hidden');
  try {
    const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ user_id: $('loginId').value, password: $('loginPass').value }) });
    setToken(d.token);
    await bootApp();
  } catch (err) {
    $('loginErr').textContent = err.message;
    $('loginErr').classList.remove('hidden');
  }
}

$('loginForm').addEventListener('submit', login);

if ($('tabSignInBtn') && $('tabRegisterBtn')) {
  $('tabSignInBtn').onclick = () => {
    $('tabSignInBtn').classList.add('active');
    $('tabRegisterBtn').classList.remove('active');
    $('loginForm').classList.remove('hidden');
    $('registerForm').classList.add('hidden');
    if ($('loginErr')) $('loginErr').classList.add('hidden');
  };
  $('tabRegisterBtn').onclick = () => {
    $('tabRegisterBtn').classList.add('active');
    $('tabSignInBtn').classList.remove('active');
    $('registerForm').classList.remove('hidden');
    $('loginForm').classList.add('hidden');
    if ($('regErr')) $('regErr').classList.add('hidden');
  };
}

async function register(e) {
  e.preventDefault();
  if ($('regErr')) $('regErr').classList.add('hidden');
  try {
    const payload = {
      name: $('regName').value,
      email: $('regEmail').value,
      password: $('regPass').value,
      department: $('regDept').value,
      phone: $('regPhone') ? $('regPhone').value : '',
    };
    const d = await api('/api/register', { method: 'POST', body: JSON.stringify(payload) });
    setToken(d.token);
    await bootApp();
  } catch (err) {
    if ($('regErr')) {
      $('regErr').textContent = err.message;
      $('regErr').classList.remove('hidden');
    }
  }
}
if ($('registerForm')) $('registerForm').addEventListener('submit', register);

if ($('googleOAuthBtn')) {
  $('googleOAuthBtn').onclick = async () => {
    try {
      const cfg = await api('/api/auth/google/config');
      if (cfg.enabled && cfg.clientId && window.google) {
        window.google.accounts.id.prompt();
        return;
      }
    } catch (e) {}

    const errElem = $('loginErr') || $('regErr');
    if (errElem) {
      errElem.textContent = 'Google sign-in is not available. Ask your admin to enable it.';
      errElem.classList.remove('hidden');
    }
  };
}

async function initGoogleOAuth() {
  try {
    const cfg = await api('/api/auth/google/config');
    if (cfg.enabled && cfg.clientId) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.google) {
          window.google.accounts.id.initialize({
            client_id: cfg.clientId,
            callback: async (response) => {
              if (response.credential) {
                try {
                  const d = await api('/api/auth/google', {
                    method: 'POST',
                    body: JSON.stringify({ credential: response.credential }),
                  });
                  setToken(d.token);
                  await bootApp();
                } catch (err) {
                  alert('Google Auth Failed: ' + err.message);
                }
              }
            },
          });
        }
      };
      document.head.appendChild(script);
    }
  } catch (e) {}
}
if (!onboardMatch && !reviewMatch) initGoogleOAuth();

async function doLogout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (e) {
    /* ignore */
  }
  setToken('');
  location.reload();
}

$('logoutBtn').onclick = doLogout;

// Auto-logout after 15 minutes with no activity, so a screen left on (or a laptop left
// open and idle) doesn't keep a work timer running indefinitely and skewing hours.
// Checking the gap since the last activity event - rather than a timer meant to fire at
// exactly 15 minutes - also correctly covers the OS-sleep case: no mousemove/keydown
// events fire while the screen is actually off, so the gap is simply already there by
// the time the machine wakes and the next check runs.
const IDLE_LIMIT_MS = 15 * 60 * 1000;
let lastActivity = Date.now();
['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach((ev) =>
  document.addEventListener(
    ev,
    () => {
      lastActivity = Date.now();
    },
    { passive: true }
  )
);
setInterval(() => {
  if (!state.token) return;
  if (Date.now() - lastActivity >= IDLE_LIMIT_MS) doLogout();
}, 30000);

$('refreshBtn').onclick = refresh;

$('notifBtn').onclick = openNotifications;
$('chatBtn').onclick = () => renderPage('chat');

// Light / dark switch, remembered per browser.
function paintThemeIcon() {
  $('themeBtn').innerHTML = document.body.classList.contains('dark') ? icons.sun : icons.moon;
}
$('themeBtn').onclick = () => {
  document.body.classList.toggle('dark');
  try {
    localStorage.setItem('pdc_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  } catch (e) {
    /* storage blocked: the switch still works for this visit */
  }
  paintThemeIcon();
};
paintThemeIcon();

// Ctrl/Cmd+K opens the "jump to a screen" palette.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !$('app').classList.contains('hidden')) {
    e.preventDefault();
    openCmd();
  }
});

$('fullBtn').onclick = async () => {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  else await document.exitFullscreen();
};

$('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});
$('modalCloseBtn').onclick = closeModal;

if (state.token && !onboardMatch && !reviewMatch) {
  bootApp().catch(() => {
    setToken('');
  });
}

// Sidebar: slim (icons only) on desktop, slide-over drawer on small screens.
$('collapseBtn').onclick = () => setSlim(!$('side').classList.contains('slim'));
$('menuBtn').onclick = () => {
  if (window.innerWidth <= 900) openDrawer();
  else setSlim(!$('side').classList.contains('slim'));
};
$('shade').onclick = closeDrawer;
