/* Router + App shell + tweaks integration */
/* global React, ReactDOM, UI, Icon, VaultMark, MOCK */
const { useState, useEffect, useMemo, useRef, createContext, useContext } = React;
const { Button, IconBadge, ToastHost } = UI;

/* ============================================================
   Tweakable defaults (persisted via __edit_mode_set_keys)
============================================================ */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "accent": "#FF6B45",
  "radius": "soft",
  "density": "cozy",
  "font": "rounded",
  "sidebar": "full"
}/*EDITMODE-END*/;

const ACCENTS = {
  '#FF6B45': { '--primary': '#FF6B45', '--primary-2': '#FF8B6A', '--primary-soft': '#FFD9C9', '--primary-soft-2': '#FFC2A8', '--primary-ink': '#4A1505' },
  '#16A765': { '--primary': '#16A765', '--primary-2': '#3BC586', '--primary-soft': '#C8F3DC', '--primary-soft-2': '#A0E6C0', '--primary-ink': '#064E2B' },
  '#7B5BE0': { '--primary': '#7B5BE0', '--primary-2': '#9B7FF0', '--primary-soft': '#DCD2FB', '--primary-soft-2': '#C0B0F5', '--primary-ink': '#2F1B6E' },
  '#0EA5E9': { '--primary': '#0EA5E9', '--primary-2': '#3CC0FF', '--primary-soft': '#C9E9FA', '--primary-soft-2': '#9AD7F2', '--primary-ink': '#07344C' },
};
const ACCENTS_DARK = {
  '#FF6B45': { '--primary': '#FF8060', '--primary-2': '#FFA489', '--primary-soft': '#4A1A0C', '--primary-soft-2': '#6A2613', '--primary-ink': '#FFE5D9' },
  '#16A765': { '--primary': '#34D399', '--primary-2': '#6EE7B8', '--primary-soft': '#0F3B27', '--primary-soft-2': '#1A5A3B', '--primary-ink': '#D1FAE5' },
  '#7B5BE0': { '--primary': '#A78BFA', '--primary-2': '#C4B5FD', '--primary-soft': '#2A1F58', '--primary-soft-2': '#3D2E7A', '--primary-ink': '#EDE9FE' },
  '#0EA5E9': { '--primary': '#38BDF8', '--primary-2': '#7DD3FC', '--primary-soft': '#0A3450', '--primary-soft-2': '#125170', '--primary-ink': '#E0F2FE' },
};

/* Apply theme + tokens to <html> */
function applyTweaks(t) {
  const html = document.documentElement;
  html.dataset.theme = t.theme;
  html.dataset.radius = t.radius;
  html.dataset.density = t.density;
  html.dataset.font = t.font;
  html.dataset.sidebar = t.sidebar;
  const palette = t.theme === 'dark' ? ACCENTS_DARK : ACCENTS;
  const accent = palette[t.accent] || palette['#FF6B45'];
  Object.entries(accent).forEach(([k, v]) => html.style.setProperty(k, v));
}

/* ============================================================
   Router (hash-based)
============================================================ */
function parseHash() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const [path, queryStr] = hash.split('?');
  const query = {};
  if (queryStr) {
    queryStr.split('&').forEach(p => {
      const [k, v] = p.split('=');
      if (k) query[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
    });
  }
  return { path, query };
}

function navigate(to, opts = {}) {
  if (typeof to === 'object') {
    const q = Object.entries(to.query || {}).filter(([_, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    window.location.hash = '#' + to.path + (q ? '?' + q : '');
  } else {
    window.location.hash = '#' + to;
  }
  if (!opts.preserveScroll) window.scrollTo(0, 0);
}
window.navigate = navigate;

function Link({ to, children, className = '', ...rest }) {
  return (
    <a
      href={'#' + (typeof to === 'string' ? to : '/')}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >{children}</a>
  );
}
window.Link = Link;

/* ============================================================
   Auth state — simple
============================================================ */
const AuthCtx = createContext(null);
function useAuth() { return useContext(AuthCtx); }

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wv:user') || 'null'); } catch { return null; }
  });
  const login = (u) => { localStorage.setItem('wv:user', JSON.stringify(u)); setUser(u); };
  const logout = () => { localStorage.removeItem('wv:user'); setUser(null); navigate('/'); };
  return <AuthCtx.Provider value={{ user, login, logout }}>{children}</AuthCtx.Provider>;
}
window.useAuth = useAuth;

