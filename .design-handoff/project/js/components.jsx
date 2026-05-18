/* Shared atom components */
/* global React, Icon, VaultMark, formatVND, formatDateVN, warrantyDaysLeft, warrantyStatus, warrantyEnd */
const { useState, useEffect, useRef, useMemo } = React;

/* ============================================================
   Button
============================================================ */
function Button(props) {
  const { variant = 'default', size = 'md', icon, iconRight, children, className = '' } = props;
  const cls = ['btn'];
  if (variant === 'primary') cls.push('btn-primary');
  else if (variant === 'ghost') cls.push('btn-ghost');
  else if (variant === 'outline') cls.push('btn-outline');
  else if (variant === 'destructive') cls.push('btn-destructive');
  else if (variant === 'destructive-outline') cls.push('btn-destructive-outline');
  if (size === 'sm') cls.push('btn-sm');
  if (size === 'icon') cls.push('btn-icon');
  if (size === 'icon-sm') cls.push('btn-icon', 'btn-icon-sm');
  if (className) cls.push(className);
  // strip our custom props from the spread
  const dom = {};
  for (const k of Object.keys(props)) {
    if (k === 'variant' || k === 'size' || k === 'icon' || k === 'iconRight' || k === 'children' || k === 'className') continue;
    dom[k] = props[k];
  }
  return (
    <button className={cls.join(' ')} {...dom}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 14 : 16} />}
    </button>
  );
}

/* ============================================================
   Card
============================================================ */
function Card({ children, className = '', tone, ...rest }) {
  const cls = ['card'];
  if (tone) cls.push('tint-' + tone);
  if (className) cls.push(className);
  return <div className={cls.join(' ')} {...rest}>{children}</div>;
}

