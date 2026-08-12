# RTL in this xterm.js fork

Inspired by [iTerm2 PR #709](https://github.com/gnachman/iTerm2/pull/709).

## What works

- **Persian / Arabic joining**: text stays in **logical** order inside `dir="rtl"` spans
- **Mixed lines** (e.g. `help    این راهنما`): English LTR + Persian RTL runs
- **Selection**: mouse visual → logical via per-run maps
- **Paste**: optional strip of ZWNJ (`bidiStripZwOnPaste`)

## What does *not* work (and why)

**Never reverse Arabic code points for display.** That turns `راهنما` into `امنهار` and destroys joining. iTerm2 avoids this by shaping logical strings then placing glyphs; we let the browser shape logical runs.

## Options

```js
new Terminal({
  bidi: true,
  bidiLatinIslands: true,
  bidiKeepGuillemetsAsTyped: true,
  bidiStripZwOnPaste: false
})
```

## Rebuild

```bash
cd vendor/xterm.js
yarn install --ignore-engines --ignore-scripts
# hide parent node_modules/xterm if tsc complains about duplicate types
./node_modules/.bin/tsc -b src/common src/browser
./node_modules/.bin/webpack --config webpack.config.js
```
