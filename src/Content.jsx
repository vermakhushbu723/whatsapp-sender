import { useEffect, useState } from 'react';
import { api } from './api.js';
import { BRANDS } from './Planner.jsx';

// what kind of post it is — different every day so the feed stays interesting
export const MOODS = {
  tips: { label: 'Tips / Gyaan', color: '#2563eb', why: 'Log save aur share karte hain' },
  funny: { label: 'Funny / Meme', color: '#d97706', why: 'Sabse zyada share aur reach' },
  relatable: { label: 'Relatable', color: '#db2777', why: 'Log "ye to main hoon" feel karte hain, comment karte hain' },
  bts: { label: 'Behind the scenes', color: '#7c3aed', why: 'Bharosa banta hai, brand insaani lagta hai' },
  poll: { label: 'Poll / Quiz', color: '#0891b2', why: 'Comments aur story replies badhte hain' },
  trend: { label: 'Trending', color: '#ea580c', why: 'Trending audio se naye log tak pahunch' },
  proof: { label: 'Customer story', color: '#16a34a', why: 'Naye customer ka bharosa jeet-ta hai' },
  festival: { label: 'Festival', color: '#b7791f', why: 'Tyohar par log sabse zyada online hote hain' },
};

const DAY_NAMES = ['Somvaar', 'Mangalvaar', 'Budhvaar', 'Guruvaar', 'Shukravaar', 'Shanivaar', 'Ravivaar'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const shiftDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtShort = (ymd) => `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;

const blank = (date) => ({ id: null, date, mood: 'tips', format: 'Post', time: '7:00 PM', topic: '', hook: '', caption: '', hashtags: '', story: '', platform: '' });

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

export default function Content({ brand = 'achivora', onBrand }) {
  const B = BRANDS[brand] || BRANDS.achivora;
  const [anchor, setAnchor] = useState(todayIST());
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [copied, setCopied] = useState('');

  const load = () =>
    api(`/api/content?date=${anchor}&brand=${brand}`)
      .then((d) => {
        setData(d);
        setErr('');
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    setData(null);
    load();
  }, [anchor, brand]);

  const today = todayIST();
  const posts = data?.posts || [];
  const done = posts.filter((p) => p.done).length;
  const pct = posts.length ? Math.round((done / posts.length) * 100) : 0;
  const hasPlan = posts.some((p) => p.auto);
  const weekLabel = data ? `${fmtShort(data.dates[0])} – ${fmtShort(data.dates[6])} ${data.dates[6].slice(0, 4)}` : '';

  const generate = async () => {
    setBusy(true);
    try {
      await api('/api/content/generate', { method: 'POST', body: JSON.stringify({ date: data.week, brand }) });
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const regenerate = async () => {
    if (!confirm('Is hafte ki jo posts abhi tak post nahi hui, unhe naye content se badal dein? (Tick wali posts waise hi rahengi)')) return;
    setBusy(true);
    try {
      await api('/api/content/generate', { method: 'POST', body: JSON.stringify({ date: data.week, brand, replace: true }) });
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const toggle = async (p) => {
    setData((d) => ({ ...d, posts: d.posts.map((x) => (x.id === p.id ? { ...x, done: !p.done } : x)) }));
    await api(`/api/content/${p.id}`, { method: 'PATCH', body: JSON.stringify({ done: !p.done }) }).catch((e) => {
      setErr(e.message);
      load();
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = JSON.stringify({ ...form, brand });
      if (form.id) await api(`/api/content/${form.id}`, { method: 'PATCH', body });
      else await api('/api/content', { method: 'POST', body });
      setForm(null);
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  };

  const remove = async (p) => {
    if (!confirm(`"${p.topic}" hatana hai?`)) return;
    setForm(null);
    setData((d) => ({ ...d, posts: d.posts.filter((x) => x.id !== p.id) }));
    await api(`/api/content/${p.id}`, { method: 'DELETE' }).catch(() => load());
  };

  const copy = async (key, text) => {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500);
    }
  };

  return (
    <div className="planner content-plan">
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
            <b>{B.name} Posts</b>
            <span className="hint">Har din kya post karna hai: topic, hook, caption aur hashtags</span>
          </div>
          <div className="plan-week">
            <button className="nav-arrow" onClick={() => setAnchor(shiftDays(data?.week || anchor, -7))} title="Pichhla hafta">
              ‹
            </button>
            <div className="plan-week-label">{weekLabel || '…'}</div>
            <button className="nav-arrow" onClick={() => setAnchor(shiftDays(data?.week || anchor, 7))} title="Agla hafta">
              ›
            </button>
            {data && !data.dates.includes(today) && (
              <button className="link-btn plain" onClick={() => setAnchor(today)}>
                Is hafte par jaayein
              </button>
            )}
          </div>
          {data && posts.length > 0 && (
            <div className="plan-actions">
              {!hasPlan ? (
                <button className="ghost small-btn" onClick={generate} disabled={busy}>
                  Standard posts jodein
                </button>
              ) : (
                <button className="ghost small-btn" onClick={regenerate} disabled={busy} title="Jo post ho chuki hain wo waise hi rahengi">
                  Naye ideas se dobara banayein
                </button>
              )}
              <button className="primary small" onClick={() => setForm(blank(data.dates.includes(today) ? today : data.dates[0]))}>
                + Post jodein
              </button>
            </div>
          )}
        </div>
        {posts.length > 0 && (
          <div className="plan-row">
            <div className="plan-progress">
              <div className="plan-bar">
                <i style={{ width: `${pct}%` }} />
              </div>
              <span>
                <b>
                  {done}/{posts.length}
                </b>{' '}
                post ho gayi · {pct}%
              </span>
            </div>
          </div>
        )}
      </section>

      {err && <div className="error">{err}</div>}

      {data === null ? (
        <section className="card">
          <p className="hint">Loading…</p>
        </section>
      ) : !posts.length ? (
        <section className="card plan-empty">
          <h2>{B.name} ka is hafte ka post plan abhi khaali hai</h2>
          <p className="hint">
            Ek click me 7 din ke posts ban jaayenge — har din alag type: Tips, Funny/Meme, Relatable, Behind the scenes,
            Poll/Quiz, Trending reel aur Customer story. Har post ke saath topic, image par kya likhna hai, caption, hashtags
            aur post karne ka sahi samay. Tyohar wale din special post.
          </p>
          <div className="plan-empty-actions">
            <button className="primary" onClick={generate} disabled={busy}>
              {busy ? 'Ban raha hai…' : 'Is hafte ke posts banayein'}
            </button>
            <button className="ghost" onClick={() => setForm(blank(data.dates[0]))}>
              + Khud post jodein
            </button>
          </div>
        </section>
      ) : (
        <div className="post-grid">
          {data.dates.map((d, i) =>
            posts
              .filter((p) => p.date === d)
              .map((p) => {
                const m = MOODS[p.mood] || MOODS.tips;
                return (
                  <article key={p.id} className={`card post-card ${p.done ? 'done' : ''} ${d === today ? 'today' : ''}`} style={{ '--c': m.color }}>
                    <header className="post-top">
                      <div className="post-day">
                        <b>{DAY_NAMES[i]}</b>
                        <span>{fmtShort(d)}</span>
                        {d === today && <span className="today-tag">Aaj</span>}
                      </div>
                      <button className={`posted-btn ${p.done ? 'on' : ''}`} onClick={() => toggle(p)}>
                        <span className={`check-circle sm ${p.done ? 'on' : ''}`}>
                          <svg viewBox="0 0 24 24">
                            <path d="M5 12.5l4.5 4.5L19 7.5" />
                          </svg>
                        </span>
                        {p.done ? 'Post ho gayi' : 'Post kar di?'}
                      </button>
                    </header>

                    <div className="post-tags">
                      <span className="mood-tag" title={m.why}>
                        {p.occasion || m.label}
                      </span>
                      {p.format && <span className="plat-tag">{p.format}</span>}
                      {p.time && <span className="plat-tag">{p.time}</span>}
                    </div>

                    <h3 className="post-topic">{p.topic}</h3>

                    {p.brief && <Brief brief={p.brief} copied={copied === `${p.id}-b`} onCopy={() => copy(`${p.id}-b`, p.briefText)} />}


                    {(p.caption || p.hashtags) && (
                      <div className="post-block">
                        <div className="post-label-row">
                          <span className="post-label">Caption (hashtags ke saath)</span>
                          <button className="text-act" onClick={() => copy(`${p.id}-c`, [p.caption, p.hashtags].filter(Boolean).join('\n\n'))}>
                            {copied === `${p.id}-c` ? 'Copied' : 'Copy caption'}
                          </button>
                        </div>
                        {p.caption && <p className="post-caption">{p.caption}</p>}
                        {p.hashtags && <p className="post-tags-text">{p.hashtags}</p>}
                      </div>
                    )}

                    <footer className="post-foot">
                      <span className="hint">{p.platform || m.why}</span>
                      <div>
                        <button className="text-act" onClick={() => setForm({ ...blank(p.date), ...p })}>
                          Edit
                        </button>
                        <button className="text-act danger" onClick={() => remove(p)}>
                          Delete
                        </button>
                      </div>
                    </footer>
                  </article>
                );
              })
          )}
        </div>
      )}

      {form && (
        <div className="modal-bg" onClick={() => setForm(null)}>
          <form className="card modal task-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <button type="button" className="icon close" onClick={() => setForm(null)}>
              ✕
            </button>
            <h2>{form.id ? 'Post badlein' : 'Nayi post'}</h2>

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
                <label className="field-label">Type</label>
                <select className="text-input" value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })}>
                  {Object.entries(MOODS).map(([k, m]) => (
                    <option key={k} value={k}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div>
                <label className="field-label">Format</label>
                <input className="text-input" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} placeholder="Reel, Carousel, Post…" list="formats" />
                <datalist id="formats">
                  {['Reel', 'Carousel', 'Post', 'Story', 'Story + Post', 'Reel + Post', 'YouTube Short'].map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="field-label">Samay</label>
                <input className="text-input" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} placeholder="7:00 PM" />
              </div>
            </div>

            <label className="field-label">Topic</label>
            <input className="text-input" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Post kis baare me hai" autoFocus />
            <label className="field-label">Image par badi line</label>
            <input className="text-input" value={form.hook} onChange={(e) => setForm({ ...form, hook: e.target.value })} placeholder="Image / video me sabse upar bada likha jayega" />
            <label className="field-label">Caption</label>
            <textarea className="message" rows={4} value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
            <label className="field-label">Hashtags</label>
            <input className="text-input" value={form.hashtags} onChange={(e) => setForm({ ...form, hashtags: e.target.value })} />

            <div className="tpl-actions">
              {form.id && (
                <button type="button" className="link-btn" onClick={() => remove(form)}>
                  Delete
                </button>
              )}
              <button type="button" className="ghost" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy || !form.topic.trim()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// how to make this post's image / video: source, text on the image (slide by slide), design and contact strip
function Brief({ brief, copied, onCopy }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="brief">
      <div className="brief-head">
        <button className="brief-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="post-label">Image / video kaise banayein · {open ? 'chhupayein' : 'dikhayein'}</span>
          <span className="brief-size">{brief.size}</span>
        </button>
        <button className="text-act" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy brief'}
        </button>
      </div>
      {open && (
        <div className="brief-body">
          <div className="brief-row">
            <span className="brief-k">Kis cheez se banayein</span>
            <p>{brief.asset}</p>
          </div>
          <div className="brief-row">
            <span className="brief-k">Image par kya likhna hai</span>
            <ol className="brief-slides">
              {brief.slides.map((s) => (
                <li key={s.title}>
                  <b>{s.title}</b>
                  <span>{s.text}</span>
                </li>
              ))}
            </ol>
          </div>
          {brief.shots && (
            <div className="brief-row">
              <span className="brief-k">Video shots</span>
              <ul className="brief-list">
                {brief.shots.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="brief-row">
            <span className="brief-k">Design</span>
            <ul className="brief-list">
              {brief.design.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div className="brief-contact">Har image par: {brief.contact}</div>
        </div>
      )}
    </div>
  );
}
