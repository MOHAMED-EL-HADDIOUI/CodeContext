import React, { useMemo, useState } from 'react';
import {
  Bookmark,
  Braces,
  Check,
  Copy,
  ExternalLink,
  FileText,
  KeyRound,
  Network,
  Regex,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  decodeBase64Utf8,
  encodeBase64Utf8,
  explainAndTestRegex,
  explainHttpRequest,
  formatAndValidateJson,
  inspectJwtLocally,
} from '../../features/utilities/devTools';
import { useAppStore } from '../../stores/useAppStore';
import { MarkdownView } from '../common/MarkdownView';
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  IconButton,
  Input,
} from '../common/UIPrimitives';

type ToolId = 'json' | 'regex' | 'base64' | 'jwt' | 'markdown' | 'http' | 'refs';

export const DevToolsView: React.FC = () => {
  const { savedReferences, deleteReference } = useAppStore();
  const [activeTool, setActiveTool] = useState<ToolId>('json');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [jsonInput, setJsonInput] = useState('{\n  "service": "codecontext",\n  "version": 1\n}');
  const jsonResult = useMemo(() => formatAndValidateJson(jsonInput), [jsonInput]);

  const [regexPattern, setRegexPattern] = useState(
    '^(?:export\\s+)?(?:async\\s+)?function\\s+(\\w+)',
  );
  const [regexFlags, setRegexFlags] = useState('gm');
  const [regexSample, setRegexSample] = useState(
    'export async function fetchRepo() {}\nfunction parseUrl() {}',
  );
  const regexResult = useMemo(
    () => explainAndTestRegex(regexPattern, regexFlags, regexSample),
    [regexPattern, regexFlags, regexSample],
  );

  const [b64Input, setB64Input] = useState('');
  const [b64Output, setB64Output] = useState('');
  const [b64Error, setB64Error] = useState<string | null>(null);

  const [jwtInput, setJwtInput] = useState('');
  const jwtResult = useMemo(
    () => (jwtInput.trim() ? inspectJwtLocally(jwtInput) : null),
    [jwtInput],
  );

  const [mdInput, setMdInput] = useState(
    '# API Endpoint\n\n`GET /v1/repositories`\n\n- Returns indexed metadata',
  );

  const [httpInput, setHttpInput] = useState(
    'curl -X POST https://api.example.com/v1/search -H "Content-Type: application/json" -d \'{"query":"auth"}\'',
  );
  const httpResult = useMemo(() => explainHttpRequest(httpInput), [httpInput]);

  const copyText = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const tools: Array<{
    id: ToolId;
    label: string;
    count?: number;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'json', label: 'JSON', icon: Braces },
    { id: 'regex', label: 'Regex', icon: Regex },
    { id: 'base64', label: 'Base64', icon: FileText },
    { id: 'jwt', label: 'JWT', icon: KeyRound },
    { id: 'markdown', label: 'Markdown', icon: FileText },
    { id: 'http', label: 'HTTP', icon: Network },
    { id: 'refs', label: 'Saved', count: savedReferences.length, icon: Bookmark },
  ];

  const getMethodTone = (method?: string): 'accent' | 'success' | 'warning' | 'danger' => {
    switch (method) {
      case 'GET':
        return 'success';
      case 'POST':
      case 'PUT':
      case 'PATCH':
        return 'accent';
      case 'DELETE':
        return 'danger';
      default:
        return 'warning';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-base)]">
      {/* Tool Switcher Strip */}
      <div className="flex items-center flex-wrap gap-1 px-2.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0">
        {tools.map(({ id, label, count, icon: Icon }) => {
          const active = activeTool === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTool(id)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium cursor-pointer shrink-0 transition-all border ${
                active
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-text)] border-[var(--accent-border)]'
                  : 'text-[var(--text-secondary)] border-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="w-3 h-3" />
              <span>{label}</span>
              {count !== undefined && (
                <span className="text-[10px] opacity-75 tabular-nums">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tool Workspace */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {activeTool === 'json' && (
          <div className="cc-card rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[12.5px] font-semibold m-0 text-[var(--text-primary)]">
                JSON Formatter &amp; Validator
              </h2>
              {jsonResult.ok && jsonResult.formatted && (
                <div className="flex items-center gap-1">
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => setJsonInput(jsonResult.formatted!)}
                  >
                    Prettify
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => setJsonInput(jsonResult.minified!)}
                  >
                    Minify
                  </Button>
                  <IconButton
                    size="xs"
                    onClick={() => copyText('json', jsonResult.formatted!)}
                    aria-label="Copy formatted JSON"
                    title="Copy formatted JSON"
                  >
                    {copiedKey === 'json' ? (
                      <Check className="w-3 h-3 text-[var(--success-text)]" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </IconButton>
                </div>
              )}
            </div>

            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              rows={8}
              aria-label="JSON input"
              className="w-full rounded-lg p-2.5 font-mono text-[12px] bg-[var(--bg-code)] text-[var(--text-primary)] border border-[var(--border-default)] focus:border-[var(--accent-text)]"
            />

            {jsonResult.ok && jsonResult.stats ? (
              <div className="flex items-center gap-2 text-[11.5px] flex-wrap">
                <Badge tone="success">Valid JSON</Badge>
                <span className="text-[var(--text-muted)] tabular-nums">
                  {jsonResult.stats.keys} keys · depth {jsonResult.stats.depth} ·{' '}
                  {jsonResult.stats.bytes} B
                </span>
              </div>
            ) : (
              <AlertBanner tone="danger">{jsonResult.error}</AlertBanner>
            )}
          </div>
        )}

        {activeTool === 'regex' && (
          <div className="cc-card rounded-xl p-3 space-y-2.5">
            <h2 className="text-[12.5px] font-semibold m-0 text-[var(--text-primary)]">
              Regex Explainer &amp; Live Tester
            </h2>
            <div className="flex gap-1.5">
              <Input
                value={regexPattern}
                onChange={(e) => setRegexPattern(e.target.value)}
                placeholder="Pattern"
                className="font-mono flex-1"
                aria-label="Regex pattern"
              />
              <Input
                value={regexFlags}
                onChange={(e) => setRegexFlags(e.target.value)}
                placeholder="Flags"
                className="font-mono w-16"
                aria-label="Regex flags"
              />
            </div>
            <textarea
              value={regexSample}
              onChange={(e) => setRegexSample(e.target.value)}
              rows={3}
              aria-label="Regex test text"
              className="w-full rounded-lg p-2.5 font-mono text-[12px] bg-[var(--bg-code)] text-[var(--text-primary)] border border-[var(--border-default)]"
            />
            {!regexResult.valid ? (
              <AlertBanner tone="danger">{regexResult.error}</AlertBanner>
            ) : (
              <>
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-[var(--text-secondary)]">
                    Matches ({regexResult.matches.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {regexResult.matches.length === 0 ? (
                      <span className="text-[11.5px] text-[var(--text-muted)]">No matches</span>
                    ) : (
                      regexResult.matches.map((m, i) => (
                        <Badge key={i} tone="accent" className="font-mono">
                          {m}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] overflow-hidden">
                  {regexResult.tokens.map((t, idx) => (
                    <div
                      key={idx}
                      className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11.5px]"
                    >
                      <code className="font-mono text-[var(--accent-text)] font-medium">
                        {t.part}
                      </code>
                      <span className="text-[var(--text-secondary)] text-right">{t.meaning}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {activeTool === 'base64' && (
          <div className="cc-card rounded-xl p-3 space-y-2.5">
            <h2 className="text-[12.5px] font-semibold m-0 text-[var(--text-primary)]">
              Base64 UTF-8 Codec
            </h2>
            <textarea
              value={b64Input}
              onChange={(e) => setB64Input(e.target.value)}
              rows={4}
              placeholder="Enter text or Base64 string…"
              aria-label="Base64 input"
              className="w-full rounded-lg p-2.5 font-mono text-[12px] bg-[var(--bg-code)] text-[var(--text-primary)] border border-[var(--border-default)]"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setB64Error(null);
                  setB64Output(encodeBase64Utf8(b64Input));
                }}
              >
                Encode
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const res = decodeBase64Utf8(b64Input);
                  if (res.ok && res.output !== undefined) {
                    setB64Error(null);
                    setB64Output(res.output);
                  } else {
                    setB64Error(res.error ?? 'Decode error');
                  }
                }}
              >
                Decode
              </Button>
              {b64Output && (
                <Button size="sm" variant="ghost" onClick={() => copyText('b64', b64Output)}>
                  {copiedKey === 'b64' ? 'Copied' : 'Copy output'}
                </Button>
              )}
            </div>
            {b64Error && <AlertBanner tone="danger">{b64Error}</AlertBanner>}
            {b64Output && (
              <pre className="p-2.5 rounded-lg bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-[12px] whitespace-pre-wrap break-all m-0">
                {b64Output}
              </pre>
            )}
          </div>
        )}

        {activeTool === 'jwt' && (
          <div className="cc-card rounded-xl p-3 space-y-2.5">
            <h2 className="text-[12.5px] font-semibold m-0 text-[var(--text-primary)]">
              JWT Structure Inspector
            </h2>
            <AlertBanner tone="info" icon={<ShieldAlert className="w-3.5 h-3.5" />}>
              100% local decoding in browser memory. Tokens are never transmitted, and cryptographic signatures are not verified.
            </AlertBanner>
            <textarea
              value={jwtInput}
              onChange={(e) => setJwtInput(e.target.value)}
              rows={3}
              placeholder="Paste JWT (header.payload.signature)…"
              aria-label="JWT token input"
              className="w-full rounded-lg p-2.5 font-mono text-[11.5px] bg-[var(--bg-code)] text-[var(--text-primary)] border border-[var(--border-default)]"
            />
            {jwtResult && !jwtResult.ok && (
              <AlertBanner tone="danger">{jwtResult.error}</AlertBanner>
            )}
            {jwtResult && jwtResult.ok && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {jwtResult.isExpired !== undefined && (
                    <Badge tone={jwtResult.isExpired ? 'danger' : 'success'}>
                      {jwtResult.isExpired ? 'Expired' : 'Not expired'}
                    </Badge>
                  )}
                  {jwtResult.expiresAt && (
                    <span className="text-[11px] text-[var(--text-muted)] font-mono">
                      exp: {jwtResult.expiresAt}
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                    Header
                  </div>
                  <pre className="m-0 p-2.5 rounded-lg bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-[11.5px] overflow-auto">
                    {JSON.stringify(jwtResult.header, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                    Payload
                  </div>
                  <pre className="m-0 p-2.5 rounded-lg bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-[11.5px] overflow-auto">
                    {JSON.stringify(jwtResult.payload, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTool === 'markdown' && (
          <div className="cc-card rounded-xl p-3 space-y-2.5">
            <h2 className="text-[12.5px] font-semibold m-0 text-[var(--text-primary)]">
              Sanitized Markdown Preview
            </h2>
            <textarea
              value={mdInput}
              onChange={(e) => setMdInput(e.target.value)}
              rows={5}
              aria-label="Markdown input"
              className="w-full rounded-lg p-2.5 font-mono text-[12px] bg-[var(--bg-code)] text-[var(--text-primary)] border border-[var(--border-default)]"
            />
            <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)]">
              <MarkdownView content={mdInput} />
            </div>
          </div>
        )}

        {activeTool === 'http' && (
          <div className="cc-card rounded-xl p-3 space-y-2.5">
            <h2 className="text-[12.5px] font-semibold m-0 text-[var(--text-primary)]">
              HTTP / cURL Request Explainer
            </h2>
            <textarea
              value={httpInput}
              onChange={(e) => setHttpInput(e.target.value)}
              rows={4}
              aria-label="HTTP or curl request"
              className="w-full rounded-lg p-2.5 font-mono text-[11.5px] bg-[var(--bg-code)] text-[var(--text-primary)] border border-[var(--border-default)]"
            />
            {!httpResult.ok ? (
              <AlertBanner tone="danger">{httpResult.error}</AlertBanner>
            ) : (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 space-y-2.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <Badge tone={getMethodTone(httpResult.method)}>{httpResult.method}</Badge>
                  <span className="font-mono truncate text-[var(--text-primary)]">
                    {httpResult.url}
                  </span>
                </div>
                <p className="text-[var(--text-secondary)] m-0">{httpResult.summary}</p>
                {httpResult.headers.length > 0 && (
                  <div className="space-y-1 pt-1 border-t border-[var(--border-subtle)]">
                    <div className="text-[11px] font-semibold text-[var(--text-muted)]">Headers</div>
                    {httpResult.headers.map((h, i) => (
                      <div key={i} className="font-mono text-[11px] text-[var(--text-secondary)]">
                        <span className="text-[var(--text-primary)]">{h.name}:</span> {h.value}
                      </div>
                    ))}
                  </div>
                )}
                {httpResult.body && (
                  <div className="pt-1 border-t border-[var(--border-subtle)]">
                    <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1">
                      Body
                    </div>
                    <pre className="m-0 p-2 rounded-lg bg-[var(--bg-code)] font-mono text-[11px] overflow-auto">
                      {httpResult.body}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTool === 'refs' && (
          <div className="space-y-2.5">
            {savedReferences.length === 0 ? (
              <EmptyState
                icon={Bookmark}
                title="No saved references"
                description="Attach selected code or documentation in Chat and click the bookmark icon to keep it locally."
              />
            ) : (
              savedReferences.map((ref) => (
                <div key={ref.id} className="cc-card rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[12.5px] text-[var(--text-primary)] truncate">
                      {ref.title}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {ref.url && (
                        <a
                          href={ref.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                          title="Open source URL"
                          aria-label="Open source URL"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <IconButton
                        size="xs"
                        tone="danger"
                        onClick={() => void deleteReference(ref.id)}
                        aria-label="Delete saved reference"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconButton>
                    </div>
                  </div>
                  <pre className="m-0 p-2.5 rounded-lg bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-[11px] max-h-28 overflow-auto text-[var(--text-secondary)]">
                    {ref.excerpt}
                  </pre>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
