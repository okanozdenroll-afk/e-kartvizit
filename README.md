# e-Kartvizit + Saha Satış Defteri — Okan Özden (KVK Enerji / Ultra Enerji Ege Bölge)

- **`index.html`** — QR ile açılan herkese açık dijital kartvizit. “Rehbere Kaydet” `okan-ozden.vcf` dosyasını indirir.
  Adres: https://okanozdenroll-afk.github.io/e-kartvizit/ (GitHub Pages, `main` dalı, kök klasör)
- **`okan-ozden.vcf`** — rehber kartı (numara, şirket, e-posta, not: “Orta Gerilim / Schneider Electric, Astor, Öznur Kablo”, fotoğraf).
  Değiştirmek için `scripts/make_vcf.py` düzenlenip çalıştırılır.
- **`img/qr-kartvizit.png`** — basılı kartvizit / yaka kartı için QR (ortasında fotoğraf).
- **`defter.html`** — Saha Satış Defteri: ziyaret notları (sesli not), kimle görüşüldü, proje, sonraki adım,
  “Bu hafta kimi aramalıyım?” listesi, müşteri geçmişi, yedek al/yükle. Veriler yalnız cihazda (localStorage `kvk_defter_v1`).
- **`android/`** — APK kabuğu (`com.kvk.kartvizit`, “Saha Defteri”). Derleme: `cd android && KS_PASS=… bash build.sh 1.0 1`
  → `dist/Saha_Defteri.apk`. İmza anahtarı kvk-teklif deposundaki `keystore/ogteklif.jks` (bu depoya konmaz).
