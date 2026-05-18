/* Dashboard page */
/* global React, UI, Icon, Link, MOCK, formatVND, formatDateVN, warrantyDaysLeft, warrantyEnd, deviceMaxWarrantyDaysLeft, daysBetween, monthlyEquivalent */
const { Card, Button, IconBadge, WarrantyPill, StatCard, EmptyState, Badge } = UI;

function Dashboard() {
  const { DEVICES, SUBSCRIPTIONS, WISHLIST, catById, today } = MOCK;

  const stats = (() => {
    let total = DEVICES.length;
    let active = 0, soon = 0, expired = 0;
    DEVICES.forEach(d => {
      const dl = deviceMaxWarrantyDaysLeft(d);
      if (dl < 0) expired++;
      else if (dl <= 30) { soon++; active++; }
      else active++;
    });
    return { total, active, soon, expired };
  })();

  // Upcoming warranties (≤30 days)
  const upcoming = DEVICES
    .map(d => ({ d, dl: deviceMaxWarrantyDaysLeft(d) }))
    .filter(x => x.dl >= 0 && x.dl <= 30)
    .sort((a, b) => a.dl - b.dl)
    .slice(0, 5);

  // Subscriptions metrics
  const activeSubs = SUBSCRIPTIONS.filter(s => s.status === 'ACTIVE');
  const monthlyCost = activeSubs.reduce((s, x) => s + monthlyEquivalent(x), 0);
  const yearlyCost = monthlyCost * 12;
  const upcomingSubs = activeSubs
    .map(s => ({ s, days: daysBetween(today, new Date(s.nextRenewal)) }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 4);

  // Wishlist
  const wishItems = WISHLIST.filter(w => w.status === 'WATCHING' || w.status === 'DECIDED');
  const wishTotal = wishItems.reduce((s, w) => s + (w.currentPrice || w.initialPrice || 0), 0);
  const upcomingWish = wishItems
    .filter(w => w.targetDate)
    .map(w => ({ w, days: daysBetween(today, new Date(w.targetDate)) }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 3);

  if (!DEVICES.length) {
    return (
      <>
        <UI.PageHeader title="Chào, Trung 👋" sub="Đây là tổng quan tình trạng bảo hành & chi phí của bạn hôm nay." />
        <EmptyState
          icon="package"
          title="Chưa có thiết bị nào, bắt đầu nào"
          description="Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... để theo dõi bảo hành tự động."
          action={<Button variant="primary" icon="plus" onClick={() => navigate('/devices/new')}>Thêm thiết bị đầu tiên</Button>}
        />
      </>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Chào, Trung <span style={{ fontFamily: 'system-ui' }}>👋</span></h1>
        <p className="page-sub">Đây là tổng quan tình trạng bảo hành & chi phí của bạn hôm nay.</p>
      </div>

      {/* 4 stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
        <StatCard label="Tổng thiết bị" value={stats.total} icon="package" tone="primary" sub="đang theo dõi"/>
        <StatCard label="Còn bảo hành" value={stats.active - stats.soon} icon="shieldCheck" tone="emerald" sub="Còn được bảo vệ"/>
        <StatCard label="Sắp hết (≤30 ngày)" value={stats.soon} icon="alert" tone="amber" sub="Cần để ý nha"/>
        <StatCard label="Đã hết bảo hành" value={stats.expired} icon="shieldX" tone="zinc" sub="Hết kèo rồi"/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
        {/* Sắp hết bảo hành */}
        <Card>
          <div className="row items-center justify-between" style={{ marginBottom: 16 }}>
            <div className="row items-center gap-2">
              <IconBadge icon="alert" tone="amber" size="sm" />
              <h3 className="section-title" style={{ margin: 0 }}>Sắp hết bảo hành</h3>
            </div>
            <Link to="/reminders" className="link" style={{ fontSize: 13 }}>Xem tất cả →</Link>
          </div>
          {upcoming.length === 0 ? (
            <div style={{ padding: '12px 0', color: 'var(--muted)', fontSize: 14 }}>
              <span style={{ color: 'var(--emerald)' }}>✓</span> Tất cả đều ngon, không có gì sắp hết trong 30 ngày tới đâu.
            </div>
          ) : (
            <div className="col">
              {upcoming.map(({ d, dl }) => {
                const cat = catById(d.category);
                return (
                  <Link key={d.id} to={`/devices/${d.id}`} className="row items-center gap-3" style={{ padding: '10px 0', borderTop: '1px dashed var(--border)' }}>
                    <IconBadge icon={cat.icon} tone={cat.tint} size="sm"/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{cat.label} • {d.brand} • {formatDateVN(d.purchaseDate)}</div>
                    </div>
                    <WarrantyPill daysLeft={dl} />
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* Gói đăng ký */}
        {activeSubs.length > 0 && (
          <Card>
            <div className="row items-center justify-between" style={{ marginBottom: 16 }}>
              <div className="row items-center gap-2">
                <IconBadge icon="refresh" tone="sky" size="sm" />
                <h3 className="section-title" style={{ margin: 0 }}>Gói đăng ký</h3>
              </div>
              <Link to="/subscriptions" className="link" style={{ fontSize: 13 }}>Xem tất cả →</Link>
            </div>
            <div className="row gap-4" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="stat-eyebrow">Mỗi tháng</div>
                <div className="stat-value" style={{ fontSize: 28, marginTop: 4 }}>{formatVND(Math.round(monthlyCost))}</div>
                <div className="stat-sub">~ {formatVND(Math.round(yearlyCost))} / năm • {activeSubs.length} gói đang hoạt động</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="stat-eyebrow" style={{ marginBottom: 6 }}>Sắp gia hạn</div>
                <div className="col" style={{ gap: 6 }}>
                  {upcomingSubs.length === 0 ? (
                    <span className="muted" style={{ fontSize: 13 }}>Không có gói nào sắp charge</span>
                  ) : upcomingSubs.map(({ s, days }) => (
                    <Link key={s.id} to={`/subscriptions/${s.id}`} className="row items-center gap-2" style={{ fontSize: 13 }}>
                      <Icon name="refresh" size={12} style={{ color: days < 0 ? 'var(--destructive)' : 'var(--muted)' }}/>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ color: days < 0 ? 'var(--destructive)' : 'var(--ink-2)', fontWeight: 600 }}>{formatDateVN(s.nextRenewal)}</span>
                        {' '}<span className="muted">{s.name}</span>
                      </span>
                      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatVND(s.price)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Wishlist */}
        {wishItems.length > 0 && (
          <Card>
            <div className="row items-center justify-between" style={{ marginBottom: 16 }}>
              <div className="row items-center gap-2">
                <IconBadge icon="heart" tone="rose" size="sm"/>
                <h3 className="section-title" style={{ margin: 0 }}>Đang thèm</h3>
              </div>
              <Link to="/wishlist" className="link" style={{ fontSize: 13 }}>Xem tất cả →</Link>
            </div>
            <div className="row gap-4">
              <div style={{ flex: 1 }}>
                <div className="stat-eyebrow">Tổng tiền (giá hiện tại)</div>
                <div className="stat-value" style={{ fontSize: 28, marginTop: 4 }}>{formatVND(wishTotal)}</div>
                <div className="stat-sub">{wishItems.length} món đang theo dõi</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="stat-eyebrow" style={{ marginBottom: 6 }}>Sắp tới ngày mua</div>
                <div className="col" style={{ gap: 6 }}>
                  {upcomingWish.length === 0 ? (
                    <span className="muted" style={{ fontSize: 13 }}>Chưa có món nào đặt ngày dự kiến</span>
                  ) : upcomingWish.map(({ w, days }) => (
                    <Link key={w.id} to={`/wishlist/${w.id}`} className="row items-center gap-2" style={{ fontSize: 13 }}>
                      <Icon name="calendar" size={12} style={{ color: 'var(--muted)' }}/>
                      <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{formatDateVN(w.targetDate)}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="muted">{w.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Quick add card — playful */}
        <Card className="card-chunky" style={{ background: 'linear-gradient(135deg, var(--primary-soft), var(--primary-soft-2))', border: '2px solid var(--ink)' }}>
          <div className="row items-center gap-3" style={{ marginBottom: 12 }}>
            <Icon name="zap" size={22} style={{ color: 'var(--primary-ink)' }}/>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--primary-ink)' }}>Thêm nhanh</h3>
          </div>
          <p style={{ margin: '0 0 14px', color: 'var(--primary-ink)', opacity: 0.85, fontSize: 13 }}>
            Mới mua đồ? Note ngay vào kẻo lại quên.
          </p>
          <div className="row gap-2 flex-wrap">
            <Button variant="primary" size="sm" icon="plus" onClick={() => navigate('/devices/new')}>Thiết bị</Button>
            <Button size="sm" icon="refresh" onClick={() => navigate('/subscriptions/new')}>Gói đăng ký</Button>
            <Button size="sm" icon="heart" onClick={() => navigate('/wishlist/new')}>Wishlist</Button>
          </div>
        </Card>
      </div>
    </>
  );
}

window.PAGES = window.PAGES || {};
window.PAGES.Dashboard = Dashboard;
