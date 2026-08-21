const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const parasutClientId = defineSecret("PARASUT_CLIENT_ID");
const parasutClientSecret = defineSecret("PARASUT_CLIENT_SECRET");
const parasutAuthCode = defineSecret("PARASUT_AUTH_CODE");
const bridgeApiKey = defineSecret("PARASUT_BRIDGE_API_KEY");

const PARASUT_BASE = "https://api.parasut.com";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";
const CONTACT_INDEX_DOC = "integrations/parasutContactsIndex";
const MAX_CONTACT_PAGES = 40;

let cachedDb = null;
let cachedFieldValue = null;

function getAdmin() {
  if (cachedDb && cachedFieldValue) return { db: cachedDb, FieldValue: cachedFieldValue };
  const { getApps, initializeApp } = require("firebase-admin/app");
  const { getFirestore, FieldValue } = require("firebase-admin/firestore");
  if (!getApps().length) initializeApp();
  cachedDb = getFirestore();
  cachedFieldValue = FieldValue;
  return { db: cachedDb, FieldValue: cachedFieldValue };
}

function assertBridgeKey(req) {
  const headerKey = String(req.get("x-api-key") || "");
  const authorization = String(req.get("authorization") || "");
  const bearerKey = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const supplied = headerKey || bearerKey;
  if (!supplied || supplied !== bridgeApiKey.value()) {
    const err = new Error("Yetkisiz istek.");
    err.status = 401;
    throw err;
  }
}

async function tokenRequest(params) {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    form.append(key, String(value));
  }

  const response = await fetch(`${PARASUT_BASE}/oauth/token`, {
    method: "POST",
    body: form,
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!response.ok) {
    const err = new Error(`Paraşüt token hatası (${response.status})`);
    err.status = response.status;
    err.details = payload;
    throw err;
  }
  return payload;
}

