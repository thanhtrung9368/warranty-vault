/* Device detail page */
/* global React, UI, Icon, Link, navigate, MOCK, formatVND, formatDateVN, warrantyDaysLeft, warrantyEnd */
const { Button, Card, Badge, IconBadge, WarrantyPill, InfoRow, PageHeader, Modal, ConfirmDialog, toast,
        Field, Input, Select, Textarea, MoneyInput } = UI;
const { useState: useStateDD } = React;

const WARRANTY_TYPE_LABEL = { STANDARD: 'Bảo hành chính hãng', EXTENDED: 'BH mở rộng', THIRD_PARTY: 'BH bên thứ 3' };
const WARRANTY_TYPE_TONE  = { STANDARD: 'primary', EXTENDED: 'violet', THIRD_PARTY: 'sky' };

function WarrantyCard({ w, deviceStart, onEdit, onDelete }) {
  const dl = warrantyDaysLeft(w);
  const end = warrantyEnd(w);
  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <div className="row items-center justify-between gap-3" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="row items-center gap-2">
          <Badge tone={WARRANTY_TYPE_TONE[w.type]} size="lg">{WARRANTY_TYPE_LABEL[w.type] || w.type}</Badge>
          {w.provider && <span style={{ fontWeight: 600, fontSize: 14 }}>{w.provider}</span>}
        </div>
        <div className="row items-center gap-2">
          <WarrantyPill daysLeft={dl} />
          <Button variant="ghost" size="icon-sm" onClick={onEdit} title="Sửa"><Icon name="edit" size={14}/></Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete} title="Xoá"><Icon name="trash" size={14}/></Button>
        </div>
      </div>
      <UI.WarrantyTimeline start={w.start} end={end} today={MOCK.today} />
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
        {w.months} tháng • {formatDateVN(w.start)} → {formatDateVN(end)}
      </div>
      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
        {w.price > 0 && <InfoRow icon="wallet" label="Giá gói">{formatVND(w.price)}</InfoRow>}
        {w.phone && <InfoRow icon="phone" label="SĐT" link={`tel:${w.phone}`}>{w.phone}</InfoRow>}
        {w.address && <InfoRow icon="mapPin" label="Địa chỉ" link={`https://maps.google.com/?q=${encodeURIComponent(w.address)}`}>{w.address}</InfoRow>}
        {w.note && <InfoRow icon="stickyNote" label="Ghi chú">{w.note}</InfoRow>}
      </div>
    </div>
  );
}

function WarrantyForm({ initial, deviceStart, onSave, onCancel }) {
  const [data, setData] = useStateDD(initial || { type: 'STANDARD', provider: '', start: deviceStart, months: 12, price: 0, address: '', phone: '', note: '' });
  return (
    <div className="card" style={{ background: 'var(--primary-soft)', border: '1.5px solid var(--primary)' }}>
      <h4 className="section-title" style={{ marginBottom: 14 }}>{initial ? 'Sửa gói bảo hành' : 'Thêm gói bảo hành'}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Field label="Loại" required>
          <Select value={data.type} onChange={e => setData({...data, type: e.target.value })}>
            <option value="STANDARD">Bảo hành chính hãng</option>
            <option value="EXTENDED">BH mở rộng</option>
            <option value="THIRD_PARTY">BH bên thứ 3</option>
          </Select>
        </Field>
        <Field label="Nhà cung cấp"><Input value={data.provider} onChange={e => setData({...data, provider: e.target.value})}/></Field>
        <Field label="Ngày bắt đầu" required><Input type="date" value={data.start} onChange={e => setData({...data, start: e.target.value})}/></Field>
        <Field label="Số tháng" required><Input type="number" value={data.months} onChange={e => setData({...data, months: Number(e.target.value)})}/></Field>
        <Field label="Giá gói"><MoneyInput value={data.price} onChange={v => setData({...data, price: v})}/></Field>
        <Field label="SĐT"><Input type="tel" value={data.phone} onChange={e => setData({...data, phone: e.target.value})}/></Field>
        <Field label="Địa chỉ" hint="Sẽ link sang Google Maps"><Input value={data.address} onChange={e => setData({...data, address: e.target.value})}/></Field>
        <Field label="Ghi chú"><Input value={data.note} onChange={e => setData({...data, note: e.target.value})}/></Field>
      </div>
      <div className="row gap-2 justify-end" style={{ marginTop: 14 }}>
        <Button variant="ghost" onClick={onCancel}>Huỷ</Button>
        <Button variant="primary" icon="save" onClick={() => onSave(data)}>Lưu gói bảo hành</Button>
      </div>
    </div>
  );
}

