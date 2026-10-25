// Harborline Home Loans — synthetic mortgage-servicing demo for Interface Foundry.
// Boots the app shell, wires the hash router and owns session recovery.
import { createRouter } from './router.js';
import { state, subscribe } from './store.js';
import { startSession, expireSession, resumeSession, endSession, onSessionExpired } from './session.js';
import { focusElement } from './dom.js';
import { SiteHeader } from './components/site-header.js';
import { SiteFooter } from './components/site-footer.js';
import { LoginPage } from './components/login-page.js';
import { DashboardPage } from './components/dashboard-page.js';
import { StatementPage } from './components/statement-page.js';
import { PaymentPage } from './components/payment-page.js';
import { ProfilePage } from './components/profile-page.js';
import { KeyboardLab } from './components/keyboard-lab.js';
import { SessionExpiredPage } from './components/session-expired-page.js';
import { SessionPaused } from './components/session-paused.js';
import { SessionModal } from './components/session-modal.js';

const BRAND = 'Harborline Home Loans';
const DEMO_BORROWER = { username: 'demo.borrower', displayName: 'Jordan Mercer' };

/** access: 'public' routes render for anyone; 'borrower' routes need a session. */
const ROUTES = {
  login: { title: 'Sign in', view: LoginPage, access: 'public' },
  dashboard: { title: 'Account overview', view: DashboardPage, access: 'borrower' },
  statement: { title: 'Mortgage statement', view: StatementPage, access: 'borrower' },
  payment: { title: 'Make a payment', view: PaymentPage, access: 'borrower' },
  profile: { title: 'Profile and contact details', view: ProfilePage, access: 'borrower' },
  keyboard: { title: 'Keyboard navigation lab', view: KeyboardLab, access: 'public' },
  'session-expired': { title: 'Signed out', view: SessionExpiredPage, access: 'public' },
};

const params = new URLSearchParams(window.location.search);
// Demo mode: opening a borrower route (e.g. #/statement) without a session
// starts a synthetic demo session so every screen can be audited directly.
// After an explicit sign-out, or with ?requireAuth=1, anonymous visitors are
// sent to the sign-in page instead (and returned to the route afterwards).
const requireAuth = params.has('requireAuth') && params.get('requireAuth') !== '0';
let signedOutByUser = false;

const appEl = document.getElementById('app');
const main = document.getElementById('main-content');
let cleanups = [];
let sessionDialog = null;
let mounted = false;

const header = SiteHeader({
  onSignOut: () => {
    signedOutByUser = true;
    endSession();
    router.navigate('login');
  },
});
document.getElementById('site-header-slot').replaceWith(header);

const footer = SiteFooter({ onSimulateTimeout: () => expireSession('demo-control') });
document.getElementById('site-footer-slot').replaceWith(footer);

const router = createRouter({ routes: ROUTES, fallback: 'login', onRoute: handleRoute });

function unmountView() {
  for (const cleanup of cleanups.splice(0)) {
    try {
      cleanup();
    } catch (error) {
      console.error('[harborline] view cleanup failed', error);
    }
  }
}

function mountView(name) {
  unmountView();
  const view = ROUTES[name].view({
    route: name,
    navigate: (to, options) => router.navigate(to, options),
    onCleanup: (fn) => cleanups.push(fn),
    onSignedIn: handleSignedIn,
  });
  main.replaceChildren(view);
}

function handleRoute(name) {
  const route = ROUTES[name];
  const initial = !mounted;
  console.info('[harborline] route', name);

  if (route.access === 'borrower' && state.session.status === 'signed-out') {
    if (!requireAuth && !signedOutByUser) {
      startSession({ ...DEMO_BORROWER, synthetic: true });
      console.info('[harborline] started a synthetic demo session for', `#/${name}`);
    } else {
      state.returnTo = name;
      router.navigate('login', { replace: true });
      return;
    }
  }

  document.title = `${route.title} · ${BRAND}`;
  header.update({ route: name, session: state.session });

  if (route.access === 'borrower' && state.session.status === 'expired') {
    unmountView();
    main.replaceChildren(SessionPaused());
    showSessionDialog();
    return;
  }

  mountView(name);
  mounted = true;
  if (!initial) {
    window.scrollTo(0, 0);
    focusElement(main.querySelector('h1') ?? main, { preventScroll: true });
  }
}

function handleSignedIn({ username }) {
  startSession({ username, displayName: DEMO_BORROWER.displayName });
  const target = state.returnTo && ROUTES[state.returnTo]?.access === 'borrower' ? state.returnTo : 'dashboard';
  state.returnTo = null;
  router.navigate(target);
}

function showSessionDialog() {
  if (sessionDialog) return;
  sessionDialog = SessionModal({
    username: state.session.username ?? DEMO_BORROWER.username,
    onResume: () => {
      sessionDialog = null;
      resumeSession();
      router.refresh();
    },
    onSignOut: () => {
      sessionDialog = null;
      signedOutByUser = true;
      endSession();
      router.navigate('session-expired');
    },
  });
}

onSessionExpired(() => {
  const current = router.current;
  if (current && ROUTES[current].access === 'borrower') {
    // Remove account details from the page while the session is locked.
    unmountView();
    main.replaceChildren(SessionPaused());
  }
  showSessionDialog();
});

subscribe((s, reason) => {
  if (reason === 'session' && router.current) header.update({ route: router.current, session: s.session });
});

// The skip link targets <main>; handle it here so the hash router is untouched.
appEl.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  focusElement(main);
});

// Read-only debugging handle for automated test scenarios.
Object.defineProperty(window, '__harborline', {
  value: Object.freeze({
    version: '1.0.0',
    routes: Object.keys(ROUTES),
    snapshot: () => JSON.parse(JSON.stringify(state)),
    expireSession: () => expireSession('devtools'),
  }),
  configurable: true,
});

router.start();
