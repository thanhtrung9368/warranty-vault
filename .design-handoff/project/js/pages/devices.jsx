/* Devices list page */
/* global React, UI, Icon, Link, navigate, MOCK, formatVND, formatDateVN, deviceMaxWarrantyDaysLeft */
const { Button, Card, Badge, IconBadge, WarrantyPill, Input, Select, EmptyState, PageHeader } = UI;
const { useState: useStateDL, useMemo: useMemoDL } = React;

const DEV_STATUS_LABEL = { ACTIVE: 'Đang dùng', INACTIVE: 'Ngừng dùng', ARCHIVED: 'Đã lưu trữ' };
const DEV_STATUS_TONE = { ACTIVE: 'emerald', INACTIVE: 'amber', ARCHIVED: 'zinc' };

function DevicesList({ query = {} }) {
  const { DEVICES, CATEGORIES, catById } = MOCK;
  const [q, setQ] = useStateDL(query.q || '');
  const [category, setCategory] = useStateDL(query.category || '');
  const [status, setStatus] = useStateDL(query.status || '');
  const [sort, setSort] = useStateDL(query.sort || 'purchaseDate');
  const [dir, setDir] = useStateDL(query.dir || 'desc');

  const filtered = useMemoDL(() => {
    let arr = DEVICES.slice();
    const ql = q.toLowerCase();
    if (ql) arr = arr.filter(d => `${d.name} ${d.brand} ${d.model} ${d.serial}`.toLowerCase().includes(ql));
    if (category) arr = arr.filter(d => d.category === category);
    if (status) arr = arr.filter(d => d.status === status);
    arr.sort((a, b) => {
      let av, bv;
      if (sort === 'name') { av = a.name; bv = b.name; }
      else if (sort === 'price') { av = a.price; bv = b.price; }
      else if (sort === 'warranty') { av = deviceMaxWarrantyDaysLeft(a); bv = deviceMaxWarrantyDaysLeft(b); }
      else { av = a.purchaseDate; bv = b.purchaseDate; }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [DEVICES, q, category, status, sort, dir]);

  const isFiltered = q || category || status;

  return (
    <>
      <PageHeader
        title="Thiết bị"
        sub={`Tổng ${filtered.length} thiết bị${isFiltered ? ' đã lọc' : ''}. Bấm vào từng cái để xem chi tiết.`}
        actions={<Button variant="primary" icon="plus" onClick={() => navigate('/devices/new')}>Thêm thiết bị</Button>}
      />

      <div className="toolbar">
        <div style={{ flex: '1 1 240px', minWidth: 200 }}>
          <Input icon="search" placeholder="Tìm theo tên, hãng, model, serial..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Select value={category} onChange={e => setCategory(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
          <option value="">Tất cả loại</option>
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <Select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
          <option value="">Tất cả trạng thái</option>
          <option value="ACTIVE">Đang dùng</option>
          <option value="INACTIVE">Ngừng dùng</option>
          <option value="ARCHIVED">Đã lưu trữ</option>
        </Select>
        <Select value={`${sort}-${dir}`} onChange={e => { const [s, d] = e.target.value.split('-'); setSort(s); setDir(d); }} style={{ width: 'auto', minWidth: 200 }}>
          <option value="purchaseDate-desc">Ngày mua: mới nhất</option>
          <option value="purchaseDate-asc">Ngày mua: cũ nhất</option>
          <option value="warranty-asc">BH sắp hết trước</option>
          <option value="warranty-desc">BH lâu hết trước</option>
          <option value="price-desc">Giá cao nhất</option>
          <option value="price-asc">Giá thấp nhất</option>
          <option value="name-asc">Tên A → Z</option>
        </Select>
        {isFiltered && (
          <Button variant="ghost" size="sm" icon="x" onClick={() => { setQ(''); setCategory(''); setStatus(''); }}>Xoá lọc</Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={isFiltered ? 'search' : 'package'}
            title={isFiltered ? 'Không có gì khớp bộ lọc' : 'Chưa có thiết bị nào, mày'}
            description={isFiltered ? 'Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.' : 'Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... gì cũng được.'}
            action={!isFiltered && <Button variant="primary" icon="plus" onClick={() => navigate('/devices/new')}>Thêm thiết bị</Button>}
          />
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tên</th>
                <th className="hide-md">Loại</th>
                <th className="hide-md num">Giá</th>
                <th className="hide-sm">Ngày mua</th>
                <th>Bảo hành</th>
                <th className="hide-md">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const cat = catById(d.category);
                const dl = deviceMaxWarrantyDaysLeft(d);
                return (
                  <tr key={d.id} className="clickable" onClick={() => navigate(`/devices/${d.id}`)}>
                    <td>
                      <div className="row items-center gap-3">
                        <IconBadge icon={cat.icon} tone={cat.tint} size="sm"/>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{d.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {d.brand} • {d.model}
                            {d.attachments > 0 && <> · <Icon name="paperclip" size={11} style={{ verticalAlign: 'middle' }}/> {d.attachments}</>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hide-md"><Badge tone={cat.tint === 'primary' ? 'primary' : cat.tint}>{cat.label}</Badge></td>
                    <td className="hide-md num"><span className="tabular" style={{ fontWeight: 600 }}>{formatVND(d.price)}</span></td>
                    <td className="hide-sm" style={{ color: 'var(--ink-2)' }}>{formatDateVN(d.purchaseDate)}</td>
                    <td><WarrantyPill daysLeft={dl}/></td>
                    <td className="hide-md"><Badge tone={DEV_STATUS_TONE[d.status]}>{DEV_STATUS_LABEL[d.status]}</Badge></td>
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

window.PAGES.DevicesList = DevicesList;
window.DEV_STATUS_LABEL = DEV_STATUS_LABEL;
window.DEV_STATUS_TONE = DEV_STATUS_TONE;
