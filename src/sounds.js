// Sound effects generated with the Web Audio API (no audio files).
// Browsers only allow sound after the user has clicked or pressed a key on the
// page, so the context is created lazily and resumed on the first interaction.

let context = null

function audio() {
  if (!context) {
    const Context = window.AudioContext || window.webkitAudioContext
    if (!Context) return null
    context = new Context()
  }
  if (context.state === 'suspended') context.resume()
  return context
}

// Unlock audio on the first tap/click/key so later sounds (triggered by live
// updates, not clicks) are allowed to play.
for (const type of ['pointerdown', 'keydown']) {
  window.addEventListener(type, audio, { once: true, capture: true })
}

function tone(ctx, { type, frequency, start, duration, volume }) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, start + 0.01)
  gain.gain.setValueAtTime(volume, start + duration - 0.05)
  gain.gain.linearRampToValueAtTime(0, start + duration)
  osc.connect(gain).connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration)
}

// Loud game-show buzzer for the first team in.
export function playBuzzer() {
  const ctx = audio()
  if (!ctx) return
  const start = ctx.currentTime
  for (const frequency of [110, 116, 220]) {
    tone(ctx, { type: 'sawtooth', frequency, start, duration: 0.7, volume: 0.12 })
  }
}

// Short, softer tone for teams that buzz in after the first.
export function playBlip() {
  const ctx = audio()
  if (!ctx) return
  tone(ctx, { type: 'square', frequency: 330, start: ctx.currentTime, duration: 0.15, volume: 0.06 })
}
