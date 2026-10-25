// Social media content calendar: one post (+ a story idea) per day, with topic, hook, caption and hashtags.
// Each weekday has its own mood so the feed stays varied: tips, funny, relatable, behind the scenes, poll, trend, proof.
import crypto from 'crypto';
import { mondayOf } from './planner.js';
import { CTA, withContact, makeBrief, briefText, storyFor } from './brief.js';

const BRANDS = ['achivora', 'jyotessa'];

// mood + format + best posting time (IST) for each weekday (0 = Monday)
const WEEK = [
  { mood: 'tips', format: 'Carousel', time: '7:00 PM' },
  { mood: 'funny', format: 'Reel', time: '8:00 PM' },
  { mood: 'relatable', format: 'Post', time: '1:00 PM' },
  { mood: 'bts', format: 'Reel', time: '7:30 PM' },
  { mood: 'poll', format: 'Story + Post', time: '6:00 PM' },
  { mood: 'trend', format: 'Reel', time: '11:00 AM' },
  { mood: 'proof', format: 'Post', time: '10:00 AM' },
];

const TAGS = {
  achivora: {
    base: '#Achivora #WebsiteDesign #DigitalMarketing #SmallBusinessIndia',
    tips: '#BusinessTips #SEOTips #GrowOnline',
    funny: '#ClientProblems #DeveloperLife #MarketingMemes',
    relatable: '#EntrepreneurLife #StartupIndia #BusinessOwner',
    bts: '#BehindTheScenes #WebDevelopment #AgencyLife',
    poll: '#ThisOrThat #AskUs #BusinessQuiz',
    trend: '#TrendingReels #ReelsIndia #ViralReels',
    proof: '#ClientLove #Portfolio #CaseStudy',
    festival: '#FestiveOffer #Celebration',
  },
  jyotessa: {
    base: '#Jyotessa #SoyCandles #HandmadeCandles #CandlesIndia',
    tips: '#CandleCare #HomeDecorIdeas #CandleTips',
    funny: '#CandleLover #CandleAddict #RelatableReels',
    relatable: '#SelfCareSunday #CozyVibes #MeTime',
    bts: '#CandleMaking #SmallBusinessIndia #HandPoured',
    poll: '#ThisOrThat #ScentOfTheDay #ChooseOne',
    trend: '#TrendingReels #AestheticReels #ReelsIndia',
    proof: '#CustomerLove #GiftIdeas #UnboxingReview',
    festival: '#DiwaliGifts #FestiveDecor #GiftHampers',
  },
};

