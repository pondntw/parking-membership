# ระบบจัดการที่จอดรถสำหรับสมาชิก

เว็บแอปสำหรับเจ้าหน้าที่ จัดการสมาชิกและรถ, โซนและช่องจอด, แพ็กเกจและสิทธิ์, การสมัครและต่ออายุ, บันทึกเวลาเข้า–ออก, ค่าบริการและการชำระเงิน, และประวัติการเข้าใช้

- หน้าเว็บ: React + Vite (deploy บน Vercel)
- ฐานข้อมูลและการล็อกอิน: Supabase (Postgres + Auth)
- กฎธุรกิจอยู่ในฐานข้อมูล ([supabase/migrations/](supabase/migrations/)) เบราว์เซอร์แก้เวลาหรือยอดเงินเองไม่ได้

## ติดตั้งครั้งแรก

ต้องใช้ Node.js 22 ขึ้นไป

### 1. สร้างฐานข้อมูล

1. สร้างโปรเจกต์ที่ [supabase.com](https://supabase.com) เลือก region Singapore
2. ติดตั้งแพ็กเกจ แล้วส่ง schema ขึ้นไป (`<project-ref>` คือรหัสในลิงก์ของโปรเจกต์)

   ```sh
   npm install
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

3. ที่ **Authentication → Sign In / Providers** ปิด **Allow new users to sign up**

### 2. สร้างบัญชีเจ้าหน้าที่

มีบัญชีใน Supabase Auth อย่างเดียวยังเข้าใช้ไม่ได้ ต้องเพิ่มในตาราง `staff` ด้วย

1. ที่ **Authentication → Users** กด **Add user** แล้วตั้งอีเมลและรหัสผ่าน
2. รันคำสั่งนี้ใน **SQL Editor** โดยแก้อีเมลและชื่อ

   ```sql
   insert into public.staff (user_id, full_name)
   select id, 'ชื่อเจ้าหน้าที่' from auth.users where email = 'staff@example.com';
   ```

เจ้าหน้าที่คนถัดไปก็เพิ่มด้วยวิธีเดียวกัน ส่วนการถอนสิทธิ์ให้ลบแถวนั้นออกจาก `staff`

### 3. รันในเครื่อง

```sh
cp .env.example .env.local   # ใส่ URL และ publishable key จาก Project Settings > API Keys
npm run dev
```

ใช้ publishable key เท่านั้น ห้ามใส่ secret key ในตัวแปรที่ขึ้นต้นด้วย `VITE_` เพราะค่าเหล่านั้นจะถูกฝังในหน้าเว็บ

### ข้อมูลตัวอย่าง (ไม่บังคับ)

ถ้าต้องการข้อมูลสมมติไว้เดโม ให้วาง [supabase/seed.sql](supabase/seed.sql) ใน SQL Editor บนฐานข้อมูลที่ยังว่าง

## Deploy บน Vercel

ตั้งค่า Environment Variables ของโปรเจกต์ แล้ว deploy ใหม่ เพราะค่าเหล่านี้ถูกฝังตอน build

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

เมื่อเชื่อม GitHub repo แล้ว ทุกการ push เข้า `main` จะ deploy อัตโนมัติ

## แก้ฐานข้อมูลภายหลัง

เพิ่มไฟล์ใหม่ใน `supabase/migrations/` ห้ามแก้ไฟล์เก่าที่ push ไปแล้ว จากนั้นรัน `npx supabase db push`

ถ้าเพิ่มตารางหรือฟังก์ชันใหม่ ต้องเปิด RLS และกำหนดสิทธิ์เอง ดูตัวอย่างใน `20261102000002_security.sql` และ `20261102000003_functions.sql`

## ทดสอบ

```sh
npm test              # ฐานข้อมูล กฎธุรกิจ และสิทธิ์ บน PGlite ไม่ต้องต่อ Supabase
npm run test:e2e      # ทดสอบผ่าน Chrome ตาม E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD ใน .env.local
```

`test:e2e` เขียนข้อมูลจริงที่ชื่อขึ้นต้นด้วย `E2E` และลบจากเว็บไม่ได้ จึงควรรันกับโปรเจกต์ที่ยังไม่มีข้อมูลใช้งานจริง

## กฎการคิดค่าบริการ

- แพ็กเกจกำหนดชั่วโมงจอดต่อรอบ (เว้นว่าง = ไม่จำกัด) และอัตราค่าจอดส่วนเกินต่อชั่วโมง
- ค่าบริการ = (นาทีที่เกินโควตา + นาทีที่จอดเลยวันหมดอายุ) ปัดขึ้นเป็นชั่วโมง × อัตราส่วนเกิน
- การจอดแต่ละครั้งนับโควตาของรอบสมาชิกที่ใช้ตอนรถเข้า
- ถ้าต่ออายุระหว่างที่รถยังจอดอยู่ ช่วงนั้นไม่คิดเป็นเวลาหลังหมดอายุ
- ราคาและโควตาของรอบสมาชิกถูกเก็บไว้ตอนซื้อ แก้แพ็กเกจภายหลังจะไม่กระทบรอบเดิม
