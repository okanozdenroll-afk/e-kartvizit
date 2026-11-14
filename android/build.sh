#!/bin/bash
# Saha Defteri APK derleme (Gradle yok). Kullanım: cd android && bash build.sh 1.0 1
# İmza: kvk-teklif deposundaki anahtar (../../kvk-teklif/keystore/ogteklif.jks). Şifre KS_PASS ortam değişkeninden.
set -e
VN=${1:-1.0}; VC=${2:-1}
KS=${KS:-../../kvk-teklif/keystore/ogteklif.jks}
[ -f "$KS" ] || { echo "İmza anahtarı bulunamadı: $KS"; exit 1; }
[ -n "$KS_PASS" ] || { echo "KS_PASS boş (şifre kvk-teklif/app/build.sh içinde)"; exit 1; }
AJ=/usr/lib/android-sdk/platforms/android-23/android.jar
rm -rf gen obj bin assets && mkdir -p gen obj bin assets ../dist
cp ../defter.html ../index.html ../migrate.html ../qrcode.js ../kart_tara.js ../okan-ozden.vcf assets/ && cp -r ../img ../sunumlar ../ocr assets/
aapt package -f -m -J gen -M AndroidManifest.xml -S res -I $AJ
javac -nowarn -source 8 -target 8 -bootclasspath $AJ -cp $AJ -d obj $(find src gen -name '*.java') 2>&1 | grep -v 'warning' || true
dalvik-exchange --dex --min-sdk-version=21 --output=bin/classes.dex obj
aapt package -f -M AndroidManifest.xml -S res -A assets -I $AJ --min-sdk-version 21 --target-sdk-version 35 --version-code $VC --version-name $VN -F bin/app.unsigned.apk
(cd bin && aapt add app.unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 bin/app.unsigned.apk bin/app.aligned.apk
apksigner sign --ks "$KS" --ks-pass env:KS_PASS --ks-key-alias ogteklif --out ../dist/Saha_Defteri.apk bin/app.aligned.apk
apksigner verify ../dist/Saha_Defteri.apk && echo "TAMAM: dist/Saha_Defteri.apk ($VN)"
