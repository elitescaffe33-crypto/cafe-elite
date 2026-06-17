# Site ayarlari

Site davranis ayarlari `site-settings.mjs` dosyasindadir.

## Acilis saatleri

Ornek:

```js
monday: { label: "Monday", open: "09:00", close: "16:00", lastOrder: "15:45" },
```

- `open`: cafenin acilis saati
- `close`: cafenin kapanis saati
- `lastOrder`: siteden alinacak son siparis saati

Saatleri 24 saat formatinda yaz:

```text
09:00
15:45
16:00
```

## Delivery ac/kapat

```js
services: {
  collection: true,
  delivery: false,
},
```

Delivery acmak icin:

```js
delivery: true
```

## Odeme secenekleri ac/kapat

```js
payments: {
  payOnCollection: true,
  stripe: true,
},
```

Pay on collection kapatmak icin:

```js
payOnCollection: false
```

Stripe online odeme kapatmak icin:

```js
stripe: false
```

