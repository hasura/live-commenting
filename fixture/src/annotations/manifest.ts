import type { ManifestEntry } from './review';

/**
 * Generator-facing revision manifest. Fingerprint OWN content only: changing a
 * declared child must not force renaming every ancestor. Deliberately excludes
 * geometry, CSS, class names and overlay state.
 */
export function readManifest(root: HTMLElement): ManifestEntry[] {
  return [...root.querySelectorAll<HTMLElement>('[data-anno-id]')]
    .filter(el => !el.closest('[data-anno-ignore]'))
    .map(el => {
      const clone = el.cloneNode(true) as HTMLElement;
      for (const child of clone.querySelectorAll('[data-anno-id], [data-anno-ignore]')) {
        child.replaceWith(document.createTextNode('\uFFFC'));
      }
      const content = {
        tag: el.tagName,
        text: clone.textContent,
        semantic: el.getAttribute('data-anno-semantic'),
        mode: el.getAttribute('data-anno-mode') ?? 'block',
        href: el.getAttribute('href'),
        src: el.getAttribute('src'),
        alt: el.getAttribute('alt'),
        value: el.getAttribute('value'),
      };
      return {
        id: el.dataset.annoId!,
        label: el.dataset.annoLabel ?? el.dataset.annoId!,
        fingerprint: JSON.stringify(content),
        ...(el.dataset.annoSupersedes ? {supersedes: el.dataset.annoSupersedes} : {}),
      };
    });
}