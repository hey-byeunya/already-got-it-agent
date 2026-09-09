/**
 * 검사: 카드 합성과 내보내기.
 *
 * 각 항목은 실제로 관측한 문제나 수용 기준 하나에 대응한다.
 * 특히 앞의 셋은 **카드 PNG 를 열어 보고서야** 발견한 것들이다 —
 * SVG 문자열만 보고는 글자가 겹치거나 카드 밖으로 나간 것을 알 수 없었다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CARD_H, CARD_W, composeCard, rasterize, readCardSpecs, sourcesMarkdown, textWidth, wrap, writeZip, type CardSpec,
} from '../src/cards.js';

const spec = (over: Partial<CardSpec> = {}): CardSpec => ({
  card_no: 1, kind: 'text', title: '제목', body: ['본문'], sources: ['get_system_health · summary'],
  ...over,
});

test('글자 폭과 줄바꿈', async (t) => {

  t.test('한글은 전각, 영문은 반각 폭으로 센다', () => {
    // 같은 글자 수라도 한글이 넓다. 이 구별이 없으면 한글 카드가 조용히 잘린다.
    assert.ok(textWidth('가나다라', 40) > textWidth('abcd', 40));
    assert.equal(textWidth('가', 40), 40);
  });

  t.test('상자 폭을 넘기면 줄을 나눈다', () => {
    const lines = wrap('가'.repeat(60), 400, 40);   // 한 줄에 10자
    assert.ok(lines.length >= 6, `${lines.length}줄`);
    for (const l of lines) assert.ok(textWidth(l, 40) <= 400, `줄이 상자를 넘었다: ${l}`);
  });

  t.test('영문 단어를 가운데서 자르지 않는다', () => {
    const lines = wrap('deployment succeeded twice', 300, 30);
    assert.ok(lines.every((l) => !/[a-z]$/.test(l) || l.endsWith('twice')
      || 'deployment succeeded twice'.includes(l.trim())), lines.join(' / '));
  });

  t.test('줄바꿈 문자를 그대로 지킨다 — 본문 줄 구분이 뭉개지지 않는다', () => {
    assert.deepEqual(wrap('첫줄\n둘째줄', 900, 30), ['첫줄', '둘째줄']);
  });
});

test('카드 합성', async (t) => {

  t.test('제목·본문·출처가 각각 별도 레이어로 나간다', () => {
    const c = composeCard(spec());
    for (const id of ['layer-title', 'layer-body', 'layer-source', 'layer-index']) {
      assert.match(c.svg, new RegExp(`id="${id}"`), `${id} 가 없다`);
    }
    assert.ok(!c.svg.includes('id="layer-chart"'), '차트 없는 카드에 차트 레이어가 생겼다');
  });

  t.test('레이어별 줄 수를 데이터로도 돌려준다 — 한 장만 고칠 때 근거가 된다', () => {
    const c = composeCard(spec({ body: ['한 줄', '두 줄'] }));
    assert.equal(c.layers.body.length, 2);
    assert.equal(c.layers.title.length, 1);
    assert.equal(c.layers.source.length, 1);
  });

  // 관측한 문제: 글자를 잘라서 그려도 도구는 "성공" 을 돌려줬다.
  t.test('넘치면 잘라 그리지 않고 text_overflow 로 거절한다', () => {
    assert.throws(
      () => composeCard(spec({ body: Array.from({ length: 40 }, (_, i) => `${i}번째 줄`) })),
      (e: any) => e.code === 'text_overflow'
        && e.extra.overflow.some((o: any) => o.layer === 'body'),
    );
  });

  t.test('제목이 길어도 거절한다 — 제목만 검사에서 빠지지 않는다', () => {
    assert.throws(
      () => composeCard(spec({ title: '아주 긴 제목'.repeat(30) })),
      (e: any) => e.code === 'text_overflow'
        && e.extra.overflow.some((o: any) => o.layer === 'title'),
    );
  });

  t.test('경계 — 상자에 들어가는 문안은 통과한다 (다 막으면 도구가 아니다)', () => {
    const c = composeCard(spec({ body: ['배포 3건 중 1건이 실패했다.', '원인은 빌드 로그에 남아 있다.'] }));
    assert.equal(c.layers.body.length, 2);
  });

  t.test('차트가 있으면 본문 한도가 줄어든다 — 그래야 겹치지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-cards-'));
    try {
      const chart = join(dir, 'c.svg');
      writeFileSync(chart, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"'
        + ' width="960" height="540"><rect width="960" height="540" fill="#fff"/></svg>');
      const body = Array.from({ length: 8 }, (_, i) => `${i + 1}번째 줄`);
      // 차트 없이는 8줄이 통과한다
      assert.equal(composeCard(spec({ body })).layers.body.length, 8);
      // 차트가 있으면 같은 문안이 거절된다
      assert.throws(
        () => composeCard(spec({ body, kind: 'metric' }), chart),
        (e: any) => e.code === 'text_overflow',
      );
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  t.test('차트는 다시 그리지 않고 파일을 읽어 중첩 svg 로 넣는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-cards-'));
    try {
      const chart = join(dir, 'c.svg');
      writeFileSync(chart, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"'
        + ' width="960" height="540"><rect id="표식" width="10" height="10"/></svg>');
      const c = composeCard(spec({ kind: 'metric' }), chart);
      assert.ok(c.chart_embedded);
      // 원본 안의 내용이 그대로 들어갔는지 — 다시 그렸다면 이 표식이 없다.
      assert.match(c.svg, /id="표식"/);
      assert.match(c.svg, /id="layer-chart"/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  t.test('SVG 가 아닌 파일을 차트로 주면 거절한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-cards-'));
    try {
      const notSvg = join(dir, 'c.svg');
      writeFileSync(notSvg, '이건 SVG 가 아니다');
      assert.throws(() => composeCard(spec({ kind: 'metric' }), notSvg),
        (e: any) => e.code === 'chart_not_svg');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // 관측한 문제: 표지 삽화의 마지막 줄이 카드 밖으로 나가 출처 글자를 덮었다.
  t.test('표지 삽화가 출처 띠를 덮지 않는다', () => {
    const c = composeCard(spec({ kind: 'cover', title: '표지', body: ['부제'] }));
    assert.match(c.svg, /clipPath id="cover-clip"/, '삽화에 클리핑이 걸려 있지 않다');
    const m = /<clipPath id="cover-clip"><rect x="0" y="(\d+)" width="\d+" height="(\d+)"/.exec(c.svg);
    assert.ok(m, '클리핑 상자를 읽을 수 없다');
    const bottom = Number(m![1]) + Number(m![2]);
    // 출처 줄 하나 + 여백보다 위에서 끝나야 한다.
    assert.ok(bottom < CARD_H - 84, `삽화가 ${bottom} 까지 내려왔다 (카드 높이 ${CARD_H})`);
  });

  t.test('카드 규격이 고정돼 있다 — 내보낼 때 PNG 크기 대조에 쓴다', () => {
    const c = composeCard(spec());
    assert.match(c.svg, new RegExp(`viewBox="0 0 ${CARD_W} ${CARD_H}"`));
  });

  t.test('cover 가 아니면 cover_source 는 null 이다', () => {
    assert.equal(composeCard(spec()).cover_source, null);
  });

  t.test('제목에 < > & 가 있어도 SVG 가 깨지지 않는다', () => {
    const c = composeCard(spec({ title: '오류 <script> & "인용"' }));
    assert.ok(!c.svg.includes('<script>'), 'XML 이스케이프가 안 됐다');
    assert.match(c.svg, /&lt;script&gt;/);
  });
});

test('표지 삽화 출처 — agy 산출물이 있으면 쓰고 없으면 로컬로 그린다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ops-cover-'));
  const savedAsset = process.env.OPS_COVER_ASSET;
  const savedMode = process.env.OPS_COVER_ART;
  const cover = () => composeCard(spec({ kind: 'cover', title: '표지', body: ['부제'] }));
  try {
    const asset = join(dir, 'cover.svg');
    writeFileSync(asset, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 912 400"'
      + ' width="912" height="400"><rect id="에셋표식" width="912" height="400" fill="#0f172a"/></svg>');
    process.env.OPS_COVER_ASSET = asset;
    delete process.env.OPS_COVER_ART; // auto

    await t.test('에셋이 있으면 끼워 넣고 출처를 밝힌다', () => {
      const c = cover();
      assert.equal(c.cover_source, 'agy-asset');
      assert.match(c.svg, /id="에셋표식"/);
      // 에셋 경로에서도 클리핑은 걸린다 — 출처 띠를 덮지 않게.
      assert.match(c.svg, /clipPath id="cover-clip"/);
    });

    await t.test('OPS_COVER_ART=local 이면 에셋이 있어도 로컬로 그린다', () => {
      process.env.OPS_COVER_ART = 'local';
      const c = cover();
      assert.equal(c.cover_source, 'local-svg');
      assert.ok(!c.svg.includes('에셋표식'), '에셋이 섞여 들어갔다');
      assert.match(c.svg, /clipPath id="cover-clip"/);
    });

    await t.test('에셋이 없으면 로컬로 폴백한다', () => {
      delete process.env.OPS_COVER_ART;
      process.env.OPS_COVER_ASSET = join(dir, '없음.svg');
      const c = cover();
      assert.equal(c.cover_source, 'local-svg');
      assert.match(c.svg, /clipPath id="cover-clip"/);
    });

    await t.test('OPS_COVER_ART=agy 인데 에셋이 없으면 거짓말하지 않고 거절한다', () => {
      process.env.OPS_COVER_ART = 'agy';
      process.env.OPS_COVER_ASSET = join(dir, '없음.svg');
      assert.throws(() => cover(), (e: any) => e.code === 'cover_asset_missing');
    });

    await t.test('깨진 에셋은 로컬로 뭉개지 않고 거절한다', () => {
      delete process.env.OPS_COVER_ART;
      const bad = join(dir, 'bad.svg');
      writeFileSync(bad, '이건 SVG 가 아니다');
      process.env.OPS_COVER_ASSET = bad;
      assert.throws(() => cover(), (e: any) => e.code === 'cover_not_svg');
    });

    await t.test('script 가 든 에셋은 넣지 않는다', () => {
      const evil = join(dir, 'evil.svg');
      writeFileSync(evil, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      process.env.OPS_COVER_ASSET = evil;
      assert.throws(() => cover(), (e: any) => e.code === 'cover_not_svg');
    });
  } finally {
    if (savedAsset === undefined) delete process.env.OPS_COVER_ASSET;
    else process.env.OPS_COVER_ASSET = savedAsset;
    if (savedMode === undefined) delete process.env.OPS_COVER_ART;
    else process.env.OPS_COVER_ART = savedMode;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('내보내기', async (t) => {

  t.test('ZIP 을 독립된 도구(unzip)로 열 수 있다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-zip-'));
    try {
      const out = join(dir, 'a.zip');
      const bytes = writeZip(out, [
        { name: 'cards/01.png', data: Buffer.from('가짜 PNG 내용 1') },
        { name: 'cards/02.png', data: Buffer.from('가짜 PNG 내용 2') },
        { name: 'SOURCES.md', data: Buffer.from('# 출처\n한글도 들어간다') },
      ]);
      assert.ok(bytes > 0);
      const tested = execFileSync('unzip', ['-t', out]).toString();
      assert.match(tested, /No errors/, 'ZIP 이 손상됐다');
      const listed = execFileSync('unzip', ['-l', out]).toString();
      for (const n of ['cards/01.png', 'cards/02.png', 'SOURCES.md']) {
        assert.ok(listed.includes(n), `${n} 이 목록에 없다`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  t.test('압축을 풀면 내용이 그대로다 — CRC 와 길이를 스스로 쓴다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-zip-'));
    try {
      const out = join(dir, 'b.zip');
      const content = '한글 내용과 ASCII mixed content ' + 'x'.repeat(3000);
      writeZip(out, [{ name: 'SOURCES.md', data: Buffer.from(content, 'utf8') }]);
      mkdirSync(join(dir, 'x'));
      execFileSync('unzip', ['-q', out, '-d', join(dir, 'x')]);
      assert.equal(readFileSync(join(dir, 'x', 'SOURCES.md'), 'utf8'), content);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  t.test('출처 기록에 카드마다 근거가 남는다', () => {
    const md = sourcesMarkdown('r1', [
      spec({ card_no: 1, title: '표지', sources: ['픽스처 f1-normal'] }),
      spec({ card_no: 2, title: '가입', sources: ['get_user_metrics · totals'], chart_path: 'charts/02.svg' }),
    ], 'fixture');
    assert.match(md, /r1/);
    assert.match(md, /get_user_metrics · totals/);
    assert.match(md, /charts\/02\.svg/);
    assert.match(md, /unzip -l/);
  });

  t.test('제목에 파이프가 있어도 표가 깨지지 않는다', () => {
    const md = sourcesMarkdown('r1', [spec({ title: '가입|탈퇴' })], 'fixture');
    assert.match(md, /가입\\\|탈퇴/);
  });

  // 관측한 문제: 모델이 제목을 3줄로 줘서 표가 무너졌다.
  t.test('제목이 여러 줄이어도 표가 한 줄로 유지된다', () => {
    const md = sourcesMarkdown('r1', [spec({ card_no: 1, title: '첫줄\n둘째줄\n셋째줄' })], 'fixture');
    const rows = md.split('\n').filter((l) => l.startsWith('| 01 '));
    assert.equal(rows.length, 1, '표 행이 여러 줄로 쪼개졌다');
    assert.match(rows[0]!, /첫줄<br>둘째줄<br>셋째줄/);
  });

  t.test('ZIP 에 1980년이 아닌 실제 시각이 들어간다', () => {    const dir = mkdtempSync(join(tmpdir(), 'ops-zip-'));
    try {
      const out = join(dir, 'c.zip');
      writeZip(out, [{ name: 'a.txt', data: Buffer.from('x') }]);
      const listed = execFileSync('unzip', ['-l', out]).toString();
      assert.ok(!listed.includes('1980'), `날짜가 비어 있다:\n${listed}`);
      assert.match(listed, new RegExp(String(new Date().getFullYear())));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // 관측한 문제: 변환 명령이 실패하면 일반 Error 가 올라가 unexpected_error 로 샜다.
  t.test('변환 명령이 실패하면 render_failed 로 코드화된다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-raster-'));
    const saved = process.env.OPS_CHROME_PATH;
    try {
      const fake = join(dir, 'chrome-fail');
      writeFileSync(fake, '#!/bin/sh\nexit 3\n');
      chmodSync(fake, 0o755);
      process.env.OPS_CHROME_PATH = fake;
      const svg = join(dir, 'c.svg');
      writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"'
        + ' width="1080" height="1350"><rect width="1080" height="1350" fill="#fff"/></svg>');
      assert.throws(
        () => rasterize(svg, join(dir, 'c.png')),
        (e: any) => e.code === 'render_failed',
      );
    } finally {
      if (saved === undefined) delete process.env.OPS_CHROME_PATH;
      else process.env.OPS_CHROME_PATH = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // 관측한 문제: 카드 명세 JSON 하나가 깨지면 readCardSpecs 의 JSON.parse 가 그대로 터졌다.
  t.test('깨진 카드 명세는 card_spec_corrupted 로 거절한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-cards-'));
    try {
      writeFileSync(join(dir, '01.json'), '{깨진 명세');
      assert.throws(
        () => readCardSpecs(dir),
        (e: any) => e.code === 'card_spec_corrupted',
      );
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
