/**
 * Regression tests for the parts of Clip Culture that turn a clip document into an ffmpeg command.
 * Run with:  npm test
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRenderPlan } from '../src/main/render'
import { buildAss } from '../src/main/ass'
import { DEFAULT_CAPTION_STYLE, DEFAULT_EXPORT, buildPhrases, outToSrc, outputDuration, segmentOffsets, srcToOut, type ClipDoc } from '../src/shared/clip'

const source = { path: 'in.mp4', fileName: 'in.mp4', fileSize: 0, duration: 600, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', orientation: 'landscape' as const, audioStreams: [{ codec: 'aac', sampleRate: 48000, channels: 2 }] }

function doc(over: Partial<ClipDoc> = {}): ClipDoc {
  return {
    schema: 1,
    segments: [{ id: 'a', srcStart: 100, srcEnd: 110 }, { id: 'b', srcStart: 120, srcEnd: 130 }],
    reframe: { mode: 'track', keys: [{ t: 100, cx: 0.3 }, { t: 125, cx: 0.7 }] },
    zoom: [],
    captions: { enabled: true, style: { ...DEFAULT_CAPTION_STYLE }, words: [
      { id: '1', text: 'Hello', start: 100.5, end: 100.9 },
      { id: '2', text: 'world.', start: 101, end: 101.4 },
      { id: '3', text: 'Cut', start: 115, end: 115.4 }, // inside the removed gap: must not appear
      { id: '4', text: 'Again', start: 121, end: 121.4 }
    ] },
    texts: [], images: [], music: null,
    audio: { videoVolume: 1, mute: false },
    transitions: { intro: 'none', outro: 'none', between: 'none', duration: 0.3 },
    effect: 'none',
    meta: { title: 'T', hook: '', caption: '', hashtags: [] },
    ...over
  }
}

const plan = (d: ClipDoc, enc: 'nvenc' | 'x264' = 'x264'): ReturnType<typeof buildRenderPlan> =>
  buildRenderPlan({ doc: d, source, options: { ...DEFAULT_EXPORT }, encoder: enc, workdir: mkdtempSync(join(tmpdir(), 'rf-')), outputPath: 'out.mp4', musicFile: null, imageFiles: [] })

const tests: [string, () => void][] = [
  ['time mapping across a cut', () => {
    const d = doc()
    assert.equal(outputDuration(d), 20)
    assert.deepEqual(segmentOffsets(d), [0, 10])
    assert.equal(srcToOut(d, 121), 11)
    assert.equal(srcToOut(d, 115), null)
    assert.deepEqual(outToSrc(d, 11), { index: 1, src: 121 })
  }],
  ['captions inside cut-out audio are dropped', () => {
    const { words } = buildPhrases(doc())
    assert.deepEqual(words.map((w) => w.text), ['Hello', 'world.', 'Again'])
    assert.ok(Math.abs(words[2].outStart - 11) < 1e-6)
  }],
  ['each segment gets its own fast-seeked input', () => {
    const p = plan(doc())
    const inputs = p.args.filter((a) => a === '-i').length
    assert.equal(inputs, 2)
    assert.ok(p.args.includes('100') && p.args.includes('120'))
  }],
  ['output is 1080x1920 h264 with no watermark filters', () => {
    const p = plan(doc())
    assert.match(p.graph, /scale=1080:1920/)
    assert.ok(!/drawtext|logo|watermark/i.test(p.graph))
    assert.ok(p.args.includes('libx264'))
    assert.ok(plan(doc(), 'nvenc').args.includes('h264_nvenc'))
  }],
  ['zoom before the first keyframe never extrapolates (regression: negative scale crashed ffmpeg)', () => {
    const p = plan(doc({ zoom: [{ t: 10, scale: 1 }, { t: 10.35, scale: 1.3 }, { t: 12, scale: 1.3 }, { t: 12.4, scale: 1 }] }))
    assert.match(p.graph, /max\(1,if\(lt\(t,10\),1,/)
  }],
  ['portrait and 4:5 sources are cropped, never stretched', () => {
    const mk = (w: number, h: number): string =>
      buildRenderPlan({ doc: doc(), source: { ...source, width: w, height: h }, options: { ...DEFAULT_EXPORT }, encoder: 'x264', workdir: mkdtempSync(join(tmpdir(), 'rf-')), outputPath: 'o.mp4', musicFile: null, imageFiles: [] }).graph
    assert.match(mk(1080, 1920), /crop=1080:1920:0:0,scale=1080:1920/) // already 9:16
    assert.match(mk(1080, 1350), /crop=760:1350:/) // 4:5: full height, a 9:16-wide window slides horizontally
    assert.match(mk(1080, 2340), /crop=1080:1920:0:210,scale=1080:1920/) // taller than 9:16: full width, centred vertical crop
    const wide = mk(3840, 2160)
    assert.match(wide, /crop=1216:2160:/) // 4K landscape keeps full height
  }],
  ['crossfade shortens the clip by the overlap', () => {
    const d = doc({ transitions: { intro: 'none', outro: 'none', between: 'crossfade', duration: 0.5 } })
    assert.equal(outputDuration(d), 19.5)
    assert.match(plan(d).graph, /xfade=transition=fade:duration=0.5:offset=9.5/)
  }],
  ['music ducking uses a speech sidechain', () => {
    const d = doc({ music: { trackId: 'x', title: 'x', volume: 0.3, fadeIn: 1, fadeOut: 1, ducking: true, offset: 0 } })
    const p = buildRenderPlan({ doc: d, source, options: { ...DEFAULT_EXPORT }, encoder: 'x264', workdir: mkdtempSync(join(tmpdir(), 'rf-')), outputPath: 'o.mp4', musicFile: 'm.mp3', imageFiles: [] })
    assert.match(p.graph, /sidechaincompress/)
    assert.ok(p.args.includes('-stream_loop'))
  }],
  ['ASS captions highlight the spoken word and text overlays animate', () => {
    const d = doc({ texts: [{ id: 't', text: 'Hi', start: 1, end: 3, x: 0.5, y: 0.2, size: 60, font: 'Impact', color: '#FFFFFF', outlineColor: '#000000', outline: 4, bold: false, animation: 'pop' }] })
    const ass = buildAss(d, 1080, 1920, outputDuration(d))!
    assert.match(ass, /PlayResX: 1080/)
    assert.match(ass, /\\c&H00E5FF&/) // #FFE500 in ASS blue-green-red order
    assert.match(ass, /\\fscx60/)
    assert.equal(buildAss(doc({ captions: { ...doc().captions, enabled: false } }), 1080, 1920, 20), null)
  }]
]

let failed = 0
for (const [name, fn] of tests) {
  try {
    fn()
    console.log('  ✓', name)
  } catch (e) {
    failed++
    console.log('  ✗', name, '\n   ', (e as Error).message)
  }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`)
process.exit(failed ? 1 : 0)
