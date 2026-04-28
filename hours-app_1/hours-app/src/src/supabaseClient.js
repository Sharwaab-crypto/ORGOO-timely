import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Supabase environment variables not set. Make sure VITE_SUPABASE_URL and VITE_SUPABASE_KEY are configured in Vercel.")
}

export const supabase = createClient(SUPABASE_URL || "https://placeholder.supabase.co", SUPABASE_KEY || "placeholder", {
  auth: { persistSession: true, autoRefreshToken: true },
})

export const isConfigured = !!(SUPABASE_URL && SUPABASE_KEY)
