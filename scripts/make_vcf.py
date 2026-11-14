#!/usr/bin/env python3
"""okan-ozden.vcf dosyasını üretir (fotoğraf gömülü). Bilgi değişirse burayı düzenleyip çalıştırın."""
import base64, io, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
img = Image.open(os.path.join(ROOT, 'img', 'okan.jpg')).convert('RGB').resize((200, 200), Image.LANCZOS)
buf = io.BytesIO(); img.save(buf, 'JPEG', quality=72)
photo = base64.b64encode(buf.getvalue()).decode()

def fold(line):
    b = line.encode('utf-8'); out = []; first = True
    while b:
        n = 75 if first else 74
        cut = min(n, len(b))
        while cut < len(b) and (b[cut] & 0xC0) == 0x80: cut -= 1   # UTF-8 harfini bölme
        out.append(('' if first else ' ') + b[:cut].decode('utf-8')); b = b[cut:]; first = False
    return '\r\n'.join(out)

lines = [
    'BEGIN:VCARD', 'VERSION:3.0',
    'N:Özden;Okan;;;', 'FN:Okan Özden',
    'ORG:KVK Enerji / Ultra Enerji Ege Bölge',
    'TITLE:Ege Bölge Satış Mühendisi / Aegean Zone Sales Engineer',
    'TEL;TYPE=CELL,VOICE:+905545680835',
    'EMAIL;TYPE=INTERNET,WORK:okan.ozden@ultraenerji.com.tr',
    'URL:https://okanozdenroll-afk.github.io/e-kartvizit/',
    'ADR;TYPE=WORK:;;Muradiye Mah. 31. OSB Sok. No:1/E;Yunusemre;Manisa;;Türkiye',
    'NOTE:Orta Gerilim / Schneider Electric\\, Astor\\, Öznur Kablo',
    'PHOTO;ENCODING=b;TYPE=JPEG:' + photo,
    'END:VCARD',
]
with open(os.path.join(ROOT, 'okan-ozden.vcf'), 'w', encoding='utf-8', newline='') as f:
    f.write('\r\n'.join(fold(l) for l in lines) + '\r\n')
print('okan-ozden.vcf yazıldı')
