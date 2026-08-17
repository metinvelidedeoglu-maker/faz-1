(() => {
  const IMPORT_ID = "august-invoices-2026-08-17-v1";
  const invoices = [
    ["2026-08-21","BOUGEN MAKİNE KİMYA SANAYİ TİCARET LİMİTED ŞİRKETİ","Metin&Erman",39500],
    ["2026-08-21","LARES TEKNOLOJİ VE YAPI MÜHENDİSLİĞİ SANAYİ TİCARET LİMİTED ŞİRKETİ","Metin&Erman",51380],
    ["2026-08-18","ERDEM GRUP ELEKTRIK INSAAT TAAHHÜT SANAYI VE TICARET LIMITED SIRKETI","Metin&Erman",72000],
    ["2026-08-18","AYNES ELEKTRİK AYTEKİN YILMAZ","Metin&Erman",51720],
    ["2026-08-17","ERKON KONSANTRE SANAYİ VE TİCARET ANONİM ŞİRKETİ","Metin&Erman",379895.04],
    ["2026-08-17","GÜNSA GAZ-MAKİNA-ELEKTRİK-OTOMOTİV GIDA SANAYİ VE TİCARET LİMİTED ŞİRKETİ","Metin&Erman",28500],
    ["2026-08-17","KAR MONTAJ BAKIM ONARIM ELEK.MÜH.İNŞ.SAN.TİC. LTD. ŞTİ.","Metin&Erman",82108.44],
    ["2026-08-14","OPC OTOMASYON VE KONTROL SİSTEMLERİ SANAYİ TİCARET LİMİTED ŞİRKETİ","Metin&Erman",20784],
    ["2026-08-14","ACIBADEM LABMED SAĞLIK HİZMETLERİ ANONİM ŞİRKETİ","Metin&Erman",31104],
    ["2026-08-14","SAMUR ELEKTRİK VE ELEKTRONİK SAN. ve TİC. LTD. ŞTİ.","Metin&Erman",125025.60],
    ["2026-08-12","HAZİRAN ELEKTRİK SANAYİ VE TİCARET ANONİM ŞİRKETİ","Metin",225000],
    ["2026-08-11","OPC OTOMASYON VE KONTROL SİSTEMLERİ SANAYİ TİCARET LİMİTED ŞİRKETİ","Metin&Erman",79680],
    ["2026-08-11","HAKAN DURAN","Metin&Erman",3880],
    ["2026-08-11","HALİL İBRAHİM SEVEN","Metin&Erman",30000],
    ["2026-08-11","THP Makine Sanayi ve Tic. LTD. ŞTİ","Metin&Erman",38950],
    ["2026-08-11","Haldun Sucuka","Metin&Erman",7878],
    ["2026-08-11","Nusret Aydınlı","Metin&Erman",3350],
    ["2026-08-11","LABORMED LABORATUAR MALZEMELERİ TİC.LTD.ŞTİ.","Metin&Erman",34722],
    ["2026-08-10","YALITEM İNŞAAT İZOLASYON VE TİCARET LİMİTED ŞİRKETİ","Metin",5250],
    ["2026-08-07","MUKAS MÜHENDİSLİK MİMARLIK İNŞAAT A.Ş.","Metin",9500],
    ["2026-08-05","ENTEK ELEKTRİK ÜRETİMİ A.Ş.","Metin&Erman",11860.28],
    ["2026-08-05","OPC OTOMASYON VE KONTROL SİSTEMLERİ SANAYİ TİCARET LİMİTED ŞİRKETİ","Metin&Erman",151440],
    ["2026-08-04","DRY YANGIN GÜVENLİK SİSTEMLERİ SANAYİ VE TİCARET LİMİTED ŞİRKETİ","Metin&Erman",45900],
    ["2026-08-04","ALFA ANALİTİK LABORATUVAR CİHAZLARI TİC. LTD. ŞTİ.","Metin&Erman",34080],
    ["2026-08-04","Üniterm Laboratuvar Cihazları İth. ve İhr. - Erhan Zengin","Metin&Erman",64185],
    ["2026-08-04","YALITEM İNŞAAT İZOLASYON VE TİCARET LİMİTED ŞİRKETİ","Metin",7425],
    ["2026-08-04","KORDSA TEKNİK TEKSTİL ANONİM ŞİRKETİ","Metin",98616.06],
    ["2026-08-03","Ersan Şahin CAN","Metin&Erman",3900],
    ["2026-08-03","UFUK KAZAK","Metin&Erman",4895],
    ["2026-08-03","ZONE ELEKTRİK MAKİNE MÜHENDİSLİK İMALAT SAN. VE TİC. LTD. ŞTİ.","Metin&Erman",51840],
    ["2026-08-03","KM MAKİNE MÜHENDİSLİK İNŞAAT TAAHHÜT İMALAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ","Metin&Erman",4530],
    ["2026-08-03","ASTOR ENERJİ ANONİM ŞİRKETİ","Metin",246400],
    ["2026-08-03","ALBAYRAK DOĞA ELEK.İNŞ.SAN. VE TİC.AŞ. EMBİ ELEKTRİK MONTAJ BAKIM İNŞ. VE TİC LTD.ŞTİ İŞ ORTAKLIĞI","Metin",318000]
  ].map(([invoiceDate, customer, category, salesAmount]) => ({ invoiceDate, customer, category, salesAmount }));

  const amountKey = (value) => Math.round(Number(value || 0) * 100);
  const isSameInvoice = (sale, row) =>
    String(sale?.invoiceDate || "") === row.invoiceDate &&
    amountKey(sale?.salesAmount) === amountKey(row.salesAmount);

  const toSale = (row) => ({
    id: `invoice-import-${row.invoiceDate}-${amountKey(row.salesAmount)}`,
    invoiceDate: row.invoiceDate,
    customer: row.customer,
    category: row.category,
    brand: "",
    salesAmount: row.salesAmount,
    salesDueDays: null,
    purchaseAmount: null,
    purchaseDueDays: null,
    importBatch: IMPORT_ID,
  });

  const originalApply = window.applyFAZ1CloudState;
  if (typeof originalApply !== "function") return;

  window.applyFAZ1CloudState = (remoteState) => {
    originalApply(remoteState);

    const existing = window.__FAZ1?.allSales?.() || [];
    const missing = invoices.filter((row) => !existing.some((sale) => isSameInvoice(sale, row)));
    if (!missing.length) return;

    const current = window.getFAZ1CloudState?.() || { overrides: {}, deleted: [], custom: [] };
    const next = {
      overrides: current.overrides && typeof current.overrides === "object" ? current.overrides : {},
      deleted: Array.isArray(current.deleted) ? current.deleted : [],
      custom: [
        ...(Array.isArray(current.custom) ? current.custom : []),
        ...missing.map(toSale),
      ],
    };

    originalApply(next);
    queueMicrotask(() => window.pushCloudState?.(next));
  };
})();