/* ============================================================
   Sidebar items
============================================================ */
const NAV = [
  { path: '/dashboard',     label: 'Dashboard',    icon: 'home' },
  { path: '/devices',       label: 'Thiết bị',     icon: 'package' },
  { path: '/subscriptions', label: 'Gói đăng ký',  icon: 'refresh' },
  { path: '/wishlist',      label: 'Đang thèm',    icon: 'heart' },
  { path: '/reminders',     label: 'Nhắc nhở',     icon: 'bell' },
  { path: '/stats',         label: 'Thống kê',     icon: 'chart' },
  { path: '/settings',      label: 'Cài đặt',      icon: 'settings' },
];

function Brand({ size = 'md' }) {
  return (
    <div className="brand" style={{ fontSize: size === 'lg' ? 22 : 17 }}>
      <span className="brand-mark" style={{ width: size === 'lg' ? 44 : 36, height: size === 'lg' ? 44 : 36, borderRadius: 12 }}>
        <Icon name="shieldCheck" size={size === 'lg' ? 22 : 18} strokeWidth={2.5} />
      </span>
      <span className="sidebar-logo-text">WarrantyVault</span>
    </div>
  );
}
window.Brand = Brand;

function Sidebar({ currentPath }) {
  const auth = useAuth();
  return (
    <aside className="sidebar">
      <Link to="/dashboard" className="sidebar-logo"><Brand /></Link>
      <nav className="sidebar-nav">
        {NAV.map(n => (
          <Link key={n.path} to={n.path} className="nav-item" data-active={currentPath.startsWith(n.path)}>
            <span className="nav-item-icon"><Icon name={n.icon} size={18} /></span>
            <span className="nav-item-label">{n.label}</span>
          </Link>
        ))}
      </nav>
      <div className="sidebar-user">
        <span className="avatar">T</span>
        <div className="sidebar-user-text" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{auth?.user?.name || 'Trung'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{auth?.user?.email || 'trung@local.test'}</div>
        </div>
        <button className="btn btn-ghost btn-icon btn-icon-sm sidebar-user-text" onClick={auth?.logout} title="Đăng xuất"><Icon name="logOut" size={14} /></button>
      </div>
    </aside>
  );
}

function Topbar({ currentPath }) {
  const auth = useAuth();
  return (
    <header className="topbar">
      <Link to="/dashboard" style={{ display: 'flex' }}><Brand /></Link>
      <nav className="topbar-nav" style={{ marginLeft: 12 }}>
        {NAV.map(n => (
          <Link key={n.path} to={n.path} className="nav-item" data-active={currentPath.startsWith(n.path)}>
            <span className="nav-item-icon"><Icon name={n.icon} size={16} /></span>
            <span className="nav-item-label">{n.label}</span>
          </Link>
        ))}
      </nav>
      <span className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>T</span>
    </header>
  );
}

function MobileBottomNav({ currentPath }) {
  const items = NAV.slice(0, 5);
  return (
    <nav className="mobile-bottom-nav">
      {items.map(n => (
        <Link key={n.path} to={n.path} className="nav-item" data-active={currentPath.startsWith(n.path)}>
          <Icon name={n.icon} size={20} />
          <span>{n.label.split(' ')[0]}</span>
        </Link>
      ))}
    </nav>
  );
}

function AppShell({ children, currentPath }) {
  return (
    <>
      <Topbar currentPath={currentPath} />
      <div className="app-shell">
        <Sidebar currentPath={currentPath} />
        <main className="main"><div className="main-narrow">{children}</div></main>
      </div>
      <MobileBottomNav currentPath={currentPath} />
    </>
  );
}
window.AppShell = AppShell;

/* ============================================================
   Page registry — pages register themselves to window.PAGES
============================================================ */
window.PAGES = window.PAGES || {};

/* ============================================================
   Root
============================================================ */
function Router() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const fn = () => setRoute(parseHash());
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);

  const auth = useAuth();
  const { path, query } = route;

  // Page resolution
  const PAGES = window.PAGES;
  const isApp = path.startsWith('/dashboard') || path.startsWith('/devices') || path.startsWith('/subscriptions')
    || path.startsWith('/wishlist') || path.startsWith('/reminders') || path.startsWith('/stats') || path.startsWith('/settings');

  // Auto-login a demo user if hitting an app route while logged out (for prototype)
  useEffect(() => {
    if (isApp && !auth.user) {
      auth.login({ name: 'Trung', email: 'trung@local.test' });
    }
  }, [isApp, auth.user]);

  let PageComp = null;
  let pageProps = { query, path };

  if (path === '/' || path === '') PageComp = PAGES.Landing;
  else if (path === '/login') PageComp = PAGES.Login;
  else if (path === '/register') PageComp = PAGES.Register;
  else if (path === '/forgot') PageComp = PAGES.Forgot;
  else if (path.startsWith('/reset/')) { PageComp = PAGES.Reset; pageProps.token = path.split('/')[2]; }
  else if (path === '/privacy') PageComp = PAGES.Privacy;
  else if (path === '/terms') PageComp = PAGES.Terms;
  else if (path === '/cookies') PageComp = PAGES.Cookies;
  else if (path === '/dashboard') PageComp = PAGES.Dashboard;
  else if (path === '/devices') PageComp = PAGES.DevicesList;
  else if (path === '/devices/new') PageComp = PAGES.DeviceForm;
  else if (path.match(/^\/devices\/[^/]+\/edit$/)) { PageComp = PAGES.DeviceForm; pageProps.id = path.split('/')[2]; pageProps.mode = 'edit'; }
  else if (path.match(/^\/devices\/[^/]+$/)) { PageComp = PAGES.DeviceDetail; pageProps.id = path.split('/')[2]; }
  else if (path === '/subscriptions') PageComp = PAGES.SubscriptionsList;
  else if (path === '/subscriptions/new') PageComp = PAGES.SubscriptionForm;
  else if (path.match(/^\/subscriptions\/[^/]+\/edit$/)) { PageComp = PAGES.SubscriptionForm; pageProps.id = path.split('/')[2]; pageProps.mode = 'edit'; }
  else if (path.match(/^\/subscriptions\/[^/]+$/)) { PageComp = PAGES.SubscriptionDetail; pageProps.id = path.split('/')[2]; }
  else if (path === '/wishlist') PageComp = PAGES.WishlistList;
  else if (path === '/wishlist/new') PageComp = PAGES.WishlistForm;
  else if (path.match(/^\/wishlist\/[^/]+\/edit$/)) { PageComp = PAGES.WishlistForm; pageProps.id = path.split('/')[2]; pageProps.mode = 'edit'; }
  else if (path.match(/^\/wishlist\/[^/]+$/)) { PageComp = PAGES.WishlistDetail; pageProps.id = path.split('/')[2]; }
  else if (path === '/reminders') PageComp = PAGES.Reminders;
  else if (path === '/stats') PageComp = PAGES.Stats;
  else if (path === '/settings') PageComp = PAGES.Settings;

  if (!PageComp) PageComp = () => (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <h2>404 — Đang viết trang này...</h2>
      <p className="muted">{path}</p>
      <Link to="/dashboard" className="link">← Về dashboard</Link>
    </div>
  );

  const content = <PageComp {...pageProps} />;

  // Screen label for context
  const screenLabel = path;

  if (isApp) {
    return <div data-screen-label={screenLabel}><AppShell currentPath={path}>{content}</AppShell></div>;
  }
  return <div data-screen-label={screenLabel}>{content}</div>;
}

