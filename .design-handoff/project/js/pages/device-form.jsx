/* Device form — stepper layout */
/* global React, UI, Icon, Link, navigate, MOCK */
const { Button, Card, IconBadge, Stepper, Field, Input, Select, Textarea, MoneyInput, PageHeader, toast } = UI;
const { useState: useStateDF } = React;

const DEVICE_STEPS = ['Thông tin chung', 'Mua hàng', 'Bảo hành mặc định', 'Khác'];

function DeviceForm({ id, mode, query = {} }) {
  const editing = mode === 'edit';
  const existing = editing ? MOCK.DEVICES.find(d => d.id === id) : null;
  const fromWishlistId = query.fromWishlist;
  const fromWishlist = fromWishlistId ? MOCK.WISHLIST.find(w => w.id === fromWishlistId) : null;

  const [step, setStep] = useStateDF(0);
  const [data, setData] = useStateDF({
    name: existing?.name || fromWishlist?.name || '',
    category: existing?.category || fromWishlist?.category || 'phone',
    brand: existing?.brand || fromWishlist?.brand || '',
    model: existing?.model || '',
    serial: existing?.serial || '',
    purchaseDate: existing?.purchaseDate || '',
    price: existing?.price || fromWishlist?.currentPrice || '',
    store: existing?.store || '',
    warrantyMonths: 12,
    warrantyProvider: '',
    warrantyAddress: '',
    warrantyPhone: '',
    status: existing?.status || 'ACTIVE',
    note: existing?.note || '',
  });
  const [errors, setErrors] = useStateDF({});

  const set = (k) => (v) => setData(d => ({ ...d, [k]: v?.target ? v.target.value : v }));

  const validateStep = (s) => {
    const e = {};
    if (s === 0) {
      if (!data.name) e.name = 'Tên không được trống';
      if (!data.category) e.category = 'Chọn loại';
    }
    if (s === 1) {
      if (!data.purchaseDate) e.purchaseDate = 'Cần ngày mua';
      if (!data.price && data.price !== 0) e.price = 'Cần giá mua';
    }
    if (s === 2) {
      if (!data.warrantyMonths || data.warrantyMonths <= 0) e.warrantyMonths = 'Số tháng > 0';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goNext = () => { if (validateStep(step)) setStep(s => Math.min(s + 1, DEVICE_STEPS.length - 1)); };
  const goPrev = () => setStep(s => Math.max(s - 1, 0));
  const submit = () => {
    if (!validateStep(step)) return;
    // Run all validations
    for (let i = 0; i < DEVICE_STEPS.length; i++) {
      if (!validateStep(i)) { setStep(i); return; }
    }
    toast(editing ? 'Đã lưu thiết bị 👍' : 'Đã thêm thiết bị 🎉', 'success');
    navigate(editing ? `/devices/${id}` : '/devices');
  };

  return (
    <>
      <PageHeader
        back={fromWishlist ? { href: `#/wishlist/${fromWishlist.id}`, label: 'Quay lại wishlist' } : editing ? { href: `#/devices/${id}`, label: 'Quay lại chi tiết' } : { href: '#/devices', label: 'Danh sách thiết bị' }}
        title={editing ? 'Sửa thiết bị' : 'Thêm thiết bị'}
        sub={editing ? existing?.name : 'Nhập thông tin thiết bị, bảo hành và mua hàng.'}
      />

      {fromWishlist && (
        <div className="banner banner-rose" style={{ marginBottom: 16 }}>
          <Icon name="heart" size={16}/>
          <div>Tạo từ wishlist: <b>{fromWishlist.name}</b></div>
        </div>
      )}

      <Card style={{ padding: 28 }}>
        <Stepper steps={DEVICE_STEPS} current={step} />
        <hr className="hr" style={{ marginTop: 22 }}/>

        {step === 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <Field label="Tên thiết bị" required error={errors.name} className="span-2">
              <Input placeholder="e.g., MacBook Pro M3" value={data.name} onChange={set('name')} error={!!errors.name}/>
            </Field>
            <Field label="Loại thiết bị" required error={errors.category}>
              <Select value={data.category} onChange={set('category')}>
                {MOCK.CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Hãng"><Input placeholder="Apple, Samsung..." value={data.brand} onChange={set('brand')}/></Field>
            <Field label="Model"><Input placeholder="e.g., 16-inch" value={data.model} onChange={set('model')}/></Field>
            <Field label="Serial / IMEI"><Input placeholder="e.g., ABC123XYZ789" value={data.serial} onChange={set('serial')}/></Field>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <Field label="Ngày mua" required error={errors.purchaseDate}>
              <Input type="date" value={data.purchaseDate} onChange={set('purchaseDate')} error={!!errors.purchaseDate}/>
            </Field>
            <Field label="Giá mua" required error={errors.price}>
              <MoneyInput value={data.price} onChange={set('price')} error={!!errors.price}/>
            </Field>
            <Field label="Nơi mua" hint="Cửa hàng, sàn TMĐT...">
              <Input placeholder="Apple Store, CellphoneS..." value={data.store} onChange={set('store')}/>
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="col gap-3">
            <p className="muted" style={{ marginTop: 0 }}>Đây là gói BH mặc định khi tạo thiết bị. Mày có thể thêm nhiều gói khác ở chi tiết sau.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <Field label="Số tháng bảo hành" required error={errors.warrantyMonths}>
                <Input type="number" value={data.warrantyMonths} onChange={set('warrantyMonths')} error={!!errors.warrantyMonths}/>
              </Field>
              <Field label="Nhà cung cấp" hint="Hãng hoặc cửa hàng">
                <Input placeholder="Apple Việt Nam..." value={data.warrantyProvider} onChange={set('warrantyProvider')}/>
              </Field>
              <Field label="Địa chỉ trung tâm BH" hint="Sẽ link sang Google Maps">
                <Input placeholder="Quận 1, TP.HCM" value={data.warrantyAddress} onChange={set('warrantyAddress')}/>
              </Field>
              <Field label="SĐT trung tâm BH">
                <Input type="tel" placeholder="0912345678" value={data.warrantyPhone} onChange={set('warrantyPhone')}/>
              </Field>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="col gap-3">
            {editing && (
              <Field label="Trạng thái">
                <Select value={data.status} onChange={set('status')}>
                  <option value="ACTIVE">Đang dùng</option>
                  <option value="INACTIVE">Ngừng dùng</option>
                  <option value="ARCHIVED">Đã lưu trữ</option>
                </Select>
              </Field>
            )}
            <Field label="Ghi chú">
              <Textarea placeholder="Ghi chú thêm về thiết bị..." value={data.note} onChange={set('note')}/>
            </Field>
          </div>
        )}

        <hr className="hr" style={{ marginTop: 24 }}/>
        <div className="row items-center justify-between gap-3 flex-wrap">
          <div className="row gap-2">
            {step > 0 && <Button variant="ghost" icon="arrowLeft" onClick={goPrev}>Quay lại</Button>}
            <Button variant="ghost" icon="rotateCcw" onClick={() => { setData({ name:'',category:'phone',brand:'',model:'',serial:'',purchaseDate:'',price:'',store:'',warrantyMonths:12,warrantyProvider:'',warrantyAddress:'',warrantyPhone:'',status:'ACTIVE',note:''}); setStep(0); }}>Đặt lại</Button>
          </div>
          <div className="row gap-2 items-center">
            <span className="muted" style={{ fontSize: 12 }}>{step + 1}/{DEVICE_STEPS.length}</span>
            {step < DEVICE_STEPS.length - 1 ? (
              <Button variant="primary" iconRight="arrowRight" onClick={goNext}>Tiếp theo</Button>
            ) : (
              <Button variant="primary" icon="save" onClick={submit}>Lưu thiết bị</Button>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}

window.PAGES.DeviceForm = DeviceForm;
