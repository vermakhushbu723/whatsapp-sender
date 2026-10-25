// "Image / video brief" for each social post: what to shoot or use, what text goes on the image (slide by slide),
// the design (size, colours, fonts, logo) and the contact strip that every image carries.
// It is worked out from the post's own fields, so editing a post updates its brief.

export const CONTACT = {
  achivora: { phone: '84470 49584', tel: '+918447049584', site: 'achivora.com' },
  jyotessa: { phone: '93105 08371', tel: '+919310508371', site: 'jyotessa.com' },
};

export const contactLine = (brand) => `Call / WhatsApp: ${CONTACT[brand].phone}  |  ${CONTACT[brand].site}`;

// caption CTA with phone + website (also used to upgrade captions saved before the number was added)
export const CTA = {
  achivora: `Website, app ya marketing ke liye Call / WhatsApp karein: ${CONTACT.achivora.phone}\nachivora.com`,
  jyotessa: `Order ke liye Call / WhatsApp karein: ${CONTACT.jyotessa.phone}\njyotessa.com — Free shipping available.`,
};
const OLD_CTA = {
  achivora: 'Website, app ya marketing ke liye DM karein ya WhatsApp karein. achivora.com',
  jyotessa: 'Order ke liye jyotessa.com par jaayein ya DM karein. Free shipping available.',
};

export function withContact(brand, caption = '') {
  if (!caption || caption.includes(CONTACT[brand].phone)) return caption;
  if (caption.includes(OLD_CTA[brand])) return caption.replace(OLD_CTA[brand], CTA[brand]);
  return `${caption}\n\n${CTA[brand]}`;
}

const DESIGN = {
  achivora: {
    colors: 'Safed / halka hara background (#FFFFFF → #E9F8F0), heading navy #0B1D2E, highlight hara #14B86A, button / patti neela #0087D8',
    font: 'Inter / Poppins — heading ExtraBold, baaki Medium',
    logo: 'Achivora logo upar left (achivora.com/logo.png)',
  },
  jyotessa: {
    colors: 'Cream background #FBF3E8, heading bhura #5A200C, highlight sunehra #C9963B, button gehra bhura #8A3A17',
    font: 'Heading Playfair Display (serif, Bold), baaki Inter',
    logo: 'Jyotessa logo upar left (jyotessa.com/logo.png)',
  },
};

// ---------- what to photograph / which screenshot ----------
const JY_PRODUCTS = {
  festive: ['Festive Diya Set', 'Kamal Jyoti Urli', 'Dry Fruit Delight', 'Modak Candle', 'Urli Candle'],
  gift: ['Together Forever gift set', 'Heart Teddy Candle', 'Heart Bowl Candle', 'Bouquet Candle', 'Pearled Candle Kit — Duo'],
  fun: ['Chai & Parle-G Candle', 'Jalebi Rabdi Candle', 'Rasmalai Candle', 'Iced Coffee Candle', 'Lavender Latte Candle', 'Matcha Candle'],
  decor: ['Lotus Pond Candle', 'Cactus Tray Candle', 'Elegant Lady Candle', 'Tulip Candle', 'Daisy Candle', 'Beach Candle'],
  kit: ['Pearled Candle Kit — Ocean', 'Pearled Candle Kit — Botanical', 'Pearled Wax Refill'],
};

const ACH_WORK = {
  website: ['jyotessa.com (brand website)', 'skallinonetradie.com.au (business website)', 'achivora.com (company website)'],
  ecommerce: ['jyotessa.com/shop (e-commerce)', 'candledust.online (e-commerce)'],
  app: ['mobile app screens (phone mockup) — jyotessa.com / candledust.online ka mobile view', 'achivora.com/portfolio ke app projects'],
  seo: ['Google search result me aapki website (screenshot)', 'PageSpeed / Search Console report ka screenshot'],
  ads: ['Instagram / Facebook ad ka sample (phone mockup)', 'Ads results — leads / reach ka graph'],
};

function seed(str) {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h);
}
const pickOne = (list, s) => list[s % list.length];

const GENERIC = new Set(['candle', 'candles', 'gift', 'kit', 'set', 'refill', 'tester', 'pearled', 'wax', 'together', 'forever']);

function jyProduct(post, s) {
  const text = `${post.topic} ${post.hook} ${post.occasion || ''}`.toLowerCase();
  const all = Object.values(JY_PRODUCTS).flat();
  // match on the product's own words (lavender, chai, diya…), not generic ones every name has
  const named = all.find((n) =>
    n
      .toLowerCase()
      .split(/[^a-z]+/)
      .some((w) => w.length > 3 && !GENERIC.has(w) && new RegExp(`\\b${w}\\b`).test(text))
  );
  if (named) return named;
  const tag =
    post.mood === 'festival' || /diwali|diya|festive|tyohar|dhanteras/.test(text)
      ? 'festive'
      : /gift|tohfa|anniversary|birthday|valentine|corporate/.test(text)
        ? 'gift'
        : /pearl|kit|refill/.test(text)
          ? 'kit'
          : { funny: 'fun', relatable: 'fun', poll: 'fun', proof: 'gift', trend: 'decor', tips: 'decor', bts: 'decor' }[post.mood] || 'decor';
  return pickOne(JY_PRODUCTS[tag], s);
}

