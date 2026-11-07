// The bonus-game item currently on screen (the deck is shuffled by the server).
export function bonusItem(bonus, deck, index = bonus.index) {
  const itemIndex = bonus.order?.[index]
  return itemIndex == null ? null : deck?.items[itemIndex]
}
