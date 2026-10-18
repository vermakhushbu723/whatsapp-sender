import { useEffect, useMemo, useRef, useState } from 'react';

const MAX = 20;
const DEFAULT_COUNTRY_CODE = '91';

const STATUS_LABEL = {
  pending: 'Waiting',
  sending: 'Sending…',
  sent: 'Sent ✓',
  failed: 'Failed',
};

async function api(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Server error');
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
  if (!file.type.startsWith('image/')) throw new Error('Sirf image file chunein (JPG, PNG, WEBP).');
  if (file.size > 15 * 1024 * 1024) throw new Error('Image 15MB se chhoti honi chahiye.');
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
  const [wa, setWa] = useState({ loading: true, accounts: [] });
  const [numbers, setNumbers] = useState(['']);
  const [pasteText, setPasteText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [history, setHistory] = useState([]);
  const [resend, setResend] = useState(false);
  const [tab, setTab] = useState('send');
  const [dismissedJob, setDismissedJob] = useState(null);
  const [image, setImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(null);
  const imageRef = useRef(null);

  const loadTemplates = () => api('/api/templates').then(setTemplates).catch(() => {});
  useEffect(() => {
    loadTemplates();
  }, []);
  const fileRef = useRef(null);

  // poll connection + job status
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api('/api/status')
        .then((d) => alive && setWa(d))
        .catch(() => alive && setWa({ serverDown: true, accounts: [] }));
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const job = wa.job;
  const sending = !!job && !job.done;
  const activeAcc = wa.accounts.find((a) => a.id === wa.active);

  useEffect(() => {
    api('/api/history').then(setHistory).catch(() => {});
  }, [tab, job?.done]);

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
      return { value, norm, issue, dupOf, sentAt: !issue && sentMap[norm] };
    });
  }, [numbers, sentMap]);

  const filledCount = rows.filter((r) => !r.empty).length;
  const invalidCount = rows.filter((r) => r.issue).length;
  const dupCount = rows.filter((r) => r.dupOf).length;
  const sentBeforeCount = rows.filter((r) => r.sentAt && !r.dupOf).length;
  const sendable = rows.filter((r) => !r.empty && !r.issue && !r.dupOf && (resend || !r.sentAt));

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
    if (!sendable.length) return setError('Bhejne ke liye koi naya sahi number nahi hai.');
    if (!message.trim() && !image) return setError('Message likhein ya image lagayein.');
    try {
      const d = await api('/api/send', {
        method: 'POST',
        body: JSON.stringify({ numbers: sendable.map((r) => r.norm), message, image }),
      });
      setWa((w) => ({ ...w, job: d.job }));
    } catch (e) {
      setError(e.message);
    }
  };

  const applyTemplate = (t) => {
    setMessage(t.text);
    setImage(t.image);
    setTemplateId(t.id);
    setTab('send');
  };

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      setImage(await uploadImage(file));
      setTemplateId(null);
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
  };

  const saveAsTemplate = async () => {
    const name = prompt('Template ka naam dalein:', `Message ${templates.length + 1}`);
    if (!name) return;
    try {
      const t = await api('/api/templates', { method: 'POST', body: JSON.stringify({ name, text: message, image }) });
      setTemplateId(t.id);
      loadTemplates();
    } catch (err) {
      setError(err.message);
    }
  };

  const refresh = () => api('/api/status').then(setWa).catch(() => {});

  const accountAction = async (id, action) => {
    if (action === 'logout' && !confirm(`Account ${id} ko WhatsApp se logout karna hai?`)) return;
    try {
      await api(`/api/accounts/${id}/${action}`, { method: 'POST' });
      if (action === 'login') await api(`/api/accounts/${id}/select`, { method: 'POST' });
      setError('');
    } catch (e) {
      alert(e.message);
    }
    refresh();
  };

  const sentCount = job?.results.filter((r) => r.status === 'sent').length || 0;
  const failedCount = job?.results.filter((r) => r.status === 'failed').length || 0;

  let sendLabel = `Send to ${sendable.length} number${sendable.length === 1 ? '' : 's'}`;
  if (sending) sendLabel = 'Sending…';
  else if (!sendable.length && sentBeforeCount) sendLabel = 'Sent ✓ — naya number dalein';

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
          <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>
            Saved Messages
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            History
          </button>
        </nav>
        <AccountSwitcher wa={wa} sending={sending} onAction={accountAction} />
      </aside>

      <main className="content">
        {tab === 'history' ? (
          <History history={history} />
        ) : tab === 'templates' ? (
          <Templates templates={templates} reload={loadTemplates} onUse={applyTemplate} />
        ) : activeAcc?.status !== 'connected' ? (
          <ConnectPanel wa={wa} account={activeAcc} onLogin={(id) => accountAction(id, 'login')} />
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

              {(invalidCount > 0 || dupCount > 0 || sentBeforeCount > 0) && (
                <div className="summary">
                  {invalidCount > 0 && <span className="pill failed">⚠ {invalidCount} galat</span>}
                  {dupCount > 0 && <span className="pill dup">⧉ {dupCount} duplicate</span>}
                  {sentBeforeCount > 0 && <span className="pill sent">✓ {sentBeforeCount} pehle bhej chuke</span>}
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
                  const state = r.issue ? 'bad' : r.dupOf ? 'dup' : r.sentAt ? 'done' : '';
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
                      {!r.dupOf && r.sentAt && (
                        <div className="row-msg done">✓ Is number par message ho chuka hai ({fmtDate(r.sentAt)})</div>
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
                <b>
                  Account {activeAcc.id} · +{activeAcc.me?.id}
                </b>
                {activeAcc.me?.name && <span className="hint">({activeAcc.me.name})</span>}
              </div>
              {templates.length > 0 && (
                <div className="tpl-chips">
                  <span className="hint">Saved:</span>
                  {templates.map((t, i) => (
                    <button
                      key={t.id}
                      className={`chip ${templateId === t.id ? 'on' : ''}`}
                      onClick={() => applyTemplate(t)}
                      disabled={sending}
                      title={t.text}
                    >
                      <b>{i + 1}</b> {t.name}
                      {t.image && ' 🖼'}
                    </button>
                  ))}
                </div>
              )}
              <h2>Message</h2>
              <textarea
                className="message"
                rows={8}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setTemplateId(null);
                }}
                placeholder="Apna message yaha likhein…"
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
                    <button
                      className="icon"
                      onClick={() => {
                        setImage(null);
                        setTemplateId(null);
                      }}
                      disabled={sending}
                      title="Image hatao"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button className="ghost" onClick={() => imageRef.current?.click()} disabled={sending || uploading}>
                    {uploading ? 'Upload ho raha hai…' : '🖼 Image / poster lagayein'}
                  </button>
                )}
                <button
                  className="ghost"
                  onClick={saveAsTemplate}
                  disabled={sending || (!message.trim() && !image) || !!templateId}
                  title={templateId ? 'Ye message pehle se saved hai' : ''}
                >
                  {templateId ? '✓ Saved message' : '💾 Save karein'}
                </button>
                <input ref={imageRef} type="file" accept="image/*" hidden onChange={pickImage} />
              </div>
              <div className="msg-foot">
                <label className="check">
                  <input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} disabled={sending} />
                  Pehle bheje gaye numbers par dobara bhejein
                </label>
                <button className="primary" onClick={send} disabled={sending || uploading || !sendable.length || (!message.trim() && !image)}>
                  {sendLabel}
                </button>
              </div>
              <div className="hint right">{message.length} characters</div>
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
              {sent.length} number{sent.length === 1 ? '' : 's'} par message pahuch gaya. Aap ise apne WhatsApp me bhi dekh
              sakte hain.
            </div>
          </div>
        </div>
      ) : (
        <div className="success fail">
          <div className="success-icon">!</div>
          <div className="success-title">Koi message nahi bheja ja saka.</div>
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

const ACC_STATUS = {
  connected: 'Connected',
  qr: 'QR scan karein',
  connecting: 'Connecting…',
  disconnected: 'Reconnecting…',
  idle: 'Login nahi hai',
};

function AccountSwitcher({ wa, sending, onAction }) {
  if (wa.serverDown)
    return (
      <div className="accounts">
        <div className="acc">
          <div className="dot disconnected" />
          <div className="acc-title">Server offline</div>
        </div>
      </div>
    );

  return (
    <div className="accounts">
      <div className="acc-heading">WhatsApp Accounts</div>
      {wa.accounts.map((a) => {
        const active = a.id === wa.active;
        return (
          <div
            key={a.id}
            className={`acc ${active ? 'active' : ''}`}
            onClick={() => !active && !sending && onAction(a.id, 'select')}
            title={active ? 'Abhi isi account se message jayenge' : 'Is account par switch karein'}
          >
            <div className={`dot ${a.status}`} />
            <div className="acc-info">
              <div className="acc-title">
                Account {a.id}
                {active && <span className="acc-tag">Active</span>}
              </div>
              <div className="acc-sub">{a.me ? `+${a.me.id}${a.me.name ? ` · ${a.me.name}` : ''}` : ACC_STATUS[a.status]}</div>
            </div>
            {a.status === 'idle' ? (
              <button
                className="acc-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(a.id, 'login');
                }}
              >
                Login
              </button>
            ) : (
              <button
                className="acc-btn out"
                disabled={sending && active}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(a.id, 'logout');
                }}
              >
                {a.status === 'connected' ? 'Logout' : 'Cancel'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConnectPanel({ wa, account, onLogin }) {
  if (wa.serverDown)
    return (
      <section className="card connect">
        <p className="error">Backend server nahi chal raha. Terminal me `npm run dev` chalayein.</p>
      </section>
    );
  if (!account)
    return (
      <section className="card connect">
        <p className="hint">Loading…</p>
      </section>
    );

  return (
    <section className="card connect">
      <h2>Account {account.id} — WhatsApp connect karein</h2>
      {account.status === 'idle' ? (
        <>
          <p className="hint">Is account me abhi koi WhatsApp login nahi hai.</p>
          <button className="primary" onClick={() => onLogin(account.id)}>
            QR code se login karein
          </button>
        </>
      ) : account.qr ? (
        <>
          <img src={account.qr} alt="WhatsApp QR" className="qr" />
          <ol>
            <li>Phone me WhatsApp kholein</li>
            <li>
              <b>Settings → Linked Devices → Link a device</b> par jayein
            </li>
            <li>Is QR code ko scan karein</li>
          </ol>
          <p className="hint">
            Jis number se scan karenge, usi number se messages jayenge aur aapke WhatsApp chats me bhi dikhenge.
          </p>
        </>
      ) : account.status === 'disconnected' ? (
        <p className="hint">Connection toot gaya, dobara connect ho raha hai…</p>
      ) : (
        <p className="hint">QR code load ho raha hai…</p>
      )}
    </section>
  );
}

function Templates({ templates, reload, onUse }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const open = (t) => {
    setErr('');
    setForm(t ? { ...t } : { id: null, name: `Message ${templates.length + 1}`, text: '', image: null });
  };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const name = await uploadImage(file);
      setForm((f) => ({ ...f, image: name }));
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const body = JSON.stringify({ name: form.name, text: form.text, image: form.image });
      if (form.id) await api(`/api/templates/${form.id}`, { method: 'PUT', body });
      else await api('/api/templates', { method: 'POST', body });
      setForm(null);
      reload();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  };

  const remove = async (t) => {
    if (!confirm(`"${t.name}" delete karna hai?`)) return;
    await api(`/api/templates/${t.id}`, { method: 'DELETE' }).catch(() => {});
    reload();
  };

  return (
    <div className="templates">
      <div className="card-head tpl-top">
        <div>
          <h2>Saved Messages</h2>
          <p className="hint">Message 1, 2, 3… save karein — text ke saath image/poster bhi. Send page par ek click me lagayein.</p>
        </div>
        {!form && (
          <button className="primary" onClick={() => open(null)}>
            + Naya message
          </button>
        )}
      </div>

      {form && (
        <section className="card tpl-form">
          <h3>{form.id ? 'Message edit karein' : 'Naya message save karein'}</h3>
          <label className="field-label">Naam</label>
          <input className="text-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label className="field-label">Message</label>
          <textarea
            className="message"
            rows={6}
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            placeholder="Message likhein… (image ke saath ye caption banega)"
          />
          <div className="attach-row">
            {form.image ? (
              <div className="attach-preview">
                <img src={imgUrl(form.image)} alt="poster" />
                <div className="attach-title">Image / poster</div>
                <button className="icon" onClick={() => setForm({ ...form, image: null })} title="Image hatao">
                  ✕
                </button>
              </div>
            ) : (
              <button className="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? 'Upload ho raha hai…' : '🖼 Image / poster lagayein'}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
          </div>
          {err && <div className="error">{err}</div>}
          <div className="tpl-actions">
            <button className="ghost" onClick={() => setForm(null)} disabled={busy}>
              Cancel
            </button>
            <button className="primary" onClick={save} disabled={busy}>
              Save
            </button>
          </div>
        </section>
      )}

      {!templates.length && !form && (
        <section className="card">
          <p className="hint">Abhi koi message saved nahi hai. "+ Naya message" dabakar banayein.</p>
        </section>
      )}

      <div className="tpl-grid">
        {templates.map((t, i) => (
          <section className="card tpl-card" key={t.id}>
            <div className="tpl-name">
              <span className="tpl-no">{i + 1}</span>
              {t.name}
            </div>
            {t.image && <img className="tpl-img" src={imgUrl(t.image)} alt="poster" />}
            {t.text && <p className="tpl-text">{t.text}</p>}
            <div className="tpl-actions">
              <button className="link-btn plain" onClick={() => open(t)}>
                Edit
              </button>
              <button className="link-btn" onClick={() => remove(t)}>
                Delete
              </button>
              <button className="primary small" onClick={() => onUse(t)}>
                Use karein →
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
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
                  <span className={`pill ${r.status}`}>
                    {STATUS_LABEL[r.status]}
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
