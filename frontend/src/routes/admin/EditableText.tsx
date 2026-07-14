import { useEffect, useState, type KeyboardEvent } from "react";

/** Click-to-edit inline text; saves on Enter/blur, cancels on Escape. */
export function EditableText({
  value,
  onSave,
  className = "",
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    else setDraft(value);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setDraft(value);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        className={`rounded border border-[var(--color-pine)] px-2 py-1 ${className}`}
      />
    );
  }

  return (
    <button onClick={() => setEditing(true)} className={`text-left hover:underline ${className}`}>
      {value}
    </button>
  );
}
