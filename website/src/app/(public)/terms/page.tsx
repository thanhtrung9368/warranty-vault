import type { Metadata } from 'next';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('Điều khoản sử dụng — Warranty Vault'),
    description: t('Điều khoản sử dụng dịch vụ Warranty Vault'),
  };
}

const UPDATED = '05/06/2026';

// Long-form legal copy; see the note in `privacy/page.tsx` about splitting a
// paragraph at inline markup. Email addresses are data, not copy.
export default async function TermsPage() {
  const { t } = await getI18n();
  return (
    <article className="prose prose-slate max-w-none dark:prose-invert">
      <h1 className="display text-3xl">{t('Điều khoản sử dụng')}</h1>
      <p className="text-sm text-muted">{t('Cập nhật lần cuối: {date}', { date: UPDATED })}</p>

      <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-ink-2">
        <p>
          {t(
            'Dùng Warranty Vault tức là mày đồng ý với các điều khoản dưới đây. Bọn tao cố giữ chúng ngắn và dễ hiểu.',
          )}
        </p>

        <div>
          <h3 className="display text-lg">{t('1. Dịch vụ & mục đích cá nhân')}</h3>
          <p className="mt-2">
            {t(
              'Warranty Vault là công cụ cá nhân để quản lý thiết bị, bảo hành, gói đăng ký và wishlist của chính mày. Đừng dùng để lưu trữ dữ liệu của người khác khi chưa được họ cho phép.',
            )}
          </p>
        </div>

        <div>
          <h3 className="display text-lg">{t('2. Tài khoản & bảo mật')}</h3>
          <p className="mt-2">
            {t(
              'Mày chịu trách nhiệm giữ mật khẩu an toàn và mọi hoạt động dưới tài khoản của mình. Báo cho bọn tao ngay nếu nghi ngờ tài khoản bị truy cập trái phép.',
            )}
          </p>
        </div>

        <div>
          <h3 className="display text-lg">{t('3. Nội dung của mày')}</h3>
          <p className="mt-2">
            {t(
              'Mày sở hữu dữ liệu mình nhập và tải lên. Mày tự đảm bảo nội dung đó hợp pháp và mày có quyền lưu trữ nó. Bọn tao không yêu cầu quyền sở hữu nội dung của mày.',
            )}
          </p>
        </div>

        <div>
          <h3 className="display text-lg">{t('4. Giới hạn sử dụng')}</h3>
          <p className="mt-2">
            {t(
              'Để hệ thống chạy ổn cho mọi người, mỗi tài khoản có một số giới hạn (số thiết bị, số gói bảo hành/đính kèm mỗi thiết bị, dung lượng tải lên, số subscription/wishlist). Khi chạm giới hạn, ứng dụng sẽ báo bằng tiếng Việt.',
            )}
          </p>
        </div>

        <div>
          <h3 className="display text-lg">{t('5. Không bảo đảm')}</h3>
          <p className="mt-2">
            {t(
              'Dịch vụ được cung cấp “nguyên trạng” (as-is). Bọn tao cố gắng giữ dữ liệu an toàn và nhắc nhở đúng hạn, nhưng không bảo đảm dịch vụ không gián đoạn hay không có lỗi. Hãy tự sao lưu dữ liệu quan trọng (Cài đặt → Dữ liệu → Sao lưu).',
            )}
          </p>
        </div>

        <div>
          <h3 className="display text-lg">{t('6. Chấm dứt')}</h3>
          <p className="mt-2">
            {t(
              'Mày có thể xoá tài khoản bất cứ lúc nào trong phần Cài đặt — toàn bộ dữ liệu sẽ bị xoá vĩnh viễn. Bọn tao có thể tạm ngưng tài khoản nếu phát hiện hành vi lạm dụng hệ thống.',
            )}
          </p>
        </div>

        <div>
          <h3 className="display text-lg">{t('7. Liên hệ')}</h3>
          <p className="mt-2">
            {t('Có thắc mắc:')}{' '}
            <a href="mailto:hi@warrantyvault.app" className="font-semibold text-primary hover:underline">
              hi@warrantyvault.app
            </a>
          </p>
        </div>
      </div>
    </article>
  );
}
