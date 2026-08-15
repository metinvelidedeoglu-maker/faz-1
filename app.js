(() => {
  const baseData = window.VENSIS_SALES_DATA ?? { sales: [], sourceFile: "FAZ 1.xlsx", sourceSheet: "Sayfa1", dataPeriod: "2026 Ocak–Temmuz" };
  const analysisDate = new Date("2026-07-26T12:00:00");
  const monthOrder = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  const monthKeyMap = { Ocak: "OCAK", Şubat: "ŞUBAT", Mart: "MART", Nisan: "NİSAN", Mayıs: "MAYIS", Haziran: "HAZİRAN", Temmuz: "TEMMUZ", Ağustos: "AĞUSTOS", Eylül: "EYLÜL", Ekim: "EKİM", Kasım: "KASIM", Aralık: "ARALIK" };
  const monthFromKey = Object.fromEntries(Object.entries(monthKeyMap).map(([label, key]) => [key, label]));
  const state = {
    view: "dashboard",
    salesTab: "transactions",
    search: "",
    month: "Temmuz",
    category: [],
    brand: [],
    openMultiFilter: null,
    sort: "date-desc",
    startDate: "",
    endDate: "",
  };
  // Some file previews block localStorage. Keep a session fallback so edits
  // still survive the re-render that follows Save.
  const memoryStorage = new Map();
  let applyingRemoteState = false;

  const appView = document.getElementById("appView");
  const toast = document.getElementById("toast");
  const modalBackdrop = document.getElementById("modalBackdrop");
  const modal = document.getElementById("modal");

  function loadStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const value = JSON.parse(raw);
        memoryStorage.set(key, value);
        return value;
      }
    } catch { /* use the in-memory fallback below */ }
    return memoryStorage.has(key) ? memoryStorage.get(key) : fallback;
  }
  function saveStorage(key, value) {
    memoryStorage.set(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* session fallback is active */ }
    if (!applyingRemoteState) queueMicrotask(() => window.pushCloudState?.(cloudState()));
  }
  function getOverrides() { return loadStorage("faz1_overrides", {}); }
  function getDeleted() { return new Set(loadStorage("faz1_deleted", [])); }
  function getCustom() { return loadStorage("faz1_custom", []); }
  function cloudState() { return { overrides: getOverrides(), deleted: [...getDeleted()], custom: getCustom() }; }
  function num(value) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
  function nullableNumber(value) { if (value === "" || value === null || value === undefined) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
  function sum(items, key) { return items.reduce((total, item) => total + num(item[key]), 0); }
  function money(value, decimals = 0) { return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(num(value)); }
  function compactMoney(value) { const amount = num(value); if (amount >= 1000000) return `${(amount / 1000000).toFixed(1).replace(".", ",")} M TL`; if (amount >= 1000) return `${Math.round(amount / 1000).toLocaleString("tr-TR")} B TL`; return money(amount); }
  function pct(value) { return `${(num(value) * 100).toFixed(1).replace(".", ",")}%`; }
  function dateText(value) { if (!value) return "—"; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" }); }
  function isoDate(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10); }
  function excelSerial(value) { if (!value) return null; const date = new Date(`${value}T12:00:00Z`); return Number.isNaN(date.getTime()) ? null : Math.round((date.getTime() - Date.UTC(1899, 11, 30)) / 86400000); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
  function showToast(message) { toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600); }
  function closeModal() { modalBackdrop.classList.add("hidden"); modal.innerHTML = ""; }
  function openModal(content) { modal.innerHTML = content; modalBackdrop.classList.remove("hidden"); }
  function dateDiffDays(value) { if (!value) return null; return Math.round((new Date(`${value}T12:00:00`) - analysisDate) / 86400000); }

  function monthFromDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("tr-TR", { month: "long" });
  }
  function daysBetween(start, end) {
    if (!start || !end) return null;
    const startDate = new Date(`${start}T12:00:00Z`);
    const endDate = new Date(`${end}T12:00:00Z`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
    return Math.round((endDate - startDate) / 86400000);
  }
  function recalculate(item) {
    const month = monthFromDate(item.invoiceDate) || item.month || "Belirsiz";
    const salesAmount = nullableNumber(item.salesAmount);
    const purchaseAmount = nullableNumber(item.purchaseAmount);
    const salesDueDays = nullableNumber(item.salesDueDays);
    const purchaseDueDays = nullableNumber(item.purchaseDueDays);
    const gross = salesAmount !== null && purchaseAmount !== null ? salesAmount - purchaseAmount : null;
    const rate = salesAmount !== null && purchaseAmount !== null && purchaseAmount !== 0 ? salesAmount / purchaseAmount - 1 : null;
    const lowerCategory = String(item.category ?? "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, "");
    const category = ["erman", "metin&erman", "metinerman"].includes(lowerCategory) ? "Metin&Erman" : item.category;
    const categoryKey = String(category ?? "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, "");
    const ermanMargin = gross === null ? null : categoryKey === "metin&erman" ? gross / 2 : null;
    const normalizedMetinMargin = gross === null ? null : categoryKey === "metin" ? gross : categoryKey === "metin&erman" ? gross / 2 : null;
    const dueAdvantage = purchaseAmount !== null && salesDueDays !== null && purchaseDueDays !== null && purchaseDueDays - salesDueDays > 30 ? purchaseAmount : 0;
    const ermanAdvance = categoryKey === "metin&erman" ? dueAdvantage / 2 : null;
    const collectionDate = item.invoiceDate && salesDueDays !== null ? addDays(item.invoiceDate, salesDueDays) : null;
    const paymentDate = item.invoiceDate && purchaseDueDays !== null ? addDays(item.invoiceDate, purchaseDueDays) : null;
    return { ...item, category, month, monthKey: monthKeyMap[month] ?? "BELIRSIZ", salesAmount, purchaseAmount, salesDueDays, purchaseDueDays, collectionDate, paymentDate, grossMarginRate: rate, grossMarginAmount: gross, metinMargin: normalizedMetinMargin, ermanMargin, dueAdvantage, ermanAdvance };
  }
  function addDays(dateValue, days) { const date = new Date(`${dateValue}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + Number(days)); return date.toISOString().slice(0, 10); }
  function allSales() {
    const overrides = getOverrides();
    const deleted = getDeleted();
    const originals = baseData.sales.filter((item) => !deleted.has(item.id)).map((item) => recalculate({ ...item, ...(overrides[item.id] ?? {}) }));
    return [...originals, ...getCustom().map((item) => recalculate(item))];
  }
  function grouped(items, key) {
    const map = new Map();
    items.forEach((item) => { const name = item[key] || "Belirsiz"; const row = map.get(name) ?? { name, count: 0, sales: 0, purchase: 0, gross: 0 }; row.count += 1; row.sales += num(item.salesAmount); row.purchase += num(item.purchaseAmount); row.gross += num(item.grossMarginAmount); map.set(name, row); });
    return [...map.values()].sort((a, b) => b.sales - a.sales);
  }
  function monthlySummary(items = allSales()) {
    return monthOrder.map((month) => { const monthItems = items.filter((item) => item.month === month); if (!monthItems.length) return null; return { month, monthKey: monthKeyMap[month], count: monthItems.length, sales: sum(monthItems, "salesAmount"), purchase: sum(monthItems, "purchaseAmount"), gross: sum(monthItems, "grossMarginAmount") }; }).filter(Boolean);
  }
  function metrics(items = allSales()) {
    const purchase = sum(items, "purchaseAmount");
    const futureCollections = items.filter((item) => item.collectionDate && dateDiffDays(item.collectionDate) >= 0 && dateDiffDays(item.collectionDate) <= 30);
    return { sales: sum(items, "salesAmount"), purchase, gross: sum(items, "grossMarginAmount"), rate: purchase ? sum(items, "grossMarginAmount") / purchase : 0, futureCollections, incomplete: items.filter((item) => item.salesAmount === null || item.purchaseAmount === null) };
  }
  function filteredSales() {
    const categorySelection = selectedFilterValues(state.category);
    const brandSelection = selectedFilterValues(state.brand);
    let items = allSales().filter((item) => {
      const q = state.search.toLocaleLowerCase("tr-TR");
      const textMatch = !q || [item.customer, item.brand, item.category, item.month].join(" ").toLocaleLowerCase("tr-TR").includes(q);
      const dateMatch = (!state.startDate || String(item.invoiceDate ?? "") >= state.startDate) && (!state.endDate || String(item.invoiceDate ?? "") <= state.endDate);
      const monthMatch = state.month === "all" || item.month === state.month;
      return textMatch && dateMatch && monthMatch && (!categorySelection.length || categorySelection.includes(item.category)) && (!brandSelection.length || brandSelection.includes(item.brand));
    });
    items.sort((a, b) => state.sort === "sales-desc" ? num(b.salesAmount) - num(a.salesAmount) : state.sort === "margin-desc" ? num(b.grossMarginAmount) - num(a.grossMarginAmount) : String(b.invoiceDate ?? "").localeCompare(String(a.invoiceDate ?? "")));
    return items;
  }
  function uniqueValues(key) { return [...new Set(allSales().map((item) => item[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")); }
  function selectedFilterValues(value) { return Array.isArray(value) ? value : value === "all" || !value ? [] : [value]; }
  function filterButtonLabel(selected, allLabel) { if (!selected.length) return allLabel; return selected.length === 1 ? selected[0] : `${selected.length} seçili`; }
  function multiFilter(key, values, allLabel) {
    const selected = selectedFilterValues(state[key]);
    const isOpen = state.openMultiFilter === key;
    const label = filterButtonLabel(selected, allLabel);
    return `<div class="multi-filter${isOpen ? " open" : ""}" data-multi-filter="${key}"><button type="button" class="filter-select multi-filter-toggle${selected.length ? " has-selection" : ""}" data-multi-toggle="${key}" aria-expanded="${isOpen}"><span>${escapeHtml(label)}</span><span class="multi-filter-chevron">⌄</span></button><div class="multi-filter-menu" role="group" aria-label="${escapeHtml(allLabel)}">${values.map((value) => `<label class="multi-option" data-multi-option><input type="checkbox" value="${escapeHtml(value)}" ${selected.includes(value) ? "checked" : ""}/><span>${escapeHtml(value)}</span></label>`).join("")}</div></div>`;
  }

  function pageHeading(eyebrow, title, subtitle, actions = "") { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`; }
  function metricCard(label, value, note, icon, color = "blue", noteClass = "") { return `<div class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon ${color}">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-note ${noteClass}">${note}</div></div>`; }
  function updateHeader() {
    const titles = { dashboard: ["Genel Bakış", "FAZ 1 satış tablosu"], sales: ["Satış kayıtları", "Aylık kayıt ve özet"], settings: ["Ayarlar & Veri", "Bulut veri yönetimi"] };
    const [root, current] = titles[state.view] ?? titles.dashboard;
    document.getElementById("breadcrumbRoot").textContent = root;
    document.getElementById("breadcrumbCurrent").textContent = current;
    document.querySelectorAll(".nav-item, .settings-button").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
    document.getElementById("salesCount").textContent = allSales().length;
  }
  function navigate(view) { state.view = view; document.getElementById("sidebar").classList.remove("open"); render(); }
  function render() { appView.innerHTML = state.view === "dashboard" ? dashboardView() : state.view === "sales" ? salesView() : settingsView(); updateHeader(); }

  function chartSvg(items = monthlySummary()) {
    const width = 680, height = 225, left = 37, right = 12, top = 17, bottom = 28, max = Math.max(...items.map((item) => item.sales), 1);
    const x = (index) => left + (index * (width - left - right)) / Math.max(items.length - 1, 1);
    const y = (value) => top + (height - top - bottom) * (1 - value / max);
    const points = items.map((item, index) => `${x(index)},${y(item.sales)}`).join(" ");
    const area = `${left},${height - bottom} ${points} ${x(items.length - 1)},${height - bottom}`;
    const grid = [0, .25, .5, .75, 1].map((fraction) => { const yy = top + (height - top - bottom) * fraction; return `<line x1="${left}" x2="${width - right}" y1="${yy}" y2="${yy}" class="chart-grid-line"/><text x="0" y="${yy + 3}" class="chart-axis-label">${compactMoney(max * (1 - fraction)).replace(" TL", "")}</text>`; }).join("");
    const labels = items.map((item, index) => `<text x="${x(index)}" y="${height - 7}" text-anchor="middle" class="chart-axis-label">${item.month.slice(0, 3)}</text>`).join("");
    const dots = items.map((item, index) => `<circle cx="${x(index)}" cy="${y(item.sales)}" r="${index === items.length - 1 ? 5 : 3.5}" class="chart-dot ${index === items.length - 1 ? "last" : ""}"/>`).join("");
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Aylık satış grafiği"><defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4d7ff4"/><stop offset="1" stop-color="#4d7ff4" stop-opacity="0"/></linearGradient></defs>${grid}<polygon points="${area}" class="chart-area"/><polyline points="${points}" class="chart-line"/>${dots}${labels}</svg>`;
  }
  function dashboardView() {
    const items = allSales(), m = metrics(items), summary = monthlySummary(items), topCustomers = grouped(items, "customer").slice(0, 5), topBrands = grouped(items, "brand").slice(0, 6), maxCustomer = topCustomers[0]?.sales || 1;
    return `${pageHeading("FAZ 1 / KONTROL", "FAZ 1 satış tablosu", `${baseData.dataPeriod} · ${items.length} kayıt · tüm rakamlar Excel sütunlarından hesaplanır.`, `<button class="button secondary" data-action="export-csv">CSV dışa aktar</button><button class="button primary" data-action="add-sale">＋ Yeni satış</button>`)}
      <section class="hero-panel"><div class="hero-kicker">FAZ 1.xlsx · Sayfa1</div><h2>${compactMoney(m.sales)} satış hacmi</h2><p>Satış, alış, vade tarihleri ve Metin–Erman marj dağılımı tek tabloda. Kayıt ekleyebilir, düzenleyebilir, silebilir ve aylık Excel çıktısı alabilirsin.</p><div class="hero-meta">Brüt marj<strong>${compactMoney(m.gross)}</strong></div></section>
      <section class="metric-grid">${metricCard("Toplam satış", compactMoney(m.sales), `${items.length} işlem kaydı`, "↗", "blue", "up")}${metricCard("Toplam alış", compactMoney(m.purchase), "tedarik maliyeti", "↓", "orange")}${metricCard("Brüt marj", compactMoney(m.gross), `${pct(m.rate)} alış üstü`, "◒", "green", "up")}${metricCard("Eksik kayıt", String(m.incomplete.length), "tutarı tamamlanmamış kayıt", "!", "purple", m.incomplete.length ? "warn" : "")}</section>
      <section class="dashboard-grid"><div class="panel"><div class="panel-heading"><div><h2>Aylık satış performansı</h2><p>Satış tutarı · TL</p></div><button class="panel-link" data-view="sales">Aylık kayıtları aç</button></div><div class="chart-wrap">${chartSvg(summary)}</div></div><div class="panel"><div class="panel-heading"><div><h2>Vade radar</h2><p>Önümüzdeki 30 gün</p></div><span class="tag orange">${m.futureCollections.length} kayıt</span></div><div class="alert-list">${m.futureCollections.slice(0, 5).map((item) => `<div class="alert-item"><div class="alert-mark orange">₺</div><div><div class="alert-title">${escapeHtml(item.customer)}</div><div class="alert-text">${compactMoney(item.salesAmount)} · tahsilat ${dateText(item.collectionDate)}</div></div></div>`).join("") || `<div class="empty-state">Önümüzdeki 30 günde planlı tahsilat yok.</div>`}</div></div></section>
      <section class="bottom-grid"><div class="panel"><div class="panel-heading"><div><h2>En yüksek müşteriler</h2><p>Satış hacmine göre</p></div><button class="panel-link" data-view="sales">Tüm kayıtlar</button></div><div class="ranking-list">${topCustomers.map((item, index) => `<div class="ranking-row"><div class="ranking-number">${String(index + 1).padStart(2, "0")}</div><div class="ranking-main"><div class="ranking-name">${escapeHtml(item.name)}</div><div class="progress"><span style="width:${item.sales / maxCustomer * 100}%"></span></div></div><div class="ranking-value">${compactMoney(item.sales)}</div></div>`).join("")}</div></div><div class="panel"><div class="panel-heading"><div><h2>Marka dağılımı</h2><p>Etiket sütununa göre ilk 6</p></div><span class="tag blue">Etiket</span></div><div class="ranking-list">${topBrands.map((item) => `<div class="ranking-row"><div class="ranking-number">${item.count}</div><div class="ranking-main"><div class="ranking-name">${escapeHtml(item.name)}</div><div class="progress"><span style="width:${item.sales / (topBrands[0]?.sales || 1) * 100}%"></span></div></div><div class="ranking-value">${compactMoney(item.sales)}</div></div>`).join("")}</div></div></section>`;
  }

  function salesTable(items) {
    if (!items.length) return `<div class="empty-state">Filtreye uyan kayıt bulunamadı.</div>`;
    return `<div class="table-wrap"><table><thead><tr><th>Kategori</th><th>Fatura tarihi</th><th class="customer-column">Müşteri</th><th>Etiket</th><th class="align-right">Satış tutar</th><th>Tahsilat tarihi</th><th class="align-right">Alış tutar</th><th>Ödeme tarihi</th><th class="align-right">Brüt kâr oranı</th><th class="align-right">Brüt kâr (TL)</th><th class="align-right">Metin marj</th><th class="align-right">Erman marj</th><th class="align-right">Erman avans</th><th>İşlem</th></tr></thead><tbody>${items.map((item) => { const categoryKey = String(item.category ?? "").toLocaleLowerCase("tr-TR"); const categoryClass = categoryKey === "metin" ? "blue" : categoryKey === "metin&erman" ? "purple" : ""; return `<tr><td><span class="tag ${categoryClass}">${escapeHtml(item.category || "Belirsiz")}</span></td><td>${dateText(item.invoiceDate)}</td><td class="customer-column"><strong class="customer-name" title="${escapeHtml(item.customer)}">${escapeHtml(item.customer)}</strong></td><td>${escapeHtml(item.brand || "—")}</td><td class="align-right"><strong>${item.salesAmount === null ? "—" : money(item.salesAmount)}</strong></td><td>${dateText(item.collectionDate)}</td><td class="align-right">${item.purchaseAmount === null ? "—" : money(item.purchaseAmount)}</td><td>${dateText(item.paymentDate)}</td><td class="align-right">${item.grossMarginRate === null ? "—" : pct(item.grossMarginRate)}</td><td class="align-right">${item.grossMarginAmount === null ? "—" : money(item.grossMarginAmount)}</td><td class="align-right">${item.metinMargin === null ? "—" : money(item.metinMargin)}</td><td class="align-right">${item.ermanMargin === null ? "—" : money(item.ermanMargin)}</td><td class="align-right">${item.ermanAdvance === null ? "—" : money(item.ermanAdvance)}</td><td><div class="row-actions"><button type="button" class="mini-icon edit" data-action="edit-sale" data-id="${escapeHtml(item.id)}" title="Düzenle" aria-label="Düzenle">Düzenle</button><button type="button" class="mini-icon delete" data-action="delete-sale" data-id="${escapeHtml(item.id)}" title="Sil" aria-label="Sil">×</button></div></td></tr>`; }).join("")}</tbody></table></div>`;
  }
  function monthlyTable(items) { return `<div class="table-wrap"><table><thead><tr><th>Ay</th><th class="align-right">Kayıt</th><th class="align-right">Satış</th><th class="align-right">Alış</th><th class="align-right">Brüt kâr</th><th class="align-right">Kâr oranı</th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${item.month}</strong></td><td class="align-right">${item.count}</td><td class="align-right">${money(item.sales)}</td><td class="align-right">${money(item.purchase)}</td><td class="align-right">${money(item.gross)}</td><td class="align-right">${pct(item.purchase ? item.gross / item.purchase : 0)}</td></tr>`).join("")}</tbody></table></div>`; }
  function rankingTable(items) { const max = items[0]?.sales || 1; return `<div class="ranking-list">${items.slice(0, 20).map((item, index) => `<div class="ranking-row"><div class="ranking-number">${String(index + 1).padStart(2, "0")}</div><div class="ranking-main"><div class="ranking-name">${escapeHtml(item.name)}</div><div class="progress"><span style="width:${item.sales / max * 100}%"></span></div><div class="focus-sub">${item.count} işlem · marj ${money(item.gross)}</div></div><div class="ranking-value">${compactMoney(item.sales)}</div></div>`).join("")}</div>`; }
  function filterBar() {
    const available = monthOrder.filter((month) => allSales().some((item) => item.month === month));
    return `<div class="filter-bar"><select class="filter-select month-select" data-filter="month"><option value="all" ${state.month === "all" ? "selected" : ""}>Tüm aylar</option>${available.map((month) => `<option value="${month}" ${state.month === month ? "selected" : ""}>${month} 2026</option>`).join("")}</select><input class="field date-filter" type="date" data-filter="startDate" aria-label="Başlangıç tarihi" title="Fatura tarihine göre başlangıç" value="${escapeHtml(state.startDate)}"/><input class="field date-filter" type="date" data-filter="endDate" aria-label="Bitiş tarihi" title="Fatura tarihine göre bitiş" value="${escapeHtml(state.endDate)}"/><input class="field search-field" data-filter="search" placeholder="Müşteri, etiket veya kategori ara…" value="${escapeHtml(state.search)}"/>${multiFilter("category", uniqueValues("category"), "Tüm kategoriler")}${multiFilter("brand", uniqueValues("brand"), "Tüm etiketler")}<select class="filter-select" data-filter="sort"><option value="date-desc" ${state.sort === "date-desc" ? "selected" : ""}>En yeni</option><option value="sales-desc" ${state.sort === "sales-desc" ? "selected" : ""}>Satış tutarı</option><option value="margin-desc" ${state.sort === "margin-desc" ? "selected" : ""}>Brüt kâr</option></select></div>`;
  }
  function salesView() {
    const available = monthOrder.filter((month) => allSales().some((item) => item.month === month));
    if (state.month !== "all" && !available.includes(state.month)) state.month = available[available.length - 1] || "Temmuz";
    const items = filteredSales(), m = metrics(items);
    const tabs = [["transactions", "Satış kayıtları"], ["customers", "Müşteriler"], ["brands", "Etiketler"]];
    const body = state.salesTab === "customers" ? rankingTable(grouped(items, "customer")) : state.salesTab === "brands" ? rankingTable(grouped(items, "brand")) : salesTable(items);
    const monthlyCards = `<section class="metric-grid monthly-metrics">${metricCard(`${state.month} satış`, money(m.sales), `${items.length} işlem kaydı`, "↗", "blue", "up")}${metricCard(`${state.month} alış`, money(m.purchase), "tedarik maliyeti", "↓", "orange")}${metricCard(`${state.month} brüt kâr`, money(m.gross), `${pct(m.rate)} alış üstü`, "◒", "green", "up")}${metricCard("Metin marj", money(sum(items, "metinMargin")), "seçili ay toplamı", "M", "blue")}${metricCard("Erman marj", money(sum(items, "ermanMargin")), "seçili ay toplamı", "E", "green")}${metricCard("Erman avans", money(sum(items, "ermanAdvance")), "seçili ay toplamı", "₺", "orange")}${metricCard("Eksik kayıt", String(m.incomplete.length), "tutarı tamamlanmamış kayıt", "!", "purple", m.incomplete.length ? "warn" : "")}</section>`;
    return `${pageHeading("FAZ 1 / AYLIK KAYITLAR", "Satış kayıtları", "Ay seçerek kayıtları, satışları ve kârları birlikte inceleyebilirsin.", `<button class="button secondary" data-action="export-csv">Gösterileni CSV’ye aktar</button><button class="button primary" data-action="export-monthly-xlsx">Gösterileni Excel’e aktar</button><button class="button primary" data-action="add-sale">＋ Yeni satış</button>`)}${filterBar()}${monthlyCards}<div class="tab-bar">${tabs.map(([key, label]) => `<button class="tab-button ${state.salesTab === key ? "active" : ""}" data-sales-tab="${key}">${label}</button>`).join("")}</div><div class="panel sales-table-panel">${body}</div>`;
  }
  function settingsView() {
    return `${pageHeading("FAZ 1 / SİSTEM", "Ayarlar & Veri", "FAZ 1.xlsx tablosu ve Firebase üzerinde eşitlenen değişiklikler.", `<button class="button secondary" data-action="export-json">JSON yedeği</button>`)}<section class="settings-grid"><div class="panel"><div class="panel-heading"><div><h2>Kaynak</h2><p>Çalışılan Excel bilgisi</p></div><span class="tag green">Bağlı</span></div><div class="setting-row"><span>Dosya</span><strong>${baseData.sourceFile}</strong></div><div class="setting-row"><span>Sayfa</span><strong>${baseData.sourceSheet}</strong></div><div class="setting-row"><span>Dönem</span><strong>${baseData.dataPeriod}</strong></div><div class="setting-row"><span>Orijinal kayıt</span><strong>${baseData.sales.length}</strong></div><div class="setting-row"><span>Aktif kayıt</span><strong>${allSales().length}</strong></div></div><div class="panel"><div class="panel-heading"><div><h2>Bulut senkronizasyonu</h2><p>Ekleme, düzenleme ve silmeler cihazlar arasında eşitlenir.</p></div><span class="tag green">Firebase</span></div><div class="notice">Excel dosyası değişmez. Uygulamadaki değişiklikler Firebase’e kaydedilir ve çevrimdışı kullanım için bu cihazda da tutulur.</div><div style="height:14px"></div><button class="button secondary" data-action="clear-local">Tüm değişiklikleri sıfırla</button></div><div class="panel full"><div class="panel-heading"><div><h2>FAZ 1 sütunları</h2><p>Uygulamada korunan alanlar</p></div></div><div class="chip-list">${["Kategori", "Fatura Tarihi", "Müşteri", "Etiket", "Satış Tutar", "Tahsilat Tarihi", "Alış Tutar", "Ödeme Tarihi", "Brüt Kâr Oranı", "Brüt Kâr (TL)", "Metin Marj", "Erman Marj", "Erman Avans"].map((item) => `<span class="chip">${item}</span>`).join("")}</div></div></section>`;
  }

  function fieldValue(value) { return escapeHtml(value ?? ""); }
  function saleModal(existing = null) {
    const item = existing ?? { category: "Metin", invoiceDate: isoDate(analysisDate), customer: "", brand: "", salesAmount: "", purchaseAmount: "", collectionDate: isoDate(analysisDate), paymentDate: isoDate(analysisDate) };
    openModal(`<div class="modal-header"><div><div class="eyebrow">FAZ 1 / SATIŞ</div><h2>${existing ? "Satışı düzenle" : "Yeni satış ekle"}</h2><p class="summary-label">Tahsilat ve ödeme tarihleri arasındaki farklardan vade avantajı otomatik hesaplanır.</p></div><button type="button" class="modal-close" data-action="close-modal">×</button></div><form class="modal-form" id="saleForm"><input type="hidden" name="id" value="${fieldValue(existing?.id)}"/><div class="section-grid"><div class="col-6"><label>Kategori</label><select class="field" name="category"><option ${item.category === "Metin" ? "selected" : ""}>Metin</option><option ${item.category === "Metin&Erman" ? "selected" : ""}>Metin&Erman</option><option ${!item.category || item.category === "Belirsiz" ? "selected" : ""}>Belirsiz</option></select></div><div class="col-6"><label>Fatura tarihi</label><input class="field" type="date" name="invoiceDate" value="${fieldValue(item.invoiceDate)}" required/></div><div class="col-6"><label>Müşteri</label><input class="field" name="customer" value="${fieldValue(item.customer)}" required/></div><div class="col-6"><label>Etiket</label><input class="field" name="brand" value="${fieldValue(item.brand)}"/></div><div class="col-6"><label>Satış tutar · TL</label><input class="field" type="number" step="0.01" name="salesAmount" value="${fieldValue(item.salesAmount)}"/></div><div class="col-6"><label>Tahsilat tarihi</label><input class="field" type="date" name="collectionDate" value="${fieldValue(item.collectionDate || item.invoiceDate)}"/></div><div class="col-6"><label>Alış tutar · TL</label><input class="field" type="number" step="0.01" name="purchaseAmount" value="${fieldValue(item.purchaseAmount)}"/></div><div class="col-6"><label>Ödeme tarihi</label><input class="field" type="date" name="paymentDate" value="${fieldValue(item.paymentDate || item.invoiceDate)}"/></div></div><div class="modal-actions"><button type="button" class="button secondary" data-action="close-modal">Vazgeç</button><button type="button" class="button primary" data-action="save-sale">${existing ? "Değişiklikleri kaydet" : "Satışı ekle"}</button></div></form>`);
  }
  function findSale(id) { return allSales().find((item) => item.id === id); }
  function saveSale(form) {
    const invoiceDate = form.get("invoiceDate");
    const raw = { category: form.get("category"), invoiceDate, customer: form.get("customer"), brand: form.get("brand"), salesAmount: nullableNumber(form.get("salesAmount")), salesDueDays: daysBetween(invoiceDate, form.get("collectionDate")), purchaseAmount: nullableNumber(form.get("purchaseAmount")), purchaseDueDays: daysBetween(invoiceDate, form.get("paymentDate")) };
    const id = form.get("id");
    if (id && baseData.sales.some((item) => item.id === id)) { const overrides = getOverrides(); overrides[id] = raw; saveStorage("faz1_overrides", overrides); }
    else if (id) { const custom = getCustom().map((item) => item.id === id ? { ...item, ...raw } : item); saveStorage("faz1_custom", custom); }
    else { saveStorage("faz1_custom", [...getCustom(), { id: `local-${Date.now()}`, sourceRow: null, ...raw }]); }
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadText(filename, content, type) { downloadBlob(filename, new Blob([content], { type })); }
  function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
  function exportCsv() { const headers = ["KATEGORİ", "FATURA TARİHİ", "MÜŞTERİ", "ETİKET", "SATIŞ TUTAR", "TAHSİLAT TARİHİ", "ALIŞ TUTAR", "ÖDEME TARİHİ", "BRÜT KÂR ORANI", "BRÜT KÂR (TL)", "METİN MARJ", "ERMAN MARJ", "ERMAN AVANS"]; const rows = filteredSales().map((item) => [item.category, item.invoiceDate, item.customer, item.brand, item.salesAmount, item.collectionDate, item.purchaseAmount, item.paymentDate, item.grossMarginRate, item.grossMarginAmount, item.metinMargin, item.ermanMargin, item.ermanAdvance].map(csvCell).join(";")); downloadText(`FAZ1-${state.month}-2026.csv`, `\uFEFF${headers.map(csvCell).join(";")}\n${rows.join("\n")}`, "text/csv;charset=utf-8"); showToast(`${state.month} kayıtları CSV’ye aktarıldı.`); }
  function exportJson() { downloadText("FAZ1-yerel-yedek.json", JSON.stringify({ overrides: getOverrides(), deleted: [...getDeleted()], custom: getCustom() }, null, 2), "application/json;charset=utf-8"); showToast("JSON yedeği indirildi."); }

  // Minimal, dependency-free XLSX writer. It creates a real XLSX ZIP with typed cells and formulas.
  const te = new TextEncoder();
  function u16(value) { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, value, true); return a; }
  function u32(value) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, value >>> 0, true); return a; }
  function concatBytes(parts) { const size = parts.reduce((sum, part) => sum + part.length, 0); const out = new Uint8Array(size); let offset = 0; parts.forEach((part) => { out.set(part, offset); offset += part.length; }); return out; }
  function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
  function xml(value) { return String(value ?? "").replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char])); }
  function colName(number) { let result = ""; let value = number + 1; while (value > 0) { const rest = (value - 1) % 26; result = String.fromCharCode(65 + rest) + result; value = Math.floor((value - 1) / 26); } return result; }
  function cellXml(reference, cell, rowStyle = 0) {
    if (cell === null || cell === undefined) return "";
    const style = cell.style ?? rowStyle;
    if (cell.formula) {
      const cached = cell.cached !== null && cell.cached !== undefined && cell.cached !== "" && Number.isFinite(Number(cell.cached))
        ? `<v>${Number(cell.cached)}</v>`
        : "";
      return `<c r="${reference}" s="${style}"><f>${xml(cell.formula)}</f>${cached}</c>`;
    }
    if (cell.type === "number" || cell.type === "date") {
      const value = cell.value;
      if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "";
      return `<c r="${reference}" s="${style}"><v>${Number(value)}</v></c>`;
    }
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
  }
  function sheetXml(rows, widths, filterEnd = "Q") { const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join(""); return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, colIndex) => cellXml(`${colName(colIndex)}${rowIndex + 1}`, cell)).join("")}</row>`).join("")}</sheetData><autoFilter ref="A1:${filterEnd}${rows.length}"/></worksheet>`; }
  function stylesXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="2"><font><sz val="10"/><color rgb="FF445067"/><name val="Aptos"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0A1020"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`; }
  function xlsxZip(files) {
    const local = [], central = []; let offset = 0;
    Object.entries(files).forEach(([name, content]) => { const nameBytes = te.encode(name), data = typeof content === "string" ? te.encode(content) : content, checksum = crc32(data); const localHeader = concatBytes([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data]); const centralHeader = concatBytes([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]); local.push(localHeader); central.push(centralHeader); offset += localHeader.length; });
    const centralBytes = concatBytes(central); const end = concatBytes([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(centralBytes.length), u32(offset), u16(0)]); return new Blob([...local, centralBytes, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  function makeXlsx(items, month) {
    const headers = ["KATEGORİ", "FATURA TARİHİ", "MÜŞTERİ", "ETİKET", "SATIŞ TUTAR", "TAHSİLAT TARİHİ", "ALIŞ TUTAR", "ÖDEME TARİHİ", "BRÜT KÂR ORANI", "BRÜT KÂR (TL)", "METİN MARJ", "ERMAN MARJ", "ERMAN AVANS"];
    const tableRows = [headers.map((value) => ({ value, style: 1 }))];
    items.forEach((item, index) => { const row = index + 2; tableRows.push([
      { value: item.category ?? "", type: "string" }, { value: excelSerial(item.invoiceDate), type: "date", style: 3 }, { value: item.customer, type: "string" }, { value: item.brand, type: "string" }, { value: item.salesAmount, type: "number", style: 2 }, { value: excelSerial(item.collectionDate), type: "date", style: 3 }, { value: item.purchaseAmount, type: "number", style: 2 }, { value: excelSerial(item.paymentDate), type: "date", style: 3 }, { formula: `IFERROR(E${row}/G${row}-1,"")`, cached: item.grossMarginRate, style: 4 }, { formula: `IFERROR(E${row}-G${row},"")`, cached: item.grossMarginAmount, style: 2 }, { formula: `IF(LOWER(A${row})="metin",J${row},IF(LOWER(A${row})="metin&erman",J${row}/2,""))`, cached: item.metinMargin, style: 2 }, { formula: `IF(LOWER(A${row})="metin&erman",J${row}/2,"")`, cached: item.ermanMargin, style: 2 }, { formula: `IF(LOWER(A${row})="metin&erman",IF(H${row}-F${row}>30,G${row}/2,0),"")`, cached: item.ermanAdvance, style: 2 },
    ]); });
    const last = Math.max(items.length + 1, 2), summaryRows = [[{ value: `FAZ 1.xlsx · ${month} 2026 Aylık Özet`, style: 1 }], [], [{ value: "Kayıt sayısı" }, { formula: `COUNTA('İşlemler'!C2:C${last})`, cached: items.length }], [{ value: "Satış toplamı" }, { formula: `SUM('İşlemler'!E2:E${last})`, cached: sum(items, "salesAmount"), style: 2 }], [{ value: "Alış toplamı" }, { formula: `SUM('İşlemler'!G2:G${last})`, cached: sum(items, "purchaseAmount"), style: 2 }], [{ value: "Brüt kâr" }, { formula: `SUM('İşlemler'!J2:J${last})`, cached: sum(items, "grossMarginAmount"), style: 2 }], [{ value: "Brüt kâr oranı" }, { formula: "IFERROR(B6/B5,0)", cached: metrics(items).rate, style: 4 }], [{ value: "Metin marj" }, { formula: `SUM('İşlemler'!K2:K${last})`, cached: sum(items, "metinMargin"), style: 2 }], [{ value: "Erman marj" }, { formula: `SUM('İşlemler'!L2:L${last})`, cached: sum(items, "ermanMargin"), style: 2 }], [{ value: "Erman avans" }, { formula: `SUM('İşlemler'!M2:M${last})`, cached: sum(items, "ermanAdvance"), style: 2 }], [], [{ value: "Etiket", style: 1 }, { value: "Kayıt", style: 1 }, { value: "Satış", style: 1 }, { value: "Brüt kâr", style: 1 }]];
    const brands = grouped(items, "brand"); brands.forEach((brand) => { const row = summaryRows.length + 1; summaryRows.push([{ value: brand.name }, { formula: `COUNTIF('İşlemler'!$D$2:$D$${last},A${row})`, cached: brand.count }, { formula: `SUMIF('İşlemler'!$D$2:$D$${last},A${row},'İşlemler'!$E$2:$E$${last})`, cached: brand.sales, style: 2 }, { formula: `SUMIF('İşlemler'!$D$2:$D$${last},A${row},'İşlemler'!$J$2:$J$${last})`, cached: brand.gross, style: 2 }]); });
    const files = { "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`, "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`, "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/><sheets><sheet name="Özet" sheetId="1" r:id="rId1"/><sheet name="İşlemler" sheetId="2" r:id="rId2"/></sheets></workbook>`, "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`, "xl/styles.xml": stylesXml(), "xl/worksheets/sheet1.xml": sheetXml(summaryRows, [32, 18, 19, 20], "D"), "xl/worksheets/sheet2.xml": sheetXml(tableRows, [18, 14, 26, 18, 16, 16, 16, 16, 17, 17, 16, 16, 16], "M") };
    return xlsxZip(files);
  }
  function exportMonthlyXlsx() { const month = state.month || "Temmuz"; const items = filteredSales(); downloadBlob(`FAZ1-${month}-2026.xlsx`, makeXlsx(items, month)); showToast(`${month} 2026 kayıtları Excel’e aktarıldı.`); }

  document.addEventListener("click", (event) => {
    const multiToggle = event.target.closest("[data-multi-toggle]");
    if (multiToggle) {
      state.openMultiFilter = state.openMultiFilter === multiToggle.dataset.multiToggle ? null : multiToggle.dataset.multiToggle;
      render();
      return;
    }
    const multiOption = event.target.closest("[data-multi-option]");
    if (multiOption) {
      const filter = multiOption.closest("[data-multi-filter]");
      const key = filter?.dataset.multiFilter;
      const checkbox = multiOption.querySelector("input");
      if (key && checkbox) {
        const selected = selectedFilterValues(state[key]);
        state[key] = checkbox.checked ? [...new Set([...selected, checkbox.value])] : selected.filter((value) => value !== checkbox.value);
        state.openMultiFilter = key;
        render();
      }
      return;
    }
    if (!event.target.closest("[data-multi-filter]") && state.openMultiFilter) {
      state.openMultiFilter = null;
    }
    const viewButton = event.target.closest("[data-view]"); if (viewButton) { navigate(viewButton.dataset.view); return; }
    const tab = event.target.closest("[data-sales-tab]"); if (tab) { state.salesTab = tab.dataset.salesTab; render(); return; }
    const action = event.target.closest("[data-action]"); if (!action) return;
    const type = action.dataset.action;
    if (type === "add-sale") saleModal();
    if (type === "edit-sale") saleModal(findSale(action.dataset.id));
    if (type === "save-sale") {
      const formElement = document.getElementById("saleForm");
      if (!formElement) return;
      if (typeof formElement.reportValidity === "function" && !formElement.reportValidity()) return;
      const form = new FormData(formElement);
      saveSale(form);
      closeModal();
      render();
      showToast(form.get("id") ? "Satış güncellendi." : "Yeni satış eklendi.");
    }
    if (type === "delete-sale") { const id = action.dataset.id; if (!confirm("Bu satış kaydı silinsin mi?")) return; if (baseData.sales.some((item) => item.id === id)) saveStorage("faz1_deleted", [...getDeleted(), id]); else saveStorage("faz1_custom", getCustom().filter((item) => item.id !== id)); render(); showToast("Satış kaydı silindi."); }
    if (type === "close-modal") closeModal();
    if (type === "export-csv") exportCsv();
    if (type === "export-json") exportJson();
    if (type === "export-monthly-xlsx") exportMonthlyXlsx();
    if (type === "clear-local") { if (!confirm("Tüm yerel düzenleme, silme ve yeni kayıtlar sıfırlansın mı?")) return; ["faz1_overrides", "faz1_deleted", "faz1_custom"].forEach((key) => { memoryStorage.delete(key); try { localStorage.removeItem(key); } catch { /* storage may be blocked */ } }); window.pushCloudState?.(cloudState()); render(); showToast("Yerel ve bulut değişiklikleri sıfırlandı."); }
  });
  document.addEventListener("change", (event) => { const filter = event.target.closest("[data-filter]"); if (!filter) return; const key = filter.dataset.filter; if (key === "month") state.month = filter.value; if (key === "category") state.category = filter.value; if (key === "brand") state.brand = filter.value; if (key === "sort") state.sort = filter.value; if (key === "startDate") state.startDate = filter.value; if (key === "endDate") state.endDate = filter.value; if ((key === "startDate" || key === "endDate") && filter.value) state.month = "all"; render(); });
  document.addEventListener("input", (event) => { const filter = event.target.closest('[data-filter="search"]'); if (!filter) return; state.search = filter.value; if (state.view === "sales" && state.salesTab === "transactions") { const panel = appView.querySelector(".panel"); if (panel) panel.innerHTML = salesTable(filteredSales()); } });
  document.addEventListener("submit", (event) => { if (event.target.id !== "saleForm") return; event.preventDefault(); const form = new FormData(event.target); saveSale(form); closeModal(); render(); showToast(form.get("id") ? "Satış güncellendi." : "Yeni satış eklendi."); });
  document.getElementById("mobileMenu").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
  document.getElementById("quickAdd").addEventListener("click", saleModal);
  modalBackdrop.addEventListener("click", (event) => { if (event.target === modalBackdrop) closeModal(); });
  window.__FAZ1 = { makeXlsx, allSales, monthlySummary };
  window.getFAZ1CloudState = cloudState;
  window.applyFAZ1CloudState = (state) => {
    if (!state || typeof state !== "object") return;
    applyingRemoteState = true;
    const values = {
      faz1_overrides: state.overrides && typeof state.overrides === "object" ? state.overrides : {},
      faz1_deleted: Array.isArray(state.deleted) ? state.deleted : [],
      faz1_custom: Array.isArray(state.custom) ? state.custom : [],
    };
    Object.entries(values).forEach(([key, value]) => {
      memoryStorage.set(key, value);
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* in-memory fallback */ }
    });
    applyingRemoteState = false;
    render();
  };
  render();
})();
