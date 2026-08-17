(() => {
  let scheduled = false;
  let salesMonthInitialized = false;
  let userChangedFilters = false;

  const money = (value) => new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Number(value) || 0);

  const compactMoney = (value) => {
    const amount = Number(value) || 0;
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(1).replace(".", ",")} M TL`;
    if (amount >= 1000) return `${Math.round(amount / 1000).toLocaleString("tr-TR")} B TL`;
    return money(amount);
  };

  const pct = (value) => `${((Number(value) || 0) * 100).toFixed(1).replace(".", ",")}%`;
  const sum = (items, key) => items.reduce((total, item) => total + (Number(item?.[key]) || 0), 0);

  function latestPeriod() {
    const rows = window.__FAZ1?.allSales?.() || [];
    const dated = rows
      .filter((item) => /^\d{4}-\d{2}-\d{2}/.test(String(item?.invoiceDate || "")))
      .sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate)));

    if (!dated.length) return null;

    const latestDate = String(dated[0].invoiceDate);
    const yearMonth = latestDate.slice(0, 7);
    const year = latestDate.slice(0, 4);
    const month = new Date(`${yearMonth}-01T12:00:00`).toLocaleDateString("tr-TR", { month: "long" });
    const label = month.charAt(0).toLocaleUpperCase("tr-TR") + month.slice(1);
    const items = rows.filter((item) => String(item?.invoiceDate || "").startsWith(yearMonth));
    const purchase = sum(items, "purchaseAmount");
    const gross = sum(items, "grossMarginAmount");

    return {
      month: label,
      year,
      items,
      sales: sum(items, "salesAmount"),
      purchase,
      gross,
      rate: purchase ? gross / purchase : 0,
      incomplete: items.filter((item) => item.salesAmount === null || item.purchaseAmount === null).length,
    };
  }

  function cloudReady() {
    const text = document.getElementById("saveStatus")?.textContent?.trim();
    return text === "Senkronize" || text === "Çevrimdışı kayıt";
  }

  function updateDashboard(period) {
    const root = document.getElementById("breadcrumbRoot")?.textContent?.trim();
    if (root !== "Genel Bakış") return;

    const heading = document.querySelector("#appView .page-heading p");
    if (heading) heading.textContent = `${period.month} ${period.year} · ${period.items.length} kayıt · açılış özeti son veri bulunan ayı gösterir.`;

    const kicker = document.querySelector("#appView .hero-kicker");
    if (kicker) kicker.textContent = `FAZ 1.xlsx · ${period.month} ${period.year}`;

    const heroValue = document.querySelector("#appView .hero-panel h2");
    if (heroValue) heroValue.textContent = `${compactMoney(period.sales)} satış hacmi`;

    const heroGross = document.querySelector("#appView .hero-meta strong");
    if (heroGross) heroGross.textContent = compactMoney(period.gross);

    const cards = [...document.querySelectorAll("#appView > .metric-grid .metric-card")];
    const values = [
      [`${period.month} satış`, compactMoney(period.sales), `${period.items.length} işlem kaydı`],
      [`${period.month} alış`, compactMoney(period.purchase), "tedarik maliyeti"],
      [`${period.month} brüt marj`, compactMoney(period.gross), `${pct(period.rate)} alış üstü`],
      ["Eksik kayıt", String(period.incomplete), "tutarı tamamlanmamış kayıt"],
    ];

    cards.slice(0, 4).forEach((card, index) => {
      const [label, value, note] = values[index] || [];
      const labelEl = card.querySelector(".metric-top > span:first-child");
      const valueEl = card.querySelector(".metric-value");
      const noteEl = card.querySelector(".metric-note");
      if (labelEl) labelEl.textContent = label;
      if (valueEl) valueEl.textContent = value;
      if (noteEl) noteEl.textContent = note;
    });
  }

  function initializeSalesMonth(period) {
    if (salesMonthInitialized || userChangedFilters) return;
    const select = document.querySelector('#appView select[data-filter="month"]');
    if (!select) return;

    const option = [...select.options].find((item) => item.value === period.month);
    if (!option) return;

    salesMonthInitialized = true;
    if (select.value !== period.month) {
      select.value = period.month;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function refresh() {
    scheduled = false;
    if (!cloudReady()) return;
    const period = latestPeriod();
    if (!period) return;
    updateDashboard(period);
    initializeSalesMonth(period);
  }

  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(refresh);
  }

  document.addEventListener("change", (event) => {
    if (event.isTrusted && event.target.closest?.("[data-filter]")) userChangedFilters = true;
  }, true);

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  scheduleRefresh();
})();