/* ============================================================
   Tweaks panel (uses starter)
============================================================ */
function WVTweaks() {
  const { TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakSelect, TweakColor } = window;
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  useEffect(() => { applyTweaks(t); }, [t]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Theme">
        <TweakRadio label="Mode" value={t.theme} onChange={v => setTweak('theme', v)}
          options={['light', 'dark']} />
        <TweakColor label="Accent" value={t.accent} onChange={v => setTweak('accent', v)}
          options={['#FF6B45', '#16A765', '#7B5BE0', '#0EA5E9']}
        />
      </TweakSection>
      <TweakSection label="Layout">
        <TweakRadio label="Sidebar" value={t.sidebar} onChange={v => setTweak('sidebar', v)}
          options={['full', 'icon', 'topbar']} />
        <TweakRadio label="Density" value={t.density} onChange={v => setTweak('density', v)}
          options={['loose', 'cozy', 'dense']} />
        <TweakRadio label="Radius" value={t.radius} onChange={v => setTweak('radius', v)}
          options={['sharp', 'soft', 'chunky']} />
      </TweakSection>
      <TweakSection label="Type">
        <TweakSelect label="Font" value={t.font} onChange={v => setTweak('font', v)}
          options={['rounded', 'system', 'inter', 'serif']}
        />
      </TweakSection>
    </TweaksPanel>
  );
}

/* ============================================================
   Init
============================================================ */
function App() {
  // Apply defaults early
  useEffect(() => { applyTweaks(TWEAK_DEFAULTS); }, []);
  return (
    <AuthProvider>
      <Router />
      <ToastHost />
      <WVTweaks />
    </AuthProvider>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
