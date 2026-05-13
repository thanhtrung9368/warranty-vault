import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { addMonths } from 'date-fns';

const TEST_EMAIL = 'test@local.test';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/warranty_vault_dev';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
if (!user) {
  console.error(`Không tìm thấy user ${TEST_EMAIL}. Chạy 'node scripts/seed-test-user.mjs' trước.`);
  process.exit(1);
}

const today = new Date('2026-04-25T00:00:00Z');

// purchaseDate is computed so that endDate = purchaseDate + months
// lands `daysFromToday` days from today (positive = future, negative = past).
function purchaseDateForEnd(daysFromToday, months) {
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + daysFromToday);
  const purchase = new Date(end);
  purchase.setUTCMonth(purchase.getUTCMonth() - months);
  return purchase;
}

// Each device entry:
// - core fields
// - warranties: array of { type, provider, months, daysFromToday, cost?, address?, phone?, notes? }
const devices = [
  // Laptop (4)
  {
    name: 'MacBook Pro 14" M3', category: 'LAPTOP', brand: 'Apple', model: 'MBP14 M3 Pro',
    purchasePrice: 52_000_000, place: 'Apple Store Saigon Centre', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Apple Việt Nam', months: 12, daysFromToday: 200 },
      { type: 'EXTENDED', provider: 'AppleCare+ for Mac', months: 36, daysFromToday: 200 + 730, cost: 7_500_000, notes: 'Bảo vệ tai nạn 2 lần/năm.' },
    ],
  },
  {
    name: 'Dell XPS 15', category: 'LAPTOP', brand: 'Dell', model: 'XPS 15 9530',
    purchasePrice: 38_000_000, place: 'FPT Shop', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Dell Vietnam', months: 24, daysFromToday: 7, phone: '1800 5454 80' },
    ],
  },
  {
    name: 'Asus ROG Strix G16', category: 'LAPTOP', brand: 'Asus', model: 'G614JV',
    purchasePrice: 42_500_000, place: 'Phong Vũ', status: 'EXPIRED',
    warranties: [
      { type: 'STANDARD', provider: 'Asus Service', months: 24, daysFromToday: -120 },
    ],
  },
  {
    name: 'ThinkPad X1 Carbon', category: 'LAPTOP', brand: 'Lenovo', model: 'X1 Carbon Gen 11',
    purchasePrice: 45_000_000, place: 'Lenovo Store', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Lenovo VN', months: 36, daysFromToday: 500 },
      { type: 'THIRD_PARTY', provider: 'Bảo hiểm thẻ Visa Platinum', months: 12, daysFromToday: 200, notes: 'Mở rộng thêm 1 năm khi quẹt thẻ.' },
    ],
  },

  // Phone (5)
  {
    name: 'iPhone 15 Pro Max', category: 'PHONE', brand: 'Apple', model: 'iPhone 15 Pro Max 256GB',
    purchasePrice: 34_990_000, place: 'TopZone', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Apple Việt Nam', months: 12, daysFromToday: 30 },
      { type: 'EXTENDED', provider: 'AppleCare+', months: 24, daysFromToday: 395, cost: 5_990_000, notes: 'Đã đăng ký qua Apple ID.' },
    ],
  },
  {
    name: 'iPhone 13', category: 'PHONE', brand: 'Apple', model: 'iPhone 13 128GB',
    purchasePrice: 18_000_000, place: 'CellphoneS', status: 'SOLD',
    warranties: [
      { type: 'STANDARD', provider: 'Apple', months: 12, daysFromToday: -300 },
    ],
  },
  {
    name: 'Samsung Galaxy S24 Ultra', category: 'PHONE', brand: 'Samsung', model: 'SM-S928B',
    purchasePrice: 31_990_000, place: 'Thế Giới Di Động', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Samsung VN', months: 12, daysFromToday: 90 },
      { type: 'EXTENDED', provider: 'Samsung Care+', months: 24, daysFromToday: 455, cost: 4_290_000 },
    ],
  },
  {
    name: 'Xiaomi 14', category: 'PHONE', brand: 'Xiaomi', model: '14 Pro',
    purchasePrice: 22_000_000, place: 'Mi Store', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Xiaomi VN', months: 18, daysFromToday: 250 },
    ],
  },
  {
    name: 'Pixel 7', category: 'PHONE', brand: 'Google', model: 'Pixel 7 128GB',
    purchasePrice: 12_500_000, place: 'Xách tay Mỹ', status: 'BROKEN',
    warranties: [], // no warranty (xách tay)
  },

  // Tablet (3)
  {
    name: 'iPad Pro 12.9 M2', category: 'TABLET', brand: 'Apple', model: 'iPad Pro 12.9" M2 256GB',
    purchasePrice: 28_000_000, place: 'iCenter', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Apple Việt Nam', months: 12, daysFromToday: 60 },
      { type: 'EXTENDED', provider: 'AppleCare+ for iPad', months: 24, daysFromToday: 425, cost: 3_290_000 },
    ],
  },
  {
    name: 'iPad Air 5', category: 'TABLET', brand: 'Apple', model: 'iPad Air 5 64GB Wifi',
    purchasePrice: 15_500_000, place: 'Shopee Mall', status: 'EXPIRED',
    warranties: [
      { type: 'STANDARD', provider: 'Apple', months: 12, daysFromToday: -30 },
    ],
  },
  {
    name: 'Galaxy Tab S9', category: 'TABLET', brand: 'Samsung', model: 'SM-X710',
    purchasePrice: 19_990_000, place: 'Samsung Showroom', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Samsung VN', months: 12, daysFromToday: 150 },
    ],
  },

  // Appliance (6)
  {
    name: 'Máy giặt LG Inverter 9kg', category: 'APPLIANCE', brand: 'LG', model: 'FV1409S4W',
    purchasePrice: 9_990_000, place: 'Điện Máy Xanh', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'LG Service', months: 24, daysFromToday: 365, phone: '1800 1503' },
      { type: 'EXTENDED', provider: 'ĐMX bảo hành mở rộng', months: 12, daysFromToday: 365 + 365, cost: 690_000 },
    ],
  },
  {
    name: 'Tủ lạnh Panasonic 2 cánh', category: 'APPLIANCE', brand: 'Panasonic', model: 'NR-BV361WGKV',
    purchasePrice: 14_500_000, place: 'Nguyễn Kim', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Panasonic VN', months: 24, daysFromToday: 720 },
    ],
  },
  {
    name: 'Nồi cơm điện Toshiba', category: 'APPLIANCE', brand: 'Toshiba', model: 'RC-18NMFEIS',
    purchasePrice: 2_490_000, place: 'Tiki', status: 'EXPIRED',
    warranties: [
      { type: 'STANDARD', provider: 'Toshiba VN', months: 12, daysFromToday: -180 },
    ],
  },
  {
    name: 'Lò vi sóng Sharp', category: 'APPLIANCE', brand: 'Sharp', model: 'R-G272VN-S',
    purchasePrice: 1_890_000, place: 'Coopmart', status: 'EXPIRED',
    warranties: [
      { type: 'STANDARD', provider: 'Sharp VN', months: 12, daysFromToday: -60 },
    ],
  },
  {
    name: 'Máy lọc nước Karofi', category: 'APPLIANCE', brand: 'Karofi', model: 'KAQ-U95',
    purchasePrice: 6_790_000, place: 'Đại lý Karofi', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Karofi', months: 36, daysFromToday: 800 },
    ],
  },
  {
    name: 'Máy hút bụi Dyson V11', category: 'APPLIANCE', brand: 'Dyson', model: 'V11 Absolute',
    purchasePrice: 16_900_000, place: 'Dyson Demo Store', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Dyson VN', months: 24, daysFromToday: 30 },
    ],
  },

  // Electronics (6)
  {
    name: 'TV Sony Bravia 55"', category: 'ELECTRONICS', brand: 'Sony', model: 'KD-55X80L',
    purchasePrice: 18_900_000, place: 'Sony Center', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Sony VN', months: 24, daysFromToday: 7 },
    ],
  },
  {
    name: 'Loa Sonos Move', category: 'ELECTRONICS', brand: 'Sonos', model: 'Move 2',
    purchasePrice: 11_500_000, place: 'Vinh Studio', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Sonos', months: 12, daysFromToday: 180 },
    ],
  },
  {
    name: 'Tai nghe AirPods Pro 2', category: 'ELECTRONICS', brand: 'Apple', model: 'AirPods Pro 2 USB-C',
    purchasePrice: 5_990_000, place: 'TopZone', status: 'EXPIRED',
    warranties: [
      { type: 'STANDARD', provider: 'Apple', months: 12, daysFromToday: -45 },
    ],
  },
  {
    name: 'Camera Canon EOS R6', category: 'ELECTRONICS', brand: 'Canon', model: 'EOS R6 Mark II',
    purchasePrice: 65_000_000, place: 'Mayer Camera', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Canon Marketing VN', months: 24, daysFromToday: 400 },
      { type: 'EXTENDED', provider: 'Mayer Care', months: 12, daysFromToday: 765, cost: 2_500_000 },
    ],
  },
  {
    name: 'Robot hút bụi Roborock', category: 'ELECTRONICS', brand: 'Roborock', model: 'S8 Pro Ultra',
    purchasePrice: 22_500_000, place: 'Lazada', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Roborock VN', months: 24, daysFromToday: 90 },
    ],
  },
  {
    name: 'Bàn phím Keychron Q1', category: 'ELECTRONICS', brand: 'Keychron', model: 'Q1 Pro',
    purchasePrice: 4_200_000, place: 'Khoa Mua Bán', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Khoa Mua Bán', months: 12, daysFromToday: 200 },
    ],
  },

  // Furniture (3)
  {
    name: 'Ghế công thái học Sihoo', category: 'FURNITURE', brand: 'Sihoo', model: 'M57',
    purchasePrice: 4_990_000, place: 'Shopee', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Sihoo VN', months: 36, daysFromToday: 600 },
    ],
  },
  {
    name: 'Bàn nâng hạ Maidesite', category: 'FURNITURE', brand: 'Maidesite', model: 'T2 Pro',
    purchasePrice: 8_500_000, place: 'Maidesite Official', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Maidesite', months: 60, daysFromToday: 1500 },
    ],
  },
  {
    name: 'Sofa da IKEA Landskrona', category: 'FURNITURE', brand: 'IKEA', model: 'Landskrona 3 chỗ',
    purchasePrice: 25_000_000, place: 'IKEA Singapore', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'IKEA', months: 120, daysFromToday: 3000 },
    ],
  },

  // Other (3)
  {
    name: 'Đồng hồ Garmin Fenix 7', category: 'OTHER', brand: 'Garmin', model: 'Fenix 7 Sapphire',
    purchasePrice: 18_500_000, place: 'Garmin Store', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Garmin VN', months: 24, daysFromToday: 30 },
    ],
  },
  {
    name: 'Xe đạp Giant Escape', category: 'OTHER', brand: 'Giant', model: 'Escape 3 2024',
    purchasePrice: 10_900_000, place: 'Giant Vietnam', status: 'ACTIVE',
    warranties: [
      { type: 'STANDARD', provider: 'Giant', months: 60, daysFromToday: 1800, notes: 'Bảo hành khung trọn đời, phụ tùng 5 năm.' },
    ],
  },
  {
    name: 'Máy pha cà phê Breville', category: 'OTHER', brand: 'Breville', model: 'Barista Express',
    purchasePrice: 16_900_000, place: 'Breville Authorized', status: 'LOST',
    warranties: [
      { type: 'STANDARD', provider: 'Breville', months: 24, daysFromToday: -200 },
    ],
  },
];

