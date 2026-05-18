/* Subscription form — stepper */
/* global React, UI, Icon, navigate, MOCK */
const { Button, Card, Stepper, Field, Input, Select, Textarea, MoneyInput, PageHeader, toast, Checkbox } = UI;
const { useState: useStateSF } = React;

const SUB_STEPS = ['Thông tin gói', 'Chu kỳ & giá', 'Tài khoản', 'Khác'];

function SubscriptionForm({ id, mode, query = {} }) {
  const editing = mode === 'edit';
  const existing = editing ? MOCK.SUBSCRIPTIONS.find(s => s.id === id) : null;
  const fromWishlistId = query.fromWishlist;
  const fromWishlist = fromWishlistId ? MOCK.WISHLIST.find(w => w.id === fromWishlistId) : null;

  const [step, setStep] = useStateSF(0);
  const [d, setD] = useStateSF({
    name: existing?.name || fromWishlist?.name || '',
    brand: existing?.brand || fromWishlist?.brand || '',
    plan: existing?.plan || '',
    category: existing?.category || 'streaming',
    cycle: existing?.cycle || 'MONTHLY',
    customDays: 30,
    price: existing?.price || fromWishlist?.currentPrice || '',
    start: existing?.start || '',
    nextRenewal: existing?.nextRenewal || '',
    autoRenew: existing?.autoRenew ?? true,
    status: existing?.status || 'ACTIVE',
    accountEmail: existing?.accountEmail || '',
    paymentMethod: existing?.paymentMethod || '',
    manageUrl: existing?.manageUrl || '',
    cancelUrl: existing?.cancelUrl || '',
    note: existing?.note || '',
  });
  const [errors, setErrors] = useStateSF({});
  const set = (k) => (v) => setD(x => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const validateStep = (s) => {
    const e = {};
    if (s === 0) {
      if (!d.name) e.name = 'Cần tên';
    }
    if (s === 1) {
      if (!d.price && d.price !== 0) e.price = 'Cần giá';
      if (!d.start) e.start = 'Cần ngày bắt đầu';
      if (!d.nextRenewal && d.cycle !== 'LIFETIME') e.nextRenewal = 'Cần ngày gia hạn tới';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goNext = () => { if (validateStep(step)) setStep(s => Math.min(s + 1, SUB_STEPS.length - 1)); };
  const goPrev = () => setStep(s => Math.max(s - 1, 0));
  const submit = () => {
    for (let i = 0; i < SUB_STEPS.length; i++) if (!validateStep(i)) { setStep(i); return; }
    toast(editing ? 'Đã lưu gói 👍' : 'Đã thêm gói 🎉', 'success');
    navigate(editing ? `/subscriptions/${id}` : '/subscriptions');
  };

  return (
    <>
      <PageHeader
        back={fromWishlist ? { href: `#/wishlist/${fromWishlist.id}`, label: 'Quay lại wishlist' } : editing ? { href: `#/subscriptions/${id}`, label: 'Quay lại chi tiết' } : { href: '#/subscriptions', label: 'Đăng ký' }}
        title={editing ? 'Sửa gói' : 'Thêm gói đăng ký'}
        sub={editing ? existing?.name : 'Apple One, ChatGPT Plus, hosting, domain, streaming...'}
      />

      {fromWishlist && (
        <div className="banner banner-rose" style={{ marginBottom: 16 }}>
          <Icon name="heart" size={16}/> Tạo từ wishlist: <b>{fromWishlist.name}</b>
        </div>
      )}

      <Card style={{ padding: 28 }}>
        <Stepper steps={SUB_STEPS} current={step} />
        <hr className="hr" style={{ marginTop: 22 }}/>

        {step === 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <Field label="Tên" required error={errors.name}><Input placeholder="e.g., Apple One Family" value={d.name} onChange={set('name')} error={!!errors.name}/></Field>
            <Field label="Loại">
              <Select value={d.category} onChange={set('category')}>
                {MOCK.SUB_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Hãng"><Input placeholder="Apple, Spotify..." value={d.brand} onChange={set('brand')}/></Field>
            <Field label="Plan"><Input placeholder="Family, Premium 4K..." value={d.plan} onChange={set('plan')}/></Field>
          </div>
        )}

        {step === 1 && (
          <div className="col gap-3">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <Field label="Chu kỳ thanh toán" required>
                <Select value={d.cycle} onChange={set('cycle')}>
                  {Object.entries(window.CYCLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              {d.cycle === 'CUSTOM' && (
                <Field label="Số ngày / kỳ" required>
                  <Input type="number" value={d.customDays} onChange={set('customDays')}/>
                </Field>
              )}
              <Field label="Giá" required error={errors.price}><MoneyInput value={d.price} onChange={set('price')} error={!!errors.price}/></Field>
              <Field label="Ngày bắt đầu" required error={errors.start}><Input type="date" value={d.start} onChange={set('start')} error={!!errors.start}/></Field>
              {d.cycle !== 'LIFETIME' && (
                <Field label="Ngày gia hạn tới" required error={errors.nextRenewal} hint="Auto theo cycle">
                  <Input type="date" value={d.nextRenewal} onChange={set('nextRenewal')} error={!!errors.nextRenewal}/>
                </Field>
              )}
            </div>
            <Checkbox checked={d.autoRenew} onChange={set('autoRenew')} label="Tự gia hạn"/>
            {editing && (
              <Field label="Trạng thái">
                <Select value={d.status} onChange={set('status')}>
                  <option value="ACTIVE">Đang dùng</option>
                  <option value="PAUSED">Tạm dừng</option>
                  <option value="CANCELLED">Đã huỷ</option>
                  <option value="EXPIRED">Hết hạn</option>
                </Select>
              </Field>
            )}
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <Field label="Email tài khoản"><Input type="email" placeholder="ban@example.com" value={d.accountEmail} onChange={set('accountEmail')}/></Field>
            <Field label="Phương thức thanh toán"><Input placeholder="Visa **4242" value={d.paymentMethod} onChange={set('paymentMethod')}/></Field>
            <Field label="URL quản lý"><Input placeholder="https://..." value={d.manageUrl} onChange={set('manageUrl')}/></Field>
            <Field label="URL huỷ"><Input placeholder="https://..." value={d.cancelUrl} onChange={set('cancelUrl')}/></Field>
          </div>
        )}

        {step === 3 && (
          <Field label="Ghi chú">
            <Textarea placeholder="Note thêm..." value={d.note} onChange={set('note')}/>
          </Field>
        )}

        <hr className="hr" style={{ marginTop: 24 }}/>
        <div className="row items-center justify-between gap-3 flex-wrap">
          <div className="row gap-2">
            {step > 0 && <Button variant="ghost" icon="arrowLeft" onClick={goPrev}>Quay lại</Button>}
          </div>
          <div className="row gap-2 items-center">
            <span className="muted" style={{ fontSize: 12 }}>{step + 1}/{SUB_STEPS.length}</span>
            {step < SUB_STEPS.length - 1
              ? <Button variant="primary" iconRight="arrowRight" onClick={goNext}>Tiếp theo</Button>
              : <Button variant="primary" icon="save" onClick={submit}>Lưu gói</Button>}
          </div>
        </div>
      </Card>
    </>
  );
}

window.PAGES.SubscriptionForm = SubscriptionForm;
