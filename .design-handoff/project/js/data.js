/* Mock data for WarrantyVault demo. Vietnamese. */
/* global */

const today = new Date('2026-05-17');
function daysAgo(n) { const d = new Date(today); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function daysFromNow(n) { return daysAgo(-n); }
function addMonths(date, months) {
  const d = new Date(date); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10);
}

const CATEGORIES = [
  { id: 'laptop', label: 'Laptop', icon: 'laptop', tint: 'sky' },
  { id: 'phone', label: 'Điện thoại', icon: 'smartphone', tint: 'primary' },
  { id: 'tablet', label: 'Máy tính bảng', icon: 'tablet', tint: 'violet' },
  { id: 'watch', label: 'Đồng hồ', icon: 'watch', tint: 'rose' },
  { id: 'tv', label: 'TV', icon: 'tv', tint: 'violet' },
  { id: 'audio', label: 'Tai nghe / Loa', icon: 'headphones', tint: 'amber' },
  { id: 'camera', label: 'Máy ảnh', icon: 'camera', tint: 'sky' },
  { id: 'appliance', label: 'Đồ gia dụng', icon: 'database', tint: 'emerald' },
  { id: 'console', label: 'Máy chơi game', icon: 'gamepad', tint: 'rose' },
  { id: 'monitor', label: 'Màn hình', icon: 'monitor', tint: 'sky' },
  { id: 'printer', label: 'Máy in', icon: 'printer', tint: 'zinc' },
  { id: 'vehicle', label: 'Phương tiện', icon: 'bike', tint: 'emerald' },
];

const SUB_CATEGORIES = [
  { id: 'streaming', label: 'Streaming', icon: 'film', tint: 'rose' },
  { id: 'ai', label: 'AI / phần mềm', icon: 'sparkles', tint: 'violet' },
  { id: 'cloud', label: 'Cloud / hosting', icon: 'cloud', tint: 'sky' },
  { id: 'music', label: 'Nhạc', icon: 'music', tint: 'amber' },
  { id: 'work', label: 'Công việc', icon: 'briefcase', tint: 'emerald' },
  { id: 'domain', label: 'Domain', icon: 'globe', tint: 'sky' },
];

function catById(id) { return CATEGORIES.find(c => c.id === id) || SUB_CATEGORIES.find(c => c.id === id) || CATEGORIES[0]; }