function AttachmentUploader({ count, max = 5 }) {
  const [active, setActive] = useStateDD(false);
  const [files, setFiles] = useStateDD([]);
  const [desc, setDesc] = useStateDD('');
  const remaining = max - count - files.length;
  const onPick = (newFiles) => {
    const valid = [];
    Array.from(newFiles).forEach(f => {
      if (f.size > 5 * 1024 * 1024) { toast(`${f.name} vượt quá 5MB`, 'error'); return; }
      if (!/^image\/|^application\/pdf$/.test(f.type)) { toast(`${f.name}: chỉ chấp nhận ảnh hoặc PDF`, 'error'); return; }
      valid.push({ name: f.name, size: f.size });
    });
    setFiles([...files, ...valid].slice(0, remaining));
  };
  if (count >= max) {
    return <div className="banner banner-amber"><Icon name="alert" size={16}/><div>Đã đạt tối đa {max} file cho thiết bị này. Xóa file cũ để tải file mới.</div></div>;
  }
  return (
    <div className="col gap-3">
      <label
        className="dropzone"
        data-active={active}
        onDragOver={e => { e.preventDefault(); setActive(true); }}
        onDragLeave={() => setActive(false)}
        onDrop={e => { e.preventDefault(); setActive(false); onPick(e.dataTransfer.files); }}
      >
        <Icon name="upload" size={28} style={{ color: 'var(--primary)' }}/>
        <div style={{ marginTop: 8, fontWeight: 600 }}>Kéo thả hoặc bấm để chọn file</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Ảnh hoặc PDF, tối đa 5MB. Còn lại: {remaining} file.</div>
        <input type="file" multiple accept="image/*,application/pdf" style={{ display: 'none' }} onChange={e => onPick(e.target.files)}/>
      </label>
      {files.length > 0 && (
        <div className="col gap-2">
          {files.map((f, i) => (
            <div key={i} className="row items-center gap-3" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 'var(--radius-sm)' }}>
              <Icon name="paperclip" size={14} style={{ color: 'var(--muted)' }}/>
              <span style={{ flex: 1, fontSize: 13 }}>{f.name}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{(f.size / 1024).toFixed(0)} KB</span>
              <Button variant="ghost" size="icon-sm" onClick={() => setFiles(files.filter((_, idx) => idx !== i))}><Icon name="x" size={14}/></Button>
            </div>
          ))}
          <Input placeholder="Mô tả chung (vd: Hóa đơn VAT, Phiếu bảo hành)" value={desc} onChange={e => setDesc(e.target.value)} />
          <Button variant="primary" icon="upload" onClick={() => { toast(`Đã tải lên ${files.length} file 🎉`, 'success'); setFiles([]); setDesc(''); }}>Tải lên {files.length} file</Button>
        </div>
      )}
    </div>
  );
}

