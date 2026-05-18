/* Wishlist detail */
/* global React, UI, Icon, Link, navigate, MOCK, formatVND, formatDateVN, relativeDays */
const { Button, Card, Badge, IconBadge, InfoRow, PageHeader, Modal, ConfirmDialog, PillGroup, Field, MoneyInput, Input, toast } = UI;
const { useState: useStateWD } = React;

function UpdatePriceDialog({ open, onClose, defaultPrice }) {
  const [price, setPrice] = useStateWD(defaultPrice || 0);
  const [note, setNote] = useStateWD('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cập nhật giá hiện tại"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button variant="primary" icon="save" onClick={() => { toast('Đã cập nhật giá 💸', 'success'); onClose(); }}>Lưu</Button>
        </>
      }
    >
      <div className="col gap-3">
        <Field label="Giá" required><MoneyInput value={price} onChange={setPrice}/></Field>
        <Field label="Ghi chú"><Input placeholder="vd: deal Black Friday, ưu đãi student..." value={note} onChange={e => setNote(e.target.value)}/></Field>
      </div>
    </Modal>
  );
}

function WishlistDetail({ id }) {
  const w = MOCK.WISHLIST.find(x => x.id === id);
  const cat = MOCK.catById(w?.category);
  const [updateOpen, setUpdateOpen] = useStateWD(false);
  const [delOpen, setDelOpen] = useStateWD(false);
  const [status, setStatus] = useStateWD(w?.status);

  if (!w) return <Card><UI.EmptyState icon="alert" title="Không tìm thấy món" /></Card>;

  const delta = w.initialPrice && w.currentPrice ? ((w.currentPrice - w.initialPrice) / w.initialPrice) * 100 : null;
  const prices = w.priceHistory.map(p => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const chartData = w.priceHistory.map(p => ({ date: formatDateVN(p.date).slice(0,5), value: p.price }));

  return (
    <>
      <PageHeader
        back={{ href: '#/wishlist', label: 'Wishlist' }}
        title={
          <span className="row items-center gap-3 flex-wrap">
            <IconBadge icon={cat.icon} tone={cat.tint} size="lg"/>
            <span>{w.name}</span>
            <Badge tone={window.WISH_STATUS_TONE[status]}>{window.WISH_STATUS_LABEL[status]}</Badge>
            <Badge tone={window.PRIORITY_TONE[w.priority]}>{window.PRIORITY_LABEL[w.priority]}</Badge>
          </span>
        }
        sub={`${w.brand} • ${cat.label}`}
        actions={
          <>
            <Button icon="edit" onClick={() => navigate(`/wishlist/${w.id}/edit`)}>Sửa</Button>
            <Button icon="wallet" onClick={() => setUpdateOpen(true)}>Cập nhật giá</Button>
            <Button variant="primary" icon="shoppingBag" onClick={() => navigate(`/devices/new?fromWishlist=${w.id}`)}>Đã mua</Button>
            <Button variant="destructive-outline" icon="trash" onClick={() => setDelOpen(true)}>Xoá</Button>
          </>
        }
      />

      {/* 4 metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 18 }}>
        <Card>
          <span className="stat-eyebrow">Giá ban đầu</span>
          <div className="stat-value" style={{ fontSize: 26 }}>{formatVND(w.initialPrice)}</div>
        </Card>
        <Card style={{ background: delta != null && delta < 0 ? 'var(--emerald-soft)' : 'var(--surface)' }}>
          <span className="stat-eyebrow">Giá hiện tại</span>
          <div className="stat-value row items-center gap-2" style={{ fontSize: 26 }}>
            {formatVND(w.currentPrice)}
            {delta != null && (
              <span className={delta < 0 ? 'delta-down' : 'delta-up'} style={{ fontSize: 14 }}>
                <Icon name={delta < 0 ? 'arrowDown' : 'arrowUp'} size={14}/>
                {Math.abs(delta).toFixed(1)}%
              </span>
            )}
          </div>
          <div className="stat-sub">cập nhật {relativeDays(w.priceHistory[w.priceHistory.length-1].date)}</div>
        </Card>
        <Card>
          <span className="stat-eyebrow">Min / Max đã ghi</span>
          <div className="stat-value" style={{ fontSize: 18 }}>
            <span style={{ color: 'var(--emerald)' }}>{formatVND(minP)}</span>
            <span className="muted" style={{ margin: '0 6px', fontWeight: 400 }}>/</span>
            <span style={{ color: 'var(--rose)' }}>{formatVND(maxP)}</span>
          </div>
        </Card>
        <Card>
          <span className="stat-eyebrow">Ngày dự kiến mua</span>
          <div className="stat-value row items-center gap-2" style={{ fontSize: 22 }}>
            <Icon name="calendar" size={20}/>
            {w.targetDate ? formatDateVN(w.targetDate) : 'Chưa đặt'}
          </div>
          {w.targetDate && <div className="stat-sub">{relativeDays(w.targetDate)}</div>}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16 }}>
        <div className="col gap-4">
          {/* Price history */}
          <Card>
            <h3 className="section-title"><Icon name="chart" size={18}/> Lịch sử giá <Badge>{w.priceHistory.length}</Badge></h3>
            {chartData.length > 1 && <UI.LineChart data={chartData} height={200} formatY={v => Math.round(v/1000) + 'k'} />}
            <div className="col" style={{ marginTop: 12 }}>
              {w.priceHistory.slice(-8).reverse().map((p, i) => (
                <div key={i} className="row items-center gap-3" style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1px dashed var(--border)' }}>
                  <span style={{ fontWeight: 600, fontSize: 13, minWidth: 110 }}>{formatDateVN(p.date)}</span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--muted)' }}>{p.note || '—'}</span>
                  <span className="tabular" style={{ fontWeight: 700 }}>{formatVND(p.price)}</span>
                </div>
              ))}
            </div>
          </Card>

          {w.note && (
            <Card>
              <h3 className="section-title"><Icon name="stickyNote" size={18}/> Ghi chú</h3>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{w.note}</div>
            </Card>
          )}

          <Card>
            <h3 className="section-title"><Icon name="zap" size={18}/> Đổi trạng thái nhanh</h3>
            <div className="row gap-2 flex-wrap">
              {Object.entries(window.WISH_STATUS_LABEL).map(([k, v]) => (
                <button
                  key={k}
                  className="btn btn-sm"
                  style={{
                    background: status === k ? `var(--${window.WISH_STATUS_TONE[k]}-soft)` : 'var(--surface-2)',
                    color: status === k ? `var(--${window.WISH_STATUS_TONE[k]}-ink)` : 'var(--ink-2)',
                    borderColor: status === k ? 'var(--border-strong)' : 'var(--border)',
                  }}
                  onClick={() => { setStatus(k); toast(`Đã đổi sang "${v}"`, 'success'); }}
                >{v}</button>
              ))}
            </div>
          </Card>
        </div>

        <div className="col gap-4">
          {w.buyUrl && (
            <Card>
              <h3 className="section-title"><Icon name="externalLink" size={18}/> Mua ở đâu</h3>
              <Button variant="primary" icon="externalLink" onClick={() => window.open(w.buyUrl, '_blank')} style={{ width: '100%' }}>Mở link mua</Button>
            </Card>
          )}

          <Card>
            <h3 className="section-title"><Icon name="info" size={18}/> Thông tin</h3>
            <div className="col">
              {w.reminderDays && <InfoRow icon="bell" label="Nhắc lại">Mỗi {w.reminderDays} ngày</InfoRow>}
              <InfoRow icon="tag" label="Loại">{cat.label}</InfoRow>
              <InfoRow icon="hash" label="ID"><span className="mono">{w.id}</span></InfoRow>
            </div>
          </Card>

          {w.imageUrl && (
            <Card>
              <img src={w.imageUrl} alt={w.name} referrerPolicy="no-referrer" style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 'var(--radius-sm)' }}/>
            </Card>
          )}
        </div>
      </div>

      <UpdatePriceDialog open={updateOpen} onClose={() => setUpdateOpen(false)} defaultPrice={w.currentPrice}/>
      <ConfirmDialog open={delOpen} onClose={() => setDelOpen(false)} title="Xoá món này?" body={`Sẽ xoá "${w.name}" và lịch sử giá.`} destructive confirmLabel="Xoá vĩnh viễn"
        onConfirm={() => { toast('Đã xoá', 'success'); navigate('/wishlist'); }}/>
    </>
  );
}

window.PAGES.WishlistDetail = WishlistDetail;
