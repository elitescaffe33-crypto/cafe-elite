# CAFE ELITE canli yayin adimlari

## En kolay yol: Render

Bu proje artik Node backend kullaniyor. Bu yuzden sadece HTML hosting yeterli degil.

Render uygun bir secenek:

https://render.com

## 1. Projeyi GitHub'a yukle

Render genelde GitHub repo uzerinden deploy eder.

Bu klasordeki dosyalar repo icinde olmalidir:

- `index.html`
- `styles.css`
- `script.js`
- `menu-data.mjs`
- `server.mjs`
- `success.html`
- `package.json`
- `render.yaml`
- `assets/`

## 2. Render'da yeni web service olustur

Render Dashboard:

1. `New`
2. `Web Service`
3. GitHub repo'yu sec
4. Runtime: `Node`
5. Start command:

   ```text
   npm start
   ```

`render.yaml` dosyasi eklendi, Render bunu otomatik de okuyabilir.

## 3. Environment variables ekle

Render servis ayarlarinda `Environment` bolumune gir.

Sunlari ekle:

```text
ORDER_NOTIFICATION_EMAIL=elitescaffe33@gmail.com
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Test asamasinda `sk_test_...` kullan.

Canliya gecince `sk_live_...` kullanilir.

Bu anahtarlari site dosyalarina yazma.

## 4. Stripe webhook ekle

Render sana su tarz bir adres verir:

```text
https://cafe-elite.onrender.com
```

Stripe Dashboard'da webhook endpoint ekle:

```text
https://cafe-elite.onrender.com/api/stripe-webhook
```

Event olarak sec:

```text
checkout.session.completed
```

Stripe sana `whsec_...` ile baslayan signing secret verir.

Bunu Render'da `STRIPE_WEBHOOK_SECRET` alanina ekle.

## 5. Test odemesi yap

Siteyi ac:

```text
https://cafe-elite.onrender.com
```

Sepete urun ekle, musteri bilgilerini gir, `Pay online with Stripe` butonuna bas.

Stripe test karti:

```text
4242 4242 4242 4242
```

Gelecek tarihli expiry ve herhangi bir CVC yaz.

Odeme basarili olursa:

- Stripe Dashboard'da payment gorunur.
- Site `success.html` sayfasina doner.
- Siparis bildirimi `elitescaffe33@gmail.com` adresine gider.

FormSubmit ilk kez kullaniliyorsa e-postadan onay isteyebilir.