/* ============================================================
   Badge
============================================================ */
function Badge({ tone = 'default', size, icon, children, className = '' }) {
  const cls = ['badge'];
  if (tone && tone !== 'default') cls.push('badge-' + tone);
  if (size === 'lg') cls.push('badge-lg');
  if (className) cls.push(className);
  return (
    <span className={cls.join(' ')}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

/* ============================================================
   IconBadge — round chip
============================================================ */
function IconBadge({ icon, tone = 'primary', size = 'md', children }) {
  const cls = ['icon-badge', 'tint-' + tone];
  if (size === 'lg') cls.push('icon-badge-lg');
  if (size === 'sm') cls.push('icon-badge-sm');
  if (size === 'xs') cls.push('icon-badge-xs');
  const iSize = size === 'lg' ? 26 : size === 'sm' ? 16 : size === 'xs' ? 14 : 20;
  return (
    <span className={cls.join(' ')}>
      {icon ? <Icon name={icon} size={iSize} /> : children}
    </span>
  );
}

/* ============================================================
   Warranty pill
============================================================ */
function WarrantyPill({ daysLeft }) {
  if (daysLeft == null || !Number.isFinite(daysLeft)) {
    return <span className="warranty-pill" data-status="expired">—</span>;
  }
  const status = warrantyStatus(daysLeft);
  let label;
  if (daysLeft < 0) label = `Hết ${Math.abs(daysLeft)}d`;
  else if (daysLeft === 0) label = 'Hết hôm nay';
  else if (daysLeft <= 90) label = `Còn ${daysLeft}d`;
  else if (daysLeft <= 365) label = `Còn ~${Math.round(daysLeft/30)}th`;
  else label = `Còn ${(daysLeft/365).toFixed(1)} năm`;
  return (
    <span className="warranty-pill" data-status={status}>
      <span className="dot" />
      {label}
    </span>
  );
}

/* ============================================================
   Field (label + control + error)
============================================================ */
function Field({ label, required, hint, error, htmlFor, children }) {
  return (
    <div className="field">
      {label && (
        <label className={`field-label${required ? ' field-required' : ''}`} htmlFor={htmlFor}>{label}</label>
      )}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

/* ============================================================
   Input
============================================================ */
function Input({ icon, suffix, error, className = '', ...rest }) {
  const inputCls = ['input'];
  if (icon) inputCls.push('input-with-icon');
  if (suffix) inputCls.push('input-with-suffix');
  if (error) inputCls.push('input-error');
  if (className) inputCls.push(className);
  if (!icon && !suffix) return <input className={inputCls.join(' ')} {...rest} />;
  return (
    <div className="input-wrap">
      {icon && <span className="input-icon"><Icon name={icon} size={16} /></span>}
      <input className={inputCls.join(' ')} {...rest} />
      {suffix && <span className="input-suffix">{suffix}</span>}
    </div>
  );
}

function Select({ children, error, className = '', ...rest }) {
  const cls = ['select'];
  if (error) cls.push('input-error');
  if (className) cls.push(className);
  return <select className={cls.join(' ')} {...rest}>{children}</select>;
}

function Textarea({ error, className = '', ...rest }) {
  const cls = ['textarea'];
  if (error) cls.push('input-error');
  if (className) cls.push(className);
  return <textarea className={cls.join(' ')} {...rest} />;
}

function Checkbox({ checked, onChange, label }) {
  return (
    <label className="checkbox-wrap">
      <span className="checkbox" data-checked={checked} onClick={(e) => { e.preventDefault(); onChange?.(!checked); }}>
        {checked && <Icon name="check" size={14} strokeWidth={3} />}
      </span>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange?.(e.target.checked)} style={{ display: 'none' }} />
      {label && <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{label}</span>}
    </label>
  );
}

/* ============================================================
   Modal
============================================================ */
function Modal({ open, onClose, title, children, size = 'md', footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal${size === 'lg' ? ' modal-lg' : ''}`} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="row items-center justify-between gap-3" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>{title}</h3>
            <button className="btn btn-ghost btn-icon btn-icon-sm" onClick={onClose}><Icon name="x" size={16} /></button>
          </div>
        )}
        {children}
        {footer && <div className="row justify-end gap-2" style={{ marginTop: 20 }}>{footer}</div>}
      </div>
    </div>
  );
}

function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Xác nhận', destructive }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            onClick={() => { onConfirm?.(); onClose?.(); }}
          >{confirmLabel}</Button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--muted)' }}>{body}</p>
    </Modal>
  );
}

/* ============================================================
   Toast system (singleton)
============================================================ */
const toastListeners = new Set();
let toastSeq = 0;
function toast(message, tone = 'default') {
  const id = ++toastSeq;
  toastListeners.forEach(fn => fn({ type: 'add', toast: { id, message, tone } }));
  setTimeout(() => { toastListeners.forEach(fn => fn({ type: 'remove', id })); }, 4000);
}
function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (ev) => {
      if (ev.type === 'add') setItems(arr => [...arr, ev.toast]);
      else setItems(arr => arr.filter(t => t.id !== ev.id));
    };
    toastListeners.add(fn);
    return () => toastListeners.delete(fn);
  }, []);
  return (
    <div className="toast-stack">
      {items.map(t => (
        <div key={t.id} className="toast" data-tone={t.tone}>
          <Icon name={t.tone === 'success' ? 'checkCircle' : t.tone === 'error' ? 'alert' : t.tone === 'warning' ? 'alert' : 'info'} size={18} />
          <span style={{ flex: 1 }}>{t.message}</span>
          <button className="btn btn-ghost btn-icon btn-icon-sm" onClick={() => toastListeners.forEach(fn => fn({ type: 'remove', id: t.id }))}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Empty state
============================================================ */
function EmptyState({ icon = 'package', tone = 'primary', title, description, action }) {
  return (
    <div className="empty">
      <div className={`empty-illustration tint-${tone}`} style={{ background: `var(--${tone === 'primary' ? 'primary' : tone}-soft)` }}>
        <Icon name={icon} size={36} />
      </div>
      <h3 className="empty-title">{title}</h3>
      {description && <p className="empty-desc">{description}</p>}
      {action}
    </div>
  );
}

/* ============================================================
   Stat card
============================================================ */
function StatCard({ label, value, sub, icon, tone = 'primary' }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">
        <IconBadge icon={icon} tone={tone} />
      </div>
      <div className="stat-eyebrow">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/* ============================================================
   Stepper
============================================================ */
function Stepper({ steps, current }) {
  return (
    <div className="stepper">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <React.Fragment key={i}>
            <div className="stepper-step" data-state={state}>
              <span className="stepper-bubble">
                {state === 'done' ? <Icon name="check" size={14} strokeWidth={3} /> : i + 1}
              </span>
              <span className="stepper-label">{s}</span>
            </div>
            {i < steps.length - 1 && <span className="stepper-line" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ============================================================
   InfoRow
============================================================ */
function InfoRow({ icon, label, children, link }) {
  return (
    <div className="info-row">
      <Icon name={icon} size={18} className="info-icon" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="info-label">{label}</div>
        <div className="info-value" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {link ? <a href={link} className="link" target="_blank" rel="noreferrer">{children}</a> : children}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Page header
============================================================ */
function PageHeader({ title, sub, actions, back }) {
  return (
    <div className="col gap-3" style={{ marginBottom: 24 }}>
      {back && (
        <a href={back.href} className="link" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="arrowLeft" size={14} /> {back.label}
        </a>
      )}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">{title}</h1>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        {actions && <div className="row gap-2 items-center">{actions}</div>}
      </div>
    </div>
  );
}

/* ============================================================
   Mini SVG charts
============================================================ */
function BarChart({ data, width = 600, height = 220, xKey = 'label', yKey = 'value', formatY = (v) => v }) {
  const padding = { top: 16, right: 16, bottom: 28, left: 56 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.map(d => d[yKey] || 0));
  const niceMax = Math.ceil(max / 1) || 1;
  const barW = (innerW / data.length) * 0.6;
  const stepX = innerW / data.length;
  const ticks = 4;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <g className="chart-grid">
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const y = padding.top + (innerH * i) / ticks;
          return <line key={i} x1={padding.left} y1={y} x2={padding.left + innerW} y2={y} />;
        })}
      </g>
      <g className="chart-axis">
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const y = padding.top + (innerH * i) / ticks;
          const v = niceMax * (1 - i / ticks);
          return <text key={i} x={padding.left - 8} y={y + 4} textAnchor="end">{formatY(v)}</text>;
        })}
        {data.map((d, i) => (
          <text key={i} x={padding.left + stepX * (i + 0.5)} y={height - 10} textAnchor="middle">{d[xKey]}</text>
        ))}
      </g>
      <g>
        {data.map((d, i) => {
          const h = (innerH * (d[yKey] || 0)) / niceMax;
          const x = padding.left + stepX * (i + 0.5) - barW / 2;
          const y = padding.top + innerH - h;
          return (
            <rect key={i} x={x} y={y} width={barW} height={Math.max(0, h)} rx="6" className="chart-bar">
              <title>{`${d[xKey]}: ${formatY(d[yKey])}`}</title>
            </rect>
          );
        })}
      </g>
    </svg>
  );
}

function LineChart({ data, width = 600, height = 200, xKey = 'date', yKey = 'value', formatY = (v) => v }) {
  if (!data.length) return null;
  const padding = { top: 16, right: 16, bottom: 28, left: 56 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(...data.map(d => d[yKey] || 0));
  const min = Math.min(...data.map(d => d[yKey] || 0));
  const range = Math.max(1, max - min);
  const step = innerW / Math.max(1, data.length - 1);
  const points = data.map((d, i) => ({
    x: padding.left + step * i,
    y: padding.top + innerH - ((d[yKey] - min) / range) * innerH,
    d,
  }));
  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const areaD = pathD + ` L ${points[points.length-1].x} ${padding.top + innerH} L ${points[0].x} ${padding.top + innerH} Z`;
  const ticks = 4;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <g className="chart-grid">
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const y = padding.top + (innerH * i) / ticks;
          return <line key={i} x1={padding.left} y1={y} x2={padding.left + innerW} y2={y} />;
        })}
      </g>
      <g className="chart-axis">
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const y = padding.top + (innerH * i) / ticks;
          const v = max - ((max - min) * i) / ticks;
          return <text key={i} x={padding.left - 8} y={y + 4} textAnchor="end">{formatY(v)}</text>;
        })}
        {points.map((p, i) => (
          <text key={i} x={p.x} y={height - 10} textAnchor="middle">{p.d[xKey]}</text>
        ))}
      </g>
      <path d={areaD} className="chart-area" />
      <path d={pathD} className="chart-line" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" className="chart-dot">
          <title>{`${p.d[xKey]}: ${formatY(p.d[yKey])}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function PieChart({ data, size = 220 }) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0) || 1;
  let acc = 0;
  const cx = size / 2, cy = size / 2, r = size / 2 - 12, ir = r * 0.55;
  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size}`}>
      {data.map((d, i) => {
        const startAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
        acc += d.value;
        const endAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
        const large = endAngle - startAngle > Math.PI ? 1 : 0;
        const x1 = cx + Math.cos(startAngle) * r, y1 = cy + Math.sin(startAngle) * r;
        const x2 = cx + Math.cos(endAngle) * r, y2 = cy + Math.sin(endAngle) * r;
        const x3 = cx + Math.cos(endAngle) * ir, y3 = cy + Math.sin(endAngle) * ir;
        const x4 = cx + Math.cos(startAngle) * ir, y4 = cy + Math.sin(startAngle) * ir;
        const path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${ir} ${ir} 0 ${large} 0 ${x4} ${y4} Z`;
        return <path key={i} d={path} fill={d.color} stroke="var(--surface)" strokeWidth="2"><title>{`${d.label}: ${d.value.toLocaleString('vi-VN')}`}</title></path>;
      })}
    </svg>
  );
}