// idea banks: [topic, hook (first line / first 2 seconds), caption]
const IDEAS = {
  achivora: {
    tips: [
      ['5 cheezein jo har business website par honi chahiye', 'Aapki website me ye 5 cheezein nahi hain? Customer wapas chala jayega.', 'WhatsApp button, Google Map, reviews, fast loading aur clear contact — inme se kitni aapki site par hain? Save karein aur check karein.'],
      ['Google par apna business kaise laayein (free)', 'Google par "near me" search me aapka naam aata hai?', 'Google Business Profile = free mein customers. 4 steps carousel me. Help chahiye? DM karein.'],
      ['Website slow hone ke 4 karan', '3 second me website nahi khuli = customer gaya.', 'Bhaari images, sasta hosting, zyada plugins, no caching. Free speed check ke liye "SPEED" comment karein.'],
      ['Instagram vs Website — business ko kya chahiye?', 'Sirf Instagram page se business chal jayega? Sach jaaniye.', 'Instagram dikhata hai, website bechti hai. Dono saath ho to growth double. Aapke paas kya hai?'],
      ['Ad chalane se pehle ye 3 cheezein set karein', 'Ads pe paisa doob raha hai? Shayad galti yahan hai.', 'Sahi audience, landing page aur tracking pixel — bina inke ad = paisa barbaad. Save for later.'],
      ['Mobile app banwane se pehle ye sawal poochein', 'App banwana hai? Pehle ye 5 sawal khud se poochiye.', 'Kaun use karega, kya problem solve hogi, budget, maintenance, launch plan. Free consultation ke liye DM.'],
    ],
    funny: [
      ['Client: "Bas chhota sa change hai"', 'Jab client bole "bas 2 minute ka kaam hai"...', 'Har developer ki kahani. Tag karo us dost ko jo ye roz sunta hai.'],
      ['Logo bada karo — har client ki demand', 'POV: Client ko logo thoda aur bada chahiye.', '"Thoda aur bada... nahi, pehle wala hi theek tha." Relatable ho to share karo.'],
      ['Website 2010 wali vs 2026 wali', 'Aapki website abhi bhi 2010 me jee rahi hai?', 'Blinking text aur visitor counter yaad hai? Ab zamana badal gaya. Upgrade chahiye to hum hain.'],
      ['Business owner jab pehli baar Google pe apna naam dhoondhe', 'Expectation vs Reality: Google pe apna business search karna.', 'Expectation: pehle number pe. Reality: page 5. Ise hum theek karte hain.'],
      ['"Website to mere bhanje ne bana di thi"', 'Jab website "bhanje ne free me" banai ho...', 'Free website ka asli kharcha — customers jo kabhi aaye hi nahi. Haste raho, sochte raho.'],
      ['Monday morning me marketing team', 'Monday ko marketing team ka mood.', 'Coffee pehle, campaign baad me. Aapki team kaisi hai? Comment me batao.'],
    ],
    relatable: [
      ['Customer ne kaha "online milte ho kya?"', 'Kabhi kisi customer ne poocha "aapki website hai?" aur aapke paas jawab nahi tha?', 'Aaj 70% log kharidne se pehle online check karte hain. Kya aap dikhte ho?'],
      ['Har business owner ka sabse bada dard: leads', 'Business achha hai, product achha hai, phir bhi customer kam?', 'Problem product nahi, visibility hai. Hum ise theek karte hain — kaise, DM me poochiye.'],
      ['Raat 11 baje bhi customer ka message', 'Business owner ka "office time" kabhi khatam nahi hota.', 'Chatbot aur WhatsApp automation se raat ki enquiry bhi miss nahi hogi. Aap so jao, website kaam karegi.'],
      ['"Kal se Instagram regular karunga"', 'Har business owner ka kal kabhi nahi aata.', 'Content calendar banao, ek din me hafte ke post ready. Hum help karte hain.'],
      ['Competitor online aa gaya, aap nahi', 'Aapka competitor aapke customers le ja raha hai — online.', 'Wo better nahi, bas dikh raha hai. Aap bhi dikhiye.'],
      ['Visiting card vs website', 'Visiting card kho jaata hai, website hamesha milti hai.', 'Apna digital visiting card banwaiye — ek link me sab kuch.'],
    ],
    bts: [
      ['Ek website kaise banti hai — idea se launch tak', 'Ek website banne me kya-kya hota hai? 30 second me dekhiye.', 'Planning, design, development, testing, launch. Har step par client ke saath. Aapka project kab shuru karein?'],
      ['Hamara design process (sketch se screen tak)', 'Kagaz ke sketch se sundar website tak.', 'Har design pehle paper par, phir screen par. Behind the scenes at Achivora.'],
      ['Ek din Achivora team ke saath', 'Website agency me ek din kaisa hota hai?', 'Meetings, code, coffee aur client calls. Aapko kaunsa part sabse interesting laga?'],
      ['Purani website ko naya banana — live redesign', 'Is website ko 7 din me naya banaya. Before vs After.', 'Same business, nayi website, zyada enquiries. Aapki bari kab?'],
      ['App testing — launch se pehle kya check karte hain', 'App launch se pehle hum 50+ cheezein check karte hain.', 'Speed, security, har phone par design. Isliye hamare apps crash nahi hote.'],
      ['Client meeting ka sach', 'Pehli meeting me hum client se kya poochte hain?', 'Aapka goal, customer kaun hai, budget aur timeline. Sahi sawal = sahi website.'],
    ],
    poll: [
      ['This or That: Website ya Instagram?', 'Business ke liye pehle kya — Website ya Instagram?', 'Comment karein W ya I. Sahi jawab next post me.'],
      ['Quiz: Google par 1st page kitne log dekhte hain?', 'Guess karo: Google ke 1st page par kitne % clicks jaate hain?', 'A) 30% B) 50% C) 90%. Jawab comment karo, sahi wale ko shoutout.'],
      ['Aapka business online kitna strong hai? (1-10)', 'Apne business ko online 1 se 10 me kitne number doge?', 'Comment me number likho, hum free tip denge.'],
      ['Dark mode ya Light mode website?', 'Website ka design: Dark ya Light?', 'Poll me vote karo. Results Sunday ko.'],
      ['Kaunsa platform aapko sabse zyada customer deta hai?', 'Aapke customer kahan se aate hain?', 'Instagram, Google, WhatsApp ya word of mouth? Comment karo.'],
      ['Ask us anything — website / app / ads', 'Website, app ya ads ke baare me kuch bhi poochiye.', 'Story me question box. Har sawal ka jawab dengi.'],
    ],
    trend: [
      ['Trending audio + "Things clients say"', 'Trending audio par: clients ki 5 famous lines.', 'Kaunsi line aapne bhi suni hai? Save karo, share karo.'],
      ['"Nobody: / Me:" — website edition', 'Nobody: / Business owner: website ka color 5th baar change.', 'Trending format, sach kahani. Tag karo.'],
      ['Glow up challenge: website before / after', 'Website glow up: before vs after.', 'Trending transition ke saath redesign reveal. Aapki site ka glow up kab?'],
      ['"Tell me without telling me you need a website"', 'Bina bole batao ki aapko website chahiye.', '"Customer: aapka location bhejo" — 10 baar roz. Comment me apna answer.'],
      ['Day in life of a web designer (trending audio)', 'Web designer ka din — trending audio par.', 'Code, coffee, client — repeat. Follow for more.'],
      ['Green flags of a good agency', 'Achhi digital agency ke 5 green flags.', 'Clear pricing, time par delivery, support, portfolio, honest advice. Hum sab rakhte hain.'],
    ],
    proof: [
      ['Client review: local business ki enquiries badhi', '"Website ke baad roz 5-10 nayi enquiries aati hain." — hamare client', 'Asli client, asli result. Aapka business agla ho sakta hai.'],
      ['Portfolio: is mahine ki 3 websites', 'Is mahine humne ye 3 websites launch ki.', 'Swipe karke dekhiye. Kaunsi sabse achhi lagi?'],
      ['Case study: problem → solution → result', 'Is client ke paas website thi, customer nahi. Phir humne ye kiya.', 'Speed, SEO aur WhatsApp button — 30 din me result. Poori story carousel me.'],
      ['Thank you post: happy clients', 'Har happy client hamare liye ek award hai.', 'Shukriya hum par bharosa karne ke liye.'],
      ['Google review highlight', '5 star review ka matlab hai hum sahi kar rahe hain.', 'Hamare clients kya kehte hain — dekhiye. Aapka review bhi wait kar raha hai.'],
      ['Milestone: itne projects complete', 'Ek aur milestone complete!', 'Aap sab ke bharose se. Agla project aapka?'],
    ],
    story: [
      'Poll: "Aapki website hai?" Haan / Nahi',
      'Question box: "Website ya app ke baare me kuch bhi poochiye"',
      'Behind the scenes: laptop screen par chal raha project (blur karke)',
      'Quiz sticker: "Website kitne second me khulni chahiye?"',
      'Client ki website ka sneak peek + "Coming soon"',
      'Emoji slider: "Aapke business ki online growth se kitne khush ho?"',
      'Repost: client ka tag kiya hua story / review',
    ],
  },

  jyotessa: {
    tips: [
      ['Candle ko tunnelling se kaise bachayein', 'Aapki candle beech se gaddha bana rahi hai? Ye galti mat karna.', 'Pehli baar kam se kam 2-3 ghante jalayein, wick 5mm rakhein. Save karein, kaam aayega.'],
      ['Soy wax vs paraffin — fark jaaniye', 'Har candle ek jaisi nahi hoti. Soy kyun behtar hai?', 'Saaf burn, kam dhuan, lambi chalti hai aur natural. Jyotessa ki har candle 100% soy.'],
      ['Kaunsi khushbu kis room me', 'Bedroom me lavender, living room me vanilla?', 'Room ke hisaab se fragrance guide — swipe karein aur apni pick comment karein.'],
      ['Candle se ghar sajane ke 5 aesthetic tareeke', 'Ek candle se poora corner badal sakta hai.', 'Tray, books, flowers, mirror, fairy lights — 5 ideas. Kaunsa try karoge?'],
      ['Perfect gift chunne ka tareeka', 'Gift samajh nahi aa raha? Candle kabhi galat nahi hoti.', 'Birthday ke liye floral, anniversary ke liye rose, boss ke liye woody. Gift guide save karein.'],
      ['Candle safely kaise jalayein', 'Candle jalate waqt ye 4 cheezein yaad rakhein.', 'Kabhi akela na chhodein, parde se door, wick trim karein, flat jagah par rakhein.'],
    ],
    funny: [
      ['Candle lover ki shopping', 'Main: bas ek candle lungi. Also me: 7 candles le kar ghar.', 'Kaun-kaun relate karta hai? Tag your candle buddy.'],
      ['Mummy ka "ye candle kab jalayegi?"', 'Mummy: itni candles kyun kharidi? Main: decor ke liye hai, jalane ke liye nahi!', 'Har candle lover ka dard. Comment me batao aap kis team me ho.'],
      ['Candle jalate hi mood', 'Candle jalane se pehle vs baad me mera mood.', 'Before: tired. After: main ek aesthetic Pinterest board hoon.'],
      ['Khushbu choose karna', 'Jab 10 khushbu me se 1 choose karni ho...', 'Sab achhi hain, isliye sab le lo. Simple.'],
      ['Gift dene wala vs lene wala', 'Gift dene wala: chhoti si candle hai. Lene wala: itni pyaari!', 'Chhota gift, bada impact. Is festive season kisko doge?'],
      ['Power cut ka hero', 'Power cut hua aur ghar me sirf ek insaan tayyar tha.', 'Candle stock = life sorted. Aap ho wo insaan?'],
    ],
    relatable: [
      ['Long day ke baad ka sukoon', 'Lamba din, thaka dimaag, aur bas ek candle.', 'Kabhi-kabhi self-care itna simple hota hai. Aapka me-time kaisa hota hai?'],
      ['Ghar ko "ghar" banane wali cheezein', 'Makaan ko ghar banati hain ye choti cheezein.', 'Khushbu, roshni aur apne log. Aapke ghar ki favourite cheez kya hai?'],
      ['Last minute gift ki tension', 'Kal birthday hai aur gift abhi tak nahi liya?', 'Jyotessa gift set — ready, wrapped aur pyaara. Order karein, tension khatam.'],
      ['Sunday reset routine', 'Sunday reset: safai, music aur ek candle.', 'Hafte ki shuruaat fresh feel ke saath. Aapka Sunday ritual kya hai?'],
      ['Work from home desk', 'WFH desk par ek candle = productivity +100.', 'Desk setup dikhaiye, hum best wala repost karenge.'],
      ['Baarish, chai aur candle', 'Baarish + chai + candle = perfect evening.', 'Aapka perfect evening combo kya hai? Comment karein.'],
    ],
    bts: [
      ['Candle kaise banti hai — wax pour ASMR', 'Ek candle ka safar: wax se roshni tak.', 'Har Jyotessa candle haath se banti hai. Ye video dekh kar sukoon na mile to bolna.'],
      ['Order packing ASMR', 'Aapka order aise pack hota hai.', 'Pyaar se, dhyan se, aur ek chhote note ke saath. Aapka order kab aa raha hai?'],
      ['Nayi khushbu ka test', 'Nayi khushbu banane me hafton lagte hain. Dekhiye kaise.', 'Mix, test, wait, repeat. Agli fragrance ka naam aap suggest karo.'],
      ['Studio tour', 'Jyotessa studio ka chhota sa tour.', 'Yahin banti hain aapki favourite candles. Kaunsa corner sabse pyaara laga?'],
      ['Ek din candle maker ke saath', 'Candle maker ka ek din kaisa hota hai?', 'Wax, wicks, khushbu aur bahut saara pyaar. Follow for more BTS.'],
      ['Gift set kaise banta hai', 'Ek gift set ke peeche kitni mehnat hoti hai.', 'Candle, box, ribbon aur note — har detail par dhyan. Corporate orders bhi lete hain.'],
    ],
    poll: [
      ['This or That: Vanilla ya Lavender?', 'Team Vanilla ya Team Lavender?', 'Comment karein V ya L. Jeetne wali khushbu par weekend offer.'],
      ['Aapki favourite candle shape?', 'Jar, pillar ya pearled candle — aapko kya pasand?', 'Vote karein, agla collection aapki pasand se.'],
      ['Gift ke liye kaunsa colour?', 'Gift box ka colour aap chuniye: Red, Gold ya White?', 'Comment karein. Festive packaging aapki choice se.'],
      ['Guess the fragrance', 'Bina naam ke bataiye — ye kaunsi khushbu hai?', 'Sahi jawab dene wale 3 logon ko discount code.'],
      ['Aap candle kab jalate ho?', 'Candle ka best time: subah, shaam ya raat?', 'Poll me vote karein. Hum dekhenge kaun sa team jeet-ta hai.'],
      ['Ask us anything — candles', 'Candles ke baare me kuch bhi poochiye.', 'Story me question box. Burn time, care, gifting — sab ka jawab.'],
    ],
    trend: [
      ['Aesthetic room makeover (trending audio)', 'Room glow up — sirf candles se.', 'Trending audio, before vs after. Aapka room kaisa dikhta hai?'],
      ['"Things that just make sense" — candle edition', 'Kuch cheezein bas sahi lagti hain.', 'Candle + book + rain. Comment me apni list.'],
      ['Satisfying candle lighting compilation', 'Ye video dekh kar sukoon milega.', 'Matchstick, flame, glow. Save karein jab stress ho.'],
      ['Gift unboxing reaction trend', 'Unke reaction ne din bana diya.', 'Jyotessa gift set unboxing. Aap kisko surprise karoge?'],
      ['"Romanticize your life" reel', 'Apni life ko thoda romanticize kariye.', 'Choti cheezein, bada sukoon. Aaj ek candle jalaiye.'],
      ['Green flags in a gift', 'Achhe gift ke 5 green flags.', 'Useful, sundar, personal, long-lasting aur khushbudar. Candle = sab.'],
    ],
    proof: [
      ['Customer review spotlight', '"Itni achhi khushbu, poora ghar mehak gaya." — hamari customer', 'Aapke pyaar ke liye shukriya. Aapka review bhi bhejiye.'],
      ['Customer ki photo repost (UGC)', 'Hamari candle, aapka ghar.', 'Is pyaari photo ke liye shukriya. Tag karein @jyotessa aur feature hon.'],
      ['Bestseller of the month', 'Is mahine sabse zyada pasand ki gayi candle.', 'Aapne chuna, humne banaya. Abhi order karein jab tak stock hai.'],
      ['Gifting story', 'Ek customer ne apni maa ko ye gift diya. Unka reaction...', 'Har candle ke saath ek kahani. Aapki kahani kya hai?'],
      ['Thank you for 100 orders', 'Shukriya — aapke bharose ke liye.', 'Har order hamare liye khaas hai. Agla order aapka?'],
      ['Corporate gifting showcase', 'Is company ne apni team ko Jyotessa gift kiya.', 'Corporate aur bulk orders ke liye DM karein.'],
    ],
    story: [
      'Poll: "Aaj ki khushbu?" Vanilla / Rose',
      'Behind the scenes: wax pour ka 10 sec clip',
      'Question box: "Candles ke baare me kuch bhi poochiye"',
      'New stock alert + countdown sticker',
      'Customer ki story repost (tag kiya hua)',
      'Emoji slider: "Is candle ko kitna pasand karoge?"',
      'Link sticker: jyotessa.com — weekend offer',
    ],
  },
};


