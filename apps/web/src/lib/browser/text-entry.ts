const TEXT_ENTRY_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

// Single-key shortcuts must not fire while someone is typing.
export function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(TEXT_ENTRY_SELECTOR) !== null
  );
}
