/* Reminders */
/* global React, UI, Icon, Link, navigate, MOCK, formatDateVN */
const { Button, Card, Badge, IconBadge, WarrantyPill, EmptyState, PageHeader, toast } = UI;
const { useState: useStateR } = React;

function Reminders() {
  const { DEVICES, REMINDERS, catById } = MOCK;
  const [dismissed, setDismissed] = useStateR(new Set());

  const visible = REMINDERS.filter(r => !dismissed.has(r.id));

  if (visible.length === 0) {
    return (
      <>
        <PageHeader title="Nhắc nhở" sub="Gói bảo hành sắp hết hoặc vừa hết. Bấm 'Đã xem, ẩn đi' để bỏ qua từng gói." />
        <EmptyState
          icon="checkCircle" tone="emerald"
          title="Không có nhắc nhở nào, ngon!"
          description="Tất cả gói bảo hành đều an toàn. Mày khỏi lo gì hết."
        />
      </>
    );
  }

  const sections = [
    { label: 'Sắp hết trong 30 ngày', color: 'var(--destructive)', tone: 'rose', filter: r => r.days <= 30 },
    { label: 'Sắp hết trong 60 ngày', color: 'var(--amber)', tone: 'amber', filter: r => r.days > 30 && r.days <= 60 },
    { label: 'Sắp hết trong 90 ngày', color: 'var(--emerald)', tone: 'emerald', filter: r => r.days > 60 && r.days <= 90 },
  ];

  return (
    <>
      <PageHeader title="Nhắc nhở" sub="Gói bảo hành sắp hết hoặc vừa hết. Bấm 'Đã xem, ẩn đi' để bỏ qua từng gói." />

      <div className="col gap-4">
        {sections.map(sec => {
          const items = visible.filter(sec.filter);
          if (items.length === 0) return null;
          return (
            <Card key={sec.label}>
              <div className="row items-center gap-3" style={{ marginBottom: 14 }}>
                <IconBadge icon="bell" tone={sec.tone} size="sm"/>
                <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: sec.color }}>{sec.label}</h3>
                <Badge tone={sec.tone}>{items.length}</Badge>
              </div>
              <div className="col">
                {items.map(r => {
                  const cat = catById(r.category);
                  return (
                    <div key={r.id} className="row items-center gap-3" style={{ padding: '12px 0', borderTop: '1px dashed var(--border)' }}>
                      <Link to={`/devices/${r.deviceId}`} className="row items-center gap-3" style={{ flex: 1, minWidth: 0 }}>
                        <IconBadge icon={cat.icon} tone={cat.tint} size="sm"/>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="row items-center gap-2" style={{ fontWeight: 700, fontSize: 14 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.deviceName}</span>
                            <Badge tone={window.WARRANTY_TYPE_TONE?.[r.warrantyType] || 'primary'}>{window.WARRANTY_TYPE_LABEL?.[r.warrantyType] || r.warrantyType}</Badge>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                            {cat.label} • {r.provider} • Hết {formatDateVN(r.end)}
                          </div>
                        </div>
                      </Link>
                      <WarrantyPill daysLeft={r.days}/>
                      <Button variant="ghost" size="sm" icon="x" onClick={() => {
                        setDismissed(prev => { const n = new Set(prev); n.add(r.id); return n; });
                        toast('Đã ẩn nhắc nhở', 'success');
                      }}>Đã xem, ẩn đi</Button>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

window.PAGES.Reminders = Reminders;
