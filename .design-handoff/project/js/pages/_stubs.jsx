/* Stub */
function Stub({ title = 'WIP' }) {
  return <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}><h2>{title} — đang xây</h2></div>;
}
window.PAGES = window.PAGES || {};
Object.assign(window.PAGES, {
  DevicesList: () => <Stub title="Thiết bị"/>,
  DeviceDetail: () => <Stub title="Chi tiết thiết bị"/>,
  DeviceForm: () => <Stub title="Form thiết bị"/>,
  SubscriptionsList: () => <Stub title="Gói đăng ký"/>,
  SubscriptionDetail: () => <Stub title="Chi tiết gói"/>,
  SubscriptionForm: () => <Stub title="Form gói"/>,
  WishlistList: () => <Stub title="Wishlist"/>,
  WishlistDetail: () => <Stub title="Chi tiết wishlist"/>,
  WishlistForm: () => <Stub title="Form wishlist"/>,
  Reminders: () => <Stub title="Nhắc nhở"/>,
  Stats: () => <Stub title="Thống kê"/>,
  Settings: () => <Stub title="Cài đặt"/>,
});
