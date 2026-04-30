import React, { useState, useEffect, useMemo } from "react";
import {
  Plus, Play, Square, Trash2, X, Users, Calendar, MapPin, Edit3,
  AlertCircle, CheckCircle2, Loader2, Crosshair, LogOut, Lock,
  ClipboardCheck, Clock, Inbox, FileText, Send,
  ShieldCheck, User as UserIcon, Eye, EyeOff,
  Download, FileSpreadsheet, Filter, BarChart3, TrendingUp, TrendingDown,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { supabase, isConfigured } from "./supabaseClient";

// VAPID public key (Push Notifications)
// Энэ түлхүүрийг үүсгэж .env эсвэл шууд энд оруулна
// Үүсгэх: https://vapidkeys.com эсвэл `npx web-push generate-vapid-keys`
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

// Helper: VAPID түлхүүрийг Uint8Array болгох
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ─────────── constants ───────────
const DAY_KEYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_LABELS = { SU: "Ня", MO: "Да", TU: "Мя", WE: "Лх", TH: "Пү", FR: "Ба", SA: "Бя" };
const DAY_FULL = { SU: "Ням", MO: "Даваа", TU: "Мягмар", WE: "Лхагва", TH: "Пүрэв", FR: "Баасан", SA: "Бямба" };
const RADII = [25, 50, 100, 250, 500, 1000];

// ─────────── helpers ───────────
const getLocation = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
    (err) => {
      const msg = err.code === 1 ? "Байршил ашиглах зөвшөөрөл хэрэгтэй"
                : err.code === 2 ? "Байршил тодорхойлогдсонгүй"
                : err.code === 3 ? "Байршил авах хугацаа дууссан"
                : err.message || "Байршил авч чадсангүй";
      reject(new Error(msg));
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
});

const distanceMeters = (a, b) => {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.sin(dLng/2)**2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(x));
};

const fmtDist = (m) => (m < 1000 ? `${Math.round(m)}m` : `${(m/1000).toFixed(2)}km`);
const fmtCoord = (n) => (typeof n === "number" ? n.toFixed(5) : "—");
const fmtClock = (ms) => {
  const t = Math.max(0, Math.floor(ms/1000));
  const h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = t%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
};
const fmtHours = (ms) => (ms/3600000).toFixed(2);
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDate = (ts) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtFullDate = (ts) => new Date(ts).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); };
const startOfWeek = () => { const x = new Date(); x.setDate(x.getDate() - x.getDay()); x.setHours(0,0,0,0); return x.getTime(); };

const parseTime = (str) => { const [h, m] = (str || "00:00").split(":").map(Number); return { h, m }; };
const setTimeOnDate = (d, hhmm) => { const x = new Date(d); const { h, m } = parseTime(hhmm); x.setHours(h, m, 0, 0); return x.getTime(); };

const EARLY_ARRIVAL_BUFFER_MS = 2 * 60 * 60 * 1000; // 2 цаг — эрт ирэх хязгаар
const DAILY_HOUR_LIMIT_MS = 9 * 60 * 60 * 1000; // 9 цаг — өдрийн дээд лимит

// Сэшний нийт хугацааг өдрийн лимитэд тааруулах
// startMs, endMs хоёр өгөгдвөл ms-ийн зөрүүг буцаана (лимиттэй)
const sessionDurationMs = (startMs, endMs) => {
  const raw = endMs - startMs;
  return Math.min(raw, DAILY_HOUR_LIMIT_MS);
};

// Цалин тооцох
const calcPay = (durationMs, hourlyRate) => {
  return (durationMs / 3600000) * (hourlyRate || 0);
};

// Уян хатан байрны цаг шалгах: ирэх боломжтой эсэх
const checkFlexibleArrival = (site, when = new Date()) => {
  if (!site?.is_flexible) return { ok: true };
  if (!site.arrival_window_start || !site.arrival_window_end) return { ok: true };
  const start = setTimeOnDate(when, site.arrival_window_start);
  const end = setTimeOnDate(when, site.arrival_window_end);
  if (when.getTime() < start) {
    return { ok: false, reason: `Ирэх цаг ${site.arrival_window_start}-аас эхэлнэ` };
  }
  if (when.getTime() > end) {
    return { ok: false, reason: `Ирэх хугацаа дууссан (${site.arrival_window_end}). Эрт явах хүсэлт явуулах эсвэл маргааш дахин ирээрэй` };
  }
  return { ok: true };
};

// Уян хатан байранд ажилласан end time тооцоолох (ирсэн цагаас N цагийн дараа)
const flexibleSessionEnd = (site, startMs) => {
  if (!site?.is_flexible || !site.shift_hours) return null;
  return startMs + site.shift_hours * 3600000;
};

const checkSchedule = (profile, when = new Date()) => {
  if (!profile?.schedule_days?.length) return { ok: true, reason: null };
  const dayKey = DAY_KEYS[when.getDay()];
  if (!profile.schedule_days.includes(dayKey)) {
    return { ok: false, reason: `Өнөөдөр (${DAY_FULL[dayKey]}) ажлын өдөр биш` };
  }
  const start = setTimeOnDate(when, profile.schedule_start);
  const end = setTimeOnDate(when, profile.schedule_end);
  if (when.getTime() < start - EARLY_ARRIVAL_BUFFER_MS) {
    return { ok: false, reason: `Ажил эхлэхээс хэт эрт байна. ${profile.schedule_start} цагаас 2 цагийн өмнөх хүртэл цаг бүртгүүлэх боломжтой` };
  }
  if (when.getTime() > end) return { ok: false, reason: `Ээлж ${profile.schedule_end} цагт дууссан` };
  return { ok: true, reason: null };
};

const capSessionEnd = (profile, endTime) => {
  if (!profile?.schedule_days?.length) return endTime;
  const d = new Date(endTime);
  if (!profile.schedule_days.includes(DAY_KEYS[d.getDay()])) return endTime;
  return Math.min(endTime, setTimeOnDate(d, profile.schedule_end));
};
const capSessionStart = (profile, startTime) => {
  if (!profile?.schedule_days?.length) return startTime;
  const d = new Date(startTime);
  if (!profile.schedule_days.includes(DAY_KEYS[d.getDay()])) return startTime;
  const scheduledStart = setTimeOnDate(d, profile.schedule_start);
  // Хэрэв 2 цаг буферийн дотор эрт ирсэн бол жинхэнэ цагаар тоолно
  if (startTime >= scheduledStart - EARLY_ARRIVAL_BUFFER_MS && startTime < scheduledStart) {
    return startTime;
  }
  return Math.max(startTime, scheduledStart);
};

const hasSite = (p) => p?.site_lat != null && p?.site_lng != null;
const siteOf = (p) => ({ lat: p.site_lat, lng: p.site_lng, radius: p.site_radius || 100, label: p.site_label });

// ─────────── design tokens ───────────
const T = {
  // Background — мягхан градиент дэвсгэр
  bg: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 50%, #fef3ec 100%)",
  bgSolid: "#f8f6ff",
  // Glassmorphism surfaces
  surface: "rgba(255, 255, 255, 0.65)",
  surfaceStrong: "rgba(255, 255, 255, 0.85)",
  surfaceAlt: "rgba(255, 255, 255, 0.45)",
  surfaceGlass: "rgba(255, 255, 255, 0.5)",
  // Text
  ink: "#1e1b4b", inkSoft: "#312e81",
  muted: "#6b7280", mutedSoft: "#9ca3af",
  // Borders
  border: "rgba(255, 255, 255, 0.6)",
  borderSoft: "rgba(99, 102, 241, 0.1)",
  borderStrong: "rgba(99, 102, 241, 0.2)",
  // Accent — нил ягаан/индиго
  highlight: "#6366f1",
  highlightDark: "#4f46e5",
  highlightSoft: "rgba(99, 102, 241, 0.1)",
  highlightGlow: "0 8px 32px rgba(99, 102, 241, 0.25)",
  // Statuses
  ok: "#10b981", okSoft: "rgba(16, 185, 129, 0.1)",
  err: "#ef4444", errSoft: "rgba(239, 68, 68, 0.1)",
  warn: "#f59e0b", warnSoft: "rgba(245, 158, 11, 0.12)",
  // Glass effect helpers
  blur: "blur(20px) saturate(180%)",
  cardShadow: "0 8px 32px rgba(31, 38, 135, 0.08)",
  cardShadowHover: "0 12px 40px rgba(31, 38, 135, 0.15)",
};
const FS = "'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
const FM = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";
const FD = "'Fraunces', Georgia, serif";

