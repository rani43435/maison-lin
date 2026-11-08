# تشغيل المتجر — خطوة بخطوة

المتجر بيشتغل بدون إعداد كـ"ديمو". عشان يصير متجر حقيقي (أواعي من لوحة التحكم، طلبات ودفع) بتعمل هاي الخطوات مرة وحدة.
اللي بيعملها لازم يكون صاحب المتجر (حساباته باسمه).

## 1. Supabase (قاعدة البيانات)
1. افتح حساب على https://supabase.com واعمل **New project** (اسمه مثلاً `maison-lin`، المنطقة Frankfurt).
2. من القائمة **SQL Editor** → **New query** → الصق كل محتوى الملف `supabase/schema.sql` → **Run**.
3. من **Project Settings → API** انسخ:
   - **Project URL**
   - **anon public key**
   - **service_role key** (سري! ما بينحط بالموقع أبداً)
4. افتح الملف `js/config.js` على GitHub وحط الـ URL والـ anon key مكان الفراغات، واعمل Commit.

## 2. أول دخول للوحة التحكم
1. افتح `https://<الموقع>/admin.html` ← اكتب إيميلك ← **Email me a sign-in link** ← افتح الرابط من الإيميل.
2. الصفحة رح تعطيك سطر SQL جاهز (`insert into admins …`). الصقه بـ **SQL Editor** واعمل Run.
3. اعمل Reload — صرت أدمن. (بتقدر كمان تحط كلمة سر من Supabase → Authentication → Users.)

## 3. بناء الـ3D تلقائياً (GitHub)
لما تضيف قطعة من صورتين، GitHub بيبني الموديل لحاله (حوالي دقيقتين).
1. بـ GitHub: **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_URL` = الـ Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = الـ service_role key
2. اعمل توكن: https://github.com/settings/personal-access-tokens/new ← Repository access: بس هاد الـrepo ← Permissions: **Contents: Read and write** و **Actions: Read and write**. انسخه.

## 4. الدوال على Supabase (الدفع والبناء)
على كمبيوتر فيه Node: `npm i -g supabase` ثم بمجلد المشروع:
```
supabase login
supabase link --project-ref <ref من الـURL>
supabase functions deploy checkout
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy build-garment
supabase secrets set GH_REPO=<owner>/<repo> GH_TOKEN=<التوكن من خطوة 3>
```

## 5. Stripe (الدفع)
1. افتح حساب على https://stripe.com (باسم صاحب المتجر وحسابه البنكي).
2. **Developers → API keys** ← انسخ الـ **Secret key** (بالبداية `sk_test_…` للتجربة).
3. `supabase secrets set STRIPE_SECRET_KEY=sk_test_…`
4. **Developers → Webhooks → Add endpoint**:
   - URL: `https://<ref>.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`
   - انسخ الـ **Signing secret** (`whsec_…`) ← `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…`
5. جرّب طلب بكرت التجربة `4242 4242 4242 4242` (أي تاريخ مستقبلي وأي CVC). الطلب لازم يبين بـ /admin → Orders كـ **paid**.
6. لما كل إشي مزبوط: بدّل لـ `sk_live_…` وعيد خطوة الـwebhook بوضع Live.

## الشغل اليومي (لوحة التحكم /admin.html)
- **Add piece**: صورة قدام + صورة ورا + اسم وسعر ← بعد دقيقتين القطعة على الحبل وبالمتجر وبالـAR.
- **Products**: تغيير سعر/اسم/وصف/مخزون، إخفاء أو حذف، إعادة بناء الـ3D.
- **Orders**: الطلبات المدفوعة ← بتطلبها من المورّد ← بتحط رقم التتبع وبتعمل **shipped**.
- **Settings**: اسم المتجر، نصوص الصفحة الرئيسية والشريط الفوقاني، الألوان، التوصيل، أكواد الخصم.

## بيع المتجر أو تسليمه لحدا
- GitHub: Settings → **Transfer ownership** للـrepo.
- Supabase: Project Settings → **Transfer project** لمنظمة الشخص الجديد.
- Stripe: الشخص الجديد بيفتح حسابه وبيحط مفتاحه (`supabase secrets set STRIPE_SECRET_KEY=…`).

## تذكير قانوني (ألمانيا/الاتحاد الأوروبي)
متجر حقيقي بده: Impressum، Datenschutzerklärung، AGB، Widerrufsbelehrung (حق الإرجاع 14 يوم)، وتسجيل Gewerbe. وما بتبيع صور أو تصاميم ماركات ثانية بدون إذن.
