import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Supabase environment variables not set. Make sure VITE_SUPABASE_URL and VITE_SUPABASE_KEY are configured in Vercel.")
}

// 🔐 "Энэ төхөөрөмж дээр сануулах" — нэвтрэх дэлгэц signIn-ээс ӨМНӨ localStorage.cl_remember = "1"/"0" бичнэ.
//   "1" (default): session localStorage-д → браузер хаагаад ч нэвтэрсэн хэвээр.
//   "0": session sessionStorage-д → таб/браузер хаахад гарна.
//   Уншихдаа хоёуланг нь шалгана (аль нэгэнд байвал session сэргэнэ).
const safe = (fn, fb = null) => { try { return fn() } catch { return fb } }
const rememberOn = () => safe(() => localStorage.getItem("cl_remember") !== "0", true)
const clAuthStorage = {
  getItem: (k) => safe(() => sessionStorage.getItem(k)) ?? safe(() => localStorage.getItem(k)),
  setItem: (k, v) => {
    const keep = rememberOn() ? localStorage : sessionStorage
    const drop = rememberOn() ? sessionStorage : localStorage
    safe(() => keep.setItem(k, v)); safe(() => drop.removeItem(k))
  },
  removeItem: (k) => { safe(() => localStorage.removeItem(k)); safe(() => sessionStorage.removeItem(k)) },
}

export const supabase = createClient(SUPABASE_URL || "https://placeholder.supabase.co", SUPABASE_KEY || "placeholder", {
  auth: { persistSession: true, autoRefreshToken: true, storage: clAuthStorage },
})

export const isConfigured = !!(SUPABASE_URL && SUPABASE_KEY)