// ═══════════════════════════════════════════════════════════════════════════
//  ROOT
// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  // PWA install prompt detection
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      // Only show banner if not previously dismissed
      const dismissed = localStorage.getItem("hours-install-dismissed");
      if (!dismissed) setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const promptInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setShowInstallBanner(false);
  };

  const dismissInstall = () => {
    localStorage.setItem("hours-install-dismissed", "1");
    setShowInstallBanner(false);
  };

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s);
      setLoading(false);
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) setProfile(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .maybeSingle();
      if (error) console.error("profile load:", error);
      setProfile(data);
    })();
  }, [session]);

  if (!isConfigured) return <ConfigError />;
  if (loading) return <Loading />;

  const installBanner = showInstallBanner && installPrompt && (
    <InstallBanner onInstall={promptInstall} onDismiss={dismissInstall} />
  );

  if (!session) return <>{installBanner}<LoginScreen /></>;
  if (!profile) {
    return (
      <>
        {installBanner}
        <CenterCard>
          <Loader2 size={24} className="animate-spin mb-4 mx-auto" style={{ color: T.muted }} />
          <p style={{ color: T.muted }} className="text-sm mb-4">Профайл татаж байна…</p>
          <p style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] mb-3">
            Профайл олдсонгүй гэж гарвал админд хандаарай
          </p>
          <button onClick={() => supabase.auth.signOut()}
            style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn w-full py-2 rounded-xl text-sm">
            Гарах
          </button>
        </CenterCard>
      </>
    );
  }

  return (
    <>
      {installBanner}
      <NotificationManager profile={profile} />
      {profile.role === "admin" ? <AdminDashboard profile={profile} />
        : profile.role === "manager" ? <ManagerDashboard profile={profile} />
        : <EmployeeDashboard profile={profile} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  NOTIFICATION MANAGER — Push subscription + in-app realtime toast
// ═══════════════════════════════════════════════════════════════════════════
function NotificationManager({ profile }) {
  const [toast, setToast] = useState(null); // { title, body, link }
  const [permState, setPermState] = useState(typeof Notification !== "undefined" ? Notification.permission : "default");
  const [showPrompt, setShowPrompt] = useState(false);

  // Push subscription
  useEffect(() => {
    if (!profile?.id) return;
    if (typeof Notification === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    // Хэрэглэгч хараахан зөвшөөрөл өгөөгүй бол → 5 секундын дараа prompt
    if (Notification.permission === "default") {
      const dismissed = localStorage.getItem("orgoo-notif-dismissed");
      if (!dismissed) {
        const timer = setTimeout(() => setShowPrompt(true), 5000);
        return () => clearTimeout(timer);
      }
    } else if (Notification.permission === "granted") {
      subscribeUser(profile.id);
    }
  }, [profile?.id]);

  // Realtime in-app notifications listener
  useEffect(() => {
    if (!profile?.id) return;

    // Initial: read latest unread
    supabase.from("notifications")
      .select("*")
      .eq("user_id", profile.id)
      .eq("read", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data[0]) {
          // Last-shown ID-г localStorage-д хадгалж дараа дараагүй болгоно
          const lastShown = localStorage.getItem("orgoo-last-notif-id");
          if (lastShown !== data[0].id) {
            // Анхны нэвтрэн орох үед дахин гаргахгүй
          }
        }
      });

    const ch = supabase.channel(`notif-${profile.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications",
        filter: `user_id=eq.${profile.id}`,
      }, (payload) => {
        const n = payload.new;
        setToast({ title: n.title, body: n.body, link: n.link, id: n.id });
        // Sound
        try {
          const audio = new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQBPAAA=");
          audio.volume = 0.3;
          audio.play().catch(() => {});
        } catch {}
        // Auto dismiss
        setTimeout(() => setToast((t) => (t?.id === n.id ? null : t)), 6000);
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [profile?.id]);

  // Subscribe to push (after user grants permission)
  const subscribeUser = async (userId) => {
    if (!VAPID_PUBLIC_KEY) {
      console.warn("VAPID_PUBLIC_KEY байхгүй — push subscription алгасъя");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const subJson = sub.toJSON();
      // Хадгалах
      await supabase.from("push_subscriptions").upsert({
        user_id: userId,
        endpoint: subJson.endpoint,
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth,
        user_agent: navigator.userAgent,
        last_used_at: new Date().toISOString(),
      }, { onConflict: "user_id,endpoint" });
    } catch (e) {
      console.error("Push subscribe error:", e);
    }
  };

  const requestPermission = async () => {
    setShowPrompt(false);
    try {
      const result = await Notification.requestPermission();
      setPermState(result);
      if (result === "granted") {
        await subscribeUser(profile.id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const dismissPrompt = () => {
    setShowPrompt(false);
    localStorage.setItem("orgoo-notif-dismissed", "1");
  };

  const markRead = async (id) => {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  };

  return (
    <>
      {/* Permission prompt */}
      {showPrompt && permState === "default" && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-[95%] slide-up">
          <div className="glass-strong rounded-2xl p-4 flex items-start gap-3"
               style={{ boxShadow: "0 12px 40px rgba(99, 102, 241, 0.25)" }}>
            <div style={{
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              boxShadow: "0 4px 12px rgba(99, 102, 241, 0.4)",
            }} className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
              <span style={{ fontSize: 18 }}>🔔</span>
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontFamily: FS, fontWeight: 600 }} className="text-sm mb-1">Мэдэгдэл идэвхжүүлэх үү?</div>
              <p style={{ color: T.muted }} className="text-[11px] leading-relaxed mb-3">
                Чөлөө/хүсэлт зөвшөөрөгдсөн үед автомат мэдэгдэл хүлээж авна
              </p>
              <div className="flex gap-2">
                <button onClick={dismissPrompt}
                  className="glass-soft press-btn flex-1 py-2 rounded-lg text-[10px] uppercase tracking-[0.15em]"
                  style={{ fontFamily: FM, color: T.muted }}>
                  Үгүй
                </button>
                <button onClick={requestPermission}
                  className="glow-primary press-btn flex-1 py-2 rounded-lg text-[10px] uppercase tracking-[0.15em] font-medium"
                  style={{ fontFamily: FM }}>
                  Зөвшөөрөх
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* In-app toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 max-w-sm w-[95%] sm:w-auto slide-up">
          <button onClick={() => { markRead(toast.id); setToast(null); }}
            className="glass-strong rounded-2xl p-4 flex items-start gap-3 w-full text-left lift"
            style={{ boxShadow: "0 12px 40px rgba(99, 102, 241, 0.3)", borderColor: "rgba(99,102,241,0.3)" }}>
            <div style={{
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              boxShadow: "0 4px 12px rgba(99, 102, 241, 0.4)",
            }} className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
              <span style={{ fontSize: 18 }}>🔔</span>
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontFamily: FS, fontWeight: 600 }} className="text-sm mb-0.5">{toast.title}</div>
              {toast.body && <p style={{ color: T.muted }} className="text-xs leading-relaxed line-clamp-2">{toast.body}</p>}
            </div>
            <button onClick={(e) => { e.stopPropagation(); setToast(null); }}
              style={{ color: T.muted }} className="p-1 rounded-full hover:bg-black/10 shrink-0">
              <X size={14} />
            </button>
          </button>
        </div>
      )}
    </>
  );
}

// PWA Install Banner
function InstallBanner({ onInstall, onDismiss }) {
  return (
    <div className="fixed bottom-3 left-3 right-3 z-[100] flex justify-center pointer-events-none">
      <div style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn pointer-events-auto rounded-2xl shadow-2xl px-4 py-3 max-w-md w-full flex items-center gap-3"
           role="alert">
        <div style={{ background: T.highlight }} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
          <Download size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Утсанд суулгах</div>
          <div style={{ fontFamily: FM, color: "#a1a1aa" }} className="text-[10px] uppercase tracking-[0.15em] mt-0.5">
            Hours-г апп шиг ашиглах
          </div>
        </div>
        <button onClick={onInstall} style={{ background: T.highlight }}
          className="px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-90">
          Суулгах
        </button>
        <button onClick={onDismiss} style={{ color: "#a1a1aa" }}
          className="p-1.5 hover:bg-white/10 rounded-lg">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function ConfigError() {
  return (
    <CenterCard>
      <AlertCircle size={28} style={{ color: T.err }} className="mx-auto mb-3" />
      <h2 style={{ fontFamily: FD, fontWeight: 500 }} className="text-2xl mb-2">Тохиргоо дутуу байна</h2>
      <p style={{ color: T.muted }} className="text-sm">
        VITE_SUPABASE_URL болон VITE_SUPABASE_KEY-г Vercel дээр environment variable хэлбэрээр оруулна уу.
      </p>
    </CenterCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════════════════════════════
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr(error.message === "Invalid login credentials" ? "Имэйл эсвэл нууц үг буруу" : error.message);
    setBusy(false);
  };

  return (
    <div style={{ color: T.ink, fontFamily: FS }} className="min-h-screen flex items-center justify-center p-5">
      <div className="w-full max-w-md scale-up">
        <div className="text-center mb-8">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.3em] mb-3">
            Цаг бүртгэл
          </div>
          <h1 style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.04em", lineHeight: 0.95 }} className="text-6xl">
            ORGOO<span style={{ color: T.highlight }}>.</span>
          </h1>
        </div>

        <div className="glass-strong rounded-3xl p-6 space-y-4 slide-up-delay-1">
          <Field label="Имэйл">
            <Input value={email} onChange={setEmail} placeholder="you@example.com" autoFocus
              onEnter={() => document.getElementById("lpw")?.focus()} />
          </Field>
          <Field label="Нууц үг">
            <PwInput id="lpw" value={password} onChange={setPassword} onEnter={submit} />
          </Field>
          {err && <ErrorBox>{err}</ErrorBox>}
          <button onClick={submit} disabled={busy || !email.trim() || !password}
            className="glow-primary press-btn w-full py-3 rounded-2xl text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {busy ? <Loader2 size={14} className="spin" /> : <Lock size={14} />}
            Нэвтрэх
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function AdminDashboard({ profile }) {
  const [view, setView] = useState("team");
  const [employees, setEmployees] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSessions, setActiveSessions] = useState({});
  const [approvals, setApprovals] = useState([]);
  const [sites, setSites] = useState([]);
  const [employeeSites, setEmployeeSites] = useState([]);
  const [, setTick] = useState(0);

  const [formMode, setFormMode] = useState(null);
  const [formEmp, setFormEmp] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [geoBusyId, setGeoBusyId] = useState(null);
  const [siteFormMode, setSiteFormMode] = useState(null); // null | 'add' | 'edit'
  const [siteFormData, setSiteFormData] = useState(null);
  const [confirmDelSite, setConfirmDelSite] = useState(null);
  const [chooseSiteFor, setChooseSiteFor] = useState(null); // employee for clock-in site picker
  const [editingSession, setEditingSession] = useState(null);

  useEffect(() => { const id = setInterval(() => setTick((t) => t+1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (!feedback) return; const t = setTimeout(() => setFeedback(null), 5000); return () => clearTimeout(t); }, [feedback]);

  const [managers, setManagers] = useState([]);
  const [managerEmployees, setManagerEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [editingDept, setEditingDept] = useState(null); // null | 'add' | dept object
  const [leaves, setLeaves] = useState([]);
  const [kpiDefs, setKpiDefs] = useState([]);
  const [kpiEntries, setKpiEntries] = useState([]);
  const [editingKpi, setEditingKpi] = useState(null); // null | 'add' | kpi obj
  const [kpiInputDept, setKpiInputDept] = useState(null); // department for KPI entry form
  const [tasks, setTasks] = useState([]);
  const [editingTask, setEditingTask] = useState(null); // null | 'add' | task obj

  const loadAll = async () => {
    const [emps, sess, active, apps, st, es, me, dept, lvs, kpiD, kpiE, tsk] = await Promise.all([
      supabase.from("profiles").select("*").in("role", ["employee", "manager"]).order("created_at", { ascending: false }),
      supabase.from("sessions").select("*").order("start_time", { ascending: false }).limit(200),
      supabase.from("active_sessions").select("*"),
      supabase.from("approvals").select("*").order("created_at", { ascending: false }),
      supabase.from("sites").select("*").order("name"),
      supabase.from("employee_sites").select("*"),
      supabase.from("manager_employees").select("*"),
      supabase.from("departments").select("*").order("name"),
      supabase.from("leaves").select("*").order("created_at", { ascending: false }),
      supabase.from("kpi_definitions").select("*").eq("is_active", true).order("display_order"),
      supabase.from("kpi_entries").select("*").gte("entry_date", new Date(Date.now() - 90*24*60*60*1000).toISOString().slice(0,10)).order("entry_date", { ascending: false }),
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    ]);
    if (emps.data) {
      setEmployees(emps.data.filter((p) => p.role === "employee"));
      setManagers(emps.data.filter((p) => p.role === "manager"));
    }
    if (sess.data) setSessions(sess.data);
    if (active.data) {
      const map = {};
      active.data.forEach((a) => { map[a.employee_id] = a; });
      setActiveSessions(map);
    }
    if (apps.data) setApprovals(apps.data);
    if (st.data) setSites(st.data);
    if (es.data) setEmployeeSites(es.data);
    if (me.data) setManagerEmployees(me.data);
    if (dept.data) setDepartments(dept.data);
    if (lvs.data) setLeaves(lvs.data);
    if (kpiD.data) setKpiDefs(kpiD.data);
    if (kpiE.data) setKpiEntries(kpiE.data);
    if (tsk.data) setTasks(tsk.data);
  };

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    const ch = supabase.channel("admin-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "active_sessions" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "sites" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "employee_sites" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "manager_employees" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "leaves" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "kpi_definitions" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "kpi_entries" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  const upsertEmployee = async ({ formData, password, isNew, existingId, siteIds }) => {
    try {
      let userId = existingId;
      if (isNew) {
        const { data: signup, error: signupErr } = await supabase.auth.signUp({
          email: formData.email,
          password: password,
          options: { data: { full_name: formData.name } },
        });
        if (signupErr) throw signupErr;
        if (!signup.user) throw new Error("Хэрэглэгч үүсгэгдсэнгүй");
        userId = signup.user.id;
      }

      const profileData = {
        id: userId,
        role: formData.role || "employee",
        name: formData.name,
        job_title: formData.job_title,
        hourly_rate: formData.hourly_rate,
        department_id: formData.department_id || null,
        site_lat: formData.site_lat,
        site_lng: formData.site_lng,
        site_radius: formData.site_radius,
        site_label: formData.site_label,
        schedule_days: formData.schedule_days,
        schedule_start: formData.schedule_start,
        schedule_end: formData.schedule_end,
        updated_at: new Date().toISOString(),
      };

      if (isNew) {
        const { error } = await supabase.from("profiles").insert(profileData);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("profiles").update(profileData).eq("id", existingId);
        if (error) throw error;
      }

      // Save site assignments
      if (Array.isArray(siteIds)) {
        await supabase.from("employee_sites").delete().eq("employee_id", userId);
        if (siteIds.length > 0) {
          const rows = siteIds.map((sid) => ({ employee_id: userId, site_id: sid }));
          await supabase.from("employee_sites").insert(rows);
        }
      }

      setFormMode(null); setFormEmp(null);
      setFeedback({ type: "success", msg: isNew ? "Ажилтан нэмэгдлээ" : "Хадгаллаа" });
      await loadAll();
    } catch (e) {
      setFeedback({ type: "error", msg: e.message });
    }
  };

  const removeEmployee = async (id) => {
    const { error } = await supabase.from("profiles").delete().eq("id", id);
    if (error) { setFeedback({ type: "error", msg: error.message }); return; }
    setConfirmDel(null);
    setFeedback({ type: "success", msg: "Профайл устгагдлаа" });
    await loadAll();
  };

  // Helper: get sites assigned to an employee (multi-site mode)
  // Returns: array of site objects, or null if employee uses legacy single-site mode
  const getEmployeeSites = (empId) => {
    const links = employeeSites.filter((es) => es.employee_id === empId);
    if (links.length === 0) return null; // no multi-site assigned
    return links.map((l) => sites.find((s) => s.id === l.site_id)).filter(Boolean);
  };

  // Resolve which site to use for an employee (returns site object or legacy profile-based site)
  const resolveSiteForClockIn = (emp, chosenSiteId) => {
    const empSites = getEmployeeSites(emp.id);
    if (empSites && empSites.length > 0) {
      if (empSites.length === 1) return empSites[0];
      return chosenSiteId ? empSites.find((s) => s.id === chosenSiteId) : null;
    }
    // Legacy fallback: use profile.site_*
    if (hasSite(emp)) {
      return { id: null, lat: emp.site_lat, lng: emp.site_lng, radius: emp.site_radius || 100, name: emp.site_label || "Ажлын байр" };
    }
    return null;
  };

  const tryClockIn = async (emp, chosenSiteId = null) => {
    const empSites = getEmployeeSites(emp.id);

    // If multi-site with multiple options and none chosen → open picker
    if (empSites && empSites.length > 1 && !chosenSiteId) {
      setChooseSiteFor(emp);
      return;
    }

    const site = resolveSiteForClockIn(emp, chosenSiteId);
    if (!site) {
      setFeedback({ empId: emp.id, type: "error", msg: "Ажлын байр тогтоогоогүй" });
      return;
    }

    const sched = checkSchedule(emp);
    if (!sched.ok) { setFeedback({ empId: emp.id, type: "error", msg: sched.reason }); return; }

    setGeoBusyId(emp.id);
    setChooseSiteFor(null);
    try {
      const loc = await getLocation();
      const d = distanceMeters(loc, site);
      if (d > site.radius) {
        setFeedback({ empId: emp.id, type: "error", msg: `Хязгаараас гадуур — ${fmtDist(d)} (${site.radius}m)` });
        return;
      }
      const startTime = new Date(capSessionStart(emp, Date.now())).toISOString();
      const { error } = await supabase.from("active_sessions").upsert({
        employee_id: emp.id, start_time: startTime,
        start_lat: loc.lat, start_lng: loc.lng, distance_meters: d,
        site_id: site.id,
      });
      if (error) throw error;
      setFeedback({ empId: emp.id, type: "success", msg: `Цаг бүртгэгдлээ · ${site.name} · ${fmtDist(d)}` });
      await loadAll();
    } catch (e) { setFeedback({ empId: emp.id, type: "error", msg: e.message }); }
    finally { setGeoBusyId(null); }
  };

  const tryClockOut = async (emp) => {
    const entry = activeSessions[emp.id];
    if (!entry) return;

    // Find the site they clocked into
    let activeSite = null;
    if (entry.site_id) {
      activeSite = sites.find((s) => s.id === entry.site_id);
    }
    if (!activeSite && hasSite(emp)) {
      activeSite = { id: null, lat: emp.site_lat, lng: emp.site_lng, radius: emp.site_radius || 100 };
    }

    setGeoBusyId(emp.id);
    try {
      let endLoc = null;
      if (activeSite) {
        try {
          endLoc = await getLocation();
          const ed = distanceMeters(endLoc, activeSite);
          if (ed > activeSite.radius) {
            setFeedback({ empId: emp.id, type: "error", msg: `Гарах боломжгүй — ${fmtDist(ed)} зайтай` });
            return;
          }
        } catch (e) { setFeedback({ empId: emp.id, type: "error", msg: e.message }); return; }
      }
      const startMs = new Date(entry.start_time).getTime();
      const cappedEnd = capSessionEnd(emp, Date.now());
      const endMs = Math.max(startMs + 1000, cappedEnd);

      const { error: insErr } = await supabase.from("sessions").insert({
        employee_id: emp.id,
        start_time: new Date(startMs).toISOString(),
        end_time: new Date(endMs).toISOString(),
        start_lat: entry.start_lat, start_lng: entry.start_lng,
        end_lat: endLoc?.lat, end_lng: endLoc?.lng,
        site_id: entry.site_id || null,
      });
      if (insErr) throw insErr;
      const { error: delErr } = await supabase.from("active_sessions").delete().eq("employee_id", emp.id);
      if (delErr) throw delErr;
      setFeedback({ empId: emp.id, type: "success", msg: "Цаг буулаа" });
      await loadAll();
    } catch (e) { setFeedback({ empId: emp.id, type: "error", msg: e.message }); }
    finally { setGeoBusyId(null); }
  };

  // ── Site CRUD ──
  const upsertSite = async (siteData) => {
    try {
      const payload = {
        name: siteData.name, lat: siteData.lat, lng: siteData.lng,
        radius: siteData.radius, notes: siteData.notes,
        is_flexible: siteData.is_flexible || false,
        arrival_window_start: siteData.arrival_window_start || null,
        arrival_window_end: siteData.arrival_window_end || null,
        shift_hours: siteData.shift_hours || null,
      };
      if (siteData.id) {
        const { error } = await supabase.from("sites").update({
          ...payload,
          updated_at: new Date().toISOString(),
        }).eq("id", siteData.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sites").insert(payload);
        if (error) throw error;
      }
      setSiteFormMode(null); setSiteFormData(null);
      setFeedback({ type: "success", msg: "Хадгаллаа" });
      await loadAll();
    } catch (e) {
      setFeedback({ type: "error", msg: e.message });
    }
  };

  const deleteSite = async (siteId) => {
    const { error } = await supabase.from("sites").delete().eq("id", siteId);
    if (error) { setFeedback({ type: "error", msg: error.message }); return; }
    setConfirmDelSite(null);
    setFeedback({ type: "success", msg: "Байр устгагдлаа" });
    await loadAll();
  };

  // Update which sites are assigned to an employee
  const updateEmployeeSites = async (empId, siteIds) => {
    try {
      // Delete existing
      await supabase.from("employee_sites").delete().eq("employee_id", empId);
      // Insert new
      if (siteIds.length > 0) {
        const rows = siteIds.map((sid) => ({ employee_id: empId, site_id: sid }));
        const { error } = await supabase.from("employee_sites").insert(rows);
        if (error) throw error;
      }
      await loadAll();
    } catch (e) {
      setFeedback({ type: "error", msg: e.message });
    }
  };

  // Update which employees are assigned to a manager
  const updateManagerEmployees = async (managerId, employeeIds) => {
    try {
      await supabase.from("manager_employees").delete().eq("manager_id", managerId);
      if (employeeIds.length > 0) {
        const rows = employeeIds.map((eid) => ({ manager_id: managerId, employee_id: eid }));
        const { error } = await supabase.from("manager_employees").insert(rows);
        if (error) throw error;
      }
      setFeedback({ type: "success", msg: "Хадгаллаа" });
      await loadAll();
    } catch (e) {
      setFeedback({ type: "error", msg: e.message });
    }
  };

  // Department CRUD
  const upsertDepartment = async (data) => {
    try {
      if (data.id) {
        const { error } = await supabase.from("departments").update({
          name: data.name, description: data.description, manager_id: data.manager_id,
        }).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("departments").insert({
          name: data.name, description: data.description, manager_id: data.manager_id,
        });
        if (error) throw error;
      }
      setEditingDept(null);
      setFeedback({ type: "success", msg: "Хэлтэс хадгаллаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  const deleteDepartment = async (id) => {
    try {
      const { error } = await supabase.from("departments").delete().eq("id", id);
      if (error) throw error;
      setFeedback({ type: "success", msg: "Хэлтэс устгагдлаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  const resolveLeave = async (leave, decision, note = null) => {
    try {
      const { error } = await supabase.from("leaves").update({
        status: decision,
        resolved_at: new Date().toISOString(),
        resolved_by: profile.id,
        admin_note: note,
      }).eq("id", leave.id);
      if (error) throw error;
      setFeedback({ type: "success", msg: decision === "approved" ? "Зөвшөөрлөө" : "Татгалзлаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  // KPI CRUD
  const upsertKpiDef = async (data) => {
    try {
      if (data.id) {
        const { error } = await supabase.from("kpi_definitions").update({
          name: data.name, unit: data.unit, category: data.category,
          display_order: data.display_order, is_active: data.is_active ?? true,
        }).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("kpi_definitions").insert({
          department_id: data.department_id,
          name: data.name, unit: data.unit, category: data.category,
          display_order: data.display_order || 0,
        });
        if (error) throw error;
      }
      setEditingKpi(null);
      setFeedback({ type: "success", msg: "KPI хадгаллаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  const deleteKpiDef = async (id) => {
    try {
      const { error } = await supabase.from("kpi_definitions").delete().eq("id", id);
      if (error) throw error;
      setFeedback({ type: "success", msg: "KPI устгагдлаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  const upsertKpiEntries = async (deptId, date, entries) => {
    // entries = [{ kpi_id, value, note }]
    try {
      const rows = entries.map((e) => ({
        kpi_id: e.kpi_id,
        department_id: deptId,
        entry_date: date,
        value: e.value,
        note: e.note || null,
        entered_by: profile.id,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("kpi_entries").upsert(rows, {
        onConflict: "kpi_id,entry_date",
      });
      if (error) throw error;
      setKpiInputDept(null);
      setFeedback({ type: "success", msg: "Хадгаллаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  // Tasks CRUD
  const upsertTask = async (data) => {
    try {
      if (data.id) {
        const { error } = await supabase.from("tasks").update({
          title: data.title, description: data.description,
          status: data.status, priority: data.priority,
          assignee_id: data.assignee_id, due_date: data.due_date,
          completed_at: data.status === "done" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("tasks").insert({
          department_id: data.department_id,
          title: data.title, description: data.description,
          status: data.status || "todo", priority: data.priority || "medium",
          assignee_id: data.assignee_id, due_date: data.due_date,
          created_by: profile.id,
        });
        if (error) throw error;
      }
      setEditingTask(null);
      setFeedback({ type: "success", msg: "Даалгавар хадгаллаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  const deleteTask = async (id) => {
    try {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
      setFeedback({ type: "success", msg: "Устгагдлаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  const updateTaskStatus = async (taskId, newStatus) => {
    try {
      const { error } = await supabase.from("tasks").update({
        status: newStatus,
        completed_at: newStatus === "done" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("id", taskId);
      if (error) throw error;
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  // Session edit/delete (admin)
  const editSession = async ({ id, start_time, end_time, site_id, edit_reason }) => {
    try {
      const { error } = await supabase.from("sessions").update({
        start_time, end_time, site_id,
        edited_at: new Date().toISOString(),
        edited_by: profile.id,
        edit_reason,
      }).eq("id", id);
      if (error) throw error;
      setEditingSession(null);
      setFeedback({ type: "success", msg: "Бүртгэл засагдлаа" });
      await loadAll();
    } catch (e) {
      setFeedback({ type: "error", msg: e.message });
    }
  };

  const deleteSession = async (id) => {
    try {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) throw error;
      setEditingSession(null);
      setFeedback({ type: "success", msg: "Бүртгэл устгагдлаа" });
      await loadAll();
    } catch (e) {
      setFeedback({ type: "error", msg: e.message });
    }
  };

  const resolveApproval = async (approval, decision) => {
    const updates = {
      status: decision, resolved_at: new Date().toISOString(), resolved_by: profile.id,
    };
    const { error: updErr } = await supabase.from("approvals").update(updates).eq("id", approval.id);
    if (updErr) { setFeedback({ type: "error", msg: updErr.message }); return; }

    if (decision === "approved" && approval.kind !== "early_leave") {
      // Зөвхөн "цаг мартсан" хүсэлтэд цэшн оруулна. Эрт явах нь зөвхөн зөвшөөрөл — ажилтан өөрөө цаг буулгана.
      const emp = employees.find((e) => e.id === approval.employee_id);
      const cappedStart = capSessionStart(emp, new Date(approval.proposed_start).getTime());
      const cappedEnd = capSessionEnd(emp, new Date(approval.proposed_end).getTime());
      if (cappedEnd > cappedStart) {
        await supabase.from("sessions").insert({
          employee_id: approval.employee_id,
          start_time: new Date(cappedStart).toISOString(),
          end_time: new Date(cappedEnd).toISOString(),
          from_approval: approval.id,
        });
      }
    }
    await loadAll();
  };

  const teamTodayMs = useMemo(() => {
    const t = startOfDay();
    const closed = sessions.filter((s) => new Date(s.start_time).getTime() >= t)
      .reduce((a, s) => a + sessionDurationMs(new Date(s.start_time).getTime(), new Date(s.end_time).getTime()), 0);
    const live = Object.entries(activeSessions).reduce((a, [id, e]) => {
      const st = new Date(e.start_time).getTime();
      if (st < t) return a;
      const emp = employees.find((x) => x.id === id);
      const capped = capSessionEnd(emp, Date.now());
      return a + Math.min(Math.max(0, capped - st), DAILY_HOUR_LIMIT_MS);
    }, 0);
    return closed + live;
  }, [sessions, activeSessions, employees]);

  const activeCount = Object.keys(activeSessions).length;

  return (
    <div style={{ color: T.ink, fontFamily: FS }} className="min-h-screen">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 sm:py-10">
        <div className="flex items-center justify-between mb-10 slide-up">
          <div className="flex items-center gap-3">
            <div style={{
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: "white",
              boxShadow: "0 4px 16px rgba(99, 102, 241, 0.4)",
            }} className="w-10 h-10 rounded-xl flex items-center justify-center">
              <ShieldCheck size={16} />
            </div>
            <div>
              <div style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.03em" }} className="text-2xl leading-none">
                ORGOO<span style={{ color: T.highlight }}>.</span>
              </div>
              <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.25em] mt-1">
                Admin · {profile.name}
              </div>
            </div>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="glass-soft press-btn px-3 py-2 rounded-lg text-[11px] uppercase tracking-[0.2em] flex items-center gap-2" style={{ fontFamily: FM, color: "#1e1b4b" }}>
            <LogOut size={12} /> Гарах
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10 slide-up-delay-1">
          <BigStat label="Ажиллаж буй" value={activeCount} accent={activeCount > 0} />
          <BigStat label="Өнөөдөр" value={fmtHours(teamTodayMs)} suffix="цаг" />
          <BigStat label="Ажилтан" value={employees.length} />
        </div>

        <nav className="flex items-center gap-1.5 mb-6 flex-wrap slide-up-delay-2">
          <Tab active={view === "team"} onClick={() => setView("team")} icon={Users}>Баг</Tab>
          <Tab active={view === "dashboard"} onClick={() => setView("dashboard")} icon={BarChart3}>Дашборд</Tab>
          <Tab active={view === "tasks"} onClick={() => setView("tasks")} icon={ClipboardCheck}>Даалгавар</Tab>
          <Tab active={view === "departments"} onClick={() => setView("departments")} icon={Users}>Хэлтсүүд</Tab>
          <Tab active={view === "managers"} onClick={() => setView("managers")} icon={ShieldCheck}>Ахлагчид</Tab>
          <Tab active={view === "sites"} onClick={() => setView("sites")} icon={MapPin}>Байрууд</Tab>
          <Tab active={view === "ledger"} onClick={() => setView("ledger")} icon={Calendar}>Тэмдэглэл</Tab>
          <Tab active={view === "approvals"} onClick={() => setView("approvals")} icon={Inbox} badge={pendingApprovals.length}>
            Хүсэлт
          </Tab>
          <Tab active={view === "leaves"} onClick={() => setView("leaves")} icon={Calendar} badge={leaves.filter(l => l.status === "pending").length}>
            Чөлөө
          </Tab>
          <div className="flex-1" />
          {view === "team" && (
            <button onClick={() => { setFormEmp(null); setFormMode("add"); }}
              className="glow-primary press-btn px-4 py-2 rounded-full text-[11px] uppercase tracking-[0.2em] flex items-center gap-1.5">
              <Plus size={13} strokeWidth={2.5} /> Ажилтан нэмэх
            </button>
          )}
          {view === "sites" && (
            <button onClick={() => { setSiteFormData(null); setSiteFormMode("add"); }}
              className="glow-primary press-btn px-4 py-2 rounded-full text-[11px] uppercase tracking-[0.2em] flex items-center gap-1.5">
              <Plus size={13} strokeWidth={2.5} /> Байр нэмэх
            </button>
          )}
          {view === "departments" && (
            <button onClick={() => setEditingDept("add")}
              className="glow-primary press-btn px-4 py-2 rounded-full text-[11px] uppercase tracking-[0.2em] flex items-center gap-1.5">
              <Plus size={13} strokeWidth={2.5} /> Хэлтэс нэмэх
            </button>
          )}
        </nav>

        {feedback && !feedback.empId && (
          <div className="mb-4"><FeedbackBox type={feedback.type}>{feedback.msg}</FeedbackBox></div>
        )}

        {view === "team" && (
          <TeamView
            employees={employees} sessions={sessions} activeSessions={activeSessions}
            sites={sites} employeeSites={employeeSites}
            geoBusyId={geoBusyId} feedback={feedback}
            onEdit={(emp) => { setFormEmp(emp); setFormMode("edit"); }}
            onDelete={(id) => setConfirmDel(id)}
            onClockIn={tryClockIn} onClockOut={tryClockOut}
            onAdd={() => { setFormEmp(null); setFormMode("add"); }} />
        )}
        {view === "sites" && (
          <SitesView
            sites={sites} employeeSites={employeeSites} employees={employees} sessions={sessions}
            onEdit={(site) => { setSiteFormData(site); setSiteFormMode("edit"); }}
            onDelete={(id) => setConfirmDelSite(id)}
            onAdd={() => { setSiteFormData(null); setSiteFormMode("add"); }} />
        )}
        {view === "managers" && (
          <ManagersView
            managers={managers} employees={employees} managerEmployees={managerEmployees}
            onUpdateAssignments={updateManagerEmployees}
            onAddManager={() => { setFormEmp(null); setFormMode("add"); }} />
        )}
        {view === "departments" && (
          <DepartmentsView
            departments={departments} employees={employees} managers={managers}
            onEdit={(d) => setEditingDept(d)}
            onDelete={deleteDepartment}
            onAdd={() => setEditingDept("add")} />
        )}
        {view === "ledger" && (
          <LedgerView sessions={sessions} employees={employees} sites={sites}
            canEdit={true}
            onEditSession={(s) => setEditingSession(s)} />
        )}
        {view === "approvals" && (
          <ApprovalsView approvals={approvals} employees={employees} onResolve={resolveApproval} />
        )}
        {view === "leaves" && (
          <LeavesView leaves={leaves} employees={[...employees, ...managers]} onResolve={resolveLeave} />
        )}
        {view === "dashboard" && (
          <KPIDashboardView
            departments={departments}
            kpiDefs={kpiDefs}
            kpiEntries={kpiEntries}
            isAdmin={true}
            currentUserId={profile.id}
            onAddKpi={() => setEditingKpi("add")}
            onEditKpi={(k) => setEditingKpi(k)}
            onDeleteKpi={deleteKpiDef}
            onOpenInputForm={(deptId) => setKpiInputDept(deptId)}
          />
        )}
        {view === "tasks" && (
          <TasksView
            tasks={tasks}
            departments={departments}
            employees={[...employees, ...managers]}
            currentUserId={profile.id}
            isAdmin={true}
            onAdd={() => setEditingTask("add")}
            onEdit={(t) => setEditingTask(t)}
            onDelete={deleteTask}
            onUpdateStatus={updateTaskStatus}
          />
        )}

        <Footer count={sessions.length} />
      </div>

      {formMode && (
        <EmployeeFormModal
          mode={formMode} employee={formEmp}
          sites={sites} departments={departments}
          assignedSiteIds={formEmp ? employeeSites.filter(es => es.employee_id === formEmp.id).map(es => es.site_id) : []}
          onSave={upsertEmployee}
          onClose={() => { setFormMode(null); setFormEmp(null); }} />
      )}

      {editingDept && (
        <DepartmentFormModal
          mode={editingDept === "add" ? "add" : "edit"}
          dept={editingDept === "add" ? null : editingDept}
          managers={managers}
          onSave={upsertDepartment}
          onClose={() => setEditingDept(null)} />
      )}

      {editingKpi && (
        <KpiDefFormModal
          mode={editingKpi === "add" ? "add" : "edit"}
          kpi={editingKpi === "add" ? null : editingKpi}
          departments={departments}
          onSave={upsertKpiDef}
          onClose={() => setEditingKpi(null)} />
      )}

      {kpiInputDept && (
        <KpiEntryFormModal
          department={departments.find(d => d.id === kpiInputDept)}
          kpiDefs={kpiDefs.filter(k => k.department_id === kpiInputDept)}
          existingEntries={kpiEntries}
          onSave={upsertKpiEntries}
          onClose={() => setKpiInputDept(null)} />
      )}

      {editingTask && (
        <TaskFormModal
          mode={editingTask === "add" ? "add" : "edit"}
          task={editingTask === "add" ? null : editingTask}
          departments={departments}
          employees={[...employees, ...managers]}
          onSave={upsertTask}
          onClose={() => setEditingTask(null)} />
      )}

      {siteFormMode && (
        <SiteFormModal
          mode={siteFormMode} site={siteFormData}
          onSave={upsertSite}
          onClose={() => { setSiteFormMode(null); setSiteFormData(null); }} />
      )}

      {confirmDelSite && (
        <ConfirmModal
          title="Байр устгах уу?"
          message={`"${sites.find(s => s.id === confirmDelSite)?.name}" байрыг устгахад түүнийг ашиглаж байсан ажилтнуудаас холбогдол алдагдана. Хуучин бүртгэлүүд хадгалагдана.`}
          onCancel={() => setConfirmDelSite(null)}
          onConfirm={() => deleteSite(confirmDelSite)} />
      )}

      {chooseSiteFor && (
        <SitePickerModal
          employee={chooseSiteFor}
          sites={getEmployeeSites(chooseSiteFor.id) || []}
          onPick={(siteId) => tryClockIn(chooseSiteFor, siteId)}
          onClose={() => setChooseSiteFor(null)} />
      )}

      {editingSession && (
        <SessionEditModal
          session={editingSession}
          employee={[...employees, ...managers].find((e) => e.id === editingSession.employee_id)}
          sites={sites}
          onSave={editSession}
          onDelete={deleteSession}
          onClose={() => setEditingSession(null)} />
      )}

      {confirmDel && (
        <ConfirmDeleteModal
          name={employees.find((e) => e.id === confirmDel)?.name}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => removeEmployee(confirmDel)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  EMPLOYEE DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function EmployeeDashboard({ profile }) {
  const [view, setView] = useState("home");
  const [mySessions, setMySessions] = useState([]);
  const [myActive, setMyActive] = useState(null);
  const [myApprovals, setMyApprovals] = useState([]);
  const [myLeaves, setMyLeaves] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [allDepartments, setAllDepartments] = useState([]);
  const [deptColleagues, setDeptColleagues] = useState([]);
  const [nearestDistances, setNearestDistances] = useState(null);
  const [mySites, setMySites] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [showSitePicker, setShowSitePicker] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => { const id = setInterval(() => setTick((t) => t+1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (!feedback) return; const t = setTimeout(() => setFeedback(null), 5000); return () => clearTimeout(t); }, [feedback]);

  const loadMy = async () => {
    const [sess, active, apps, esResult, lvs, tsk, depts, colleagues] = await Promise.all([
      supabase.from("sessions").select("*").eq("employee_id", profile.id).order("start_time", { ascending: false }).limit(60),
      supabase.from("active_sessions").select("*").eq("employee_id", profile.id).maybeSingle(),
      supabase.from("approvals").select("*").eq("employee_id", profile.id).order("created_at", { ascending: false }),
      supabase.from("employee_sites").select("site_id, sites(*)").eq("employee_id", profile.id),
      supabase.from("leaves").select("*").eq("employee_id", profile.id).order("created_at", { ascending: false }),
      supabase.from("tasks").select("*").or(`assignee_id.eq.${profile.id},created_by.eq.${profile.id}`).order("created_at", { ascending: false }),
      supabase.from("departments").select("*").order("name"),
      profile.department_id
        ? supabase.from("profiles").select("id, name, role, department_id").eq("department_id", profile.department_id)
        : Promise.resolve({ data: [] }),
    ]);
    if (sess.data) setMySessions(sess.data);
    setMyActive(active.data || null);
    if (apps.data) setMyApprovals(apps.data);
    if (esResult.data) {
      setMySites(esResult.data.map(es => es.sites).filter(Boolean));
    }
    if (lvs.data) setMyLeaves(lvs.data);
    if (tsk.data) setMyTasks(tsk.data);
    if (depts.data) setAllDepartments(depts.data);
    if (colleagues.data) setDeptColleagues(colleagues.data);
  };

  useEffect(() => { loadMy(); }, []);

  useEffect(() => {
    const ch = supabase.channel(`employee-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `employee_id=eq.${profile.id}` }, () => loadMy())
      .on("postgres_changes", { event: "*", schema: "public", table: "active_sessions", filter: `employee_id=eq.${profile.id}` }, () => loadMy())
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals", filter: `employee_id=eq.${profile.id}` }, () => loadMy())
      .on("postgres_changes", { event: "*", schema: "public", table: "employee_sites", filter: `employee_id=eq.${profile.id}` }, () => loadMy())
      .on("postgres_changes", { event: "*", schema: "public", table: "leaves", filter: `employee_id=eq.${profile.id}` }, () => loadMy())
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadMy())
      .on("postgres_changes", { event: "*", schema: "public", table: "sites" }, () => loadMy())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile.id]);

  const isActive = !!myActive;
  const liveMs = isActive ? capSessionEnd(profile, Date.now()) - new Date(myActive.start_time).getTime() : 0;
  const activeSite = isActive && myActive.site_id ? mySites.find(s => s.id === myActive.site_id) : null;

  const stats = useMemo(() => {
    // Лимиттэй нийлбэр: сэшн бүрд 9 цагийн дээд лимит
    const cap = (list) => list.reduce((a, s) => {
      const ms = sessionDurationMs(new Date(s.start_time).getTime(), new Date(s.end_time).getTime());
      return a + ms;
    }, 0);
    const today = mySessions.filter((s) => new Date(s.start_time).getTime() >= startOfDay());
    const week = mySessions.filter((s) => new Date(s.start_time).getTime() >= startOfWeek());
    // Live ms: одоогийн идэвхтэй сэшнийг 9 цагт хүртэл л тоолоно
    const live = isActive ? Math.min(Math.max(0, liveMs), DAILY_HOUR_LIMIT_MS) : 0;
    return { today: cap(today) + live, week: cap(week) + live, total: cap(mySessions) + live };
  }, [mySessions, isActive, liveMs]);

  // Resolve which site to use for clock-in
  // Returns: site object or null
  const resolveSite = (chosenSiteId) => {
    if (mySites.length > 0) {
      if (mySites.length === 1) return mySites[0];
      return chosenSiteId ? mySites.find(s => s.id === chosenSiteId) : null;
    }
    // Legacy
    if (hasSite(profile)) {
      return { id: null, lat: profile.site_lat, lng: profile.site_lng, radius: profile.site_radius || 100, name: profile.site_label || "Ажлын байр" };
    }
    return null;
  };

  const onClockIn = async (chosenSiteId = null) => {
    // If multiple sites assigned and none chosen, try auto-detect nearest first
    if (mySites.length > 1 && !chosenSiteId) {
      setGeoBusy(true);
      try {
        const loc = await getLocation();
        // Олон байрнаас хамгийн ойрыг олох
        const distances = mySites.map((s) => ({
          site: s,
          distance: distanceMeters(loc, s),
        })).sort((a, b) => a.distance - b.distance);

        const nearest = distances[0];
        // Хэрэв хамгийн ойр байр радиус дотор бол → шууд ашиглана
        if (nearest && nearest.distance <= nearest.site.radius) {
          setGeoBusy(false);
          return await onClockIn(nearest.site.id);
        }
        // Хэрэв бүх байрнаас гадуур бол → picker нээж "ойр зайтай" гэсэн мэдээлэлтэй
        setNearestDistances(distances);
        setShowSitePicker(true);
        setGeoBusy(false);
        return;
      } catch (e) {
        setGeoBusy(false);
        setFeedback({ type: "error", msg: e.message });
        // GPS алдаа гарвал picker нээж байна
        setShowSitePicker(true);
        return;
      }
    }

    const site = resolveSite(chosenSiteId);
    if (!site) {
      setFeedback({ type: "error", msg: "Ажлын байр тогтоогоогүй. Админд хандаарай." });
      return;
    }

    // Уян хатан байр — өөрийн ирэх хугацааг шалгана
    if (site.is_flexible) {
      const arrCheck = checkFlexibleArrival(site);
      if (!arrCheck.ok) {
        setFeedback({ type: "error", msg: arrCheck.reason });
        return;
      }
    } else {
      // Хатуу хуваарь — profile schedule
      const sched = checkSchedule(profile);
      if (!sched.ok) { setFeedback({ type: "error", msg: sched.reason }); return; }
    }

    setShowSitePicker(false);
    setGeoBusy(true);
    try {
      const loc = await getLocation();
      const d = distanceMeters(loc, site);
      if (d > site.radius) {
        setFeedback({ type: "error", msg: `Хязгаараас гадуур — ${fmtDist(d)}` });
        return;
      }
      // Уян хатан байранд ирсэн цагаараа бүртгэнэ (capSessionStart хэрэглэхгүй)
      const startTime = site.is_flexible
        ? new Date().toISOString()
        : new Date(capSessionStart(profile, Date.now())).toISOString();
      const { error } = await supabase.from("active_sessions").upsert({
        employee_id: profile.id, start_time: startTime,
        start_lat: loc.lat, start_lng: loc.lng, distance_meters: d,
        site_id: site.id,
      });
      if (error) throw error;
      setFeedback({ type: "success", msg: `Цаг бүртгэгдлээ · ${site.name} · ${fmtDist(d)}` });
      await loadMy();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
    finally { setGeoBusy(false); }
  };

  const onClockOut = async () => {
    if (!myActive) return;

    // Шалгах: батлагдсан "early_leave" хүсэлт байгаа эсэх (өнөөдрийн)
    const todayMs = startOfDay();
    const approvedEarlyLeave = myApprovals.find((a) =>
      a.kind === "early_leave" &&
      a.status === "approved" &&
      new Date(a.proposed_end).getTime() >= todayMs &&
      new Date(a.proposed_end).getTime() <= todayMs + 86400000
    );

    // Find which site they clocked into
    let site = null;
    if (myActive.site_id) site = mySites.find(s => s.id === myActive.site_id);
    if (!site && hasSite(profile)) {
      site = { id: null, lat: profile.site_lat, lng: profile.site_lng, radius: profile.site_radius || 100 };
    }

    setGeoBusy(true);
    try {
      let endLoc = null;
      // Хэрэв early_leave батлагдсан бол байршил харгалзахгүй
      if (site && !approvedEarlyLeave) {
        try {
          endLoc = await getLocation();
          const ed = distanceMeters(endLoc, site);
          if (ed > site.radius) {
            // Байршил гадуур — UnverifiedClockOutModal нээх
            setUnverifiedDistance(ed);
            setUnverifiedSite(site);
            setUnverifiedEndLoc(endLoc);
            setShowUnverifiedClockOut(true);
            setGeoBusy(false);
            return;
          }
        } catch (e) { setFeedback({ type: "error", msg: e.message }); return; }
      }
      await finalizeClockOut({ endLoc, approvedEarlyLeave, verified: true });
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
    finally { setGeoBusy(false); }
  };

  // Шинэ state-ууд UnverifiedClockOutModal-н хувьд
  const [showUnverifiedClockOut, setShowUnverifiedClockOut] = useState(false);
  const [unverifiedDistance, setUnverifiedDistance] = useState(null);
  const [unverifiedSite, setUnverifiedSite] = useState(null);
  const [unverifiedEndLoc, setUnverifiedEndLoc] = useState(null);

  const finalizeClockOut = async ({ endLoc, approvedEarlyLeave, verified, reason }) => {
    if (!myActive) return;
    const site = myActive.site_id ? mySites.find(s => s.id === myActive.site_id) : null;
    const startMs = new Date(myActive.start_time).getTime();
    const proposedEnd = approvedEarlyLeave ? new Date(approvedEarlyLeave.proposed_end).getTime() : Date.now();
    let cappedEnd;
    if (approvedEarlyLeave) {
      cappedEnd = proposedEnd;
    } else if (site?.is_flexible && site.shift_hours) {
      const flexEnd = flexibleSessionEnd(site, startMs);
      cappedEnd = Math.min(proposedEnd, flexEnd);
    } else {
      cappedEnd = capSessionEnd(profile, proposedEnd);
    }
    const endMs = Math.max(startMs + 1000, cappedEnd);

    const { error: insErr } = await supabase.from("sessions").insert({
      employee_id: profile.id,
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(endMs).toISOString(),
      start_lat: myActive.start_lat, start_lng: myActive.start_lng,
      end_lat: endLoc?.lat, end_lng: endLoc?.lng,
      site_id: myActive.site_id || null,
      out_verified: verified,
      out_verification_status: verified ? "verified" : "pending",
      out_reason: reason || null,
    });
    if (insErr) throw insErr;
    await supabase.from("active_sessions").delete().eq("employee_id", profile.id);

    setFeedback({
      type: verified ? "success" : "warning",
      msg: !verified
        ? "Хүсэлт явуулагдлаа · ахлагч баталгаажуулахыг хүлээж байна"
        : approvedEarlyLeave ? "Цаг буулаа · эрт явах баталгаажсан" : "Цаг буулаа"
    });
    setShowUnverifiedClockOut(false);
    setUnverifiedDistance(null);
    setUnverifiedSite(null);
    setUnverifiedEndLoc(null);
    await loadMy();
  };

  const submitUnverifiedClockOut = async (reason) => {
    try {
      await finalizeClockOut({
        endLoc: unverifiedEndLoc,
        approvedEarlyLeave: null,
        verified: false,
        reason,
      });
    } catch (e) {
      setFeedback({ type: "error", msg: e.message });
    }
  };

  const _onClockOut_legacy_unused = async () => {
    if (!myActive) return;
    setGeoBusy(true);
    try {
      const startMs = new Date(myActive.start_time).getTime();
      const proposedEnd = Date.now();
      const cappedEnd = capSessionEnd(profile, proposedEnd);
      const endMs = Math.max(startMs + 1000, cappedEnd);

      const { error: insErr } = await supabase.from("sessions").insert({
        employee_id: profile.id,
        start_time: new Date(startMs).toISOString(),
        end_time: new Date(endMs).toISOString(),
        start_lat: myActive.start_lat, start_lng: myActive.start_lng,
        site_id: myActive.site_id || null,
      });
      if (insErr) throw insErr;
      await supabase.from("active_sessions").delete().eq("employee_id", profile.id);
      setFeedback({ type: "success", msg: "Цаг буулаа" });
      await loadMy();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
    finally { setGeoBusy(false); }
  };

  const submitRequest = async ({ start, end, reason, kind }) => {
    const { error } = await supabase.from("approvals").insert({
      employee_id: profile.id,
      proposed_start: new Date(start).toISOString(),
      proposed_end: new Date(end).toISOString(),
      reason, status: "pending", kind: kind || "forgot_clockin",
    });
    if (error) { setFeedback({ type: "error", msg: error.message }); return; }
    setShowRequest(false);
    setShowEarlyLeave(false);
    setFeedback({ type: "success", msg: "Хүсэлт илгээгдлээ" });
    await loadMy();
  };

  const [showEarlyLeave, setShowEarlyLeave] = useState(false);

  const sched = profile ? checkSchedule(profile) : { ok: true };
  const noSite = mySites.length === 0 && !hasSite(profile);
  const cantClock = !isActive && (noSite || !sched.ok);

  return (
    <div style={{ color: T.ink, fontFamily: FS }} className="min-h-screen">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-6 sm:py-10">
        <div className="flex items-center justify-between mb-8 slide-up">
          <div className="flex items-center gap-3">
            <div style={{
              background: isActive ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "linear-gradient(135deg, #1e1b4b, #312e81)",
              color: "white",
              boxShadow: isActive ? "0 4px 16px rgba(99, 102, 241, 0.4)" : "0 4px 16px rgba(30, 27, 75, 0.2)",
            }}
                 className="w-10 h-10 rounded-xl flex items-center justify-center transition-all">
              <UserIcon size={16} />
            </div>
            <div>
              <div style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.03em" }} className="text-2xl leading-none">
                {profile.name}
              </div>
              <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.25em] mt-1">
                {profile.job_title}
              </div>
            </div>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="glass-soft press-btn px-3 py-2 rounded-lg text-[11px] uppercase tracking-[0.2em] flex items-center gap-2" style={{ fontFamily: FM, color: "#1e1b4b" }}>
            <LogOut size={12} /> Гарах
          </button>
        </div>

        <nav className="flex items-center gap-1.5 mb-6 flex-wrap slide-up-delay-2">
          <Tab active={view === "home"} onClick={() => setView("home")} icon={Clock}>Цаг</Tab>
          <Tab active={view === "salary"} onClick={() => setView("salary")} icon={FileSpreadsheet}>Цалин</Tab>
          <Tab active={view === "history"} onClick={() => setView("history")} icon={Calendar}>Түүх</Tab>
          <Tab active={view === "tasks"} onClick={() => setView("tasks")} icon={ClipboardCheck}>Даалгавар</Tab>
          <Tab active={view === "leaves"} onClick={() => setView("leaves")} icon={Calendar}>Чөлөө</Tab>
          <Tab active={view === "requests"} onClick={() => setView("requests")} icon={ClipboardCheck}
               badge={myApprovals.filter((a) => a.status === "pending").length}>Хүсэлт</Tab>
        </nav>

        {view === "home" && (
          <div className="space-y-5 fade-in">
            <div className={`${isActive ? "glass-strong pulse-halo" : "glass"} rounded-3xl p-6 sm:p-8 slide-up`}>
              <div className="flex items-center gap-2 mb-1">
                <span style={{
                  background: isActive ? T.ok : T.muted,
                  boxShadow: isActive ? `0 0 0 5px rgba(16, 185, 129, 0.2)` : "none",
                }}
                      className={`inline-block w-2 h-2 rounded-full ${isActive ? "pulse-dot" : ""}`} />
                <span style={{ fontFamily: FM, color: isActive ? T.ok : T.muted }}
                      className="text-[10px] uppercase tracking-[0.25em] font-medium">
                  {isActive ? "Ажиллаж байна" : "Цагтай биш"}
                </span>
              </div>

              <div className="my-5 sm:my-6">
                <div style={{
                  fontFamily: FM, fontWeight: 500,
                  color: isActive ? T.highlight : T.ink,
                  letterSpacing: "-0.03em",
                  textShadow: isActive ? `0 0 24px rgba(99, 102, 241, 0.4)` : "none",
                }}
                     className="text-6xl sm:text-7xl tabular-nums">
                  {isActive ? fmtClock(liveMs) : "00:00:00"}
                </div>
                {isActive && (
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-xs mt-2 fade-in">
                    {fmtTime(new Date(myActive.start_time).getTime())}-аас эхэлсэн
                  </div>
                )}
              </div>

              {/* Countdown card — show when active and has either flexible site or schedule */}
              {isActive && (() => {
                const now = new Date();
                let endMs = null;
                let endLabel = null;

                // 1) Уян хатан байр — ирсэн цагаас shift_hours дараа
                if (activeSite?.is_flexible && activeSite.shift_hours) {
                  const startMs = new Date(myActive.start_time).getTime();
                  endMs = flexibleSessionEnd(activeSite, startMs);
                  const endDate = new Date(endMs);
                  endLabel = endDate.toTimeString().slice(0, 5);
                }
                // 2) Хатуу хуваарь — profile.schedule_end
                else if (profile.schedule_days?.length) {
                  const dayKey = DAY_KEYS[now.getDay()];
                  if (!profile.schedule_days.includes(dayKey)) return null;
                  endMs = setTimeOnDate(now, profile.schedule_end);
                  endLabel = profile.schedule_end;
                }

                if (!endMs) return null;
                const remainingMs = endMs - now.getTime();
                const isPastEnd = remainingMs <= 0;

                return (
                  <div className="glass-soft scale-up rounded-2xl p-4 mb-5"
                       style={{ borderColor: isPastEnd ? T.warn : T.borderSoft }}>
                    <div style={{ fontFamily: FM, color: T.muted }}
                         className="text-[9px] uppercase tracking-[0.25em] mb-2 flex items-center gap-1.5">
                      <Clock size={10} /> {isPastEnd ? "Ажил дуусаад дараах цаг" : "Ажил дуусахад"}
                      {activeSite?.is_flexible && <span style={{ color: T.highlight, fontWeight: 600 }}>· Уян хатан</span>}
                    </div>
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <div>
                        <div style={{ fontFamily: FM, fontWeight: 500, color: isPastEnd ? T.warn : T.ink, letterSpacing: "-0.02em" }}
                             className="text-3xl sm:text-4xl tabular-nums">
                          {isPastEnd ? "+" + fmtClock(-remainingMs) : fmtClock(remainingMs)}
                        </div>
                        <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] mt-1">
                          {isPastEnd ? "илүү цаг ажилласан" : "цаг · минут · секунд"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.2em] mb-0.5">
                          Цаг буух
                        </div>
                        <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-2xl tabular-nums">
                          {endLabel}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-2 mb-5 pb-5 border-b" style={{ borderColor: T.borderSoft }}>
                <InfoRow icon={MapPin} label="Ажлын байр"
                  value={
                    activeSite ? `${activeSite.name} (одоо)`
                    : mySites.length > 0 ? mySites.map(s => s.name).join(", ")
                    : hasSite(profile) ? `${profile.site_label || `${fmtCoord(profile.site_lat)}, ${fmtCoord(profile.site_lng)}`}`
                    : "Тогтоогоогүй"
                  }
                  warn={mySites.length === 0 && !hasSite(profile)} />
                <InfoRow icon={Clock} label="Цагийн хуваарь"
                  value={profile.schedule_days?.length ? `${profile.schedule_days.map((d) => DAY_LABELS[d]).join("·")} ${profile.schedule_start}–${profile.schedule_end}` : "Хязгааргүй"} />
              </div>

              {feedback && <FeedbackBox type={feedback.type}>{feedback.msg}</FeedbackBox>}
              {!isActive && profile.schedule_days?.length && !sched.ok && (
                <div className="mb-3"><FeedbackBox type="warn">{sched.reason}</FeedbackBox></div>
              )}

              <button onClick={() => isActive ? onClockOut() : onClockIn()}
                disabled={geoBusy || cantClock}
                className={`w-full py-5 sm:py-4 rounded-2xl text-base sm:text-sm font-medium flex items-center justify-center gap-2.5 press-btn ${
                  geoBusy ? "" : isActive ? "glow-danger" : cantClock ? "" : "glow-primary"
                }`}
                style={{
                  fontFamily: FS,
                  background: geoBusy ? T.muted : cantClock ? T.muted : undefined,
                  color: "white",
                  cursor: cantClock ? "not-allowed" : "pointer",
                  opacity: cantClock ? 0.6 : 1,
                }}>
                {geoBusy ? <><Loader2 size={18} className="spin" /> Байршил шалгаж байна…</>
                  : isActive ? <><Square size={16} fill="currentColor" /> Цаг буулгах</>
                  : noSite ? <><MapPin size={16} /> Ажлын байр тогтоогоогүй</>
                  : !sched.ok ? <><Clock size={16} /> Цагийн хязгаараас гадуур</>
                  : <><Play size={16} fill="currentColor" /> Цаг бүртгүүлэх</>}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 slide-up-delay-1">
              <SmallStat label="Өнөөдөр" value={fmtHours(stats.today)} />
              <SmallStat label="Энэ долоо хоног" value={fmtHours(stats.week)} />
              <SmallStat label="Нийт" value={fmtHours(stats.total)} />
            </div>

            <div className="space-y-2">
              <button onClick={() => setShowRequest(true)}
                style={{ borderColor: T.border, color: T.muted, fontFamily: FM }}
                className="w-full py-3 rounded-xl border-dashed border-2 text-[11px] uppercase tracking-[0.2em] hover:bg-black/5 flex items-center justify-center gap-2">
                <FileText size={12} /> Цагаа мартсан уу? Хүсэлт явуул
              </button>
              {isActive && (
                <button onClick={() => setShowEarlyLeave(true)}
                  style={{ borderColor: T.border, color: T.muted, fontFamily: FM }}
                  className="w-full py-3 rounded-xl border-dashed border-2 text-[11px] uppercase tracking-[0.2em] hover:bg-black/5 flex items-center justify-center gap-2">
                  <Send size={12} /> Эрт явах хүсэлт
                </button>
              )}
            </div>
          </div>
        )}

        {view === "salary" && <SalaryView sessions={mySessions} profile={profile} />}
        {view === "history" && <PersonalHistory sessions={mySessions} />}
        {view === "leaves" && (
          <MyLeavesView
            leaves={myLeaves}
            onNew={() => setShowLeaveForm(true)}
            onCancel={async (id) => {
              try {
                await supabase.from("leaves").update({ status: "cancelled" }).eq("id", id);
                setFeedback({ type: "success", msg: "Цуцлагдлаа" });
                await loadMy();
              } catch (e) { setFeedback({ type: "error", msg: e.message }); }
            }} />
        )}

        {view === "tasks" && (
          <MyTasksView
            tasks={myTasks}
            currentUserId={profile.id}
            colleagues={deptColleagues}
            hasDepartment={!!profile.department_id}
            onAdd={() => setEditingTask("add")}
            onEdit={(t) => setEditingTask(t)}
            onDelete={async (id) => {
              try {
                await supabase.from("tasks").delete().eq("id", id);
                setFeedback({ type: "success", msg: "Устгагдлаа" });
                await loadMy();
              } catch (e) { setFeedback({ type: "error", msg: e.message }); }
            }}
            onUpdateStatus={async (taskId, newStatus) => {
              try {
                const { error } = await supabase.from("tasks").update({
                  status: newStatus,
                  completed_at: newStatus === "done" ? new Date().toISOString() : null,
                  updated_at: new Date().toISOString(),
                }).eq("id", taskId);
                if (error) throw error;
                setFeedback({ type: "success", msg: "Шинэчлэгдлээ" });
                await loadMy();
              } catch (e) { setFeedback({ type: "error", msg: e.message }); }
            }} />
        )}
        {view === "requests" && <PersonalRequests approvals={myApprovals} onNew={() => setShowRequest(true)} />}

        <Footer count={mySessions.length} />
      </div>

      {showRequest && (
        <RequestModal profile={profile} onClose={() => setShowRequest(false)} onSubmit={submitRequest} />
      )}

      {showEarlyLeave && (
        <EarlyLeaveModal profile={profile} myActive={myActive}
          onClose={() => setShowEarlyLeave(false)} onSubmit={submitRequest} />
      )}

      {showUnverifiedClockOut && unverifiedSite && (
        <UnverifiedClockOutModal
          distance={unverifiedDistance}
          siteName={unverifiedSite.name || "Ажлын байр"}
          onClose={() => {
            setShowUnverifiedClockOut(false);
            setUnverifiedDistance(null);
            setUnverifiedSite(null);
            setUnverifiedEndLoc(null);
          }}
          onSubmit={submitUnverifiedClockOut} />
      )}

      {showLeaveForm && (
        <LeaveFormModal
          onClose={() => setShowLeaveForm(false)}
          onSubmit={async (data) => {
            try {
              const { error } = await supabase.from("leaves").insert({
                employee_id: profile.id,
                leave_type: data.leave_type,
                start_date: data.start_date,
                end_date: data.end_date,
                reason: data.reason,
                paid: data.paid,
                status: "pending",
              });
              if (error) throw error;
              setShowLeaveForm(false);
              setFeedback({ type: "success", msg: "Чөлөөний хүсэлт илгээгдлээ" });
              await loadMy();
            } catch (e) { setFeedback({ type: "error", msg: e.message }); }
          }} />
      )}

      {editingTask && (
        <TaskFormModal
          mode={editingTask === "add" ? "add" : "edit"}
          task={editingTask === "add" ? null : editingTask}
          departments={profile.department_id ? allDepartments.filter(d => d.id === profile.department_id) : []}
          employees={deptColleagues}
          onSave={async (data) => {
            try {
              if (data.id) {
                const { error } = await supabase.from("tasks").update({
                  title: data.title, description: data.description,
                  status: data.status, priority: data.priority,
                  assignee_id: data.assignee_id, due_date: data.due_date,
                  completed_at: data.status === "done" ? new Date().toISOString() : null,
                  updated_at: new Date().toISOString(),
                }).eq("id", data.id);
                if (error) throw error;
              } else {
                const { error } = await supabase.from("tasks").insert({
                  department_id: profile.department_id || data.department_id,
                  title: data.title, description: data.description,
                  status: "todo", priority: data.priority || "medium",
                  assignee_id: data.assignee_id || profile.id,
                  due_date: data.due_date,
                  created_by: profile.id,
                });
                if (error) throw error;
              }
              setEditingTask(null);
              setFeedback({ type: "success", msg: "Хадгаллаа" });
              await loadMy();
            } catch (e) { setFeedback({ type: "error", msg: e.message }); }
          }}
          onClose={() => setEditingTask(null)} />
      )}

      {showSitePicker && (
        <SitePickerModal
          employee={profile}
          sites={mySites}
          distances={nearestDistances}
          onPick={(siteId) => { setNearestDistances(null); onClockIn(siteId); }}
          onClose={() => { setShowSitePicker(false); setNearestDistances(null); }} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEAM VIEW
// ═══════════════════════════════════════════════════════════════════════════
function TeamView({ employees, sessions, activeSessions, sites = [], employeeSites = [], geoBusyId, feedback, onEdit, onDelete, onClockIn, onClockOut, onAdd }) {
  if (employees.length === 0) {
    return (
      <div style={{ borderColor: T.border, background: T.surface }}
           className="border-2 border-dashed rounded-2xl py-16 px-6 text-center">
        <Users size={32} style={{ color: T.muted }} strokeWidth={1.5} className="mx-auto mb-4" />
        <h3 style={{ fontFamily: FD, fontWeight: 500 }} className="text-2xl mb-2">Багт ажилтан байхгүй байна</h3>
        <p style={{ color: T.muted }} className="text-sm mb-5">Анхны ажилтнаа нэмж тэмдэглэлийг эхлүүлээрэй.</p>
        <button onClick={onAdd} className="glow-primary press-btn px-5 py-2.5 rounded-full text-[11px] uppercase tracking-[0.25em] inline-flex items-center gap-2">
          <Plus size={13} strokeWidth={2.5} /> Эхний ажилтан нэмэх
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {employees.map((emp) => {
        const active = activeSessions[emp.id];
        const isActive = !!active;
        const liveMs = isActive ? capSessionEnd(emp, Date.now()) - new Date(active.start_time).getTime() : 0;
        const fb = feedback?.empId === emp.id ? feedback : null;
        const busy = geoBusyId === emp.id;
        const empSessions = sessions.filter((s) => s.employee_id === emp.id);
        const todayMs = empSessions.filter((s) => new Date(s.start_time).getTime() >= startOfDay())
          .reduce((a, s) => a + (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()), 0)
          + (isActive ? Math.max(0, liveMs) : 0);
        const sched = checkSchedule(emp);
        const myAssignedSites = employeeSites.filter(es => es.employee_id === emp.id).map(es => sites.find(s => s.id === es.site_id)).filter(Boolean);
        const hasAnySite = myAssignedSites.length > 0 || hasSite(emp);
        const noSite = !hasAnySite;
        const cantClock = !isActive && (noSite || !sched.ok);
        const activeSite = isActive && active.site_id ? sites.find(s => s.id === active.site_id) : null;

        return (
          <article key={emp.id}
            className={`${isActive ? "glass-strong pulse-halo" : "glass lift"} rounded-3xl p-5 slide-up`}>
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span style={{
                    background: isActive ? T.ok : T.mutedSoft,
                    boxShadow: isActive ? `0 0 0 4px rgba(16, 185, 129, 0.2)` : "none",
                  }}
                        className={`inline-block w-1.5 h-1.5 rounded-full ${isActive ? "pulse-dot" : ""}`} />
                  <span style={{ fontFamily: FM, color: isActive ? T.ok : T.muted }}
                        className="text-[9px] uppercase tracking-[0.25em] font-medium">
                    {isActive ? "Ажиллаж байна" : "Цагтай биш"}
                  </span>
                </div>
                <h3 style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.02em" }} className="text-xl truncate">{emp.name}</h3>
                <p style={{ color: T.muted }} className="text-xs mt-0.5 truncate">{emp.job_title}</p>
              </div>
              <div className="flex gap-1 -mr-1.5 -mt-1.5">
                <button onClick={() => onEdit(emp)} style={{ color: T.muted }} className="p-1.5 rounded-lg hover:bg-black/5"><Edit3 size={14} /></button>
                <button onClick={() => onDelete(emp.id)} style={{ color: T.muted }} className="p-1.5 rounded-lg hover:bg-black/5"><X size={15} /></button>
              </div>
            </div>

            <div className="text-[10px] flex flex-wrap gap-x-3 gap-y-1 mb-4" style={{ fontFamily: FM, color: T.muted }}>
              <span className="flex items-center gap-1" style={noSite ? { color: T.err } : {}}>
                <MapPin size={10} />
                {noSite ? "байргүй"
                  : myAssignedSites.length > 0 ? `${myAssignedSites.length} байр`
                  : `${emp.site_radius}m`}
              </span>
              <span className="flex items-center gap-1">
                <Clock size={10} />
                {emp.schedule_days?.length ? `${emp.schedule_start}–${emp.schedule_end}` : "хязгааргүй"}
              </span>
              {activeSite && (
                <span style={{ color: T.highlight }} className="flex items-center gap-1">
                  · {activeSite.name}
                </span>
              )}
            </div>

            <div className="rounded-xl px-4 py-3 mb-4" style={{ background: T.surfaceAlt }}>
              <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.25em] mb-1">
                {isActive ? "Одоо ажиллаж байна" : "Өнөөдөр"}
              </div>
              <div style={{ fontFamily: FM, fontWeight: 500, color: isActive ? T.highlight : T.ink }} className="text-3xl tabular-nums">
                {isActive ? fmtClock(liveMs) : `${fmtHours(todayMs)}`}
                {!isActive && <span style={{ fontSize: "0.45em", color: T.muted, marginLeft: 6 }}>цаг</span>}
              </div>
            </div>

            {fb && <div className="mb-3"><FeedbackBox type={fb.type}>{fb.msg}</FeedbackBox></div>}

            <button onClick={() => isActive ? onClockOut(emp) : onClockIn(emp)}
              disabled={busy || cantClock}
              style={{ background: busy ? T.muted : isActive ? T.ink : cantClock ? T.muted : T.highlight,
                       color: T.surface, fontFamily: FS,
                       cursor: cantClock ? "not-allowed" : "pointer", opacity: cantClock ? 0.5 : 1 }}
              className="w-full py-3 rounded-xl text-xs font-medium flex items-center justify-center gap-2 hover:opacity-90">
              {busy ? <><Loader2 size={12} className="animate-spin" /> Шалгаж байна…</>
                : isActive ? <><Square size={11} fill="currentColor" /> Буулгах</>
                : noSite ? <>Байр тогтоох</>
                : !sched.ok ? <>Цагийн гадуур</>
                : <><Play size={11} fill="currentColor" /> Бүртгүүлэх</>}
            </button>
          </article>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  LEDGER, APPROVALS, HISTORY views
// ═══════════════════════════════════════════════════════════════════════════
function LedgerView({ sessions, employees, sites = [], canEdit = false, onEditSession, onDeleteSession }) {
  const [filterType, setFilterType] = useState("thisMonth"); // thisMonth | lastMonth | custom | all
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));
  const [filterEmpId, setFilterEmpId] = useState("all");
  const [filterSiteId, setFilterSiteId] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const empById = (id) => employees.find((e) => e.id === id);
  const siteById = (id) => sites.find((s) => s.id === id);

  // ── filter logic
  const filterRange = useMemo(() => {
    const now = new Date();
    if (filterType === "all") return { start: 0, end: Date.now() + 86400000 };
    if (filterType === "thisMonth") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      return { start, end };
    }
    if (filterType === "lastMonth") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const end = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return { start, end };
    }
    // custom
    const s = new Date(`${customStart}T00:00:00`).getTime();
    const e = new Date(`${customEnd}T23:59:59`).getTime();
    return { start: s, end: e };
  }, [filterType, customStart, customEnd]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const startMs = new Date(s.start_time).getTime();
      if (startMs < filterRange.start || startMs > filterRange.end) return false;
      if (filterEmpId !== "all" && s.employee_id !== filterEmpId) return false;
      if (filterSiteId !== "all" && s.site_id !== filterSiteId) return false;
      return true;
    });
  }, [sessions, filterRange, filterEmpId, filterSiteId]);

  // ── totals
  const totals = useMemo(() => {
    let totalMs = 0, totalPay = 0;
    filteredSessions.forEach((s) => {
      const ms = sessionDurationMs(new Date(s.start_time).getTime(), new Date(s.end_time).getTime());
      totalMs += ms;
      const emp = empById(s.employee_id);
      const rate = emp?.hourly_rate || 0;
      totalPay += (ms / 3600000) * rate;
    });
    return { totalMs, totalPay };
  }, [filteredSessions, employees]);

  // ── filter label
  const filterLabel = useMemo(() => {
    if (filterType === "thisMonth") return "Энэ сар";
    if (filterType === "lastMonth") return "Өнгөрсөн сар";
    if (filterType === "all") return "Бүгд";
    return `${customStart} – ${customEnd}`;
  }, [filterType, customStart, customEnd]);

  // ── Excel export functions
  const formatExcelDate = (ts) => new Date(ts).toLocaleDateString("en-CA"); // YYYY-MM-DD
  const formatExcelTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  const exportDetailed = () => {
    const rows = filteredSessions
      .slice()
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
      .map((s) => {
        const emp = empById(s.employee_id);
        const startMs = new Date(s.start_time).getTime();
        const endMs = new Date(s.end_time).getTime();
        const rawMs = endMs - startMs;
        const cappedMs = sessionDurationMs(startMs, endMs);
        const hours = cappedMs / 3600000;
        const rate = emp?.hourly_rate || 0;
        const site = s.site_id ? siteById(s.site_id) : null;
        return {
          "Огноо": formatExcelDate(startMs),
          "Ажилтан": emp?.name || "(устсан)",
          "Албан тушаал": emp?.job_title || "",
          "Ажлын байр": site?.name || "—",
          "Эхэлсэн": formatExcelTime(startMs),
          "Дууссан": formatExcelTime(endMs),
          "Цаг (нийт)": Number(hours.toFixed(2)),
          "Цагийн хөлс (₮)": rate,
          "Цалин (₮)": Math.round(hours * rate),
          "9ц лимит хүрсэн": rawMs > DAILY_HOUR_LIMIT_MS ? "Тийм" : "Үгүй",
          "Геофенс баталгаажсан": s.start_lat ? "Тийм" : "Үгүй",
          "Гар бичиг (хүсэлтээр)": s.from_approval ? "Тийм" : "Үгүй",
        };
      });

    if (rows.length === 0) {
      alert("Сонгосон хугацаанд бүртгэл алга");
      return;
    }

    // Add total row
    const totalHours = rows.reduce((a, r) => a + r["Цаг (нийт)"], 0);
    const totalPay = rows.reduce((a, r) => a + r["Цалин (₮)"], 0);
    rows.push({});
    rows.push({
      "Огноо": "НИЙТ",
      "Цаг (нийт)": Number(totalHours.toFixed(2)),
      "Цалин (₮)": Math.round(totalPay),
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 10 },
      { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 18 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Дэлгэрэнгүй");
    const fname = `Hours_дэлгэрэнгүй_${filterLabel.replace(/ /g, "_")}.xlsx`;
    XLSX.writeFile(wb, fname);
    setShowExportMenu(false);
  };

  const exportSummary = () => {
    // Group by employee
    const map = {};
    filteredSessions.forEach((s) => {
      const emp = empById(s.employee_id);
      const id = s.employee_id;
      if (!map[id]) {
        map[id] = {
          name: emp?.name || "(устсан)",
          job: emp?.job_title || "",
          rate: emp?.hourly_rate || 0,
          totalMs: 0,
          sessionCount: 0,
        };
      }
      // Лимиттэй цаг тооцох
      map[id].totalMs += sessionDurationMs(new Date(s.start_time).getTime(), new Date(s.end_time).getTime());
      map[id].sessionCount += 1;
    });

    const rows = Object.values(map).map((e) => {
      const hours = e.totalMs / 3600000;
      return {
        "Ажилтан": e.name,
        "Албан тушаал": e.job,
        "Сэшний тоо": e.sessionCount,
        "Нийт цаг": Number(hours.toFixed(2)),
        "Цагийн хөлс (₮)": e.rate,
        "Нийт цалин (₮)": Math.round(hours * e.rate),
      };
    }).sort((a, b) => b["Нийт цаг"] - a["Нийт цаг"]);

    if (rows.length === 0) {
      alert("Сонгосон хугацаанд бүртгэл алга");
      return;
    }

    // Total row
    const totalHours = rows.reduce((a, r) => a + r["Нийт цаг"], 0);
    const totalPay = rows.reduce((a, r) => a + r["Нийт цалин (₮)"], 0);
    rows.push({});
    rows.push({
      "Ажилтан": "НИЙТ",
      "Нийт цаг": Number(totalHours.toFixed(2)),
      "Нийт цалин (₮)": Math.round(totalPay),
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Нэгтгэсэн");
    const fname = `Hours_нэгтгэсэн_${filterLabel.replace(/ /g, "_")}.xlsx`;
    XLSX.writeFile(wb, fname);
    setShowExportMenu(false);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setShowFilters((v) => !v)}
              style={{ borderColor: T.border, fontFamily: FM, background: showFilters ? T.surfaceAlt : "transparent" }}
              className="px-3 py-1.5 rounded-full border text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5 hover:bg-black/5">
              <Filter size={11} /> {filterLabel}
              {filterEmpId !== "all" && <span style={{ color: T.highlight }}>· {empById(filterEmpId)?.name}</span>}
            </button>
            <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em]">
              {filteredSessions.length} бүртгэл · {fmtHours(totals.totalMs)} цаг
              {totals.totalPay > 0 && ` · ₮${Math.round(totals.totalPay).toLocaleString()}`}
            </span>
          </div>

          <div className="relative">
            <button onClick={() => setShowExportMenu((v) => !v)}
              disabled={filteredSessions.length === 0}
              style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn px-3.5 py-1.5 rounded-full text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5 disabled:opacity-40">
              <Download size={11} /> Excel татах
            </button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowExportMenu(false)} />
                <div className="glass-strong absolute right-0 mt-2 w-64 rounded-2xl z-40 overflow-hidden scale-up">
                  <button onClick={exportSummary}
                    className="w-full px-4 py-3 text-left hover:bg-black/5 flex items-start gap-2.5 border-b"
                    style={{ borderColor: T.borderSoft }}>
                    <FileSpreadsheet size={16} style={{ color: T.highlight }} className="mt-0.5 shrink-0" />
                    <div>
                      <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-xs">Нэгтгэсэн тайлан</div>
                      <div style={{ color: T.muted }} className="text-[10px] mt-0.5">Ажилтан тус бүрийн нийт цаг + цалин</div>
                    </div>
                  </button>
                  <button onClick={exportDetailed}
                    className="w-full px-4 py-3 text-left hover:bg-black/5 flex items-start gap-2.5">
                    <FileText size={16} style={{ color: T.highlight }} className="mt-0.5 shrink-0" />
                    <div>
                      <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-xs">Дэлгэрэнгүй тайлан</div>
                      <div style={{ color: T.muted }} className="text-[10px] mt-0.5">Сэшн бүр мөр болж, бүх тоо орно</div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Expanded filter panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: T.borderSoft }}>
            <div>
              <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.2em] mb-2">
                Хугацаа
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: "thisMonth", label: "Энэ сар" },
                  { id: "lastMonth", label: "Өнгөрсөн сар" },
                  { id: "all", label: "Бүгд" },
                  { id: "custom", label: "Гар сонголт" },
                ].map((opt) => (
                  <button key={opt.id} onClick={() => setFilterType(opt.id)}
                    style={{ background: filterType === opt.id ? T.ink : "transparent",
                             color: filterType === opt.id ? T.surface : T.ink,
                             borderColor: filterType === opt.id ? T.ink : T.border,
                             fontFamily: FM }}
                    className="px-3 py-1 text-[10px] uppercase tracking-[0.2em] border rounded-full hover:opacity-80">
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {filterType === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Эхлэх</Label>
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                    style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-black" />
                </div>
                <div>
                  <Label>Дуусах</Label>
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                    style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-black" />
                </div>
              </div>
            )}

            <div>
              <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.2em] mb-2">
                Ажилтан
              </div>
              <select value={filterEmpId} onChange={(e) => setFilterEmpId(e.target.value)}
                style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-black">
                <option value="all">Бүх ажилтан</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>

            {sites.length > 0 && (
              <div>
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.2em] mb-2">
                  Ажлын байр
                </div>
                <select value={filterSiteId} onChange={(e) => setFilterSiteId(e.target.value)}
                  style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-black">
                  <option value="all">Бүх байр</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sessions list */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b" style={{ borderColor: T.borderSoft }}>
          <h2 style={{ fontFamily: FD, fontWeight: 500 }} className="text-xl">Цагийн тэмдэглэл</h2>
          <p style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] mt-0.5">
            {filteredSessions.length} бүртгэл · {filterLabel}
          </p>
        </div>
        {filteredSessions.length === 0 ? (
          <div className="px-6 py-14 text-center" style={{ color: T.muted }}>
            <p className="text-base">Сонгосон хугацаанд бүртгэл алга</p>
          </div>
        ) : (
          <ul>
            {filteredSessions.slice(0, 100).map((s, i) => {
              const e = empById(s.employee_id);
              const startMs = new Date(s.start_time).getTime();
              const endMs = new Date(s.end_time).getTime();
              return (
                <li key={s.id} className="px-5 sm:px-6 py-3.5 flex items-center gap-4 flex-wrap"
                    style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderSoft}` }}>
                  <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-wider w-16 shrink-0">
                    {fmtDate(startMs)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-sm truncate">
                      {e ? e.name : <span style={{ color: T.muted, fontStyle: "italic" }}>(устсан)</span>}
                    </div>
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span>{fmtTime(startMs)} → {fmtTime(endMs)}</span>
                      {s.site_id && siteById(s.site_id) && <span>· {siteById(s.site_id).name}</span>}
                      {s.start_lat && <span>· баталгаажсан</span>}
                      {s.from_approval && <span>· гар бичиг</span>}
                      {s.edited_at && <span style={{ color: T.warn }}>· засагдсан</span>}
                      {s.out_verification_status === "pending" && (
                        <span style={{ color: T.warn, fontWeight: 500 }}>· ⚠ баталгаажуулаагүй</span>
                      )}
                      {s.out_verification_status === "rejected" && (
                        <span style={{ color: T.err, fontWeight: 500 }}>· ❌ татгалзсан</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-base tabular-nums">
                      {fmtHours(endMs - startMs)}
                    </div>
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider">цаг</div>
                  </div>
                  {canEdit && onEditSession && (
                    <button onClick={() => onEditSession(s)}
                      style={{ color: T.muted }}
                      className="p-1.5 rounded-lg hover:bg-black/5">
                      <Edit3 size={14} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {filteredSessions.length > 100 && (
          <div className="px-6 py-3 text-center border-t" style={{ borderColor: T.borderSoft, color: T.muted, fontFamily: FM }}>
            <span className="text-[10px] uppercase tracking-[0.2em]">
              Жагсаалтад 100 / {filteredSessions.length} харагдаж байна · бүгдийг Excel-ээр татна уу
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalsView({ approvals, employees, onResolve }) {
  const [tab, setTab] = useState("pending");
  const empById = (id) => employees.find((e) => e.id === id);
  const list = approvals.filter((a) => tab === "pending" ? a.status === "pending" : a.status !== "pending");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setTab("pending")}
          style={{ background: tab === "pending" ? T.ink : "transparent", color: tab === "pending" ? T.surface : T.ink,
                   borderColor: tab === "pending" ? T.ink : T.border, fontFamily: FM }}
          className="px-4 py-1.5 rounded-full border text-[10px] uppercase tracking-[0.2em]">
          Хүлээгдэж буй ({approvals.filter((a) => a.status === "pending").length})
        </button>
        <button onClick={() => setTab("history")}
          style={{ background: tab === "history" ? T.ink : "transparent", color: tab === "history" ? T.surface : T.ink,
                   borderColor: tab === "history" ? T.ink : T.border, fontFamily: FM }}
          className="px-4 py-1.5 rounded-full border text-[10px] uppercase tracking-[0.2em]">
          Шийдэгдсэн
        </button>
      </div>

      {list.length === 0 ? (
        <div className="glass rounded-3xl py-12 px-6 text-center" style={{ color: T.muted }}>
          <Inbox size={28} className="mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm">{tab === "pending" ? "Хүлээгдэж буй хүсэлт алга" : "Шийдэгдсэн хүсэлт алга"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((a) => {
            const emp = empById(a.employee_id);
            const startMs = new Date(a.proposed_start).getTime();
            const endMs = new Date(a.proposed_end).getTime();
            return (
              <div key={a.id} className="glass lift rounded-3xl p-5 slide-up">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{
                        background: a.kind === "early_leave" ? T.warnSoft : T.highlightSoft,
                        color: a.kind === "early_leave" ? T.warn : T.highlight,
                        fontFamily: FM,
                      }}
                        className="px-2 py-0.5 rounded-full text-[9px] uppercase tracking-[0.2em] font-medium">
                        {a.kind === "early_leave" ? "Эрт явах" : "Цаг мартсан"}
                      </span>
                    </div>
                    <div style={{ fontFamily: FD, fontWeight: 500 }} className="text-lg">{emp?.name || "(устсан)"}</div>
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] mt-0.5">
                      {fmtFullDate(new Date(a.created_at).getTime())}
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
                <div className="rounded-xl p-3 mb-3" style={{ background: T.surfaceAlt }}>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-0.5">Огноо</div>
                      <div style={{ fontFamily: FM }} className="text-xs">{fmtDate(startMs)}</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-0.5">Цаг</div>
                      <div style={{ fontFamily: FM }} className="text-xs">{fmtTime(startMs)} → {fmtTime(endMs)}</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-0.5">Хугацаа</div>
                      <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-xs">{fmtHours(endMs - startMs)} цаг</div>
                    </div>
                  </div>
                  {a.reason && (
                    <div className="mt-3 pt-3 border-t" style={{ borderColor: T.borderSoft }}>
                      <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-1">Тайлбар</div>
                      <div className="text-xs leading-relaxed">{a.reason}</div>
                    </div>
                  )}
                </div>
                {a.status === "pending" ? (
                  <div className="flex gap-2">
                    <button onClick={() => onResolve(a, "denied")}
                      className="glass-soft press-btn flex-1 py-2.5 rounded-xl text-xs font-medium"
                      style={{ fontFamily: FS, color: T.ink }}>
                      Татгалзах
                    </button>
                    <button onClick={() => onResolve(a, "approved")}
                      className="glow-success press-btn flex-1 py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
                      style={{ fontFamily: FS }}>
                      <CheckCircle2 size={13} /> Зөвшөөрөх
                    </button>
                  </div>
                ) : (
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em]">
                    {a.status === "approved" ? "Зөвшөөрсөн" : "Татгалзсан"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PersonalHistory({ sessions }) {
  return (
    <div className="glass rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b" style={{ borderColor: T.borderSoft }}>
        <h2 style={{ fontFamily: FD, fontWeight: 500 }} className="text-lg">Ажилласан түүх</h2>
        <p style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] mt-0.5">
          Нийт {sessions.length} бүртгэл
        </p>
      </div>
      {sessions.length === 0 ? (
        <div className="px-6 py-12 text-center" style={{ color: T.muted }}><p className="text-sm">Бүртгэл алга</p></div>
      ) : (
        <ul>
          {sessions.map((s, i) => {
            const startMs = new Date(s.start_time).getTime();
            const endMs = new Date(s.end_time).getTime();
            return (
              <li key={s.id} className="px-5 py-3.5 flex items-center gap-4"
                  style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderSoft}` }}>
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-wider w-16 shrink-0">
                  {fmtDate(startMs)}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontFamily: FM }} className="text-xs">{fmtTime(startMs)} → {fmtTime(endMs)}</div>
                  {s.from_approval && <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-0.5">гар бичиг</div>}
                </div>
                <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-base tabular-nums">
                  {fmtHours(endMs - startMs)}
                  <span style={{ color: T.muted, fontSize: "0.6em", marginLeft: 3 }}>ц</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PersonalRequests({ approvals, onNew }) {
  return (
    <div className="space-y-4">
      <button onClick={onNew} style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
        <Plus size={14} /> Шинэ хүсэлт явуулах
      </button>
      {approvals.length === 0 ? (
        <div className="glass rounded-3xl py-10 px-6 text-center" style={{ color: T.muted }}>
          <p className="text-sm">Илгээсэн хүсэлт алга</p>
        </div>
      ) : (
        <div className="space-y-2">
          {approvals.map((a) => {
            const startMs = new Date(a.proposed_start).getTime();
            const endMs = new Date(a.proposed_end).getTime();
            return (
              <div key={a.id} className="glass lift rounded-2xl p-4 slide-up">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{
                        background: a.kind === "early_leave" ? T.warnSoft : T.highlightSoft,
                        color: a.kind === "early_leave" ? T.warn : T.highlight,
                        fontFamily: FM,
                      }}
                        className="px-2 py-0.5 rounded-full text-[9px] uppercase tracking-[0.2em] font-medium">
                        {a.kind === "early_leave" ? "Эрт явах" : "Цаг мартсан"}
                      </span>
                    </div>
                    <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-sm">
                      {fmtDate(startMs)} · {fmtTime(startMs)}–{fmtTime(endMs)}
                    </div>
                    <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-wider mt-0.5">
                      {fmtHours(endMs - startMs)} цаг
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
                {a.reason && <p style={{ color: T.muted }} className="text-xs leading-relaxed">{a.reason}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  EMPLOYEE FORM MODAL
// ═══════════════════════════════════════════════════════════════════════════
function EmployeeFormModal({ mode, employee, sites = [], assignedSiteIds = [], departments = [], onSave, onClose }) {
  const [name, setName] = useState(employee?.name || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [jobTitle, setJobTitle] = useState(employee?.job_title || "");
  const [rate, setRate] = useState(employee?.hourly_rate ? String(employee.hourly_rate) : "");
  const [role, setRole] = useState(employee?.role || "employee"); // employee | manager
  const [departmentId, setDepartmentId] = useState(employee?.department_id || "");

  // Multi-site assignment
  const [selectedSiteIds, setSelectedSiteIds] = useState(assignedSiteIds);
  const [siteSearch, setSiteSearch] = useState("");

  // Legacy single-site (still kept as fallback)
  const [site, setSite] = useState(hasSite(employee) ? { lat: employee.site_lat, lng: employee.site_lng, accuracy: null } : null);
  const [siteLabel, setSiteLabel] = useState(employee?.site_label || "");
  const [radius, setRadius] = useState(employee?.site_radius || 100);
  const [siteBusy, setSiteBusy] = useState(false);
  const [siteError, setSiteError] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [manLat, setManLat] = useState(""); const [manLng, setManLng] = useState("");
  const [showLegacy, setShowLegacy] = useState(hasSite(employee));

  const [days, setDays] = useState(employee?.schedule_days || ["MO", "TU", "WE", "TH", "FR"]);
  const [startTime, setStartTime] = useState(employee?.schedule_start || "09:00");
  const [endTime, setEndTime] = useState(employee?.schedule_end || "17:00");
  const [hasSchedule, setHasSchedule] = useState(!!employee?.schedule_days?.length);

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const captureSite = async () => {
    setSiteBusy(true); setSiteError("");
    try {
      const loc = await getLocation();
      setSite({ lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy });
    } catch (e) { setSiteError(e.message); } finally { setSiteBusy(false); }
  };
  const applyManual = () => {
    const lat = parseFloat(manLat), lng = parseFloat(manLng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180)
      return setSiteError("Зөв координат оруулна уу");
    setSite({ lat, lng });
    setSiteError("");
  };

  const toggleSite = (siteId) => {
    setSelectedSiteIds((curr) =>
      curr.includes(siteId) ? curr.filter((id) => id !== siteId) : [...curr, siteId]
    );
  };

  const filteredSites = useMemo(() => {
    if (!siteSearch.trim()) return sites;
    const q = siteSearch.toLowerCase();
    return sites.filter((s) => s.name.toLowerCase().includes(q));
  }, [sites, siteSearch]);

  const submit = async () => {
    setErr("");
    if (!name.trim()) return setErr("Нэр оруулна уу");
    if (mode === "add") {
      if (!email.trim() || !email.includes("@")) return setErr("Зөв имэйл оруулна уу");
      if (password.length < 6) return setErr("Нууц үг доод тал нь 6 тэмдэгт");
    }
    if (hasSchedule && days.length === 0) return setErr("Ажлын өдөр сонгоно уу");

    setBusy(true);
    const formData = {
      email: email.trim(), name: name.trim(),
      role, // employee | manager
      department_id: departmentId || null,
      job_title: jobTitle.trim() || (role === "manager" ? "Ахлагч" : "Ажилтан"),
      hourly_rate: parseFloat(rate) || 0,
      site_lat: showLegacy && site?.lat ? site.lat : null,
      site_lng: showLegacy && site?.lng ? site.lng : null,
      site_radius: showLegacy && site ? radius : null,
      site_label: showLegacy && site ? (siteLabel.trim() || null) : null,
      schedule_days: hasSchedule ? days : null,
      schedule_start: hasSchedule ? startTime : null,
      schedule_end: hasSchedule ? endTime : null,
    };

    await onSave({
      formData, password,
      isNew: mode === "add", existingId: employee?.id,
      siteIds: selectedSiteIds,
    });
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={mode === "add" ? "Шинэ ажилтан" : "Ажилтан засварлах"}>
      <div className="space-y-5">
        <Section title="Хувийн мэдээлэл">
          <Field label="Нэр" required>
            <Input value={name} onChange={setName} placeholder="Бат-Эрдэнэ" autoFocus />
          </Field>
          {mode === "add" && (
            <>
              <Field label="Имэйл" required>
                <Input value={email} onChange={setEmail} placeholder="bat@example.com" />
              </Field>
              <Field label="Эхний нууц үг" required>
                <PwInput value={password} onChange={setPassword} />
              </Field>
            </>
          )}

          <div>
            <Label>Эрх</Label>
            <div className="flex gap-1.5">
              <button onClick={() => setRole("employee")}
                style={{ background: role === "employee" ? T.ink : "transparent",
                         color: role === "employee" ? T.surface : T.ink,
                         borderColor: role === "employee" ? T.ink : T.border, fontFamily: FM }}
                className="flex-1 px-3 py-2 text-[10px] uppercase tracking-[0.2em] border rounded-lg hover:opacity-80">
                Ажилтан
              </button>
              <button onClick={() => setRole("manager")}
                style={{ background: role === "manager" ? T.ink : "transparent",
                         color: role === "manager" ? T.surface : T.ink,
                         borderColor: role === "manager" ? T.ink : T.border, fontFamily: FM }}
                className="flex-1 px-3 py-2 text-[10px] uppercase tracking-[0.2em] border rounded-lg hover:opacity-80">
                Ахлагч
              </button>
            </div>
            {role === "manager" && (
              <p style={{ color: T.muted }} className="text-[11px] mt-1.5">
                Ахлагч өөрийн багт оноосон ажилтнуудыг хардаг. Багийг "Ахлагчид" табаас оноодог.
              </p>
            )}
          </div>

          {departments.length > 0 && (
            <div>
              <Label>Хэлтэс</Label>
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
                style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black">
                <option value="">— Сонгоогүй —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <p style={{ color: T.muted }} className="text-[11px] mt-1.5">
                Хэлтэст оруулсны дараа тэр хэлтсийн ахлагч автомат хариуцна
              </p>
            </div>
          )}

          <Field label="Албан тушаал">
            <Input value={jobTitle} onChange={setJobTitle} placeholder="Дизайнер" />
          </Field>
          <Field label="Цагийн хөлс (заавал биш)">
            <div className="relative">
              <span style={{ color: T.muted, fontFamily: FM }} className="absolute left-3 top-1/2 -translate-y-1/2 text-sm">₮</span>
              <input value={rate} type="number" step="100" onChange={(e) => setRate(e.target.value)} placeholder="0"
                style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                className="w-full pl-8 pr-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
            </div>
          </Field>
        </Section>

        <Section title="Ажлын байр" subtitle="Ажилтан зөвхөн оноосон байрандаа цаг бүртгүүлнэ. Олон сонгож болно.">
          {sites.length === 0 ? (
            <div style={{ background: T.warnSoft, color: T.warn }} className="px-3 py-2.5 rounded-lg text-xs">
              Эхлээд "Байрууд" таб дотор ажлын байр үүсгээрэй.
            </div>
          ) : (
            <>
              {sites.length > 5 && (
                <Input value={siteSearch} onChange={setSiteSearch} placeholder="Байр хайх..." />
              )}
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {filteredSites.map((s) => {
                  const checked = selectedSiteIds.includes(s.id);
                  return (
                    <button key={s.id} onClick={() => toggleSite(s.id)}
                      style={{
                        background: checked ? T.highlightSoft : T.surface,
                        borderColor: checked ? T.highlight : T.border,
                      }}
                      className="w-full text-left px-3 py-2.5 rounded-lg border flex items-center gap-3 hover:bg-black/5 transition-colors">
                      <div style={{
                        background: checked ? T.highlight : "transparent",
                        borderColor: checked ? T.highlight : T.border,
                      }}
                        className="w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center">
                        {checked && <CheckCircle2 size={12} style={{ color: T.surface }} strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-sm truncate">{s.name}</div>
                        <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-0.5">
                          {fmtCoord(s.lat)}, {fmtCoord(s.lng)} · {s.radius}m
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {selectedSiteIds.length > 0 && (
                <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] pt-1">
                  {selectedSiteIds.length} байр сонгогдсон
                </div>
              )}
            </>
          )}

          <details className="mt-3" open={showLegacy}>
            <summary style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] cursor-pointer hover:opacity-70">
              Хувийн байр тохируулах (хуучин арга)
            </summary>
            <div className="mt-3 pt-3 border-t" style={{ borderColor: T.borderSoft }}>
              <p style={{ color: T.muted }} className="text-[11px] mb-3">
                Хувийн байрыг зөвхөн нэг ажилтанд хэрэгтэй бол эндээс тохируулна. "Байрууд" таб дахь нийтлэг байруудыг ашиглах нь илүү тохиромжтой.
              </p>
              {!site ? (
                <div className="space-y-2">
                  <button onClick={captureSite} disabled={siteBusy}
                    style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                    {siteBusy ? <><Loader2 size={12} className="animate-spin" /> Тогтоож байна…</>
                              : <><Crosshair size={12} /> Одоогийн байршил ашиглах</>}
                  </button>
                  <button onClick={() => setShowManual((v) => !v)} style={{ color: T.muted, fontFamily: FM }}
                    className="w-full text-[10px] uppercase tracking-[0.2em] hover:opacity-70 py-1">
                    {showManual ? "− Гар оруулга нуух" : "+ Координат гараар оруулах"}
                  </button>
                  {showManual && (
                    <div style={{ borderColor: T.border }} className="p-3 rounded-lg border-dashed border space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input value={manLat} onChange={(e) => setManLat(e.target.value)} placeholder="Latitude"
                          style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", fontFamily: FM }}
                          className="px-3 py-2 rounded-md border text-xs outline-none" />
                        <input value={manLng} onChange={(e) => setManLng(e.target.value)} placeholder="Longitude"
                          style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", fontFamily: FM }}
                          className="px-3 py-2 rounded-md border text-xs outline-none" />
                      </div>
                      <button onClick={applyManual} style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn w-full py-1.5 rounded-md text-[10px] uppercase tracking-[0.2em]">
                        Координат хэрэглэх
                      </button>
                    </div>
                  )}
                  {siteError && <ErrorBox>{siteError}</ErrorBox>}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="px-3 py-2.5 rounded-lg flex items-start gap-2.5" style={{ background: T.okSoft, color: T.ok }}>
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div style={{ fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] font-medium">Тогтоогдсон</div>
                      <div style={{ fontFamily: FM, color: T.ink }} className="text-[11px] mt-0.5 truncate">
                        {fmtCoord(site.lat)}, {fmtCoord(site.lng)}
                        {site.accuracy && ` · ±${Math.round(site.accuracy)}m`}
                      </div>
                    </div>
                    <button onClick={() => { setSite(null); setSiteLabel(""); setShowLegacy(false); }} style={{ color: T.ok }}
                            className="p-1 hover:opacity-70"><X size={13} /></button>
                  </div>
                  <Field label="Байрны нэр (заавал биш)">
                    <Input value={siteLabel} onChange={setSiteLabel} placeholder="Гол оффис" />
                  </Field>
                  <div>
                    <Label>Зөвшөөрөгдөх радиус</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {RADII.map((r) => (
                        <button key={r} onClick={() => setRadius(r)}
                          style={{ background: radius === r ? T.ink : "transparent", color: radius === r ? T.surface : T.ink,
                                   borderColor: radius === r ? T.ink : T.border, fontFamily: FM }}
                          className="px-3 py-1 text-[10px] uppercase tracking-wider border rounded-full hover:opacity-80">
                          {r >= 1000 ? `${r/1000}km` : `${r}m`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </details>
        </Section>

        <Section title="Цагийн хуваарь" subtitle="Зөвхөн энэ хугацаанд цаг бүртгүүлэх, илүү цаг тооцохгүй">
          <label className="flex items-center gap-2 text-xs cursor-pointer mb-3" style={{ color: T.muted, fontFamily: FM }}>
            <input type="checkbox" checked={hasSchedule} onChange={(e) => setHasSchedule(e.target.checked)} />
            Цагийн хуваарьтай
          </label>
          {hasSchedule && (
            <div className="space-y-3">
              <div>
                <Label>Ажлын өдрүүд</Label>
                <div className="flex gap-1">
                  {DAY_KEYS.map((dk) => {
                    const on = days.includes(dk);
                    return (
                      <button key={dk} onClick={() => setDays(on ? days.filter((d) => d !== dk) : [...days, dk])}
                        style={{ background: on ? T.ink : "transparent", color: on ? T.surface : T.ink,
                                 borderColor: on ? T.ink : T.border, fontFamily: FM }}
                        className="flex-1 py-2 text-[10px] uppercase tracking-wider border rounded-md hover:opacity-80">
                        {DAY_LABELS[dk]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Эхлэх">
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                    style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                    className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
                </Field>
                <Field label="Дуусах">
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                    style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                    className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
                </Field>
              </div>
            </div>
          )}
        </Section>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium">Цуцлах</button>
          <button onClick={submit} disabled={busy}
            style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 size={13} className="animate-spin" />}
            {mode === "add" ? "Нэмэх" : "Хадгалах"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RequestModal({ profile, onClose, onSubmit }) {
  const today = new Date();
  const isoDate = today.toISOString().slice(0, 10);
  const [date, setDate] = useState(isoDate);
  const [start, setStart] = useState(profile.schedule_start || "09:00");
  const [end, setEnd] = useState(profile.schedule_end || "17:00");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    if (!reason.trim()) return setErr("Тайлбар бичнэ үү");
    const startTs = new Date(`${date}T${start}:00`).getTime();
    const endTs = new Date(`${date}T${end}:00`).getTime();
    if (isNaN(startTs) || isNaN(endTs)) return setErr("Огноо/цаг буруу");
    if (endTs <= startTs) return setErr("Дуусах цаг эхлэхээс хойш байх ёстой");
    if (startTs > Date.now()) return setErr("Ирээдүйн огноо болохгүй");
    setBusy(true);
    await onSubmit({ start: startTs, end: endTs, reason: reason.trim() });
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="Цагийн хүсэлт" maxW="max-w-md">
      <div className="space-y-4">
        <p style={{ color: T.muted }} className="text-xs leading-relaxed">
          Цагаа бүртгүүлж амжаагүй бол энд хүсэлт явуулна уу. Админ зөвшөөрсөн тохиолдолд тэмдэглэлд орно.
        </p>
        <Field label="Огноо">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={isoDate}
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Эхэлсэн цаг">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
          </Field>
          <Field label="Дууссан цаг">
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
          </Field>
        </div>
        <Field label="Шалтгаан / тайлбар" required>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="Жишээ: Утас цэнэглэгдээгүй байсан тул цаг бүртгүүлж амжсангүй"
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FS }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black resize-none" />
        </Field>
        {err && <ErrorBox>{err}</ErrorBox>}
        <div className="flex gap-3">
          <button onClick={onClose} style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium">Цуцлах</button>
          <button onClick={submit} disabled={busy}
            style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Илгээх
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ConfirmDeleteModal({ name, onCancel, onConfirm }) {
  return (
    <Modal onClose={onCancel} title="Ажилтан устгах уу?" maxW="max-w-sm">
      <p style={{ color: T.muted }} className="text-sm mb-5">
        <span style={{ color: T.ink, fontWeight: 500 }}>{name}</span>-ийн профайл болон бүртгэлүүд устах болно.
      </p>
      <div className="flex gap-3">
        <button onClick={onCancel} style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn flex-1 py-2.5 rounded-xl text-sm">Цуцлах</button>
        <button onClick={onConfirm} style={{ background: T.err, color: T.surface, fontFamily: FS }}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 flex items-center justify-center gap-1.5">
          <Trash2 size={12} /> Устгах
        </button>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  REUSABLE UI
// ═══════════════════════════════════════════════════════════════════════════
function Modal({ children, onClose, title, maxW = "max-w-lg" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
         style={{ background: "rgba(30, 27, 75, 0.4)" }}
         onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className={`glass-strong modal-content rounded-3xl p-6 w-full ${maxW} max-h-[92vh] overflow-y-auto`}>
        {title && (
          <div className="flex items-center justify-between mb-5">
            <h3 style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.02em" }} className="text-2xl">{title}</h3>
            <button onClick={onClose} style={{ color: T.muted }} className="p-1.5 rounded-full hover:bg-black/10 press-btn">
              <X size={17} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div>
      <div className="mb-3 pb-2 border-b" style={{ borderColor: T.borderSoft }}>
        <h4 style={{ fontFamily: FM, color: T.ink }} className="text-[11px] uppercase tracking-[0.25em] font-medium">{title}</h4>
        {subtitle && <p style={{ color: T.muted }} className="text-[11px] mt-1">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <Label>{label}{required && <span style={{ color: T.err }}> *</span>}</Label>
      {children}
    </label>
  );
}

function Label({ children }) {
  return (
    <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.2em] mb-1.5">{children}</div>
  );
}

function Input({ value, onChange, placeholder, autoFocus, onEnter, id }) {
  return (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter && onEnter()}
      placeholder={placeholder} autoFocus={autoFocus}
      style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FS }}
      className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
  );
}

function PwInput({ value, onChange, onEnter, id }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter && onEnter()}
        style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
        className="w-full px-3 py-2.5 pr-10 rounded-lg border text-sm outline-none focus:border-black" />
      <button onClick={() => setShow((v) => !v)} type="button" style={{ color: T.muted }}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-black/5">
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function ErrorBox({ children }) {
  return (
    <div className="glass-soft scale-up px-4 py-2.5 rounded-xl flex items-start gap-2"
         style={{
           background: "rgba(239, 68, 68, 0.12)",
           color: T.err,
           borderColor: "rgba(239, 68, 68, 0.25)",
         }}>
      <AlertCircle size={13} className="mt-0.5 shrink-0" />
      <span style={{ fontFamily: FM }} className="text-[11px] leading-snug">{children}</span>
    </div>
  );
}

function FeedbackBox({ type, children }) {
  const colors = type === "error" ? { bg: "rgba(239, 68, 68, 0.12)", fg: T.err, Icon: AlertCircle }
              : type === "warn"  ? { bg: "rgba(245, 158, 11, 0.15)", fg: T.warn, Icon: AlertCircle }
              : { bg: "rgba(16, 185, 129, 0.12)", fg: T.ok, Icon: CheckCircle2 };
  const { Icon } = colors;
  return (
    <div className="slide-up px-4 py-2.5 rounded-xl flex items-start gap-2 mb-3 backdrop-blur-md"
         style={{
           background: colors.bg,
           color: colors.fg,
           border: `1px solid ${colors.fg}22`,
           boxShadow: `0 4px 16px ${colors.fg}15`,
         }}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <span style={{ fontFamily: FM }} className="text-[11px] leading-snug">{children}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending: { bg: T.warnSoft, fg: T.warn, label: "Хүлээгдэж буй" },
    approved: { bg: T.okSoft, fg: T.ok, label: "Зөвшөөрсөн" },
    denied: { bg: T.errSoft, fg: T.err, label: "Татгалзсан" },
  };
  const m = map[status] || map.pending;
  return (
    <span style={{ background: m.bg, color: m.fg, fontFamily: FM }}
          className="px-2 py-1 rounded-full text-[9px] uppercase tracking-[0.2em] font-medium shrink-0">
      {m.label}
    </span>
  );
}

function Tab({ active, onClick, icon: Icon, badge, children }) {
  return (
    <button onClick={onClick}
      className={`${active ? "tab-active" : "tab-inactive glass-soft"} press-btn px-3.5 py-1.5 rounded-full border text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5`}
      style={{ fontFamily: FM, borderColor: active ? "transparent" : T.borderSoft }}>
      <Icon size={11} strokeWidth={2} />
      {children}
      {badge > 0 && (
        <span style={{
          background: active ? "rgba(255,255,255,0.95)" : T.highlight,
          color: active ? T.highlight : "white",
          boxShadow: active ? "none" : "0 2px 8px rgba(99,102,241,0.4)",
        }}
              className="ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold tabular-nums">{badge}</span>
      )}
    </button>
  );
}

function BigStat({ label, value, suffix, accent }) {
  return (
    <div className="glass lift rounded-2xl px-5 py-4">
      <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.25em] mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span style={{ fontFamily: FD, fontWeight: 500, color: accent ? T.highlight : T.ink, letterSpacing: "-0.03em" }}
              className="text-3xl tabular-nums">{value}</span>
        {suffix && <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider">{suffix}</span>}
      </div>
    </div>
  );
}

function SmallStat({ label, value }) {
  return (
    <div className="glass-soft rounded-xl p-3">
      <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.2em] mb-1">{label}</div>
      <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-lg tabular-nums">
        {value}<span style={{ color: T.muted, fontSize: "0.55em", marginLeft: 3 }}>ц</span>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, warn }) {
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <Icon size={12} style={{ color: warn ? T.err : T.muted }} strokeWidth={2} />
      <span style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.2em] w-24 shrink-0">{label}</span>
      <span style={{ fontFamily: FM, color: warn ? T.err : T.ink }} className="text-[11px] truncate flex-1">{value}</span>
    </div>
  );
}

function Footer({ count }) {
  return (
    <footer className="mt-12 pt-5 border-t flex items-center justify-between flex-wrap gap-2"
            style={{ borderColor: T.border, color: T.muted, fontFamily: FM }}>
      <span className="text-[10px] uppercase tracking-[0.2em]">Supabase · {count} бүртгэл</span>
      <span className="text-[10px] uppercase tracking-[0.2em] italic" style={{ fontFamily: FD }}>tempus fugit</span>
    </footer>
  );
}

function CenterCard({ children }) {
  return (
    <div style={{ color: T.ink, fontFamily: FS }} className="min-h-screen flex items-center justify-center p-5">
      <div className="glass rounded-2xl p-7 w-full max-w-md text-center">
        {children}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div style={{ color: T.ink, fontFamily: FS }} className="min-h-screen flex items-center justify-center">
      <Loader2 size={20} className="animate-spin" style={{ color: T.muted }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SITES VIEW (admin)
// ═══════════════════════════════════════════════════════════════════════════
function SitesView({ sites, employeeSites, employees, sessions, onEdit, onDelete, onAdd }) {
  if (sites.length === 0) {
    return (
      <div style={{ borderColor: T.border, background: T.surface }}
           className="border-2 border-dashed rounded-2xl py-16 px-6 text-center">
        <MapPin size={32} style={{ color: T.muted }} strokeWidth={1.5} className="mx-auto mb-4" />
        <h3 style={{ fontFamily: FD, fontWeight: 500 }} className="text-2xl mb-2">Ажлын байр алга</h3>
        <p style={{ color: T.muted }} className="text-sm mb-5">Анхны ажлын байраа үүсгэж эхлээрэй.</p>
        <button onClick={onAdd}
          className="glow-primary press-btn px-5 py-2.5 rounded-full text-[11px] uppercase tracking-[0.25em] inline-flex items-center gap-2">
          <Plus size={13} strokeWidth={2.5} /> Эхний байр нэмэх
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 fade-in">
      {sites.map((site, i) => {
        const empCount = employeeSites.filter((es) => es.site_id === site.id).length;
        const sessionCount = sessions.filter((s) => s.site_id === site.id).length;
        const totalMs = sessions.filter((s) => s.site_id === site.id)
          .reduce((a, s) => a + (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()), 0);

        return (
          <article key={site.id}
            className={`glass lift rounded-3xl p-5 ${i < 4 ? `slide-up-delay-${i + 1}` : "slide-up"}`}>
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <MapPin size={12} style={{ color: T.highlight }} />
                  <span style={{ fontFamily: FM, color: T.muted }}
                        className="text-[9px] uppercase tracking-[0.25em] font-medium">
                    Ажлын байр
                  </span>
                  {site.is_flexible && (
                    <span style={{ background: T.highlightSoft, color: T.highlight, fontFamily: FM }}
                          className="text-[8px] uppercase tracking-[0.2em] font-medium px-2 py-0.5 rounded-full">
                      Уян хатан
                    </span>
                  )}
                </div>
                <h3 style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.02em" }} className="text-xl truncate">{site.name}</h3>
                <p style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-1 truncate">
                  {fmtCoord(site.lat)}, {fmtCoord(site.lng)} · {site.radius}m
                </p>
                {site.is_flexible && site.arrival_window_start && (
                  <p style={{ color: T.highlight, fontFamily: FM }} className="text-[10px] mt-1">
                    Ирэх: {site.arrival_window_start}–{site.arrival_window_end} · {site.shift_hours}ц ажил
                  </p>
                )}
                {site.notes && (
                  <p style={{ color: T.muted }} className="text-xs mt-2 italic line-clamp-2">{site.notes}</p>
                )}
              </div>
              <div className="flex gap-1 -mr-1.5 -mt-1.5">
                <button onClick={() => onEdit(site)} style={{ color: T.muted }} className="p-1.5 rounded-lg hover:bg-black/5"><Edit3 size={14} /></button>
                <button onClick={() => onDelete(site.id)} style={{ color: T.muted }} className="p-1.5 rounded-lg hover:bg-black/5"><X size={15} /></button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-3 border-t" style={{ borderColor: T.borderSoft }}>
              <div>
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-0.5">Ажилтан</div>
                <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-base tabular-nums">{empCount}</div>
              </div>
              <div>
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-0.5">Сэшн</div>
                <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-base tabular-nums">{sessionCount}</div>
              </div>
              <div>
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-0.5">Цаг</div>
                <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-base tabular-nums">{fmtHours(totalMs)}</div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SITE FORM MODAL
// ═══════════════════════════════════════════════════════════════════════════
function SiteFormModal({ mode, site, onSave, onClose }) {
  const [name, setName] = useState(site?.name || "");
  const [coords, setCoords] = useState(site ? { lat: site.lat, lng: site.lng, accuracy: null } : null);
  const [radius, setRadius] = useState(site?.radius || 100);
  const [notes, setNotes] = useState(site?.notes || "");
  const [isFlexible, setIsFlexible] = useState(site?.is_flexible || false);
  const [arrivalStart, setArrivalStart] = useState(site?.arrival_window_start || "07:00");
  const [arrivalEnd, setArrivalEnd] = useState(site?.arrival_window_end || "10:00");
  const [shiftHours, setShiftHours] = useState(site?.shift_hours ? String(site.shift_hours) : "9");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [manLat, setManLat] = useState(""); const [manLng, setManLng] = useState("");

  const captureLoc = async () => {
    setBusy(true); setErr("");
    try {
      const loc = await getLocation();
      setCoords({ lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const applyManual = () => {
    const lat = parseFloat(manLat), lng = parseFloat(manLng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180)
      return setErr("Зөв координат оруулна уу");
    setCoords({ lat, lng });
    setErr("");
  };

  const submit = async () => {
    setErr("");
    if (!name.trim()) return setErr("Байрны нэр оруулна уу");
    if (!coords) return setErr("Байршил тогтоогоогүй байна");
    if (isFlexible) {
      if (!arrivalStart || !arrivalEnd) return setErr("Ирэх цагийн хүрээ оруулна уу");
      const sh = parseFloat(shiftHours);
      if (isNaN(sh) || sh <= 0 || sh > 24) return setErr("Ажлын урт зөв бус (1–24 цаг)");
    }
    setBusy(true);
    await onSave({
      id: site?.id || null,
      name: name.trim(),
      lat: coords.lat, lng: coords.lng,
      radius, notes: notes.trim() || null,
      is_flexible: isFlexible,
      arrival_window_start: isFlexible ? arrivalStart : null,
      arrival_window_end: isFlexible ? arrivalEnd : null,
      shift_hours: isFlexible ? parseFloat(shiftHours) : null,
    });
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={mode === "add" ? "Шинэ ажлын байр" : "Байр засварлах"}>
      <div className="space-y-4">
        <Field label="Байрны нэр" required>
          <Input value={name} onChange={setName} placeholder="Гол оффис" autoFocus />
        </Field>

        <div>
          <Label>Байршил</Label>
          {!coords ? (
            <div className="space-y-2">
              <button onClick={captureLoc} disabled={busy}
                style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                {busy ? <><Loader2 size={12} className="animate-spin" /> Тогтоож байна…</>
                      : <><Crosshair size={12} /> Одоогийн байршил ашиглах</>}
              </button>
              <button onClick={() => setShowManual((v) => !v)} style={{ color: T.muted, fontFamily: FM }}
                className="w-full text-[10px] uppercase tracking-[0.2em] hover:opacity-70 py-1">
                {showManual ? "− Гар оруулга нуух" : "+ Координат гараар оруулах"}
              </button>
              {showManual && (
                <div style={{ borderColor: T.border }} className="p-3 rounded-lg border-dashed border space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input value={manLat} onChange={(e) => setManLat(e.target.value)} placeholder="Latitude"
                      style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", fontFamily: FM }}
                      className="px-3 py-2 rounded-md border text-xs outline-none" />
                    <input value={manLng} onChange={(e) => setManLng(e.target.value)} placeholder="Longitude"
                      style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", fontFamily: FM }}
                      className="px-3 py-2 rounded-md border text-xs outline-none" />
                  </div>
                  <button onClick={applyManual} style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn w-full py-1.5 rounded-md text-[10px] uppercase tracking-[0.2em]">
                    Координат хэрэглэх
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="px-3 py-2.5 rounded-lg flex items-start gap-2.5" style={{ background: T.okSoft, color: T.ok }}>
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div style={{ fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] font-medium">Тогтоогдсон</div>
                <div style={{ fontFamily: FM, color: T.ink }} className="text-[11px] mt-0.5 truncate">
                  {fmtCoord(coords.lat)}, {fmtCoord(coords.lng)}
                  {coords.accuracy && ` · ±${Math.round(coords.accuracy)}m`}
                </div>
              </div>
              <button onClick={() => setCoords(null)} style={{ color: T.ok }}
                      className="p-1 hover:opacity-70"><X size={13} /></button>
            </div>
          )}
        </div>

        <div>
          <Label>Зөвшөөрөгдөх радиус</Label>
          <div className="flex flex-wrap gap-1.5">
            {RADII.map((r) => (
              <button key={r} onClick={() => setRadius(r)}
                style={{ background: radius === r ? T.ink : "transparent", color: radius === r ? T.surface : T.ink,
                         borderColor: radius === r ? T.ink : T.border, fontFamily: FM }}
                className="px-3 py-1 text-[10px] uppercase tracking-wider border rounded-full hover:opacity-80">
                {r >= 1000 ? `${r/1000}km` : `${r}m`}
              </button>
            ))}
          </div>
        </div>

        {/* Flexible schedule */}
        <div className="pt-3 border-t" style={{ borderColor: T.borderSoft }}>
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input type="checkbox" checked={isFlexible} onChange={(e) => setIsFlexible(e.target.checked)} />
            <span style={{ fontFamily: FM, fontWeight: 500 }} className="text-sm">Уян хатан хуваарь</span>
          </label>
          <p style={{ color: T.muted }} className="text-[11px] leading-relaxed mb-3">
            Энэ ажлын байранд ажилтан тогтсон цагт ирэх ёсгүй. Тодорхой хугацаанд ирж, ирсэн цагаас N цаг ажиллана.
          </p>
          {isFlexible && (
            <div className="space-y-3">
              <div>
                <Label>Ирэх цагийн хүрээ</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider mb-1">
                      Эхлэх
                    </div>
                    <input type="time" value={arrivalStart} onChange={(e) => setArrivalStart(e.target.value)}
                      style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                      className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
                  </div>
                  <div>
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider mb-1">
                      Дуусах
                    </div>
                    <input type="time" value={arrivalEnd} onChange={(e) => setArrivalEnd(e.target.value)}
                      style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                      className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
                  </div>
                </div>
              </div>
              <Field label="Ажлын ээлжийн урт (цаг)">
                <input type="number" step="0.5" min="1" max="24" value={shiftHours}
                  onChange={(e) => setShiftHours(e.target.value)}
                  placeholder="9"
                  style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
              </Field>
              <p style={{ color: T.muted }} className="text-[11px] leading-relaxed">
                <strong style={{ color: T.ink }}>Жишээ:</strong> Ирэх 07:00–10:00, Урт 9 цаг → 08:00 ирвэл 17:00 буух.
                Тогтсон ирэх цаг (Ажилтны хуваарь) тохирхон бол түүнийг алгасна.
              </p>
            </div>
          )}
        </div>

        <Field label="Тэмдэглэл (заавал биш)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Жишээ: 3-р давхар, том хаалгаар орох"
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FS }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black resize-none" />
        </Field>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium">Цуцлах</button>
          <button onClick={submit} disabled={busy}
            style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 size={13} className="animate-spin" />}
            {mode === "add" ? "Үүсгэх" : "Хадгалах"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SITE PICKER MODAL (clock-in site selection)
// ═══════════════════════════════════════════════════════════════════════════
function SitePickerModal({ employee, sites, distances, onPick, onClose }) {
  // distances байвал хамгийн ойроос дараалж жагсаана
  const orderedSites = distances
    ? distances.map((d) => ({ ...d.site, _distance: d.distance }))
    : sites;
  const allOutOfRange = distances && distances.every((d) => d.distance > d.site.radius);

  return (
    <Modal onClose={onClose} title="Хаа байна вэ?" maxW="max-w-md">
      {distances ? (
        <p style={{ color: T.muted }} className="text-sm mb-4">
          {allOutOfRange
            ? "Та одоогоор аль ч ажлын байрны радиус дотор байхгүй байна. Хамгийн ойр байгаа байраа сонгоно уу:"
            : "Олон сонголт байна. Та аль ажлын байранд байгаа вэ?"}
        </p>
      ) : (
        <p style={{ color: T.muted }} className="text-sm mb-4">
          <span style={{ color: T.ink, fontWeight: 500 }}>{employee.name}</span> нь хэд хэдэн ажлын байртай. Одоо аль байранд цаг бүртгүүлэх вэ?
        </p>
      )}
      <div className="space-y-2">
        {orderedSites.map((s, i) => {
          const inRange = s._distance != null && s._distance <= s.radius;
          const isClosest = i === 0 && distances;
          return (
            <button key={s.id} onClick={() => onPick(s.id)}
              className="glass-soft press-btn w-full text-left px-4 py-3 rounded-2xl flex items-center gap-3 transition-all hover:translate-x-1"
              style={{ borderColor: isClosest ? T.highlight : undefined }}>
              <div style={{
                background: isClosest ? "linear-gradient(135deg, #10b981, #14b8a6)" : T.highlight,
                color: "white",
                boxShadow: `0 4px 12px ${isClosest ? "rgba(16,185,129,0.4)" : "rgba(99,102,241,0.3)"}`,
              }}
                   className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0">
                <MapPin size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-sm truncate">{s.name}</div>
                  {isClosest && (
                    <span style={{ background: "rgba(16,185,129,0.15)", color: T.ok, fontFamily: FM }}
                          className="px-1.5 py-0.5 rounded-full text-[8px] uppercase tracking-wider font-bold">
                      Хамгийн ойр
                    </span>
                  )}
                </div>
                <div style={{ color: inRange ? T.ok : T.muted, fontFamily: FM }} className="text-[10px] mt-0.5">
                  {s._distance != null
                    ? `${fmtDist(s._distance)} зайтай · ${s.radius}m радиус${inRange ? " · ✓ дотор" : " · гадуур"}`
                    : `${s.radius}m радиус`}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <button onClick={onClose} style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn w-full mt-4 py-2.5 rounded-xl text-sm">Цуцлах</button>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  GENERIC CONFIRM MODAL
// ═══════════════════════════════════════════════════════════════════════════
function ConfirmModal({ title, message, onCancel, onConfirm, confirmLabel = "Устгах" }) {
  return (
    <Modal onClose={onCancel} title={title} maxW="max-w-sm">
      <p style={{ color: T.muted }} className="text-sm mb-5">{message}</p>
      <div className="flex gap-3">
        <button onClick={onCancel} style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn flex-1 py-2.5 rounded-xl text-sm">Цуцлах</button>
        <button onClick={onConfirm} style={{ background: T.err, color: T.surface, fontFamily: FS }}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 flex items-center justify-center gap-1.5">
          <Trash2 size={12} /> {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  MANAGERS VIEW (admin)
// ═══════════════════════════════════════════════════════════════════════════
function ManagersView({ managers, employees, managerEmployees, onUpdateAssignments, onAddManager }) {
  const [editingManagerId, setEditingManagerId] = useState(null);
  const [search, setSearch] = useState("");

  const getAssigned = (managerId) =>
    managerEmployees.filter((me) => me.manager_id === managerId).map((me) => me.employee_id);

  if (managers.length === 0) {
    return (
      <div style={{ borderColor: T.border, background: T.surface }}
           className="border-2 border-dashed rounded-2xl py-16 px-6 text-center">
        <ShieldCheck size={32} style={{ color: T.muted }} strokeWidth={1.5} className="mx-auto mb-4" />
        <h3 style={{ fontFamily: FD, fontWeight: 500 }} className="text-2xl mb-2">Ахлагч алга</h3>
        <p style={{ color: T.muted }} className="text-sm mb-5 max-w-sm mx-auto">
          "Баг" таб дотроос ажилтан нэмэхдээ "Ахлагч" эрх сонгоход ахлагч үүсэнэ.
        </p>
        <button onClick={onAddManager} className="glow-primary press-btn px-5 py-2.5 rounded-full text-[11px] uppercase tracking-[0.25em] inline-flex items-center gap-2">
          <Plus size={13} strokeWidth={2.5} /> Ахлагч нэмэх
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {managers.map((mgr) => {
          const assigned = getAssigned(mgr.id);
          const assignedNames = assigned.map((id) => employees.find((e) => e.id === id)?.name).filter(Boolean);
          return (
            <article key={mgr.id}
              className="glass lift rounded-3xl p-5 slide-up">
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <ShieldCheck size={12} style={{ color: T.highlight }} />
                    <span style={{ fontFamily: FM, color: T.muted }}
                          className="text-[9px] uppercase tracking-[0.25em] font-medium">
                      Ахлагч
                    </span>
                  </div>
                  <h3 style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.02em" }} className="text-xl truncate">{mgr.name}</h3>
                  <p style={{ color: T.muted }} className="text-xs mt-0.5 truncate">{mgr.job_title}</p>
                </div>
              </div>

              <div className="glass-soft rounded-xl px-4 py-3 mb-4">
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.25em] mb-1">
                  Багийн ажилтан
                </div>
                <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-2xl tabular-nums mb-1">
                  {assigned.length}
                </div>
                {assignedNames.length > 0 && (
                  <div style={{ color: T.muted }} className="text-[11px] line-clamp-2">
                    {assignedNames.slice(0, 5).join(", ")}
                    {assignedNames.length > 5 && ` · +${assignedNames.length - 5}`}
                  </div>
                )}
              </div>

              <button onClick={() => setEditingManagerId(mgr.id)}
                style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn w-full py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-2">
                <Edit3 size={12} /> Багийн ажилтнуудыг тохируулах
              </button>
            </article>
          );
        })}
      </div>

      {editingManagerId && (
        <ManagerAssignModal
          manager={managers.find((m) => m.id === editingManagerId)}
          employees={employees}
          assigned={getAssigned(editingManagerId)}
          onSave={async (empIds) => {
            await onUpdateAssignments(editingManagerId, empIds);
            setEditingManagerId(null);
          }}
          onClose={() => setEditingManagerId(null)} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  MANAGER ASSIGN MODAL
// ═══════════════════════════════════════════════════════════════════════════
function ManagerAssignModal({ manager, employees, assigned, onSave, onClose }) {
  const [selected, setSelected] = useState(assigned);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (id) => {
    setSelected((curr) => curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]);
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter((e) => e.name.toLowerCase().includes(q) || (e.job_title || "").toLowerCase().includes(q));
  }, [employees, search]);

  const submit = async () => {
    setBusy(true);
    await onSave(selected);
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={`${manager.name}-н баг`}>
      <p style={{ color: T.muted }} className="text-sm mb-4">
        Энэ ахлагч хариуцах ажилтнуудыг сонгоно уу. Ахлагч зөвхөн сонгосон ажилтнуудын цаг, хүсэлтийг харж, удирдана.
      </p>

      {employees.length > 5 && (
        <div className="mb-3">
          <Input value={search} onChange={setSearch} placeholder="Ажилтан хайх..." />
        </div>
      )}

      <div className="space-y-1.5 max-h-96 overflow-y-auto -mx-1 px-1">
        {filtered.length === 0 ? (
          <div style={{ color: T.muted }} className="text-center py-8 text-sm">
            Ажилтан олдсонгүй
          </div>
        ) : filtered.map((emp) => {
          const checked = selected.includes(emp.id);
          return (
            <button key={emp.id} onClick={() => toggle(emp.id)}
              style={{
                background: checked ? T.highlightSoft : T.surface,
                borderColor: checked ? T.highlight : T.border,
              }}
              className="w-full text-left px-3 py-2.5 rounded-lg border flex items-center gap-3 hover:bg-black/5 transition-colors">
              <div style={{
                background: checked ? T.highlight : "transparent",
                borderColor: checked ? T.highlight : T.border,
              }}
                className="w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center">
                {checked && <CheckCircle2 size={12} style={{ color: T.surface }} strokeWidth={3} />}
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-sm truncate">{emp.name}</div>
                {emp.job_title && (
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-0.5 truncate">
                    {emp.job_title}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] mt-3">
        {selected.length} / {employees.length} ажилтан сонгогдсон
      </div>

      <div className="flex gap-3 pt-4 mt-4 border-t" style={{ borderColor: T.borderSoft }}>
        <button onClick={onClose} style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium">Цуцлах</button>
        <button onClick={submit} disabled={busy}
          style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
          {busy && <Loader2 size={13} className="animate-spin" />}
          Хадгалах
        </button>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  MANAGER DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function ManagerDashboard({ profile }) {
  const [view, setView] = useState("team");
  const [team, setTeam] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSessions, setActiveSessions] = useState({});
  const [approvals, setApprovals] = useState([]);
  const [sites, setSites] = useState([]);
  const [employeeSites, setEmployeeSites] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [kpiDefs, setKpiDefs] = useState([]);
  const [kpiEntries, setKpiEntries] = useState([]);
  const [kpiInputDept, setKpiInputDept] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [editingSession, setEditingSession] = useState(null);
  const [, setTick] = useState(0);

  useEffect(() => { const id = setInterval(() => setTick((t) => t+1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (!feedback) return; const t = setTimeout(() => setFeedback(null), 5000); return () => clearTimeout(t); }, [feedback]);

  const loadAll = async () => {
    const [me, sess, active, apps, st, es, dept, kpiD, kpiE, tsk] = await Promise.all([
      supabase.from("manager_employees").select("employee_id, profiles!manager_employees_employee_id_fkey(*)").eq("manager_id", profile.id),
      supabase.from("sessions").select("*").order("start_time", { ascending: false }).limit(200),
      supabase.from("active_sessions").select("*"),
      supabase.from("approvals").select("*").order("created_at", { ascending: false }),
      supabase.from("sites").select("*").order("name"),
      supabase.from("employee_sites").select("*"),
      supabase.from("departments").select("*").order("name"),
      supabase.from("kpi_definitions").select("*").eq("is_active", true).order("display_order"),
      supabase.from("kpi_entries").select("*").gte("entry_date", new Date(Date.now() - 90*24*60*60*1000).toISOString().slice(0,10)).order("entry_date", { ascending: false }),
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    ]);
    if (me.data) setTeam(me.data.map((m) => m.profiles).filter(Boolean));
    if (sess.data) setSessions(sess.data);
    if (active.data) {
      const map = {};
      active.data.forEach((a) => { map[a.employee_id] = a; });
      setActiveSessions(map);
    }
    if (apps.data) setApprovals(apps.data);
    if (st.data) setSites(st.data);
    if (es.data) setEmployeeSites(es.data);
    if (dept.data) setDepartments(dept.data);
    if (kpiD.data) setKpiDefs(kpiD.data);
    if (kpiE.data) setKpiEntries(kpiE.data);
    if (tsk.data) setTasks(tsk.data);
  };

  const upsertTask = async (data) => {
    try {
      if (data.id) {
        const { error } = await supabase.from("tasks").update({
          title: data.title, description: data.description,
          status: data.status, priority: data.priority,
          assignee_id: data.assignee_id, due_date: data.due_date,
          completed_at: data.status === "done" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("tasks").insert({
          department_id: data.department_id,
          title: data.title, description: data.description,
          status: data.status || "todo", priority: data.priority || "medium",
          assignee_id: data.assignee_id, due_date: data.due_date,
          created_by: profile.id,
        });
        if (error) throw error;
      }
      setEditingTask(null);
      setFeedback({ type: "success", msg: "Хадгаллаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  const deleteTask = async (id) => {
    try {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
      setFeedback({ type: "success", msg: "Устгагдлаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  const updateTaskStatus = async (taskId, newStatus) => {
    try {
      const { error } = await supabase.from("tasks").update({
        status: newStatus,
        completed_at: newStatus === "done" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("id", taskId);
      if (error) throw error;
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  const upsertKpiEntries = async (deptId, date, entries) => {
    try {
      const rows = entries.map((e) => ({
        kpi_id: e.kpi_id,
        department_id: deptId,
        entry_date: date,
        value: e.value,
        note: e.note || null,
        entered_by: profile.id,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("kpi_entries").upsert(rows, {
        onConflict: "kpi_id,entry_date",
      });
      if (error) throw error;
      setKpiInputDept(null);
      setFeedback({ type: "success", msg: "Хадгаллаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    const ch = supabase.channel(`manager-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "active_sessions" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "manager_employees", filter: `manager_id=eq.${profile.id}` }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile.id]);

  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  const resolveApproval = async (approval, decision) => {
    const updates = {
      status: decision, resolved_at: new Date().toISOString(), resolved_by: profile.id,
    };
    const { error: updErr } = await supabase.from("approvals").update(updates).eq("id", approval.id);
    if (updErr) { setFeedback({ type: "error", msg: updErr.message }); return; }

    if (decision === "approved" && approval.kind !== "early_leave") {
      const emp = team.find((e) => e.id === approval.employee_id);
      const cappedStart = capSessionStart(emp, new Date(approval.proposed_start).getTime());
      const cappedEnd = capSessionEnd(emp, new Date(approval.proposed_end).getTime());
      if (cappedEnd > cappedStart) {
        await supabase.from("sessions").insert({
          employee_id: approval.employee_id,
          start_time: new Date(cappedStart).toISOString(),
          end_time: new Date(cappedEnd).toISOString(),
          from_approval: approval.id,
        });
      }
    }
    await loadAll();
  };

  const editSession = async ({ id, start_time, end_time, site_id, edit_reason }) => {
    try {
      const { error } = await supabase.from("sessions").update({
        start_time, end_time, site_id,
        edited_at: new Date().toISOString(),
        edited_by: profile.id,
        edit_reason,
      }).eq("id", id);
      if (error) throw error;
      setEditingSession(null);
      setFeedback({ type: "success", msg: "Бүртгэл засагдлаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  const deleteSession = async (id) => {
    try {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) throw error;
      setEditingSession(null);
      setFeedback({ type: "success", msg: "Бүртгэл устгагдлаа" });
      await loadAll();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
  };

  const teamTodayMs = useMemo(() => {
    const t = startOfDay();
    const teamIds = new Set(team.map((e) => e.id));
    const closed = sessions
      .filter((s) => teamIds.has(s.employee_id) && new Date(s.start_time).getTime() >= t)
      .reduce((a, s) => a + sessionDurationMs(new Date(s.start_time).getTime(), new Date(s.end_time).getTime()), 0);
    const live = Object.entries(activeSessions).reduce((a, [id, e]) => {
      if (!teamIds.has(id)) return a;
      const st = new Date(e.start_time).getTime();
      if (st < t) return a;
      const emp = team.find((x) => x.id === id);
      const capped = capSessionEnd(emp, Date.now());
      return a + Math.min(Math.max(0, capped - st), DAILY_HOUR_LIMIT_MS);
    }, 0);
    return closed + live;
  }, [sessions, activeSessions, team]);

  const activeCount = team.filter((e) => activeSessions[e.id]).length;

  return (
    <div style={{ color: T.ink, fontFamily: FS }} className="min-h-screen">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 sm:py-10">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <div style={{ background: T.highlight, color: T.surface }} className="w-9 h-9 rounded-xl flex items-center justify-center">
              <ShieldCheck size={16} />
            </div>
            <div>
              <div style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.03em" }} className="text-2xl leading-none">
                {profile.name}
              </div>
              <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.25em] mt-1">
                Ахлагч · {team.length} ажилтан
              </div>
            </div>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="glass-soft press-btn px-3 py-2 rounded-lg text-[11px] uppercase tracking-[0.2em] flex items-center gap-2" style={{ fontFamily: FM, color: "#1e1b4b" }}>
            <LogOut size={12} /> Гарах
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10 slide-up-delay-1">
          <BigStat label="Ажиллаж буй" value={activeCount} accent={activeCount > 0} />
          <BigStat label="Өнөөдөр" value={fmtHours(teamTodayMs)} suffix="цаг" />
          <BigStat label="Ажилтан" value={team.length} />
        </div>

        <nav className="flex items-center gap-1.5 mb-6 flex-wrap slide-up-delay-2">
          <Tab active={view === "team"} onClick={() => setView("team")} icon={Users}>Баг</Tab>
          <Tab active={view === "dashboard"} onClick={() => setView("dashboard")} icon={BarChart3}>Дашборд</Tab>
          <Tab active={view === "tasks"} onClick={() => setView("tasks")} icon={ClipboardCheck}>Даалгавар</Tab>
          <Tab active={view === "ledger"} onClick={() => setView("ledger")} icon={Calendar}>Тэмдэглэл</Tab>
          <Tab active={view === "approvals"} onClick={() => setView("approvals")} icon={Inbox} badge={pendingApprovals.length}>
            Хүсэлт
          </Tab>
        </nav>

        {feedback && (
          <div className="mb-4"><FeedbackBox type={feedback.type}>{feedback.msg}</FeedbackBox></div>
        )}

        {view === "team" && (
          <ManagerTeamReadOnly
            team={team} sessions={sessions} activeSessions={activeSessions}
            sites={sites} employeeSites={employeeSites} />
        )}

        {view === "dashboard" && (
          <KPIDashboardView
            departments={departments}
            kpiDefs={kpiDefs}
            kpiEntries={kpiEntries}
            isAdmin={false}
            currentUserId={profile.id}
            onOpenInputForm={(deptId) => setKpiInputDept(deptId)}
          />
        )}

        {view === "tasks" && (
          <TasksView
            tasks={tasks}
            departments={departments}
            employees={team}
            currentUserId={profile.id}
            isAdmin={false}
            onAdd={() => setEditingTask("add")}
            onEdit={(t) => setEditingTask(t)}
            onDelete={deleteTask}
            onUpdateStatus={updateTaskStatus}
          />
        )}
        {view === "ledger" && (
          <LedgerView
            sessions={sessions.filter((s) => team.some((t) => t.id === s.employee_id))}
            employees={team} sites={sites}
            canEdit={true}
            onEditSession={(s) => setEditingSession(s)} />
        )}
        {view === "approvals" && (
          <ApprovalsView
            approvals={approvals.filter((a) => team.some((t) => t.id === a.employee_id))}
            employees={team} onResolve={resolveApproval} />
        )}

        <Footer count={sessions.length} />
      </div>

      {editingSession && (
        <SessionEditModal
          session={editingSession}
          employee={team.find((e) => e.id === editingSession.employee_id)}
          sites={sites}
          onSave={editSession}
          onDelete={deleteSession}
          onClose={() => setEditingSession(null)} />
      )}

      {kpiInputDept && (
        <KpiEntryFormModal
          department={departments.find(d => d.id === kpiInputDept)}
          kpiDefs={kpiDefs.filter(k => k.department_id === kpiInputDept)}
          existingEntries={kpiEntries}
          onSave={upsertKpiEntries}
          onClose={() => setKpiInputDept(null)} />
      )}

      {editingTask && (
        <TaskFormModal
          mode={editingTask === "add" ? "add" : "edit"}
          task={editingTask === "add" ? null : editingTask}
          departments={departments}
          employees={team}
          onSave={upsertTask}
          onClose={() => setEditingTask(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  MANAGER TEAM (read-only — manager can view but not clock employees in/out)
// ═══════════════════════════════════════════════════════════════════════════
function ManagerTeamReadOnly({ team, sessions, activeSessions, sites = [], employeeSites = [] }) {
  if (team.length === 0) {
    return (
      <div style={{ borderColor: T.border, background: T.surface }}
           className="border-2 border-dashed rounded-2xl py-16 px-6 text-center">
        <Users size={32} style={{ color: T.muted }} strokeWidth={1.5} className="mx-auto mb-4" />
        <h3 style={{ fontFamily: FD, fontWeight: 500 }} className="text-2xl mb-2">Багт ажилтан алга</h3>
        <p style={{ color: T.muted }} className="text-sm">
          Админ танд ажилтан оноогоогүй байна. Админд хандана уу.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {team.map((emp) => {
        const active = activeSessions[emp.id];
        const isActive = !!active;
        const liveMs = isActive ? capSessionEnd(emp, Date.now()) - new Date(active.start_time).getTime() : 0;
        const empSessions = sessions.filter((s) => s.employee_id === emp.id);
        const todayMs = empSessions.filter((s) => new Date(s.start_time).getTime() >= startOfDay())
          .reduce((a, s) => a + (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()), 0)
          + (isActive ? Math.max(0, liveMs) : 0);
        const weekMs = empSessions.filter((s) => new Date(s.start_time).getTime() >= startOfWeek())
          .reduce((a, s) => a + (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()), 0)
          + (isActive ? Math.max(0, liveMs) : 0);
        const activeSite = isActive && active.site_id ? sites.find((s) => s.id === active.site_id) : null;
        const myAssignedSites = employeeSites.filter((es) => es.employee_id === emp.id);

        return (
          <article key={emp.id}
            className={`${isActive ? "glass-strong pulse-halo" : "glass lift"} rounded-3xl p-5 slide-up`}>
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span style={{
                    background: isActive ? T.ok : T.mutedSoft,
                    boxShadow: isActive ? `0 0 0 4px rgba(16, 185, 129, 0.2)` : "none",
                  }}
                        className={`inline-block w-1.5 h-1.5 rounded-full ${isActive ? "pulse-dot" : ""}`} />
                  <span style={{ fontFamily: FM, color: isActive ? T.ok : T.muted }}
                        className="text-[9px] uppercase tracking-[0.25em] font-medium">
                    {isActive ? "Ажиллаж байна" : "Цагтай биш"}
                  </span>
                </div>
                <h3 style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.02em" }} className="text-xl truncate">{emp.name}</h3>
                <p style={{ color: T.muted }} className="text-xs mt-0.5 truncate">{emp.job_title}</p>
              </div>
            </div>

            <div className="text-[10px] flex flex-wrap gap-x-3 gap-y-1 mb-4" style={{ fontFamily: FM, color: T.muted }}>
              <span className="flex items-center gap-1">
                <MapPin size={10} />
                {myAssignedSites.length > 0 ? `${myAssignedSites.length} байр` : hasSite(emp) ? `${emp.site_radius}m` : "байргүй"}
              </span>
              <span className="flex items-center gap-1">
                <Clock size={10} />
                {emp.schedule_days?.length ? `${emp.schedule_start}–${emp.schedule_end}` : "хязгааргүй"}
              </span>
              {activeSite && (
                <span style={{ color: T.highlight }} className="flex items-center gap-1">
                  · {activeSite.name}
                </span>
              )}
            </div>

            <div className="rounded-xl px-4 py-3 mb-3" style={{ background: T.surfaceAlt }}>
              <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.25em] mb-1">
                {isActive ? "Одоо ажиллаж байна" : "Өнөөдөр"}
              </div>
              <div style={{ fontFamily: FM, fontWeight: 500, color: isActive ? T.highlight : T.ink }} className="text-3xl tabular-nums">
                {isActive ? fmtClock(liveMs) : `${fmtHours(todayMs)}`}
                {!isActive && <span style={{ fontSize: "0.45em", color: T.muted, marginLeft: 6 }}>цаг</span>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div style={{ background: T.surfaceAlt }} className="rounded-lg px-3 py-2">
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-0.5">7 хоног</div>
                <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-sm tabular-nums">{fmtHours(weekMs)} ц</div>
              </div>
              <div style={{ background: T.surfaceAlt }} className="rounded-lg px-3 py-2">
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-0.5">Сэшн</div>
                <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-sm tabular-nums">{empSessions.length}</div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  EARLY LEAVE MODAL
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
//  UNVERIFIED CLOCK-OUT MODAL (when employee outside geofence)
// ═══════════════════════════════════════════════════════════════════════════
function UnverifiedClockOutModal({ distance, siteName, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    if (!reason.trim()) return setErr("Шалтгаан бичнэ үү");
    if (reason.trim().length < 5) return setErr("Илүү тодорхой шалтгаан бичнэ үү");
    setBusy(true);
    await onSubmit(reason.trim());
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="Байршил гадуур" maxW="max-w-md">
      <div className="space-y-4">
        <div style={{ background: T.warnSoft, borderColor: T.warn }}
             className="border rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} style={{ color: T.warn }} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <div style={{ fontFamily: FM, fontWeight: 500, color: T.warn }} className="text-sm mb-1">
                {siteName}-аас {fmtDist(distance)} зайтай
              </div>
              <p style={{ color: T.muted }} className="text-xs leading-relaxed">
                Та ажлын байрнаас гадуур байгаа учраас цаг автомат бүртгэгдэхгүй. Хэрэв та үнэхээр ажил тарж байгаа бол шалтгаан бичиж явуулна уу. Энэ нь ахлагч/админ руу мэдэгдэж очино, тэд баталгаажуулна.
              </p>
            </div>
          </div>
        </div>

        <Field label="Яагаад байршлаас гадуур байгаа вэ?" required>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="Жишээ: Гадагшаа уулзалтад гарсан, ачаа аваачихаар явсан, зочинтой гэх мэт"
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FS }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black resize-none" />
        </Field>

        <p style={{ color: T.muted }} className="text-[11px] leading-relaxed">
          ⚠️ Цаг тань <strong>"баталгаажуулагдсан биш"</strong> гэсэн тэмдэгтэйгээр бүртгэгдэнэ. Ахлагч/админ шалгасны дараа баталгаажна.
        </p>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium">Цуцлах</button>
          <button onClick={submit} disabled={busy}
            style={{ background: T.warn, color: T.surface, fontFamily: FS }}
            className="flex-1 py-3 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Цаг буулгах
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EarlyLeaveModal({ profile, myActive, onClose, onSubmit }) {
  const [endTime, setEndTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0); // 1 цагийн дараа default
    return d.toTimeString().slice(0, 5);
  });
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    if (!reason.trim()) return setErr("Шалтгаан бичнэ үү");
    const today = new Date();
    const isoDate = today.toISOString().slice(0, 10);
    const endTs = new Date(`${isoDate}T${endTime}:00`).getTime();
    if (isNaN(endTs)) return setErr("Цаг буруу");

    // Active session-ний эхлэлээс хойш байх ёстой
    const startTs = myActive ? new Date(myActive.start_time).getTime() : Date.now();
    if (endTs <= startTs) return setErr("Дуусах цаг ажил эхлэхээс хойш байх ёстой");

    setBusy(true);
    await onSubmit({
      start: startTs,
      end: endTs,
      reason: reason.trim(),
      kind: "early_leave",
    });
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="Эрт явах хүсэлт" maxW="max-w-md">
      <div className="space-y-4">
        <p style={{ color: T.muted }} className="text-xs leading-relaxed">
          Хуваарийн өмнө явмаар бол энэ хүсэлтийг ахалсан ахлагч (эсвэл админ) зөвшөөрөх хэрэгтэй. Зөвшөөрөгдсөний дараа байршил харгалзахгүйгээр цаг буух боломжтой болно.
        </p>

        <Field label="Хэдэн цагт явах вэ?" required>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
        </Field>

        <Field label="Шалтгаан / тайлбар" required>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="Жишээ: Эмнэлэгт үзлэгтэй, гэр бүлийн ажил, хувийн асуудал гэх мэт"
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FS }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black resize-none" />
        </Field>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium">Цуцлах</button>
          <button onClick={submit} disabled={busy}
            style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Илгээх
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SESSION EDIT MODAL (admin & manager — to fix wrong time entries)
// ═══════════════════════════════════════════════════════════════════════════
function SessionEditModal({ session, employee, sites = [], onSave, onDelete, onClose }) {
  const startMs = new Date(session.start_time).getTime();
  const endMs = new Date(session.end_time).getTime();
  const dateStr = new Date(startMs).toLocaleDateString("en-CA"); // YYYY-MM-DD

  const [date, setDate] = useState(dateStr);
  const [start, setStart] = useState(new Date(startMs).toTimeString().slice(0, 5));
  const [end, setEnd] = useState(new Date(endMs).toTimeString().slice(0, 5));
  const [siteId, setSiteId] = useState(session.site_id || "");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const submit = async () => {
    setErr("");
    if (!reason.trim()) return setErr("Засварын шалтгаан бичнэ үү");
    const startTs = new Date(`${date}T${start}:00`).getTime();
    const endTs = new Date(`${date}T${end}:00`).getTime();
    if (isNaN(startTs) || isNaN(endTs)) return setErr("Огноо/цаг буруу");
    if (endTs <= startTs) return setErr("Дуусах цаг эхлэхээс хойш байх ёстой");
    setBusy(true);
    await onSave({
      id: session.id,
      start_time: new Date(startTs).toISOString(),
      end_time: new Date(endTs).toISOString(),
      site_id: siteId || null,
      edit_reason: reason.trim(),
    });
    setBusy(false);
  };

  if (confirmDel) {
    return (
      <Modal onClose={() => setConfirmDel(false)} title="Бүртгэл устгах уу?" maxW="max-w-sm">
        <p style={{ color: T.muted }} className="text-sm mb-5">
          <span style={{ color: T.ink, fontWeight: 500 }}>{employee?.name}</span>-ийн{" "}
          <span style={{ color: T.ink, fontWeight: 500 }}>{fmtDate(startMs)} {fmtTime(startMs)}–{fmtTime(endMs)}</span>{" "}
          бүртгэл устгагдана. Энэ үйлдлийг буцаах боломжгүй.
        </p>
        <div className="flex gap-3">
          <button onClick={() => setConfirmDel(false)} style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn flex-1 py-2.5 rounded-xl text-sm">Цуцлах</button>
          <button onClick={() => onDelete(session.id)}
            style={{ background: T.err, color: T.surface, fontFamily: FS }}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 flex items-center justify-center gap-1.5">
            <Trash2 size={12} /> Устгах
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Цагийн бүртгэл засах" maxW="max-w-md">
      <div className="space-y-4">
        <div style={{ background: T.surfaceAlt }} className="rounded-xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.2em] mb-1">
            Ажилтан
          </div>
          <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-sm">{employee?.name || "—"}</div>
        </div>

        <Field label="Огноо" required>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Эхэлсэн" required>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
          </Field>
          <Field label="Дууссан" required>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
          </Field>
        </div>

        {sites.length > 0 && (
          <Field label="Ажлын байр">
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black">
              <option value="">— Сонгоогүй —</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Засварын шалтгаан" required>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="Жишээ: Ажилтан өглөө цаг буруу бүртгүүлсэн"
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FS }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black resize-none" />
        </Field>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex gap-3 pt-2">
          <button onClick={() => setConfirmDel(true)}
            style={{ borderColor: T.err, color: T.err, fontFamily: FS }}
            className="px-4 py-3 rounded-xl border text-sm font-medium hover:bg-red-50 flex items-center gap-1.5">
            <Trash2 size={12} />
          </button>
          <button onClick={onClose} style={{ fontFamily: FS, color: "#1e1b4b" }}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium">Цуцлах</button>
          <button onClick={submit} disabled={busy}
            style={{ fontFamily: FS, color: "white" }}
            className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 size={13} className="animate-spin" />}
            Хадгалах
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SALARY VIEW (employee — own salary)
// ═══════════════════════════════════════════════════════════════════════════
function SalaryView({ sessions, profile }) {
  const [filterType, setFilterType] = useState("thisMonth"); // thisMonth | lastMonth | custom
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));

  const filterRange = useMemo(() => {
    const now = new Date();
    if (filterType === "thisMonth") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      return { start, end };
    }
    if (filterType === "lastMonth") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const end = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return { start, end };
    }
    const s = new Date(`${customStart}T00:00:00`).getTime();
    const e = new Date(`${customEnd}T23:59:59`).getTime();
    return { start: s, end: e };
  }, [filterType, customStart, customEnd]);

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      const t = new Date(s.start_time).getTime();
      return t >= filterRange.start && t < filterRange.end;
    });
  }, [sessions, filterRange]);

  // Өдрүүдээр бүлэглэх
  const byDay = useMemo(() => {
    const map = {};
    filtered.forEach((s) => {
      const startMs = new Date(s.start_time).getTime();
      const endMs = new Date(s.end_time).getTime();
      const dayKey = new Date(startMs).toLocaleDateString("en-CA"); // YYYY-MM-DD
      if (!map[dayKey]) map[dayKey] = { dayKey, sessions: [], totalMs: 0 };
      const ms = sessionDurationMs(startMs, endMs);
      map[dayKey].sessions.push({ s, ms });
      map[dayKey].totalMs += ms;
    });
    // Өдөр бүрд 9 цагийн дээд лимит дахин шалгана
    Object.values(map).forEach((d) => {
      d.totalMs = Math.min(d.totalMs, DAILY_HOUR_LIMIT_MS);
    });
    return Object.values(map).sort((a, b) => b.dayKey.localeCompare(a.dayKey));
  }, [filtered]);

  const totals = useMemo(() => {
    const totalMs = byDay.reduce((a, d) => a + d.totalMs, 0);
    const rate = profile.hourly_rate || 0;
    const totalPay = calcPay(totalMs, rate);
    return { totalMs, totalPay, days: byDay.length };
  }, [byDay, profile]);

  const filterLabel = filterType === "thisMonth" ? "Энэ сар"
    : filterType === "lastMonth" ? "Өнгөрсөн сар"
    : `${customStart} – ${customEnd}`;

  const noRate = !profile.hourly_rate || profile.hourly_rate === 0;

  return (
    <div className="space-y-4 fade-in">
      {/* Big totals card */}
      <div className="glass-strong rounded-3xl p-5 sm:p-6 slide-up">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={14} style={{ color: T.highlight }} />
            <span style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.25em] font-medium">
              {filterLabel}
            </span>
          </div>
          {!noRate && totals.totalMs > 0 && (
            <button onClick={async () => {
              try {
                await generateSalaryPDF({
                  employee: profile,
                  sessions: sessions,
                  periodStart: filterRange.start,
                  periodEnd: filterRange.end,
                  periodLabel: filterLabel,
                });
              } catch (e) {
                console.error(e);
                alert("PDF үүсгэхэд алдаа гарлаа: " + e.message);
              }
            }}
              className="glow-primary press-btn px-4 py-2 rounded-full text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5 font-medium"
              style={{ fontFamily: FM }}>
              <FileSpreadsheet size={12} /> PDF татах
            </button>
          )}
        </div>

        {noRate ? (
          <div style={{ background: T.warnSoft, color: T.warn }} className="px-3 py-2.5 rounded-lg text-xs">
            Танд цагийн хөлс тогтоогоогүй байна. Админд хандана уу.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.25em] mb-1">Нийт цаг</div>
                <div style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.03em" }} className="text-3xl sm:text-4xl tabular-nums">
                  {fmtHours(totals.totalMs)}
                  <span style={{ color: T.muted, fontSize: "0.5em", marginLeft: 6, fontFamily: FM }}>цаг</span>
                </div>
              </div>
              <div>
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.25em] mb-1">Цалин</div>
                <div style={{ fontFamily: FD, fontWeight: 500, color: T.highlight, letterSpacing: "-0.03em" }} className="text-3xl sm:text-4xl tabular-nums">
                  ₮{Math.round(totals.totalPay).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t" style={{ borderColor: T.borderSoft }}>
              <div>
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-0.5">Ажилласан өдөр</div>
                <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-base tabular-nums">{totals.days}</div>
              </div>
              <div>
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-0.5">Цагийн хөлс</div>
                <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-base tabular-nums">₮{(profile.hourly_rate || 0).toLocaleString()}/ц</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Period filter */}
      <div className="glass rounded-2xl p-4 slide-up-delay-1">
        <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.2em] mb-2">
          Хугацаа
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {[
            { id: "thisMonth", label: "Энэ сар" },
            { id: "lastMonth", label: "Өнгөрсөн сар" },
            { id: "custom", label: "Гар сонголт" },
          ].map((opt) => (
            <button key={opt.id} onClick={() => setFilterType(opt.id)}
              className={`${filterType === opt.id ? "tab-active" : "tab-inactive glass-soft"} press-btn px-3 py-1 text-[10px] uppercase tracking-[0.2em] border rounded-full`}
              style={{ fontFamily: FM, borderColor: filterType === opt.id ? "transparent" : T.borderSoft }}>
              {opt.label}
            </button>
          ))}
        </div>
        {filterType === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Эхлэх</Label>
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-black" />
            </div>
            <div>
              <Label>Дуусах</Label>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-black" />
            </div>
          </div>
        )}
      </div>

      {/* Daily breakdown */}
      <div className="glass rounded-3xl overflow-hidden slide-up-delay-2">
        <div className="px-5 py-4 border-b" style={{ borderColor: T.borderSoft }}>
          <h3 style={{ fontFamily: FD, fontWeight: 500 }} className="text-lg">Өдрөөр</h3>
          <p style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] mt-0.5">
            {byDay.length} өдөр
          </p>
        </div>
        {byDay.length === 0 ? (
          <div className="px-6 py-12 text-center" style={{ color: T.muted }}>
            <p className="text-sm">Сонгосон хугацаанд бүртгэл алга</p>
          </div>
        ) : (
          <ul>
            {byDay.map((d, i) => {
              const dayDate = new Date(d.dayKey + "T00:00:00");
              const dayPay = calcPay(d.totalMs, profile.hourly_rate || 0);
              const isCapped = d.sessions.reduce((a, x) => a + (new Date(x.s.end_time).getTime() - new Date(x.s.start_time).getTime()), 0) > DAILY_HOUR_LIMIT_MS;
              return (
                <li key={d.dayKey} className="px-5 py-3.5 flex items-center gap-4"
                    style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderSoft}` }}>
                  <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-wider w-20 shrink-0">
                    {dayDate.toLocaleDateString("mn-MN", { month: "short", day: "numeric", weekday: "short" })}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-sm tabular-nums">
                      {fmtHours(d.totalMs)} цаг
                      {isCapped && <span style={{ color: T.warn, fontSize: "0.75em", marginLeft: 6 }}>· 9ц лимит</span>}
                    </div>
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-0.5">
                      {d.sessions.length} сэшн
                    </div>
                  </div>
                  <div className="text-right">
                    <div style={{ fontFamily: FM, fontWeight: 500, color: T.highlight }} className="text-sm tabular-nums">
                      ₮{Math.round(dayPay).toLocaleString()}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] text-center pt-2">
        Тэмдэглэл: Өдөрт 9 цагийн дээд хязгаартай · ирсэн цагаас тоологдоно
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  DEPARTMENTS VIEW
// ═══════════════════════════════════════════════════════════════════════════
function DepartmentsView({ departments, employees, managers, onEdit, onDelete, onAdd }) {
  const [confirmDel, setConfirmDel] = useState(null);

  if (departments.length === 0) {
    return (
      <div className="glass rounded-3xl py-16 px-6 text-center scale-up">
        <Users size={32} style={{ color: T.muted }} strokeWidth={1.5} className="mx-auto mb-4" />
        <h3 style={{ fontFamily: FD, fontWeight: 500 }} className="text-2xl mb-2">Хэлтэс алга</h3>
        <p style={{ color: T.muted }} className="text-sm mb-5 max-w-sm mx-auto">
          Эхний хэлтсээ үүсгээд ажилтнуудыг зохион байгуулна уу. Хэлтэст ахлагч оноох боломжтой.
        </p>
        <button onClick={onAdd}
          className="glow-primary press-btn px-5 py-2.5 rounded-full text-[11px] uppercase tracking-[0.25em] inline-flex items-center gap-2">
          <Plus size={13} strokeWidth={2.5} /> Эхний хэлтэс нэмэх
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 fade-in">
        {departments.map((dept, i) => {
          const manager = dept.manager_id ? managers.find((m) => m.id === dept.manager_id) : null;
          const empCount = employees.filter((e) => e.department_id === dept.id).length;
          const sampleEmps = employees.filter((e) => e.department_id === dept.id).slice(0, 5);

          return (
            <article key={dept.id}
              className={`glass lift rounded-3xl p-5 ${i < 4 ? `slide-up-delay-${i + 1}` : "slide-up"}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Users size={12} style={{ color: T.highlight }} />
                    <span style={{ fontFamily: FM, color: T.muted }}
                          className="text-[9px] uppercase tracking-[0.25em] font-medium">
                      Хэлтэс
                    </span>
                  </div>
                  <h3 style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.02em" }} className="text-xl truncate">
                    {dept.name}
                  </h3>
                  {dept.description && (
                    <p style={{ color: T.muted }} className="text-xs mt-1 line-clamp-2">{dept.description}</p>
                  )}
                </div>
              </div>

              {manager ? (
                <div className="glass-soft rounded-xl px-3 py-2.5 mb-3 flex items-center gap-2">
                  <ShieldCheck size={12} style={{ color: T.highlight }} />
                  <div className="flex-1 min-w-0">
                    <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">
                      Ахлагч
                    </div>
                    <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-sm truncate">
                      {manager.name}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="glass-soft rounded-xl px-3 py-2.5 mb-3" style={{ color: T.warn }}>
                  <span style={{ fontFamily: FM }} className="text-[10px] uppercase tracking-wider">
                    Ахлагч оноогоогүй
                  </span>
                </div>
              )}

              <div className="glass-soft rounded-xl px-4 py-3 mb-4">
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.25em] mb-1">
                  Ажилтны тоо
                </div>
                <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-2xl tabular-nums mb-1">
                  {empCount}
                </div>
                {sampleEmps.length > 0 && (
                  <div style={{ color: T.muted }} className="text-[11px] line-clamp-2">
                    {sampleEmps.map((e) => e.name).join(", ")}
                    {empCount > 5 && ` · +${empCount - 5}`}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={() => onEdit(dept)}
                  className="glass-soft press-btn flex-1 py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
                  style={{ fontFamily: FS, color: T.ink }}>
                  <Edit3 size={12} /> Засах
                </button>
                <button onClick={() => setConfirmDel(dept)}
                  className="glass-soft press-btn px-4 py-2.5 rounded-xl text-xs font-medium"
                  style={{ fontFamily: FS, color: T.err }}>
                  <Trash2 size={12} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)} title="Хэлтэс устгах уу?" maxW="max-w-sm">
          <p style={{ color: T.muted }} className="text-sm mb-5">
            <strong style={{ color: T.ink }}>{confirmDel.name}</strong> хэлтэс устгагдана. Энэ хэлтсэд харьяалагдаж байсан ажилтнуудын <strong>хэлтэс хоосон</strong> болно (ажилтнууд устгагдахгүй).
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDel(null)}
              className="glass-soft press-btn flex-1 py-2.5 rounded-xl text-sm"
              style={{ fontFamily: FS, color: T.ink }}>Цуцлах</button>
            <button onClick={() => { onDelete(confirmDel.id); setConfirmDel(null); }}
              className="glow-danger press-btn flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5"
              style={{ fontFamily: FS }}>
              <Trash2 size={12} /> Устгах
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  DEPARTMENT FORM MODAL
// ═══════════════════════════════════════════════════════════════════════════
function DepartmentFormModal({ mode, dept, managers, onSave, onClose }) {
  const [name, setName] = useState(dept?.name || "");
  const [description, setDescription] = useState(dept?.description || "");
  const [managerId, setManagerId] = useState(dept?.manager_id || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!name.trim()) return setErr("Хэлтсийн нэр оруулна уу");
    setBusy(true);
    await onSave({
      id: dept?.id || null,
      name: name.trim(),
      description: description.trim() || null,
      manager_id: managerId || null,
    });
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={mode === "add" ? "Хэлтэс нэмэх" : "Хэлтэс засах"}>
      <div className="space-y-4">
        <Field label="Хэлтсийн нэр" required>
          <Input value={name} onChange={setName} placeholder="Жишээ: Маркетинг, Худалдаа" autoFocus />
        </Field>

        <Field label="Тайлбар (заавал биш)">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            placeholder="Хэлтсийн үндсэн чиг үүрэг"
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FS }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black resize-none" />
        </Field>

        <Field label="Хэлтсийн ахлагч (заавал биш)">
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)}
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black">
            <option value="">— Сонгоогүй —</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <p style={{ color: T.muted }} className="text-[11px] mt-1.5">
            Ахлагч сонгосон үед тэр хэлтсийн бүх ажилтныг автомат хариуцна
          </p>
        </Field>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium"
            style={{ fontFamily: FS, color: T.ink }}>Цуцлах</button>
          <button onClick={submit} disabled={busy}
            className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ fontFamily: FS }}>
            {busy && <Loader2 size={13} className="spin" />}
            Хадгалах
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  LEAVES — helpers
// ═══════════════════════════════════════════════════════════════════════════
const LEAVE_TYPES = {
  sick: "Өвчний чөлөө",
  personal: "Хувийн чөлөө",
  vacation: "Амралт",
  maternity: "Жирэмсний / Хүүхдийн",
  unpaid: "Цалингүй чөлөө",
  other: "Бусад",
};

const LEAVE_STATUS = {
  pending: { label: "Хүлээгдэж буй", color: T.warn, soft: T.warnSoft },
  approved: { label: "Зөвшөөрсөн", color: T.ok, soft: T.okSoft },
  denied: { label: "Татгалзсан", color: T.err, soft: T.errSoft },
  cancelled: { label: "Цуцалсан", color: T.muted, soft: "rgba(107,114,128,0.1)" },
};

function diffDays(start, end) {
  const s = new Date(start + "T00:00:00").getTime();
  const e = new Date(end + "T00:00:00").getTime();
  return Math.round((e - s) / 86400000) + 1;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MY LEAVES VIEW (employee)
// ═══════════════════════════════════════════════════════════════════════════
function MyLeavesView({ leaves, onNew, onCancel }) {
  return (
    <div className="space-y-4 fade-in">
      <button onClick={onNew}
        className="glow-primary press-btn w-full py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-2 slide-up"
        style={{ fontFamily: FS }}>
        <Plus size={14} /> Чөлөөний хүсэлт явуулах
      </button>

      {leaves.length === 0 ? (
        <div className="glass rounded-3xl py-12 px-6 text-center slide-up-delay-1" style={{ color: T.muted }}>
          <Calendar size={28} className="mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm">Илгээсэн чөлөөний хүсэлт алга</p>
        </div>
      ) : (
        <div className="space-y-3 slide-up-delay-1">
          {leaves.map((l) => {
            const status = LEAVE_STATUS[l.status] || LEAVE_STATUS.pending;
            const days = diffDays(l.start_date, l.end_date);
            return (
              <div key={l.id} className="glass lift rounded-2xl p-4 slide-up">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{
                        background: T.highlightSoft, color: T.highlight, fontFamily: FM,
                      }} className="px-2 py-0.5 rounded-full text-[9px] uppercase tracking-[0.2em] font-medium">
                        {LEAVE_TYPES[l.leave_type] || l.leave_type}
                      </span>
                      {!l.paid && (
                        <span style={{ background: "rgba(107,114,128,0.1)", color: T.muted, fontFamily: FM }}
                              className="px-2 py-0.5 rounded-full text-[9px] uppercase tracking-[0.2em]">
                          Цалингүй
                        </span>
                      )}
                    </div>
                    <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-sm">
                      {l.start_date} – {l.end_date}
                    </div>
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mt-0.5">
                      {days} өдөр
                    </div>
                  </div>
                  <span style={{ background: status.soft, color: status.color, fontFamily: FM }}
                        className="px-2.5 py-1 rounded-full text-[9px] uppercase tracking-[0.2em] font-medium">
                    {status.label}
                  </span>
                </div>
                {l.reason && <p style={{ color: T.muted }} className="text-xs leading-relaxed mb-2">{l.reason}</p>}
                {l.admin_note && (
                  <div className="glass-soft rounded-lg p-2.5 mb-2">
                    <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-1">
                      Админы тэмдэглэл
                    </div>
                    <p style={{ fontFamily: FS }} className="text-xs">{l.admin_note}</p>
                  </div>
                )}
                {l.status === "pending" && (
                  <button onClick={() => onCancel(l.id)}
                    className="glass-soft press-btn w-full py-2 rounded-lg text-[11px] uppercase tracking-[0.2em]"
                    style={{ fontFamily: FM, color: T.err }}>
                    Цуцлах
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  LEAVE FORM MODAL
// ═══════════════════════════════════════════════════════════════════════════
function LeaveFormModal({ onClose, onSubmit }) {
  const today = new Date().toISOString().slice(0, 10);
  const [leaveType, setLeaveType] = useState("personal");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const [paid, setPaid] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    if (!startDate || !endDate) return setErr("Огноо сонгоно уу");
    if (new Date(endDate) < new Date(startDate)) return setErr("Дуусах огноо эхлэхээс өмнө байж болохгүй");
    if (!reason.trim()) return setErr("Шалтгаан бичнэ үү");
    setBusy(true);
    await onSubmit({
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      reason: reason.trim(),
      paid,
    });
    setBusy(false);
  };

  const days = startDate && endDate ? diffDays(startDate, endDate) : 0;

  return (
    <Modal onClose={onClose} title="Чөлөөний хүсэлт">
      <div className="space-y-4">
        <Field label="Чөлөөний төрөл" required>
          <select value={leaveType} onChange={(e) => {
            setLeaveType(e.target.value);
            setPaid(e.target.value !== "unpaid");
          }}
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none">
            {Object.entries(LEAVE_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Эхлэх огноо" required>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none" />
          </Field>
          <Field label="Дуусах огноо" required>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none" />
          </Field>
        </div>

        {days > 0 && (
          <div className="glass-soft rounded-xl px-4 py-3 flex items-baseline justify-between">
            <span style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-wider">
              Нийт өдөр
            </span>
            <span style={{ fontFamily: FM, fontWeight: 500, color: T.highlight }} className="text-2xl tabular-nums">
              {days}
            </span>
          </div>
        )}

        <Field label="Шалтгаан" required>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="Жишээ: Эмнэлэгт үзлэгтэй, гэр бүлийн ажил гэх мэт"
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FS }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none resize-none" />
        </Field>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
          <span style={{ fontFamily: FM }} className="text-sm">Цалинтай чөлөө</span>
        </label>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium"
            style={{ fontFamily: FS, color: T.ink }}>Цуцлах</button>
          <button onClick={submit} disabled={busy}
            className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ fontFamily: FS }}>
            {busy ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
            Илгээх
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  LEAVES VIEW (admin/manager)
// ═══════════════════════════════════════════════════════════════════════════
function LeavesView({ leaves, employees, onResolve }) {
  const [tab, setTab] = useState("pending");
  const list = leaves.filter((l) => l.status === tab);
  const empById = (id) => employees.find((e) => e.id === id);

  const counts = {
    pending: leaves.filter((l) => l.status === "pending").length,
    approved: leaves.filter((l) => l.status === "approved").length,
    denied: leaves.filter((l) => l.status === "denied").length,
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex gap-1.5 slide-up">
        {[
          { id: "pending", label: "Хүлээгдэж буй", count: counts.pending },
          { id: "approved", label: "Зөвшөөрсөн", count: counts.approved },
          { id: "denied", label: "Татгалзсан", count: counts.denied },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`${tab === t.id ? "tab-active" : "tab-inactive glass-soft"} press-btn px-3.5 py-1.5 rounded-full border text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5`}
            style={{ fontFamily: FM, borderColor: tab === t.id ? "transparent" : T.borderSoft }}>
            {t.label}
            {t.count > 0 && (
              <span style={{
                background: tab === t.id ? "rgba(255,255,255,0.95)" : T.highlight,
                color: tab === t.id ? T.highlight : "white",
              }} className="px-1.5 py-0.5 rounded-full text-[9px] font-bold tabular-nums">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="glass rounded-3xl py-12 px-6 text-center slide-up-delay-1" style={{ color: T.muted }}>
          <Calendar size={28} className="mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm">{tab === "pending" ? "Хүлээгдэж буй чөлөө алга" : tab === "approved" ? "Зөвшөөрсөн чөлөө алга" : "Татгалзсан чөлөө алга"}</p>
        </div>
      ) : (
        <div className="space-y-3 slide-up-delay-1">
          {list.map((l) => {
            const emp = empById(l.employee_id);
            const days = diffDays(l.start_date, l.end_date);
            return (
              <div key={l.id} className="glass lift rounded-2xl p-5 slide-up">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{ background: T.highlightSoft, color: T.highlight, fontFamily: FM }}
                            className="px-2 py-0.5 rounded-full text-[9px] uppercase tracking-[0.2em] font-medium">
                        {LEAVE_TYPES[l.leave_type]}
                      </span>
                      {!l.paid && (
                        <span style={{ background: "rgba(107,114,128,0.1)", color: T.muted, fontFamily: FM }}
                              className="px-2 py-0.5 rounded-full text-[9px] uppercase tracking-[0.2em]">
                          Цалингүй
                        </span>
                      )}
                    </div>
                    <div style={{ fontFamily: FD, fontWeight: 500 }} className="text-lg">{emp?.name || "(устсан)"}</div>
                    <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-wider mt-0.5">
                      {l.start_date} – {l.end_date} · {days} өдөр
                    </div>
                  </div>
                </div>

                {l.reason && (
                  <div className="glass-soft rounded-lg p-3 mb-3">
                    <p style={{ fontFamily: FS }} className="text-xs leading-relaxed">{l.reason}</p>
                  </div>
                )}

                {l.status === "pending" ? (
                  <div className="flex gap-2">
                    <button onClick={() => onResolve(l, "denied")}
                      className="glass-soft press-btn flex-1 py-2.5 rounded-xl text-xs font-medium"
                      style={{ fontFamily: FS, color: T.ink }}>
                      Татгалзах
                    </button>
                    <button onClick={() => onResolve(l, "approved")}
                      className="glow-success press-btn flex-1 py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
                      style={{ fontFamily: FS }}>
                      <CheckCircle2 size={13} /> Зөвшөөрөх
                    </button>
                  </div>
                ) : l.admin_note && (
                  <div className="glass-soft rounded-lg p-2.5">
                    <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider mb-1">
                      Тэмдэглэл
                    </div>
                    <p style={{ fontFamily: FS }} className="text-xs">{l.admin_note}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  PDF SALARY REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════════════════
async function generateSalaryPDF({ employee, sessions, periodStart, periodEnd, periodLabel }) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ── Header — ORGOO brand
  doc.setFillColor(99, 102, 241); // indigo
  doc.rect(0, 0, pageW, 32, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.text("ORGOO", 14, 18);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("SALARY REPORT", 14, 26);

  // Дата
  doc.setFontSize(9);
  const today = new Date().toLocaleDateString("en-GB");
  doc.text(`Generated: ${today}`, pageW - 14, 18, { align: "right" });
  doc.text(`Period: ${periodLabel}`, pageW - 14, 26, { align: "right" });

  // ── Body — Employee info
  doc.setTextColor(30, 27, 75);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Employee Information", 14, 48);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(75, 85, 99);

  const infoY = 56;
  doc.text("Name:", 14, infoY);
  doc.setTextColor(30, 27, 75);
  doc.setFont("helvetica", "bold");
  doc.text(employee.name || "—", 40, infoY);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(75, 85, 99);
  doc.text("Position:", 14, infoY + 6);
  doc.setTextColor(30, 27, 75);
  doc.setFont("helvetica", "bold");
  doc.text(employee.job_title || "—", 40, infoY + 6);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(75, 85, 99);
  doc.text("Hourly Rate:", 14, infoY + 12);
  doc.setTextColor(30, 27, 75);
  doc.setFont("helvetica", "bold");
  doc.text(`${(employee.hourly_rate || 0).toLocaleString()} MNT/hr`, 40, infoY + 12);

  // ── Calculate totals
  const startMs = periodStart;
  const endMs = periodEnd;
  const filtered = sessions.filter((s) => {
    const t = new Date(s.start_time).getTime();
    return t >= startMs && t < endMs;
  });

  // Group by day
  const byDay = {};
  filtered.forEach((s) => {
    const day = new Date(s.start_time).toISOString().slice(0, 10);
    const ms = new Date(s.end_time).getTime() - new Date(s.start_time).getTime();
    if (!byDay[day]) byDay[day] = 0;
    byDay[day] += ms;
  });

  const days = Object.keys(byDay).sort();
  const totalMs = Object.values(byDay).reduce((a, b) => a + b, 0);
  const totalHours = totalMs / 3600000;
  const rate = employee.hourly_rate || 0;
  const totalSalary = totalHours * rate;

  // ── Big totals card
  const cardY = 82;
  doc.setFillColor(243, 244, 246);
  doc.roundedRect(14, cardY, pageW - 28, 28, 3, 3, "F");

  doc.setTextColor(107, 114, 128);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("TOTAL HOURS", 22, cardY + 8);
  doc.text("WORKING DAYS", 80, cardY + 8);
  doc.text("TOTAL SALARY (MNT)", 138, cardY + 8);

  doc.setTextColor(30, 27, 75);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(`${totalHours.toFixed(1)}`, 22, cardY + 20);
  doc.text(`${days.length}`, 80, cardY + 20);

  doc.setTextColor(99, 102, 241);
  doc.text(totalSalary.toLocaleString(), 138, cardY + 20);

  // ── Table — Daily breakdown
  doc.setTextColor(30, 27, 75);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Daily Breakdown", 14, 122);

  const tableData = days.map((d) => {
    const ms = byDay[d];
    const hours = ms / 3600000;
    const earnings = hours * rate;
    const dateObj = new Date(d);
    const weekday = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dateObj.getDay()];
    return [
      d,
      weekday,
      hours.toFixed(2),
      earnings.toLocaleString(),
    ];
  });

  autoTable(doc, {
    startY: 128,
    head: [["Date", "Day", "Hours", "Earnings (MNT)"]],
    body: tableData,
    foot: [["", "Total", totalHours.toFixed(2), totalSalary.toLocaleString()]],
    theme: "striped",
    headStyles: {
      fillColor: [99, 102, 241],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 10,
    },
    footStyles: {
      fillColor: [237, 233, 254],
      textColor: [99, 102, 241],
      fontStyle: "bold",
    },
    bodyStyles: { textColor: [30, 27, 75], fontSize: 10 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 30, halign: "center" },
      2: { cellWidth: 35, halign: "right" },
      3: { halign: "right" },
    },
    margin: { left: 14, right: 14 },
  });

  // ── Signatures
  const finalY = doc.lastAutoTable.finalY || 200;
  let sigY = finalY + 25;
  if (sigY > pageH - 50) {
    doc.addPage();
    sigY = 30;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(20, sigY, 80, sigY);
  doc.line(pageW - 80, sigY, pageW - 20, sigY);

  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "normal");
  doc.text("Employee signature", 50, sigY + 6, { align: "center" });
  doc.text("Authorized signature", pageW - 50, sigY + 6, { align: "center" });

  // ── Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`ORGOO Time Tracking · ${today}`, pageW / 2, pageH - 8, { align: "center" });

  // Save
  const filename = `salary_${employee.name?.replace(/\s+/g, "_") || "report"}_${periodLabel.replace(/\s+/g, "_")}.pdf`;
  doc.save(filename);
}

// ═══════════════════════════════════════════════════════════════════════════
//  KPI DASHBOARD VIEW
// ═══════════════════════════════════════════════════════════════════════════
function KPIDashboardView({ departments, kpiDefs, kpiEntries, isAdmin, currentUserId, onAddKpi, onEditKpi, onDeleteKpi, onOpenInputForm }) {
  const [period, setPeriod] = useState("month"); // day | week | month | year | custom
  const [selectedDept, setSelectedDept] = useState("all");
  const [confirmDelKpi, setConfirmDelKpi] = useState(null);
  const [viewMode, setViewMode] = useState("cards"); // cards | charts
  const [chartType, setChartType] = useState("bar"); // bar | line | area

  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(today.toISOString().slice(0, 10));
  const [selectedMonth, setSelectedMonth] = useState(today.toISOString().slice(0, 7)); // YYYY-MM
  const [selectedYear, setSelectedYear] = useState(String(today.getFullYear()));
  const [customStart, setCustomStart] = useState(today.toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(today.toISOString().slice(0, 10));

  const periodRange = useMemo(() => {
    if (period === "day") {
      return { start: selectedDate, end: selectedDate, label: selectedDate };
    }
    if (period === "week") {
      const end = new Date(selectedDate);
      const start = new Date(end); start.setDate(end.getDate() - 6);
      return {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        label: `7 хоног (${start.toISOString().slice(5, 10)}–${end.toISOString().slice(5, 10)})`,
      };
    }
    if (period === "month") {
      // Сонгосон сар
      const [year, month] = selectedMonth.split("-").map(Number);
      const start = `${selectedMonth}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
      const monthName = new Date(year, month - 1, 1).toLocaleDateString("mn-MN", { month: "long", year: "numeric" });
      return { start, end, label: monthName };
    }
    if (period === "year") {
      return {
        start: `${selectedYear}-01-01`,
        end: `${selectedYear}-12-31`,
        label: `${selectedYear} он`,
      };
    }
    if (period === "custom") {
      return { start: customStart, end: customEnd, label: `${customStart} – ${customEnd}` };
    }
    return { start: "", end: "", label: "" };
  }, [period, selectedDate, selectedMonth, selectedYear, customStart, customEnd]);

  const filteredEntries = useMemo(() => {
    return kpiEntries.filter((e) => e.entry_date >= periodRange.start && e.entry_date <= periodRange.end);
  }, [kpiEntries, periodRange]);

  const visibleDepts = selectedDept === "all" ? departments : departments.filter(d => d.id === selectedDept);

  // Department-ийн ахлагч мөн үү?
  const isDeptManager = (deptId) => {
    const dept = departments.find(d => d.id === deptId);
    return dept?.manager_id === currentUserId;
  };

  return (
    <div className="space-y-4 fade-in">
      {/* Period type tabs */}
      <div className="glass rounded-2xl p-4 slide-up space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1.5 flex-wrap">
            {[
              { id: "day", label: "Өдөр" },
              { id: "week", label: "7 хоног" },
              { id: "month", label: "Сар" },
              { id: "year", label: "Жил" },
              { id: "custom", label: "Гар" },
            ].map((p) => (
              <button key={p.id} onClick={() => setPeriod(p.id)}
                className={`${period === p.id ? "tab-active" : "tab-inactive glass-soft"} press-btn px-3 py-1.5 rounded-full text-[10px] uppercase tracking-[0.2em]`}
                style={{ fontFamily: FM, borderColor: period === p.id ? "transparent" : T.borderSoft, border: "1px solid" }}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Хэлтэс шүүлт */}
          <select value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)}
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
            className="px-3 py-2 rounded-lg border text-xs outline-none">
            <option value="all">Бүх хэлтэс</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          {isAdmin && (
            <button onClick={onAddKpi}
              className="glow-primary press-btn px-3 py-2 rounded-lg text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5"
              style={{ fontFamily: FM }}>
              <Plus size={11} /> KPI нэмэх
            </button>
          )}
        </div>

        {/* Огноо сонгогчид + view mode */}
        <div className="flex items-center gap-3 flex-wrap pt-1 border-t" style={{ borderColor: T.borderSoft }}>
          {period === "day" && (
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="px-3 py-2 rounded-lg border text-xs outline-none" />
          )}
          {period === "week" && (
            <>
              <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider">Дуусах өдөр:</span>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                className="px-3 py-2 rounded-lg border text-xs outline-none" />
            </>
          )}
          {period === "month" && (
            <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="px-3 py-2 rounded-lg border text-xs outline-none" />
          )}
          {period === "year" && (
            <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="px-3 py-2 rounded-lg border text-xs outline-none">
              {[2024, 2025, 2026, 2027, 2028].map((y) => (
                <option key={y} value={y}>{y} он</option>
              ))}
            </select>
          )}
          {period === "custom" && (
            <>
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                className="px-3 py-2 rounded-lg border text-xs outline-none" />
              <span style={{ color: T.muted }} className="text-xs">→</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                className="px-3 py-2 rounded-lg border text-xs outline-none" />
            </>
          )}

          <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider">
            {periodRange.label}
          </span>

          <div className="flex-1" />

          {/* View mode toggle */}
          <div className="flex gap-1 glass-soft rounded-lg p-0.5">
            <button onClick={() => setViewMode("cards")}
              className={`${viewMode === "cards" ? "bg-white shadow-sm" : ""} press-btn px-3 py-1.5 rounded text-[10px] uppercase tracking-wider`}
              style={{ fontFamily: FM, color: viewMode === "cards" ? T.highlight : T.muted }}>
              Карт
            </button>
            <button onClick={() => setViewMode("charts")}
              className={`${viewMode === "charts" ? "bg-white shadow-sm" : ""} press-btn px-3 py-1.5 rounded text-[10px] uppercase tracking-wider flex items-center gap-1`}
              style={{ fontFamily: FM, color: viewMode === "charts" ? T.highlight : T.muted }}>
              <BarChart3 size={10} /> График
            </button>
          </div>

          {viewMode === "charts" && (
            <select value={chartType} onChange={(e) => setChartType(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="px-3 py-2 rounded-lg border text-xs outline-none">
              <option value="bar">Багана</option>
              <option value="line">Шугам</option>
              <option value="area">Талбай</option>
            </select>
          )}
        </div>
      </div>

      {visibleDepts.length === 0 || kpiDefs.length === 0 ? (
        <div className="glass rounded-3xl py-12 px-6 text-center" style={{ color: T.muted }}>
          <BarChart3 size={32} className="mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm mb-2">{kpiDefs.length === 0 ? "KPI-ууд тохируулаагүй байна" : "Хэлтэс байхгүй байна"}</p>
          {isAdmin && kpiDefs.length === 0 && (
            <button onClick={onAddKpi}
              className="glow-primary press-btn mt-3 px-4 py-2 rounded-full text-[10px] uppercase tracking-[0.2em] inline-flex items-center gap-1.5"
              style={{ fontFamily: FM }}>
              <Plus size={11} /> Эхний KPI нэмэх
            </button>
          )}
        </div>
      ) : (
        visibleDepts.map((dept, deptIdx) => {
          const deptKpis = kpiDefs.filter(k => k.department_id === dept.id);
          if (deptKpis.length === 0) return null;
          const canEnter = isAdmin || isDeptManager(dept.id);

          return (
            <div key={dept.id} className={`glass-strong rounded-3xl p-5 ${deptIdx < 4 ? `slide-up-delay-${deptIdx + 1}` : "slide-up"}`}>
              {/* Department header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <Users size={12} style={{ color: T.highlight }} />
                    <span style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.25em]">
                      Хэлтэс
                    </span>
                  </div>
                  <h3 style={{ fontFamily: FD, fontWeight: 500 }} className="text-2xl">{dept.name}</h3>
                </div>
                {canEnter && (
                  <button onClick={() => onOpenInputForm(dept.id)}
                    className="glow-primary press-btn px-3 py-2 rounded-lg text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5"
                    style={{ fontFamily: FM }}>
                    <Plus size={11} /> Тоо оруулах
                  </button>
                )}
              </div>

              {/* KPI cards or Charts */}
              {viewMode === "charts" ? (
                <KpiChartView
                  deptKpis={deptKpis}
                  filteredEntries={filteredEntries}
                  periodRange={periodRange}
                  chartType={chartType}
                />
              ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {deptKpis.map((kpi) => {
                  const entries = filteredEntries.filter(e => e.kpi_id === kpi.id);
                  const total = entries.reduce((sum, e) => sum + Number(e.value), 0);

                  // Trend: Хэрэв 7 хоног мөн өнгөрсөн 7 хоног харьцуулах
                  let trend = null;
                  if (period === "week" || period === "day") {
                    const prevStart = new Date(periodRange.start);
                    prevStart.setDate(prevStart.getDate() - (period === "day" ? 1 : 7));
                    const prevEnd = new Date(periodRange.end);
                    prevEnd.setDate(prevEnd.getDate() - (period === "day" ? 1 : 7));
                    const prevEntries = kpiEntries.filter(e =>
                      e.kpi_id === kpi.id &&
                      e.entry_date >= prevStart.toISOString().slice(0,10) &&
                      e.entry_date <= prevEnd.toISOString().slice(0,10)
                    );
                    const prevTotal = prevEntries.reduce((s, e) => s + Number(e.value), 0);
                    if (prevTotal > 0) {
                      const change = ((total - prevTotal) / prevTotal) * 100;
                      trend = { change, up: change > 0 };
                    }
                  }

                  return (
                    <div key={kpi.id} className="glass lift rounded-2xl p-4 group relative">
                      <div className="flex items-start justify-between mb-1">
                        <span style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.2em] line-clamp-2">
                          {kpi.name}
                        </span>
                        {isAdmin && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => onEditKpi(kpi)} style={{ color: T.muted }} className="hover:text-black">
                              <Edit3 size={11} />
                            </button>
                            <button onClick={() => setConfirmDelKpi(kpi)} style={{ color: T.err }}>
                              <Trash2 size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span style={{ fontFamily: FD, fontWeight: 500, color: T.ink, letterSpacing: "-0.02em" }}
                              className="text-2xl tabular-nums">
                          {total.toLocaleString()}
                        </span>
                        {kpi.unit && <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">{kpi.unit}</span>}
                      </div>
                      {trend && (
                        <div className="flex items-center gap-1 mt-1.5">
                          {trend.up ? <TrendingUp size={11} style={{ color: T.ok }} /> : <TrendingDown size={11} style={{ color: T.err }} />}
                          <span style={{ color: trend.up ? T.ok : T.err, fontFamily: FM }} className="text-[10px] font-medium">
                            {trend.up ? "+" : ""}{trend.change.toFixed(1)}%
                          </span>
                          <span style={{ color: T.muted, fontFamily: FM }} className="text-[9px]">vs өмнөх</span>
                        </div>
                      )}
                      {entries.length > 0 && period !== "day" && (
                        <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] mt-1.5">
                          {entries.length} өдрийн нийт
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          );
        })
      )}

      {confirmDelKpi && (
        <Modal onClose={() => setConfirmDelKpi(null)} title="KPI устгах уу?" maxW="max-w-sm">
          <p style={{ color: T.muted }} className="text-sm mb-5">
            <strong style={{ color: T.ink }}>{confirmDelKpi.name}</strong> KPI болон бүх оруулсан тоонууд устгагдана.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelKpi(null)}
              className="glass-soft press-btn flex-1 py-2.5 rounded-xl text-sm"
              style={{ fontFamily: FS, color: T.ink }}>Цуцлах</button>
            <button onClick={() => { onDeleteKpi(confirmDelKpi.id); setConfirmDelKpi(null); }}
              className="glow-danger press-btn flex-1 py-2.5 rounded-xl text-sm font-medium"
              style={{ fontFamily: FS }}>Устгах</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  KPI DEFINITION FORM (admin)
// ═══════════════════════════════════════════════════════════════════════════
function KpiDefFormModal({ mode, kpi, departments, onSave, onClose }) {
  const [name, setName] = useState(kpi?.name || "");
  const [unit, setUnit] = useState(kpi?.unit || "");
  const [departmentId, setDepartmentId] = useState(kpi?.department_id || (departments[0]?.id || ""));
  const [category, setCategory] = useState(kpi?.category || "");
  const [order, setOrder] = useState(kpi?.display_order || 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!name.trim()) return setErr("KPI-ийн нэр оруулна уу");
    if (!departmentId) return setErr("Хэлтэс сонгоно уу");
    setBusy(true);
    await onSave({
      id: kpi?.id || null,
      department_id: departmentId,
      name: name.trim(),
      unit: unit.trim(),
      category: category.trim() || null,
      display_order: parseInt(order) || 0,
    });
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={mode === "add" ? "KPI нэмэх" : "KPI засах"}>
      <div className="space-y-4">
        <Field label="Хэлтэс" required>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
            disabled={mode === "edit"}
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none disabled:opacity-60">
            <option value="">— Сонгох —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>

        <Field label="KPI нэр" required>
          <Input value={name} onChange={setName} placeholder="Жишээ: Хандалт, Захиалга" autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Хэмжих нэгж">
            <Input value={unit} onChange={setUnit} placeholder="₮, тоо, %" />
          </Field>
          <Field label="Дараалал">
            <Input value={String(order)} onChange={setOrder} type="number" placeholder="0" />
          </Field>
        </div>

        <Field label="Бүлэг (заавал биш)">
          <Input value={category} onChange={setCategory} placeholder="sales, operations" />
        </Field>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium"
            style={{ fontFamily: FS, color: T.ink }}>Цуцлах</button>
          <button onClick={submit} disabled={busy}
            className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ fontFamily: FS }}>
            {busy && <Loader2 size={13} className="spin" />}
            Хадгалах
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  KPI ENTRY FORM (manager / admin daily input)
// ═══════════════════════════════════════════════════════════════════════════
function KpiEntryFormModal({ department, kpiDefs, existingEntries, onSave, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Date солигдох тоолон утгуудыг ачаалах
  useEffect(() => {
    const initial = {};
    kpiDefs.forEach((k) => {
      const existing = existingEntries.find(e => e.kpi_id === k.id && e.entry_date === date);
      initial[k.id] = existing ? String(existing.value) : "";
    });
    setValues(initial);
  }, [date, kpiDefs.length]);

  const submit = async () => {
    setErr("");
    const entries = Object.entries(values)
      .filter(([_, v]) => v !== "" && !isNaN(Number(v)))
      .map(([kpi_id, v]) => ({ kpi_id, value: Number(v) }));
    if (entries.length === 0) return setErr("Ядаж нэг тоо оруулна уу");
    setBusy(true);
    await onSave(department.id, date, entries);
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={`${department.name} · KPI оруулах`} maxW="max-w-lg">
      <div className="space-y-4">
        <Field label="Огноо" required>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none" />
        </Field>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {kpiDefs.length === 0 ? (
            <div className="glass-soft rounded-xl p-4 text-center">
              <p style={{ color: T.muted }} className="text-sm">Энэ хэлтэст KPI тохируулаагүй байна</p>
            </div>
          ) : (
            kpiDefs.map((k) => (
              <div key={k.id} className="glass-soft rounded-xl p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-sm truncate">{k.name}</div>
                  {k.unit && <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">{k.unit}</div>}
                </div>
                <input type="number" step="any" value={values[k.id] || ""}
                  onChange={(e) => setValues({ ...values, [k.id]: e.target.value })}
                  placeholder="0"
                  style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                  className="w-32 px-3 py-2 rounded-lg border text-sm outline-none text-right tabular-nums" />
              </div>
            ))
          )}
        </div>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium"
            style={{ fontFamily: FS, color: T.ink }}>Цуцлах</button>
          <button onClick={submit} disabled={busy || kpiDefs.length === 0}
            className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ fontFamily: FS }}>
            {busy && <Loader2 size={13} className="spin" />}
            Хадгалах
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  KPI CHART VIEW — Чартаар харах
// ═══════════════════════════════════════════════════════════════════════════
function KpiChartView({ deptKpis, filteredEntries, periodRange, chartType }) {
  const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

  // Огнооны массив (start-аас end хүртэл)
  const dateList = useMemo(() => {
    const list = [];
    const start = new Date(periodRange.start);
    const end = new Date(periodRange.end);
    const cur = new Date(start);
    while (cur <= end) {
      list.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    return list;
  }, [periodRange]);

  // Огноо тус бүрд KPI утгуудыг буулгах
  const chartData = useMemo(() => {
    return dateList.map((date) => {
      const row = { date: date.slice(5) }; // MM-DD
      deptKpis.forEach((kpi) => {
        const entry = filteredEntries.find(e => e.kpi_id === kpi.id && e.entry_date === date);
        row[kpi.name] = entry ? Number(entry.value) : 0;
      });
      return row;
    });
  }, [dateList, deptKpis, filteredEntries]);

  // Хэрэв нэг өдөр л байгаа бол bar chart харуулах (KPI бүрд)
  const isSingleDay = dateList.length === 1;

  if (deptKpis.length === 0) {
    return (
      <div className="glass-soft rounded-xl p-8 text-center" style={{ color: T.muted }}>
        <p className="text-sm">KPI байхгүй</p>
      </div>
    );
  }

  if (filteredEntries.length === 0) {
    return (
      <div className="glass-soft rounded-xl p-8 text-center" style={{ color: T.muted }}>
        <p className="text-sm">Сонгосон хугацаанд тоо оруулаагүй байна</p>
      </div>
    );
  }

  // Single day → 1 bar chart with all KPIs as bars
  if (isSingleDay) {
    const singleDayData = deptKpis.map((kpi, i) => {
      const entry = filteredEntries.find(e => e.kpi_id === kpi.id);
      return {
        name: kpi.name,
        value: entry ? Number(entry.value) : 0,
        unit: kpi.unit,
        color: COLORS[i % COLORS.length],
      };
    });

    return (
      <div className="glass-soft rounded-2xl p-4">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={singleDayData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <RechartsTooltip contentStyle={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 12 }} />
            <Bar dataKey="value" radius={[8, 8, 0, 0]}>
              {singleDayData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Multi-day — line/bar/area chart with date axis
  const ChartComponent = chartType === "line" ? LineChart : chartType === "area" ? AreaChart : BarChart;
  const DataComponent = chartType === "line" ? Line : chartType === "area" ? Area : Bar;

  return (
    <div className="glass-soft rounded-2xl p-4">
      <ResponsiveContainer width="100%" height={350}>
        <ChartComponent data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <RechartsTooltip contentStyle={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {deptKpis.map((kpi, i) => (
            <DataComponent
              key={kpi.id}
              type="monotone"
              dataKey={kpi.name}
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={chartType === "area" ? 0.3 : 1}
              radius={chartType === "bar" ? [4, 4, 0, 0] : 0}
              strokeWidth={chartType === "line" ? 2.5 : 1}
              dot={chartType === "line" ? { r: 3 } : false}
            />
          ))}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TASKS — helpers
// ═══════════════════════════════════════════════════════════════════════════
const TASK_STATUS = {
  todo: { label: "Хийх", color: T.muted, bg: "rgba(107,114,128,0.1)", icon: "📋" },
  in_progress: { label: "Хийж буй", color: T.warn, bg: "rgba(245,158,11,0.12)", icon: "⚡" },
  done: { label: "Хийсэн", color: T.ok, bg: "rgba(16,185,129,0.12)", icon: "✅" },
};

const TASK_PRIORITY = {
  low: { label: "Бага", color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
  medium: { label: "Дунд", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  high: { label: "Өндөр", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
  urgent: { label: "Яаралтай", color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
};

// ═══════════════════════════════════════════════════════════════════════════
//  TASKS VIEW (admin/manager) — Kanban
// ═══════════════════════════════════════════════════════════════════════════
function TasksView({ tasks, departments, employees, currentUserId, isAdmin, onAdd, onEdit, onDelete, onUpdateStatus }) {
  const [selectedDept, setSelectedDept] = useState("all");
  const [confirmDel, setConfirmDel] = useState(null);

  const filteredTasks = selectedDept === "all" ? tasks : tasks.filter(t => t.department_id === selectedDept);

  const tasksByStatus = {
    todo: filteredTasks.filter(t => t.status === "todo"),
    in_progress: filteredTasks.filter(t => t.status === "in_progress"),
    done: filteredTasks.filter(t => t.status === "done"),
  };

  const empById = (id) => employees.find(e => e.id === id);
  const deptById = (id) => departments.find(d => d.id === id);

  return (
    <div className="space-y-4 fade-in">
      {/* Filter bar */}
      <div className="glass rounded-2xl p-4 slide-up flex items-center gap-3 flex-wrap">
        <select value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)}
          style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
          className="px-3 py-2 rounded-lg border text-xs outline-none">
          <option value="all">Бүх хэлтэс</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        <div className="flex-1" />

        <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider">
          {filteredTasks.length} даалгавар
        </div>

        <button onClick={onAdd}
          className="glow-primary press-btn px-3 py-2 rounded-lg text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5"
          style={{ fontFamily: FM }}>
          <Plus size={11} /> Даалгавар нэмэх
        </button>
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {Object.entries(tasksByStatus).map(([status, list], colIdx) => {
          const meta = TASK_STATUS[status];
          return (
            <div key={status} className={`glass rounded-3xl p-4 slide-up-delay-${colIdx + 1}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 14 }}>{meta.icon}</span>
                  <h3 style={{ fontFamily: FD, fontWeight: 500 }} className="text-base">{meta.label}</h3>
                </div>
                <span style={{ background: meta.bg, color: meta.color, fontFamily: FM }}
                      className="px-2 py-0.5 rounded-full text-[9px] font-bold tabular-nums">
                  {list.length}
                </span>
              </div>

              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {list.length === 0 ? (
                  <div style={{ color: T.muted }} className="text-center py-8 text-xs">
                    Даалгавар алга
                  </div>
                ) : list.map((t) => {
                  const dept = deptById(t.department_id);
                  const assignee = empById(t.assignee_id);
                  const priority = TASK_PRIORITY[t.priority] || TASK_PRIORITY.medium;
                  const isOverdue = t.due_date && t.status !== "done" && new Date(t.due_date) < new Date(new Date().toISOString().slice(0,10));

                  return (
                    <div key={t.id} className="glass-soft rounded-xl p-3 lift cursor-pointer slide-up"
                         onClick={() => onEdit(t)}>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span style={{ background: priority.bg, color: priority.color, fontFamily: FM }}
                                className="px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider font-bold">
                            {priority.label}
                          </span>
                          {dept && (
                            <span style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider truncate">
                              {dept.name}
                            </span>
                          )}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDel(t); }}
                          style={{ color: T.muted }} className="hover:text-red-500 shrink-0">
                          <Trash2 size={10} />
                        </button>
                      </div>

                      <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-sm mb-1.5 line-clamp-2">
                        {t.title}
                      </div>

                      {t.description && (
                        <p style={{ color: T.muted }} className="text-[11px] leading-relaxed line-clamp-2 mb-2">
                          {t.description}
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        {assignee ? (
                          <div className="flex items-center gap-1">
                            <div style={{
                              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                              color: "white",
                            }} className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold">
                              {assignee.name?.[0]}
                            </div>
                            <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] truncate">
                              {assignee.name}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] italic">
                            Хариуцагчгүй
                          </span>
                        )}

                        {t.due_date && (
                          <span style={{
                            color: isOverdue ? T.err : T.muted,
                            fontFamily: FM,
                          }} className="text-[10px]">
                            📅 {t.due_date.slice(5)}
                            {isOverdue && " ⚠"}
                          </span>
                        )}
                      </div>

                      {/* Status change buttons */}
                      <div className="flex gap-1 mt-2 pt-2 border-t" style={{ borderColor: T.borderSoft }}>
                        {status !== "todo" && (
                          <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(t.id, "todo"); }}
                            className="glass-soft press-btn flex-1 py-1 rounded text-[9px] uppercase tracking-wider"
                            style={{ fontFamily: FM, color: T.muted }}>
                            ← Хийх
                          </button>
                        )}
                        {status !== "in_progress" && (
                          <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(t.id, "in_progress"); }}
                            className="glass-soft press-btn flex-1 py-1 rounded text-[9px] uppercase tracking-wider"
                            style={{ fontFamily: FM, color: T.warn }}>
                            ⚡ Эхлэх
                          </button>
                        )}
                        {status !== "done" && (
                          <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(t.id, "done"); }}
                            className="glass-soft press-btn flex-1 py-1 rounded text-[9px] uppercase tracking-wider"
                            style={{ fontFamily: FM, color: T.ok }}>
                            ✓ Дуусгах
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)} title="Даалгавар устгах?" maxW="max-w-sm">
          <p style={{ color: T.muted }} className="text-sm mb-5">
            <strong style={{ color: T.ink }}>{confirmDel.title}</strong> устгагдана.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDel(null)}
              className="glass-soft press-btn flex-1 py-2.5 rounded-xl text-sm"
              style={{ fontFamily: FS, color: T.ink }}>Цуцлах</button>
            <button onClick={() => { onDelete(confirmDel.id); setConfirmDel(null); }}
              className="glow-danger press-btn flex-1 py-2.5 rounded-xl text-sm font-medium"
              style={{ fontFamily: FS }}>Устгах</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TASK FORM MODAL
// ═══════════════════════════════════════════════════════════════════════════
function TaskFormModal({ mode, task, departments, employees, onSave, onClose }) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [departmentId, setDepartmentId] = useState(task?.department_id || (departments[0]?.id || ""));
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id || "");
  const [priority, setPriority] = useState(task?.priority || "medium");
  const [status, setStatus] = useState(task?.status || "todo");
  const [dueDate, setDueDate] = useState(task?.due_date || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!title.trim()) return setErr("Гарчиг бичнэ үү");
    if (!departmentId) return setErr("Хэлтэс сонгоно уу");
    setBusy(true);
    await onSave({
      id: task?.id || null,
      department_id: departmentId,
      title: title.trim(),
      description: description.trim() || null,
      assignee_id: assigneeId || null,
      priority,
      status,
      due_date: dueDate || null,
    });
    setBusy(false);
  };

  // Хэлтсийн ажилтнууд
  const deptEmps = departmentId ? employees.filter(e => e.department_id === departmentId) : employees;

  return (
    <Modal onClose={onClose} title={mode === "add" ? "Шинэ даалгавар" : "Даалгавар засах"}>
      <div className="space-y-4">
        <Field label="Гарчиг" required>
          <Input value={title} onChange={setTitle} placeholder="Жишээ: Сарын тайлан бэлдэх" autoFocus />
        </Field>

        <Field label="Дэлгэрэнгүй">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            placeholder="Юу хийх вэ, хэрхэн хийх ёстой г.м"
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FS }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none resize-none" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Хэлтэс" required>
            <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setAssigneeId(""); }}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none">
              <option value="">— Сонгох —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Хариуцагч">
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none">
              <option value="">— Сонгоогүй —</option>
              {deptEmps.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Чухалчлал">
            <select value={priority} onChange={(e) => setPriority(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none">
              {Object.entries(TASK_PRIORITY).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Дуусах огноо">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none" />
          </Field>
        </div>

        {mode === "edit" && (
          <Field label="Төлөв">
            <div className="flex gap-1.5">
              {Object.entries(TASK_STATUS).map(([k, v]) => (
                <button key={k} onClick={() => setStatus(k)}
                  className={`${status === k ? "tab-active" : "tab-inactive glass-soft"} press-btn flex-1 py-2 rounded-lg text-[10px] uppercase tracking-wider`}
                  style={{ fontFamily: FM, borderColor: status === k ? "transparent" : T.borderSoft, border: "1px solid" }}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
          </Field>
        )}

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            className="glass-soft press-btn flex-1 py-3 rounded-xl text-sm font-medium"
            style={{ fontFamily: FS, color: T.ink }}>Цуцлах</button>
          <button onClick={submit} disabled={busy}
            className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ fontFamily: FS }}>
            {busy && <Loader2 size={13} className="spin" />}
            Хадгалах
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  MY TASKS VIEW (employee) — Kanban + add own
// ═══════════════════════════════════════════════════════════════════════════
function MyTasksView({ tasks, currentUserId, colleagues, hasDepartment, onAdd, onEdit, onDelete, onUpdateStatus }) {
  const [filter, setFilter] = useState("assigned"); // assigned | created | all
  const [viewMode, setViewMode] = useState("kanban"); // kanban | list
  const [confirmDel, setConfirmDel] = useState(null);

  const filtered = filter === "assigned" ? tasks.filter(t => t.assignee_id === currentUserId)
                  : filter === "created" ? tasks.filter(t => t.created_by === currentUserId)
                  : tasks;

  const tasksByStatus = {
    todo: filtered.filter(t => t.status === "todo"),
    in_progress: filtered.filter(t => t.status === "in_progress"),
    done: filtered.filter(t => t.status === "done"),
  };

  const empById = (id) => colleagues.find(e => e.id === id);

  return (
    <div className="space-y-4 fade-in">
      {/* Filter + add */}
      <div className="glass rounded-2xl p-4 slide-up flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {[
            { id: "assigned", label: "Надад", count: tasks.filter(t => t.assignee_id === currentUserId).length },
            { id: "created", label: "Миний үүсгэсэн", count: tasks.filter(t => t.created_by === currentUserId).length },
            { id: "all", label: "Бүгд", count: tasks.length },
          ].map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`${filter === f.id ? "tab-active" : "tab-inactive glass-soft"} press-btn px-3 py-1.5 rounded-full border text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5`}
              style={{ fontFamily: FM, borderColor: filter === f.id ? "transparent" : T.borderSoft }}>
              {f.label}
              {f.count > 0 && (
                <span style={{
                  background: filter === f.id ? "rgba(255,255,255,0.95)" : T.highlight,
                  color: filter === f.id ? T.highlight : "white",
                }} className="px-1.5 py-0.5 rounded-full text-[9px] font-bold tabular-nums">{f.count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex gap-1 glass-soft rounded-lg p-0.5">
          <button onClick={() => setViewMode("kanban")}
            className={`${viewMode === "kanban" ? "bg-white shadow-sm" : ""} press-btn px-2.5 py-1.5 rounded text-[10px] uppercase tracking-wider`}
            style={{ fontFamily: FM, color: viewMode === "kanban" ? T.highlight : T.muted }}>
            Kanban
          </button>
          <button onClick={() => setViewMode("list")}
            className={`${viewMode === "list" ? "bg-white shadow-sm" : ""} press-btn px-2.5 py-1.5 rounded text-[10px] uppercase tracking-wider`}
            style={{ fontFamily: FM, color: viewMode === "list" ? T.highlight : T.muted }}>
            Жагсаалт
          </button>
        </div>

        {hasDepartment && (
          <button onClick={onAdd}
            className="glow-primary press-btn px-3 py-2 rounded-lg text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5"
            style={{ fontFamily: FM }}>
            <Plus size={11} /> Шинэ
          </button>
        )}
      </div>

      {!hasDepartment && (
        <div className="glass rounded-3xl py-6 px-4 text-center slide-up-delay-1" style={{ color: T.warn }}>
          <AlertCircle size={20} className="mx-auto mb-2" strokeWidth={1.5} />
          <p style={{ fontFamily: FM }} className="text-xs">
            Та хэлтэст харьяалагдаагүй учраас даалгавар үүсгэх боломжгүй. Админд хандана уу.
          </p>
        </div>
      )}

      {/* Kanban view */}
      {viewMode === "kanban" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {Object.entries(tasksByStatus).map(([status, list], colIdx) => {
            const meta = TASK_STATUS[status];
            return (
              <div key={status} className={`glass rounded-3xl p-4 slide-up-delay-${colIdx + 1}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 14 }}>{meta.icon}</span>
                    <h3 style={{ fontFamily: FD, fontWeight: 500 }} className="text-base">{meta.label}</h3>
                  </div>
                  <span style={{ background: meta.bg, color: meta.color, fontFamily: FM }}
                        className="px-2 py-0.5 rounded-full text-[9px] font-bold tabular-nums">
                    {list.length}
                  </span>
                </div>

                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {list.length === 0 ? (
                    <div style={{ color: T.muted }} className="text-center py-8 text-xs">
                      Алга
                    </div>
                  ) : list.map((t) => {
                    const assignee = empById(t.assignee_id);
                    const priority = TASK_PRIORITY[t.priority] || TASK_PRIORITY.medium;
                    const isOverdue = t.due_date && t.status !== "done" && new Date(t.due_date) < new Date(new Date().toISOString().slice(0,10));
                    const canEdit = t.created_by === currentUserId || t.assignee_id === currentUserId;

                    return (
                      <div key={t.id} className="glass-soft rounded-xl p-3 lift cursor-pointer slide-up"
                           onClick={() => canEdit && onEdit(t)}>
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <span style={{ background: priority.bg, color: priority.color, fontFamily: FM }}
                                className="px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider font-bold">
                            {priority.label}
                          </span>
                          {(t.created_by === currentUserId) && (
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDel(t); }}
                              style={{ color: T.muted }} className="hover:text-red-500 shrink-0">
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>

                        <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-sm mb-1.5 line-clamp-2">
                          {t.title}
                        </div>

                        {t.description && (
                          <p style={{ color: T.muted }} className="text-[11px] leading-relaxed line-clamp-2 mb-2">
                            {t.description}
                          </p>
                        )}

                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          {assignee ? (
                            <div className="flex items-center gap-1">
                              <div style={{
                                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                                color: "white",
                              }} className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold">
                                {assignee.name?.[0]}
                              </div>
                              <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] truncate">
                                {assignee.name}
                              </span>
                            </div>
                          ) : (
                            <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] italic">
                              Хариуцагчгүй
                            </span>
                          )}

                          {t.due_date && (
                            <span style={{
                              color: isOverdue ? T.err : T.muted,
                              fontFamily: FM,
                            }} className="text-[10px]">
                              📅 {t.due_date.slice(5)}
                              {isOverdue && " ⚠"}
                            </span>
                          )}
                        </div>

                        {/* Status change buttons (only for assignee) */}
                        {t.assignee_id === currentUserId && (
                          <div className="flex gap-1 mt-2 pt-2 border-t" style={{ borderColor: T.borderSoft }}>
                            {status !== "todo" && (
                              <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(t.id, "todo"); }}
                                className="glass-soft press-btn flex-1 py-1 rounded text-[9px] uppercase tracking-wider"
                                style={{ fontFamily: FM, color: T.muted }}>
                                ← Хийх
                              </button>
                            )}
                            {status !== "in_progress" && (
                              <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(t.id, "in_progress"); }}
                                className="glass-soft press-btn flex-1 py-1 rounded text-[9px] uppercase tracking-wider"
                                style={{ fontFamily: FM, color: T.warn }}>
                                ⚡ Эхлэх
                              </button>
                            )}
                            {status !== "done" && (
                              <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(t.id, "done"); }}
                                className="glass-soft press-btn flex-1 py-1 rounded text-[9px] uppercase tracking-wider"
                                style={{ fontFamily: FM, color: T.ok }}>
                                ✓ Дуусгах
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List view */}
      {viewMode === "list" && (
        <>
          {filtered.length === 0 ? (
            <div className="glass rounded-3xl py-12 px-6 text-center slide-up-delay-1" style={{ color: T.muted }}>
              <ClipboardCheck size={28} className="mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm">Даалгавар алга</p>
            </div>
          ) : (
            <div className="space-y-2 slide-up-delay-1">
              {filtered.map((t) => {
                const status = TASK_STATUS[t.status];
                const priority = TASK_PRIORITY[t.priority];
                const isOverdue = t.due_date && t.status !== "done" && new Date(t.due_date) < new Date(new Date().toISOString().slice(0,10));
                const assignee = empById(t.assignee_id);

                return (
                  <div key={t.id} className="glass lift rounded-2xl p-4 slide-up cursor-pointer"
                       onClick={() => onEdit(t)}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span style={{ background: priority.bg, color: priority.color, fontFamily: FM }}
                                className="px-2 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold">
                            {priority.label}
                          </span>
                          <span style={{ background: status.bg, color: status.color, fontFamily: FM }}
                                className="px-2 py-0.5 rounded text-[9px] uppercase tracking-wider">
                            {status.icon} {status.label}
                          </span>
                          {assignee && (
                            <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
                              👤 {assignee.name}
                            </span>
                          )}
                        </div>
                        <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-sm mb-1">
                          {t.title}
                        </div>
                        {t.description && (
                          <p style={{ color: T.muted }} className="text-xs leading-relaxed mb-2">{t.description}</p>
                        )}
                        {t.due_date && (
                          <div style={{ color: isOverdue ? T.err : T.muted, fontFamily: FM }} className="text-[10px] mt-1">
                            📅 {t.due_date}
                            {isOverdue && <span className="ml-1 font-bold">⚠ Хугацаа хэтэрсэн</span>}
                          </div>
                        )}
                      </div>
                    </div>

                    {t.assignee_id === currentUserId && t.status !== "done" && (
                      <div className="flex gap-2 mt-3 pt-3 border-t" style={{ borderColor: T.borderSoft }}>
                        {t.status === "todo" && (
                          <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(t.id, "in_progress"); }}
                            className="glow-warn press-btn flex-1 py-2 rounded-lg text-[10px] uppercase tracking-wider font-medium"
                            style={{ fontFamily: FM }}>
                            ⚡ Эхлэх
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); onUpdateStatus(t.id, "done"); }}
                          className="glow-success press-btn flex-1 py-2 rounded-lg text-[10px] uppercase tracking-wider font-medium"
                          style={{ fontFamily: FM }}>
                          ✓ Дуусгах
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)} title="Даалгавар устгах?" maxW="max-w-sm">
          <p style={{ color: T.muted }} className="text-sm mb-5">
            <strong style={{ color: T.ink }}>{confirmDel.title}</strong> устгагдана.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDel(null)}
              className="glass-soft press-btn flex-1 py-2.5 rounded-xl text-sm"
              style={{ fontFamily: FS, color: T.ink }}>Цуцлах</button>
            <button onClick={() => { onDelete(confirmDel.id); setConfirmDel(null); }}
              className="glow-danger press-btn flex-1 py-2.5 rounded-xl text-sm font-medium"
              style={{ fontFamily: FS }}>Устгах</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