/* ============================================================
   Warranty timeline visualization
============================================================ */
function WarrantyTimeline({ start, end, today: now }) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const n = (now ? new Date(now) : new Date()).getTime();
  const pct = Math.max(0, Math.min(100, ((n - s) / (e - s)) * 100));
  const expired = n > e;
  return (
    <div className="col gap-2" style={{ marginTop: 8 }}>
      <div className="progress" style={{ height: 10 }}>
        <div
          className="progress-fill"
          style={{
            width: `${pct}%`,
            background: expired ? 'var(--zinc)' : pct > 80 ? 'linear-gradient(90deg,var(--rose),var(--rose))' : pct > 60 ? 'linear-gradient(90deg,var(--amber),var(--amber))' : 'linear-gradient(90deg,var(--emerald),var(--emerald))',
          }}
        />
      </div>
      <div className="row justify-between" style={{ fontSize: 11, color: 'var(--muted)' }}>
        <span>{formatDateVN(start)}</span>
        <span>{expired ? 'Đã hết' : `${Math.round(100 - pct)}% còn lại`}</span>
        <span>{formatDateVN(end)}</span>
      </div>
    </div>
  );
}

/* ============================================================
   Pill group (segmented)
============================================================ */
function PillGroup({ options, value, onChange }) {
  return (
    <div className="pill-group">
      {options.map(o => (
        <button key={o.value} data-active={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ============================================================
   Money input — formats with separators, suffix ₫
============================================================ */
function MoneyInput({ value, onChange, ...rest }) {
  const display = value == null || value === '' ? '' : Number(value).toLocaleString('vi-VN');
  return (
    <Input
      value={display}
      suffix="₫"
      inputMode="numeric"
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d]/g, '');
        onChange(raw === '' ? '' : Number(raw));
      }}
      {...rest}
    />
  );
}

window.UI = {
  Button, Card, Badge, IconBadge, WarrantyPill,
  Field, Input, Select, Textarea, Checkbox, MoneyInput,
  Modal, ConfirmDialog, toast, ToastHost,
  EmptyState, StatCard, Stepper, InfoRow, PageHeader,
  BarChart, LineChart, PieChart, WarrantyTimeline, PillGroup,
};
