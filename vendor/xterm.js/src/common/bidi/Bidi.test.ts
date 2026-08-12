/**
 * Copyright (c) 2026 The xterm.js authors / project patches. All rights reserved.
 * @license MIT
 */

import { assert } from 'chai';
import {
  analyzeLine,
  detectParagraphDirection,
  stripZeroWidthFormatChars
} from 'common/bidi/Bidi';

const BIDI = { enabled: true, latinIslands: true };

describe('Bidi run analysis (iTerm2 PR #709 inspired)', () => {
  it('detects RTL paragraph for Persian', () => {
    assert.equal(detectParagraphDirection(Array.from('سلام دنیا')), 'R');
  });

  it('keeps English-first help lines as LTR paragraphs', () => {
    assert.equal(detectParagraphDirection(Array.from('  help                 این راهنما')), 'L');
  });

  it('keeps logical runs with RTL dir for Persian description (no code-point reverse for display)', () => {
    const logical = 'help  این';
    const info = analyzeLine(Array.from(logical), BIDI);
    assert.isTrue(info.hasRtl);
    assert.isFalse(info.isRtlParagraph);
    // Persian run must stay logical order in runs
    const rtlRun = info.runs.find(r => r.dir === 'R');
    assert.isOk(rtlRun);
    const slice = Array.from(logical).slice(rtlRun!.start, rtlRun!.end).join('');
    assert.equal(slice, 'این');
  });

  it('N1 keeps spaces inside Persian phrase inside the RTL run', () => {
    const logical = 'این راهنما';
    const info = analyzeLine(Array.from(logical), BIDI);
    assert.equal(info.runs.length, 1);
    assert.equal(info.runs[0].dir, 'R');
  });

  it('selection map reverses cells inside RTL runs only', () => {
    const logical = 'abی';
    // a b ی — last is RTL
    const info = analyzeLine(Array.from(logical), BIDI);
    // visual: a b then ی alone
    assert.deepEqual(info.visualOrder, [0, 1, 2]);
    const info2 = analyzeLine(Array.from('اب'), BIDI);
    assert.deepEqual(info2.visualOrder, [1, 0]);
  });

  it('strips zero-width format characters on paste', () => {
    assert.equal(stripZeroWidthFormatChars('می\u200cکند'), 'میکند');
  });
});
