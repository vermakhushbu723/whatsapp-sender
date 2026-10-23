import { useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_COUNTRY_CODE = '91';

const STATUS_LABEL = {
  pending: 'Waiting',
  sending: 'Sending…',
  sent: 'Sent ✓',
  failed: 'Failed',
  skipped: 'Skipped (STOP)',
};

// delivery receipts from the official API webhook
const DELIVERY_LABEL = { sent: 'Sent ✓', delivered: 'Delivered ✓✓', read: 'Read ✓✓', failed: 'Failed' };

async function api(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Server error'), { status: res.status });
  return data;
}

// same rules as server/index.js normalizeNumber
function normalize(raw) {
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = DEFAULT_COUNTRY_CODE + digits;
  return digits;
}

function numberIssue(raw) {
  if (/[^\d\s+\-()]/.test(raw)) return 'Number me galat character hai';
  const d = normalize(raw);
  if (d.length < 11) return 'Number chhota hai (10 digit chahiye)';
  if (d.length > 15) return 'Number bahut bada hai';
  if (d.startsWith(DEFAULT_COUNTRY_CODE) && d.length === 12 && !/^[6-9]/.test(d.slice(2)))
    return 'Indian mobile number 6/7/8/9 se shuru hota hai';
  return null;
}

// split pasted text / excel cell into individual number tokens
function extractTokens(text) {
  return String(text)
    .split(/[\n\r,;\t|]+/)
    .flatMap((part) => {
      const p = part.trim();
      if (!p) return [];
      // "9876543210 9123456789" -> two numbers; "+91 98765 43210" -> one number
      return p.replace(/\D/g, '').length > 15 ? p.split(/\s+/) : [p];
    })
    .map((t) => t.trim())
    .filter(Boolean);
}

const fmtDate = (iso) => new Date(iso).toLocaleString();
const imgUrl = (name) => `/api/uploads/${name}`;

// pick an image file -> upload -> returns saved file name
async function uploadImage(file) {
  if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Sirf JPG ya PNG image chunein.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image 5MB se chhoti honi chahiye (WhatsApp ki limit).');
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const res = await api('/api/uploads', { method: 'POST', body: JSON.stringify({ data }) });
  return res.image;
}

export default function App() {
  const [wa, setWa] = useState({ loading: true });
  const [numbers, setNumbers] = useState(['']);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [history, setHistory] = useState([]);
  const [resend, setResend] = useState(false);
  const [tab, setTab] = useState('send');
  const [dismissedJob, setDismissedJob] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [image, setImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [optouts, setOptouts] = useState([]);
  const [templates, setTemplates] = useState({ list: [], error: '', loading: false });
  const [templateKey, setTemplateKey] = useState('');
  const [params, setParams] = useState([]);
  const [mode, setMode] = useState('template'); // template | custom
  const [customText, setCustomText] = useState('');
  const [windows, setWindows] = useState({}); // number -> when its 24h reply window closes
  const imageRef = useRef(null);
  const fileRef = useRef(null);

  const loadOptouts = () => api('/api/optouts').then(setOptouts).catch(() => {});
  useEffect(() => {
    loadOptouts();
  }, [tab]);

  // poll sender + job status
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api('/api/status')
        .then((d) => alive && setWa(d))
        .catch((e) => alive && setWa(e.status === 401 ? { needLogin: true } : { serverDown: true }));
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const job = wa.job;
  const sending = !!job && !job.done;

  const lastUnread = useRef(null);
  useEffect(() => {
    const n = wa.unread;
    if (n === undefined) return;
    document.title = n ? `(${n}) WA Sender` : 'WA Sender';
    if (lastUnread.current !== null && n > lastUnread.current && 'Notification' in window && Notification.permission === 'granted')
      new Notification('WA Sender — naya reply', { body: `${n} unread reply`, tag: 'wa-reply' });
    lastUnread.current = n;
  }, [wa.unread]);
  const connected = wa.sender?.status === 'connected';
  const MAX = wa.maxPerBatch || 250;
  const tpl = templates.list.find((t) => `${t.name}|${t.language}` === templateKey);

  const loadTemplates = () => {
    setTemplates((c) => ({ ...c, loading: true, error: '' }));
    api('/api/cloud/templates')
      .then((list) => setTemplates({ list, error: '', loading: false }))
      .catch((e) => setTemplates({ list: [], error: e.message, loading: false }));
  };
  useEffect(() => {
    if (connected) loadTemplates();
  }, [connected]);

  // no approved template yet -> start on custom message
  const autoMode = useRef(false);
  useEffect(() => {
    if (autoMode.current || templates.loading || templates.error || !connected) return;
    autoMode.current = true;
    if (!templates.list.length) setMode('custom');
  }, [templates, connected]);

  useEffect(() => {
    if (!connected) return;
    const load = () => api('/api/windows').then(setWindows).catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [connected, job?.done]);

  useEffect(() => {
    api('/api/history').then(setHistory).catch(() => {});
  }, [tab, job?.done]);

  const optSet = useMemo(() => new Set(optouts.map((o) => o.number)), [optouts]);

  // number -> last time a message was successfully sent to it
  const sentMap = useMemo(() => {
    const map = {};
    for (const j of [...history].reverse())
      for (const r of j.results) if (r.status === 'sent') map[r.number] = r.time || j.createdAt;
    return map;
  }, [history]);

  const rows = useMemo(() => {
    const firstIndex = {};
    return numbers.map((raw, i) => {
      const value = raw.trim();
      if (!value) return { value, empty: true };
      const norm = normalize(value);
      const issue = numberIssue(value);
      let dupOf = null;
      if (!issue) {
        if (norm in firstIndex) dupOf = firstIndex[norm] + 1;
        else firstIndex[norm] = i;
      }
      return {
        value,
        norm,
        issue,
        dupOf,
        sentAt: !issue && sentMap[norm],
        blocked: !issue && optSet.has(norm),
        windowEnds: !issue && windows[norm],
      };
    });
  }, [numbers, sentMap, optSet, windows]);

  const filledCount = rows.filter((r) => !r.empty).length;
  const invalidCount = rows.filter((r) => r.issue).length;
  const dupCount = rows.filter((r) => r.dupOf).length;
  const sentBeforeCount = rows.filter((r) => r.sentAt && !r.dupOf).length;
  const blockedCount = rows.filter((r) => r.blocked && !r.dupOf).length;
  const isCustom = mode === 'custom';
  const closedCount = isCustom ? rows.filter((r) => !r.empty && !r.issue && !r.dupOf && !r.blocked && !r.windowEnds).length : 0;
  const sendable = rows.filter(
    (r) => !r.empty && !r.issue && !r.dupOf && !r.blocked && (resend || !r.sentAt) && (!isCustom || r.windowEnds)
  );
  const messageReady = isCustom
    ? !!(customText.trim() || image)
    : !!tpl &&
      params.slice(0, tpl.vars).filter((p) => p?.trim()).length === tpl.vars &&
      (tpl.headerFormat !== 'IMAGE' || !!image);

  // ---------- adding numbers (paste / excel) ----------
  const addNumbers = (tokens, source) => {
    const current = numbers.map((n) => n.trim()).filter(Boolean);
    const seen = new Set(current.filter((n) => !numberIssue(n)).map(normalize));
    const added = [];
    const duplicates = [];
    const overflow = [];
    const alreadySent = [];

    for (const t of tokens) {
      const valid = !numberIssue(t);
      const norm = normalize(t);
      if (valid && seen.has(norm)) {
        duplicates.push(t);
        continue;
      }
      if (current.length + added.length >= MAX) {
        overflow.push(t);
        continue;
      }
      if (valid) {
        seen.add(norm);
        if (sentMap[norm]) alreadySent.push(t);
      }
      added.push(t);
    }

    setNumbers(current.length + added.length ? [...current, ...added] : ['']);

    const lines = [`${source}: ${added.length} number add hue.`];
    if (duplicates.length) lines.push(`Duplicate (list me pehle se hai, skip kiye): ${duplicates.join(', ')}`);
    if (alreadySent.length) lines.push(`In numbers par pehle message bheja ja chuka hai: ${alreadySent.join(', ')}`);
    if (overflow.length) lines.push(`Max ${MAX} ki limit ki wajah se skip hue: ${overflow.join(', ')}`);
    const invalid = added.filter((t) => numberIssue(t));
    if (invalid.length) lines.push(`Galat number (list me laal dikh rahe hain): ${invalid.join(', ')}`);
    const warn = duplicates.length || overflow.length || invalid.length || alreadySent.length;
    setNotice({ type: warn ? 'warn' : 'ok', lines });
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData('text');
    const tokens = extractTokens(text);
    if (!tokens.length) return;
    e.preventDefault();
    addNumbers(tokens, 'Paste');
    setPasteText('');
  };

  const handlePasteKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tokens = extractTokens(pasteText);
      if (tokens.length) addNumbers(tokens, 'Add');
      setPasteText('');
    }
  };

  const handleExcel = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer());
      const tokens = [];
      for (const name of wb.SheetNames) {
        const sheet = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
        for (const row of sheet)
          for (const cell of row)
            // ignore headers, names, serial numbers etc. — keep cells that look like phone numbers
            for (const t of extractTokens(cell)) if (t.replace(/\D/g, '').length >= 7) tokens.push(t);
      }
      if (!tokens.length) return setNotice({ type: 'warn', lines: [`"${file.name}" me koi phone number nahi mila.`] });
      addNumbers(tokens, `Excel (${file.name})`);
    } catch {
      setNotice({ type: 'warn', lines: ['Excel file padh nahi paye. .xlsx, .xls ya .csv file chunein.'] });
    }
  };

  const updateNumber = (i, value) => setNumbers((prev) => prev.map((n, idx) => (idx === i ? value : n)));
  const addRow = () => numbers.length < MAX && setNumbers([...numbers, '']);
  const removeNumber = (i) => setNumbers(numbers.length === 1 ? [''] : numbers.filter((_, idx) => idx !== i));
  const clearAll = () => {
    setNumbers(['']);
    setNotice(null);
  };
  const removeProblemRows = () => {
    const keep = numbers.filter((_, i) => !rows[i].empty && !rows[i].issue && !rows[i].dupOf);
    setNumbers(keep.length ? keep : ['']);
  };

  const send = async () => {
    setError('');
    if (!sendable.length)
      return setError(
        isCustom
          ? 'Custom message sirf unhe ja sakta hai jinhone pichhle 24 ghante me message kiya ho.'
          : 'Bhejne ke liye koi naya sahi number nahi hai.'
      );
    if (!messageReady) return setError(isCustom ? 'Message likhein ya image lagayein.' : 'Template chunein aur saare khaane bharein.');
    const nums = sendable.map((r) => r.norm);
    const body = isCustom
      ? { mode: 'custom', numbers: nums, message: customText, image }
      : { numbers: nums, cloudTemplate: { name: tpl.name, language: tpl.language }, params, image };
    try {
      const d = await api('/api/send', { method: 'POST', body: JSON.stringify(body) });
      setWa((w) => ({ ...w, job: d.job }));
    } catch (e) {
      setError(e.message);
    }
  };

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      setImage(await uploadImage(file));
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
  };

  const refresh = () => api('/api/status').then(setWa).catch(() => {});

  const sentCount = job?.results.filter((r) => r.status === 'sent').length || 0;
  const failedCount = job?.results.filter((r) => r.status === 'failed').length || 0;

  let sendLabel = `Send to ${sendable.length} number${sendable.length === 1 ? '' : 's'}`;
  if (sending) sendLabel = 'Sending…';
  else if (!sendable.length && sentBeforeCount) sendLabel = 'Sent ✓ — naya number dalein';

  if (wa.needLogin) return <LoginScreen />;

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.reload();
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">✆</span> WA Sender
        </div>
        <nav>
          <button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')}>
            Send Message
          </button>
          <button className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>
            Inbox {wa.unread > 0 && <span className="badge">{wa.unread}</span>}
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            History
          </button>
          <button className={tab === 'safety' ? 'active' : ''} onClick={() => setTab('safety')}>
            Limits & Opt-out
          </button>
        </nav>
        <SenderCard wa={wa} />
        <div className="side-actions">
          <button className="signout" onClick={() => setShowPassword(true)}>
            🔑 {wa.authEnabled ? 'Password badlein' : 'Password lagayein'}
          </button>
          {wa.authEnabled && (
            <button className="signout" onClick={signOut}>
              ⎋ Sign out
            </button>
          )}
        </div>
      </aside>

      {showPassword && (
        <ChangePassword
          hasPassword={!!wa.authEnabled}
          onClose={() => setShowPassword(false)}
          onDone={() => setWa((w) => ({ ...w, authEnabled: true }))}
        />
      )}

      <main className="content">
        {tab === 'inbox' ? (
          <Inbox />
        ) : tab === 'history' ? (
          <History history={history} />
        ) : tab === 'safety' ? (
          <Safety wa={wa} optouts={optouts} reloadOptouts={loadOptouts} onSaved={refresh} />
        ) : !connected ? (
          <SenderProblem wa={wa} />
        ) : (
          <div className="grid">
            <section className="card">
              <div className="card-head">
                <h2>Numbers</h2>
                <span className="count">
                  {filledCount}/{MAX}
                </span>
              </div>
              <p className="hint">10 digit number dalein (India +91 apne aap lag jayega) ya country code ke saath.</p>

              <label className="field-label">Numbers paste karein (sequence me)</label>
              <textarea
                className="paste"
                rows={2}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={handlePasteKey}
                placeholder={'Yaha paste karein — list me apne aap bhar jayenge\n9876543210, 9123456789 …'}
                disabled={sending}
              />

              <div className="import-row">
                <button className="ghost" onClick={() => fileRef.current?.click()} disabled={sending || filledCount >= MAX}>
                  ⤒ Excel se import
                </button>
                <button className="ghost" onClick={addRow} disabled={numbers.length >= MAX || sending}>
                  + Add number
                </button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={handleExcel} />
              </div>

              {notice && (
                <div className={`notice ${notice.type}`}>
                  <button className="icon close" onClick={() => setNotice(null)}>
                    ✕
                  </button>
                  {notice.lines.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              )}

              {(invalidCount > 0 || dupCount > 0 || sentBeforeCount > 0 || blockedCount > 0 || closedCount > 0) && (
                <div className="summary">
                  {invalidCount > 0 && <span className="pill failed">⚠ {invalidCount} galat</span>}
                  {blockedCount > 0 && <span className="pill failed">⛔ {blockedCount} opt-out</span>}
                  {dupCount > 0 && <span className="pill dup">⧉ {dupCount} duplicate</span>}
                  {sentBeforeCount > 0 && <span className="pill sent">✓ {sentBeforeCount} pehle bhej chuke</span>}
                  {closedCount > 0 && <span className="pill sending">⏱ {closedCount} ko template chahiye</span>}
                  {(invalidCount > 0 || dupCount > 0) && (
                    <button className="link-btn" onClick={removeProblemRows} disabled={sending}>
                      Galat/duplicate hatao
                    </button>
                  )}
                </div>
              )}

              <div className="numbers">
                {numbers.map((n, i) => {
                  const r = rows[i];
                  const state = r.issue || r.blocked ? 'bad' : r.dupOf ? 'dup' : r.sentAt ? 'done' : '';
                  return (
                    <div key={i}>
                      <div className="num-row">
                        <span className="idx">{i + 1}</span>
                        <input
                          className={state}
                          value={n}
                          onChange={(e) => updateNumber(i, e.target.value)}
                          placeholder="9876543210"
                          inputMode="tel"
                          disabled={sending}
                        />
                        <button className="icon" onClick={() => removeNumber(i)} disabled={sending} title="Remove">
                          ✕
                        </button>
                      </div>
                      {r.issue && <div className="row-msg bad">⚠ {r.issue}</div>}
                      {r.dupOf && <div className="row-msg dup">⧉ Duplicate — ye number #{r.dupOf} par already hai</div>}
                      {!r.dupOf && r.blocked && (
                        <div className="row-msg bad">⛔ Is number ne STOP kiya hai / opt-out list me hai — message nahi jayega</div>
                      )}
                      {!r.dupOf && !r.blocked && r.sentAt && (
                        <div className="row-msg done">✓ Is number par message ho chuka hai ({fmtDate(r.sentAt)})</div>
                      )}
                      {isCustom && !r.empty && !r.issue && !r.dupOf && !r.blocked && (
                        r.windowEnds ? (
                          <div className="row-msg done">💬 Custom ja sakta hai ({fmtDate(r.windowEnds)} tak)</div>
                        ) : (
                          <div className="row-msg dup">⏱ 24 ghante me reply nahi kiya — custom nahi jayega, template chahiye</div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>

              {filledCount > 0 && (
                <button className="link-btn" onClick={clearAll} disabled={sending}>
                  Saare numbers hatao
                </button>
              )}
            </section>

            <section className="card">
              <div className="from-bar">
                <span className="hint">Bhejne wala:</span>
                <b>+{wa.sender.phone}</b>
                {wa.sender.name && <span className="hint">({wa.sender.name})</span>}
                {wa.limit !== undefined && (
                  <span className={`usage ${wa.usedToday >= wa.limit ? 'full' : ''}`}>
                    Aaj: {wa.usedToday}/{wa.limit}
                  </span>
                )}
              </div>
              <div className="mode-switch">
                <button className={!isCustom ? 'on' : ''} onClick={() => setMode('template')} disabled={sending}>
                  📋 Template
                </button>
                <button className={isCustom ? 'on' : ''} onClick={() => setMode('custom')} disabled={sending}>
                  ✍ Custom message
                </button>
              </div>
              {isCustom ? (
                <CustomComposer
                  text={customText}
                  setText={setCustomText}
                  image={image}
                  setImage={setImage}
                  pickImage={() => imageRef.current?.click()}
                  uploading={uploading}
                  sending={sending}
                />
              ) : (
              <Composer
                state={templates}
                reload={loadTemplates}
                tpl={tpl}
                templateKey={templateKey}
                setTemplateKey={(k) => {
                  setTemplateKey(k);
                  setParams([]);
                }}
                params={params}
                setParams={setParams}
                image={image}
                setImage={setImage}
                pickImage={() => imageRef.current?.click()}
                uploading={uploading}
                sending={sending}
              />
              )}
              <input ref={imageRef} type="file" accept="image/jpeg,image/png" hidden onChange={pickImage} />
              <div className="msg-foot">
                <label className="check">
                  <input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} disabled={sending} />
                  Pehle bheje gaye numbers par dobara bhejein
                </label>
                <button className="primary" onClick={send} disabled={sending || uploading || !sendable.length || !messageReady}>
                  {sendLabel}
                </button>
              </div>
              {error && <div className="error">{error}</div>}

              {job && !job.done && (
                <div className="progress">
                  <div className="card-head">
                    <h3>Sending…</h3>
                    <span className="hint">
                      {sentCount + failedCount}/{job.results.length}
                    </span>
                  </div>
                  <div className="bar">
                    <div style={{ width: `${((sentCount + failedCount) / job.results.length) * 100}%` }} />
                  </div>
                  <ul className="results">
                    {job.results.map((r) => (
                      <li key={r.number}>
                        <span>+{r.number}</span>
                        <span className={`pill ${r.status}`} title={r.error || ''}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {job?.done && job.id !== dismissedJob && (
                <SuccessMessage job={job} onClose={() => setDismissedJob(job.id)} />
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function SuccessMessage({ job, onClose }) {
  const sent = job.results.filter((r) => r.status === 'sent');
  const failed = job.results.filter((r) => r.status === 'failed');
  const skipped = job.results.filter((r) => r.status === 'skipped');
  return (
    <div className="done-box">
      <button className="icon close" onClick={onClose} title="Close">
        ✕
      </button>
      {sent.length > 0 ? (
        <div className="success">
          <div className="success-icon">✓</div>
          <div>
            <div className="success-title">Message successfully bhej diya gaya!</div>
            <div className="success-sub">
              {sent.length} number{sent.length === 1 ? '' : 's'} par message Meta ko de diya gaya. Delivered/Read status
              History me dikhega.
            </div>
          </div>
        </div>
      ) : (
        <div className="success fail">
          <div className="success-icon">!</div>
          <div className="success-title">Koi message nahi bheja ja saka.</div>
        </div>
      )}
      {skipped.length > 0 && (
        <div className="failed-list">
          ⏭ {skipped.length} number skip hue: {skipped.map((r) => `+${r.number} (${r.error})`).join(', ')}
        </div>
      )}
      {failed.length > 0 && (
        <div className="failed-list">
          ⚠ {failed.length} number par nahi gaya:{' '}
          {failed.map((r) => `+${r.number}${r.error ? ` (${r.error})` : ''}`).join(', ')}
        </div>
      )}
    </div>
  );
}

function LoginScreen() {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      window.location.reload();
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-logo">✆</div>
        <h2>WA Sender</h2>
        <p className="hint">Admin panel kholne ke liye password dalein.</p>
        <input
          className="text-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
        />
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Login'}
        </button>
      </form>
    </div>
  );
}

function ChangePassword({ hasPassword, onClose, onDone }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (next.length < 8) return setErr('Naya password kam se kam 8 characters ka ho.');
    if (next !== confirmPw) return setErr('Dono naye password match nahi kar rahe.');
    if (hasPassword && next === current) return setErr('Naya password purane se alag hona chahiye.');
    setBusy(true);
    try {
      await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current, next }) });
      setDone(true);
      onDone();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  };

  const type = show ? 'text' : 'password';

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="icon close" onClick={onClose} title="Band karein">
          ✕
        </button>
        <h2>{hasPassword ? 'Password badlein' : 'Password lagayein'}</h2>

        {done ? (
          <>
            <div className="success">
              <div className="success-icon">✓</div>
              <div>
                <div className="success-title">Password badal gaya!</div>
                <div className="success-sub">Agli baar naye password se login karein. Doosre devices log out ho gaye hain.</div>
              </div>
            </div>
            <button type="button" className="primary" onClick={onClose}>
              Theek hai
            </button>
          </>
        ) : (
          <>
            {hasPassword && (
              <>
                <label className="field-label">Purana password</label>
                <input
                  className="text-input"
                  type={type}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                />
              </>
            )}
            <label className="field-label">Naya password</label>
            <input
              className="text-input"
              type={type}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              placeholder="Kam se kam 8 characters"
              autoFocus={!hasPassword}
            />
            <label className="field-label">Naya password dobara</label>
            <input
              className="text-input"
              type={type}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              autoComplete="new-password"
            />
            <label className="check">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              Password dikhayein
            </label>
            {err && <div className="error">{err}</div>}
            <button className="primary" disabled={busy || !next || !confirmPw || (hasPassword && !current)}>
              {busy ? 'Saving…' : 'Password save karein'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

// the official WhatsApp number in the sidebar
function SenderCard({ wa }) {
  const s = wa.sender;
  const state = wa.serverDown ? 'disconnected' : s?.status === 'connected' ? 'connected' : s ? 'disconnected' : 'connecting';
  const title = wa.serverDown
    ? 'Server offline'
    : !s
      ? 'Loading…'
      : s.status === 'connected'
        ? 'Official API'
        : s.status === 'not-configured'
          ? 'API set nahi hai'
          : 'Meta API error';
  return (
    <div className="accounts">
      <div className="acc-heading">WhatsApp Number</div>
      <div className="acc active">
        <div className={`dot ${state}`} />
        <div className="acc-info">
          <div className="acc-title">{title}</div>
          {s?.status === 'connected' && (
            <div className="acc-sub">
              +{s.phone}
              {s.quality && ` · ${s.quality}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SenderProblem({ wa }) {
  if (wa.serverDown)
    return (
      <section className="card connect">
        <p className="error">Backend server nahi chal raha. Terminal me `npm run dev` chalayein.</p>
      </section>
    );
  if (!wa.sender)
    return (
      <section className="card connect">
        <p className="hint">Loading…</p>
      </section>
    );
  return (
    <section className="card connect">
      <h2>{wa.sender.status === 'not-configured' ? 'Official API set nahi hai' : 'Official API connect nahi hua'}</h2>
      {wa.sender.error && <p className="error">{wa.sender.error}</p>}
      <p className="hint">
        Server ki .env me WA_CLOUD_TOKEN, WA_PHONE_NUMBER_ID aur WA_BUSINESS_ACCOUNT_ID check karein. Token expire ho gaya
        ho to naya permanent (System User) token banayein.
      </p>
    </section>
  );
}

function CustomComposer({ text, setText, image, setImage, pickImage, uploading, sending }) {
  return (
    <div className="cloud">
      <h2>Custom message</h2>
      <div className="notice warn">
        WhatsApp ka niyam: custom message sirf unhe jaata hai jinhone <b>pichhle 24 ghante me aapko message kiya</b> ho
        (jaise YES reply wale). Naye logon ke liye approved template hi chahiye — aise numbers apne aap skip honge.
      </div>
      <textarea
        className="message"
        rows={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Apna message likhein…"
        disabled={sending}
      />
      <div className="attach-row">
        {image ? (
          <div className="attach-preview">
            <img src={imgUrl(image)} alt="poster" />
            <div>
              <div className="attach-title">Image / poster lagi hai</div>
              <div className="hint">Message iska caption banega</div>
            </div>
            <button className="icon" onClick={() => setImage(null)} disabled={sending} title="Image hatao">
              ✕
            </button>
          </div>
        ) : (
          <button className="ghost" onClick={pickImage} disabled={sending || uploading}>
            {uploading ? 'Upload ho raha hai…' : '🖼 Image / poster lagayein (JPG/PNG)'}
          </button>
        )}
      </div>
      <div className="hint right">
        {text.length}/{image ? 1024 : 4096} characters
      </div>
    </div>
  );
}

function Composer({ state, reload, tpl, templateKey, setTemplateKey, params, setParams, image, setImage, pickImage, uploading, sending }) {
  const preview = tpl ? tpl.body.replace(/\{\{(\d+)\}\}/g, (m, i) => params[i - 1]?.trim() || m) : '';
  return (
    <div className="cloud">
      <div className="card-head">
        <h2>Approved template</h2>
        <button className="link-btn plain" onClick={reload} disabled={state.loading}>
          {state.loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>
      <p className="hint">
        Naye logon ko sirf Meta se approve hue template hi bhej sakte hain. Template WhatsApp Manager me banayein, approve
        hone ke baad yaha dikhega.
      </p>
      {state.error && <div className="error">{state.error}</div>}
      {!state.loading && !state.error && !state.list.length && (
        <div className="notice warn">
          Abhi koi approved template nahi hai.{' '}
          <a href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noreferrer">
            Template banayein →
          </a>
        </div>
      )}
      {state.list.length > 0 && (
        <select className="text-input" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} disabled={sending}>
          <option value="">— Template chunein —</option>
          {state.list.map((t) => (
            <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
              {t.name} ({t.language}) · {t.category}
            </option>
          ))}
        </select>
      )}

      {tpl && (
        <>
          {Array.from({ length: tpl.vars }, (_, i) => (
            <div key={i}>
              <label className="field-label">{`{{${i + 1}}}`} ki value</label>
              <input
                className="text-input"
                value={params[i] || ''}
                onChange={(e) => setParams((p) => Object.assign([...p], { [i]: e.target.value }))}
                disabled={sending}
              />
            </div>
          ))}

          {tpl.headerFormat === 'IMAGE' && (
            <div className="attach-row">
              {image ? (
                <div className="attach-preview">
                  <img src={imgUrl(image)} alt="poster" />
                  <div className="attach-title">Header image</div>
                  <button className="icon" onClick={() => setImage(null)} disabled={sending} title="Image hatao">
                    ✕
                  </button>
                </div>
              ) : (
                <button className="ghost" onClick={pickImage} disabled={sending || uploading}>
                  {uploading ? 'Upload ho raha hai…' : '🖼 Template ki header image lagayein (JPG/PNG)'}
                </button>
              )}
            </div>
          )}

          <div className="wa-preview">
            {tpl.headerFormat === 'IMAGE' && image && <img src={imgUrl(image)} alt="" />}
            {tpl.headerText && <b>{tpl.headerText}</b>}
            <p>{preview}</p>
            {tpl.footer && <small>{tpl.footer}</small>}
            {tpl.buttons.length > 0 && (
              <div className="wa-buttons">
                {tpl.buttons.map((b) => (
                  <span key={b}>{b}</span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Safety({ wa, optouts, reloadOptouts, onSaved }) {
  const [limit, setLimit] = useState(() => wa.limit ?? '');
  const [saved, setSaved] = useState('');
  const [err, setErr] = useState('');
  const [text, setText] = useState('');

  const saveLimit = async () => {
    setErr('');
    setSaved('');
    try {
      await api('/api/settings/limits', { method: 'PUT', body: JSON.stringify({ cloud: limit }) });
      setSaved('Limit save ho gayi ✓');
      onSaved();
    } catch (e) {
      setErr(e.message);
    }
  };

  const addNumbers = async () => {
    setErr('');
    try {
      await api('/api/optouts', { method: 'POST', body: JSON.stringify({ numbers: extractTokens(text) }) });
      setText('');
      reloadOptouts();
    } catch (e) {
      setErr(e.message);
    }
  };

  const remove = async (n) => {
    if (!confirm(`+${n} ko opt-out list se hatana hai? Iske baad is number par message ja sakega.`)) return;
    await api(`/api/optouts/${n}`, { method: 'DELETE' }).catch(() => {});
    reloadOptouts();
  };

  return (
    <div className="templates">
      <section className="card">
        <h2>Roz ki limit</h2>
        <p className="hint">
          Ek din (India time) me itne logon tak hi message jayega. Meta ki apni limit abhi{' '}
          {wa.sender?.tier ? wa.sender.tier.replace('TIER_', '') : '250'} log / 24 ghante hai — usse zyada rakhne ka fayda
          nahi.
        </p>
        <div className="limits">
          <label className="limit-row">
            <span>
              <b>Official API</b>
              <span className="hint"> · aaj {wa.usedToday || 0} bheje</span>
            </span>
            <input className="text-input" type="number" min="0" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </label>
        </div>
        {err && <div className="error">{err}</div>}
        <div className="tpl-actions">
          {saved && <span className="hint">{saved}</span>}
          <button className="primary small" onClick={saveLimit}>
            Save
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Opt-out (Do Not Disturb) list</h2>
          <span className="count">{optouts.length}</span>
        </div>
        <p className="hint">
          Jo log "STOP" likh kar reply karte hain ya "Stop promotions" button dabate hain, wo apne aap yaha aa jaate hain.
          In numbers par kabhi message nahi jayega. Kisi ne call/chat par mana kiya ho to number yaha khud bhi daal sakti
          hain.
        </p>
        <div className="optout-add">
          <textarea
            className="paste"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="9876543210, 9123456789 …"
          />
          <button className="ghost" onClick={addNumbers} disabled={!text.trim()}>
            ⛔ List me daalein
          </button>
        </div>
        {optouts.length > 0 && (
          <ul className="results">
            {optouts.map((o) => (
              <li key={o.number}>
                <span>
                  +{o.number}
                  <span className="hint">
                    {' '}
                    · {o.source === 'manual' ? 'manual' : `"${o.note}"`} · {fmtDate(o.createdAt)}
                  </span>
                </span>
                <button className="link-btn" onClick={() => remove(o.number)}>
                  Hatao
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Inbox() {
  const [view, setView] = useState('replies'); // replies | sent
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null); // selected number
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const endRef = useRef(null);

  const loadList = () => api('/api/inbox').then(setList).catch(() => {});
  const loadThread = (n) => api(`/api/inbox/${n}`).then(setThread).catch(() => {});

  useEffect(() => {
    loadList();
    const id = setInterval(loadList, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setErr('');
    if (!open) return setThread(null);
    loadThread(open);
    const id = setInterval(() => loadThread(open), 4000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread?.messages?.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await api(`/api/inbox/${open}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
      setText('');
      await loadThread(open);
      loadList();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  };

  const askNotify = async () => setPerm(await Notification.requestPermission());

  const shown = (list || []).filter((c) =>
    filter === 'yes' ? c.interested : filter === 'unread' ? c.unread > 0 : filter === 'stop' ? c.stop : true
  );
  const counts = {
    yes: (list || []).filter((c) => c.interested).length,
    unread: (list || []).filter((c) => c.unread > 0).length,
    stop: (list || []).filter((c) => c.stop).length,
  };

  return (
    <div className={`inbox ${open ? 'has-thread' : ''}`}>
      <section className="card inbox-list">
        <div className="mode-switch">
          <button className={view === 'replies' ? 'on' : ''} onClick={() => setView('replies')}>
            💬 Replies
          </button>
          <button className={view === 'sent' ? 'on' : ''} onClick={() => setView('sent')}>
            📊 Sent status
          </button>
        </div>
        {view === 'sent' ? (
          <SentStatus open={open} onOpen={setOpen} />
        ) : (
          <>
        <div className="card-head">
          <h2>Inbox</h2>
          {perm === 'default' && (
            <button className="link-btn plain" onClick={askNotify}>
              🔔 Notification chalu karein
            </button>
          )}
        </div>
        <p className="hint">Customers ke reply yaha aate hain. YES/haan wale ⭐ ke saath dikhte hain.</p>
        <div className="filters">
          {[
            ['all', 'Sab'],
            ['yes', `⭐ YES (${counts.yes})`],
            ['unread', `Unread (${counts.unread})`],
            ['stop', `STOP (${counts.stop})`],
          ].map(([k, label]) => (
            <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        {list === null ? (
          <p className="hint">Loading…</p>
        ) : !shown.length ? (
          <p className="hint">Abhi koi reply nahi hai.</p>
        ) : (
          <ul className="convs">
            {shown.map((c) => (
              <li
                key={c.number}
                className={`${open === c.number ? 'on' : ''} ${c.unread ? 'unread' : ''}`}
                onClick={() => setOpen(c.number)}
              >
                <div className="conv-top">
                  <b>
                    {c.interested && '⭐ '}
                    {c.name || `+${c.number}`}
                  </b>
                  <span className="hint">{fmtDate(c.lastTime)}</span>
                </div>
                <div className="conv-bottom">
                  <span className="conv-text">
                    {c.lastDirection === 'out' && '↪ '}
                    {c.lastText}
                  </span>
                  {c.stop && <span className="pill failed">STOP</span>}
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </div>
                {c.name && <div className="hint conv-num">+{c.number}</div>}
              </li>
            ))}
          </ul>
        )}
          </>
        )}
      </section>

      {open && (
        <section className="card thread">
          <div className="thread-head">
            <button className="icon back" onClick={() => setOpen(null)} title="Wapas">
              ←
            </button>
            <div className="thread-who">
              <b>{thread?.name || `+${open}`}</b>
              {(thread?.name || thread?.optedOut) && (
                <div className="hint">
                  {thread?.name && `+${open}`}
                  {thread?.optedOut && `${thread?.name ? ' · ' : ''}⛔ opt-out (STOP)`}
                </div>
              )}
            </div>
            <a className="link-btn plain" href={`tel:+${open}`}>
              📞 Call
            </a>
          </div>

          <div className="bubbles">
            {(thread?.messages || []).map((m) => (
              <div key={m.id} className={`bubble ${m.direction} ${m.interested ? 'yes' : ''}`}>
                {m.image && <img src={imgUrl(m.image)} alt="" />}
                <div className="bubble-text">{m.text}</div>
                <div className="bubble-meta">
                  {m.template && 'template · '}
                  {fmtDate(m.time)}
                  {m.direction === 'out' && m.delivery && ` · ${DELIVERY_LABEL[m.delivery] || m.delivery}`}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {thread && !thread.canReply ? (
            <div className="notice warn">
              Customer ke aakhri message ko 24 ghante ho gaye — WhatsApp ke niyam se ab sirf approved template bhej sakte
              hain. Unhe call kar sakti hain.
            </div>
          ) : (
            <form className="reply-box" onSubmit={send}>
              <textarea
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Jawab likhein…"
                disabled={busy || thread?.optedOut}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) send(e);
                }}
              />
              <button className="primary" disabled={busy || !text.trim() || thread?.optedOut}>
                {busy ? '…' : 'Send'}
              </button>
            </form>
          )}
          {thread?.canReply && thread.windowEndsAt && (
            <div className="hint">Jawab de sakti hain {fmtDate(thread.windowEndsAt)} tak.</div>
          )}
          {err && <div className="error">{err}</div>}
        </section>
      )}
    </div>
  );
}


const SENT_FILTERS = [
  ['all', 'Sab'],
  ['read', '👁 Read'],
  ['delivered', '✓✓ Delivered (padha nahi)'],
  ['sent', '✓ Sent (pahuncha nahi abhi)'],
  ['failed', '⚠ Failed'],
  ['replied', '💬 Reply kiya'],
];

function SentStatus({ open, onOpen }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let alive = true;
    const load = () =>
      api(`/api/sent-status?days=${days}`)
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [days]);

  const c = data?.counts || {};
  const pct = (n) => (c.total ? Math.round((n / c.total) * 100) : 0);
  // read also means delivered
  const deliveredTotal = (c.delivered || 0) + (c.read || 0);
  const rows = (data?.rows || []).filter((r) =>
    filter === 'all' ? true : filter === 'replied' ? r.replied : r.status === filter
  );

  return (
    <>
      <div className="card-head">
        <h2>Sent status</h2>
        <select className="text-input days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Aaj / 24 ghante</option>
          <option value={7}>Pichhle 7 din</option>
          <option value={30}>Pichhle 30 din</option>
          <option value={90}>Pichhle 90 din</option>
        </select>
      </div>
      <p className="hint">Jitne logon ko message bheja, unme kis tak pahuncha aur kisne padha.</p>

      {data === null ? (
        <p className="hint">Loading…</p>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <b>{c.total || 0}</b>
              <span>Bheje</span>
            </div>
            <div className="stat ok">
              <b>{deliveredTotal}</b>
              <span>Pahunche · {pct(deliveredTotal)}%</span>
            </div>
            <div className="stat read">
              <b>{c.read || 0}</b>
              <span>Padhe · {pct(c.read || 0)}%</span>
            </div>
            <div className="stat bad">
              <b>{c.failed || 0}</b>
              <span>Failed</span>
            </div>
            <div className="stat yes">
              <b>{c.replied || 0}</b>
              <span>Reply · {pct(c.replied || 0)}%</span>
            </div>
          </div>

          <div className="filters">
            {SENT_FILTERS.map(([k, label]) => (
              <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                {label} ({k === 'all' ? c.total || 0 : c[k] || 0})
              </button>
            ))}
          </div>

          {!rows.length ? (
            <p className="hint">Is filter me koi number nahi hai.</p>
          ) : (
            <ul className="convs">
              {rows.map((r) => (
                <li key={r.number} className={open === r.number ? 'on' : ''} onClick={() => onOpen(r.number)}>
                  <div className="conv-top">
                    <b>{r.name || `+${r.number}`}</b>
                    <span className={`pill ${r.status === 'read' ? 'read' : r.status === 'failed' ? 'failed' : r.status === 'delivered' ? 'sent' : 'sending'}`}>
                      {DELIVERY_LABEL[r.status] || r.status}
                    </span>
                  </div>
                  <div className="conv-bottom">
                    <span className="conv-text">{r.error ? `⚠ ${r.error}` : r.template ? `📋 ${r.template}` : r.text}</span>
                    {r.replied && <span className="pill dup">💬 Reply</span>}
                  </div>
                  <div className="hint conv-num">
                    {r.name && `+${r.number} · `}
                    {fmtDate(r.time)}
                    {r.count > 1 && ` · ${r.count} message`}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="hint small-note">
            "Read" tabhi dikhta hai jab us insaan ne WhatsApp me <b>read receipts (blue tick) ON</b> rakhe hon. Blue tick
            band ho to padhne ke baad bhi "Delivered" hi dikhega.
          </p>
        </>
      )}
    </>
  );
}

function History({ history }) {
  if (!history.length)
    return (
      <section className="card">
        <p className="hint">Abhi tak koi message nahi bheja gaya.</p>
      </section>
    );
  return (
    <div className="history">
      {history.map((job) => {
        const sent = job.results.filter((r) => r.status === 'sent').length;
        return (
          <section className="card" key={job.id}>
            <div className="card-head">
              <span className="hint">
                {fmtDate(job.createdAt)}
                {job.from && ` · from +${job.from}`}
                {job.template && ` · ${job.template.name}`}
              </span>
              <span className="count">
                {sent}/{job.results.length} sent
              </span>
            </div>
            <div className="history-msg">
              {job.image && <img src={imgUrl(job.image)} alt="poster" />}
              {job.message && <p>{job.message}</p>}
            </div>
            <ul className="results">
              {job.results.map((r) => (
                <li key={r.number}>
                  <span>+{r.number}</span>
                  <span className={`pill ${r.delivery === 'failed' ? 'failed' : r.status}`}>
                    {(r.delivery && DELIVERY_LABEL[r.delivery]) || STATUS_LABEL[r.status]}
                    {r.error ? ` – ${r.error}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
