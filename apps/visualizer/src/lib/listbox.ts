export type TListboxAction =
  | { readonly kind: 'move'; readonly index: number }
  | { readonly kind: 'select'; readonly index: number }
  | { readonly kind: 'close' }
  | { readonly kind: 'none' }

/**
 * What a keypress means to an open listbox, as a value rather than an effect.
 *
 * `key` is `KeyboardEvent.key`. `active` is the index with focus. A `kind`
 * other than `none` means the component must also call `preventDefault()`.
 *
 * `Tab` is deliberately `none`: Tab must move focus normally, and the list
 * closes through a `focusout` rather than by swallowing the key.
 */
export const listboxKey = (
  key: string,
  active: number,
  count: number,
): TListboxAction => {
  if (key === 'Escape') return { kind: 'close' }
  if (count === 0) return { kind: 'none' }

  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', index: (active + 1) % count }
    case 'ArrowUp':
      return { kind: 'move', index: (active - 1 + count) % count }
    case 'Home':
      return { kind: 'move', index: 0 }
    case 'End':
      return { kind: 'move', index: count - 1 }
    case 'Enter':
    case ' ':
      return { kind: 'select', index: active }
    default:
      return { kind: 'none' }
  }
}
