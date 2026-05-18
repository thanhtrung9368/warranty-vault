/* Landing page */
/* global React, UI, Icon, VaultMark, Link, navigate, useAuth */
const { Button, Card, IconBadge } = UI;

function LandingHeader() {
  const auth = useAuth();
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 30,
      background: 'rgba(255, 247, 238, 0.85)', backdropFilter: 'blur(10px)',
      borderBottom: '1.5px solid var(--border)'
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/"><Brand /></Link>
        <div className="row gap-3 items-center">
          {auth.user ? (
            <Button variant="primary" iconRight="arrowRight" onClick={() => navigate('/dashboard')}>Vào app</Button>
          ) : (
            <>
              <Link to="/login" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>Đăng nhập</Link>
              <Button variant="primary" onClick={() => navigate('/register')}>Bắt đầu miễn phí</Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function HeroIllustration() {
  return (
    <svg viewBox="0 0 320 280" width="100%" style={{ maxWidth: 360, filter: 'drop-shadow(0 30px 40px rgba(80, 40, 10, 0.18))' }}>
      <defs>
        <linearGradient id="vault-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary-2)"/>
          <stop offset="100%" stopColor="var(--primary)"/>
        </linearGradient>
      </defs>
      {/* Background blobs */}
      <circle cx="60" cy="70" r="40" fill="var(--violet-soft)" opacity="0.5"/>
      <circle cx="280" cy="220" r="36" fill="var(--emerald-soft)" opacity="0.6"/>
      <circle cx="270" cy="60" r="20" fill="var(--amber-soft)"/>
      {/* The vault */}
      <g transform="translate(60, 50)">
        <rect x="0" y="20" width="200" height="180" rx="24" fill="url(#vault-grad)" stroke="var(--ink)" strokeWidth="3"/>
        <rect x="14" y="34" width="172" height="150" rx="16" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3"/>
        {/* dial */}
        <circle cx="80" cy="108" r="50" fill="var(--surface-2)" stroke="var(--ink)" strokeWidth="3"/>
        <circle cx="80" cy="108" r="36" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2"/>
        <circle cx="80" cy="108" r="10" fill="var(--ink)"/>
        {/* dial notches */}
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => {
          const rad = (deg - 90) * Math.PI / 180;
          const x1 = 80 + Math.cos(rad) * 42, y1 = 108 + Math.sin(rad) * 42;
          const x2 = 80 + Math.cos(rad) * 48, y2 = 108 + Math.sin(rad) * 48;
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink)" strokeWidth="2"/>;
        })}
        {/* dial pointer */}
        <line x1="80" y1="108" x2="80" y2="76" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" transform="rotate(45 80 108)"/>
        {/* handle */}
        <circle cx="160" cy="108" r="6" fill="var(--ink)"/>
        <rect x="156" y="60" width="8" height="100" rx="4" fill="var(--ink)"/>
        <circle cx="160" cy="60" r="10" fill="var(--ink)"/>
        <circle cx="160" cy="158" r="10" fill="var(--ink)"/>
        {/* feet */}
        <rect x="4" y="200" width="16" height="14" rx="3" fill="var(--ink)"/>
        <rect x="180" y="200" width="16" height="14" rx="3" fill="var(--ink)"/>
        {/* eyes (lock-personality) */}
        <circle cx="65" cy="102" r="3" fill="var(--ink)"/>
        <circle cx="95" cy="102" r="3" fill="var(--ink)"/>
        <path d="M 70 118 Q 80 124 90 118" stroke="var(--ink)" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
      </g>
      {/* Floating receipt */}
      <g transform="translate(220, 80) rotate(12)">
        <rect x="0" y="0" width="56" height="72" rx="6" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2"/>
        <line x1="8" y1="14" x2="48" y2="14" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round"/>
        <line x1="8" y1="24" x2="42" y2="24" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="8" y1="32" x2="36" y2="32" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="28" cy="50" r="10" fill="var(--emerald-soft)"/>
        <path d="M 23 50 l 4 4 l 8 -8" stroke="var(--emerald-ink)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
      {/* Floating bell */}
      <g transform="translate(28, 168) rotate(-14)">
        <circle cx="0" cy="0" r="22" fill="var(--amber-soft)" stroke="var(--ink)" strokeWidth="2.5"/>
        <path d="M -8 -2 a 8 8 0 0 1 16 0 v 6 l 2 4 h -20 l 2 -4 z" fill="var(--ink)"/>
      </g>
    </svg>
  );
}

