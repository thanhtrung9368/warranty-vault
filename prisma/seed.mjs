import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
const adapter = new PrismaBetterSqlite3({ url });
const prisma = new PrismaClient({ adapter });

// ─────────────────────────────────────────────────────────────────────────────
// Categories (loại thiết bị)
// Sort order groups things visually: phones/laptops first, then audio/visual,
// peripherals, big appliances, furniture, fallback.
// ─────────────────────────────────────────────────────────────────────────────
const categories = [
  { code: 'PHONE', name: 'Điện thoại', sortOrder: 10 },
  { code: 'LAPTOP', name: 'Laptop', sortOrder: 20 },
  { code: 'TABLET', name: 'Máy tính bảng', sortOrder: 30 },
  { code: 'SMARTWATCH', name: 'Đồng hồ thông minh', sortOrder: 40 },
  { code: 'HEADPHONE', name: 'Tai nghe', sortOrder: 50 },
  { code: 'SPEAKER', name: 'Loa', sortOrder: 60 },
  { code: 'CAMERA', name: 'Máy ảnh / Quay phim', sortOrder: 70 },
  { code: 'TV', name: 'Tivi', sortOrder: 80 },
  { code: 'MONITOR', name: 'Màn hình', sortOrder: 90 },
  { code: 'KEYBOARD', name: 'Bàn phím', sortOrder: 100 },
  { code: 'MOUSE', name: 'Chuột', sortOrder: 110 },
  { code: 'GAMING_CONSOLE', name: 'Máy chơi game', sortOrder: 120 },
  { code: 'AC', name: 'Điều hòa', sortOrder: 130 },
  { code: 'FRIDGE', name: 'Tủ lạnh', sortOrder: 140 },
  { code: 'WASHING', name: 'Máy giặt / Sấy', sortOrder: 150 },
  { code: 'KITCHEN', name: 'Đồ nhà bếp', sortOrder: 160 },
  { code: 'APPLIANCE', name: 'Đồ gia dụng khác', sortOrder: 170 },
  { code: 'ELECTRONICS', name: 'Điện tử khác', sortOrder: 180 },
  { code: 'FURNITURE', name: 'Nội thất', sortOrder: 190 },
  // Software / subscription categories — sortOrder 200+ groups them after
  // physical products. They show up in the same picker (since Subscription
  // and Wishlist both reuse the catalog), and devices won't normally pick them.
  { code: 'STREAMING', name: 'Xem phim / nhạc', sortOrder: 200 },
  { code: 'MUSIC', name: 'Nhạc', sortOrder: 210 },
  { code: 'AI_TOOL', name: 'AI / Trợ lý ảo', sortOrder: 220 },
  { code: 'CLOUD_STORAGE', name: 'Lưu trữ đám mây', sortOrder: 230 },
  { code: 'PRODUCTIVITY', name: 'Phần mềm năng suất', sortOrder: 240 },
  { code: 'DEV_TOOL', name: 'Công cụ lập trình', sortOrder: 250 },
  { code: 'HOSTING', name: 'Hosting / Domain', sortOrder: 260 },
  { code: 'NEWS', name: 'Báo / Tạp chí', sortOrder: 270 },
  { code: 'GAME_SUB', name: 'Gaming subscription', sortOrder: 280 },
  { code: 'VPN_SECURITY', name: 'VPN / Bảo mật', sortOrder: 290 },
  { code: 'EDUCATION', name: 'Học online', sortOrder: 300 },
  { code: 'FITNESS', name: 'Fitness / Sức khoẻ', sortOrder: 310 },

  { code: 'OTHER', name: 'Khác', sortOrder: 999 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Brands and which categories they're popular in.
// A brand with no categories in its array is global (shown for any category).
// ─────────────────────────────────────────────────────────────────────────────
const brands = [
  // Apple ecosystem
  { name: 'Apple', cats: ['PHONE', 'LAPTOP', 'TABLET', 'SMARTWATCH', 'HEADPHONE', 'SPEAKER', 'KEYBOARD', 'MOUSE', 'TV'] },

  // Phones
  { name: 'Samsung', cats: ['PHONE', 'LAPTOP', 'TABLET', 'SMARTWATCH', 'TV', 'MONITOR', 'WASHING', 'FRIDGE', 'AC', 'APPLIANCE'] },
  { name: 'Xiaomi', cats: ['PHONE', 'TABLET', 'SMARTWATCH', 'TV', 'MONITOR', 'HEADPHONE', 'SPEAKER', 'APPLIANCE'] },
  { name: 'OPPO', cats: ['PHONE', 'SMARTWATCH', 'HEADPHONE'] },
  { name: 'Vivo', cats: ['PHONE'] },
  { name: 'Realme', cats: ['PHONE', 'SMARTWATCH', 'HEADPHONE'] },
  { name: 'Huawei', cats: ['PHONE', 'TABLET', 'SMARTWATCH', 'HEADPHONE', 'LAPTOP'] },
  { name: 'Honor', cats: ['PHONE', 'SMARTWATCH'] },
  { name: 'Google', cats: ['PHONE', 'TABLET'] },
  { name: 'Nothing', cats: ['PHONE', 'HEADPHONE'] },

  // Laptops / PC
  { name: 'Dell', cats: ['LAPTOP', 'MONITOR'] },
  { name: 'HP', cats: ['LAPTOP', 'MONITOR'] },
  { name: 'Lenovo', cats: ['LAPTOP', 'TABLET', 'MONITOR'] },
  { name: 'Asus', cats: ['LAPTOP', 'MONITOR', 'KEYBOARD', 'MOUSE'] },
  { name: 'Acer', cats: ['LAPTOP', 'MONITOR'] },
  { name: 'MSI', cats: ['LAPTOP', 'MONITOR', 'KEYBOARD', 'MOUSE'] },
  { name: 'LG', cats: ['LAPTOP', 'TV', 'MONITOR', 'WASHING', 'FRIDGE', 'AC'] },
  { name: 'Microsoft', cats: ['LAPTOP', 'TABLET', 'GAMING_CONSOLE', 'KEYBOARD', 'MOUSE'] },

  // Audio
  { name: 'Sony', cats: ['HEADPHONE', 'SPEAKER', 'CAMERA', 'TV', 'GAMING_CONSOLE'] },
  { name: 'Bose', cats: ['HEADPHONE', 'SPEAKER'] },
  { name: 'Sennheiser', cats: ['HEADPHONE'] },
  { name: 'JBL', cats: ['HEADPHONE', 'SPEAKER'] },
  { name: 'Marshall', cats: ['HEADPHONE', 'SPEAKER'] },
  { name: 'Harman Kardon', cats: ['SPEAKER'] },
  { name: 'Anker Soundcore', cats: ['HEADPHONE', 'SPEAKER'] },
  { name: 'Edifier', cats: ['HEADPHONE', 'SPEAKER'] },
  { name: 'Beats', cats: ['HEADPHONE'] },
  { name: 'Sonos', cats: ['SPEAKER'] },
  { name: 'AirPods', cats: ['HEADPHONE'] },

  // Smartwatch / Wearables
  { name: 'Garmin', cats: ['SMARTWATCH', 'CAMERA'] },
  { name: 'Amazfit', cats: ['SMARTWATCH'] },
  { name: 'Fitbit', cats: ['SMARTWATCH'] },

  // Camera
  { name: 'Canon', cats: ['CAMERA'] },
  { name: 'Nikon', cats: ['CAMERA'] },
  { name: 'Fujifilm', cats: ['CAMERA'] },
  { name: 'Panasonic', cats: ['CAMERA', 'TV', 'WASHING', 'FRIDGE', 'AC', 'APPLIANCE', 'KITCHEN'] },
  { name: 'Olympus', cats: ['CAMERA'] },
  { name: 'Leica', cats: ['CAMERA'] },
  { name: 'GoPro', cats: ['CAMERA'] },
  { name: 'DJI', cats: ['CAMERA'] },
  { name: 'Insta360', cats: ['CAMERA'] },

  // TV / Display
  { name: 'TCL', cats: ['TV', 'AC'] },
  { name: 'Toshiba', cats: ['TV', 'WASHING', 'FRIDGE', 'AC', 'APPLIANCE', 'KITCHEN'] },
  { name: 'Sharp', cats: ['TV', 'AC', 'APPLIANCE', 'KITCHEN'] },
  { name: 'Casper', cats: ['TV', 'AC', 'WASHING', 'FRIDGE'] },
  { name: 'Coocaa', cats: ['TV'] },
  { name: 'ViewSonic', cats: ['MONITOR'] },
  { name: 'Gigabyte', cats: ['MONITOR', 'LAPTOP'] },
  { name: 'BenQ', cats: ['MONITOR'] },
  { name: 'AOC', cats: ['MONITOR'] },

  // Peripherals
  { name: 'Logitech', cats: ['KEYBOARD', 'MOUSE', 'SPEAKER', 'HEADPHONE'] },
  { name: 'Keychron', cats: ['KEYBOARD'] },
  { name: 'Razer', cats: ['KEYBOARD', 'MOUSE', 'HEADPHONE', 'LAPTOP'] },
  { name: 'Corsair', cats: ['KEYBOARD', 'MOUSE', 'HEADPHONE'] },
  { name: 'Akko', cats: ['KEYBOARD'] },
  { name: 'Leopold', cats: ['KEYBOARD'] },
  { name: 'SteelSeries', cats: ['MOUSE', 'KEYBOARD', 'HEADPHONE'] },
  { name: 'Dare-U', cats: ['KEYBOARD', 'MOUSE'] },

  // Gaming console
  { name: 'PlayStation', cats: ['GAMING_CONSOLE'] },
  { name: 'Nintendo', cats: ['GAMING_CONSOLE'] },
  { name: 'Xbox', cats: ['GAMING_CONSOLE'] },
  { name: 'Steam Deck', cats: ['GAMING_CONSOLE'] },

  // Home appliance / kitchen
  { name: 'Electrolux', cats: ['WASHING', 'FRIDGE', 'KITCHEN', 'APPLIANCE'] },
  { name: 'Hitachi', cats: ['FRIDGE', 'AC', 'WASHING', 'APPLIANCE'] },
  { name: 'Daikin', cats: ['AC'] },
  { name: 'Mitsubishi', cats: ['AC'] },
  { name: 'Aqua', cats: ['FRIDGE', 'WASHING', 'AC'] },
  { name: 'Beko', cats: ['FRIDGE', 'WASHING', 'KITCHEN'] },
  { name: 'Bosch', cats: ['WASHING', 'FRIDGE', 'KITCHEN', 'APPLIANCE'] },
  { name: 'Sanaky', cats: ['FRIDGE', 'APPLIANCE'] },
  { name: 'Sunhouse', cats: ['KITCHEN', 'APPLIANCE'] },
  { name: 'Bluestone', cats: ['KITCHEN', 'APPLIANCE'] },
  { name: 'Lock&Lock', cats: ['KITCHEN'] },
  { name: 'Tefal', cats: ['KITCHEN', 'APPLIANCE'] },
  { name: 'Philips', cats: ['KITCHEN', 'APPLIANCE', 'TV'] },
  { name: 'Kangaroo', cats: ['KITCHEN', 'APPLIANCE'] },
  { name: 'Karofi', cats: ['APPLIANCE'] },
  { name: 'Dyson', cats: ['APPLIANCE'] },
  { name: 'Roborock', cats: ['APPLIANCE'] },
  { name: 'Ecovacs', cats: ['APPLIANCE'] },

  // Furniture
  { name: 'IKEA', cats: ['FURNITURE'] },
  { name: 'Hòa Phát', cats: ['FURNITURE'] },
  { name: 'Xuân Hòa', cats: ['FURNITURE'] },
  { name: 'Sihoo', cats: ['FURNITURE'] },
  { name: 'ErgoChair', cats: ['FURNITURE'] },
  { name: 'Maidesite', cats: ['FURNITURE'] },

  // Outdoor / other
  { name: 'Giant', cats: ['OTHER'] },
  { name: 'Breville', cats: ['KITCHEN', 'APPLIANCE'] },

  // Software / subscription brands — used by Subscription + Wishlist forms.
  { name: 'Netflix', cats: ['STREAMING'] },
  { name: 'YouTube Premium', cats: ['STREAMING', 'MUSIC'] },
  { name: 'Disney+', cats: ['STREAMING'] },
  { name: 'FPT Play', cats: ['STREAMING'] },
  { name: 'K+', cats: ['STREAMING'] },
  { name: 'Spotify', cats: ['MUSIC'] },
  { name: 'Apple Music', cats: ['MUSIC'] },
  { name: 'Apple One', cats: ['STREAMING', 'MUSIC', 'CLOUD_STORAGE'] },
  { name: 'iCloud+', cats: ['CLOUD_STORAGE'] },
  { name: 'Google One', cats: ['CLOUD_STORAGE', 'PRODUCTIVITY'] },
  { name: 'Dropbox', cats: ['CLOUD_STORAGE'] },
  { name: 'OneDrive / Microsoft 365', cats: ['CLOUD_STORAGE', 'PRODUCTIVITY'] },
  { name: 'OpenAI / ChatGPT', cats: ['AI_TOOL'] },
  { name: 'Anthropic / Claude', cats: ['AI_TOOL'] },
  { name: 'Google Gemini', cats: ['AI_TOOL'] },
  { name: 'Cursor', cats: ['DEV_TOOL', 'AI_TOOL'] },
  { name: 'GitHub', cats: ['DEV_TOOL'] },
  { name: 'GitHub Copilot', cats: ['DEV_TOOL', 'AI_TOOL'] },
  { name: 'JetBrains', cats: ['DEV_TOOL'] },
  { name: 'Vercel', cats: ['HOSTING', 'DEV_TOOL'] },
  { name: 'Cloudflare', cats: ['HOSTING'] },
  { name: 'AWS', cats: ['HOSTING', 'CLOUD_STORAGE'] },
  { name: 'Notion', cats: ['PRODUCTIVITY'] },
  { name: 'Figma', cats: ['PRODUCTIVITY', 'DEV_TOOL'] },
  { name: 'Adobe', cats: ['PRODUCTIVITY'] },
  { name: 'Canva', cats: ['PRODUCTIVITY'] },
  { name: 'PlayStation Plus', cats: ['GAME_SUB'] },
  { name: 'Xbox Game Pass', cats: ['GAME_SUB'] },
  { name: 'Nintendo Switch Online', cats: ['GAME_SUB'] },
  { name: 'Steam', cats: ['GAME_SUB'] },
  { name: 'NordVPN', cats: ['VPN_SECURITY'] },
  { name: '1Password', cats: ['VPN_SECURITY', 'PRODUCTIVITY'] },
  { name: 'Bitwarden', cats: ['VPN_SECURITY'] },
  { name: 'Coursera', cats: ['EDUCATION'] },
  { name: 'Udemy', cats: ['EDUCATION'] },
  { name: 'Duolingo', cats: ['EDUCATION'] },
  { name: 'New York Times', cats: ['NEWS'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Stores (nơi mua) — Vietnam market.
// ─────────────────────────────────────────────────────────────────────────────
const stores = [
  // Mobile / electronics chains
  { name: 'Thế Giới Di Động', type: 'BOTH' },
  { name: 'Điện Máy Xanh', type: 'BOTH' },
  { name: 'FPT Shop', type: 'BOTH' },
  { name: 'TopZone', type: 'BOTH' },
  { name: 'CellphoneS', type: 'BOTH' },
  { name: 'Hoàng Hà Mobile', type: 'BOTH' },
  { name: 'Di Động Việt', type: 'BOTH' },
  { name: 'Viettel Store', type: 'BOTH' },
  { name: 'Shopdunk', type: 'BOTH' },
  { name: 'Minh Tuấn Mobile', type: 'BOTH' },

  // Big electronics
  { name: 'Nguyễn Kim', type: 'BOTH' },
  { name: 'Pico', type: 'BOTH' },
  { name: 'MediaMart', type: 'BOTH' },
  { name: 'HC Home Center', type: 'BOTH' },

  // PC / IT
  { name: 'Phong Vũ', type: 'BOTH' },
  { name: 'Phúc Anh', type: 'BOTH' },
  { name: 'An Phát Computer', type: 'BOTH' },
  { name: 'GearVN', type: 'BOTH' },
  { name: 'Mai Hoàng', type: 'BOTH' },

  // Brand stores
  { name: 'Apple Store Online VN', type: 'ONLINE' },
  { name: 'Samsung Brand Store', type: 'BOTH' },
  { name: 'Mi Store / Xiaomi Store', type: 'BOTH' },
  { name: 'Sony Center', type: 'OFFLINE' },
  { name: 'LG Brand Shop', type: 'BOTH' },
  { name: 'Garmin Brand Store', type: 'OFFLINE' },

  // E-commerce
  { name: 'Shopee', type: 'ONLINE' },
  { name: 'Shopee Mall', type: 'ONLINE' },
  { name: 'Lazada', type: 'ONLINE' },
  { name: 'Lazada Mall', type: 'ONLINE' },
  { name: 'Tiki', type: 'ONLINE' },
  { name: 'Tiki Trading', type: 'ONLINE' },
  { name: 'Sendo', type: 'ONLINE' },

  // Photography
  { name: 'Mayer Camera', type: 'BOTH' },
  { name: 'Zshop Camera', type: 'BOTH' },
  { name: 'Binh Minh Digital', type: 'BOTH' },

  // Furniture
  { name: 'IKEA Singapore', type: 'OFFLINE' },
  { name: 'Hòa Phát Showroom', type: 'BOTH' },

  // Fallback
  { name: 'Mua xách tay nước ngoài', type: 'OFFLINE' },
  { name: 'Mua từ người dùng cá nhân', type: 'OFFLINE' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Warranty providers — phone/website are best-effort defaults at seed time.
// User can edit per-device after autofill; admin can update DB anytime.
// ─────────────────────────────────────────────────────────────────────────────
const providers = [
  {
    name: 'Apple Việt Nam (FPT Service)',
    phone: '1800 1192',
    websiteUrl: 'https://support.apple.com/vi-vn',
    notes: 'Bảo hành chính hãng phân phối bởi FPT. Mang theo hoá đơn hoặc tra qua serial trên Apple Check Coverage.',
  },
  {
    name: 'AppleCare+',
    phone: '1800 1192',
    websiteUrl: 'https://www.apple.com/vn/support/products/',
    notes: 'Gói bảo hành mở rộng của Apple, mua trong vòng 60 ngày sau khi mua máy. Hỗ trợ tai nạn (có phụ phí).',
  },
  {
    name: 'Samsung Vietnam',
    phone: '1800 588889',
    websiteUrl: 'https://www.samsung.com/vn/support/',
    notes: 'Bảo hành 12 tháng cho điện thoại, 24 tháng cho gia dụng. Có Samsung Care+ mua thêm.',
  },
  {
    name: 'Sony Vietnam',
    phone: '1800 588885',
    websiteUrl: 'https://www.sony.com.vn/vi/electronics/support',
    notes: 'Bảo hành chính hãng tại các trung tâm uỷ quyền Sony.',
  },
  {
    name: 'LG Vietnam',
    phone: '1800 1503',
    websiteUrl: 'https://www.lg.com/vn/support',
    notes: 'Bảo hành tận nhà cho các sản phẩm cồng kềnh (tủ lạnh, máy giặt, TV).',
  },
  {
    name: 'Xiaomi Vietnam',
    phone: '1800 6601',
    websiteUrl: 'https://www.mi.com/vn/service/',
    notes: 'Bảo hành tại Mi Store hoặc trung tâm uỷ quyền. Thiết bị xách tay không được bảo hành chính hãng.',
  },
  {
    name: 'OPPO Vietnam',
    phone: '1800 577776',
    websiteUrl: 'https://www.oppo.com/vn/support/',
  },
  {
    name: 'Vivo Vietnam',
    phone: '1800 545413',
    websiteUrl: 'https://www.vivo.com/vn/support',
  },
  {
    name: 'Realme Vietnam',
    phone: '1800 6068',
    websiteUrl: 'https://www.realme.com/vn/support',
  },
  {
    name: 'Huawei Vietnam',
    phone: '1800 558865',
    websiteUrl: 'https://consumer.huawei.com/vn/support/',
  },
  {
    name: 'Asus Vietnam',
    phone: '1800 6588',
    websiteUrl: 'https://www.asus.com/vn/support/',
    notes: 'Bảo hành 24 tháng tiêu chuẩn cho laptop. Có gói Asus Premium Care.',
  },
  {
    name: 'Dell Vietnam',
    phone: '1800 545458',
    websiteUrl: 'https://www.dell.com/support/home/vi-vn',
    notes: 'Hỗ trợ ProSupport tận nơi cho dòng máy cao cấp.',
  },
  {
    name: 'HP Vietnam',
    phone: '1800 588868',
    websiteUrl: 'https://support.hp.com/vn-vi',
  },
  {
    name: 'Lenovo Vietnam',
    phone: '1800 6592',
    websiteUrl: 'https://support.lenovo.com/vn/vi',
    notes: 'Có gói Premium Care nâng cấp bảo hành lên onsite/24 tháng.',
  },
  {
    name: 'Acer Vietnam',
    phone: '1800 6699',
    websiteUrl: 'https://www.acer.com/vn-vi/support',
  },
  {
    name: 'MSI Vietnam',
    phone: '1900 6663',
    websiteUrl: 'https://vn.msi.com/support',
  },
  {
    name: 'Microsoft Vietnam',
    phone: '1800 1095',
    websiteUrl: 'https://support.microsoft.com/vi-vn',
  },
  {
    name: 'Panasonic Vietnam',
    phone: '1800 8100',
    websiteUrl: 'https://www.panasonic.com/vn/support.html',
  },
  {
    name: 'Toshiba / Aqua Vietnam',
    phone: '1800 1717',
    websiteUrl: 'https://aquavietnam.com.vn/cham-soc-khach-hang',
  },
  {
    name: 'Sharp Vietnam',
    phone: '1800 1517',
    websiteUrl: 'https://vn.sharp/support',
  },
  {
    name: 'Electrolux Vietnam',
    phone: '1800 588899',
    websiteUrl: 'https://www.electrolux.vn/support/',
  },
  {
    name: 'Philips Vietnam',
    phone: '1800 6788',
    websiteUrl: 'https://www.philips.com.vn/support',
  },
  {
    name: 'Bosch Vietnam (BSH)',
    phone: '1800 6868',
    websiteUrl: 'https://www.bosch-home.com.vn/customer-service',
  },
  {
    name: 'Daikin Vietnam',
    phone: '1800 1565',
    websiteUrl: 'https://www.daikin.com.vn/cham-soc-khach-hang/',
  },
  {
    name: 'Mitsubishi Electric Vietnam',
    phone: '1800 5589 89',
    websiteUrl: 'https://www.mitsubishielectric.com/vn',
  },
  {
    name: 'Casper Vietnam',
    phone: '1800 5588 33',
    websiteUrl: 'https://casper.com.vn/cham-soc-khach-hang',
  },
  {
    name: 'Hitachi Vietnam',
    phone: '1800 1751',
    websiteUrl: 'https://www.hitachiconsumer-vn.com/support',
  },
  {
    name: 'Beko Vietnam',
    phone: '1800 6505',
    websiteUrl: 'https://www.beko.com/vn-vi/support',
  },
  {
    name: 'Canon Marketing Vietnam',
    phone: '1800 545424',
    websiteUrl: 'https://vn.canon/vi/support',
  },
  {
    name: 'Nikon Vietnam',
    phone: '1800 599964',
    websiteUrl: 'https://www.nikon.com.vn/support',
  },
  {
    name: 'Garmin Vietnam',
    phone: '1800 599953',
    websiteUrl: 'https://www.garmin.com.vn/dich-vu/',
  },
  {
    name: 'Sony PlayStation Vietnam',
    phone: '1800 588885',
    websiteUrl: 'https://www.playstation.com/vi-vn/support/',
    notes: 'Bảo hành qua Sony Vietnam (Sony Marketing).',
  },
  {
    name: 'Logitech Vietnam (DGW phân phối)',
    websiteUrl: 'https://www.logitech.com/vi-vn/support',
    notes: 'Bảo hành qua nhà phân phối DGW; mang sản phẩm tới đại lý uỷ quyền.',
  },
  {
    name: 'Bose Vietnam',
    phone: '1800 599967',
    websiteUrl: 'https://www.bose.vn/vi/support',
  },
  {
    name: 'Sennheiser Vietnam (Music Mountain)',
    phone: '1900 6699',
    websiteUrl: 'https://musicmountain.vn',
  },
  {
    name: 'Karofi Vietnam',
    phone: '1900 6418',
    websiteUrl: 'https://karofi.com',
  },
  {
    name: 'Dyson Vietnam',
    phone: '1800 6817',
    websiteUrl: 'https://www.dyson.vn/support',
  },
  {
    name: 'Bảo hành cửa hàng (CellphoneS / FPT / TGDĐ)',
    notes: 'Bảo hành mở rộng do nơi bán cung cấp. Mang theo hoá đơn và tem niêm phong.',
  },
  {
    name: 'Bảo hành xách tay (cửa hàng cá nhân)',
    notes: 'Bảo hành theo cam kết của bên bán xách tay, không qua hãng.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────
console.log('Seeding categories...');
for (const c of categories) {
  await prisma.category.upsert({
    where: { code: c.code },
    update: { name: c.name, sortOrder: c.sortOrder, isActive: true },
    create: { code: c.code, name: c.name, sortOrder: c.sortOrder },
  });
}
console.log(`  ${categories.length} categories`);

console.log('Seeding brands...');
const seenBrandSlugs = new Set();
for (const b of brands) {
  const slug = slugify(b.name);
  if (seenBrandSlugs.has(slug)) {
    console.warn(`  duplicate brand slug, skip: ${b.name}`);
    continue;
  }
  seenBrandSlugs.add(slug);
  const brand = await prisma.brand.upsert({
    where: { slug },
    update: { name: b.name, isActive: true },
    create: { name: b.name, slug },
  });
  // Reset categories for idempotent re-runs
  await prisma.brandCategory.deleteMany({ where: { brandId: brand.id } });
  for (const cat of b.cats ?? []) {
    await prisma.brandCategory.create({
      data: { brandId: brand.id, categoryCode: cat },
    });
  }
}
console.log(`  ${seenBrandSlugs.size} brands`);

console.log('Seeding stores...');
const seenStoreSlugs = new Set();
for (const s of stores) {
  const slug = slugify(s.name);
  if (seenStoreSlugs.has(slug)) continue;
  seenStoreSlugs.add(slug);
  await prisma.store.upsert({
    where: { slug },
    update: { name: s.name, type: s.type ?? 'BOTH', isActive: true },
    create: { name: s.name, slug, type: s.type ?? 'BOTH' },
  });
}
console.log(`  ${seenStoreSlugs.size} stores`);

console.log('Seeding warranty providers...');
const seenProviderSlugs = new Set();
for (const p of providers) {
  const slug = slugify(p.name);
  if (seenProviderSlugs.has(slug)) continue;
  seenProviderSlugs.add(slug);
  await prisma.warrantyProvider.upsert({
    where: { slug },
    update: {
      name: p.name,
      phone: p.phone ?? null,
      address: p.address ?? null,
      websiteUrl: p.websiteUrl ?? null,
      notes: p.notes ?? null,
      isActive: true,
    },
    create: {
      name: p.name,
      slug,
      phone: p.phone ?? null,
      address: p.address ?? null,
      websiteUrl: p.websiteUrl ?? null,
      notes: p.notes ?? null,
    },
  });
}
console.log(`  ${seenProviderSlugs.size} warranty providers`);

await prisma.$disconnect();
console.log('Done.');
