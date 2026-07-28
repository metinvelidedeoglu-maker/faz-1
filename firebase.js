import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRr_KV7eeqz2CMLGz5mk0HwF8wpvmZLqI",
  authDomain: "metin-finans.firebaseapp.com",
  projectId: "metin-finans",
  storageBucket: "metin-finans.firebasestorage.app",
  messagingSenderId: "642146814831",
  appId: "1:642146814831:web:5db363fd5d250258ec369a",
};

const ALLOWED_EMAIL = "metinvelidedeoglu@gmail.com";
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
await setPersistence(auth, browserLocalPersistence);

let db;
try {
  db = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch {
  db = initializeFirestore(firebaseApp);
}

const gate = document.getElementById("authGate");
const signInButton = document.getElementById("googleSignInBtn");
const signOutButton = document.getElementById("signOutBtn");
const errorBox = document.getElementById("authError");
const status = document.getElementById("saveStatus");
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

let stopSnapshot = null;
let currentRef = null;
let remoteReady = false;
let writeChain = Promise.resolve();
let lastRemoteState = "";

function setStatus(text) { status.textContent = text; }
function clean(value) { return JSON.parse(JSON.stringify(value ?? { overrides: {}, deleted: [], custom: [] })); }

async function startGoogleSignIn() {
  errorBox.textContent = "";
  signInButton.disabled = true;
  signInButton.textContent = "Giriş açılıyor…";
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    const redirectCodes = [
      "auth/popup-blocked",
      "auth/popup-closed-by-user",
      "auth/cancelled-popup-request",
      "auth/operation-not-supported-in-this-environment",
    ];
    if (redirectCodes.includes(error.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    errorBox.textContent = `Google girişi açılamadı: ${error.message || error.code}`;
  } finally {
    signInButton.disabled = false;
    signInButton.textContent = "Google ile giriş yap";
  }
}

async function attachCloud(user) {
  if (stopSnapshot) stopSnapshot();
  currentRef = doc(db, "users", user.uid, "apps", "faz1");
  remoteReady = false;
  setStatus("Buluta bağlanıyor");

  stopSnapshot = onSnapshot(currentRef, async (snapshot) => {
    if (snapshot.exists()) {
      const remoteState = clean(snapshot.data()?.state);
      const serialized = JSON.stringify(remoteState);
      if (serialized !== lastRemoteState && typeof window.applyFAZ1CloudState === "function") {
        lastRemoteState = serialized;
        window.applyFAZ1CloudState(remoteState);
      }
      remoteReady = true;
      setStatus(snapshot.metadata.fromCache ? "Çevrimdışı kayıt" : "Senkronize");
      return;
    }

    const localState = clean(window.getFAZ1CloudState?.());
    lastRemoteState = JSON.stringify(localState);
    await setDoc(currentRef, {
      state: localState,
      ownerEmail: user.email,
      updatedAt: serverTimestamp(),
    });
    remoteReady = true;
    setStatus("Senkronize");
  }, (error) => {
    console.error(error);
    setStatus("Senkronizasyon hatası");
    errorBox.textContent = "Firestore bağlantısı kurulamadı. Güvenlik kurallarını kontrol et.";
  });
}

window.pushCloudState = (state) => {
  if (!auth.currentUser || !currentRef || !remoteReady) return Promise.resolve();
  const cleanState = clean(state);
  const serialized = JSON.stringify(cleanState);
  if (serialized === lastRemoteState) return Promise.resolve();
  lastRemoteState = serialized;
  setStatus("Kaydediliyor");
  writeChain = writeChain.then(() => setDoc(currentRef, {
    state: cleanState,
    ownerEmail: auth.currentUser.email,
    updatedAt: serverTimestamp(),
  }, { merge: true })).then(() => {
    setStatus(navigator.onLine ? "Senkronize" : "Çevrimdışı kayıt");
  }).catch((error) => {
    console.error(error);
    lastRemoteState = "";
    setStatus("Senkronizasyon bekliyor");
  });
  return writeChain;
};

signInButton.addEventListener("click", startGoogleSignIn);
signOutButton.addEventListener("click", () => signOut(auth));
window.addEventListener("online", () => setStatus(auth.currentUser ? "Senkronize" : "Giriş gerekli"));
window.addEventListener("offline", () => setStatus("Çevrimdışı kayıt"));

try {
  await getRedirectResult(auth);
} catch (error) {
  errorBox.textContent = `Giriş tamamlanamadı: ${error.message || error.code}`;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    gate.hidden = false;
    signOutButton.hidden = true;
    setStatus("Giriş gerekli");
    remoteReady = false;
    currentRef = null;
    lastRemoteState = "";
    if (stopSnapshot) {
      stopSnapshot();
      stopSnapshot = null;
    }
    return;
  }

  if ((user.email || "").toLowerCase() !== ALLOWED_EMAIL) {
    errorBox.textContent = `Bu uygulama yalnızca ${ALLOWED_EMAIL} hesabına açıktır.`;
    await signOut(auth);
    return;
  }

  gate.hidden = true;
  signOutButton.hidden = false;
  await attachCloud(user);
});
