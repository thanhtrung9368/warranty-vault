/* Stats */
/* global React, UI, Icon, Link, navigate, MOCK, formatVND, formatDateVN, warrantyDaysLeft, deviceMaxWarrantyDaysLeft */
const { Button, Card, Badge, IconBadge, Select, EmptyState, PageHeader, StatCard, BarChart, PieChart } = UI;
const { useState: useStateST, useMemo: useMemoST } = React;

function Stats() {
  const { DEVICES, CATEGORIES, catById, today } = MOCK;
  const currentYear = today.getFullYear();
  const [year, setYear] = useStateST(currentYear);

  if (!DEVICES.length) {
    return (
      <>
        <PageHeader title="Thống kê" sub="Tổng quan chi phí mua sắm và giá trị tài sản còn bảo hành." />
        <EmptyState icon="chart" tone="violet" title="Chưa có gì để thống kê đâu" description="Thêm thiết bị xong quay lại nhé."
          action={<Button variant="primary" icon="plus" onClick={() => navigate('/devices/new')}>Thêm thiết bị</Button>}/>
      </>
    );
  }

  const thisYearDevices = DEVICES.filter(d => new Date(d.purchaseDate).getFullYear() === currentYear);
  const thisYearTotal = thisYearDevices.reduce((s, d) => s + d.price, 0);
  const stillWarranted = DEVICES.filter(d => deviceMaxWarrantyDaysLeft(d) >= 0);
  const warrantedValue = stillWarranted.reduce((s, d) => s + d.price, 0);

  // 12 months data
  const monthsData = useMemoST(() => {
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const m = new Date(today); m.setMonth(m.getMonth() - i);
      const ym = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      const label = `${String(m.getMonth() + 1).padStart(2, '0')}/${String(m.getFullYear()).slice(2)}`;
      const sum = DEVICES.filter(d => d.purchaseDate.startsWith(ym)).reduce((s, d) => s + d.price, 0);
      months.push({ label, value: sum });
    }
    return months;
  }, [DEVICES]);

  // Category pie (by total spend)
  const categoryPie = useMemoST(() => {
    const map = {};
    DEVICES.forEach(d => { map[d.category] = (map[d.category] || 0) + d.price; });
    const colors = ['var(--primary)', 'var(--emerald)', 'var(--amber)', 'var(--rose)', 'var(--violet)', 'var(--sky)'];
    return Object.entries(map).map(([k, v], i) => ({
      label: catById(k).label, value: v, color: colors[i % colors.length],
    }));
  }, [DEVICES]);

  const yearDevices = DEVICES.filter(d => new Date(d.purchaseDate).getFullYear() === year);
  const yearTotal = yearDevices.reduce((s, d) => s + d.price, 0);
  const yearByCategory = useMemoST(() => {
    const map = {};
    yearDevices.forEach(d => { map[d.category] = (map[d.category] || 0) + d.price; });
    return Object.entries(map).map(([k, v]) => ({ cat: catById(k), value: v })).sort((a, b) => b.value - a.value);
  }, [yearDevices]);

  const topDevices = DEVICES.slice().sort((a, b) => b.price - a.price).slice(0, 5);
  const years = Array.from(new Set(DEVICES.map(d => new Date(d.purchaseDate).getFullYear()))).sort((a, b) => b - a);

  return (
    <>
      <PageHeader title="Thống kê" sub="Tổng quan chi phí mua sắm và giá trị tài sản còn bảo hành." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
        <StatCard label={`Tổng chi ${currentYear}`} value={formatVND(thisYearTotal)} sub={`${thisYearDevices.length} thiết bị`} icon="trendingUp" tone="amber"/>
        <StatCard label="Tài sản còn BH" value={formatVND(warrantedValue)} sub={`${stillWarranted.length} thiết bị`} icon="shieldCheck" tone="emerald"/>
        <StatCard label="Tổng số thiết bị" value={DEVICES.length} sub="đang theo dõi" icon="package" tone="primary"/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Card>
          <h3 className="section-title"><Icon name="bar" size={18}/> Chi phí 12 tháng gần nhất</h3>
          <BarChart data={monthsData} formatY={v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v} />
        </Card>
        <Card>
          <h3 className="section-title"><Icon name="package" size={18}/> Phân bổ theo loại</h3>
          <div className="row gap-4 items-center" style={{ flexWrap: 'wrap' }}>
            <div style={{ width: 220 }}><PieChart data={categoryPie} size={220} /></div>
            <div className="col" style={{ flex: 1, minWidth: 180, gap: 6 }}>
              {categoryPie.sort((a, b) => b.value - a.value).map(c => (
                <div key={c.label} className="row items-center gap-2" style={{ fontSize: 13 }}>
                  <span style={{ width: 10, height: 10, background: c.color, borderRadius: 3 }}></span>
                  <span style={{ flex: 1 }}>{c.label}</span>
                  <span className="tabular muted">{formatVND(c.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
        <Card>
          <div className="row items-center justify-between" style={{ marginBottom: 14 }}>
            <h3 className="section-title" style={{ margin: 0 }}><Icon name="calendar" size={18}/> Tổng chi theo năm</h3>
            <Select value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 'auto' }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
          <div className="stat-value" style={{ fontSize: 32 }}>{formatVND(yearTotal)}</div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>({yearDevices.length} thiết bị mua trong {year})</div>
          <div className="col gap-2">
            {yearByCategory.map(({ cat, value }) => (
              <div key={cat.id} className="row items-center gap-3">
                <IconBadge icon={cat.icon} tone={cat.tint} size="xs"/>
                <span style={{ flex: 1, fontSize: 13 }}>{cat.label}</span>
                <span className="tabular" style={{ fontWeight: 600 }}>{formatVND(value)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="section-title"><Icon name="trophy" size={18} style={{ color: 'var(--amber)' }}/> Top 5 thiết bị đắt nhất</h3>
          <div className="col">
            {topDevices.map((d, i) => {
              const cat = catById(d.category);
              return (
                <Link key={d.id} to={`/devices/${d.id}`} className="row items-center gap-3" style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1px dashed var(--border)' }}>
                  <span className={`rank rank-${i + 1}`}>{i + 1}</span>
                  <IconBadge icon={cat.icon} tone={cat.tint} size="sm"/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{cat.label} • {d.brand} • {formatDateVN(d.purchaseDate)}</div>
                  </div>
                  <span className="tabular" style={{ fontWeight: 700 }}>{formatVND(d.price)}</span>
                </Link>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}

window.PAGES.Stats = Stats;
