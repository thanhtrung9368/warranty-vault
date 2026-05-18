/* Settings */
/* global React, UI, Icon, navigate, useAuth, MOCK */
const { Button, Card, Badge, IconBadge, Field, Input, PageHeader, PillGroup, toast } = UI;
const { useState: useStateSt } = React;

function PushSection() {
  const [state, setState] = useStateSt('unsubscribed'); // 'unsupported','blocked','subscribed','unsubscribed'

  if (state === 'unsupported') {
    return (
      <div className="banner banner-amber">
        <Icon name="alert" size={18}/>
        <div>Trình duyệt này chưa hỗ trợ push notification. Thử Chrome, Edge, Firefox hoặc Safari phiên bản mới.</div>
      </div>
    );
  }
  if (state === 'blocked') {
    return (
      <div className="banner banner-destructive">
        <Icon name="bellOff" size={18}/>
        <div>Bạn đã chặn thông báo từ site này. Mở cài đặt trình duyệt → quyền thông báo → cho phép rồi tải lại trang.</div>
      </div>
    );
  }
  if (state === 'subscribed') {
    return (
      <div className="col gap-3">
        <div className="banner banner-emerald">
          <Icon name="checkCircle" size={18}/>
          <div>✓ Thiết bị này đã bật thông báo</div>
        </div>
        <div className="row gap-2 flex-wrap">
          <Button icon="send" onClick={() => toast('Đã gửi thông báo thử 🔔', 'success')}>Gửi thử</Button>
          <Button variant="destructive-outline" icon="bellOff" onClick={() => setState('unsubscribed')}>Tắt</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="col gap-3">
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Nhận thông báo khi thiết bị sắp hết bảo hành, ngay cả khi không mở web.
      </p>
      <Button variant="primary" icon="bell" onClick={() => { setState('subscribed'); toast('Đã bật thông báo', 'success'); }}>Bật thông báo</Button>
      <div className="row gap-2 flex-wrap" style={{ fontSize: 12 }}>
        <span className="muted">Demo states:</span>
        <button className="tag" onClick={() => setState('subscribed')}>subscribed</button>
        <button className="tag" onClick={() => setState('unsupported')}>unsupported</button>
        <button className="tag" onClick={() => setState('blocked')}>blocked</button>
      </div>
    </div>
  );
}

function ChangePasswordSection() {
  const [cur, setCur] = useStateSt('');
  const [n1, setN1] = useStateSt('');
  const [n2, setN2] = useStateSt('');
  const [success, setSuccess] = useStateSt(false);
  const [errors, setErrors] = useStateSt({});

  const submit = (e) => {
    e.preventDefault();
    const er = {};
    if (!cur) er.cur = 'Cần mật khẩu hiện tại';
    if (!n1 || n1.length < 8) er.n1 = 'Tối thiểu 8 ký tự';
    if (n1 !== n2) er.n2 = 'Không khớp';
    setErrors(er);
    if (Object.keys(er).length) return;
    setSuccess(true);
    setCur(''); setN1(''); setN2('');
    setTimeout(() => setSuccess(false), 4000);
  };
  return (
    <form onSubmit={submit} className="col gap-3">
      {success && (
        <div className="banner banner-emerald"><Icon name="checkCircle" size={18}/><div>Đổi mật khẩu thành công 🎉</div></div>
      )}
      <Field label="Mật khẩu hiện tại" required error={errors.cur}>
        <Input type="password" icon="lock" value={cur} onChange={e => setCur(e.target.value)} error={!!errors.cur}/>
      </Field>
      <Field label="Mật khẩu mới" required error={errors.n1} hint={!errors.n1 && 'Tối thiểu 8 ký tự'}>
        <Input type="password" icon="key" value={n1} onChange={e => setN1(e.target.value)} error={!!errors.n1}/>
      </Field>
      <Field label="Nhập lại mật khẩu mới" required error={errors.n2}>
        <Input type="password" icon="key" value={n2} onChange={e => setN2(e.target.value)} error={!!errors.n2}/>
      </Field>
      <Button variant="primary" type="submit" icon="key" style={{ alignSelf: 'flex-start' }}>Đổi mật khẩu</Button>
    </form>
  );
}

function BackupSection() {
  const [mode, setMode] = useStateSt('merge');
  return (
    <div className="col gap-5">
      <div>
        <h4 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700 }}>Xuất dữ liệu</h4>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
          Tải toàn bộ thiết bị, file đính kèm (tên/đường dẫn) và nhắc nhở ra 1 file JSON. File ảnh thật vẫn nằm trong thư mục <code>public/uploads</code>.
        </p>
        <div className="banner banner-amber" style={{ marginBottom: 10 }}>
          <Icon name="alert" size={16}/>
          <div style={{ fontSize: 13 }}>File backup chứa dữ liệu nhạy cảm: số seri, địa chỉ & SĐT trung tâm bảo hành, giá mua. Lưu ở nơi an toàn — nếu upload cloud thì nên đặt mật khẩu zip trước.</div>
        </div>
        <Button icon="download" onClick={() => toast(`Đã xuất ${MOCK.DEVICES.length} thiết bị 📦`, 'success')}>Xuất JSON</Button>
      </div>
      <hr className="hr"/>
      <div>
        <h4 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700 }}>Nhập dữ liệu</h4>
        <div className="col gap-3">
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>Chế độ</div>
            <PillGroup
              value={mode}
              onChange={setMode}
              options={[
                { value: 'merge', label: 'Merge (gộp)' },
                { value: 'replace', label: 'Replace (xoá hết)' },
              ]}
            />
          </div>
          {mode === 'replace' && (
            <div className="banner banner-destructive">
              <Icon name="alert" size={18}/>
              <div><b>Replace</b> sẽ XOÁ TOÀN BỘ data hiện tại trước khi nạp backup. Không thể hoàn tác. Chắc chắn rồi mới làm nha.</div>
            </div>
          )}
          <Field label="File JSON">
            <Input type="file" accept=".json"/>
          </Field>
          <Button variant="primary" icon="upload" onClick={() => toast('Import thành công 🎉', 'success')} style={{ alignSelf: 'flex-start' }}>Nhập</Button>
        </div>
      </div>
    </div>
  );
}

