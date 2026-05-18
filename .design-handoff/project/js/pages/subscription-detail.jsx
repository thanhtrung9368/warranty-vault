/* Subscription detail */
/* global React, UI, Icon, Link, navigate, MOCK, formatVND, formatDateVN, daysBetween, monthlyEquivalent, relativeDays */
const { Button, Card, Badge, IconBadge, InfoRow, PageHeader, Modal, ConfirmDialog, PillGroup, Field, Input, MoneyInput, Textarea, toast } = UI;
const { useState: useStateSD } = React;

function LogPaymentDialog({ open, onClose, defaultAmount }) {
  const [amount, setAmount] = useStateSD(defaultAmount || 0);
  const [date, setDate] = useStateSD(MOCK.today.toISOString().slice(0, 10));
  const [note, setNote] = useStateSD('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log một lần thanh toán"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button variant="primary" icon="save" onClick={() => { toast('Đã log payment 💸', 'success'); onClose(); }}>Log</Button>
        </>
      }
    >
      <div className="col gap-3">
        <Field label="Số tiền" required><MoneyInput value={amount} onChange={setAmount}/></Field>
        <Field label="Ngày trả" required><Input type="date" value={date} onChange={e => setDate(e.target.value)}/></Field>
        <Field label="Ghi chú"><Input placeholder="vd: Thanh toán tháng 1/2024" value={note} onChange={e => setNote(e.target.value)}/></Field>
      </div>
    </Modal>
  );
}

