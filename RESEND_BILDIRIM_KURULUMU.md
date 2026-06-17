# Resend ile Stripe siparis bildirimi

Stripe odemesi tamamlandiginda site once Resend ile e-posta gondermeyi dener.
Resend ayari yoksa eski SMTP/FormSubmit yedekleri calismaya devam eder.

## Render Environment Variables

Render > cafe-elite > Environment bolumune sunlari ekle:

```text
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=CAFE ELITE Orders <onboarding@resend.dev>
ORDER_NOTIFICATION_EMAIL=elitescaffe33@gmail.com
```

Not: Resend hesabinda domain dogrulamadan once `onboarding@resend.dev` test icin
kullanilabilir. Daha sonra kendi domain mail adresin dogrulanirsa
`orders@senindomainin.com` gibi bir adres kullanmak daha profesyonel olur.

## Basarili log

Test odemeden sonra Render Logs icinde sunu gormelisin:

```text
Sending paid order email to elitescaffe33@gmail.com using Resend
Paid order Resend email sent to elitescaffe33@gmail.com
```