// occasions on the same date every year (month-day)
const OCCASIONS = {
  '10-31': 'Halloween',
  '11-14': "Children's Day",
  '12-25': 'Christmas',
  '12-31': 'New Year Eve',
  '01-01': 'New Year',
  '01-13': 'Lohri',
  '01-14': 'Makar Sankranti',
  '01-26': 'Republic Day',
  '02-07': 'Rose Day',
  '02-14': "Valentine's Day",
  '03-08': "Women's Day",
  '08-15': 'Independence Day',
  '09-05': "Teachers' Day",
};
// festivals that move every year — add next year's dates here
const DATED_OCCASIONS = {
  '2026-11-06': 'Dhanteras',
  '2026-11-08': 'Diwali',
};

function festivalPost(brand, name) {
  if (brand === 'jyotessa')
    return {
      mood: 'festival',
      format: 'Reel + Post',
      topic: `${name} special: gift set / decor post`,
      hook: `${name} par ghar ko roshni aur khushbu se sajaiye.`,
      caption: `Is ${name} apno ko dijiye pyaar aur roshni ka tohfa — Jyotessa gift sets. Limited stock, jaldi order karein.`,
    };
  return {
    mood: 'festival',
    format: 'Post',
    topic: `${name} wishes + offer post`,
    hook: `${name} ki dher saari shubhkamnayein — Team Achivora.`,
    caption: `Is ${name} apne business ko bhi naya roop dijiye. Website / app par festive offer — DM karein.`,
  };
}

