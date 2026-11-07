// Wheel slice types, labels and colours (labels match wheel_slice_label in SQL).

export const sliceTypes = {
  points: { name: 'Points', hasAmount: true, label: (s) => `+${s.amount}` },
  double: { name: 'Double it!', label: () => 'Double it!' },
  lose_question: { name: 'Lose it!', label: () => 'Lose it!' },
  steal: { name: 'Steal', hasAmount: true, label: (s) => `Steal ${s.amount}` },
  lose: { name: 'Lose points', hasAmount: true, label: (s) => `−${s.amount}` },
  lose_half: { name: 'Lose half', label: () => 'Lose half' },
  bonus: { name: 'Bonus game', label: () => 'Bonus game' },
}

export const sliceLabel = (slice) => sliceTypes[slice.type]?.label(slice) ?? '?'

// Good slices green-ish, bad ones red-ish, special ones gold/purple.
const sliceColors = {
  points: ['#15803d', '#16a34a'],
  double: ['#ca8a04', '#ca8a04'],
  lose_question: ['#b91c1c', '#b91c1c'],
  steal: ['#7c3aed', '#7c3aed'],
  lose: ['#dc2626', '#991b1b'],
  lose_half: ['#7f1d1d', '#7f1d1d'],
  bonus: ['#0891b2', '#0891b2'],
}

export function sliceColor(slice, index) {
  const pair = sliceColors[slice.type] ?? ['#334155', '#475569']
  return pair[index % 2]
}

export const defaultWheel = {
  chance: 0.25,
  slices: [
    { type: 'points', amount: 100 },
    { type: 'double' },
    { type: 'lose', amount: 200 },
    { type: 'points', amount: 250 },
    { type: 'steal', amount: 200 },
    { type: 'lose_question' },
    { type: 'points', amount: 500 },
    { type: 'lose_half' },
    { type: 'bonus' },
    { type: 'points', amount: 100 },
  ],
}