function DeviceDetail({ id }) {
  const { DEVICES, catById } = MOCK;
  const device = DEVICES.find(d => d.id === id);
  const [editingIdx, setEditingIdx] = useStateDD(-1);
  const [adding, setAdding] = useStateDD(false);
  const [confirmDelete, setConfirmDelete] = useStateDD(false);

  if (!device) return (
    <Card><UI.EmptyState icon="alert" title="Không tìm thấy thiết bị" description="Có thể đã bị xoá." action={<Button variant="primary" onClick={() => navigate('/devices')}>Về danh sách</Button>}/></Card>
  );

  const cat = catById(device.category);
  const maxEnd = device.warranties.length > 0
    ? device.warranties.reduce((m, w) => warrantyEnd(w) > m ? warrantyEnd(w) : m, device.warranties[0] ? warrantyEnd(device.warranties[0]) : '')
    : null;

  return (
    <>
      <PageHeader
        back={{ href: '#/devices', label: 'Danh sách thiết bị' }}
        title={
          <span className="row items-center gap-3">
            <IconBadge icon={cat.icon} tone={cat.tint} size="lg" />
            <span>{device.name}</span>
            <Badge tone={window.DEV_STATUS_TONE[device.status]}>{window.DEV_STATUS_LABEL[device.status]}</Badge>
          </span>
        }
        sub={`${cat.label} • ${device.brand}${device.model ? ' • ' + device.model : ''}`}
        actions={
          <>
            <Button icon="edit" onClick={() => navigate(`/devices/${device.id}/edit`)}>Sửa</Button>
            <Button variant="destructive-outline" icon="trash" onClick={() => setConfirmDelete(true)}>Xoá</Button>
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16 }}>
        <div className="col gap-4">
          {/* Mua hàng */}
          <Card>
            <h3 className="section-title"><Icon name="shoppingBag" size={18} style={{ color: 'var(--primary)' }}/> Mua hàng</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 20px' }}>
              <InfoRow icon="calendar" label="Ngày mua">{formatDateVN(device.purchaseDate)}</InfoRow>
              <InfoRow icon="wallet" label="Giá mua">{formatVND(device.price)}</InfoRow>
              <InfoRow icon="store" label="Nơi mua">{device.store || '—'}</InfoRow>
              <InfoRow icon="hash" label="Serial / IMEI">{device.serial || '—'}</InfoRow>
              <InfoRow icon="tag" label="Loại">{cat.label}</InfoRow>
            </div>
          </Card>

          {/* Tổng quan bảo hành */}
          <Card>
            <div className="row items-center justify-between">
              <h3 className="section-title" style={{ margin: 0 }}><Icon name="shieldCheck" size={18} style={{ color: 'var(--emerald)' }}/> Tổng quan bảo hành</h3>
              {device.warranties.length > 0 && (
                <WarrantyPill daysLeft={Math.max(...device.warranties.map(warrantyDaysLeft))}/>
              )}
            </div>
            <p style={{ marginTop: 14, color: 'var(--ink-2)' }}>
              {device.warranties.length > 0
                ? <>Có <b>{device.warranties.length}</b> gói bảo hành. Gói xa nhất hết <b>{formatDateVN(maxEnd)}</b>.</>
                : 'Thiết bị chưa có gói bảo hành nào.'}
            </p>
            {device.warranties.length > 0 && (
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>Quản lý chi tiết từng gói ở mục bên dưới.</p>
            )}
          </Card>

          {/* Gói bảo hành */}
          <Card>
            <h3 className="section-title">
              <Icon name="shield" size={18} style={{ color: 'var(--primary)' }}/>
              Gói bảo hành <span className="muted" style={{ fontWeight: 500 }}>({device.warranties.length}/5)</span>
            </h3>
            <div className="col gap-3">
              {device.warranties.map((w, i) => editingIdx === i ? (
                <WarrantyForm key={i} initial={w} onSave={() => { toast('Đã lưu gói bảo hành 👍', 'success'); setEditingIdx(-1); }} onCancel={() => setEditingIdx(-1)} />
              ) : (
                <WarrantyCard
                  key={i}
                  w={w}
                  deviceStart={device.purchaseDate}
                  onEdit={() => setEditingIdx(i)}
                  onDelete={() => { if (confirm('Xoá gói bảo hành này?')) toast('Đã xoá gói', 'success'); }}
                />
              ))}
              {device.warranties.length < 5 && (
                adding
                  ? <WarrantyForm deviceStart={device.purchaseDate} onSave={() => { toast('Đã thêm gói bảo hành 🎉', 'success'); setAdding(false); }} onCancel={() => setAdding(false)} />
                  : <Button variant="outline" icon="plus" onClick={() => setAdding(true)}>Thêm gói bảo hành</Button>
              )}
            </div>
          </Card>

          {/* Ghi chú */}
          {device.note && (
            <Card>
              <h3 className="section-title"><Icon name="stickyNote" size={18}/> Ghi chú</h3>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)', lineHeight: 1.6 }}>{device.note}</div>
            </Card>
          )}
        </div>

        {/* File đính kèm */}
        <div className="col gap-4">
          <Card>
            <h3 className="section-title"><Icon name="paperclip" size={18}/> File đính kèm <span className="muted" style={{ fontWeight: 500 }}>({device.attachments}/5)</span></h3>
            {device.attachments > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, marginBottom: 14 }}>
                {Array.from({ length: device.attachments }).map((_, i) => (
                  <div key={i} className="img-placeholder" style={{ aspectRatio: '1/1', position: 'relative', fontSize: 11 }}>
                    <Icon name={i % 2 === 0 ? 'receipt' : 'paperclip'} size={28}/>
                  </div>
                ))}
              </div>
            )}
            <AttachmentUploader count={device.attachments} />
          </Card>

          {/* Quick stats card */}
          <Card style={{ background: 'var(--surface-2)' }}>
            <h3 className="section-title"><Icon name="info" size={18}/> Thông tin nhanh</h3>
            <div className="col gap-2" style={{ fontSize: 13 }}>
              <div className="row justify-between"><span className="muted">ID</span><span className="mono">{device.id}</span></div>
              <div className="row justify-between"><span className="muted">Số gói BH</span><span style={{ fontWeight: 600 }}>{device.warranties.length}</span></div>
              <div className="row justify-between"><span className="muted">File đính kèm</span><span style={{ fontWeight: 600 }}>{device.attachments}/5</span></div>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => { toast('Đã xoá thiết bị', 'success'); navigate('/devices'); }}
        title="Xoá thiết bị?"
        body={`Sẽ xoá "${device.name}" và toàn bộ gói bảo hành, file đính kèm. Không thể hoàn tác.`}
        confirmLabel="Xoá vĩnh viễn"
        destructive
      />
    </>
  );
}

window.PAGES.DeviceDetail = DeviceDetail;
window.WARRANTY_TYPE_LABEL = WARRANTY_TYPE_LABEL;
window.WARRANTY_TYPE_TONE = WARRANTY_TYPE_TONE;
