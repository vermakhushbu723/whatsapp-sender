import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

export const CATS = {
  social: { label: 'Social post', color: '#e1306c' },
  video: { label: 'Reel / Video', color: '#7c3aed' },
  thought: { label: 'Thought', color: '#f59e0b' },
  seo: { label: 'SEO', color: '#2563eb' },
  whatsapp: { label: 'WhatsApp', color: '#16a34a' },
  ads: { label: 'Ads', color: '#ea580c' },
  engagement: { label: 'Engagement', color: '#0891b2' },
  planning: { label: 'Planning', color: '#64748b' },
};

export const BRANDS = {
  achivora: { name: 'Achivora', tag: 'Website, App, Ads & Digital Marketing', color: '#029d2b' },
  jyotessa: { name: 'Jyotessa', tag: 'Handmade soy candles & gift sets', color: '#c27c2c' },
};

const DAY_NAMES = ['Somvaar', 'Mangalvaar', 'Budhvaar', 'Guruvaar', 'Shukravaar', 'Shanivaar', 'Ravivaar'];
const DAY_SHORT = ['Som', 'Mangal', 'Budh', 'Guru', 'Shukra', 'Shani', 'Ravi'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// today's date in India as YYYY-MM-DD
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const shiftDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayNum = (ymd) => Number(ymd.slice(8, 10));
const fmtShort = (ymd) => `${dayNum(ymd)} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;

const blankForm = (date) => ({ id: null, date, category: 'social', platform: '', title: '', details: '' });

const isWide = () => window.matchMedia('(min-width: 1100px)').matches;

export default function Planner({ brand = 'achivora', onBrand }) {
  const B = BRANDS[brand] || BRANDS.achivora;
  const [anchor, setAnchor] = useState(todayIST());
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [dayIdx, setDayIdx] = useState(null);
  const [view, setView] = useState(() => (isWide() ? 'chart' : 'day')); // chart | day | week
  const [cat, setCat] = useState('all');
  const [form, setForm] = useState(null);
  const [openDetails, setOpenDetails] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () =>
    api(`/api/planner?date=${anchor}&brand=${brand}`)
      .then((d) => {
        setData(d);
        setErr('');
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    setData(null);
    setDayIdx(null);
    setCat('all');
    load();
  }, [anchor, brand]);

  // pick today when it is in the shown week, else Monday
  useEffect(() => {
    if (!data) return;
    const i = data.dates.indexOf(todayIST());
    setDayIdx((cur) => (cur === null || cur > 6 ? (i >= 0 ? i : 0) : cur));
  }, [data?.week, data?.brand]);

  const today = todayIST();
  const tasks = data?.tasks || [];
  const byDate = useMemo(() => {
    const m = {};
    for (const d of data?.dates || []) m[d] = [];
    for (const t of tasks) (m[t.date] ||= []).push(t);
    return m;
  }, [tasks, data?.dates]);

  const doneCount = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const catCounts = useMemo(() => {
    const c = {};
    for (const t of tasks) c[t.category] = (c[t.category] || 0) + 1;
    return c;
  }, [tasks]);

  const selDate = data?.dates?.[dayIdx ?? 0];
  const dayTasks = (byDate[selDate] || []).filter((t) => cat === 'all' || t.category === cat);
  const dayAll = byDate[selDate] || [];
  const dayDone = dayAll.filter((t) => t.done).length;

  const toggle = async (t) => {
    setData((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)) }));
    try {
      await api(`/api/planner/${t.id}`, { method: 'PATCH', body: JSON.stringify({ done: !t.done }) });
    } catch (e) {
      setErr(e.message);
      load();
    }
  };

  const generate = async () => {
    setBusy(true);
    try {
      await api('/api/planner/generate', { method: 'POST', body: JSON.stringify({ date: data.week, brand }) });
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = JSON.stringify({ ...form, brand });
      if (form.id) await api(`/api/planner/${form.id}`, { method: 'PATCH', body });
      else await api('/api/planner', { method: 'POST', body });
      setForm(null);
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  };

  const remove = async (t) => {
    if (!confirm(`"${t.title}" hatana hai?`)) return;
    setData((d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== t.id) }));
    await api(`/api/planner/${t.id}`, { method: 'DELETE' }).catch(() => load());
  };

  const weekLabel = data ? `${fmtShort(data.dates[0])} – ${fmtShort(data.dates[6])} ${data.dates[6].slice(0, 4)}` : '';
  const isThisWeek = data?.dates.includes(today);

  return (
    <div className="planner">
      {/* week header */}
      <section className="card plan-head" style={{ '--bc': B.color }}>
        {onBrand && (
          <div className="brand-switch" role="tablist">
            {Object.entries(BRANDS).map(([k, b]) => (
              <button key={k} className={k === brand ? 'on' : ''} style={{ '--bc': b.color }} onClick={() => k !== brand && onBrand(k)}>
                {b.name}
              </button>
            ))}
          </div>
        )}
        <div className="plan-row">
          <div className="plan-brand">
            <b>{B.name} Tasks</b>
            <span className="hint">{B.tag}</span>
          </div>
          <div className="plan-week">
            <button className="nav-arrow" onClick={() => setAnchor(shiftDays(data?.week || anchor, -7))} title="Pichhla hafta">
              ‹
            </button>
            <div className="plan-week-label">
              {weekLabel || '…'} <span className="hint">· Hafta {data?.weekNo ?? '–'}</span>
            </div>
            <button className="nav-arrow" onClick={() => setAnchor(shiftDays(data?.week || anchor, 7))} title="Agla hafta">
              ›
            </button>
            {!isThisWeek && (
              <button className="link-btn plain" onClick={() => setAnchor(today)}>
                Is hafte par jaayein
              </button>
            )}
          </div>
          <div className="plan-actions">
            {data && tasks.length > 0 && !data.hasPlan && (
              <button className="ghost small-btn" onClick={generate} disabled={busy}>
                {busy ? '…' : 'Standard plan jodein'}
              </button>
            )}
            {data && tasks.length > 0 && (
              <button className="primary small" onClick={() => setForm(blankForm(selDate || data.dates[0]))}>
                + Kaam jodein
              </button>
            )}
          </div>
        </div>
        <div className="plan-row">
          <div className="plan-progress">
            <div className="plan-bar">
              <i style={{ width: `${pct}%` }} />
            </div>
            <span>
              <b>
                {doneCount}/{tasks.length}
              </b>{' '}
              kaam pure · {pct}%{pct === 100 && tasks.length ? ' — poora hafta complete!' : ''}
            </span>
          </div>
        <div className="seg">
          <button className={`chart-btn ${view === 'chart' ? 'on' : ''}`} onClick={() => setView('chart')}>
            Chart
          </button>
          <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>
            Din
          </button>
          <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>
            Hafta
          </button>
        </div>
        </div>
      </section>

      {err && <div className="error">{err}</div>}

      {data === null ? (
        <section className="card">
          <p className="hint">Loading…</p>
        </section>
      ) : !tasks.length ? (
        <section className="card plan-empty">
          <h2>{B.name} ka is hafte ka marketing plan abhi khaali hai</h2>
          <p className="hint">
            {brand === 'jyotessa'
              ? 'Ek click me poore hafte ka plan ban jayega — product posts, candle Reels, gift guides, Thought posts, Pinterest, SEO (blog, product pages, Google Shopping), influencer/corporate outreach, WhatsApp broadcast aur Meta ads.'
              : 'Ek click me poore hafte ka plan ban jayega — har din ke Instagram/Facebook posts, Reels, Thought posts, LinkedIn, YouTube Shorts, SEO (blog, Google Business Profile, backlinks), WhatsApp campaign aur Ads review.'}
          </p>
          <div className="plan-empty-actions">
            <button className="primary" onClick={generate} disabled={busy}>
              {busy ? 'Ban raha hai…' : 'Is hafte ka plan banayein'}
            </button>
            <button className="ghost" onClick={() => setForm(blankForm(selDate || data.dates[0]))}>
              + Khud kaam jodein
            </button>
          </div>
        </section>
      ) : (
        <>
          {/* category filter */}
          <div className="cat-chips">
            <button className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>
              Sab ({tasks.length})
            </button>
            {Object.entries(CATS)
              .filter(([k]) => catCounts[k])
              .map(([k, c]) => (
                <button
                  key={k}
                  className={`chip ${cat === k ? 'on' : ''}`}
                  style={{ '--c': c.color }}
                  onClick={() => setCat(k)}
                >
                  <i className="cat-dot" /> {c.label} ({catCounts[k]})
                </button>
              ))}
          </div>

          {view === 'chart' ? (
            <ChartView
              dates={data.dates}
              tasks={tasks.filter((t) => cat === 'all' || t.category === cat)}
              today={today}
              byDate={byDate}
              onToggle={toggle}
              onEdit={(t) => setForm({ ...blankForm(t.date), ...t })}
              onAdd={(date, category) => setForm({ ...blankForm(date), category })}
            />
          ) : view === 'day' ? (
            <>
              {/* day strip */}
              <div className="day-strip">
                {data.dates.map((d, i) => {
                  const all = byDate[d] || [];
                  const done = all.filter((t) => t.done).length;
                  const full = all.length && done === all.length;
                  return (
                    <button
                      key={d}
                      className={`day-pill ${i === dayIdx ? 'on' : ''} ${d === today ? 'today' : ''} ${full ? 'full' : ''}`}
                      onClick={() => setDayIdx(i)}
                    >
                      <span className="dp-name">{DAY_SHORT[i]}</span>
                      <span className="dp-num">{dayNum(d)}</span>
                      <span className="dp-bar">
                        <i style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
                      </span>
                      <span className="dp-count">{full ? 'Pura' : `${done}/${all.length}`}</span>
                    </button>
                  );
                })}
              </div>

              <section className="card day-card">
                <div className="card-head">
                  <div>
                    <h2>
                      {DAY_NAMES[dayIdx ?? 0]}, {fmtShort(selDate)}
                      {selDate === today && <span className="today-tag">Aaj</span>}
                    </h2>
                    <div className="hint">
                      {dayDone}/{dayAll.length} kaam pure
                    </div>
                  </div>
                  <button className="primary small" onClick={() => setForm(blankForm(selDate))}>
                    + Kaam jodein
                  </button>
                </div>

                {dayAll.length > 0 && dayDone === dayAll.length && (
                  <div className="day-done">Shabaash! Aaj ke saare kaam pure ho gaye.</div>
                )}

                {!dayTasks.length ? (
                  <p className="hint">Is din {cat === 'all' ? 'koi kaam nahi hai' : 'is category ka koi kaam nahi hai'}.</p>
                ) : (
                  <ul className="tasks">
                    {dayTasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        t={t}
                        open={!!openDetails[t.id]}
                        onToggleDetails={() => setOpenDetails((o) => ({ ...o, [t.id]: !o[t.id] }))}
                        onToggle={() => toggle(t)}
                        onEdit={() => setForm({ ...blankForm(t.date), ...t })}
                        onDelete={() => remove(t)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <div className="week-grid">
              {data.dates.map((d, i) => {
                const list = (byDate[d] || []).filter((t) => cat === 'all' || t.category === cat);
                const all = byDate[d] || [];
                const done = all.filter((t) => t.done).length;
                return (
                  <section key={d} className={`card week-col ${d === today ? 'today' : ''}`}>
                    <div className="week-col-head">
                      <div>
                        <b>{DAY_SHORT[i]}</b> <span className="hint">{fmtShort(d)}</span>
                      </div>
                      <span className={`pill ${all.length && done === all.length ? 'sent' : ''}`}>
                        {done}/{all.length}
                      </span>
                    </div>
                    <ul className="mini-tasks">
                      {list.map((t) => (
                        <li key={t.id} className={t.done ? 'done' : ''} style={{ '--c': CATS[t.category]?.color }}>
                          <button className={`check-circle sm ${t.done ? 'on' : ''}`} onClick={() => toggle(t)} aria-label="Tick">
                            <svg viewBox="0 0 24 24">
                              <path d="M5 12.5l4.5 4.5L19 7.5" />
                            </svg>
                          </button>
                          <span onClick={() => setForm({ ...blankForm(t.date), ...t })}>
                            {t.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <button className="link-btn plain add-mini" onClick={() => setForm(blankForm(d))}>
                      + Jodein
                    </button>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {form && (
        <div className="modal-bg" onClick={() => setForm(null)}>
          <form className="card modal task-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <button type="button" className="icon close" onClick={() => setForm(null)}>
              ✕
            </button>
            <h2>{form.id ? 'Kaam badlein' : 'Naya kaam'}</h2>

            <label className="field-label">Kaam</label>
            <input
              className="text-input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Jaise: Reel — website before/after"
              autoFocus
            />

            <label className="field-label">Category</label>
            <div className="cat-pick">
              {Object.entries(CATS).map(([k, c]) => (
                <button
                  type="button"
                  key={k}
                  className={`chip ${form.category === k ? 'on' : ''}`}
                  style={{ '--c': c.color }}
                  onClick={() => setForm({ ...form, category: k })}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="form-row">
              <div>
                <label className="field-label">Din</label>
                <select className="text-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}>
                  {data?.dates.map((d, i) => (
                    <option key={d} value={d}>
                      {DAY_NAMES[i]}, {fmtShort(d)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Platform</label>
                <input
                  className="text-input"
                  value={form.platform}
                  onChange={(e) => setForm({ ...form, platform: e.target.value })}
                  placeholder="Instagram, Google…"
                  list="platforms"
                />
                <datalist id="platforms">
                  {['Instagram', 'Facebook', 'LinkedIn', 'YouTube', 'Google Business Profile', 'achivora.com', 'WA Sender', 'Meta Ads', 'Google Ads'].map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
            </div>

            <label className="field-label">Details (optional)</label>
            <textarea
              className="message"
              rows={3}
              value={form.details}
              onChange={(e) => setForm({ ...form, details: e.target.value })}
              placeholder="Caption, hashtags, link, notes…"
            />

            <div className="tpl-actions">
              {form.id && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    const t = form;
                    setForm(null);
                    remove(t);
                  }}
                >
                  Delete
                </button>
              )}
              <button type="button" className="ghost" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy || !form.title.trim()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// content-calendar chart: categories down the side, days across the top
function ChartView({ dates, tasks, today, byDate, onToggle, onEdit, onAdd }) {
  const cats = Object.keys(CATS).filter((k) => tasks.some((t) => t.category === k));
  const cell = (date, category) => tasks.filter((t) => t.date === date && t.category === category);
  return (
    <section className="card chart-card">
      <div className="chart-scroll">
        <table className="plan-chart">
          <thead>
            <tr>
              <th className="corner">Category</th>
              {dates.map((d, i) => {
                const all = byDate[d] || [];
                const done = all.filter((t) => t.done).length;
                return (
                  <th key={d} className={d === today ? 'today' : ''}>
                    <span className="th-day">
                      {DAY_SHORT[i]} <span className="th-date">{fmtShort(d)}</span>
                    </span>
                    <span className={`th-count ${all.length && done === all.length ? 'full' : ''}`}>
                      {d === today ? 'Aaj · ' : ''}
                      {done}/{all.length}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {cats.map((k) => (
              <tr key={k} style={{ '--c': CATS[k].color }}>
                <th className="row-head">{CATS[k].label}</th>
                {dates.map((d) => {
                  const list = cell(d, k);
                  return (
                    <td key={d} className={d === today ? 'today' : ''}>
                      {list.map((t) => (
                        <div key={t.id} className={`chart-task ${t.done ? 'done' : ''}`}>
                          <button className={`check-circle sm ${t.done ? 'on' : ''}`} onClick={() => onToggle(t)} aria-label="Tick">
                            <svg viewBox="0 0 24 24">
                              <path d="M5 12.5l4.5 4.5L19 7.5" />
                            </svg>
                          </button>
                          <span
                            onClick={() => onEdit(t)}
                            title={[t.title, t.platform, t.details].filter(Boolean).join('\n\n')}
                          >
                            {t.title}
                          </span>
                        </div>
                      ))}
                      <button className="cell-add" onClick={() => onAdd(d, k)} title="Yaha kaam jodein">
                        +
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TaskRow({ t, open, onToggle, onToggleDetails, onEdit, onDelete }) {
  const c = CATS[t.category] || CATS.social;
  return (
    <li className={`task ${t.done ? 'done' : ''}`} style={{ '--c': c.color }}>
      <button className={`check-circle ${t.done ? 'on' : ''}`} onClick={onToggle} aria-label={t.done ? 'Undo' : 'Complete'}>
        <svg viewBox="0 0 24 24">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </button>
      <div className="task-body">
        <div className="task-meta">
          <span className="cat-tag">
            {c.label}
          </span>
          {t.platform && <span className="plat-tag">{t.platform}</span>}
        </div>
        <div className="task-title">{t.title}</div>
        {t.details && (
          <>
            <button className="link-btn plain details-btn" onClick={onToggleDetails}>
              {open ? 'Details chhupayein ▴' : 'Details ▾'}
            </button>
            {open && <div className="task-details">{t.details}</div>}
          </>
        )}
      </div>
      <div className="task-actions">
        <button className="text-act" onClick={onEdit}>
          Edit
        </button>
        <button className="text-act danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}