if (devices.length !== 30) {
  console.error(`Cần đúng 30 thiết bị, hiện có ${devices.length}`);
  process.exit(1);
}

const existing = await prisma.device.count({ where: { userId: user.id } });
if (existing > 0) {
  console.log(`Xoá ${existing} thiết bị cũ của ${user.email}...`);
  await prisma.device.deleteMany({ where: { userId: user.id } });
}

let created = 0;
let warrantyCount = 0;
for (const d of devices) {
  // Earliest warranty start = device.purchaseDate; fall back to today if no warranties.
  let purchaseDate = today;
  if (d.warranties.length > 0) {
    const standard = d.warranties.find((w) => w.type === 'STANDARD') ?? d.warranties[0];
    purchaseDate = purchaseDateForEnd(standard.daysFromToday, standard.months);
  } else {
    // No warranties — pick a plausible past purchase date.
    purchaseDate = new Date(today);
    purchaseDate.setUTCDate(purchaseDate.getUTCDate() - 365);
  }

  await prisma.device.create({
    data: {
      userId: user.id,
      name: d.name,
      category: d.category,
      brand: d.brand,
      model: d.model,
      purchaseDate,
      purchasePrice: d.purchasePrice,
      purchasePlace: d.place,
      status: d.status,
      warranties: {
        create: d.warranties.map((w) => {
          const start = w.type === 'STANDARD'
            ? purchaseDate
            : purchaseDateForEnd(w.daysFromToday, w.months);
          return {
            type: w.type,
            provider: w.provider ?? null,
            startDate: start,
            endDate: addMonths(start, w.months),
            months: w.months,
            cost: w.cost ?? null,
            address: w.address ?? null,
            phone: w.phone ?? null,
            notes: w.notes ?? null,
          };
        }),
      },
    },
  });
  created++;
  warrantyCount += d.warranties.length;
}

console.log(`OK: tạo ${created} thiết bị, ${warrantyCount} gói bảo hành cho ${user.email}`);
await prisma.$disconnect();