const DEVICES = [
  {
    id: 'd1', name: 'MacBook Pro M3 14"', category: 'laptop', brand: 'Apple', model: '14-inch M3 Pro',
    serial: 'C02XYZ987ABC', purchaseDate: daysAgo(220), price: 52900000, store: 'CellphoneS',
    status: 'ACTIVE', attachments: 2,
    note: 'Mua trả góp 0% qua Home Credit, máy cá nhân dùng work + dev.',
    warranties: [
      { type: 'STANDARD', provider: 'Apple Việt Nam', start: daysAgo(220), months: 12, price: 0,
        phone: '1800-1192', address: 'Bitexco, Quận 1, TP.HCM', note: 'BH chính hãng Apple' },
      { type: 'EXTENDED', provider: 'AppleCare+', start: daysAgo(220), months: 36, price: 7900000,
        phone: '1800-1192', address: 'Bitexco, Quận 1, TP.HCM', note: 'Bảo vệ rơi vỡ 2 lần / năm.' },
    ],
  },
  {
    id: 'd2', name: 'iPhone 15 Pro Max', category: 'phone', brand: 'Apple', model: '256GB Titan Tự Nhiên',
    serial: 'F2LXY8MZJC78', purchaseDate: daysAgo(160), price: 32990000, store: 'TopZone',
    status: 'ACTIVE', attachments: 3,
    note: '',
    warranties: [
      { type: 'STANDARD', provider: 'Apple Việt Nam', start: daysAgo(160), months: 12, price: 0,
        phone: '1800-1192', address: 'TopZone, 123 Nguyễn Trãi, Q.1', note: '' },
    ],
  },
  {
    id: 'd3', name: 'Máy giặt LG Inverter 9kg', category: 'appliance', brand: 'LG', model: 'FV1409S4W',
    serial: 'LG2024-FW0991-VN', purchaseDate: daysAgo(700), price: 9890000, store: 'Điện Máy Xanh',
    status: 'ACTIVE', attachments: 1,
    note: 'Cài đặt miễn phí. Dùng được 1 năm rồi vẫn ngon.',
    warranties: [
      { type: 'STANDARD', provider: 'LG Việt Nam', start: daysAgo(700), months: 24, price: 0,
        phone: '1800-1503', address: 'Showroom LG, Q.5, TP.HCM', note: 'BH chính hãng 2 năm.' },
    ],
  },
  {
    id: 'd4', name: 'Sony WH-1000XM5', category: 'audio', brand: 'Sony', model: 'Black',
    serial: 'SN-1000XM5-0042', purchaseDate: daysAgo(540), price: 7990000, store: 'Sony Center',
    status: 'ACTIVE', attachments: 0,
    note: '',
    warranties: [
      { type: 'STANDARD', provider: 'Sony Việt Nam', start: daysAgo(540), months: 18, price: 0,
        phone: '1800-588833', address: '123 Cách Mạng Tháng 8, Q.3', note: '' },
    ],
  },
  {
    id: 'd5', name: 'LG OLED C3 55"', category: 'tv', brand: 'LG', model: 'OLED55C3PSA',
    serial: 'LG-OLED-C3-22441', purchaseDate: daysAgo(95), price: 28490000, store: 'Mediamart',
    status: 'ACTIVE', attachments: 1,
    note: 'Mua dịp Tết, có giảm 20%.',
    warranties: [
      { type: 'STANDARD', provider: 'LG Việt Nam', start: daysAgo(95), months: 24, price: 0,
        phone: '1800-1503', address: 'Trung tâm LG Q.7, TP.HCM', note: '' },
    ],
  },
  {
    id: 'd6', name: 'PlayStation 5 Slim', category: 'console', brand: 'Sony', model: 'Disc Edition',
    serial: 'PS5-2024-VN-8821', purchaseDate: daysAgo(45), price: 14990000, store: 'NShop',
    status: 'ACTIVE', attachments: 1,
    note: '',
    warranties: [
      { type: 'STANDARD', provider: 'NShop', start: daysAgo(45), months: 12, price: 0,
        phone: '028-39999999', address: 'NShop Q.10, TP.HCM', note: '' },
    ],
  },
  {
    id: 'd7', name: 'Dyson V12 Detect Slim', category: 'appliance', brand: 'Dyson', model: 'SV30',
    serial: 'DY-V12-0098-VN', purchaseDate: daysAgo(370), price: 18990000, store: 'Lazada Mall',
    status: 'ACTIVE', attachments: 2,
    note: 'Mua online sale 11/11.',
    warranties: [
      { type: 'STANDARD', provider: 'Dyson Việt Nam', start: daysAgo(370), months: 24, price: 0,
        phone: '1800-558828', address: 'Dyson HCMC, Q.1', note: '' },
    ],
  },
  {
    id: 'd8', name: 'Apple Watch Series 9', category: 'watch', brand: 'Apple', model: '45mm Midnight',
    serial: 'AW9-45-MDN-0042', purchaseDate: daysAgo(280), price: 11990000, store: 'TopZone',
    status: 'ACTIVE', attachments: 0,
    note: '',
    warranties: [
      { type: 'STANDARD', provider: 'Apple Việt Nam', start: daysAgo(280), months: 12, price: 0,
        phone: '1800-1192', address: '', note: '' },
    ],
  },
  {
    id: 'd9', name: 'iPad Air M2 11"', category: 'tablet', brand: 'Apple', model: '128GB Wi-Fi',
    serial: 'IPAD-AIR-M2-1834', purchaseDate: daysAgo(60), price: 16990000, store: 'CellphoneS',
    status: 'ACTIVE', attachments: 0,
    note: '',
    warranties: [
      { type: 'STANDARD', provider: 'Apple Việt Nam', start: daysAgo(60), months: 12, price: 0,
        phone: '1800-1192', address: 'CellphoneS Q.10', note: '' },
    ],
  },
  {
    id: 'd10', name: 'Canon EOS R6 Mark II', category: 'camera', brand: 'Canon', model: 'Body',
    serial: 'CR6M2-0021-VN', purchaseDate: daysAgo(1100), price: 58900000, store: 'Hà Vy Camera',
    status: 'INACTIVE', attachments: 1,
    note: 'Đang cho mượn, chưa lấy về.',
    warranties: [
      { type: 'STANDARD', provider: 'Canon VN', start: daysAgo(1100), months: 24, price: 0,
        phone: '028-39233222', address: '230 Pasteur, Q.3', note: 'Đã quá hạn từ tháng trước.' },
    ],
  },
];