const pick = (list, wk, offset = 0) => list[(wk + offset) % list.length];

function dayPost(brand, weekday, wk, date) {
  const slot = WEEK[weekday];
  const occasion = DATED_OCCASIONS[date] || OCCASIONS[date.slice(5)];
  const ideas = IDEAS[brand];
  let post;
  if (occasion) post = { ...festivalPost(brand, occasion), time: '9:00 AM', occasion };
  else {
    const [topic, hook, caption] = pick(ideas[slot.mood], wk, weekday);
    post = { mood: slot.mood, format: slot.format, time: slot.time, topic, hook, caption };
  }
  const tags = TAGS[brand];
  return {
    ...post,
    caption: `${post.caption}\n\n${CTA[brand]}`,
    hashtags: `${tags.base} ${tags[post.mood] || ''}`.trim(),
    story: storyFor(brand, { ...post, date }),
    platform: brand === 'jyotessa' ? 'Instagram + Facebook + Pinterest' : 'Instagram + Facebook + LinkedIn',
  };
}

// ---------- dates (same week math as the planner) ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const weekDates = (monday) =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    return ymd(d);
  });
const weekNo = (monday) => Math.floor(monday.getTime() / (7 * 86400000));

const EDITABLE = ['mood', 'format', 'time', 'topic', 'hook', 'caption', 'hashtags', 'story', 'platform'];
const MOODS = ['tips', 'funny', 'relatable', 'bts', 'poll', 'trend', 'proof', 'festival'];

