const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const parasutClientId = defineSecret("PARASUT_CLIENT_ID");
const parasutClientSecret = defineSecret("PARASUT_CLIENT_SECRET");
const parasutAuthCode = defineSecret("PARASUT_AUTH_CODE");
const bridgeApiKey = defineSecret("PARASUT_BRIDGE_API_KEY");

const PARASUT_BASE = "https://api.parasut.com";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

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
        return res.json({
          ok: true,
          connected: Boolean(integration.refreshToken),
          companyId: integration.companyId || null,
          companies: integration.companies || [],
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

      if (req.method === "GET" && req.path === "/contacts") {
        const qs = new URLSearchParams({ "page[size]": "25" });
        if (req.query.name) qs.set("filter[name]", String(req.query.name));
        if (req.query.tax_number) qs.set("filter[tax_number]", String(req.query.tax_number));
        if (req.query.email) qs.set("filter[email]", String(req.query.email));
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
