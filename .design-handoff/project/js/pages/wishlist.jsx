/* Wishlist list */
/* global React, UI, Icon, Link, navigate, MOCK, formatVND, formatDateVN, daysBetween */
const { Button, Card, Badge, IconBadge, Input, Select, EmptyState, PageHeader } = UI;
const { useState: useStateWL, useMemo: useMemoWL } = React;

const PRIORITY_LABEL = { CRITICAL: 'Cực thèm', HIGH: 'Khá thèm', MEDIUM: 'Vừa thèm', LOW: 'Hơi thèm' };
const PRIORITY_TONE = { CRITICAL: 'destructive', HIGH: 'amber', MEDIUM: 'sky', LOW: 'zinc' };
const PRIORITY_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

const WISH_STATUS_LABEL = { WATCHING: 'Đang ngó', DECIDED: 'Quyết mua', PURCHASED: 'Đã mua', SUBSCRIBED: 'Đã subscribe', REFUNDED: 'Đã hoàn', REJECTED: 'Bỏ qua' };
const WISH_STATUS_TONE = { WATCHING: 'sky', DECIDED: 'primary', PURCHASED: 'emerald', SUBSCRIBED: 'violet', REFUNDED: 'amber', REJECTED: 'zinc' };

function WishlistList({ query = {} }) {
  const { WISHLIST, catById } = MOCK;
  const [q, setQ] = useStateWL(query.q || '');
  const [status, setStatus] = useStateWL(query.status || 'WATCHING_DECIDED');
  const [priority, setPriority] = useStateWL(query.priority || '');
  const [category, setCategory] = useStateWL(query.category || '');
  const [sort, setSort] = useStateWL(query.sort || 'priority-desc');

  const filtered = useMemoWL(() => {
    let arr = WISHLIST.slice();
    const ql = q.toLowerCase();
    if (ql) arr = arr.filter(w => `${w.name} ${w.brand}`.toLowerCase().includes(ql));
    if (status === 'WATCHING_DECIDED') arr = arr.filter(w => w.status === 'WATCHING' || w.status === 'DECIDED');
    else if (status) arr = arr.filter(w => w.status === status);
    if (priority) arr = arr.filter(w => w.priority === priority);
    if (category) arr = arr.filter(w => w.category === category);
    arr.sort((a, b) => {
      switch (sort) {
        case 'priority-desc': return PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
        case 'target-asc': return (a.targetDate ? new Date(a.targetDate) : 9e9) - (b.targetDate ? new Date(b.targetDate) : 9e9);
        case 'target-desc': return (b.targetDate ? new Date(b.targetDate) : 0) - (a.targetDate ? new Date(a.targetDate) : 0);
        case 'price-desc': return (b.currentPrice || 0) - (a.currentPrice || 0);
        case 'price-asc': return (a.currentPrice || 0) - (b.currentPrice || 0);
        default: return 0;
      }
    });
    return arr;
  }, [WISHLIST, q, status, priority, category, sort]);

  const watching = WISHLIST.filter(w => w.status === 'WATCHING' || w.status === 'DECIDED');
  const wishTotal = watching.reduce((s, w) => s + (w.currentPrice || w.initialPrice || 0), 0);
  const upcoming = watching.filter(w => w.targetDate).sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate)).slice(0, 3);

  const isFiltered = q || priority || category || status !== 'WATCHING_DECIDED';

  return (
    <>
      <PageHeader
        title="Đang thèm"
        sub={`Hiển thị ${filtered.length} món${isFiltered ? ' đã lọc' : ''}. Note lại đồ mày đang để mắt — đợi sale là nhào vô.`}
        actions={<Button variant="primary" icon="plus" onClick={() => navigate('/wishlist/new')}>Thêm món</Button>}
      />

      {watching.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
          <Card style={{ background: 'linear-gradient(135deg, var(--rose-soft), var(--surface))' }}>
            <span className="stat-eyebrow">Đang theo dõi</span>
            <div className="stat-value" style={{ fontSize: 28 }}>{watching.length}</div>
            <div className="stat-sub">món trong list</div>
          </Card>
          <Card style={{ background: 'linear-gradient(135deg, var(--violet-soft), var(--surface))' }}>
            <span className="stat-eyebrow">Tổng tiền</span>
            <div className="stat-value" style={{ fontSize: 28 }}>{formatVND(wishTotal)}</div>
            <div className="stat-sub">theo giá hiện tại</div>
          </Card>
          <Card style={{ background: 'linear-gradient(135deg, var(--amber-soft), var(--surface))' }}>
            <span className="stat-eyebrow">Sắp tới</span>
            <div className="col" style={{ marginTop: 8, fontSize: 13, gap: 4 }}>
              {upcoming.map(w => (
                <Link key={w.id} to={`/wishlist/${w.id}`} className="row gap-2 items-center">
                  <span style={{ fontWeight: 600 }}>{formatDateVN(w.targetDate)}</span>
                  <span className="muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="toolbar">
        <div style={{ flex: '1 1 220px', minWidth: 180 }}>
          <Input icon="search" placeholder="Tìm tên, hãng..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
          <option value="WATCHING_DECIDED">Đang ngó + Quyết mua</option>
          <option value="">Tất cả</option>
          {Object.entries(WISH_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={priority} onChange={e => setPriority(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
          <option value="">Tất cả mức</option>
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={category} onChange={e => setCategory(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
          <option value="">Tất cả loại</option>
          {[...MOCK.CATEGORIES, ...MOCK.SUB_CATEGORIES].map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <Select value={sort} onChange={e => setSort(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
          <option value="priority-desc">Mức độ thèm cao</option>
          <option value="target-asc">Target gần nhất</option>
          <option value="target-desc">Target xa nhất</option>
          <option value="price-desc">Giá cao</option>
          <option value="price-asc">Giá thấp</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon="heart" tone="rose"
            title={isFiltered ? 'Không có gì khớp bộ lọc' : 'Wishlist trống — thêm cái mày thèm đi'}
            description={isFiltered ? 'Thử nới bộ lọc xem sao.' : 'Note lại những món mày đang để mắt — giá, link, deadline...'}
            action={!isFiltered && <Button variant="primary" icon="plus" onClick={() => navigate('/wishlist/new')}>Thêm món đầu tiên</Button>}
          />
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Sản phẩm</th>
                <th className="hide-md num">Giá ban đầu</th>
                <th className="num">Giá hiện tại</th>
                <th className="hide-md">Δ</th>
                <th className="hide-sm">Target</th>
                <th className="hide-sm">Mức</th>
                <th className="hide-md">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w, i) => {
                const cat = catById(w.category);
                const delta = w.initialPrice && w.currentPrice ? ((w.currentPrice - w.initialPrice) / w.initialPrice) * 100 : null;
                return (
                  <tr key={w.id} className="clickable" onClick={() => navigate(`/wishlist/${w.id}`)}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <div className="row items-center gap-3">
                        <IconBadge icon={cat.icon} tone={cat.tint} size="sm"/>
                        <div>
                          <div className="row items-center gap-1" style={{ fontWeight: 700, fontSize: 14 }}>
                            {w.name}
                            {w.buyUrl && <Icon name="externalLink" size={11} style={{ color: 'var(--muted)' }}/>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{w.brand} • {cat.label}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hide-md num"><span className="tabular muted">{formatVND(w.initialPrice)}</span></td>
                    <td className="num"><span className="tabular" style={{ fontWeight: 700 }}>{formatVND(w.currentPrice)}</span></td>
                    <td className="hide-md">
                      {delta == null ? '—' : (
                        <span className={delta < 0 ? 'delta-down' : 'delta-up'}>
                          <Icon name={delta < 0 ? 'arrowDown' : 'arrowUp'} size={12}/> {Math.abs(delta).toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="hide-sm" style={{ color: 'var(--ink-2)' }}>{w.targetDate ? formatDateVN(w.targetDate) : '—'}</td>
                    <td className="hide-sm"><Badge tone={PRIORITY_TONE[w.priority]}>{PRIORITY_LABEL[w.priority]}</Badge></td>
                    <td className="hide-md"><Badge tone={WISH_STATUS_TONE[w.status]}>{WISH_STATUS_LABEL[w.status]}</Badge></td>
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

window.PAGES.WishlistList = WishlistList;
window.PRIORITY_LABEL = PRIORITY_LABEL;
window.PRIORITY_TONE = PRIORITY_TONE;
window.WISH_STATUS_LABEL = WISH_STATUS_LABEL;
window.WISH_STATUS_TONE = WISH_STATUS_TONE;
