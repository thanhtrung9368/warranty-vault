/* Auth pages: login / register / forgot / reset + legal pages */
/* global React, UI, Icon, Link, navigate, useAuth, Brand */
const { Button, Field, Input, EmptyState } = UI;
const { useState: useStateA } = React;

function AuthLayout({ icon = 'shieldCheck', tone = 'primary', title, sub, children, footer }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="text-center" style={{ marginBottom: 22 }}>
          <div style={{
            width: 60, height: 60, borderRadius: '50%',
            background: `var(--${tone}-soft)`, color: `var(--${tone}-ink)`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 14,
          }}>
            <Icon name={icon} size={28} />
          </div>
          <h1 className="display" style={{ fontSize: 24, margin: 0 }}>{title}</h1>
          {sub && <p style={{ color: 'var(--muted)', margin: '6px 0 0', fontSize: 14 }}>{sub}</p>}
        </div>
        {children}
        {footer && <div className="text-center" style={{ marginTop: 18, fontSize: 14 }}>{footer}</div>}
      </div>
    </div>
  );
}

/* ============================================================
   Login
============================================================ */
function Login() {
  const auth = useAuth();
  const [email, setEmail] = useStateA('test@local.test');
  const [pw, setPw] = useStateA('test1234');
  const [errors, setErrors] = useStateA({});
  const [loading, setLoading] = useStateA(false);

  const submit = (e) => {
    e.preventDefault();
    const er = {};
    if (!email) er.email = 'Cần nhập email';
    if (!pw) er.pw = 'Cần nhập mật khẩu';
    setErrors(er);
    if (Object.keys(er).length) return;
    setLoading(true);
    setTimeout(() => {
      auth.login({ name: email.split('@')[0] || 'Trung', email });
      UI.toast('Đăng nhập thành công 👋', 'success');
      navigate('/dashboard');
      setLoading(false);
    }, 500);
  };

  return (
    <AuthLayout
      title="Chào mừng quay lại 👋"
      sub="Đăng nhập để xem thiết bị, gói đăng ký và wishlist của bạn."
      footer={<>Chưa có tài khoản? <Link to="/register" className="link">Đăng ký</Link></>}
    >
      <form onSubmit={submit} className="col gap-4">
        <Field label="Email" required error={errors.email}>
          <Input icon="mail" type="email" placeholder="ban@example.com" value={email} onChange={e => setEmail(e.target.value)} error={!!errors.email} />
        </Field>
        <Field label="Mật khẩu" required error={errors.pw}>
          <Input icon="lock" type="password" placeholder="••••••••" value={pw} onChange={e => setPw(e.target.value)} error={!!errors.pw} />
        </Field>
        <div className="row justify-end" style={{ marginTop: -8 }}>
          <Link to="/forgot" className="link" style={{ fontSize: 13 }}>Quên mật khẩu?</Link>
        </div>
        <Button variant="primary" type="submit" icon={loading ? null : 'logIn'} disabled={loading} style={{ width: '100%' }}>
          {loading ? <><span className="spinner"/> Đang đăng nhập...</> : 'Đăng nhập'}
        </Button>
        {/* Dev hint */}
        <div className="banner banner-primary" style={{ marginTop: 6 }}>
          <Icon name="info" size={16} />
          <div style={{ fontSize: 13, lineHeight: 1.45 }}>
            <strong>Dev only:</strong> dùng <code style={{ background: 'var(--surface)', padding: '1px 5px', borderRadius: 4 }}>test@local.test</code> / <code style={{ background: 'var(--surface)', padding: '1px 5px', borderRadius: 4 }}>test1234</code> để vào nhanh.
          </div>
        </div>
      </form>
    </AuthLayout>
  );
}

