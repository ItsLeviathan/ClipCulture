import { buildPhrases, type ClipDoc } from '../shared/types'

/** #RRGGBB -> ASS &HAABBGGRR (alpha 00 = opaque) */
function assColor(hex: string, alpha = 0): string {
  const h = hex.replace('#', '').padEnd(6, '0')
  const r = h.slice(0, 2)
  const g = h.slice(2, 4)
  const b = h.slice(4, 6)
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`.toUpperCase()
}
const tagColor = (hex: string): string => assColor(hex).replace(/^&H00/, '&H') + '&'

function ts(sec: number): string {
  const s = Math.max(0, sec)
  const cs = Math.round(s * 100)
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const sc = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

const esc = (t: string): string => t.replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N')

/** Builds the .ass file for captions + text overlays on a W x H canvas. Returns null if nothing to draw. */
export function buildAss(doc: ClipDoc, W: number, H: number, totalDuration: number): string | null {
  const k = W / 1080 // sizes in the document are authored for a 1080-wide canvas
  const st = doc.captions.style
  const lines: string[] = []

  const boxed = st.background !== null
  const alpha = Math.round((1 - st.backgroundOpacity) * 255)
  lines.push(
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${st.font},${Math.round(st.size * k)},${assColor(st.color)},${assColor(st.color)},${
      boxed ? assColor(st.background!, alpha) : assColor(st.outlineColor)
    },${assColor('#000000', 110)},${st.bold ? -1 : 0},0,0,0,100,100,0,0,${boxed ? 3 : 1},${Math.round((boxed ? 14 : st.outline) * k)},${
      boxed ? 0 : Math.round(st.shadow * k)
    },5,${Math.round(70 * k)},${Math.round(70 * k)},0,1`,
    `Style: Txt,Arial,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,5,40,40,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  )

  let events = 0
  if (doc.captions.enabled) {
    const { phrases } = buildPhrases(doc)
    const px = st.align === 'center' ? W / 2 : st.align === 'left' ? 70 * k : W - 70 * k
    const an = st.align === 'center' ? 5 : st.align === 'left' ? 4 : 6
    const py = st.y * H
    phrases.forEach((ph, pi) => {
      const nextStart = phrases[pi + 1]?.start ?? Infinity
      const phraseEnd = Math.min(ph.end + 0.25, nextStart - 0.01, totalDuration)
      const shown = ph.words.map((w) => (st.uppercase ? w.text.toUpperCase() : w.text))
      ph.words.forEach((w, wi) => {
        const start = wi === 0 ? ph.start : w.outStart
        const end = wi === ph.words.length - 1 ? phraseEnd : ph.words[wi + 1].outStart
        if (end - start < 0.02) return
        const body = shown
          .map((t, j) => (st.highlightWord && j === wi ? `{\\c${tagColor(st.highlightColor)}}${esc(t)}{\\c${tagColor(st.color)}}` : esc(t)))
          .join(' ')
        const pop = st.animation === 'pop' && wi === 0 ? '\\fscx82\\fscy82\\t(0,110,\\fscx100\\fscy100)' : ''
        lines.push(`Dialogue: 0,${ts(start)},${ts(end)},Cap,,0,0,0,,{\\an${an}\\pos(${Math.round(px)},${Math.round(py)})${pop}}${body}`)
        events++
      })
    })
  }

  for (const t of doc.texts) {
    if (!t.text.trim() || t.end <= t.start) continue
    const x = Math.round(t.x * W)
    const y = Math.round(t.y * H)
    let anim = ''
    if (t.animation === 'fade') anim = '\\fad(300,300)'
    else if (t.animation === 'pop') anim = '\\fscx60\\fscy60\\t(0,220,\\fscx100\\fscy100)\\fad(120,200)'
    else if (t.animation === 'slide') anim = ''
    const pos = t.animation === 'slide' ? `\\move(${x},${y + Math.round(70 * k)},${x},${y},0,320)\\fad(200,200)` : `\\pos(${x},${y})`
    lines.push(
      `Dialogue: 1,${ts(t.start)},${ts(Math.min(t.end, totalDuration))},Txt,,0,0,0,,{\\an5${pos}\\fn${t.font}\\fs${Math.round(t.size * k)}\\b${
        t.bold ? 1 : 0
      }\\c${tagColor(t.color)}\\3c${tagColor(t.outlineColor)}\\bord${Math.round(t.outline * k)}${anim}}${esc(t.text)}`
    )
    events++
  }
  return events ? lines.join('\n') + '\n' : null
}
