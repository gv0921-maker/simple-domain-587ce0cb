// Rich composer = RichTextEditor + file attachments (base64) + @mentions autocomplete.
// Stays 100% client-side, no extra dependencies.
import { useRef, useState, useCallback, useEffect } from 'react';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Paperclip, X, AtSign, Send, FileText, Download, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import DOMPurify from 'dompurify';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ShareImageToChatDialog } from '@/components/shared/ShareImageToChatDialog';
import type { ActivityAttachment } from '@/lib/services/activityLog';

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['p','b','i','ul','ol','li','strong','em','br','span','a','s','u','div'],
  ALLOWED_ATTR: ['href','class','target','data-user-id','contenteditable'],
};

export interface RichAttachment {
  name: string;
  type: string;
  size?: number;
  dataUrl?: string;
  url?: string;
}

export interface RichComposerValue {
  html: string;
  mentions: string[]; // user IDs
  attachments: RichAttachment[];
}

interface RichComposerProps {
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (value: RichComposerValue) => void | Promise<void>;
  className?: string;
  compact?: boolean;
  /** Optional directory used to power the @mention autocomplete. */
  users?: { id: string; name: string; email: string }[];
  /**
   * Optional uploader that converts a picked file into a persistent
   * attachment (e.g. Supabase Storage). When omitted, the composer
   * falls back to embedding files as base64 data URLs.
   */
  uploadFile?: (file: File) => Promise<RichAttachment>;
  submitting?: boolean;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

export function RichComposer({
  placeholder = 'Type your message…',
  submitLabel = 'Send',
  onSubmit,
  className,
  compact = false,
  users,
  uploadFile,
  submitting = false,
}: RichComposerProps) {
  const { toast } = useToast();
  const [html, setHtml] = useState('');
  const [attachments, setAttachments] = useState<RichAttachment[]>([]);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList) => {
    const next: RichAttachment[] = [];
    setUploading(true);
    try {
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        toast({ title: `${file.name} exceeds 5MB`, variant: 'destructive' });
        continue;
      }
      if (uploadFile) {
        try {
          const att = await uploadFile(file);
          next.push(att);
          continue;
        } catch (e: any) {
          toast({ title: `Failed to upload ${file.name}`, description: e?.message, variant: 'destructive' });
          continue;
        }
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      next.push({ name: file.name, type: file.type, size: file.size, dataUrl });
    }
    setAttachments(prev => [...prev, ...next]);
    } finally { setUploading(false); }
  }, [toast, uploadFile]);

  const removeAttachment = (idx: number) =>
    setAttachments(prev => prev.filter((_, i) => i !== idx));

  // Detect @ at end-of-text to open the mention menu
  useEffect(() => {
    const text = stripHtml(html);
    const match = text.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1].toLowerCase());
      setShowMentionMenu(true);
    } else {
      setShowMentionMenu(false);
    }
  }, [html]);

  // Mention autocomplete source — filtered against the caller-supplied directory.
  const filteredUsers = (users ?? []).filter((u) =>
    !mentionQuery ||
    u.name?.toLowerCase().includes(mentionQuery) ||
    u.email?.toLowerCase().includes(mentionQuery),
  ).slice(0, 8);

  const insertMention = (user: { id: string; name: string }) => {
    // Replace trailing @query with mention chip
    const replaced = html.replace(
      /@(\w*)(?!.*@)/,
      `<span class="mention" data-user-id="${user.id}" contenteditable="false">@${user.name}</span>&nbsp;`
    );
    setHtml(replaced);
    setShowMentionMenu(false);
  };

  const extractMentions = (htmlContent: string): string[] => {
    const matches = htmlContent.match(/data-user-id="([^"]+)"/g) || [];
    return Array.from(new Set(matches.map(m => m.replace(/data-user-id="|"/g, ''))));
  };

  const handleSubmit = async () => {
    const text = stripHtml(html).trim();
    if (!text && attachments.length === 0) return;
    try {
      await onSubmit({
        html,
        mentions: extractMentions(html),
        attachments,
      });
      setHtml('');
      setAttachments([]);
    } catch {
      /* keep draft so user can retry */
    }
  };

  return (
    <div className={cn('relative', className)}>
      <RichTextEditor
        value={html}
        onChange={setHtml}
        placeholder={placeholder}
        minHeight={compact ? '80px' : '120px'}
      />

      {/* Mention menu */}
      {showMentionMenu && filteredUsers.length > 0 && (
        <div className="absolute z-50 mt-1 left-2 bg-popover border border-border rounded-md shadow-lg w-64 max-h-56 overflow-y-auto">
          {filteredUsers.map(u => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
            >
              <AtSign className="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <div className="font-medium">{u.name}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-muted rounded-md px-2 py-1 text-xs">
              <FileText className="h-3 w-3" />
              <span className="max-w-[160px] truncate">{a.name}</span>
              {a.size !== undefined && (
                <span className="text-muted-foreground">({Math.round(a.size / 1024)}KB)</span>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1">
          <input
            type="file"
            ref={fileInputRef}
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || submitting}
          >
            <Paperclip className="h-3.5 w-3.5" />
            {uploading ? 'Uploading…' : 'Attach'}
          </Button>
          <span className="text-xs text-muted-foreground">Type @ to mention</span>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={handleSubmit}
          disabled={submitting || uploading}
        >
          <Send className="h-3.5 w-3.5" />
          {submitting ? 'Sending…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}

function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || '';
}

// Reusable renderer for rich content with mentions + attachments
export function RichContent({
  html,
  attachments,
  className,
}: {
  html?: string;
  attachments?: RichAttachment[];
  className?: string;
}) {
  const [preview, setPreview] = useState<RichAttachment | null>(null);
  const [shareTarget, setShareTarget] = useState<ActivityAttachment | null>(null);

  const isImage = (a: RichAttachment) =>
    (a.type && a.type.startsWith('image/')) ||
    !!a.dataUrl?.startsWith('data:image') ||
    !!(a.url && /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(a.url));

  const hrefFor = (a: RichAttachment) => a.dataUrl || a.url || '';

  const toActivityAttachment = (a: RichAttachment): ActivityAttachment => ({
    path: a.name,
    url: hrefFor(a),
    name: a.name,
    size: a.size ?? 0,
    mime: a.type || (isImage(a) ? 'image/*' : 'application/octet-stream'),
    kind: isImage(a) ? 'image' : 'file',
  });

  const images = (attachments ?? []).filter(isImage);
  const files = (attachments ?? []).filter((a) => !isImage(a));

  return (
    <div className={className}>
      {html && (
        <div
          className="prose prose-sm max-w-none text-sm [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline [&_strong]:font-semibold [&_.mention]:bg-primary/10 [&_.mention]:text-primary [&_.mention]:px-1 [&_.mention]:rounded [&_.mention]:font-medium"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html, SANITIZE_CONFIG) }}
        />
      )}
      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((a, i) => (
            <button
              key={`img-${i}`}
              type="button"
              onClick={() => setPreview(a)}
              className="rounded-md border overflow-hidden bg-muted hover:opacity-90 transition"
              aria-label={`Preview ${a.name}`}
            >
              <img
                src={hrefFor(a)}
                alt={a.name}
                className="h-28 w-28 object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((a, i) => (
            <a
              key={`file-${i}`}
              href={hrefFor(a) || '#'}
              download={a.name}
              className="flex items-center gap-1.5 bg-muted hover:bg-muted/70 rounded-md px-2 py-1 text-xs transition-colors"
            >
              <FileText className="h-3 w-3" />
              <span className="max-w-[180px] truncate">{a.name}</span>
              {a.size !== undefined && (
                <span className="text-muted-foreground">({Math.round(a.size / 1024)}KB)</span>
              )}
            </a>
          ))}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl w-[calc(100vw-2rem)] p-3 bg-background">
          <DialogTitle className="truncate text-sm">{preview?.name ?? 'Preview'}</DialogTitle>
          {preview && (
            <div className="flex items-center justify-center bg-muted rounded-md overflow-hidden">
              <img
                src={hrefFor(preview)}
                alt={preview.name}
                className="w-full max-h-[75vh] object-contain"
              />
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            {preview && (
              <a href={hrefFor(preview)} target="_blank" rel="noreferrer" download={preview.name}>
                <Button variant="outline" size="sm">
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                </Button>
              </a>
            )}
            <Button
              size="sm"
              onClick={() => preview && setShareTarget(toActivityAttachment(preview))}
              disabled={!preview}
            >
              <Share2 className="h-3.5 w-3.5 mr-1.5" /> Share via Chat
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ShareImageToChatDialog
        open={!!shareTarget}
        onOpenChange={(o) => !o && setShareTarget(null)}
        attachment={shareTarget}
      />
    </div>
  );
}
