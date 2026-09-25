import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractCards, generateLocal } from '../src/local-engine.mjs';

describe('extractCards (local rule engine)', () => {
  test('definition sentences become Q/A cards', () => {
    const cards = extractCards('线粒体是细胞进行有氧呼吸的主要场所，被称为细胞的动力车间。');
    assert.ok(cards.length >= 1);
    assert.ok(cards.some((c) => c.front.includes('线粒体') && c.back.includes('有氧呼吸')));
  });

  test('enumerations become list cards', () => {
    const cards = extractCards('细胞器包括线粒体、内质网、核糖体和高尔基体。');
    assert.ok(cards.some((c) => c.front.includes('细胞器') && c.back.includes('核糖体')));
  });

  test('cause-effect sentences become lead-to cards', () => {
    const cards = extractCards('全球变暖导致冰川大量消融，海平面持续上升。');
    assert.ok(cards.some((c) => c.front.includes('全球变暖') && c.back.includes('冰川')));
  });

  test('english material produces english questions', () => {
    const cards = extractCards('Photosynthesis is the process by which plants convert light energy into chemical energy.');
    assert.ok(cards.some((c) => /^What is/i.test(c.front)));
  });

  test('duplicates and junk are dropped, cap respected', () => {
    const text = 'ATP是细胞的直接能源物质。ATP是细胞的直接能源物质。短句。' + '数字句：抗战是1937年爆发的。'.repeat(20);
    const cards = extractCards(text, { maxCards: 5 });
    assert.ok(cards.length <= 5);
    const fronts = cards.map((c) => c.front);
    assert.equal(new Set(fronts).size, fronts.length, 'no duplicate fronts');
  });

  test('cards carry no hallucinated fields — only front/back/tags', () => {
    const cards = extractCards('酶是生物催化剂，具有高效性和专一性。');
    for (const c of cards) {
      assert.deepEqual(Object.keys(c).sort(), ['back', 'front', 'tags']);
    }
  });
});

describe('generateLocal', () => {
  test('same contract as generateCards, source attached, progress fires', async () => {
    const chunks = [
      { title: '第一章', text: '糖类是生物体的主要能源物质。糖类包括单糖、二糖和多糖。' },
      { title: '第二章', text: '蛋白质是生命活动的主要承担者。' },
    ];
    let progress = 0;
    const { cards, perChunk } = await generateLocal(chunks, {}, { onProgress: () => progress++ });
    assert.ok(cards.length >= 2);
    assert.equal(cards[0].source, '第一章');
    assert.equal(progress, 2);
    assert.ok(perChunk.every((p) => typeof p.generated === 'number' && p.cached === false));
  });
});