/* ============================================================
   Register
============================================================ */
function Register() {
  const auth = useAuth();
  const [name, setName] = useStateA('');
  const [email, setEmail] = useStateA('');
  const [pw, setPw] = useStateA('');
  const [errors, setErrors] = useStateA({});
  const [loading, setLoading] = useStateA(false);

  const submit = (e) => {
    e.preventDefault();
    const er = {};
    if (!email) er.email = 'Cần nhập email';
    else if (!email.includes('@')) er.email = 'Email không hợp lệ';
    if (!pw) er.pw = 'Cần nhập mật khẩu';
    else if (pw.length < 8) er.pw = 'Tối thiểu 8 ký tự';
    if (name && name.length > 80) er.name = 'Tối đa 80 ký tự';
    setErrors(er);
    if (Object.keys(er).length) return;
    setLoading(true);
    setTimeout(() => {
      auth.login({ name: name || email.split('@')[0], email });
      UI.toast('Tạo tài khoản thành công 🎉', 'success');
      navigate('/dashboard');
      setLoading(false);
    }, 500);
  };

  return (
    <AuthLayout
      icon="userPlus" tone="primary"
      title="Tạo tài khoản miễn phí"
      sub="Đăng ký mất 30 giây. Không thẻ tín dụng, không quảng cáo."
      footer={<>Đã có tài khoản? <Link to="/login" className="link">Đăng nhập</Link></>}
    >
      <form onSubmit={submit} className="col gap-4">
        <Field label="Tên hiển thị" hint="Để trống cũng được" error={errors.name}>
          <Input icon="user" placeholder="vd: Trung" maxLength={80} value={name} onChange={e => setName(e.target.value)} error={!!errors.name} />
        </Field>
        <Field label="Email" required error={errors.email}>
          <Input icon="mail" type="email" placeholder="ban@example.com" value={email} onChange={e => setEmail(e.target.value)} error={!!errors.email} />
        </Field>
        <Field label="Mật khẩu" required error={errors.pw} hint={!errors.pw && 'Tối thiểu 8 ký tự'}>
          <Input icon="lock" type="password" placeholder="Tối thiểu 8 ký tự" value={pw} onChange={e => setPw(e.target.value)} error={!!errors.pw} />
        </Field>
        <Button variant="primary" type="submit" icon={loading ? null : 'userPlus'} disabled={loading} style={{ width: '100%' }}>
          {loading ? <><span className="spinner"/> Đang tạo...</> : 'Tạo tài khoản'}
        </Button>
      </form>
    </AuthLayout>
  );
}

/* ============================================================
   Forgot password
============================================================ */
function Forgot() {
  const [email, setEmail] = useStateA('');
  const [sent, setSent] = useStateA(false);
  const [loading, setLoading] = useStateA(false);

  const submit = (e) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setTimeout(() => { setSent(true); setLoading(false); }, 600);
  };

  return (
    <AuthLayout
      icon="key" tone="amber"
      title="Lỡ tay quên mật khẩu hả?"
      sub="Nhập email tài khoản, bọn tao gửi link đặt lại trong vài giây."
      footer={<Link to="/login" className="link">← Quay lại đăng nhập</Link>}
    >
      {!sent ? (
        <form onSubmit={submit} className="col gap-4">
          <Field label="Email" required>
            <Input icon="mail" type="email" placeholder="ban@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </Field>
          <Button variant="primary" type="submit" icon={loading ? null : 'mail'} disabled={loading} style={{ width: '100%' }}>
            {loading ? <><span className="spinner"/> Đang gửi...</> : 'Gửi link đặt lại'}
          </Button>
        </form>
      ) : (
        <div className="col gap-4">
          <div className="banner banner-emerald">
            <Icon name="checkCircle" size={18} />
            <div>Gửi link đặt lại về email của bạn rồi. Kiểm tra email, bấm link để đặt lại mật khẩu.</div>
          </div>
          <Button variant="outline" icon="arrowLeft" onClick={() => navigate('/login')} style={{ width: '100%' }}>Quay lại đăng nhập</Button>
        </div>
      )}
    </AuthLayout>
  );
}

