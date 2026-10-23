// WhatsApp Business Platform (Meta Cloud API) — the official way to message customers in bulk.
// Configure in .env:
//   WA_CLOUD_TOKEN            permanent System User access token
//   WA_PHONE_NUMBER_ID        "Phone number ID" from WhatsApp Manager > API setup
//   WA_BUSINESS_ACCOUNT_ID    WhatsApp Business Account (WABA) ID
//   WA_WEBHOOK_VERIFY_TOKEN   any random string, also typed into the Meta webhook settings
//   WA_APP_SECRET             Meta app secret, used to verify webhook signatures
import crypto from 'crypto';

const GRAPH = (process.env.WA_GRAPH_URL || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');

const config = () => ({
  token: process.env.WA_CLOUD_TOKEN || '',
  phoneId: process.env.WA_PHONE_NUMBER_ID || '',
  wabaId: process.env.WA_BUSINESS_ACCOUNT_ID || '',
});

export const cloudEnabled = () => {
  const c = config();
  return !!(c.token && c.phoneId && c.wabaId);
};

async function graph(path, { method = 'GET', body, form } = {}) {
  const headers = { Authorization: `Bearer ${config().token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${GRAPH}${path}`, { method, headers, body: form || (body && JSON.stringify(body)) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error || {};
    throw Object.assign(new Error(e.error_user_msg || e.message || `Meta API error ${res.status}`), { code: e.code });
  }
  return data;
}

// number, display name, quality rating — refreshed every few minutes
let info = { ok: false, error: 'Loading…' };
let infoAt = 0;
export async function cloudInfo(force = false) {
  if (!cloudEnabled()) return null;
  if (!force && Date.now() - infoAt < 5 * 60 * 1000) return info;
  infoAt = Date.now();
  try {
    const d = await graph(`/${config().phoneId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`);
    info = {
      ok: true,
      phone: String(d.display_phone_number || '').replace(/\D/g, ''),
      name: d.verified_name || '',
      quality: d.quality_rating || '',
      tier: d.messaging_limit_tier || '',
    };
  } catch (e) {
    info = { ok: false, error: e.message };
    infoAt = Date.now() - 4 * 60 * 1000; // retry sooner after an error
  }
  return info;
}

// approved message templates, with what each one needs filled in
export async function listTemplates() {
  const d = await graph(
    `/${config().wabaId}/message_templates?fields=name,language,status,category,components&limit=200`
  );
  return (d.data || [])
    .filter((t) => t.status === 'APPROVED')
    .map((t) => {
      const header = t.components?.find((c) => c.type === 'HEADER');
      const body = t.components?.find((c) => c.type === 'BODY');
      const footer = t.components?.find((c) => c.type === 'FOOTER');
      const buttons = t.components?.find((c) => c.type === 'BUTTONS');
      const vars = [...new Set((body?.text || '').match(/\{\{\d+\}\}/g) || [])].length;
      return {
        name: t.name,
        language: t.language,
        category: t.category,
        headerFormat: header?.format || null, // TEXT | IMAGE | VIDEO | DOCUMENT
        headerText: header?.format === 'TEXT' ? header.text : '',
        body: body?.text || '',
        footer: footer?.text || '',
        buttons: (buttons?.buttons || []).map((b) => b.text),
        vars,
      };
    });
}

export async function uploadMedia(buffer, contentType, filename) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', contentType);
  form.append('file', new Blob([buffer], { type: contentType }), filename);
  const d = await graph(`/${config().phoneId}/media`, { method: 'POST', form });
  return d.id;
}

export function renderTemplate(tpl, params = []) {
  return tpl.body.replace(/\{\{(\d+)\}\}/g, (m, i) => params[Number(i) - 1] ?? m);
}

// returns the WhatsApp message id (wamid) used to match delivery webhooks
export async function sendTemplate(to, tpl, { params = [], headerImageId } = {}) {
  const components = [];
  if (tpl.headerFormat === 'IMAGE' && headerImageId)
    components.push({ type: 'header', parameters: [{ type: 'image', image: { id: headerImageId } }] });
  if (tpl.vars)
    components.push({ type: 'body', parameters: params.slice(0, tpl.vars).map((text) => ({ type: 'text', text })) });

  const d = await graph(`/${config().phoneId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: tpl.name, language: { code: tpl.language }, ...(components.length && { components }) },
    },
  });
  return d.messages?.[0]?.id;
}

// free-form text — only allowed within 24h of the customer's last message
export async function sendText(to, body) {
  const d = await graph(`/${config().phoneId}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: true } },
  });
  return d.messages?.[0]?.id;
}

// image with optional caption (mediaId from uploadMedia) — same 24h rule as sendText
export async function sendImage(to, mediaId, caption = '') {
  const d = await graph(`/${config().phoneId}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', to, type: 'image', image: { id: mediaId, ...(caption && { caption }) } },
  });
  return d.messages?.[0]?.id;
}

// ---------- webhook ----------
export function verifyWebhookSignature(rawBody, header) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret) return true; // not configured -> accept (set it in production)
  if (!rawBody || !header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// flattens a webhook payload into incoming texts and delivery statuses
export function parseWebhook(body) {
  const incoming = [];
  const statuses = [];
  for (const entry of body?.entry || [])
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || '']));
      for (const m of v.messages || [])
        incoming.push({
          id: m.id,
          from: m.from,
          name: names[m.from] || '',
          type: m.type,
          time: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
          text:
            m.text?.body ||
            m.button?.text ||
            m.button?.payload ||
            m.interactive?.button_reply?.title ||
            m.interactive?.list_reply?.title ||
            m.image?.caption ||
            m.video?.caption ||
            m.document?.caption ||
            '',
        });
      for (const s of v.statuses || [])
        statuses.push({ id: s.id, status: s.status, to: s.recipient_id, error: s.errors?.[0]?.title || s.errors?.[0]?.message });
    }
  return { incoming, statuses };
}
