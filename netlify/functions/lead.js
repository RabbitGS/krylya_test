// Приёмник заявок с сайта → amoCRM (API v4).
// Токен и поддомен берутся ТОЛЬКО из переменных окружения Netlify — в коде их нет.
//   AMOCRM_SUBDOMAIN   — поддомен кабинета (то, что до .amocrm.ru)
//   AMOCRM_TOKEN       — долгосрочный токен интеграции
//   AMOCRM_PIPELINE_ID — (необязательно) id воронки
//   AMOCRM_STATUS_ID   — (необязательно) id этапа

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  const SUB = process.env.AMOCRM_SUBDOMAIN;
  const TOKEN = process.env.AMOCRM_TOKEN;
  if (!SUB || !TOKEN) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: 'amoCRM не настроен (нет переменных окружения)' }) };
  }

  let data = {};
  try { data = JSON.parse(event.body || '{}'); } catch (e) {}

  const name = String(data.name || '').trim().slice(0, 200);
  const phone = String(data.phone || '').trim().slice(0, 50);
  const apt = String(data.apt || '').trim().slice(0, 200);
  const formId = String(data.form || '').trim().slice(0, 50);
  const page = String(data.page || '').trim().slice(0, 300);

  // простая защита: телефон должен содержать хотя бы 10 цифр
  if ((phone.replace(/\D/g, '').length) < 10) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'Некорректный телефон' }) };
  }

  const base = `https://${SUB}.amocrm.ru`;
  const headers = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

  // 1) создаём сделку + контакт одним запросом (/leads/complex)
  const leadName = 'Заявка с сайта Крылья' + (apt ? ` — ${apt.split(',')[0]}` : '');
  const lead = {
    name: leadName,
    _embedded: {
      tags: [{ name: 'Сайт Крылья' }],
      contacts: [{
        name: name || 'Клиент с сайта',
        custom_fields_values: [
          { field_code: 'PHONE', values: [{ value: phone, enum_code: 'WORK' }] },
        ],
      }],
    },
  };
  if (process.env.AMOCRM_PIPELINE_ID) lead.pipeline_id = Number(process.env.AMOCRM_PIPELINE_ID);
  if (process.env.AMOCRM_STATUS_ID) lead.status_id = Number(process.env.AMOCRM_STATUS_ID);

  try {
    const r = await fetch(`${base}/api/v4/leads/complex`, {
      method: 'POST', headers, body: JSON.stringify([lead]),
    });
    const txt = await r.text();
    if (!r.ok) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, error: 'amoCRM отклонил запрос', status: r.status, detail: txt.slice(0, 500) }) };
    }

    // 2) добавляем примечание к сделке с деталями (необязательно, не критично)
    let leadId = null;
    try { leadId = JSON.parse(txt)?.[0]?.id; } catch (e) {}
    if (leadId) {
      const note = `Заявка с сайта\nИмя: ${name}\nТелефон: ${phone}` +
        (apt ? `\nКвартира: ${apt}` : '') +
        (formId ? `\nФорма: ${formId}` : '') +
        (page ? `\nСтраница: ${page}` : '');
      try {
        await fetch(`${base}/api/v4/leads/${leadId}/notes`, {
          method: 'POST', headers,
          body: JSON.stringify([{ note_type: 'common', params: { text: note } }]),
        });
      } catch (e) {}
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, error: String(e).slice(0, 300) }) };
  }
};
