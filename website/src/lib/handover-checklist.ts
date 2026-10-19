// Pre-service handover checklist, generated per device.
//
// Why a generated list rather than one static page: the failure this prevents
// is concrete and per-device — arriving at a Vietnamese service counter with a
// locked phone, no backup, or a box whose IMEI does not match the invoice. The
// generator therefore knows the device's category (phone vs laptop vs an
// appliance with no account at all), its serial, where it was bought and when
// its warranty ends, and writes those facts into the list.
//
// Scope, stated plainly: this is a CHECKLIST, not a record. Nothing here is
// persisted; the client component keeps ticks in React state and they are gone
// on reload. Persisting them would need an API field and is deliberately out of
// scope for this change.
//
// Content notes — what was added beyond the seven items in the brief, and why:
//   * Activation Lock / FRP: signing out is not enough if Find My stays on; it
//     is the single most common reason a Vietnamese counter refuses a handset.
//   * 2FA / SIM / eSIM: wiping a phone can also wipe the authenticator app and
//     the eSIM, locking the owner out of the accounts they were trying to
//     protect. Retailers may wipe on intake, so this has to be done first.
//   * "erase last": the order is the part people get wrong, and it is
//     irreversible.
//   * warranty seal: opening the device or using an outside shop can void the
//     warranty, which is exactly what a counter checks.
//   * intake slip + who wipes data: the handover is a two-sided transaction;
//     the slip is the only evidence of what was handed over.
//   * pickup check: the same evidence is needed on the way out.
//
// All copy is keyed on the Vietnamese sentence and registered in
// `lib/i18n/messages/handover.ts`. `__tests__/handover-checklist.test.ts`
// generates every variant in English and fails if any string is still
// Vietnamese, so an unregistered key cannot ship silently.

import { toDayDate } from '@/lib/api-day';
import { formatDate } from '@/lib/format';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

export type HandoverGroupId =
  | 'data'
  | 'condition'
  | 'paperwork'
  | 'counter'
  | 'pickup';

export type HandoverItemId =
  | 'backup'
  | 'sign-out'
  | 'activation-lock'
  | 'passcode'
  | 'two-factor'
  | 'reset'
  | 'photos'
  | 'faults'
  | 'warranty-seal'
  | 'invoice'
  | 'box'
  | 'warranty-end'
  | 'terms'
  | 'accessories'
  | 'intake-slip'
  | 'wipe-policy'
  | 'pickup-check';

export type HandoverChecklistItem = {
  id: HandoverItemId;
  title: string;
  detail?: string;
};

export type HandoverChecklistGroup = {
  id: HandoverGroupId;
  title: string;
  items: HandoverChecklistItem[];
};

export type HandoverChecklist = {
  groups: HandoverChecklistGroup[];
  /** Sum of item counts; the page renders it as the progress denominator. */
  total: number;
};

export type HandoverChecklistInput = {
  category?: string | null;
  serialNumber?: string | null;
  purchasePlace?: string | null;
  /** Effective warranty end (max end date across the device's warranties). */
  warrantyEnd?: string | Date | null;
};

