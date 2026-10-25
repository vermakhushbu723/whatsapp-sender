// Weekly marketing planner: tasks per day (social posts, videos, thoughts, SEO, WhatsApp, ads) that can be ticked off.
import crypto from 'crypto';

export const CATEGORIES = ['social', 'video', 'thought', 'seo', 'whatsapp', 'ads', 'engagement', 'planning'];
// each brand has its own calendar; tasks saved before brands existed belong to Achivora
export const BRANDS = ['achivora', 'jyotessa'];
const brandFilter = (brand) => (brand === 'achivora' ? { $or: [{ brand: 'achivora' }, { brand: { $exists: false } }] } : { brand });

// ---------- idea banks (rotate every week so the plan doesn't repeat) ----------
const IDEAS = {
  carousel: [
    '5 signs aapki website customers kho rahi hai',
    'Website vs sirf Instagram page — business ko kya chahiye?',
    'App banwane se pehle ye 7 sawal zaroor poochein',
    'Google par top aane ke 5 basic SEO steps',
    'Ads me paisa barbaad hone ke 5 karan (aur fix)',
    'Achivora ki services ek nazar me — Website, App, Ads, Marketing',
    'Purani website ko modern banane ke 6 tarike',
    'Small business ke liye digital marketing checklist',
  ],
  reel: [
    'Before / After: purani website ko naya kaise banaya (30 sec)',
    'Live test: aapki website kitni fast khulti hai? (PageSpeed)',
    'Ek din Achivora team ke saath — behind the scenes',
    'Client ka review / testimonial video',
    '3 free tools jo har business owner ko pata hone chahiye',
    'App idea se launch tak — 60 second me',
    'Google Business Profile 2 minute me set karna sikhiye',
    'Ad chalane se pehle ye 3 galtiyan mat karna',
  ],
  thought: [
    'Aapka business online nahi hai, to customer ke liye wo exist hi nahi karta.',
    'Achhi website 24x7 kaam karne wala salesman hai.',
    'Marketing kharcha nahi, investment hai.',
    'Customer ka pehla impression aapki website deti hai.',
    'Consistency > Perfection. Roz thoda karo.',
    'Jo dikhta hai, wahi bikta hai — online bhi.',
    'Sahi customer tak sahi message pahunchana hi marketing hai.',
    'Technology badli hai, business ke niyam nahi — bharosa banao.',
  ],
  linkedin: [
    'Case study: ek local business ki website se 3x enquiries kaise badhi',
    'Hum project kaise plan karte hain — hamara 5-step process',
    'Website development me client se sabse zyada poochhe jane wale sawal',
    'Is mahine ka kaam: portfolio showcase',
    'App vs Website: startup ko pehle kya banana chahiye?',
    'Lessons: 50+ business websites banane ke baad hamari seekh',
  ],
  short: [
    'YouTube Short: "Website kitne me banti hai?" — seedha jawab',
    'YouTube Short: Google par apna business kaise dikhaye',
    'YouTube Short: WhatsApp marketing ka sahi tarika (official API)',
    'YouTube Short: Domain aur hosting kya hota hai — 30 sec me',
    'YouTube Short: Instagram ads vs Google ads',
    'YouTube Short: mobile app banwane ka process',
  ],
  blog: [
    'Small business ke liye website banwane ka kharcha (2026 guide)',
    'Local SEO: "near me" searches me apna business kaise laayein',
    'WordPress vs custom website — kaunsi aapke liye behtar?',
    'India me mobile app development cost — poori jaankari',
    'Google Business Profile optimise karne ke 10 tarike',
    'Website redesign kab karwana chahiye? 7 signs',
    'Facebook aur Instagram ads ki shuruaat kaise karein',
    'WhatsApp Business API kya hai aur business ke liye kyon zaroori',
  ],
  keywords: [
    'website design company near me / in <aapka shehar>',
    'app development company India, android app development',
    'website redesign services, website modification',
    'digital marketing agency for small business',
    'Facebook ads agency, Google ads management',
    'ecommerce website development cost',
  ],
  portfolio: [
    'Portfolio post: hamari latest website (screenshot + link)',
    'Client testimonial graphic (naam + photo + 2 line review)',
    'Project spotlight: problem → solution → result',
    'Portfolio carousel: 3 alag industries ki websites',
  ],
};