async function parasutRequest(accessToken, path, options = {}) {
  const response = await fetch(`${PARASUT_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!response.ok) {
    const err = new Error(`Paraşüt API hatası (${response.status})`);
    err.status = response.status;
    err.details = payload;
    throw err;
  }
  return payload;
}

async function getIntegration() {
  const { db } = getAdmin();
  const snap = await db.doc("integrations/parasut").get();
  return snap.exists ? snap.data() : {};
}

async function saveIntegration(data) {
  const { db, FieldValue } = getAdmin();
  await db.doc("integrations/parasut").set({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactContact(contact) {
  const a = contact?.attributes || {};
  return {
    id: String(contact?.id || ""),
    type: contact?.type || "contacts",
    attributes: {
      name: a.name || "",
      email: a.email || null,
      tax_number: a.tax_number || null,
      tax_office: a.tax_office || null,
      city: a.city || null,
      district: a.district || null,
      address: a.address || null,
      phone: a.phone || null,
      account_type: a.account_type || null,
      balance: a.balance ?? null,
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rebuildContactsIndex(accessToken, companyId) {
  const contacts = [];
  let pages = 0;
  let truncated = false;

  for (let page = 1; page <= MAX_CONTACT_PAGES; page += 1) {
    const qs = new URLSearchParams({
      "page[size]": "25",
      "page[number]": String(page),
      sort: "name",
    });
    const payload = await parasutRequest(accessToken, `/v4/${companyId}/contacts?${qs}`);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    contacts.push(...rows.map(compactContact));
    pages = page;
    if (rows.length < 25) break;
    if (page === MAX_CONTACT_PAGES) truncated = true;
    await sleep(1050);
  }

  const { db, FieldValue } = getAdmin();
  await db.doc(CONTACT_INDEX_DOC).set({
    companyId: String(companyId),
    contacts,
    count: contacts.length,
    pages,
    truncated,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, count: contacts.length, pages, truncated };
}

async function getContactsIndex() {
  const { db } = getAdmin();
  const snap = await db.doc(CONTACT_INDEX_DOC).get();
  return snap.exists ? snap.data() : null;
}

function searchContactsInIndex(contacts, searchName) {
  const needle = normalizeSearchText(searchName);
  if (!needle) return contacts.slice(0, 25);
  const tokens = needle.split(" ").filter(Boolean);

  return contacts
    .map((contact) => {
      const haystack = normalizeSearchText(contact?.attributes?.name);
      let score = null;
      if (haystack === needle) score = 0;
      else if (haystack.startsWith(needle)) score = 1;
      else if (haystack.includes(needle)) score = 2;
      else if (tokens.every((token) => haystack.includes(token))) score = 3;
      return score == null ? null : { contact, score, haystack };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.haystack.length - b.haystack.length || a.haystack.localeCompare(b.haystack, "tr"))
    .slice(0, 25)
    .map((item) => item.contact);
}

async function refreshAccessToken() {
  const integration = await getIntegration();
  if (!integration.refreshToken) throw new Error("Paraşüt bağlantısı henüz başlatılmamış.");
  const token = await tokenRequest({
    grant_type: "refresh_token",
    client_id: parasutClientId.value(),
    client_secret: parasutClientSecret.value(),
    refresh_token: integration.refreshToken,
  });
  await saveIntegration({ refreshToken: token.refresh_token || integration.refreshToken });
  return token.access_token;
}

function findCompanyCandidates(payload) {
  const found = [];
  const seen = new Set();
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(walk);
    const type = String(value.type || "").toLowerCase();
    if ((type.includes("compan") || type.includes("firm")) && value.id != null) {
      const id = String(value.id);
      if (!seen.has(id)) {
        seen.add(id);
        found.push({ id, type: value.type || null, attributes: value.attributes || null });
      }
    }
    Object.values(value).forEach(walk);
  }
  walk(payload);
  return found;
}

async function bootstrapParasut() {
  const token = await tokenRequest({
    grant_type: "authorization_code",
    client_id: parasutClientId.value(),
    client_secret: parasutClientSecret.value(),
    code: parasutAuthCode.value(),
    redirect_uri: REDIRECT_URI,
  });
  const me = await parasutRequest(token.access_token, "/v4/me");
  const companies = findCompanyCandidates(me);
  const companyId = companies.length === 1 ? companies[0].id : null;
  await saveIntegration({ refreshToken: token.refresh_token, companyId, companies });
  return { ok: true, companyId, companies, me };
}

exports.parasutBridge = onRequest(
  {
    secrets: [parasutClientId, parasutClientSecret, parasutAuthCode, bridgeApiKey],
    region: "europe-west1",
    cors: true,
    timeoutSeconds: 60,
  },
  async (req, res) => {
    try {
      assertBridgeKey(req);

      if (req.method === "GET" && (req.path === "/" || req.path === "/health")) {
        const integration = await getIntegration();
        const index = await getContactsIndex();
        return res.json({
          ok: true,
          connected: Boolean(integration.refreshToken),
          companyId: integration.companyId || null,
          companies: integration.companies || [],
          contactsIndexed: Boolean(index && String(index.companyId) === String(integration.companyId)),
          contactsIndexCount: index?.count || 0,
        });
      }

      if (req.method === "POST" && req.path === "/bootstrap") {
        return res.json(await bootstrapParasut());
      }

      if (req.method === "POST" && req.path === "/select-company") {
        const integration = await getIntegration();
        const companyId = String(req.body?.company_id || "");
        if (!companyId) return res.status(400).json({ error: "company_id zorunlu." });
        const companies = Array.isArray(integration.companies) ? integration.companies : [];
        if (companies.length && !companies.some((company) => String(company.id) === companyId)) {
          return res.status(400).json({ error: "Bu company_id kayıtlı Paraşüt şirketleri arasında bulunamadı." });
        }
        await saveIntegration({ companyId });
        return res.json({ ok: true, companyId });
      }

      const integration = await getIntegration();
      if (!integration.companyId) return res.status(409).json({ error: "Paraşüt firma ID henüz belirlenmedi. Önce bootstrap çalıştırılmalı." });
      const companyId = integration.companyId;
      const accessToken = await refreshAccessToken();

      if (req.method === "POST" && req.path === "/reindex-contacts") {
        return res.json(await rebuildContactsIndex(accessToken, companyId));
      }

      if (req.method === "GET" && req.path === "/contacts") {
        const searchName = String(req.query.name || "").trim();
        const taxNumber = String(req.query.tax_number || "").trim();
        const email = String(req.query.email || "").trim();

        if (searchName) {
          const index = await getContactsIndex();
          if (index && String(index.companyId) === String(companyId) && Array.isArray(index.contacts)) {
            let matches = searchContactsInIndex(index.contacts, searchName);
            if (taxNumber) matches = matches.filter((c) => String(c?.attributes?.tax_number || "") === taxNumber);
            if (email) matches = matches.filter((c) => String(c?.attributes?.email || "").toLowerCase() === email.toLowerCase());
            return res.json({
              data: matches,
              meta: {
                local_search: true,
                indexed_contacts: index.count || index.contacts.length,
                index_truncated: Boolean(index.truncated),
              },
            });
          }
        }

        const qs = new URLSearchParams({ "page[size]": "25" });
        if (searchName) qs.set("filter[name]", searchName);
        if (taxNumber) qs.set("filter[tax_number]", taxNumber);
        if (email) qs.set("filter[email]", email);
        return res.json(await parasutRequest(accessToken, `/v4/${companyId}/contacts?${qs}`));
      }

      if (req.method === "GET" && req.path === "/products") {
        const qs = new URLSearchParams({ "page[size]": "25" });
        if (req.query.name) qs.set("filter[name]", String(req.query.name));
        if (req.query.code) qs.set("filter[code]", String(req.query.code));
        return res.json(await parasutRequest(accessToken, `/v4/${companyId}/products?${qs}`));
      }

      if (req.method === "GET" && req.path === "/sales-invoices") {
        const qs = new URLSearchParams({ "page[size]": String(Math.min(Number(req.query.page_size) || 15, 25)), include: "contact,details,details.product,payments" });
        if (req.query.issue_date) qs.set("filter[issue_date]", String(req.query.issue_date));
        if (req.query.payment_status) qs.set("filter[payment_status]", String(req.query.payment_status));
        return res.json(await parasutRequest(accessToken, `/v4/${companyId}/sales_invoices?${qs}`));
      }

      if (req.method === "GET" && req.path === "/purchase-bills") {
        const qs = new URLSearchParams({ "page[size]": String(Math.min(Number(req.query.page_size) || 15, 25)), include: "contact,details,details.product,payments" });
        if (req.query.issue_date) qs.set("filter[issue_date]", String(req.query.issue_date));
        return res.json(await parasutRequest(accessToken, `/v4/${companyId}/purchase_bills?${qs}`));
      }

      if (req.method === "POST" && req.path === "/sales-invoices") {
        const { contact_id, issue_date, due_date, description, currency = "TRL", lines = [] } = req.body || {};
        if (!contact_id || !issue_date || !Array.isArray(lines) || !lines.length) {
          return res.status(400).json({ error: "contact_id, issue_date ve en az bir fatura kalemi zorunlu." });
        }
        const body = {
          data: {
            type: "sales_invoices",
            attributes: {
              item_type: "invoice",
              description: description || "",
              issue_date,
              due_date: due_date || issue_date,
              currency,
              exchange_rate: 1,
              withholding_rate: 0,
              invoice_discount_type: "percentage",
              invoice_discount: 0,
            },
            relationships: {
              contact: { data: { id: String(contact_id), type: "contacts" } },
              details: {
                data: lines.map((line) => ({
                  type: "sales_invoice_details",
                  attributes: {
                    quantity: Number(line.quantity),
                    unit_price: Number(line.unit_price),
                    vat_rate: Number(line.vat_rate ?? 20),
                    vat_withholding_rate: 0,
                    discount_type: "percentage",
                    discount_value: Number(line.discount_value || 0),
                    description: line.description || "",
                  },
                  relationships: { product: { data: { id: String(line.product_id), type: "products" } } },
                })),
              },
            },
          },
        };
        const created = await parasutRequest(accessToken, `/v4/${companyId}/sales_invoices?include=contact,details,details.product`, { method: "POST", body });
        return res.status(201).json(created);
      }

      return res.status(404).json({ error: "Endpoint bulunamadı." });
    } catch (error) {
      console.error(error);
      return res.status(error.status || 500).json({ error: error.message || "Köprü hatası", details: error.details || undefined });
    }
  }
);
