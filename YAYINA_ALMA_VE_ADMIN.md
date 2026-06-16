# CAFE ELITE siteyi internete alma ve admin olma

## Su anki durum

Bu site su anda bilgisayardaki dosyalardan calisiyor:

`file:///C:/Users/Mazlum/Documents/Codex/2026-06-16/g-ze-ho-gelen-bir-cafe/index.html`

Bu bir web sitesi taslagi olarak tamamdir, fakat henuz internette yayinlanmis degildir. Bu yuzden:

- Google'da veya internet tarayicisinda arayinca bulunmaz.
- FormSubmit siparis formunu kabul etmez.
- Musteriler disaridan siteye giremez.

Siparis sisteminin calismasi icin site `https://...` ile acilan gercek bir web adresinde yayinlanmalidir.

## Siparis bildirimleri

Siparisler su e-posta adresine gidecek sekilde ayarlandi:

`elitescaffe33@gmail.com`

FormSubmit ilk sipariste bu adrese aktivasyon/onay maili gonderebilir. O mail bir kere onaylandiktan sonra siparis bildirimleri gelmeye baslar.

## Site internette nasil bulunur?

Siteyi internette bulmak icin iki sey gerekir:

1. Hosting: Site dosyalarinin internette yayinlandigi yer.
2. Domain: Musterilerin yazacagi adres. Ornek: `cafeeliteleominster.co.uk`

Domain olmadan da hosting size gecici bir link verir. Ornek olarak:

`https://cafe-elite-leominster.netlify.app`

Ama profesyonel gorunmesi icin kendi domaininizi baglamak daha iyidir.

## En basit yayinlama yolu

Bu site statik oldugu icin Netlify, Vercel veya GitHub Pages gibi servislerde yayinlanabilir.

En kolay yol:

1. Bir hosting hesabi acilir.
2. Bu klasordeki dosyalar yuklenir:
   - `index.html`
   - `styles.css`
   - `script.js`
   - `assets/`
3. Hosting size bir internet adresi verir.
4. Site o adresten acilir.
5. FormSubmit onay maili `elitescaffe33@gmail.com` adresinden onaylanir.
6. Siparisler e-postaya gelmeye baslar.

## Admin olmak ne demek?

Su anki site statik HTML/CSS/JS sitesidir. Yani fiyat ve menu degisiklikleri dosyadan yapilir:

`script.js`

Bu basit ve hizlidir ama gercek bir admin paneli degildir.

Gercek admin paneli istenirse sunlar gerekir:

- Admin giris ekrani
- Sifreli kullanici hesabi
- Menu/fiyat duzenleme paneli
- Siparisleri listeleyen panel
- Veritabani veya CMS

Bu durumda siteyi statik siteden kucuk bir web uygulamasina cevirmek gerekir.

## Onerilen iki yol

### Yol 1: Hizli ve ucuz

- Site statik kalir.
- Siparisler `elitescaffe33@gmail.com` adresine gelir.
- Fiyat ve menu degisiklikleri `script.js` dosyasindan yapilir.
- Hosting hesabi sizde olur, yani sitenin sahibi/admini siz olursunuz.

### Yol 2: Gercek admin paneli

- Admin paneli eklenir.
- Siz sifreyle girip fiyatlari ve menu urunlerini degistirirsiniz.
- Siparisleri panelde gorursunuz.
- Bunun icin backend/veritabani gerekir.

Bu yol daha profesyoneldir ama daha fazla kurulum ister.

