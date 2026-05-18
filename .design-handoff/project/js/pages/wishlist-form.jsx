/* Wishlist form — stepper */
/* global React, UI, navigate, MOCK */
const { Button, Card, Stepper, Field, Input, Select, Textarea, MoneyInput, PageHeader, toast } = UI;
const { useState: useStateWF } = React;

const WISH_STEPS = ['Cơ bản', 'Giá & link', 'Mức & lịch', 'Ghi chú'];

function WishlistForm({ id, mode }) {
  const editing = mode === 'edit';
  const existing = editing ? MOCK.WISHLIST.find(w => w.id === id) : null;
  const [step, setStep] = useStateWF(0);
  const [d, setD] = useStateWF({
    name: existing?.name || '',
    brand: existing?.brand || '',
    category: existing?.category || 'phone',
    initialPrice: existing?.initialPrice || '',
    currentPrice: existing?.currentPrice || '',
    buyUrl: existing?.buyUrl || '',
    imageUrl: existing?.imageUrl || '',
    targetDate: existing?.targetDate || '',
    priority: existing?.priority || 'MEDIUM',
    status: existing?.status || 'WATCHING',
    reminderDays: existing?.reminderDays || 14,
    note: existing?.note || '',
  });
  const [errors, setErrors] = useStateWF({});
  const set = (k) => (v) => setD(x => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const validateStep = (s) => {
    const e = {};
    if (s === 0 && !d.name) e.name = 'Cần tên';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const submit = () => {
    if (!validateStep(0)) { setStep(0); return; }
    toast(editing ? 'Đã lưu món 👍' : 'Đã thêm món thèm 💜', 'success');
    navigate(editing ? `/wishlist/${id}` : '/wishlist');
  };

  return (
    <>
      <PageHeader
        back={editing ? { href: `#/wishlist/${id}`, label: 'Quay lại chi tiết' } : { href: '#/wishlist', label: 'Wishlist' }}
        title={editing ? 'Sửa món thèm' : 'Thêm món đang thèm'}
        sub={editing ? existing?.name : 'Note lại sản phẩm đang để ý — giá, link, ngày dự kiến mua, lý do.'}
      />

      <Card style={{ padding: 28 }}>
        <Stepper steps={WISH_STEPS} current={step} />
        <hr className="hr" style={{ marginTop: 22 }}/>

        {step === 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <Field label="Tên" required error={errors.name}><Input placeholder="e.g., Steam Deck OLED" value={d.name} onChange={set('name')} error={!!errors.name}/></Field>
            <Field label="Loại">
              <Select value={d.category} onChange={set('category')}>
                {[...MOCK.CATEGORIES, ...MOCK.SUB_CATEGORIES].map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Hãng"><Input placeholder="Valve, Apple..." value={d.brand} onChange={set('brand')}/></Field>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <Field label="Giá ban đầu"><MoneyInput value={d.initialPrice} onChange={set('initialPrice')}/></Field>
            <Field label="Giá hiện tại"><MoneyInput value={d.currentPrice} onChange={set('currentPrice')}/></Field>
            <Field label="URL mua"><Input placeholder="https://..." value={d.buyUrl} onChange={set('buyUrl')}/></Field>
            <Field label="URL ảnh"><Input placeholder="https://..." value={d.imageUrl} onChange={set('imageUrl')}/></Field>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <Field label="Ngày dự kiến mua"><Input type="date" value={d.targetDate} onChange={set('targetDate')}/></Field>
            <Field label="Mức độ thèm" required>
              <Select value={d.priority} onChange={set('priority')}>
                <option value="CRITICAL">Cực thèm (CRITICAL)</option>
                <option value="HIGH">Khá thèm (HIGH)</option>
                <option value="MEDIUM">Vừa thèm (MEDIUM)</option>
                <option value="LOW">Hơi thèm (LOW)</option>
              </Select>
            </Field>
            {editing && (
              <Field label="Trạng thái">
                <Select value={d.status} onChange={set('status')}>
                  <option value="WATCHING">Đang ngó</option>
                  <option value="DECIDED">Quyết mua</option>
                  <option value="PURCHASED">Đã mua</option>
                  <option value="SUBSCRIBED">Đã subscribe</option>
                  <option value="REFUNDED">Đã hoàn</option>
                  <option value="REJECTED">Bỏ qua</option>
                </Select>
              </Field>
            )}
            <Field label="Nhắc lại mỗi (ngày)"><Input type="number" value={d.reminderDays} onChange={set('reminderDays')}/></Field>
          </div>
        )}

        {step === 3 && (
          <Field label="Ghi chú"><Textarea placeholder="Lý do thèm, tham khảo, deal..." value={d.note} onChange={set('note')}/></Field>
        )}

        <hr className="hr" style={{ marginTop: 24 }}/>
        <div className="row items-center justify-between gap-3 flex-wrap">
          <div className="row gap-2">
            {step > 0 && <Button variant="ghost" icon="arrowLeft" onClick={() => setStep(s => s - 1)}>Quay lại</Button>}
          </div>
          <div className="row gap-2 items-center">
            <span className="muted" style={{ fontSize: 12 }}>{step + 1}/{WISH_STEPS.length}</span>
            {step < WISH_STEPS.length - 1
              ? <Button variant="primary" iconRight="arrowRight" onClick={() => { if (validateStep(step)) setStep(s => s + 1); }}>Tiếp theo</Button>
              : <Button variant="primary" icon="save" onClick={submit}>Lưu món</Button>}
          </div>
        </div>
      </Card>
    </>
  );
}

window.PAGES.WishlistForm = WishlistForm;
