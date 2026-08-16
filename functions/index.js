const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineJsonSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const parasutConfig = defineJsonSecret("PARASUT_CONFIG");
const ALLOWED_EMAIL = "metinvelidedeoglu@gmail.com";
const PARASUT_BASE = "https://api.parasut.com";

async function getRefreshToken(config) {
  const ref = db.doc("integrations/parasut");
  const snap = await ref.get();
  return snap.exists && snap.data()?.refreshToken
    ? snap.data().refreshToken
    : config.refreshToken;
}

async function refreshAccessToken(config) {
  const refreshToken = await getRefreshToken(config);
  if (!refreshToken) throw new Error("Paraşüt refresh token tanımlı değil.");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(`${PARASUT_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Paraşüt token yenileme hatası (${response.status}): ${text}`);
  }

  const token = await response.json();
  if (token.refresh_token && token.refresh_token !== refreshToken) {
    await db.doc("integrations/parasut").set({
      refreshToken: token.refresh_token,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  return token.access_token;
}

async function parasutGet(companyId, accessToken, path) {
  const response = await fetch(`${PARASUT_BASE}/v4/${companyId}${path}`, {
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

exports.parasutPreview = onCall(
  { secrets: [parasutConfig], region: "europe-west1" },
  async (request) => {
    const email = request.auth?.token?.email?.toLowerCase();
    if (!request.auth || email !== ALLOWED_EMAIL) {
      throw new HttpsError("permission-denied", "Bu işlem için yetkin yok.");
    }

    const config = parasutConfig.value();
    if (!config?.clientId || !config?.clientSecret || !config?.refreshToken || !config?.companyId) {
      throw new HttpsError("failed-precondition", "PARASUT_CONFIG eksik.");
    }

    try {
      const accessToken = await refreshAccessToken(config);
      const [salesInvoices, purchaseBills] = await Promise.all([
        parasutGet(config.companyId, accessToken, "/sales_invoices?page[size]=25"),
        parasutGet(config.companyId, accessToken, "/purchase_bills?page[size]=25"),
      ]);

      return {
        ok: true,
        salesInvoices: salesInvoices.data || [],
        purchaseBills: purchaseBills.data || [],
      };
    } catch (error) {
      console.error(error);
      throw new HttpsError("internal", error.message || "Paraşüt bağlantısı kurulamadı.");
    }
  }
);
