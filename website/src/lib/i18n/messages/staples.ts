// Essentials / "đồ dùng thiết yếu" — web copy.
//
// Shared keys ("Tên", "Trạng thái", "Ghi chú", "Lưu", "Huỷ", "Sửa", "Xoá",
// "Còn {days} ngày", "Hôm nay", "Thử lại") already live in common/device/
// wishlist catalogs and are deliberately NOT repeated here: one Vietnamese key
// can only have one English translation, and the i18n merge test enforces it.

import { defineMessages } from '../types';

export const staples = defineMessages({
  'Đồ dùng thiết yếu': 'Essentials',
  'Sắp hết, nhắc mua lại': 'Running low, restock reminders',
  'Nhắc mua lại khi sắp hết — theo chu kỳ hoặc thủ công.':
    'Restock reminders when you run low — by cadence or manually.',
  'Cần mua': 'To buy',
  'Đủ dùng': 'In stock',
  'Thêm đồ dùng': 'Add essential',
  'Sửa đồ dùng': 'Edit essential',
  'Nhóm': 'Category',
  'Đơn vị': 'Unit',
  'Sắp hết': 'Running low',
  'Đã hết': 'Out',
  'Đã mua lại': 'Bought again',
  'Nhắc theo tần suất': 'Repeat reminder',
  'Lần mua gần nhất': 'Last bought',
  'Chưa có đồ dùng nào': 'No essentials yet',
  'Thêm món đầu tiên để nhắc mua lại khi sắp hết.':
    'Add your first item to get a restock reminder when it runs low.',
  'Đến lúc kiểm tra': 'Time to check',
  'Không tải được đồ dùng': 'Could not load essentials',
  'Đã lưu': 'Saved',
  'Đang lưu…': 'Saving…',
  'Tên đồ dùng là bắt buộc': 'Essential name is required',
  'Số ngày phải từ 1 đến 3650': 'Days must be between 1 and 3650',
  'Đồ dùng': 'Essentials',
  'Ghi chú thêm...': 'Add a note...',
  'Nhắc mua lại': 'Restock reminder',
  'Mua gần nhất: {date}': 'Last bought: {date}',
  'Không nhắc': 'No reminder',
  'Xoá đồ dùng?': 'Delete essential?',
  'Không tìm thấy đồ dùng': 'Essential not found',
  'Dầu gội, kem đánh răng...': 'Shampoo, toothpaste...',
  'Đồ dùng cá nhân...': 'Personal care...',
  'chai, tuýp, gói...': 'bottle, tube, pack...',
  'Đồ dùng cá nhân': 'Personal care',
  'Đồ dùng nhà cửa': 'Household',
  'Đồ dùng nhà bếp': 'Kitchen',
  'Đồ dùng vệ sinh': 'Cleaning',
  'Thực phẩm khô': 'Pantry',
  'Đồ dùng em bé': 'Baby',
  'Đồ dùng thú cưng': 'Pet',
  'Đồ dùng xe': 'Car',
  'Văn phòng': 'Office',
  'Chọn nhóm': 'Choose a category',
  'Nhóm khác...': 'Other category...',
});
