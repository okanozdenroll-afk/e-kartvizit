# e-Kartvizit — proje kuralları
Kullanıcı: Okan Özden (satış mühendisi, yazılımcı değil). Türkçe, kısa ve sade konuş; teknik terim kullanma.
- Kart bilgileri: +90 554 568 08 35 · okan.ozden@ultraenerji.com.tr · ORG “KVK Enerji / Ultra Enerji Ege Bölge” ·
  NOTE “Orta Gerilim / Schneider Electric, Astor, Öznur Kablo”. Değişirse index.html + scripts/make_vcf.py birlikte güncellenir.
- Kart adresi (QR içeriği) `https://okanozdenroll-afk.github.io/e-kartvizit/` — değiştirme, basılı QR'lar bozulur.
- localStorage anahtarı `kvk_defter_v1` adını değiştirme (kullanıcı notları kaybolur).
- APK: `cd android && KS_PASS=<kvk-teklif/app/build.sh'teki şifre> bash build.sh X.Y N` (N her sürümde +1). İmza anahtarı
  kvk-teklif deposunda; bu depoya .jks koyma (depo herkese açık olabilir).
- Değişiklikten sonra Playwright ile defter.html ve index.html'i 400px genişlikte dene (yatay kayma olmasın).
