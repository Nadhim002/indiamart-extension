import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface TagInputProps {
  id: string;
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}

export default function TagInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  hint,
}: TagInputProps) {
  const [text, setText] = useState('');

  const addTag = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const exists = value.some((tag) => tag.toLowerCase() === trimmed.toLowerCase());
    if (!exists) onChange([...value, trimmed]);
    setText('');
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="text"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          disabled={disabled}
          onClick={addTag}
          aria-label={`Add ${label}`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              {tag}
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeTag(tag)}
                aria-label={`Remove ${tag}`}
                className="rounded-full hover:bg-primary/20 disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