/* ============================================================
   Reset password
============================================================ */
function Reset({ token }) {
  const [pw, setPw] = useStateA('');
  const [pw2, setPw2] = useStateA('');
  const [errors, setErrors] = useStateA({});
  const [done, setDone] = useStateA(false);
  const [loading, setLoading] = useStateA(false);

  const submit = (e) => {
    e.preventDefault();
    const er = {};
    if (!pw || pw.length < 8) er.pw = 'Tối thiểu 8 ký tự';
    if (pw !== pw2) er.pw2 = 'Mật khẩu không khớp';
    setErrors(er);
    if (Object.keys(er).length) return;
    setLoading(true);
    setTimeout(() => { setDone(true); setLoading(false); }, 500);
  };

  return (
    <AuthLayout
      icon="lock"
      title="Đặt lại mật khẩu"
      sub="Chọn mật khẩu mới mạnh hơn nha — tối thiểu 8 ký tự."
    >
      {!done ? (
        <form onSubmit={submit} className="col gap-4">
          <input type="hidden" value={token || ''} />
          <Field label="Mật khẩu mới" required error={errors.pw}>
            <Input icon="lock" type="password" value={pw} onChange={e => setPw(e.target.value)} error={!!errors.pw}/>
          </Field>
          <Field label="Nhập lại mật khẩu mới" required error={errors.pw2}>
            <Input icon="lock" type="password" value={pw2} onChange={e => setPw2(e.target.value)} error={!!errors.pw2}/>
          </Field>
          <Button variant="primary" type="submit" icon="save" disabled={loading} style={{ width: '100%' }}>
            {loading ? <><span className="spinner"/> Đang đổi...</> : 'Đổi mật khẩu'}
          </Button>
        </form>
      ) : (
        <div className="col gap-4">
          <div className="banner banner-emerald">
            <Icon name="checkCircle" size={18} />
            <div>Đặt lại mật khẩu thành công! Đăng nhập lại với mật khẩu mới.</div>
          </div>
          <Button variant="primary" icon="logIn" onClick={() => navigate('/login')} style={{ width: '100%' }}>Đăng nhập ngay</Button>
        </div>
      )}
    </AuthLayout>
  );
}

/* ============================================================
   Legal pages
============================================================ */
function LegalLayout({ title, children }) {
  return (
    <>
      <header style={{ borderBottom: '1.5px solid var(--border)', padding: '14px 24px', background: 'var(--surface)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}><Link to="/"><Brand /></Link></div>
      </header>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>
        <h1 className="display" style={{ fontSize: 32, margin: 0 }}>{title}</h1>
        <p className="muted" style={{ marginTop: 6 }}>Cập nhật: 01/05/2026</p>
        <div style={{ marginTop: 24, fontSize: 15, lineHeight: 1.7, color: 'var(--ink-2)' }}>
          {children}
        </div>
        <Link to="/" className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 32 }}><Icon name="arrowLeft" size={14}/> Quay về trang chủ</Link>
      </main>
    </>
  );
}
const lorem = (
  <>
    <p>Nội dung sẽ được cập nhật. Đây là bản placeholder cho prototype.</p>
    <h3>1. Cam kết về dữ liệu</h3>
    <p>Bọn tao không upload data của mày lên cloud. Tất cả lưu local + database tự host. Backup JSON là cách export duy nhất, và do mày kiểm soát.</p>
    <h3>2. Không quảng cáo, không tracking</h3>
    <p>Không gắn pixel, không Google Analytics, không Facebook SDK. App là app, không phải con bò sữa.</p>
    <h3>3. Liên hệ</h3>
    <p>Có thắc mắc, email: <a className="link" href="mailto:hi@warrantyvault.app">hi@warrantyvault.app</a></p>
  </>
);
const Privacy = () => <LegalLayout title="Chính sách bảo mật">{lorem}</LegalLayout>;
const Terms = () => <LegalLayout title="Điều khoản sử dụng">{lorem}</LegalLayout>;
const Cookies = () => <LegalLayout title="Chính sách Cookie">{lorem}</LegalLayout>;

window.PAGES = window.PAGES || {};
Object.assign(window.PAGES, { Login, Register, Forgot, Reset, Privacy, Terms, Cookies });
