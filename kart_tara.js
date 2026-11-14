/* Kartvizit tarama: fotoğraftaki yazıyı okur (Tesseract, internetsiz) ve alanlara ayırır. */
(function () {
  'use strict';
  var BASE = new URL('ocr/', location.href).href;
  var workerP = null;

  function loadLib() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = BASE + 'tesseract.min.js';
      s.onload = ok; s.onerror = function () { fail(new Error('Okuma modülü yüklenemedi')); };
      document.head.appendChild(s);
    });
  }

  var progressCb = null;
  function getWorker() {
    if (workerP) return workerP;
    workerP = loadLib().then(function () {
      return Tesseract.createWorker(['tur', 'eng'], 1, {
        workerPath: BASE + 'worker.min.js',
        corePath: BASE,
        langPath: BASE,
        gzip: !window.Android,  // APK paketi .gz dosyalarını açılmış olarak saklar
        cacheMethod: 'none',
        logger: function (m) { if (progressCb && m && typeof m.progress === 'number') progressCb(m.status, m.progress); }
      });
    }).catch(function (e) { workerP = null; throw e; });
    return workerP;
  }

  /* fotoğrafı küçült, griye çevir, kontrastı artır */
  function prep(dataUrl) {
    return new Promise(function (ok, fail) {
      var im = new Image();
      im.onload = function () {
        var max = 2000, w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        if (Math.max(w, h) < 1000) k = 1000 / Math.max(w, h);
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        var x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
        var d = x.getImageData(0, 0, c.width, c.height), p = d.data, i, g, lo = 255, hi = 0, hist = new Array(256).fill(0);
        for (i = 0; i < p.length; i += 4) { g = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0; p[i] = g; hist[g]++; }
        var n = p.length / 4, acc = 0;
        for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.02) { lo = i; break; } }
        acc = 0;
        for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.02) { hi = i; break; } }
        var r = Math.max(1, hi - lo);
        for (i = 0; i < p.length; i += 4) { g = Math.max(0, Math.min(255, ((p[i] - lo) * 255 / r) | 0)); p[i] = p[i + 1] = p[i + 2] = g; }
        x.putImageData(d, 0, 0);
        ok(c);
      };
      im.onerror = function () { fail(new Error('Fotoğraf açılamadı')); };
      im.src = dataUrl;
    });
  }

  /* kayıt için küçük kopya */
  function thumb(dataUrl, max) {
    return new Promise(function (ok) {
      var im = new Image();
      im.onload = function () {
        var k = Math.min(1, (max || 640) / Math.max(im.naturalWidth, im.naturalHeight));
        var c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/jpeg', 0.62));
      };
      im.onerror = function () { ok(''); };
      im.src = dataUrl;
    });
  }

  /* ---- metni alanlara ayırma ---- */
  var TR = { lower: function (s) { return s.toLocaleLowerCase('tr'); } };
  function titleCase(s) {
    return s.split(/\s+/).map(function (w) {
      if (!w) return w;
      if (/^[A-ZÇĞİÖŞÜ]{2,}$/.test(w) || /^[a-zçğıöşü]/.test(w)) { var l = TR.lower(w); return l.charAt(0).toLocaleUpperCase('tr') + l.slice(1); }
      return w;
    }).join(' ');
  }
  var RX_TITLE = /(müdür|mudur|mühendis|muhendis|engineer|manager|director|direktör|direktor|uzman|sorumlu|\bşef\b|koordinat|başkan|baskan|genel\s|satış|satis|satın|satin|sales|purchas|yönetici|yonetici|owner|kurucu|founder|\bceo\b|\bcfo\b|\bcto\b|\bcoo\b|partner|ortak|teknisyen|tekniker|asistan|assistant|danışman|danisman|specialist|consultant|representative|temsilci|planlama|şantiye|santiye|executive|officer|head of|lead|mimar|architect|elektrik teknikeri|muhasebe|finans)/i;
  var RX_CO = /(a\.?\s?ş\.?(?![a-zçğıöşü])|\ba\.s\.|\bltd|şti|\bsti\b|\bsan\.|\btic\.|\binc\b|gmbh|holding|grup\b|group|enerji|elektrik|elektronik|mühendislik|muhendislik|inşaat|insaat|yapı\b|otomasyon|teknoloji|endüstri|endustri|sanayi|ticaret|limited|\bcorp|\bco\.|solar|power|energy|electric|kablo|pano|müşavirlik|musavirlik|proje\b|taahhüt|taahhut)/i;
  var RX_ADDR = /(\bmah\b|mah\.|mahalle|\bcad\b|cad\.|caddesi|\bsok\b|sok\.|sokak|\bsk\b|sk\.|bulvar|blv|\bno\s*[:.]|\bkat\s*[:.]?\s*\d|\bd[:.]\s*\d|osb|organize|sitesi|plaza|apt|\bpk\b|posta|\/\s*[A-ZÇĞİÖŞÜ][a-zçğıöşü]+$)/i;
  var RX_FAX = /(fax|faks)/i;
  var CITIES = ['İzmir', 'Manisa', 'Aydın', 'Denizli', 'Muğla', 'Uşak', 'Afyonkarahisar', 'Afyon', 'Kütahya', 'Balıkesir', 'Çanakkale', 'İstanbul', 'Ankara', 'Bursa', 'Kocaeli', 'Konya', 'Kayseri', 'Antalya', 'Eskişehir', 'Sakarya', 'Tekirdağ', 'Adana', 'Mersin', 'Gaziantep', 'Isparta', 'Burdur', 'Bilecik', 'Kırklareli', 'Edirne', 'Hatay', 'Samsun', 'Trabzon', 'Erzurum', 'Van', 'Diyarbakır', 'Şanlıurfa', 'Malatya', 'Elazığ', 'Sivas', 'Yozgat', 'Kırşehir', 'Nevşehir', 'Aksaray', 'Niğde', 'Karaman', 'Zonguldak', 'Bolu', 'Düzce', 'Yalova', 'Kahramanmaraş', 'Osmaniye', 'Çorum', 'Amasya', 'Tokat', 'Ordu', 'Giresun', 'Rize', 'Kars'];
  var FREE_MAIL = /^(gmail|hotmail|yahoo|outlook|icloud|yandex|mynet|windowslive|live|msn|protonmail)\./i;

  function asc(x) { return TR.lower(String(x || '')).replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/i̇/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u'); }
  function fmtPhone(d) {
    if (d.indexOf('90') === 0 && d.length === 12) d = d.slice(2);
    else if (d[0] === '0' && d.length === 11) d = d.slice(1);
    if (d.length === 10) return '+90 ' + d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6, 8) + ' ' + d.slice(8);
    return '+' + d;
  }

  function parse(text, lineInfo) {
    var raw = String(text || '').replace(/\r/g, '');
    var lines = raw.split('\n').map(function (l) { return l.replace(/[|_~«»•·]+/g, ' ').replace(/\s+/g, ' ').trim(); }).filter(function (l) { return l.length > 1; });
    var heights = {};
    (lineInfo || []).forEach(function (l) { var t = String(l.text || '').replace(/[|_~«»•·]+/g, ' ').replace(/\s+/g, ' ').trim(); if (t) heights[t] = l.h; });
    var out = { name: '', company: '', title: '', phone: '', phone2: '', email: '', web: '', city: '', address: '' };
    var used = {};

    // e-posta (OCR bazen @ çevresine boşluk koyar)
    var joined = lines.join('\n').replace(/\s*@\s*/g, '@');
    var em = joined.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/);
    if (em) out.email = em[0].replace(/\.$/, '').toLowerCase();

    // web
    lines.forEach(function (l, i) {
      if (out.web) return;
      var m = l.replace(/\s/g, '').match(/((https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.(com\.tr|net\.tr|org\.tr|gen\.tr|com|net|org|tr|biz|info|io|eu|de|co))(\/[^\s]*)?/i);
      if (m && l.indexOf('@') < 0 && (/www|http/i.test(l) || /\.(com|tr|net)/i.test(l))) { out.web = m[1].toLowerCase().replace(/^https?:\/\//, ''); used[i] = 1; }
    });
    if (!out.web && out.email && !FREE_MAIL.test(out.email.split('@')[1])) out.web = 'www.' + out.email.split('@')[1];

    // telefonlar
    var phones = [];
    lines.forEach(function (l, i) {
      if (l.indexOf('@') >= 0) return;
      var isFax = RX_FAX.test(l);
      var ms = l.match(/\+?\(?\d[\d\s().\/-]{8,}\d/g) || [];
      ms.forEach(function (m) {
        var d = m.replace(/\D/g, '');
        if (d.length < 10 || d.length > 13) return;
        if (!(d.length === 10 || (d.length === 11 && d[0] === '0') || (d.length === 12 && d.indexOf('90') === 0))) return;
        var core = d.slice(-10);
        if (!/^[2-5]/.test(core)) return;
        used[i] = 1;
        if (isFax && ms.length === 1) return;
        phones.push({ f: fmtPhone(d), mobile: core[0] === '5', gsm: /(gsm|cep|mobil|mobile|m\s*[:.])/i.test(l) });
      });
    });
    phones.sort(function (a, b) { return (b.mobile + b.gsm) - (a.mobile + a.gsm); });
    var seen = {};
    phones = phones.filter(function (p) { if (seen[p.f]) return false; seen[p.f] = 1; return true; });
    if (phones[0]) out.phone = phones[0].f;
    if (phones[1]) out.phone2 = phones[1].f;

    // adres ve şehir
    var addr = [];
    lines.forEach(function (l, i) {
      if (used[i] || l.indexOf('@') >= 0) return;
      if (RX_ADDR.test(l) || (/\d/.test(l) && /[a-zçğıöşü]{3,}/i.test(l) && !RX_TITLE.test(l) && l.split(' ').length >= 3)) { addr.push(l); used[i] = 1; }
    });
    out.address = addr.join(', ');
    var cityHay = addr.join(' ') + ' ' + lines.join(' ');
    for (var c = 0; c < CITIES.length; c++) {
      var re = new RegExp('(^|[^a-z])' + asc(CITIES[c]) + '($|[^a-z])');
      if (re.test(asc(addr.join(' '))) || (!addr.length && re.test(asc(cityHay)))) { out.city = CITIES[c] === 'Afyon' ? 'Afyonkarahisar' : CITIES[c]; break; }
    }

    // unvan
    lines.forEach(function (l, i) {
      if (out.title || used[i] || /\d|@/.test(l)) return;
      if (RX_TITLE.test(l) && l.length < 70) { out.title = titleCase(l); used[i] = 1; }
    });

    // firma
    var dom0 = out.email ? asc(out.email.split('@')[1].split('.')[0]) : '';
    var coBest = -1, coIdx = -1;
    lines.forEach(function (l, i) {
      if (used[i] || l.indexOf('@') >= 0 || /\d{3}/.test(l) || !RX_CO.test(l) || l.length >= 80) return;
      var w = l.split(' '), sc = 10;
      if (/(a\.?\s?ş\.?|ltd|şti|limited|inc|gmbh)/i.test(l)) sc += 15;
      sc -= 8 * w.filter(function (x) { return x.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '').length <= 2 && !/^(a\.?ş\.?|ve|&)$/i.test(x); }).length;
      if (dom0 && !FREE_MAIL.test(out.email.split('@')[1])) w.forEach(function (x) { var a = asc(x).replace(/[^a-z]/g, ''); if (a.length > 2 && dom0.indexOf(a) >= 0) sc += 25; });
      if (sc > coBest) { coBest = sc; coIdx = i; }
    });
    if (coIdx >= 0) {
      var cw = lines[coIdx].split(' ');
      while (cw.length > 1 && cw[cw.length - 1].replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '').length <= 2 && !/^a\.?ş\.?$/i.test(cw[cw.length - 1])) cw.pop();
      out.company = cw.join(' '); used[coIdx] = 1;
    }
    if (!out.company && out.email) {
      var dom = out.email.split('@')[1];
      if (!FREE_MAIL.test(dom)) { var root = dom.split('.')[0]; out.company = root.charAt(0).toLocaleUpperCase('tr') + root.slice(1); }
    }

    // ad soyad: 2-4 kelime, rakamsız; büyük yazılan ve e-postayla eşleşen öne çıkar
    var local = out.email ? TR.lower(out.email.split('@')[0]).replace(/[^a-z]/g, ' ') : '';
    var best = null, bestScore = -1;
    lines.forEach(function (l, i) {
      if (used[i] || /[\d@:\/]/.test(l)) return;
      var w = l.split(' ').filter(Boolean);
      if (w.length < 2 || w.length > 4) return;
      if (!w.every(function (x) { return /^[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû.'-]+$/.test(x) && x.replace(/[.'-]/g, '').length >= 2; })) return;
      if (!w.every(function (x) { return /^[A-ZÇĞİÖŞÜÂÎÛ]/.test(x); })) return;
      var score = (heights[l] || 20);
      var ascii = TR.lower(l).replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
      w.forEach(function (x) {
        var a = TR.lower(x).replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
        if (local && a.length > 2 && local.indexOf(a) >= 0) score += 60;
      });
      if (w.length <= 3) score += 8;
      if (RX_CO.test(l)) score -= 50;
      if (score > bestScore) { bestScore = score; best = l; }
    });
    if (best) out.name = titleCase(best);
    else if (local && local.indexOf(' ') > 0) out.name = titleCase(local);

    if (out.company && out.company === out.name) out.company = '';
    return out;
  }

  function scan(dataUrl, onProgress) {
    progressCb = onProgress || null;
    return Promise.all([getWorker(), prep(dataUrl)]).then(function (r) {
      return r[0].recognize(r[1], {}, { text: true, blocks: true });
    }).then(function (res) {
      var d = res.data || {}, lines = [];
      (d.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { lines.push({ text: l.text, h: l.bbox ? (l.bbox.y1 - l.bbox.y0) : 0 }); }); }); });
      return { fields: parse(d.text, lines), text: d.text || '' };
    });
  }

  /* VCF (web sürümünde "rehbere kaydet" için) */
  function vcf(c) {
    function e(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
    var parts = String(c.name || '').trim().split(/\s+/), last = parts.length > 1 ? parts.pop() : '', first = parts.join(' ');
    var L = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + e(last) + ';' + e(first) + ';;;', 'FN:' + e(c.name)];
    if (c.company) L.push('ORG:' + e(c.company));
    if (c.title) L.push('TITLE:' + e(c.title));
    if (c.phone) L.push('TEL;TYPE=CELL:' + c.phone.replace(/\s/g, ''));
    if (c.phone2) L.push('TEL;TYPE=WORK:' + c.phone2.replace(/\s/g, ''));
    if (c.email) L.push('EMAIL;TYPE=INTERNET:' + c.email);
    if (c.web) L.push('URL:' + c.web);
    if (c.address) L.push('ADR;TYPE=WORK:;;' + e(c.address) + ';' + e(c.city) + ';;;Türkiye');
    if (c.note) L.push('NOTE:' + e(c.note));
    L.push('END:VCARD');
    return L.join('\r\n') + '\r\n';
  }

  window.KT = { scan: scan, parse: parse, thumb: thumb, vcf: vcf, warm: function () { getWorker().catch(function () {}); } };
})();
