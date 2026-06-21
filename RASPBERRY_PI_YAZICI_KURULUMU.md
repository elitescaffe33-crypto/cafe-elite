# Raspberry Pi 5 yazici kurulumu

Bu kurulum Raspberry Pi 5 1GB cihazini CAFE ELITE siparis yazdirma merkezi yapmak icindir.

## Gerekli parcalar

- Raspberry Pi 5 1GB
- Resmi veya kaliteli USB-C guc adaptoru
- 16GB veya 32GB microSD kart
- Ethernet kablosu
- POSSAFE / CV2 yazici
- Yazici kagidi

## 1. Raspberry Pi OS kur

1. Bilgisayara Raspberry Pi Imager kur.
2. microSD karti bilgisayara tak.
3. Raspberry Pi OS Lite 64-bit sec.
4. Ayarlarda sunlari yap:
   - Hostname: `cafe-printer`
   - Username: `pi`
   - Password: guclu bir sifre
   - SSH: enabled
   - Wi-Fi kullanacaksan Wi-Fi adi ve sifresini gir
5. Karti yazdir.

Ethernet kullanacaksan Wi-Fi sart degil. Ethernet daha guvenilir.

## 2. Yazici IP adresini bul

1. Yaziciyi elektrikle calistir.
2. Yaziciyi Ethernet kablosu ile modem/router'a bagla.
3. Kagit takili olsun.
4. Yaziciyi kapat.
5. FEED tusuna basili tutarken yaziciyi ac.
6. Self-test fisi cikinca IP adresini bul.

Ornek:

```text
IP Address: 192.168.1.44
```

Bu adres `PRINTER_HOST` olacak.

## 3. Pi'ye baglan

Windows PowerShell veya Terminal ac:

```bash
ssh pi@cafe-printer.local
```

Baglanmazsa modem/router ekranindan Pi'nin IP adresini bulup soyle gir:

```bash
ssh pi@192.168.1.50
```

## 4. Node.js kur

Pi icinde:

```bash
sudo apt update
sudo apt install -y nodejs npm git
node --version
npm --version
```

## 5. Site dosyalarini Pi'ye al

En kolay yol GitHub'dan almak:

```bash
cd /home/pi
git clone https://github.com/elitescaffe33-crypto/cafe-elite.git
cd cafe-elite
npm install
```

Repo zaten varsa:

```bash
cd /home/pi/cafe-elite
git pull
npm install
```

## 6. Yazici ayar dosyasini olustur

```bash
cd /home/pi/cafe-elite
cp .printer-env.example .printer-env
nano .printer-env
```

Su degerleri doldur:

```text
CAFE_ELITE_ADMIN_PASSWORD=admin panel sifren
PRINTER_HOST=yazicinin IP adresi
```

Kaydetmek icin:

- `Ctrl + O`
- Enter
- `Ctrl + X`

## 7. Manuel test

```bash
npm run printer
```

Siteden test siparisi ver. Fis basiliyorsa sistem dogru calisiyor.

Durdurmak icin:

```bash
Ctrl + C
```

## 8. Otomatik baslatma

```bash
sudo cp cafe-elite-printer.service /etc/systemd/system/cafe-elite-printer.service
sudo systemctl daemon-reload
sudo systemctl enable cafe-elite-printer
sudo systemctl start cafe-elite-printer
```

Durumu kontrol et:

```bash
sudo systemctl status cafe-elite-printer
```

Canli log:

```bash
journalctl -u cafe-elite-printer -f
```

## Gunluk kullanim

- Pi acik kalacak.
- Yazici acik kalacak.
- Pi ve yazici ayni modeme/router'a bagli olacak.
- Siteye siparis gelince Pi yaklasik 8 saniye icinde fisi basacak.

## Sorun cikarsa

Yaziciya baglanti testi:

```bash
nc -vz YAZICI_IP_ADRESI 9100
```

Servisi yeniden baslat:

```bash
sudo systemctl restart cafe-elite-printer
```

Son loglari gor:

```bash
journalctl -u cafe-elite-printer -n 80
```
