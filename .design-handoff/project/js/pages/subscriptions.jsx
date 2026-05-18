/* Subscriptions list */
/* global React, UI, Icon, Link, navigate, MOCK, formatVND, formatDateVN, monthlyEquivalent, daysBetween */
const { Button, Card, Badge, IconBadge, Input, Select, EmptyState, PageHeader } = UI;
const { useState: useStateSL, useMemo: useMemoSL } = React;

const CYCLE_LABEL = { MONTHLY: 'Hàng tháng', YEARLY: 'Hàng năm', QUARTERLY: 'Hàng quý', WEEKLY: 'Hàng tuần', CUSTOM: 'Tuỳ chỉnh', LIFETIME: 'Trọn đời' };
const SUB_STATUS_LABEL = { ACTIVE: 'Đang dùng', PAUSED: 'Tạm dừng', CANCELLED: 'Đã huỷ', EXPIRED: 'Hết hạn' };
const SUB_STATUS_TONE = { ACTIVE: 'emerald', PAUSED: 'amber', CANCELLED: 'destructive', EXPIRED: 'zinc' };

function SubscriptionsList({ query = {} }) {
  const { SUBSCRIPTIONS, SUB_CATEGORIES, catById, today } = MOCK;
  const [q, setQ] = useStateSL(query.q || '');
  const [status, setStatus] = useStateSL(query.status || 'ACTIVE_PAUSED');
  const [cycle, setCycle] = useStateSL(query.billingCycle || '');
  const [category, setCategory] = useStateSL(query.category || '');
  const [sort, setSort] = useStateSL(query.sort || 'renewal-asc');

  const filtered = useMemoSL(() => {
    let arr = SUBSCRIPTIONS.slice();
    const ql = q.toLowerCase();
    if (ql) arr = arr.filter(s => `${s.name} ${s.brand} ${s.plan}`.toLowerCase().includes(ql));
    if (status === 'ACTIVE_PAUSED') arr = arr.filter(s => s.status === 'ACTIVE' || s.status === 'PAUSED');
    else if (status) arr = arr.filter(s => s.status === status);
    if (cycle) arr = arr.filter(s => s.cycle === cycle);
    if (category) arr = arr.filter(s => s.category === category);
    arr.sort((a, b) => {
      switch (sort) {
        case 'renewal-asc': return new Date(a.nextRenewal) - new Date(b.nextRenewal);
        case 'renewal-desc': return new Date(b.nextRenewal) - new Date(a.nextRenewal);
        case 'monthly-desc': return monthlyEquivalent(b) - monthlyEquivalent(a);
        case 'monthly-asc': return monthlyEquivalent(a) - monthlyEquivalent(b);
        case 'price-desc': return b.price - a.price;
        case 'created-desc': return new Date(b.start) - new Date(a.start);
        case 'name-asc': return a.name.localeCompare(b.name);
        default: return 0;
      }
    });
    return arr;
  }, [SUBSCRIPTIONS, q, status, cycle, category, sort]);

  const activeSubs = SUBSCRIPTIONS.filter(s => s.status === 'ACTIVE');
  const monthly = activeSubs.reduce((s, x) => s + monthlyEquivalent(x), 0);
  const upcoming = activeSubs.map(s => ({ s, days: daysBetween(today, new Date(s.nextRenewal)) })).sort((a, b) => a.days - b.days).slice(0, 3);
  const isFiltered = q || cycle || category || status !== 'ACTIVE_PAUSED';

  return (
    <>
      <PageHeader
        title="Gói đăng ký"
        sub={`Hiển thị ${filtered.length} gói${isFiltered ? ' đã lọc' : ''}. Theo dõi chi phí định kỳ — biết tiền chảy đi đâu mỗi tháng.`}
        actions={<Button variant="primary" icon="plus" onClick={() => navigate('/subscriptions/new')}>Thêm gói</Button>}
      />

      {activeSubs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
          <Card style={{ background: 'linear-gradient(135deg, var(--sky-soft), var(--surface))' }}>
            <span className="stat-eyebrow">Mỗi tháng</span>
            <div className="stat-value" style={{ fontSize: 28 }}>{formatVND(Math.round(monthly))}</div>
            <div className="stat-sub">~ {formatVND(Math.round(monthly * 12))} / năm</div>
          </Card>
          <Card>
            <span className="stat-eyebrow">Đang hoạt động</span>
            <div className="stat-value" style={{ fontSize: 28 }}>{activeSubs.length}</div>
            <div className="stat-sub">gói đang chạy</div>
          </Card>
          <Card>
            <span className="stat-eyebrow">Sắp gia hạn</span>
            <div className="col" style={{ gap: 4, marginTop: 8, fontSize: 13 }}>
              {upcoming.map(({ s, days }) => (
                <Link key={s.id} to={`/subscriptions/${s.id}`} className="row items-center gap-2">
                  <span style={{ color: days < 0 ? 'var(--destructive)' : 'var(--ink-2)', fontWeight: 600, minWidth: 80 }}>{formatDateVN(s.nextRenewal)}</span>
                  <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.name}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="toolbar">
        <div style={{ flex: '1 1 220px', minWidth: 180 }}>
          <Input icon="search" placeholder="Tìm tên, hãng, plan..." value={q} onChange={e => setQ(e.target.value)}/>
        </div>
        <Select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
          <option value="ACTIVE_PAUSED">Đang dùng + tạm dừng</option>
          <option value="">Tất cả trạng thái</option>
          <option value="ACTIVE">Đang dùng</option>
          <option value="PAUSED">Tạm dừng</option>
          <option value="CANCELLED">Đã huỷ</option>
          <option value="EXPIRED">Hết hạn</option>
        </Select>
        <Select value={cycle} onChange={e => setCycle(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
          <option value="">Tất cả chu kỳ</option>
          {Object.entries(CYCLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={category} onChange={e => setCategory(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
          <option value="">Tất cả loại</option>
          {MOCK.SUB_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <Select value={sort} onChange={e => setSort(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
          <option value="renewal-asc">Sắp gia hạn trước</option>
          <option value="renewal-desc">Lâu gia hạn nhất</option>
          <option value="monthly-desc">Tốn nhiều / tháng</option>
          <option value="monthly-asc">Ít nhất / tháng</option>
          <option value="price-desc">Giá cao</option>
          <option value="created-desc">Mới thêm</option>
          <option value="name-asc">Tên A-Z</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon="refresh"
            tone="sky"
            title={isFiltered ? 'Không có gì khớp bộ lọc' : 'Chưa có gói đăng ký nào'}
            description={isFiltered ? 'Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.' : 'Note lại các gói phần mềm/dịch vụ — Apple One, ChatGPT, Spotify, hosting...'}
            action={!isFiltered && <Button variant="primary" icon="plus" onClick={() => navigate('/subscriptions/new')}>Thêm gói đầu tiên</Button>}
          />
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Gói</th>
                <th className="hide-md">Plan</th>
                <th className="num">Giá / chu kỳ</th>
                <th className="hide-md num">~ / tháng</th>
                <th>Gia hạn</th>
                <th className="hide-sm">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const cat = catById(s.category);
                const days = daysBetween(today, new Date(s.nextRenewal));
                const overdue = days < 0;
                return (
                  <tr key={s.id} className="clickable" onClick={() => navigate(`/subscriptions/${s.id}`)}>
                    <td>
                      <div className="row items-center gap-3">
                        <IconBadge icon={cat.icon} tone={cat.tint} size="sm"/>
                        <div>
                          <div className="row items-center gap-1" style={{ fontWeight: 700, fontSize: 14 }}>
                            {s.name}
                            {s.cancelUrl && <Icon name="externalLink" size={11} style={{ color: 'var(--muted)' }}/>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.brand} • {cat.label}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hide-md" style={{ color: 'var(--ink-2)' }}>{s.plan || '—'}</td>
                    <td className="num">
                      <div className="tabular" style={{ fontWeight: 700 }}>{formatVND(s.price)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{CYCLE_LABEL[s.cycle]}</div>
                    </td>
                    <td className="hide-md num"><span className="tabular muted">{s.cycle === 'LIFETIME' ? '—' : formatVND(Math.round(monthlyEquivalent(s)))}</span></td>
                    <td>
                      <div className="row items-center gap-2">
                        <Icon name={overdue ? 'alert' : 'refresh'} size={14} style={{ color: overdue ? 'var(--destructive)' : 'var(--muted)' }}/>
                        <span style={{ color: overdue ? 'var(--destructive)' : 'var(--ink-2)', fontWeight: 600, fontSize: 13 }}>
                          {formatDateVN(s.nextRenewal)}
                        </span>
                      </div>
                    </td>
                    <td className="hide-sm"><Badge tone={SUB_STATUS_TONE[s.status]}>{SUB_STATUS_LABEL[s.status]}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

window.PAGES.SubscriptionsList = SubscriptionsList;
window.CYCLE_LABEL = CYCLE_LABEL;
window.SUB_STATUS_LABEL = SUB_STATUS_LABEL;
window.SUB_STATUS_TONE = SUB_STATUS_TONE;
