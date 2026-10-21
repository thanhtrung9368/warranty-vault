/**
 * The one overlay surface recipe.
 *
 * Select, DropdownMenu and Combobox are all portalled floating panels, but they
 * had drifted: `SelectContent` was `rounded-md` + 1px border + native
 * `shadow-md`, while the other two were `rounded-lg` + 1.5px + `shadow-lift`.
 * A select therefore opened with a different corner, edge weight and shadow
 * than the dropdown next to it. They now share this constant, so a future
 * overlay cannot quietly fork the recipe.
 *
 * Padding is intentionally not here: the dropdown pads its own content, while
 * the select/combobox pad their viewport (the search field in the combobox must
 * stay flush to the panel edge).
 */
export const OVERLAY_SURFACE =
  'z-50 overflow-hidden rounded-lg border-[1.5px] border-border bg-popover text-popover-foreground shadow-lift';