const SUBSCRIPTIONS = [
  {
    id: 's1', name: 'Apple One Family', brand: 'Apple', plan: 'Family', category: 'streaming',
    price: 599000, cycle: 'MONTHLY', start: daysAgo(420), nextRenewal: daysFromNow(3), autoRenew: true,
    status: 'ACTIVE', accountEmail: 'trung@icloud.com', paymentMethod: 'Apple ID balance',
    manageUrl: 'https://apple.com/account', cancelUrl: 'https://apple.com/account/subscriptions',
    note: 'Share cho cả nhà 6 người.',
    payments: [
      { date: daysAgo(28), amount: 599000, note: 'Tự gia hạn tháng 4' },
      { date: daysAgo(58), amount: 599000, note: 'Tự gia hạn tháng 3' },
      { date: daysAgo(88), amount: 599000, note: 'Tự gia hạn tháng 2' },
      { date: daysAgo(118), amount: 599000, note: 'Tự gia hạn tháng 1' },
      { date: daysAgo(148), amount: 599000, note: '' },
      { date: daysAgo(178), amount: 599000, note: '' },
      { date: daysAgo(208), amount: 599000, note: '' },
      { date: daysAgo(238), amount: 549000, note: 'Giá cũ trước khi tăng' },
    ],
  },
  {
    id: 's2', name: 'ChatGPT Plus', brand: 'OpenAI', plan: 'Plus', category: 'ai',
    price: 510000, cycle: 'MONTHLY', start: daysAgo(360), nextRenewal: daysFromNow(8), autoRenew: true,
    status: 'ACTIVE', accountEmail: 'trung@gmail.com', paymentMethod: 'Visa **4242',
    manageUrl: 'https://chatgpt.com/billing', cancelUrl: 'https://chatgpt.com/billing/cancel',
    note: '',
    payments: [
      { date: daysAgo(22), amount: 510000, note: '' },
      { date: daysAgo(52), amount: 510000, note: '' },
      { date: daysAgo(82), amount: 510000, note: '' },
      { date: daysAgo(112), amount: 510000, note: '' },
      { date: daysAgo(142), amount: 480000, note: 'Giá cũ' },
    ],
  },
  {
    id: 's3', name: 'Spotify Premium', brand: 'Spotify', plan: 'Duo', category: 'music',
    price: 1190000, cycle: 'YEARLY', start: daysAgo(190), nextRenewal: daysFromNow(175), autoRenew: true,
    status: 'ACTIVE', accountEmail: 'trung@gmail.com', paymentMethod: 'Momo wallet',
    manageUrl: 'https://spotify.com/account', cancelUrl: '',
    note: 'Share với người yêu.',
    payments: [
      { date: daysAgo(190), amount: 1190000, note: 'Annual renewal' },
    ],
  },
  {
    id: 's4', name: 'Netflix Premium', brand: 'Netflix', plan: 'Premium 4K', category: 'streaming',
    price: 260000, cycle: 'MONTHLY', start: daysAgo(700), nextRenewal: daysAgo(2), autoRenew: true,
    status: 'ACTIVE', accountEmail: 'trung@gmail.com', paymentMethod: 'Visa **4242',
    manageUrl: 'https://netflix.com/account', cancelUrl: 'https://netflix.com/cancelplan',
    note: '',
    payments: [
      { date: daysAgo(32), amount: 260000, note: '' },
      { date: daysAgo(62), amount: 260000, note: '' },
      { date: daysAgo(92), amount: 260000, note: '' },
      { date: daysAgo(122), amount: 260000, note: '' },
    ],
  },
  {
    id: 's5', name: 'iCloud+ 200GB', brand: 'Apple', plan: '200GB', category: 'cloud',
    price: 65000, cycle: 'MONTHLY', start: daysAgo(900), nextRenewal: daysFromNow(12), autoRenew: true,
    status: 'ACTIVE', accountEmail: 'trung@icloud.com', paymentMethod: 'Apple ID balance',
    manageUrl: '', cancelUrl: '',
    note: '',
    payments: [
      { date: daysAgo(18), amount: 65000, note: '' },
      { date: daysAgo(48), amount: 65000, note: '' },
    ],
  },
  {
    id: 's6', name: 'Vercel Pro', brand: 'Vercel', plan: 'Pro', category: 'work',
    price: 510000, cycle: 'MONTHLY', start: daysAgo(110), nextRenewal: daysFromNow(20), autoRenew: true,
    status: 'ACTIVE', accountEmail: 'trung@gmail.com', paymentMethod: 'Visa **4242',
    manageUrl: 'https://vercel.com/account/billing', cancelUrl: '',
    note: 'Project freelance, đang còn 2 dự án chạy.',
    payments: [
      { date: daysAgo(10), amount: 510000, note: '' },
      { date: daysAgo(40), amount: 510000, note: '' },
    ],
  },
  {
    id: 's7', name: 'Notion Plus', brand: 'Notion', plan: 'Plus', category: 'work',
    price: 250000, cycle: 'MONTHLY', start: daysAgo(220), nextRenewal: daysFromNow(5), autoRenew: false,
    status: 'PAUSED', accountEmail: 'trung@gmail.com', paymentMethod: 'PayPal',
    manageUrl: 'https://notion.so/settings', cancelUrl: '',
    note: 'Đang tạm dừng, dùng free thử lại.',
    payments: [
      { date: daysAgo(35), amount: 250000, note: '' },
    ],
  },
  {
    id: 's8', name: 'trung.dev', brand: 'PorkBun', plan: '.dev domain', category: 'domain',
    price: 380000, cycle: 'YEARLY', start: daysAgo(330), nextRenewal: daysFromNow(35), autoRenew: true,
    status: 'ACTIVE', accountEmail: 'trung@gmail.com', paymentMethod: 'Visa **4242',
    manageUrl: 'https://porkbun.com', cancelUrl: '',
    note: '',
    payments: [
      { date: daysAgo(330), amount: 380000, note: '' },
    ],
  },
];

