/**
 * Chatter — the Odoo message/log panel.
 *
 * PRESENTATION ONLY. No data wiring, no activity_log calls. The compose
 * toolbar is visual: buttons are inert and the box is a plain textarea
 * standing in for the eventual rich-text editor.
 *
 * Feed entries are grouped by day with a centred date separator, matching the
 * existing chatter's information architecture.
 */
import * as React from 'react';
import {
  MessageSquare, PencilLine, Clock, Paperclip, Smile, Bold, Italic,
  List, Link2, Image as ImageIcon, Users,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { Avatar, Button } from './primitives';

export type ChatterKind = 'message' | 'note' | 'log';

export interface ChatterEntry {
  id: string;
  author: string;
  /** ISO-ish display string; grouping uses `day`. */
  time: string;
  /** Group heading, e.g. "Today", "Yesterday", "12 July 2026". */
  day: string;
  kind: ChatterKind;
  body: React.ReactNode;
}

type ComposeMode = 'message' | 'note' | 'activity' | null;

const kindStyles: Record<ChatterKind, { bar: string; label: string }> = {
  message: { bar: 'hsl(var(--ds-blue))', label: 'sent a message' },
  note: { bar: 'hsl(var(--ds-amber))', label: 'logged a note' },
  log: { bar: 'hsl(var(--ds-border-strong))', label: '' },
};

function ToolbarButton({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (visual only)`}
      className="grid h-[22px] w-[22px] place-items-center rounded-[2px] text-[hsl(var(--ds-ink-subtle))] hover:bg-[hsl(var(--ds-surface-sunken))] hover:text-[hsl(var(--ds-ink))]"
    >
      <Icon className="h-[13px] w-[13px]" />
    </button>
  );
}

export function Chatter({
  entries,
  followers = 3,
  className,
}: {
  entries: ChatterEntry[];
  followers?: number;
  className?: string;
}) {
  const [mode, setMode] = React.useState<ComposeMode>(null);

  // Preserve incoming order; group consecutive entries sharing a day.
  const groups = React.useMemo(() => {
    const out: { day: string; items: ChatterEntry[] }[] = [];
    for (const e of entries) {
      const last = out[out.length - 1];
      if (last && last.day === e.day) last.items.push(e);
      else out.push({ day: e.day, items: [e] });
    }
    return out;
  }, [entries]);

  return (
    <div
      className={cn(
        'bg-[hsl(var(--ds-surface))] border border-[hsl(var(--ds-border))]',
        'rounded-[var(--ds-radius)]',
        className,
      )}
    >
      {/* action bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[hsl(var(--ds-border))] px-3 py-2">
        <Button
          size="sm"
          variant={mode === 'message' ? 'primary' : 'subtle'}
          icon={<MessageSquare className="h-[13px] w-[13px]" />}
          onClick={() => setMode(mode === 'message' ? null : 'message')}
        >
          Send message
        </Button>
        <Button
          size="sm"
          variant={mode === 'note' ? 'primary' : 'subtle'}
          icon={<PencilLine className="h-[13px] w-[13px]" />}
          onClick={() => setMode(mode === 'note' ? null : 'note')}
        >
          Log note
        </Button>
        <Button
          size="sm"
          variant={mode === 'activity' ? 'primary' : 'subtle'}
          icon={<Clock className="h-[13px] w-[13px]" />}
          onClick={() => setMode(mode === 'activity' ? null : 'activity')}
        >
          Activity
        </Button>

        <div className="ml-auto flex items-center gap-1 text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
          <Users className="h-[13px] w-[13px]" />
          <span className="tabular-nums">{followers}</span>
        </div>
      </div>

      {/* compose */}
      {mode && (
        <div className="border-b border-[hsl(var(--ds-border))] p-3">
          <div
            className={cn(
              'rounded-[var(--ds-radius)] border',
              mode === 'note'
                ? 'border-[hsl(var(--ds-amber)/0.5)] bg-[hsl(var(--ds-amber-bg)/0.4)]'
                : 'border-[hsl(var(--ds-border-strong))] bg-[hsl(var(--ds-surface))]',
            )}
          >
            <textarea
              rows={3}
              placeholder={
                mode === 'note'
                  ? 'Log an internal note… (visible to followers only)'
                  : mode === 'activity'
                    ? 'Schedule an activity…'
                    : 'Send a message to followers…'
              }
              className={cn(
                'w-full resize-none bg-transparent px-2.5 py-2 text-[var(--ds-fs-sm)]',
                'text-[hsl(var(--ds-ink))] placeholder:text-[hsl(var(--ds-ink-subtle))]',
                'focus:outline-none',
              )}
            />
            {/* toolbar — visual only */}
            <div className="flex items-center gap-0.5 border-t border-[hsl(var(--ds-border))] px-1.5 py-1">
              <ToolbarButton icon={Bold} label="Bold" />
              <ToolbarButton icon={Italic} label="Italic" />
              <ToolbarButton icon={List} label="Bullet list" />
              <ToolbarButton icon={Link2} label="Insert link" />
              <ToolbarButton icon={ImageIcon} label="Insert image" />
              <span className="mx-1 h-4 w-px bg-[hsl(var(--ds-border))]" />
              <ToolbarButton icon={Paperclip} label="Attach file" />
              <ToolbarButton icon={Smile} label="Emoji" />
              <div className="ml-auto flex items-center gap-1.5">
                <Button size="sm" variant="subtle" onClick={() => setMode(null)}>
                  Discard
                </Button>
                <Button size="sm" variant="primary">
                  {mode === 'activity' ? 'Schedule' : mode === 'note' ? 'Log' : 'Send'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* feed */}
      <div className="px-3 py-2">
        {groups.map((g) => (
          <section key={g.day} aria-label={g.day}>
            {/* day separator */}
            <div className="my-2 flex items-center gap-2" role="separator">
              <span className="h-px flex-1 bg-[hsl(var(--ds-border))]" />
              <span className="text-[var(--ds-fs-xs)] font-medium text-[hsl(var(--ds-ink-subtle))]">
                {g.day}
              </span>
              <span className="h-px flex-1 bg-[hsl(var(--ds-border))]" />
            </div>

            <ul className="m-0 list-none space-y-3 p-0">
              {g.items.map((e) => (
                <li key={e.id} className="flex gap-2.5">
                  <Avatar name={e.author} size={26} className="mt-[1px]" />
                  <div
                    className="min-w-0 flex-1 border-l-2 pl-2.5"
                    style={{ borderColor: kindStyles[e.kind].bar }}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[var(--ds-fs-sm)] font-semibold text-[hsl(var(--ds-ink))]">
                        {e.author}
                      </span>
                      {kindStyles[e.kind].label && (
                        <span className="text-[var(--ds-fs-xs)] text-[hsl(var(--ds-ink-subtle))]">
                          {kindStyles[e.kind].label}
                        </span>
                      )}
                      <span className="ml-auto text-[var(--ds-fs-xs)] tabular-nums text-[hsl(var(--ds-ink-subtle))]">
                        {e.time}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[var(--ds-fs-sm)] leading-relaxed text-[hsl(var(--ds-ink-muted))]">
                      {e.body}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
