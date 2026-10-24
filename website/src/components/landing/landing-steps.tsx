'use client';

import { Reveal } from '@/components/reveal';
import { useT } from '@/lib/i18n/client';

/** The three "start here" steps. Copy is client-resolved so it switches live. */
export function LandingSteps() {
  const t = useT();

  const steps = [
    {
      n: 1,
      title: t('Đăng ký miễn phí'),
      desc: t('Email và mật khẩu. Xong trong 30 giây.'),
    },
    {
      n: 2,
      title: t('Thêm thiết bị'),
      desc: t('Laptop, điện thoại, máy giặt — bất cứ thứ gì có bảo hành.'),
    },
    {
      n: 3,
      title: t('Để Warrly nhắc'),
      desc: t('Warrly giữ ngày hết hạn và nhắc bạn trước.'),
    },
  ];

  return (
    <section className="px-4 py-14 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <span className="eyebrow">{t('Bắt đầu như thế nào')}</span>
          <h2 className="display mt-2 text-3xl text-ink">
            {t('Ba bước để bắt đầu.')}
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, index) => (
            <Reveal key={s.n} index={index} className="flex">
              <div className="h-full w-full rounded-xl border-[1.5px] border-border bg-card p-7 text-center shadow-soft">
                <div className="mx-auto mb-3.5 inline-flex h-[52px] w-[52px] items-center justify-center rounded-[16px] bg-primary font-display text-2xl font-extrabold text-primary-foreground">
                  {s.n}
                </div>
                <h4 className="font-display text-[18px] font-bold">{s.title}</h4>
                <p className="mt-1.5 text-sm text-muted">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