const WISHLIST = [
  {
    id: 'w1', name: 'Steam Deck OLED 1TB', brand: 'Valve', category: 'console',
    initialPrice: 17900000, currentPrice: 16500000, targetDate: daysFromNow(45),
    priority: 'HIGH', status: 'WATCHING', buyUrl: 'https://store.steampowered.com/steamdeck',
    imageUrl: '', reminderDays: 14,
    note: 'Đợi giảm thêm xíu nữa, có dịp Black Friday cuối năm.',
    priceHistory: [
      { date: daysAgo(80), price: 17900000, note: 'Giá niêm yết' },
      { date: daysAgo(50), price: 17500000, note: 'Sale nhẹ' },
      { date: daysAgo(20), price: 16800000, note: 'Giảm tiếp' },
      { date: daysAgo(5),  price: 16500000, note: 'Hiện tại' },
    ],
  },
  {
    id: 'w2', name: 'AirPods Max', brand: 'Apple', category: 'audio',
    initialPrice: 14490000, currentPrice: 13900000, targetDate: daysFromNow(120),
    priority: 'MEDIUM', status: 'WATCHING', buyUrl: 'https://apple.com/airpods-max',
    imageUrl: '', reminderDays: 30,
    note: '',
    priceHistory: [
      { date: daysAgo(60), price: 14490000 },
      { date: daysAgo(30), price: 14290000 },
      { date: daysAgo(10), price: 13900000 },
    ],
  },
  {
    id: 'w3', name: 'iPhone 16 Pro Max', brand: 'Apple', category: 'phone',
    initialPrice: 36990000, currentPrice: 36990000, targetDate: daysFromNow(20),
    priority: 'CRITICAL', status: 'DECIDED', buyUrl: '',
    imageUrl: '', reminderDays: 7,
    note: 'Đã quyết chắc — đợi launch.',
    priceHistory: [{ date: daysAgo(5), price: 36990000 }],
  },
  {
    id: 'w4', name: 'Kindle Paperwhite Signature', brand: 'Amazon', category: 'tablet',
    initialPrice: 5290000, currentPrice: 4990000, targetDate: null,
    priority: 'LOW', status: 'WATCHING', buyUrl: 'https://amazon.com/kindle',
    imageUrl: '', reminderDays: 60,
    note: '',
    priceHistory: [
      { date: daysAgo(90), price: 5290000 },
      { date: daysAgo(45), price: 5100000 },
      { date: daysAgo(10), price: 4990000 },
    ],
  },
  {
    id: 'w5', name: 'Webcam Logitech Brio 4K', brand: 'Logitech', category: 'camera',
    initialPrice: 5990000, currentPrice: 4790000, targetDate: daysFromNow(60),
    priority: 'MEDIUM', status: 'WATCHING', buyUrl: '',
    imageUrl: '', reminderDays: 14,
    note: '',
    priceHistory: [
      { date: daysAgo(40), price: 5990000 },
      { date: daysAgo(10), price: 4790000, note: 'Sale Lazada' },
    ],
  },
];