function achCategory(post) {
  const text = `${post.topic} ${post.hook}`.toLowerCase();
  if (/\bapp\b|mobile|android/.test(text)) return 'app';
  if (/shop|ecommerce|e-commerce|order/.test(text)) return 'ecommerce';
  if (/seo|google|speed|search|ranking/.test(text)) return 'seo';
  if (/\bads?\b|campaign|leads/.test(text)) return 'ads';
  return 'website';
}

// what to shoot / which asset, per brand and post type
function source(brand, post, s) {
  if (brand === 'jyotessa') {
    const p = jyProduct(post, s);
    const map = {
      tips: `"${p}" ki real photo — din ki roshni me, cream / wooden table par, candle jalti hui. Saath me ek-do props (book, chai cup, flowers).`,
      funny: `Meme style: "${p}" ki photo / 5–8 sec ka clip + upar bada funny text. Chahein to apna chehra (reaction) ya haath me candle dikhayein.`,
      relatable: `Cozy lifestyle shot: "${p}" jalti hui + blanket / book / chai — shaam ki halki roshni, warm filter.`,
      bts: `Behind the scenes video / photo: wax pigalna, jar me pour karna, "${p}" ki packing — haath aur process close-up.`,
      poll: `Do products side-by-side ki photo (jaise "${p}" vs doosri candle) — dono ek hi background par, barabar roshni.`,
      trend: `Aesthetic reel: room / corner me "${p}" — slow pan, candle jalana, close-up flame. Trending audio Instagram me jodein.`,
      proof: `Customer review ka screenshot (WhatsApp / Instagram) + "${p}" ki photo. Customer ka naam / photo sirf permission ke saath.`,
      festival: `Festive setup: "${p}" + diye, rangoli, marigold phool — raat ki roshni me photo / reel.`,
    };
    return { asset: map[post.mood] || map.tips, item: p };
  }
  const cat = achCategory(post);
  const work = pickOne(ACH_WORK[cat], s);
  const map = {
    tips: `Clean text slides (Canva) + ${work} ka screenshot laptop / phone mockup me.`,
    funny: `Meme / skit: client-developer wali situation — 2 log, phone camera, 8–15 sec. Ya meme template (Drake / "Expectation vs Reality") par ${work} ka screenshot.`,
    relatable: `Business owner ki situation (dukaan, phone par customer ka message) ki photo / stock image + ${work} ka chhota mockup.`,
    bts: `Screen recording: Figma / code / website banti hui (speed-up), saath me laptop par kaam karte hue shot. Project: ${work}.`,
    poll: `Do options ka simple graphic (A / B) — ek taraf website ka mockup, doosri taraf Instagram page ka mockup.`,
    trend: `Trending audio reel: ${work} — before / after transition (purani site → nayi site), phone mockup me scroll.`,
    proof: `Portfolio: ${work} ka laptop + phone mockup (Canva "Laptop mockup" / mockuphone.com) + client review text.`,
    festival: `Festive greeting graphic: Achivora logo + tyohar ka design (diye / lights) + offer text.`,
  };
  return { asset: map[post.mood] || map.tips, item: work };
}

