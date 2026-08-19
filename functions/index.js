const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const parasutClientId = defineSecret("PARASUT_CLIENT_ID");
const parasutClientSecret = defineSecret("PARASUT_CLIENT_SECRET");
const parasutAuthCode = defineSecret("PARASUT_AUTH_CODE");
const bridgeApiKey = defineSecret("PARASUT_BRIDGE_API_KEY");

const ALLOWED_EMAIL = "metinvelidedeoglu@gmail.com";
const PARASUT_BASE = "https://api.parasut.com";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

function assertAllowed(request) {
  const email = request.auth?.token?.email?.toLowerCase();
  if (!request.auth || email !== ALLOWED_EMAIL) {
    throw new HttpsError("permission-denied", "Bu işlem için yetkin yok.");
  }
}

function assertBridgeKey(req) {
  const supplied = String(req.get("x-api-key") || "");
  if (!supplied || supplied !== bridgeApiKey.value()) {
    const err = new Error("Yetkisiz istek.");
    err.status = 401;
    throw err;
  }
}

async function tokenRequest(params) {
  const response = await fetch(`${PARASUT_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Paraşüt token hatası (${response.status}): ${text}`);
  }
  return response.json();
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
  const payload = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : null;
  if (!response.ok) {
    const err = new Error(`Paraşüt API hatası (${response.status})`);
    err.status = response.status;
    err.details = payload;
    throw err;
  }
  return payload;
}

async function getIntegration() {
  const snap = await db.doc("integrations/parasut").get();
  return snap.exists ? snap.data() : {};
}

async function refreshAccessToken() {
  const integration = await getIntegration();
  if (!integration.refreshToken) {
    throw new Error("Paraşüt bağlantısı henüz başlatılmamış.");
  }

  const token = await tokenRequest({
    grant_type: "refresh_token",
    client_id: parasutClientId.value(),
    client_secret: parasutClientSecret.value(),
    refresh_token: integration.refreshToken,
  });

  await db.doc("integrations/parasut").set({
    refreshToken: token.refresh_token || integration.refreshToken,
    tokenUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

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

  await db.doc("integrations/parasut").set({
    refreshToken: token.refresh_token,
    companyId,
    companies,
    connectedAt: FieldValue.serverTimestamp(),
    tokenUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, companyId, companies, me };
}

exports.parasutBootstrap = onCall(
  { secrets: [parasutClientId, parasutClientSecret, parasutAuthCode], region: "europe-west1" },
  async (request) => {
    assertAllowed(request);
    try { return await bootstrapParasut(); }
    catch (error) {
      console.error(error);
      throw new HttpsError("internal", error.message || "Paraşüt ilk bağlantısı kurulamadı.");
    }
  }
);

exports.parasutPreview = onCall(
  { secrets: [parasutClientId, parasutClientSecret], region: "europe-west1" },
  async (request) => {
    assertAllowed(request);
    try {
      const integration = await getIntegration();
      if (!integration.companyId) throw new Error("Paraşüt firma ID henüz belirlenmedi.");
      const accessToken = await refreshAccessToken();
      const companyId = integration.companyId;
      const [salesInvoices, purchaseBills] = await Promise.all([
        parasutRequest(accessToken, `/v4/${companyId}/sales_invoices?page[size]=25&include=contact,details,details.product`),
        parasutRequest(accessToken, `/v4/${companyId}/purchase_bills?page[size]=25&include=contact,details,details.product`),
      ]);
      return { ok: true, companyId, salesInvoices, purchaseBills };
    } catch (error) {
      console.error(error);
      throw new HttpsError("internal", error.message || "Paraşüt bağlantısı kurulamadı.");
    }
  }
);

exports.parasutBridge = onRequest(
  {
    secrets: [parasutClientId, parasutClientSecret, parasutAuthCode, bridgeApiKey],
    region: "europe-west1",
    cors: true,
  },
  async (req, res) => {
    try {
      assertBridgeKey(req);
      if (req.method === "GET" && (req.path === "/" || req.path === "/health")) {
        const integration = await getIntegration();
        return res.json({ ok: true, connected: Boolean(integration.refreshToken), companyId: integration.companyId || null });
      }

      if (req.method === "POST" && req.path === "/bootstrap") {
        return res.json(await bootstrapParasut());
      }

      const integration = await getIntegration();
      if (!integration.companyId) return res.status(409).json({ error: "Paraşüt firma ID henüz belirlenmedi. Önce bootstrap çalıştırılmalı." });
      const companyId = integration.companyId;
      const accessToken = await refreshAccessToken();

      if (req.method === "GET" && req.path === "/contacts") {
        const name = String(req.query.name || "").trim();
        const taxNumber = String(req.query.tax_number || "").trim();
        const email = String(req.query.email || "").trim();
        const qs = new URLSearchParams({ "page[size]": "25" });
        if (name) qs.set("filter[name]", name);
        if (taxNumber) qs.set("filter[tax_number]", taxNumber);
        if (email) qs.set("filter[email]", email);
        return res.json(await parasutRequest(accessToken, `/v4/${companyId}/contacts?${qs}`));
      }

      if (req.method === "GET" && req.path === "/products") {
        const name = String(req.query.name || "").trim();
        const code = String(req.query.code || "").trim();
        const qs = new URLSearchParams({ "page[size]": "25" });
        if (name) qs.set("filter[name]", name);
        if (code) qs.set("filter[code]", code);
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
        for (const line of lines) {
          if (!line.product_id || !(Number(line.quantity) > 0) || Number(line.unit_price) < 0) {
            return res.status(400).json({ error: "Her kalemde product_id, quantity>0 ve unit_price>=0 zorunlu." });
          }
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
