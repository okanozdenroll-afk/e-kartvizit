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
  /* ayarlar (deneme ölçümleri için dışarıdan değiştirilebilir) */
  var CFG = { langs: ['tur', 'eng'], langPath: BASE, passes: ['g3', 'g11', 'b3'], maxSide: 2400, sharpen: 1.6 };
  function getWorker() {
    if (workerP) return workerP;
    workerP = loadLib().then(function () {
      return Tesseract.createWorker(CFG.langs, 1, {
        workerPath: BASE + 'worker.min.js',
        corePath: BASE,
        langPath: CFG.langPath,
        gzip: !window.Android,  // APK paketi .gz dosyalarını açılmış olarak saklar
        cacheMethod: 'none',
        logger: function (m) { if (progressCb && m && typeof m.progress === 'number') progressCb(m.status, m.progress); }
      });
    }).then(function (w) {
      return w.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' }).then(function () { return w; });
    }).catch(function (e) { workerP = null; throw e; });
    return workerP;
  }

  function loadImg(src) {
    return new Promise(function (ok, fail) {
      var im = new Image();
      im.onload = function () { ok(im); };
      im.onerror = function () { fail(new Error('Fotoğraf açılamadı')); };
      im.src = src;
    });
  }

  /* eğim bulma: yazı satırları yatay olduğunda satır profili en keskin olur */
  function skewAngle(im) {
    var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, k = 700 / Math.max(w, h);
    var W = Math.round(w * k), H = Math.round(h * k), c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'); x.drawImage(im, 0, 0, W, H);
    var p = x.getImageData(0, 0, W, H).data, g = new Float32Array(W * H), i, y, xx;
    for (i = 0; i < W * H; i++) g[i] = p[i * 4] * 0.299 + p[i * 4 + 1] * 0.587 + p[i * 4 + 2] * 0.114;
    // kenar noktaları (yatay ve dikey fark yüksek olanlar)
    var pts = [];
    for (y = 1; y < H - 1; y++) for (xx = 1; xx < W - 1; xx++) {
      var gy = Math.abs(g[(y + 1) * W + xx] - g[(y - 1) * W + xx]);
      if (gy > 60) pts.push(xx, y);
    }
    if (pts.length < 200) return 0;
    var best = 0, bestS = -1, bins = new Float64Array(Math.ceil(Math.hypot(W, H)) * 2 + 4), off = Math.ceil(Math.hypot(W, H)) + 2;
    for (var a = -15; a <= 15; a += 0.5) {
      var r = a * Math.PI / 180, sn = Math.sin(r), cs = Math.cos(r);
      bins.fill(0);
      for (i = 0; i < pts.length; i += 2) bins[Math.round(-pts[i] * sn + pts[i + 1] * cs) + off]++;
      var sc = 0; for (i = 0; i < bins.length; i++) sc += bins[i] * bins[i];
      if (sc > bestS) { bestS = sc; best = a; }
    }
    return Math.abs(best) < 0.6 ? 0 : best;
  }

  /* gri ton + ışık farkını giderme + kontrast; koyu zeminli kartı tersine çevirir */
  function grayPlanes(im) {
    var max = CFG.maxSide, w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, k = Math.min(1, max / Math.max(w, h));
    if (Math.max(w, h) < 1800) k = 1800 / Math.max(w, h);
    var ang = CFG.deskew === false ? 0 : skewAngle(im), rad = -ang * Math.PI / 180;
    var w0 = w * k, h0 = h * k;
    var W = Math.round(Math.abs(w0 * Math.cos(rad)) + Math.abs(h0 * Math.sin(rad))), H = Math.round(Math.abs(w0 * Math.sin(rad)) + Math.abs(h0 * Math.cos(rad)));
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.fillStyle = '#808080'; x.fillRect(0, 0, W, H);
    x.translate(W / 2, H / 2); x.rotate(rad); x.drawImage(im, -w0 / 2, -h0 / 2, w0, h0); x.setTransform(1, 0, 0, 1, 0, 0);
    var d = x.getImageData(0, 0, W, H), p = d.data, n = W * H, g = new Float32Array(n), i;
    for (i = 0; i < n; i++) g[i] = p[i * 4] * 0.299 + p[i * 4 + 1] * 0.587 + p[i * 4 + 2] * 0.114;
    // koyu zemin mi? (merkez bölgenin ortancası)
    var sample = [];
    for (var yy = Math.floor(H * 0.25); yy < H * 0.75; yy += 7) for (var xx = Math.floor(W * 0.25); xx < W * 0.75; xx += 7) sample.push(g[yy * W + xx]);
    sample.sort(function (a, b) { return a - b; });
    var med = sample[sample.length >> 1] || 255;
    if (med < 110) for (i = 0; i < n; i++) g[i] = 255 - g[i];
    // netleştirme (bulanık fotoğraflardaki küçük yazılar için)
    if (CFG.sharpen !== 0) {
      var sh = CFG.sharpen || 0.8, bl = new Float32Array(n), yy2, xx2;
      for (yy2 = 1; yy2 < H - 1; yy2++) for (xx2 = 1; xx2 < W - 1; xx2++) {
        var q = yy2 * W + xx2;
        bl[q] = (g[q - W - 1] + 2 * g[q - W] + g[q - W + 1] + 2 * g[q - 1] + 4 * g[q] + 2 * g[q + 1] + g[q + W - 1] + 2 * g[q + W] + g[q + W + 1]) / 16;
      }
      for (yy2 = 1; yy2 < H - 1; yy2++) for (xx2 = 1; xx2 < W - 1; xx2++) { var q2 = yy2 * W + xx2; g[q2] = g[q2] + sh * (g[q2] - bl[q2]); }
    }
    // integral görüntü ile yerel ortalama (Sauvola benzeri eşikleme ve ışık düzeltme)
    var S = new Float64Array((W + 1) * (H + 1)), S2 = new Float64Array((W + 1) * (H + 1));
    for (var y = 0; y < H; y++) {
      var rs = 0, rs2 = 0;
      for (var x2 = 0; x2 < W; x2++) {
        var v = g[y * W + x2]; rs += v; rs2 += v * v;
        S[(y + 1) * (W + 1) + x2 + 1] = S[y * (W + 1) + x2 + 1] + rs;
        S2[(y + 1) * (W + 1) + x2 + 1] = S2[y * (W + 1) + x2 + 1] + rs2;
      }
    }
    var r = Math.max(15, Math.round(Math.min(W, H) / 30));
    var norm = new Uint8ClampedArray(n), bin = new Uint8ClampedArray(n);
    for (y = 0; y < H; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      for (x2 = 0; x2 < W; x2++) {
        var x0 = Math.max(0, x2 - r), x1 = Math.min(W, x2 + r + 1), cnt = (y1 - y0) * (x1 - x0);
        var a = (y1 * (W + 1) + x1), b = (y0 * (W + 1) + x1), cc = (y1 * (W + 1) + x0), dd = (y0 * (W + 1) + x0);
        var mean = (S[a] - S[b] - S[cc] + S[dd]) / cnt;
        var sd = Math.sqrt(Math.max(0, (S2[a] - S2[b] - S2[cc] + S2[dd]) / cnt - mean * mean));
        var v2 = g[y * W + x2];
        // ışık düzeltmesi: yerel parlaklığa göre normalle
        norm[y * W + x2] = Math.max(0, Math.min(255, 255 - (mean - v2) * 2.2 - 8));
        bin[y * W + x2] = v2 > mean * (1 + 0.2 * (sd / 128 - 1)) ? 255 : 0;
      }
    }
    function toCanvas(arr) {
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var cx = cv.getContext('2d'), id = cx.createImageData(W, H), q = id.data;
      for (var t = 0; t < n; t++) { q[t * 4] = q[t * 4 + 1] = q[t * 4 + 2] = arr[t]; q[t * 4 + 3] = 255; }
      cx.putImageData(id, 0, 0); return cv;
    }
    return { g: toCanvas(norm), b: toCanvas(bin) };
  }
  function prep(dataUrl) { return loadImg(dataUrl).then(grayPlanes); }

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
  var RX_STREET = /(\bmah\b|mah\.|mahalle|\bcad\b|cad\.|caddesi|\bsok\b|sok\.|sokak|\bsk\.|bulvar|blv\.|\bno\s*[:.]\s*\d|\bkat\s*[:.]?\s*\d|sitesi|plaza|\bapt\b)/i;
  /* e-posta adayları: OCR "@" işaretini ©, ®, & okuyabilir; nokta çevresine boşluk koyabilir */
  function emailCands(text) {
    var t = String(text || '').replace(/\r/g, '');
    var out = [];
    t.split('\n').forEach(function (l) {
      if (!/[@©®&]/.test(l)) return;
      var x = l.replace(/\s*[@©®]\s*/g, '@').replace(/([A-Za-z0-9])\s*&\s*([A-Za-z0-9-]+\s*\.)/g, '$1@$2')
        .replace(/([A-Za-z0-9])\s*\.\s+([A-Za-z0-9])/g, '$1.$2').replace(/@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\s+(com|net|org|tr|gov|edu)\b/gi, '@$1.$2')
        .replace(/[{}|]/g, 'i');
      var m = x.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) || [];
      m.forEach(function (e) { out.push(e.replace(/\.$/, '').replace(/^[._-]+/, '').toLowerCase()); });
    });
    return out;
  }
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
    var ec = emailCands(lines.join('\n'));
    if (ec.length) out.email = ec[0];
    // e-posta satırını başka alan sanmasın
    lines.forEach(function (l, i) { if (/[@©®]/.test(l) || (out.email && TR.lower(l).replace(/\s/g, '').indexOf(out.email.split('@')[1]) >= 0 && /[&@©®]/.test(l))) used[i] = 1; });

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
      if (RX_STREET.test(l) || (/\d/.test(l) && RX_ADDR.test(l)) || (/\d/.test(l) && /[a-zçğıöşü]{3,}/i.test(l) && !RX_TITLE.test(l) && l.split(' ').length >= 3)) { addr.push(l); used[i] = 1; }
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
      out.company = cw.join(' ').replace(/\.(?=[A-Za-zÇĞİÖŞÜçğıöşü]{2,})/g, '. '); used[coIdx] = 1;
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
    if (window.TRFIX) {
      ['name', 'title', 'company', 'address'].forEach(function (k) { if (out[k]) out[k] = TRFIX.fixText(out[k]); });
    }
    return out;
  }

  var PSM = { 3: '3', 11: '11', 6: '6' };
  function linesOf(d) {
    var out = [];
    (d.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) {
      var t = String(l.text || '').replace(/\s+/g, ' ').trim();
      if (t) out.push({ text: t, h: l.bbox ? (l.bbox.y1 - l.bbox.y0) : 0, y: l.bbox ? l.bbox.y0 : 0, conf: l.confidence || 0 });
    }); }); });
    return out;
  }
  function meanConf(d) {
    var s = 0, n = 0;
    (d.words || []).forEach(function (w) { var L = (w.text || '').length; if (L > 1) { s += (w.confidence || 0) * L; n += L; } });
    if (!n) (d.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (w) { var L = (w.text || '').length; if (L > 1) { s += (w.confidence || 0) * L; n += L; } }); }); }); });
    return n ? s / n : 0;
  }
  var KEYS = ['name', 'company', 'title', 'phone', 'email', 'web'];
  function garbage(t) {
    var letters = (t.match(/[A-Za-zÇĞİÖŞÜçğıöşü0-9@]/g) || []).length;
    return t.length < 3 || letters / t.length < 0.6;
  }

  /* birkaç farklı yöntemle oku, en güvenilir sonucu temel al, eksikleri diğerlerinden tamamla */
  function scan(dataUrl, onProgress) {
    progressCb = null;
    var passes = CFG.passes.slice(), results = [];
    return Promise.all([getWorker(), prep(dataUrl)]).then(function (r) {
      var w = r[0], planes = r[1], k = 0;
      function next() {
        if (k >= passes.length) return Promise.resolve();
        var code = passes[k], plane = code[0] === 'b' ? planes.b : planes.g, psm = code.slice(1);
        progressCb = function (st, p) { if (onProgress && st === 'recognizing text') onProgress(st, (k + p) / passes.length); };
        return w.setParameters({ tessedit_pageseg_mode: PSM[psm] || '3' })
          .then(function () { return w.recognize(plane, {}, { text: true, blocks: true }); })
          .then(function (res) {
            var d = res.data || {}, ls = linesOf(d);
            var f = parse(d.text, ls), filled = KEYS.filter(function (x) { return f[x]; }).length;
            results.push({ code: code, fields: f, text: d.text || '', lines: ls, conf: meanConf(d), score: meanConf(d) + filled * 8 });
            k++; return next();
          });
      }
      return next();
    }).then(function () {
      progressCb = null;
      results.sort(function (a, b) { return b.score - a.score; });
      var best = results[0], f = {};
      Object.keys(best.fields).forEach(function (x) { f[x] = best.fields[x]; });
      results.slice(1).forEach(function (r) { Object.keys(r.fields).forEach(function (x) { if (!f[x] && r.fields[x]) f[x] = r.fields[x]; }); });
      // e-posta: tüm okumalardaki adaylardan, isimle en uyumlu ve en sık olanı
      var cnt = {};
      results.forEach(function (r) { emailCands(r.text).forEach(function (e) { cnt[e] = (cnt[e] || 0) + 1; }); });
      var nm = f.name ? asc(f.name).split(/\s+/) : [];
      var cands = Object.keys(cnt).map(function (e) {
        var loc = e.split('@')[0].replace(/[^a-z]/g, ''), sc = cnt[e];
        if (nm.length) {
          var first = nm[0], last = nm[nm.length - 1];
          if (loc === first + last || loc === first[0] + last || loc === first || loc === last || loc === nm.join('')) sc += 4;
          else if (loc.indexOf(last) >= 0 || loc.indexOf(first) >= 0) sc += 1;
        }
        return { e: e, sc: sc };
      }).sort(function (a, b) { return b.sc - a.sc; });
      if (cands.length) f.email = cands[0].e;
      if (f.email && !f.web) { var dm = f.email.split('@')[1]; if (!FREE_MAIL.test(dm)) f.web = 'www.' + dm; }
      // seçim için satırlar: hepsinden, tekrarsız, düzgün olanlar
      var seen = {}, lines = [];
      results.forEach(function (r) { r.lines.forEach(function (l) {
        var t = window.TRFIX ? TRFIX.fixText(l.text) : l.text, dg = t.replace(/\D/g, '');
        var key = dg.length >= 9 ? 'tel' + dg.slice(-9) : asc(t).replace(/[^a-z0-9@]/g, '');
        if (garbage(t) || l.conf < 35 || seen[key] || key.length < 3) return;
        seen[key] = 1; lines.push(t);
      }); });
      return { fields: f, text: best.text, lines: lines.slice(0, 24), passes: results.map(function (r) { return r.code + ':' + Math.round(r.conf); }) };
    });
  }

  /* kırpma: fotoğraftaki dörtgeni (kartın köşeleri) düz bir dikdörtgene çevirir */
  function solve8(A, b) {
    var n = 8, i, j, k;
    for (i = 0; i < n; i++) A[i].push(b[i]);
    for (i = 0; i < n; i++) {
      var mx = i; for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[mx][i])) mx = j;
      var t = A[i]; A[i] = A[mx]; A[mx] = t;
      for (j = i + 1; j < n; j++) { var f = A[j][i] / A[i][i]; for (k = i; k <= n; k++) A[j][k] -= f * A[i][k]; }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) { var sm = A[i][n]; for (j = i + 1; j < n; j++) sm -= A[i][j] * x[j]; x[i] = sm / A[i][i]; }
    return x;
  }
  function warp(src, quad) {   // quad: [[x,y]x4] sol-üst, sağ-üst, sağ-alt, sol-alt (görüntü pikseli)
    return loadImg(src).then(function (im) {
      var d = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); };
      var W = Math.round(Math.max(d(quad[0], quad[1]), d(quad[3], quad[2]))), H = Math.round(Math.max(d(quad[0], quad[3]), d(quad[1], quad[2])));
      var k = Math.min(1, 2400 / Math.max(W, H)); W = Math.round(W * k); H = Math.round(H * k);
      var dst = [[0, 0], [W, 0], [W, H], [0, H]], A = [], b = [];
      for (var i = 0; i < 4; i++) {
        var x = dst[i][0], y = dst[i][1], u = quad[i][0], v = quad[i][1];
        A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
        A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
      }
      var h = solve8(A, b);
      var sc = document.createElement('canvas'); sc.width = im.naturalWidth; sc.height = im.naturalHeight;
      var sx = sc.getContext('2d'); sx.drawImage(im, 0, 0);
      var sp = sx.getImageData(0, 0, sc.width, sc.height).data, SW = sc.width, SH = sc.height;
      var oc = document.createElement('canvas'); oc.width = W; oc.height = H;
      var ox = oc.getContext('2d'), od = ox.createImageData(W, H), op = od.data;
      for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
        var den = h[6] * xx + h[7] * yy + 1, uu = (h[0] * xx + h[1] * yy + h[2]) / den, vv = (h[3] * xx + h[4] * yy + h[5]) / den;
        var ix = Math.min(SW - 1, Math.max(0, uu | 0)), iy = Math.min(SH - 1, Math.max(0, vv | 0)), si = (iy * SW + ix) * 4, di = (yy * W + xx) * 4;
        op[di] = sp[si]; op[di + 1] = sp[si + 1]; op[di + 2] = sp[si + 2]; op[di + 3] = 255;
      }
      ox.putImageData(od, 0, 0);
      return oc.toDataURL('image/jpeg', 0.92);
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

  window.KT = { cfg: CFG, scan: scan, warp: warp, loadImg: loadImg, parse: parse, thumb: thumb, vcf: vcf, warm: function () { getWorker().catch(function () {}); } };
})();