// caption -> short points (drops the CTA paragraph)
function points(caption) {
  return String(caption || '')
    .split(/\n\s*\n/)[0]
    .split(/(?<=[.!?])\s+|,\s+|\s—\s/)
    .map((s) => s.trim().replace(/[.,]$/, ''))
    .filter((s) => s.length > 6)
    .slice(0, 5)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

function pollOptions(topic) {
  const q = String(topic || '').split(':').pop().replace(/\?/g, '');
  const parts = q.split(/\s+(?:ya|or|vs|v\/s)\s+/i).map((s) => s.trim()).filter(Boolean);
  return parts.length === 2 ? parts : null;
}

// Instagram story for the same post: which sticker, the exact question and options, link + contact
export function storyFor(brand, post) {
  const topic = String(post.topic || '').replace(/\s+$/, '');
  const short = topic.length > 60 ? `${topic.slice(0, 57).replace(/\s+\S*$/, '')}…` : topic;
  const opts = pollOptions(post.topic);
  const jy = brand === 'jyotessa';
  const occ = post.occasion || 'tyohar';
  const by = {
    tips: ['Poll sticker', `"${short}" — kya aap ye pehle se karte ho?`, 'Haan, karte hain / Nahi, aaj se karenge'],
    funny: ['Emoji slider sticker', 'Ye kitna relatable hai? (slider poora khiskaiye)', 'Hasne wala emoji'],
    relatable: ['Poll sticker', 'Aapke saath bhi aisa hota hai?', 'Haan, roz! / Kabhi-kabhi'],
    bts: [
      'Question box sticker',
      jy ? 'Candle banane ke baare me kya jaanna chahenge?' : 'Website / app banne ke process ke baare me kya jaanna chahenge?',
      'Jawab agli story me dein',
    ],
    poll: ['Poll sticker', post.hook || topic, opts ? `${opts[0]} / ${opts[1]}` : 'Haan / Nahi'],
    trend: [
      'Poll sticker',
      jy ? 'Agli reel kis par chahiye?' : 'Agli reel kis topic par chahiye?',
      jy ? 'Nayi khushbu reveal / Gift packing' : 'Website tips / Behind the scenes',
    ],
    proof: [
      'Question box sticker',
      jy ? 'Aapko Jyotessa ki kaunsi candle sabse pasand hai?' : 'Aapke business ke liye kya banwana hai — website, app ya ads?',
      jy ? 'Jawab dene walon ko agli story me feature karein' : 'Jawab dene walon ko DM me free salah dein',
    ],
    festival: [
      'Poll sticker',
      jy ? `Is ${occ} ghar kaise sajayenge?` : `Is ${occ} apne business ke liye offer chahiye?`,
      jy ? 'Diye aur candles / Gift denge' : 'Haan, batao / Baad me',
    ],
  };
  const [sticker, question, options] = by[post.mood] || by.tips;
  return [
    `Sticker: ${sticker}`,
    `Sawal: ${question}`,
    `${/poll/i.test(sticker) ? 'Options' : 'Uske baad'}: ${options}`,
    `Background: aaj ki post ki image / video ka chhota hissa`,
    `Link sticker: ${CONTACT[brand].site}  ·  neeche: ${contactLine(brand)}`,
  ].join('\n');
}

export function makeBrief(brand, post) {
  const s = seed(`${post.date}${post.topic}`);
  const contact = contactLine(brand);
  const d = DESIGN[brand];
  const { asset, item } = source(brand, post, s);
  const format = String(post.format || 'Post');
  const isReel = /reel|short|video/i.test(format);
  const isCarousel = /carousel/i.test(format);
  const hook = post.hook || post.topic;

  let slides;
  const opts = /poll/.test(post.mood) ? pollOptions(post.topic) : null;
  if (isCarousel) {
    const pts = points(post.caption);
    slides = [
      { title: 'Slide 1 (cover)', text: `${hook}\nChhota text: "${post.topic}" · neeche "Swipe karein →"` },
      ...pts.map((p, i) => ({ title: `Slide ${i + 2}`, text: `${String(i + 1).padStart(2, '0')}. ${p}` })),
      { title: `Slide ${pts.length + 2} (last)`, text: `Logo + "Save karein · Share karein · Follow karein"\n${contact}` },
    ];
  } else if (opts) {
    slides = [{ title: 'Image', text: `${hook}\nA: ${opts[0]}   |   B: ${opts[1]}\n"Comment karein: A ya B?"\nNeeche patti: ${contact}` }];
  } else {
    slides = [{ title: 'Image', text: `${hook}${post.topic && post.topic !== hook ? `\nChhota text: "${post.topic}"` : ''}\nNeeche patti: ${contact}` }];
  }

  const shots = isReel
    ? [
        `0–3 sec: Badi line screen par — "${hook}"`,
        ...points(post.caption)
          .slice(0, 3)
          .map((p, i) => `${3 + i * 3}–${6 + i * 3} sec: ${p}`),
        `Last 3 sec: logo + "${contact}"`,
        'Audio: Instagram me trending audio lagayein. Har scene par text 2–3 sec tak rahe.',
      ]
    : null;

  return {
    size: isReel ? 'Reel / Short: 1080 × 1920 (9:16), 7–15 sec' : isCarousel ? `Carousel: ${slides.length} slides, har slide 1080 × 1350 (4:5)` : 'Post: 1080 × 1350 (4:5)',
    asset,
    item,
    slides,
    shots,
    contact,
    design: [d.colors, d.font, d.logo],
  };
}

// plain text version for the "Copy brief" button / sending to a designer
export function briefText(brand, post, b = makeBrief(brand, post)) {
  return [
    `${post.date} · ${post.format || ''} · ${post.topic}`,
    '',
    `Size: ${b.size}`,
    `Kis cheez se banayein: ${b.asset}`,
    '',
    'Image par text:',
    ...b.slides.map((x) => `- ${x.title}: ${x.text.replace(/\n/g, ' / ')}`),
    ...(b.shots ? ['', 'Video shots:', ...b.shots.map((x) => `- ${x}`)] : []),
    '',
    `Har image ke neeche patti me: ${b.contact}`,
    '',
    'Design:',
    ...b.design.map((x) => `- ${x}`),
  ].join('\n');
}