const pickFrom = (ideas) => (bank, week, offset = 0) => ideas[bank][(week + offset) % ideas[bank].length];
const pick = pickFrom(IDEAS);

// tasks for each weekday (0 = Monday) — the Achivora weekly routine
function achivoraDay(weekday, wk) {
  const every = [
    { category: 'engagement', platform: 'Instagram / Facebook', title: 'Story daalein (1–3 stories: poll, behind the scenes, offer)' },
    { category: 'engagement', platform: 'All', title: '20–30 min engagement: comments, DMs ka jawab, 10 related posts par comment' },
    { category: 'whatsapp', platform: 'WA Sender', title: 'Inbox check karein — YES / interested logon ko call ya reply' },
  ];
  const days = [
    // Monday
    [
      { category: 'planning', platform: 'Planner', title: 'Hafte ka plan dekhein + pichhle hafte ki reach/leads note karein' },
      { category: 'social', platform: 'Instagram / Facebook', title: `Carousel post: ${pick('carousel', wk)}` },
      { category: 'seo', platform: 'Google', title: `Keyword research (5 keywords): ${pick('keywords', wk)}`, details: 'Google Search ka "People also ask" aur Search Console ki queries dekhein. Blog aur pages ke liye note karein.' },
      { category: 'whatsapp', platform: 'WA Sender', title: 'WhatsApp campaign #1 — approved template se 100–150 naye numbers', details: 'Pehle Limits & Opt-out dekhein. Sirf sahi aur relevant numbers. Failed (undeliverable) numbers list se hata dein.' },
    ],
    // Tuesday
    [
      { category: 'video', platform: 'Instagram Reels / YouTube Shorts', title: `Reel: ${pick('reel', wk)}` },
      { category: 'seo', platform: 'achivora.com', title: `Blog likhein aur publish karein: "${pick('blog', wk)}"`, details: '800–1200 words, title me main keyword, 2–3 internal links, 1 image (alt text ke saath). Publish ke baad Search Console me "Request indexing".' },
      { category: 'social', platform: 'LinkedIn', title: `LinkedIn post: ${pick('linkedin', wk)}` },
    ],
    // Wednesday
    [
      { category: 'thought', platform: 'Instagram / Facebook / LinkedIn', title: `Thought post: "${pick('thought', wk)}"` },
      { category: 'seo', platform: 'Google Business Profile', title: 'Google Business Profile: 1 post + 3 nayi photos + reviews ka jawab', details: 'Har review ka jawab dein. Happy clients se review link share karke review maangein.' },
      { category: 'social', platform: 'Facebook', title: 'Blog ka link Facebook page + 2–3 relevant groups me share karein' },
    ],
    // Thursday
    [
      { category: 'video', platform: 'Instagram Reels / YouTube Shorts', title: `Reel: ${pick('reel', wk, 3)}` },
      { category: 'seo', platform: 'Backlinks', title: '3 business listings / backlinks banayein', details: 'Justdial, IndiaMART, Sulekha, Clutch, GoodFirms, local directories. Har jagah naam, number, address aur website ek jaisa ho (NAP).' },
      { category: 'social', platform: 'Instagram / Facebook', title: `Carousel post: ${pick('carousel', wk, 4)}` },
    ],
    // Friday
    [
      { category: 'social', platform: 'Instagram / Facebook / LinkedIn', title: pick('portfolio', wk) },
      { category: 'seo', platform: 'Search Console', title: 'Technical SEO check: Search Console errors, indexing, page speed', details: 'search.google.com/search-console → Pages (not indexed), Core Web Vitals. pagespeed.web.dev par home page test karein.' },
      { category: 'whatsapp', platform: 'WA Sender', title: 'WhatsApp campaign #2 — naye numbers ko template', details: 'Sent status me read rate dekhein. "Ecosystem" wale failed numbers 1–2 din baad dobara try kar sakte hain.' },
    ],
    // Saturday
    [
      { category: 'video', platform: 'YouTube', title: pick('short', wk) },
      { category: 'ads', platform: 'Meta / Google Ads', title: 'Ads review: kharcha, leads, CPC dekhein — kharab ad band karein, achhe ka budget badhayein' },
      { category: 'planning', platform: 'Canva', title: 'Agle hafte ke 4–5 posts Canva me pehle se design kar lein (batch)' },
    ],
    // Sunday
    [
      { category: 'thought', platform: 'Instagram / Facebook', title: `Thought post: "${pick('thought', wk, 4)}"` },
      { category: 'planning', platform: 'Report', title: 'Hafte ki report: followers, reach, website visits, WhatsApp replies, leads, clients' },
    ],
  ];
  // Sunday is a light day: no daily engagement block except the WhatsApp inbox
  return weekday === 6 ? [...days[weekday], every[2]] : [...days[weekday], ...every];
}