const REMINDERS = (() => {
  // derive from devices: any warranty within 90 days of expiring or expired in last 14 days
  const out = [];
  DEVICES.forEach(dev => {
    dev.warranties.forEach((w, idx) => {
      const endDate = new Date(w.start);
      endDate.setMonth(endDate.getMonth() + w.months);
      const ms = endDate - today;
      const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
      if (days <= 90 && days >= -14) {
        out.push({
          id: `${dev.id}-${idx}`,
          deviceId: dev.id,
          deviceName: dev.name,
          category: dev.category,
          warrantyType: w.type,
          provider: w.provider,
          end: endDate.toISOString().slice(0, 10),
          days,
          dismissed: false,
        });
      }
    });
  });
  return out;
})();

window.MOCK = { DEVICES, SUBSCRIPTIONS, WISHLIST, REMINDERS, CATEGORIES, SUB_CATEGORIES, catById, today };

/* ============================================================
   Format helpers
============================================================ */
function formatVND(n) {
  if (n == null || n === '') return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('vi-VN') + ' ₫';
}
function formatNumber(n) {
  if (n == null || n === '') return '';
  return Number(n).toLocaleString('vi-VN');
}
function formatDateVN(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatDateShort(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}
function daysBetween(a, b) {
  return Math.ceil((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}
function relativeDays(date) {
  const days = daysBetween(today, new Date(date));
  if (days === 0) return 'hôm nay';
  if (days === 1) return 'ngày mai';
  if (days === -1) return 'hôm qua';
  if (days > 0) return `còn ${days} ngày`;
  return `${Math.abs(days)} ngày trước`;
}
function warrantyEnd(w) {
  const d = new Date(w.start);
  d.setMonth(d.getMonth() + w.months);
  return d.toISOString().slice(0, 10);
}
function warrantyDaysLeft(w) {
  return daysBetween(today, new Date(warrantyEnd(w)));
}
function warrantyStatus(daysLeft) {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'danger';
  if (daysLeft <= 90) return 'warn';
  return 'safe';
}
function deviceMaxWarrantyDaysLeft(dev) {
  return Math.max(...dev.warranties.map(warrantyDaysLeft), -Infinity);
}
function monthlyEquivalent(sub) {
  const m = { MONTHLY: 1, YEARLY: 12, QUARTERLY: 3, WEEKLY: 0.23, LIFETIME: 0, CUSTOM: 1 };
  if (sub.cycle === 'LIFETIME') return 0;
  return sub.price / (m[sub.cycle] || 1);
}

Object.assign(window, {
  formatVND, formatNumber, formatDateVN, formatDateShort,
  daysBetween, relativeDays, warrantyEnd, warrantyDaysLeft,
  warrantyStatus, deviceMaxWarrantyDaysLeft, monthlyEquivalent,
});