export function registerContent(app, col, wrap) {
  const posts = () => col.content();
  const clean = ({ _id, ...p }) => {
    const post = { id: _id, ...p, caption: withContact(p.brand, p.caption) };
    // stories saved from the old random list are replaced by one that asks about this post
    if (!post.story || IDEAS[p.brand]?.story.includes(post.story)) post.story = storyFor(p.brand, post);
    const brief = makeBrief(p.brand, post);
    return { ...post, brief, briefText: briefText(p.brand, post, brief) };
  };
  const brandOf = (v) => (BRANDS.includes(v) ? v : 'achivora');
  const todayIST = () => ymd(new Date(Date.now() + 330 * 60000));

  app.get(
    '/api/content',
    wrap(async (req, res) => {
      let monday;
      try {
        monday = mondayOf(String(req.query.date || todayIST()));
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const brand = brandOf(req.query.brand);
      const dates = weekDates(monday);
      const list = await posts().find({ brand, date: { $in: dates } }).sort({ date: 1, order: 1 }).toArray();
      res.json({ brand, week: dates[0], dates, posts: list.map(clean) });
    })
  );

  app.post(
    '/api/content/generate',
    wrap(async (req, res) => {
      let monday;
      try {
        monday = mondayOf(String(req.body?.date || ''));
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const brand = brandOf(req.body?.brand);
      const dates = weekDates(monday);
      if (req.body?.replace) await posts().deleteMany({ brand, date: { $in: dates }, auto: true, done: { $ne: true } });
      else if (await posts().countDocuments({ brand, date: { $in: dates }, auto: true }, { limit: 1 }))
        return res.status(409).json({ error: 'Is hafte ka content plan pehle se bana hua hai.' });
      const keep = new Set((await posts().find({ brand, date: { $in: dates }, auto: true }).toArray()).map((p) => p.date));
      const wk = weekNo(monday);
      const now = new Date().toISOString();
      const docs = dates.flatMap((date, weekday) => (keep.has(date) ? [] : [{
        _id: crypto.randomUUID(),
        brand,
        date,
        ...dayPost(brand, weekday, wk, date),
        done: false,
        doneAt: null,
        order: 100,
        auto: true,
        createdAt: now,
      }]));
      if (!docs.length) return res.json({ ok: true, added: 0 });
      await posts().insertMany(docs);
      res.json({ ok: true, added: docs.length });
    })
  );

  app.post(
    '/api/content',
    wrap(async (req, res) => {
      const b = req.body || {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) return res.status(400).json({ error: 'Date sahi nahi hai.' });
      if (!String(b.topic || '').trim()) return res.status(400).json({ error: 'Topic likhein.' });
      const doc = { _id: crypto.randomUUID(), brand: brandOf(b.brand), date: b.date, done: false, doneAt: null, order: 0, createdAt: new Date().toISOString() };
      for (const k of EDITABLE) doc[k] = String(b[k] ?? '').slice(0, 3000);
      if (!MOODS.includes(doc.mood)) doc.mood = 'tips';
      await posts().insertOne(doc);
      res.json(clean(doc));
    })
  );

  app.patch(
    '/api/content/:pid',
    wrap(async (req, res) => {
      const b = req.body || {};
      const set = {};
      for (const k of EDITABLE) if (b[k] !== undefined) set[k] = String(b[k]).slice(0, 3000);
      if (set.mood && !MOODS.includes(set.mood)) delete set.mood;
      if (set.topic !== undefined && !set.topic.trim()) return res.status(400).json({ error: 'Topic likhein.' });
      if (b.date !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) return res.status(400).json({ error: 'Date sahi nahi hai.' });
        set.date = b.date;
      }
      if (b.done !== undefined) {
        set.done = !!b.done;
        set.doneAt = b.done ? new Date().toISOString() : null;
      }
      const p = await posts().findOneAndUpdate({ _id: req.params.pid }, { $set: set }, { returnDocument: 'after' });
      if (!p) return res.status(404).json({ error: 'Post nahi mili.' });
      res.json(clean(p));
    })
  );

  app.delete(
    '/api/content/:pid',
    wrap(async (req, res) => {
      await posts().deleteOne({ _id: req.params.pid });
      res.json({ ok: true });
    })
  );
}