// ---------- Jyotessa: handmade soy candles & gift sets (D2C, jyotessa.com) ----------
const JY = {
  reel: [
    'Candle pouring ASMR — wax pour se final candle tak (15 sec)',
    'Unboxing: Jyotessa gift set kholte hue (packaging close-up)',
    'Pearled candle kit kaise use karein — 3 steps',
    'Room makeover: ek candle se cozy corner (before / after)',
    'Behind the scenes: ek din Jyotessa studio me',
    'Customer reaction / gifting moment video',
    'Fragrance reveal: is hafte ki khushbu — note by note',
    'Candle care tips: tunnelling se kaise bachayein',
  ],
  product: [
    'Product post: bestseller soy candle — khushbu, burn time, size, price',
    'Gift set spotlight: kis mauke ke liye (birthday, anniversary, housewarming)',
    'New arrival / limited edition launch post',
    'Pearled candle kit — spill-proof, refill wala, safe — feature carousel',
    'Customer review graphic (photo + 2 line review + rating)',
    'Combo offer post: 2 candles + free gift wrap',
  ],
  carousel: [
    'Soy wax vs paraffin — kyun soy behtar hai (5 slides)',
    'Gift guide: har budget me perfect candle gift',
    'Kaunsi khushbu kis mood ke liye — fragrance guide',
    'Candle lagane ke 5 aesthetic tareeke (home decor)',
    'Jyotessa candle kaise banti hai — hand-poured process',
    'Festive gifting checklist — corporate & family',
  ],
  thought: [
    'Ek candle, hazaar yaadein.',
    'Ghar wahi jahan roshni aur sukoon ho.',
    'Choti khushiyon ko bhi jalaiye — har roz.',
    'Handmade means made with heart.',
    'Gift woh jo yaad rahe — roshni ka tohfa.',
    'Slow down. Light a candle. Breathe.',
  ],
  blog: [
    'Best scented candles for gifting in India (2026 guide)',
    'Soy wax candles: fayde aur sahi tarike se kaise jalayein',
    'Diwali / festive gift ideas under ₹999',
    'Candle care guide: lambi burn life ke 7 tips',
    'Pearled candles kya hote hain aur kyun trend me hain',
    'Housewarming gift ideas jo sach me kaam aayein',
  ],
  keywords: [
    'soy candles online India, scented candles gift set',
    'handmade candles Noida / Delhi NCR',
    'pearled candle kit, refillable candle',
    'diwali gift hampers candles, corporate candle gifts',
    'aromatherapy candles for home, luxury candles India',
    'candle gift for her / him, anniversary gift candle',
  ],
  collab: [
    '5 home-decor / lifestyle micro influencers ko DM (barter collab)',
    'Corporate gifting: 5 local companies / HR ko catalogue bhejein',
    'Wedding planners / event decorators se tie-up ke liye 3 calls',
    'Gift shops / cafes ko consignment ke liye sample + catalogue',
  ],
};
const jy = pickFrom(JY);