function DeleteAccountSection() {
  const [confirming, setConfirming] = useStateSt(false);
  const [pw, setPw] = useStateSt('');
  const [phrase, setPhrase] = useStateSt('');
  const valid = pw.length >= 1 && phrase === 'XOA TAI KHOAN';
  if (!confirming) {
    return (
      <div className="col gap-3">
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Xoá tài khoản sẽ xoá toàn bộ thiết bị, hoá đơn, ảnh BH và cài đặt push. Không thể hoàn tác.
        </p>
        <Button variant="destructive-outline" icon="trash" onClick={() => setConfirming(true)} style={{ alignSelf: 'flex-start' }}>Tao muốn xoá tài khoản</Button>
      </div>
    );
  }
  return (
    <div className="col gap-3">
      <div className="banner banner-destructive">
        <Icon name="alert" size={18}/>
        <div>Sau khi bấm xoá, toàn bộ dữ liệu của mày bị xoá vĩnh viễn. Tao khuyên mày <a href="#/settings" className="link" style={{ color: 'inherit', textDecoration: 'underline' }}>xuất backup JSON</a> trước.</div>
      </div>
      <Field label="Mật khẩu hiện tại" required>
        <Input type="password" icon="lock" value={pw} onChange={e => setPw(e.target.value)}/>
      </Field>
      <Field label="Gõ XOA TAI KHOAN để xác nhận" required hint="Phải khớp chính xác">
        <Input value={phrase} onChange={e => setPhrase(e.target.value)} placeholder="XOA TAI KHOAN"/>
      </Field>
      <div className="row gap-2">
        <Button variant="ghost" onClick={() => { setConfirming(false); setPw(''); setPhrase(''); }}>Huỷ</Button>
        <Button variant="destructive" icon="trash" disabled={!valid} onClick={() => toast('Tài khoản đã bị xoá (demo).', 'success')}>Xoá vĩnh viễn tài khoản</Button>
      </div>
    </div>
  );
}

function Settings() {
  const auth = useAuth();
  return (
    <>
      <PageHeader
        title="Cài đặt"
        sub={`${auth?.user?.email || 'trung@local.test'} · Quản lý tài khoản và dữ liệu cá nhân.`}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <Card>
          <h3 className="section-title"><IconBadge icon="bell" tone="primary" size="sm"/> Thông báo</h3>
          <PushSection/>
        </Card>

        <Card>
          <h3 className="section-title"><IconBadge icon="lock" tone="primary" size="sm"/> Đổi mật khẩu</h3>
          <ChangePasswordSection/>
        </Card>

        <Card style={{ gridColumn: '1 / -1' }}>
          <h3 className="section-title"><IconBadge icon="database" tone="primary" size="sm"/> Sao lưu & khôi phục</h3>
          <BackupSection/>
        </Card>

        <Card style={{ border: '1.5px solid var(--destructive)' }}>
          <h3 className="section-title" style={{ color: 'var(--destructive)' }}><IconBadge icon="trash" tone="rose" size="sm"/> Xoá tài khoản</h3>
          <DeleteAccountSection/>
        </Card>

        <Card style={{ background: 'var(--surface-2)' }}>
          <h3 className="section-title"><IconBadge icon="info" tone="zinc" size="sm"/> Về WarrantyVault</h3>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            WarrantyVault là app theo dõi bảo hành, gói đăng ký và wishlist cho người Việt. Local-first, không quảng cáo, không tracking. Built with Next.js 16, React 19, Go backend, Tailwind, shadcn/ui, recharts.
          </p>
        </Card>
      </div>
    </>
  );
}

window.PAGES.Settings = Settings;
