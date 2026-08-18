const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const parasutClientId = defineSecret("PARASUT_CLIENT_ID");
const parasutClientSecret = defineSecret("PARASUT_CLIENT_SECRET");
const parasutAuthCode = defineSecret("PARASUT_AUTH_CODE");

const ALLOWED_EMAIL = "metinvelidedeoglu@gmail.com";
const PARASUT_BASE = "https://api.parasut.com";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

function assertAllowed(request) {
  const email = request.auth?.token?.email?.toLowerCase();
  if (!request.auth || email !== ALLOWED_EMAIL) {
    throw new HttpsError("permission-denied", "Bu işlem için yetkin yok.");
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

async function parasutGet(accessToken, path) {
  const response = await fetch(`${PARASUT_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Paraşüt API hatası (${response.status}): ${text}`);
  }
  return response.json();
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
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
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

exports.parasutBootstrap = onCall(
  {
    secrets: [parasutClientId, parasutClientSecret, parasutAuthCode],
    region: "europe-west1",
  },
  async (request) => {
    assertAllowed(request);
    try {
      const token = await tokenRequest({
        grant_type: "authorization_code",
        client_id: parasutClientId.value(),
        client_secret: parasutClientSecret.value(),
        code: parasutAuthCode.value(),
        redirect_uri: REDIRECT_URI,
      });

      const me = await parasutGet(token.access_token, "/v4/me");
      const companies = findCompanyCandidates(me);
      const companyId = companies.length === 1 ? companies[0].id : null;

      await db.doc("integrations/parasut").set({
        refreshToken: token.refresh_token,
        companyId,
        companies,
        connectedAt: FieldValue.serverTimestamp(),
        tokenUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        ok: true,
        companyId,
        companies,
        me,
      };
    } catch (error) {
      console.error(error);
      throw new HttpsError("internal", error.message || "Paraşüt ilk bağlantısı kurulamadı.");
    }
  }
);

exports.parasutPreview = onCall(
  {
    secrets: [parasutClientId, parasutClientSecret],
    region: "europe-west1",
  },
  async (request) => {
    assertAllowed(request);
    try {
      const integration = await getIntegration();
      if (!integration.companyId) {
        throw new Error("Paraşüt firma ID henüz belirlenmedi.");
      }
      const accessToken = await refreshAccessToken();
      const companyId = integration.companyId;
      const [salesInvoices, purchaseBills] = await Promise.all([
        parasutGet(accessToken, `/v4/${companyId}/sales_invoices?page[size]=25&include=contact,details,details.product`),
        parasutGet(accessToken, `/v4/${companyId}/purchase_bills?page[size]=25&include=contact,details,details.product`),
      ]);

      return {
        ok: true,
        companyId,
        salesInvoices: salesInvoices.data || [],
        salesIncluded: salesInvoices.included || [],
        purchaseBills: purchaseBills.data || [],
        purchaseIncluded: purchaseBills.included || [],
      };
    } catch (error) {
      console.error(error);
      throw new HttpsError("internal", error.message || "Paraşüt bağlantısı kurulamadı.");
    }
  }
);
