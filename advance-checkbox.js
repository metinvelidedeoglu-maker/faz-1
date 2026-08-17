(() => {
  let patchScheduled = false;

  const money = (value) => new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Number(value) || 0);

  const categoryKey = (value) => String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, "");

  function advanceEnabled(item) {
    if (!item || categoryKey(item.category) !== "metin&erman") return false;
    return Number(item.ermanAdvance) > 0;
  }

  function addDays(dateValue, days) {
    if (!dateValue) return "";
    const date = new Date(`${dateValue}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return "";
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function saveAdvanceFlag(id, checked) {
    if (!id) return;
    const current = window.getFAZ1CloudState?.() || { overrides: {}, deleted: [], custom: [] };
    const next = {
      overrides: current.overrides && typeof current.overrides === "object" ? { ...current.overrides } : {},
      deleted: Array.isArray(current.deleted) ? [...current.deleted] : [],
      custom: Array.isArray(current.custom) ? current.custom.map((item) => ({ ...item })) : [],
    };

    const customIndex = next.custom.findIndex((item) => item.id === id);
    const dueFields = { salesDueDays: 0, purchaseDueDays: checked ? 31 : 0 };

    if (customIndex >= 0) {
      next.custom[customIndex] = { ...next.custom[customIndex], ...dueFields };
    } else {
      next.overrides[id] = { ...(next.overrides[id] || {}), ...dueFields };
    }

    window.applyFAZ1CloudState?.(next);
    queueMicrotask(() => window.pushCloudState?.(next));
  }

  function ensureStyles() {
    if (document.getElementById("advanceCheckboxStyles")) return;
    const style = document.createElement("style");
    style.id = "advanceCheckboxStyles";
    style.textContent = `
      .advance-toggle { display:inline-flex; align-items:center; justify-content:flex-end; gap:8px; cursor:pointer; white-space:nowrap; }
      .advance-toggle input { width:18px; height:18px; accent-color:#4d7ff4; cursor:pointer; }
      .advance-toggle .advance-amount { min-width:84px; text-align:right; font-weight:700; }
      .advance-form-box { display:flex; align-items:center; min-height:44px; padding:0 12px; border:1px solid var(--border, #dce3ef); border-radius:10px; background:var(--surface, #fff); gap:10px; }
      .advance-form-box input { width:20px; height:20px; accent-color:#4d7ff4; }
    `;
    document.head.appendChild(style);
  }

  function patchSalesTable() {
    const panel = document.querySelector("#appView .sales-table-panel");
    const table = panel?.querySelector("table");
    if (!table) return;

    const headers = [...table.querySelectorAll("thead th")];
    const removeIndexes = headers
      .map((th, index) => ({ index, text: th.textContent.trim() }))
      .filter((item) => item.text === "Tahsilat tarihi" || item.text === "Ödeme tarihi")
      .map((item) => item.index)
      .sort((a, b) => b - a);

    const advanceIndexOriginal = headers.findIndex((th) => th.textContent.trim() === "Erman avans");
    if (advanceIndexOriginal < 0) return;

    const rows = [...table.querySelectorAll("tbody tr")];
    const salesById = new Map((window.__FAZ1?.allSales?.() || []).map((item) => [item.id, item]));

    rows.forEach((row) => {
      const editButton = row.querySelector('[data-action="edit-sale"]');
      const id = editButton?.dataset.id;
      const item = salesById.get(id);
      const cells = [...row.children];
      const advanceCell = cells[advanceIndexOriginal];
      if (advanceCell && id && item) {
        const checked = advanceEnabled(item);
        const amount = checked && item.purchaseAmount !== null ? Number(item.purchaseAmount || 0) / 2 : 0;
        advanceCell.innerHTML = `<label class="advance-toggle" title="Erman avans"><input type="checkbox" data-advance-row="${String(id).replace(/"/g, "&quot;")}" ${checked ? "checked" : ""}><span class="advance-amount">${checked ? money(amount) : "—"}</span></label>`;
      }
      removeIndexes.forEach((index) => row.children[index]?.remove());
    });

    removeIndexes.forEach((index) => table.querySelectorAll("thead th")[index]?.remove());
  }

  function patchSaleModal() {
    const form = document.getElementById("saleForm");
    if (!form || form.dataset.advancePatched === "1") return;
    form.dataset.advancePatched = "1";

    [...form.querySelectorAll(".col-6")].forEach((field) => {
      const label = field.querySelector("label")?.textContent?.trim();
      if (label === "Tahsilat tarihi" || label === "Ödeme tarihi") field.remove();
    });

    const id = form.querySelector('input[name="id"]')?.value;
    const existing = id ? window.__FAZ1?.allSales?.().find((item) => item.id === id) : null;
    const checked = advanceEnabled(existing);
    const grid = form.querySelector(".section-grid");
    if (grid && !form.querySelector('[name="ermanAdvanceEnabled"]')) {
      const wrap = document.createElement("div");
      wrap.className = "col-6";
      wrap.innerHTML = `<label>Erman avans</label><label class="advance-form-box"><input type="checkbox" name="ermanAdvanceEnabled" ${checked ? "checked" : ""}><span>Avans uygulanacak</span></label>`;
      grid.appendChild(wrap);
    }

    const subtitle = form.closest(".modal")?.querySelector(".summary-label");
    if (subtitle) subtitle.textContent = "Erman avans koşulu kutucuktan yönetilir. İşaretliyse alış tutarının yarısı Erman avans olarak hesaplanır.";
  }

  function prepareFormForLegacyCore(form) {
    if (!form) return;
    const invoiceDate = form.querySelector('[name="invoiceDate"]')?.value || "";
    const checked = Boolean(form.querySelector('[name="ermanAdvanceEnabled"]')?.checked);

    ["collectionDate", "paymentDate"].forEach((name) => form.querySelector(`[name="${name}"]`)?.remove());

    const collection = document.createElement("input");
    collection.type = "hidden";
    collection.name = "collectionDate";
    collection.value = invoiceDate;
    form.appendChild(collection);

    const payment = document.createElement("input");
    payment.type = "hidden";
    payment.name = "paymentDate";
    payment.value = checked ? addDays(invoiceDate, 31) : invoiceDate;
    form.appendChild(payment);
  }

  function patchDashboard() {
    const root = document.getElementById("breadcrumbRoot")?.textContent?.trim();
    if (root !== "Genel Bakış") return;

    const heroText = document.querySelector("#appView .hero-panel p");
    if (heroText) heroText.textContent = "Satış, alış ve Metin–Erman marj dağılımı tek tabloda. Erman avans koşulu işaret kutusundan yönetilir.";

    const radarHeading = [...document.querySelectorAll("#appView .panel h2")].find((node) => node.textContent.trim() === "Vade radar");
    const panel = radarHeading?.closest(".panel");
    if (!panel) return;

    const items = (window.__FAZ1?.allSales?.() || []).filter(advanceEnabled);
    const total = items.reduce((sum, item) => sum + (Number(item.purchaseAmount) || 0) / 2, 0);
    panel.innerHTML = `<div class="panel-heading"><div><h2>Erman avans</h2><p>İşaretli satışlar</p></div><span class="tag orange">${items.length} kayıt</span></div><div class="alert-list"><div class="alert-item"><div class="alert-mark orange">₺</div><div><div class="alert-title">Toplam Erman avans</div><div class="alert-text">${money(total)}</div></div></div></div>`;
  }

  function patchSettings() {
    const chips = [...document.querySelectorAll("#appView .chip")];
    chips.forEach((chip) => {
      const text = chip.textContent.trim();
      if (text === "Tahsilat Tarihi" || text === "Ödeme Tarihi") chip.remove();
    });
  }

  function patch() {
    patchScheduled = false;
    ensureStyles();
    patchSalesTable();
    patchSaleModal();
    patchDashboard();
    patchSettings();
  }

  function schedulePatch() {
    if (patchScheduled) return;
    patchScheduled = true;
    queueMicrotask(patch);
  }

  document.addEventListener("click", (event) => {
    const rowToggle = event.target.closest?.("[data-advance-row]");
    if (rowToggle) {
      event.stopPropagation();
      saveAdvanceFlag(rowToggle.dataset.advanceRow, rowToggle.checked);
      return;
    }

    const saveButton = event.target.closest?.('[data-action="save-sale"]');
    if (saveButton) prepareFormForLegacyCore(document.getElementById("saleForm"));
  }, true);

  document.addEventListener("submit", (event) => {
    if (event.target?.id === "saleForm") prepareFormForLegacyCore(event.target);
  }, true);

  const observer = new MutationObserver(schedulePatch);
  observer.observe(document.body, { childList: true, subtree: true });
  schedulePatch();
})();
