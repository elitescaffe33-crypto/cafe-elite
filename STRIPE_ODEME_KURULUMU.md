# Stripe dinamik odeme kurulumu

Site artik Stripe Payment Link yerine dinamik Stripe Checkout kullanacak sekilde hazirlandi.

Bu daha iyi yoldur cunku:

- Musteri tutari kendi girmez.
- Sepetteki urunler Stripe'a otomatik gider.
- Toplam tutar sunucu tarafinda hesaplanir.
- Kart bilgilerini sadece Stripe toplar.
- Gizli Stripe anahtari tarayiciya gonderilmez.

## Gerekli Stripe bilgisi

Stripe Dashboard icinden iki bilgi gerekir:

- `Secret key`
- `Webhook signing secret`

Genelde su formatta olurlar:

```text
sk_test_...
whsec_...
```

Canli odeme icin daha sonra `sk_live_...` kullanilir.

Bu anahtarlar `script.js` icine yazilmaz. Sadece sunucu ortam degiskeni olarak kullanilir.

## Lokal test

PowerShell'de proje klasorunde:

```powershell
$env:STRIPE_SECRET_KEY="sk_test_buraya_kendi_keyini_yaz"
$env:STRIPE_WEBHOOK_SECRET="whsec_buraya_webhook_secret_yaz"
$env:ORDER_NOTIFICATION_EMAIL="elitescaffe33@gmail.com"
node server.mjs
```

Sonra siteyi su adresten ac:

```text
http://127.0.0.1:5820
```

`file:///.../index.html` olarak acarsan online odeme calismaz. Backend gerekir.

## Yayina alma

Bu sistem statik hosting ile yetinmez. Node backend calistirabilen bir hosting gerekir:

- Render
- Railway
- Fly.io
- Vercel serverless uyarlamasi

En basit backend hosting seceneklerinden biri Render veya Railway olur.

Hosting panelinde su environment variable eklenir:

```text
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
ORDER_NOTIFICATION_EMAIL=elitescaffe33@gmail.com
```

Test asamasinda:

```text
STRIPE_SECRET_KEY=sk_test_...
```

## Stripe webhook ayari

Site yayina alindiktan sonra Stripe Dashboard icinde webhook eklenir.

Endpoint URL:

```text
https://SENIN-SITE-ADRESIN/api/stripe-webhook
```

Event olarak en az sunu sec:

```text
checkout.session.completed
```

Stripe endpoint'i olusturduktan sonra sana `Signing secret` verir. Bu deger `whsec_...` ile baslar.

Hosting ayarlarina bunu ekle:

```text
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Siparisleri nerede gorurum?

Odeme basarili olunca Stripe Dashboard'da Payment olarak gorunur.

Odeme basarili olunca Stripe webhook calisir ve siparis ozeti su adrese e-posta olarak gonderilir:

```text
elitescaffe33@gmail.com
```

FormSubmit ilk bildirimde onay maili isteyebilir. O mail onaylandiktan sonra bildirimler normal gelir.

Stripe Checkout session metadata icinde:

- Musteri adi
- Telefon
- Collection time
- Notlar
- CAFE ELITE website kaynagi

Urunler de Stripe line items olarak gorunur.

Bir sonraki profesyonel adim, Stripe webhook ekleyip odeme basarili oldugunda siparisi otomatik e-postaya veya admin paneline dusurmektir.
Bu adim su anda eklendi. Daha sonra istersen siparisleri admin paneline kaydeden veritabani sistemi de eklenebilir.