function FeatureCard({ icon, tint, title, desc }) {
  return (
    <div className="card" style={{ padding: 24 }}>
      <IconBadge icon={icon} tone={tint} size="lg" />
      <h3 style={{ margin: '14px 0 6px', fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700 }}>{title}</h3>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>{desc}</p>
    </div>
  );
}

function Landing() {
  const auth = useAuth();
  return (
    <>
      <LandingHeader />
      <main>
        {/* Hero */}
        <section className="hero-gradient" style={{ padding: '64px 24px 80px' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 40, alignItems: 'center' }}>
            <div>
              <span className="badge badge-primary badge-lg" style={{ marginBottom: 20 }}>
                <Icon name="sparkles" size={12} /> Miễn phí • Local-first • Tiếng Việt
              </span>
              <h1 className="display" style={{ fontSize: 'clamp(36px, 5vw, 60px)', margin: 0, marginBottom: 18 }}>
                Đừng quên ngày hết{' '}
                <span style={{ background: 'linear-gradient(120deg, var(--primary), var(--primary-2))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>bảo hành</span>{' '}
                thiết bị của bạn
              </h1>
              <p style={{ fontSize: 17, color: 'var(--muted)', maxWidth: 520, lineHeight: 1.55, margin: '0 0 28px' }}>
                Theo dõi thiết bị, gói đăng ký và những món đang thèm — tất cả ở một chỗ. Nhắc bảo hành sắp hết, lưu hoá đơn, biết tiền chảy đi đâu.
              </p>
              <div className="row gap-3 flex-wrap" style={{ marginBottom: 24 }}>
                {auth.user ? (
                  <Button variant="primary" iconRight="arrowRight" onClick={() => navigate('/dashboard')}>Mở Dashboard</Button>
                ) : (
                  <>
                    <Button variant="primary" iconRight="arrowRight" onClick={() => navigate('/register')}>Tạo tài khoản miễn phí</Button>
                    <Link to="/login" className="link" style={{ alignSelf: 'center' }}>Đã có tài khoản → Đăng nhập</Link>
                  </>
                )}
              </div>
              <div className="row gap-4 flex-wrap" style={{ fontSize: 13, color: 'var(--muted)' }}>
                {['Không cần thẻ tín dụng', 'Không quảng cáo', 'Backup xuất/nhập JSON'].map(t => (
                  <span key={t} className="row items-center gap-2"><Icon name="checkCircle" size={14} style={{ color: 'var(--emerald)' }}/> {t}</span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <HeroIllustration />
            </div>
          </div>
        </section>

        {/* Mock preview */}
        <section style={{ padding: '0 24px', marginTop: -40 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <Card className="card-chunky" style={{ padding: 20, transform: 'rotate(-0.5deg)' }}>
              <div className="row gap-3" style={{ marginBottom: 16 }}>
                <span style={{ width: 12, height: 12, background: '#FF6B5C', borderRadius: 6 }}></span>
                <span style={{ width: 12, height: 12, background: '#FBBF24', borderRadius: 6 }}></span>
                <span style={{ width: 12, height: 12, background: '#10B981', borderRadius: 6 }}></span>
                <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 6 }}>warrantyvault.app/dashboard</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {[
                  { l: 'Tổng', v: '10', i: 'package', t: 'primary' },
                  { l: 'Còn BH', v: '8', i: 'shieldCheck', t: 'emerald' },
                  { l: 'Sắp hết', v: '2', i: 'alert', t: 'amber' },
                  { l: 'Hết', v: '1', i: 'shieldX', t: 'zinc' },
                ].map((s, i) => (
                  <div key={i} className="card" style={{ padding: 14 }}>
                    <div className="row items-center justify-between">
                      <span className="eyebrow">{s.l}</span>
                      <IconBadge icon={s.i} tone={s.t} size="sm" />
                    </div>
                    <div className="stat-value" style={{ fontSize: 24, marginTop: 6 }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </section>

        {/* Features */}
        <section style={{ padding: '100px 24px 40px' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="text-center" style={{ marginBottom: 40 }}>
              <span className="eyebrow">Tính năng</span>
              <h2 className="display" style={{ fontSize: 36, margin: '8px 0' }}>Tất cả những gì mày cần</h2>
              <p style={{ color: 'var(--muted)', maxWidth: 540, margin: '0 auto' }}>Không spam tính năng, không tracking. Chỉ những thứ thực sự hữu ích.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <FeatureCard icon="shieldCheck" tint="primary" title="Theo dõi bảo hành" desc="Mỗi thiết bị có thể có nhiều gói bảo hành — gốc, mở rộng, bên thứ 3. Đếm ngược tự động."/>
              <FeatureCard icon="bell" tint="amber" title="Cảnh báo sắp hết" desc="Bọn tao nhắc trước 90/60/30 ngày qua push notification. Khỏi lo bỏ lỡ."/>
              <FeatureCard icon="receipt" tint="emerald" title="Lưu hoá đơn & phiếu BH" desc="Tải ảnh hoặc PDF — tối đa 5 file mỗi thiết bị. Tìm lại nhanh khi cần claim."/>
              <FeatureCard icon="phone" tint="sky" title="Gọi & tìm trung tâm BH" desc="Lưu SĐT, địa chỉ. Một chạm để gọi hoặc mở Google Maps đường đi."/>
              <FeatureCard icon="chart" tint="violet" title="Thống kê chi tiêu" desc="Biểu đồ theo tháng, theo loại, top thiết bị đắt nhất. Biết tiền đi đâu."/>
              <FeatureCard icon="lock" tint="rose" title="Riêng tư" desc="Data của mày là của mày. Backup JSON tự lưu, không cloud không đầu rơi."/>
            </div>
          </div>
        </section>

        {/* 3 steps */}
        <section style={{ padding: '60px 24px' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="text-center" style={{ marginBottom: 40 }}>
              <span className="eyebrow">Bắt đầu</span>
              <h2 className="display" style={{ fontSize: 32, margin: '8px 0' }}>3 bước để bắt đầu</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              {[
                { n: 1, title: 'Đăng ký miễn phí', desc: 'Email + mật khẩu. 30 giây xong.' },
                { n: 2, title: 'Thêm thiết bị', desc: 'Laptop, điện thoại, máy giặt... bất cứ thứ gì có bảo hành.' },
                { n: 3, title: 'Theo dõi tự động', desc: 'Khỏi đụng vào, tao lo phần đếm ngược.' },
              ].map(s => (
                <div key={s.n} className="card" style={{ padding: 28, textAlign: 'center', position: 'relative' }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: 16,
                    background: 'var(--primary)', color: 'white',
                    fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 14,
                  }}>{s.n}</div>
                  <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>{s.title}</h4>
                  <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14 }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section style={{ padding: '80px 24px 100px' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <Card className="card-chunky text-center" style={{ padding: 48, background: 'linear-gradient(135deg, var(--primary-soft), var(--primary-soft-2))', border: '2px solid var(--ink)' }}>
              <VaultMark size={64} />
              <h2 className="display" style={{ fontSize: 32, margin: '16px 0 8px', color: 'var(--primary-ink)' }}>Sẵn sàng quản lý thiết bị?</h2>
              <p style={{ color: 'var(--primary-ink)', opacity: 0.8, margin: '0 0 24px' }}>Free mãi mãi. Không cần thẻ. Không quảng cáo.</p>
              <Button variant="primary" iconRight="arrowRight" onClick={() => navigate(auth.user ? '/dashboard' : '/register')}>
                {auth.user ? 'Mở Dashboard' : 'Tạo tài khoản miễn phí'}
              </Button>
            </Card>
          </div>
        </section>

        {/* Footer */}
        <footer style={{ borderTop: '1.5px solid var(--border)', padding: '32px 24px', background: 'var(--surface)' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <Brand />
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>© 2026 WarrantyVault. Made with ♥ in Vietnam.</div>
            <div className="row gap-4" style={{ fontSize: 13 }}>
              <Link to="/privacy" className="muted">Privacy</Link>
              <Link to="/terms" className="muted">Terms</Link>
              <Link to="/cookies" className="muted">Cookies</Link>
              <Link to="/login" className="link">Đăng nhập</Link>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}

window.PAGES = window.PAGES || {};
window.PAGES.Landing = Landing;
