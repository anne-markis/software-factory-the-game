// Section-scoped DOM patching (issue #6).
//
// The page used to be rendered with a single `app.innerHTML = ...` per tick,
// which destroyed and recreated every button up to ten times a second. A real
// mousedown/mouseup gesture that straddles one of those rebuilds never
// produces a click event at all, so Pause/Resume, speed, Buy, Start and the
// choice options intermittently did nothing.
//
// The fix is not a diffing library: it is a stable scaffold plus a string
// memo. Each independently-updatable region of the page gets its own stable
// container element marked with `data-section="<key>"`. Every render
// recomputes each section's html string and writes it only when it differs
// from the string this module last wrote there. A section whose underlying
// data has not moved is never touched, so its nodes -- and any in-flight
// click gesture on them -- survive the tick.
//
// Two rules make it correct:
//  - Compare against the string we last WROTE, never against
//    `element.innerHTML`: the parser normalizes markup (attribute quoting and
//    order, boolean attributes), so a computed-vs-live comparison would
//    almost always differ and silently defeat the memo.
//  - A region owns only its outermost `data-section` elements. Sections
//    nested deeper belong to a nested region created over that container,
//    which is how a region can hold both a volatile part and a stable part
//    inside one panel (see the projects and choices regions in appView.ts).
//
// No DOM APIs beyond innerHTML/children/getAttribute are used, so this stays
// trivially unit-testable (see domPatch.test.ts).

export const SECTION_ATTR = "data-section";

export interface Region {
  /**
   * Writes `html` as this region's scaffold, but only if it differs from the
   * scaffold currently in place. Returns true when it actually wrote (which
   * means every node inside the region, including its section containers, is
   * new). Re-indexes the region's sections and clears the memo on a write.
   */
  setScaffold(html: string): boolean;
  /** Writes `html` into the named section container, only if it changed. */
  patch(key: string, html: string): void;
  /** The container element for a key, for creating a nested region over it. */
  section(key: string): HTMLElement | undefined;
}

// Collects the outermost [data-section] descendants of `container`: traversal
// stops at each match, so a nested section is left for a nested region.
function collectSections(container: Element): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  const walk = (parent: Element): void => {
    for (const child of Array.from(parent.children)) {
      const key = child.getAttribute(SECTION_ATTR);
      if (key === null) {
        walk(child);
      } else if (!found.has(key)) {
        // First one wins if a key is somehow duplicated: better a stale
        // duplicate than a crash mid-render.
        found.set(key, child as HTMLElement);
      }
    }
  };
  walk(container);
  return found;
}

export function createRegion(container: HTMLElement): Region {
  let scaffold: string | null = null;
  let sections = collectSections(container);
  const written = new Map<string, string>();

  return {
    setScaffold(html: string): boolean {
      if (scaffold === html) return false;
      container.innerHTML = html;
      scaffold = html;
      sections = collectSections(container);
      // The old elements are gone, so what we "last wrote" no longer
      // describes the DOM. Dropping the memo is what stops a fresh, empty
      // container from being left empty because the same string was written
      // into its predecessor.
      written.clear();
      return true;
    },

    patch(key: string, html: string): void {
      const el = sections.get(key);
      if (el === undefined) return;
      if (written.get(key) === html) return;
      el.innerHTML = html;
      written.set(key, html);
    },

    section(key: string): HTMLElement | undefined {
      return sections.get(key);
    },
  };
}