function SubscriptionDetail({ id }) {
  const sub = MOCK.SUBSCRIPTIONS.find(s => s.id === id);
  const cat = MOCK.catById(sub?.category);
  const [logOpen, setLogOpen] = useStateSD(false);
  const [delOpen, setDelOpen] = useStateSD(false);
  const [status, setStatus] = useStateSD(sub?.status);

  if (!sub) return <Card><UI.EmptyState icon="alert" title="Không tìm thấy gói" /></Card>;

  const days = daysBetween(MOCK.today, new Date(sub.nextRenewal));
  const overdue = days < 0;
  const totalPaid = sub.payments.reduce((s, p) => s + p.amount, 0);

  // Build chart data
  const chartData = sub.payments.slice().reverse().map(p => ({ date: formatDateVN(p.date).slice(0,5), value: p.amount }));

  return (
    <>
      <PageHeader
        back={{ href: '#/subscriptions', label: 'Đăng ký' }}
        title={
          <span className="row items-center gap-3">
            <IconBadge icon={cat.icon} tone={cat.tint} size="lg"/>
            <span>{sub.name}</span>
            <Badge tone={window.SUB_STATUS_TONE[status]}>{window.SUB_STATUS_LABEL[status]}</Badge>
          </span>
        }
        sub={`${sub.brand}${sub.plan ? ' • ' + sub.plan : ''} • ${cat.label}`}
        actions={
          <>
            <Button icon="edit" onClick={() => navigate(`/subscriptions/${sub.id}/edit`)}>Sửa</Button>
            <Button icon="wallet" onClick={() => setLogOpen(true)}>Log payment</Button>
            {sub.cycle !== 'LIFETIME' && <Button variant="primary" icon="refresh" onClick={() => toast('Đã renew gói 🔁', 'success')}>Renew Now</Button>}
            <Button variant="destructive-outline" icon="trash" onClick={() => setDelOpen(true)}>Xoá</Button>
          </>
        }
      />

      {overdue && (
        <div className="banner banner-amber" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={18}/>
          <div>Đã quá hạn <b>{Math.abs(days)}</b> ngày — cron sẽ tự log payment kỳ này.</div>
        </div>
      )}

      {/* 4 metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 18 }}>
        <Card>
          <span className="stat-eyebrow">Giá / chu kỳ</span>
          <div className="stat-value" style={{ fontSize: 26 }}>{formatVND(sub.price)}</div>
          <div className="stat-sub">{window.CYCLE_LABEL[sub.cycle]}</div>
        </Card>
        <Card>
          <span className="stat-eyebrow">Quy đổi / tháng</span>
          <div className="stat-value" style={{ fontSize: 26 }}>{sub.cycle === 'LIFETIME' ? '—' : formatVND(Math.round(monthlyEquivalent(sub)))}</div>
        </Card>
        <Card style={{ background: overdue ? 'var(--amber-soft)' : 'var(--surface)' }}>
          <span className="stat-eyebrow">Gia hạn tới</span>
          <div className="stat-value row items-center gap-2" style={{ fontSize: 22, color: overdue ? 'var(--amber-ink)' : 'var(--ink)' }}>
            <Icon name="calendar" size={20}/>
            {sub.cycle === 'LIFETIME' ? 'Lifetime' : formatDateVN(sub.nextRenewal)}
          </div>
          <div className="stat-sub" style={{ color: overdue ? 'var(--destructive)' : 'var(--muted)', fontWeight: overdue ? 600 : 400 }}>
            {sub.cycle === 'LIFETIME' ? '' : overdue ? `Quá hạn ${Math.abs(days)} ngày` : `${days} ngày nữa`}
          </div>
        </Card>
        <Card>
          <span className="stat-eyebrow">Đã chi tổng</span>
          <div className="stat-value" style={{ fontSize: 26 }}>{formatVND(totalPaid)}</div>
          <div className="stat-sub">{sub.payments.length} kỳ</div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16 }}>
        <div className="col gap-4">
          {/* Payment history */}
          <Card>
            <div className="row items-center justify-between" style={{ marginBottom: 12 }}>
              <h3 className="section-title" style={{ margin: 0 }}><Icon name="wallet" size={18}/> Lịch sử thanh toán <Badge>{sub.payments.length}</Badge></h3>
            </div>
            {chartData.length > 1 && (
              <div style={{ marginBottom: 12 }}>
                <UI.LineChart data={chartData} height={180} formatY={v => Math.round(v/1000) + 'k'} />
              </div>
            )}
            <div className="col">
              {sub.payments.slice(0, 12).map((p, i) => (
                <div key={i} className="row items-center gap-3" style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1px dashed var(--border)' }}>
                  <span style={{ minWidth: 90 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{formatDateVN(p.date)}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{relativeDays(p.date)}</div>
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--muted)' }}>{p.note || '—'}</span>
                  <span className="tabular" style={{ fontWeight: 700 }}>{formatVND(p.amount)}</span>
                </div>
              ))}
            </div>
          </Card>

          {sub.note && (
            <Card>
              <h3 className="section-title"><Icon name="stickyNote" size={18}/> Ghi chú</h3>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{sub.note}</div>
            </Card>
          )}

          <Card>
            <h3 className="section-title"><Icon name="zap" size={18}/> Đổi trạng thái nhanh</h3>
            <PillGroup
              value={status}
              onChange={(v) => { setStatus(v); toast(`Đã đổi sang ${window.SUB_STATUS_LABEL[v]}`, 'success'); }}
              options={[
                { value: 'ACTIVE', label: 'Đang dùng' },
                { value: 'PAUSED', label: 'Tạm dừng' },
                { value: 'CANCELLED', label: 'Đã huỷ' },
              ]}
            />
          </Card>
        </div>

        <div className="col gap-4">
          {(sub.manageUrl || sub.cancelUrl) && (
            <Card>
              <h3 className="section-title"><Icon name="externalLink" size={18}/> Liên kết</h3>
              <div className="col gap-2">
                {sub.manageUrl && <Button icon="externalLink" onClick={() => window.open(sub.manageUrl, '_blank')}>Quản lý gói</Button>}
                {sub.cancelUrl && <Button variant="destructive-outline" icon="externalLink" onClick={() => window.open(sub.cancelUrl, '_blank')}>Huỷ gói</Button>}
              </div>
            </Card>
          )}

          <Card>
            <h3 className="section-title"><Icon name="user" size={18}/> Tài khoản</h3>
            <div className="col">
              {sub.accountEmail && <InfoRow icon="mail" label="Email">{sub.accountEmail}</InfoRow>}
              {sub.paymentMethod && <InfoRow icon="creditCard" label="Thanh toán">{sub.paymentMethod}</InfoRow>}
              <InfoRow icon="refresh" label="Tự gia hạn">{sub.autoRenew ? '✓ Bật' : '— Tắt'}</InfoRow>
              <InfoRow icon="calendar" label="Bắt đầu từ">{formatDateVN(sub.start)}</InfoRow>
            </div>
          </Card>
        </div>
      </div>

      <LogPaymentDialog open={logOpen} onClose={() => setLogOpen(false)} defaultAmount={sub.price}/>
      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        onConfirm={() => { toast('Đã xoá gói', 'success'); navigate('/subscriptions'); }}
        title="Xoá gói đăng ký?"
        body={`Sẽ xoá "${sub.name}" và lịch sử thanh toán.`}
        destructive
        confirmLabel="Xoá vĩnh viễn"
      />
    </>
  );
}

window.PAGES.SubscriptionDetail = SubscriptionDetail;