export type HandoverPrepKind = 'phone' | 'computer' | 'none';

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatDayValue(value: string | Date | null | undefined, locale: Locale): string | null {
  if (value == null) return null;
  // Local midnight for a calendar day: `new Date('2027-06-15')` is UTC midnight
  // and printed the 14th to an English reader west of UTC.
  const date = toDayDate(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(date, locale);
}

/**
 * Which data/account preparation applies.
 *
 * Phones, tablets and watches share the iCloud/Google/Mi story. A laptop has
 * Microsoft, Find My Mac and disk encryption instead. Everything else — a
 * fridge, a TV, a keyboard — has no passcode or account to sign out of as far
 * as this checklist is concerned, so that group is omitted rather than filled
 * with irrelevant ticks. The condition/paperwork/counter groups still apply.
 */
export function handoverPrepKind(
  category: string | null | undefined,
): HandoverPrepKind {
  switch (clean(category).toUpperCase()) {
    case 'PHONE':
    case 'TABLET':
    case 'SMARTWATCH':
      return 'phone';
    case 'LAPTOP':
      return 'computer';
    default:
      return 'none';
  }
}

function phoneDataItems(locale: Locale): HandoverChecklistItem[] {
  return [
    {
      id: 'backup',
      title: translate(locale, 'Sao lưu ảnh, danh bạ và dữ liệu trước khi đi'),
      detail: translate(
        locale,
        'Cửa hàng có thể xoá dữ liệu khi tiếp nhận. Sao lưu vào iCloud/Google Drive hoặc máy tính, rồi mở thử một file để chắc bản sao dùng được.',
      ),
    },
    {
      id: 'sign-out',
      title: translate(locale, 'Đăng xuất iCloud, Google và Mi Cloud'),
      detail: translate(
        locale,
        'Đăng xuất mọi tài khoản đang đăng nhập trên máy. Máy còn iCloud/Find My hoặc tài khoản Google có thể bị từ chối tiếp nhận hoặc không mở được sau khi sửa.',
      ),
    },
    {
      id: 'activation-lock',
      title: translate(
        locale,
        'Tắt Find My và khoá kích hoạt (Activation Lock/FRP)',
      ),
      detail: translate(
        locale,
        'Tắt Find My iPhone/Find My Device trước khi đăng xuất. Chỉ xoá máy sau khi đã tắt — nếu không, máy có thể bị khoá lại và không ai mở được.',
      ),
    },
    {
      id: 'passcode',
      title: translate(
        locale,
        'Gỡ mật khẩu màn hình, Face ID/Touch ID và khoá ứng dụng',
      ),
      detail: translate(
        locale,
        'Máy còn passcode hoặc khoá sinh trắc học có thể bị từ chối ngay ở quầy tiếp nhận. Gỡ mọi khoá trước khi giao, kể cả khoá ứng dụng ngân hàng.',
      ),
    },
    {
      id: 'two-factor',
      title: translate(
        locale,
        'Chuyển mã 2FA, tháo SIM và eSIM trước khi xoá máy',
      ),
      detail: translate(
        locale,
        'Ứng dụng xác thực và eSIM có thể mất khi xoá máy. Xuất mã dự phòng, đăng nhập ứng dụng xác thực trên máy khác, tháo SIM/thẻ nhớ; với eSIM hỏi nhà mạng cách chuyển.',
      ),
    },
    {
      id: 'reset',
      title: translate(locale, 'Chỉ xoá máy sau khi đã sao lưu và đăng xuất'),
      detail: translate(
        locale,
        'Xoá máy là bước cuối, không phải bước đầu. Nếu chưa chắc có bản sao hoặc chưa thoát tài khoản, đừng xoá — cửa hàng có thể tự xoá khi tiếp nhận, nhưng bạn vẫn nên chủ động.',
      ),
    },
  ];
}

function computerDataItems(locale: Locale): HandoverChecklistItem[] {
  return [
    {
      id: 'backup',
      title: translate(locale, 'Sao lưu dữ liệu và lưu khoá mã hoá ổ đĩa'),
      detail: translate(
        locale,
        'Cửa hàng có thể xoá dữ liệu khi tiếp nhận. Sao lưu tài liệu, ảnh và bookmark ra ổ ngoài hoặc cloud; nếu Windows dùng BitLocker, lưu luôn recovery key.',
      ),
    },
    {
      id: 'sign-out',
      title: translate(locale, 'Đăng xuất iCloud, Microsoft và Google'),
      detail: translate(
        locale,
        'Đăng xuất mọi tài khoản đang đăng nhập trên máy. Máy còn iCloud/Find My Mac, tài khoản Microsoft hoặc Google có thể bị từ chối tiếp nhận hoặc không mở được sau khi sửa.',
      ),
    },
    {
      id: 'activation-lock',
      title: translate(locale, 'Tắt Find My Mac và khoá kích hoạt'),
      detail: translate(
        locale,
        'Tắt Find My Mac trước khi đăng xuất iCloud. Nếu máy có khoá kích hoạt của hãng hoặc MDM, gỡ liên kết thiết bị khỏi tài khoản quản lý trước khi giao.',
      ),
    },
    {
      id: 'passcode',
      title: translate(
        locale,
        'Gỡ mật khẩu đăng nhập, Touch ID và khoá ứng dụng',
      ),
      detail: translate(
        locale,
        'Gỡ mật khẩu đăng nhập, Touch ID và mọi khoá ứng dụng. Không cần tắt mã hoá ổ đĩa — chỉ cần nhân viên mở được máy để kiểm tra.',
      ),
    },
    {
      id: 'two-factor',
      title: translate(locale, 'Sao lưu mã 2FA sang thiết bị khác'),
      detail: translate(
        locale,
        'Xoá máy có thể xoá luôn ứng dụng xác thực. Xuất mã dự phòng hoặc chuyển tài khoản sang điện thoại khác trước, nếu không bạn sẽ không đăng nhập được vào chính tài khoản của mình.',
      ),
    },
    {
      id: 'reset',
      title: translate(locale, 'Chỉ xoá máy sau khi đã sao lưu và đăng xuất'),
      detail: translate(
        locale,
        'Xoá máy là bước cuối, không phải bước đầu. Nếu chưa chắc có bản sao hoặc chưa thoát tài khoản, đừng xoá — cửa hàng có thể tự xoá khi tiếp nhận, nhưng bạn vẫn nên chủ động.',
      ),
    },
  ];
}

function conditionItems(
  input: HandoverChecklistInput,
  locale: Locale,
): HandoverChecklistItem[] {
  const serial = clean(input.serialNumber);
  return [
    {
      id: 'photos',
      title: serial
        ? translate(
            locale,
            'Chụp ảnh và quay clip tình trạng máy, kèm tem serial/IMEI {serial}',
            { serial },
          )
        : translate(
            locale,
            'Chụp ảnh và quay clip tình trạng máy trước khi giao',
          ),
      detail: translate(
        locale,
        'Chụp 4 mặt, màn hình khi bật/tắt, cổng sạc, camera và các vết xước đã có. Quay một clip ngắn lúc máy còn chạy để làm bằng chứng.',
      ),
    },
    {
      id: 'faults',
      title: translate(
        locale,
        'Ghi lại lỗi hiện tại và đề nghị ghi vào phiếu tiếp nhận',
      ),
      detail: translate(
        locale,
        'Lỗi gì, xuất hiện từ khi nào, đã thử gì. Đề nghị nhân viên ghi đúng tình trạng lúc nhận để không bị quy cho hư hỏng mới.',
      ),
    },
    {
      id: 'warranty-seal',
      title: translate(
        locale,
        'Không tự tháo máy hoặc sửa ở tiệm ngoài trước',
      ),
      detail: translate(
        locale,
        'Tem niêm phong rách hoặc dấu mở máy có thể làm mất bảo hành. Nếu đã sửa ngoài, nói trước với trung tâm để họ kiểm tra và báo giá.',
      ),
    },
  ];
}

function paperworkItems(
  input: HandoverChecklistInput,
  locale: Locale,
): HandoverChecklistItem[] {
  const place = clean(input.purchasePlace);
  const serial = clean(input.serialNumber);
  const warrantyEnd = formatDayValue(input.warrantyEnd, locale);

  return [
    place
      ? {
          id: 'invoice',
          title: translate(locale, 'Mang hoá đơn mua tại {place}', { place }),
          detail: translate(
            locale,
            'Hoá đơn giấy hoặc email xác nhận đơn mua tại {place}. Nếu mua online, mang cả phiếu giao hàng; không có hoá đơn, trung tâm có thể chỉ tra theo serial/IMEI hoặc từ chối bảo hành.',
            { place },
          ),
        }
      : {
          id: 'invoice',
          title: translate(
            locale,
            'Mang hoá đơn hoặc email xác nhận đơn hàng',
          ),
          detail: translate(
            locale,
            'Hoá đơn giấy hoặc email xác nhận đơn hàng. Nếu mua online, mang cả phiếu giao hàng; không có hoá đơn, trung tâm có thể chỉ tra theo serial/IMEI hoặc từ chối bảo hành.',
          ),
        },
    serial
      ? {
          id: 'box',
          title: translate(
            locale,
            'Mang hộp máy có serial/IMEI khớp với máy ({serial})',
            { serial },
          ),
          detail: translate(
            locale,
            'Số serial/IMEI trên hộp phải khớp với máy và hoá đơn: {serial}. Nếu hộp ghi số khác, chụp lại cả hai trước khi đi.',
            { serial },
          ),
        }
      : {
          id: 'box',
          title: translate(
            locale,
            'Mang hộp máy có serial/IMEI khớp với máy và hoá đơn',
          ),
          detail: translate(
            locale,
            'Số serial/IMEI trên hộp phải khớp với máy và hoá đơn. Nếu không tìm thấy hộp, hỏi trung tâm trước xem có cần không.',
          ),
        },
    warrantyEnd
      ? {
          id: 'warranty-end',
          title: translate(locale, 'Biết chính xác ngày hết bảo hành'),
          detail: translate(
            locale,
            'Bảo hành của máy hết ngày {date}. Nếu đã hết hạn, hỏi giá trước khi đồng ý sửa.',
            { date: warrantyEnd },
          ),
        }
      : {
          id: 'warranty-end',
          title: translate(locale, 'Biết chính xác ngày hết bảo hành'),
          detail: translate(
            locale,
            'App chưa có ngày hết bảo hành. Tra trên hoá đơn hoặc trang tra cứu của hãng trước khi đi, và hỏi giá nếu đã hết hạn.',
          ),
        },
    {
      id: 'terms',
      title: translate(
        locale,
        'Đọc trước điều kiện bảo hành và mức phí',
      ),
      detail: translate(
        locale,
        'Hỏi rõ rơi vỡ/vào nước có được bảo hành không, thời gian xử lý bao lâu và ngoài bảo hành thì phí bao nhiêu. Ghi lại câu trả lời để đối chiếu sau. Mang thẻ bảo hành nếu hãng phát hành riêng.',
      ),
    },
  ];
}

function counterItems(locale: Locale): HandoverChecklistItem[] {
  return [
    {
      id: 'accessories',
      title: translate(locale, 'Liệt kê phụ kiện gửi kèm máy'),
      detail: translate(
        locale,
        'Sạc, cáp, bút, ốp, tai nghe, thẻ nhớ, remote... Ghi rõ món nào gửi lại và món nào mang về; đừng để phụ kiện lẫn trong hộp máy.',
      ),
    },
    {
      id: 'intake-slip',
      title: translate(
        locale,
        'Xin phiếu tiếp nhận ghi đủ máy, serial/IMEI, phụ kiện và ngày hẹn',
      ),
      detail: translate(
        locale,
        'Phiếu cần có tên máy, serial/IMEI, tình trạng lúc nhận, phụ kiện, ngày hẹn trả và số liên hệ. Chụp lại phiếu trước khi rời quầy.',
      ),
    },
    {
      id: 'wipe-policy',
      title: translate(
        locale,
        'Hỏi rõ cửa hàng có xoá dữ liệu khi tiếp nhận không',
      ),
      detail: translate(
        locale,
        'Hỏi trước khi giao: họ có reset máy không, có cần bạn mở khoá không, dữ liệu được xử lý thế nào. Nếu máy phải ở lại qua đêm, hỏi ai chịu trách nhiệm.',
      ),
    },
  ];
}

function pickupItems(locale: Locale): HandoverChecklistItem[] {
  return [
    {
      id: 'pickup-check',
      title: translate(locale, 'Kiểm tra máy và phụ kiện khi nhận lại'),
      detail: translate(
        locale,
        'Bật máy, thử màn hình/camera/sạc, chạy lại lỗi cũ, đối chiếu serial/IMEI và phụ kiện trước khi ký nhận. Ra khỏi quầy rồi mới phát hiện thì khó xử lý.',
      ),
    },
  ];
}

/**
 * Build the checklist for one device, in one language.
 *
 * The same input with a different locale produces the same item IDs in the same
 * order — the client uses the IDs as checkbox keys, so switching language must
 * not lose ticks.
 */
export function buildHandoverChecklist(
  input: HandoverChecklistInput,
  locale: Locale,
): HandoverChecklist {
  const groups: HandoverChecklistGroup[] = [];
  const kind = handoverPrepKind(input.category);

  if (kind === 'phone') {
    groups.push({
      id: 'data',
      title: translate(locale, 'Dữ liệu & tài khoản'),
      items: phoneDataItems(locale),
    });
  } else if (kind === 'computer') {
    groups.push({
      id: 'data',
      title: translate(locale, 'Dữ liệu & tài khoản'),
      items: computerDataItems(locale),
    });
  }

  groups.push({
    id: 'condition',
    title: translate(locale, 'Tình trạng máy'),
    items: conditionItems(input, locale),
  });
  groups.push({
    id: 'paperwork',
    title: translate(locale, 'Giấy tờ & bảo hành'),
    items: paperworkItems(input, locale),
  });
  groups.push({
    id: 'counter',
    title: translate(locale, 'Ở quầy tiếp nhận'),
    items: counterItems(locale),
  });
  groups.push({
    id: 'pickup',
    title: translate(locale, 'Khi nhận lại máy'),
    items: pickupItems(locale),
  });

  return {
    groups,
    total: groups.reduce((sum, group) => sum + group.items.length, 0),
  };
}