function jyotessaDay(weekday, wk) {
  const every = [
    { category: 'engagement', platform: 'Instagram / Facebook', title: 'Story: candle shot / poll / offer / customer repost (2–3 stories)' },
    { category: 'engagement', platform: 'Instagram', title: '20 min engagement: DMs, comments, home-decor posts par comment' },
    { category: 'whatsapp', platform: 'WA Sender', title: 'Inbox check: order enquiries ka jawab, price/catalogue bhejein' },
  ];
  const days = [
    // Monday
    [
      { category: 'planning', platform: 'Planner', title: 'Hafte ka plan + pichhle hafte ke orders, reach aur best post note karein' },
      { category: 'social', platform: 'Instagram / Facebook', title: jy('product', wk) },
      { category: 'seo', platform: 'Google', title: `Keyword research: ${jy('keywords', wk)}`, details: 'Product titles, descriptions aur collection pages me ye keywords use karein.' },
      { category: 'whatsapp', platform: 'WA Sender', title: 'WhatsApp broadcast: purane customers ko naya collection / offer (template)', details: 'Sirf jinhone pehle order ya enquiry ki ho. STOP list wale skip.' },
    ],
    // Tuesday
    [
      { category: 'video', platform: 'Instagram Reels / YouTube Shorts', title: `Reel: ${jy('reel', wk)}` },
      { category: 'seo', platform: 'jyotessa.com', title: `Blog publish: "${jy('blog', wk)}"`, details: 'Blog me 2–3 product links daalein. Image alt text me product naam + khushbu.' },
      { category: 'social', platform: 'Pinterest', title: '5 product pins banayein (jyotessa.com link ke saath)', details: 'Pinterest home-decor aur gifting traffic laata hai. Har pin me keyword wala title.' },
    ],
    // Wednesday
    [
      { category: 'thought', platform: 'Instagram / Facebook', title: `Thought post: "${jy('thought', wk)}"` },
      { category: 'seo', platform: 'Google Business Profile', title: 'Google Business Profile: product post + photos + reviews ka jawab' },
      { category: 'seo', platform: 'Google Merchant Center', title: 'Google Shopping: product feed, price, stock aur images check karein' },
    ],
    // Thursday
    [
      { category: 'video', platform: 'Instagram Reels', title: `Reel: ${jy('reel', wk, 3)}` },
      { category: 'social', platform: 'Instagram / Facebook', title: `Carousel: ${jy('carousel', wk)}` },
      { category: 'engagement', platform: 'Outreach', title: jy('collab', wk) },
    ],
    // Friday
    [
      { category: 'social', platform: 'Instagram / Facebook', title: 'Weekend offer / combo post (limited time)' },
      { category: 'seo', platform: 'jyotessa.com', title: '3 product pages ka title, description aur alt text sudhaarein', details: 'Har product page: unique description (150+ words), khushbu notes, burn time, size, care tips, FAQ.' },
      { category: 'ads', platform: 'Meta Ads', title: 'Meta catalog / retargeting ads: cart chhodne walon ko ad, kharab ad band' },
    ],
    // Saturday
    [
      { category: 'video', platform: 'YouTube Shorts', title: `Short: ${jy('reel', wk, 5)}` },
      { category: 'social', platform: 'Instagram', title: 'UGC repost: customers ki photos/review share karein (permission ke saath)' },
      { category: 'planning', platform: 'Studio', title: 'Agle hafte ke product photos + reels ek saath shoot karein (batch)' },
    ],
    // Sunday
    [
      { category: 'thought', platform: 'Instagram / Facebook', title: `Thought post: "${jy('thought', wk, 3)}"` },
      { category: 'planning', platform: 'Report', title: 'Hafte ki report: orders, revenue, followers, reach, website visits, top product' },
    ],
  ];
  return weekday === 6 ? [...days[weekday], every[2]] : [...days[weekday], ...every];
}

const dayPlan = (brand, weekday, wk) => (brand === 'jyotessa' ? jyotessaDay(weekday, wk) : achivoraDay(weekday, wk));

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error('Galat date.');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

const weekDates = (monday) =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    return ymd(d);
  });

