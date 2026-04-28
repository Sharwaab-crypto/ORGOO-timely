# Hours · Цаг бүртгэлийн систем

Геофенс, цагийн хуваарь, хүсэлтийн систем бүхий цаг бүртгэлийн вэб апп.

## Технологи
- **React** + **Vite** (frontend)
- **Supabase** (database + auth + realtime)
- **Tailwind CSS** (UI)
- **Vercel** (hosting)

## Тохируулах алхмууд

### 1. Supabase бэлдэх
1. [supabase.com](https://supabase.com) дээр данс үүсгэнэ
2. New project үүсгэнэ
3. SQL Editor нээгээд `setup.sql`-н агуулгыг буулгаж Run дарна
4. Authentication → Users → "Add user" дарж админ үүсгэнэ
5. Үүсгэсэн админ user-ийн UUID-г SQL Editor-т буулгана:
   ```sql
   insert into public.profiles (id, role, name)
   values ('UUID-БУУЛГА', 'admin', 'Таны нэр');
   ```
6. **Connect** товч → Project URL болон anon key хуулна

### 2. GitHub дээр upload хийх
1. GitHub дээр New repository үүсгэнэ
2. "uploading an existing file" дарж энэ хавтсын **бүх файлыг** drag-drop хийнэ
3. Commit changes дарна

### 3. Vercel дээр deploy
1. [vercel.com](https://vercel.com) дээр GitHub-аар нэвтэрнэ
2. "Add New Project" → үүссэн repository сонгоно
3. **Environment Variables** хэсэгт нэмнэ:
   - `VITE_SUPABASE_URL` = Supabase Project URL
   - `VITE_SUPABASE_KEY` = Supabase anon key
4. Deploy дарна

### 4. Ашиглах
- Vercel-ээс өгсөн URL-аар орно (жишээ: `your-app.vercel.app`)
- Админ имэйл/нууц үгээрээ нэвтэрнэ
- Ажилтан нэмэх → имэйл/нууц үг өгч роль тохируулна
- Ажилтнууд тэр URL-аар орж өөрсдийн дансаар нэвтэрнэ
