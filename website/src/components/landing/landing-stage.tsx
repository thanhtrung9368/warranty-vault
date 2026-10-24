'use client';

import { PinnedStage } from '@/components/pinned-stage';
import { Reveal } from '@/components/reveal';
import { LandingProduct, type LandingProductShot } from './landing-product';
import { useT } from '@/lib/i18n/client';
import type { Translator } from '@/lib/i18n/catalog';

/**
 * The pinned product stage.
 *
 * Above `lg` the wrapper is a tall track and the panel sticks below the header;
 * `PinnedStage` writes `--p` and every beat, the scale and the clip wipe are
 * CSS `calc()`. Below `lg` the pin is gone and the same three beats are a plain
 * vertical sequence with the existing one-shot `<Reveal>`. Under reduced motion
 * the CSS collapses the pin entirely and the composition is shown static and
 * unclipped.
 *
 * The copy is resolved here with `useT()` rather than in the server page, so an
 * in-place language switch reaches the beats, the captions and the product
 * shot without a reload. `PinnedStage` still owns all the motion.
 */
function buildStage(t: Translator) {
  return {
    eyebrow: t('Trước khi hết hạn'),
    title: t('Từ lúc mua đến lúc hết hạn.'),
    sub: t('Warrly giữ ngày bảo hành, hoá đơn và lời nhắc ở cùng một chỗ.'),
    beats: [
      {
        title: t('Mọi thứ trong nhà'),
        desc: t('Tủ lạnh, máy giặt, chiếc iPhone. Một danh sách, đúng tên bạn gọi.'),
      },
      {
        title: t('Ngày và hoá đơn'),
        desc: t('Ngày hết hạn, các gói bảo hành và tấm ảnh hoá đơn nằm cạnh nhau.'),
      },
      {
        title: t('Nhắc trước khi quá muộn'),
        desc: t(
          'Warrly báo trước qua thông báo đẩy — đủ sớm để bạn kịp đi bảo hành.',
        ),
      },
    ],
  };
}

export function LandingStage({ shot }: { shot: LandingProductShot }) {
  const t = useT();
  const stage = buildStage(t);

  return (
    <section className="wv-stage" aria-labelledby="wv-stage-title">
      <PinnedStage>
        <div className="wv-stage-copy">
          <p className="eyebrow">{stage.eyebrow}</p>
          <h2 id="wv-stage-title" className="display wv-stage-title">
            {stage.title}
          </h2>
          <p className="wv-stage-sub">{stage.sub}</p>
          <div className="wv-stage-beats">
            {stage.beats.map((beat, index) => (
              <Reveal key={index} index={index} className="wv-stage-beat">
                <div className="wv-stage-beat-inner">
                  <p className="wv-stage-beat-num">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <h3 className="wv-stage-beat-title">{beat.title}</h3>
                  <p className="wv-stage-beat-desc">{beat.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <div className="wv-stage-progress" aria-hidden>
            <span />
          </div>
        </div>
        <div className="wv-stage-visual">
          <LandingProduct shot={shot} />
        </div>
      </PinnedStage>
    </section>
  );
}