// ISO week number -> picks the ideas for that week
function isoWeek(monday) {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanTask(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.date !== undefined) {
    if (!DATE_RE.test(String(body.date || ''))) throw new Error('Date sahi nahi hai.');
    out.date = body.date;
  }
  if (!partial || body.title !== undefined) {
    const title = String(body.title || '').trim();
    if (!title) throw new Error('Kaam ka naam likhein.');
    out.title = title.slice(0, 300);
  }
  if (CATEGORIES.includes(body.category)) out.category = body.category;
  else if (!partial) out.category = 'social'; // on edit an unknown category keeps the old one
  if (body.platform !== undefined || !partial) out.platform = String(body.platform || '').trim().slice(0, 80);
  if (body.details !== undefined || !partial) out.details = String(body.details || '').trim().slice(0, 2000);
  if (body.done !== undefined) {
    out.done = !!body.done;
    out.doneAt = body.done ? new Date().toISOString() : null;
  }
  return out;
}

export function registerPlanner(app, col, wrap) {
  const tasks = () => col.planner();
  const clean = ({ _id, ...t }) => ({ id: _id, brand: 'achivora', ...t });
  const brandOf = (v) => (BRANDS.includes(v) ? v : 'achivora');

  // all tasks of the week that contains ?date (defaults to today)
  app.get(
    '/api/planner',
    wrap(async (req, res) => {
      let monday;
      try {
        monday = mondayOf(String(req.query.date || ymd(new Date(Date.now() + 330 * 60000))));
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const dates = weekDates(monday);
      const brand = brandOf(req.query.brand);
      const list = await tasks()
        .find({ date: { $in: dates }, ...brandFilter(brand) })
        .sort({ date: 1, order: 1, createdAt: 1 })
        .toArray();
      res.json({ brand, week: dates[0], dates, weekNo: isoWeek(monday), hasPlan: list.some((t) => t.auto), tasks: list.map(clean) });
    })
  );

  // fill an empty week with the standard Achivora plan
  app.post(
    '/api/planner/generate',
    wrap(async (req, res) => {
      let monday;
      try {
        monday = mondayOf(String(req.body?.date || ''));
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const dates = weekDates(monday);
      const brand = brandOf(req.body?.brand);
      // only refuse when the standard plan is already there; hand-added tasks stay as they are
      if (await tasks().countDocuments({ date: { $in: dates }, auto: true, ...brandFilter(brand) }, { limit: 1 }))
        return res.status(409).json({ error: 'Is hafte ka standard plan pehle se bana hua hai.' });
      const wk = isoWeek(monday);
      const now = new Date().toISOString();
      const docs = dates.flatMap((date, weekday) =>
        dayPlan(brand, weekday, wk).map((t, i) => ({
          _id: crypto.randomUUID(),
          brand,
          date,
          category: t.category,
          platform: t.platform,
          title: t.title,
          details: t.details || '',
          done: false,
          doneAt: null,
          order: 100 + i, // after any tasks the user already added that day
          auto: true,
          createdAt: now,
        }))
      );
      await tasks().insertMany(docs);
      res.json({ ok: true, added: docs.length });
    })
  );

  app.post(
    '/api/planner',
    wrap(async (req, res) => {
      let fields;
      try {
        fields = cleanTask(req.body || {});
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const brand = brandOf(req.body?.brand);
      const order = await tasks().countDocuments({ date: fields.date, ...brandFilter(brand) });
      const doc = { _id: crypto.randomUUID(), brand, ...fields, done: false, doneAt: null, order, createdAt: new Date().toISOString() };
      await tasks().insertOne(doc);
      res.json(clean(doc));
    })
  );

  app.patch(
    '/api/planner/:tid',
    wrap(async (req, res) => {
      let fields;
      try {
        fields = cleanTask(req.body || {}, { partial: true });
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const t = await tasks().findOneAndUpdate({ _id: req.params.tid }, { $set: fields }, { returnDocument: 'after' });
      if (!t) return res.status(404).json({ error: 'Kaam nahi mila.' });
      res.json(clean(t));
    })
  );

  app.delete(
    '/api/planner/:tid',
    wrap(async (req, res) => {
      await tasks().deleteOne({ _id: req.params.tid });
      res.json({ ok: true });
    })
  );
}
