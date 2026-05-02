import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Play, Square, Trash2, X, Users, Calendar, MapPin, Edit3,
  AlertCircle, CheckCircle2, Loader2, Crosshair, LogOut, Lock,
  ClipboardCheck, Clock, Inbox, FileText, Send,
  ShieldCheck, User as UserIcon, Eye, EyeOff,
  Download, FileSpreadsheet, Filter, BarChart3, TrendingUp, TrendingDown,
  Camera, Moon, Sun, Briefcase, Vote, ChevronDown, ChevronRight,
  Bell, Phone, ShoppingBag, Package,
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

// Upload photo to Supabase storage
async function uploadClockPhoto(employeeId, blob, type = "in") {
  if (!blob) return null;
  try {
    const ts = Date.now();
    const path = `${employeeId}/${type}-${ts}.jpg`;
    const { data, error } = await supabase.storage
      .from("clock-photos")
      .upload(path, blob, {
        contentType: "image/jpeg",
        cacheControl: "3600",
      });
    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from("clock-photos")
      .getPublicUrl(path);
    return urlData.publicUrl;
  } catch (e) {
    console.error("Photo upload failed:", e);
    return null;
  }
}

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

// Notification sound — Web Audio API ашиглан зөөлөн "ping"
const playNotificationSound = () => {
  try {
    const stored = localStorage.getItem("orgoo-sound");
    if (stored === "off") return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    // Двух нотын "ding-dong"
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15); // E5
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // silent fail
  }
};

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
  // Background — Soft gradient (peach → pink → violet)
  bg: "linear-gradient(135deg, #fef3ec 0%, #ffe5e5 50%, #e8e3f8 100%)",
  bgSolid: "#fef3ec",
  // Surfaces — frosted glass
  surface: "rgba(255, 255, 255, 0.7)",
  surfaceStrong: "rgba(255, 255, 255, 0.85)",
  surfaceAlt: "rgba(255, 255, 255, 0.45)",
  surfaceGlass: "rgba(255, 255, 255, 0.55)",
  // Text — warm slate
  ink: "#44403c", inkSoft: "#57534e",
  muted: "#78716c", mutedSoft: "#a8a29e",
  // Borders — translucent white
  border: "rgba(255, 255, 255, 0.7)",
  borderSoft: "rgba(255, 255, 255, 0.5)",
  borderStrong: "rgba(244, 114, 182, 0.25)",
  // Accent — Pink → Orange gradient
  highlight: "#ec4899",
  highlightDark: "#db2777",
  highlightSoft: "rgba(244, 114, 182, 0.12)",
  highlightGlow: "0 8px 24px rgba(244, 114, 182, 0.25)",
  // Statuses
  ok: "#10b981", okSoft: "rgba(16,185,129,0.12)",
  err: "#ef4444", errSoft: "rgba(239,68,68,0.12)",
  warn: "#f59e0b", warnSoft: "rgba(245,158,11,0.12)",
  // Helpers
  blur: "blur(20px) saturate(180%)",
  cardShadow: "0 8px 24px rgba(244, 114, 182, 0.08)",
  cardShadowHover: "0 12px 32px rgba(244, 114, 182, 0.15)",
};
const FS = "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif";
const FM = "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif";
const FD = "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif";

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
        // Sound (pleasant ding-dong)
        playNotificationSound();
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
              background: "#ec4899",
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
              background: "#ec4899",
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
  const [view, setView] = useState("dashboard");
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
  const [photoCapture, setPhotoCapture] = useState(null); // { emp, site, loc, distance, type }
  const [photoViewer, setPhotoViewer] = useState(null); // { url, employee, time }

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
  const [announcements, setAnnouncements] = useState([]);
  const [editingAnn, setEditingAnn] = useState(null);

  const loadAll = async () => {
    const [emps, sess, active, apps, st, es, me, dept, lvs, kpiD, kpiE, tsk, ann] = await Promise.all([
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
      supabase.from("announcements").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }),
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
    if (ann.data) setAnnouncements(ann.data);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () => loadAll())
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
      // Open photo capture modal first
      setPhotoCapture({
        emp,
        site,
        loc,
        distance: d,
        type: "in",
      });
    } catch (e) { setFeedback({ empId: emp.id, type: "error", msg: e.message }); }
    finally { setGeoBusyId(null); }
  };

  // Complete clock-in after photo
  const completeClockInWithPhoto = async (photoBlob) => {
    if (!photoCapture) return;
    const { emp, site, loc, distance } = photoCapture;
    try {
      // Upload photo
      const photoUrl = await uploadClockPhoto(emp.id, photoBlob, "in");

      // Insert active session
      const startTime = new Date(capSessionStart(emp, Date.now())).toISOString();
      const { error } = await supabase.from("active_sessions").upsert({
        employee_id: emp.id, start_time: startTime,
        start_lat: loc.lat, start_lng: loc.lng, distance_meters: distance,
        site_id: site.id,
        clock_in_photo_url: photoUrl,
      });
      if (error) throw error;
      setFeedback({ empId: emp.id, type: "success", msg: `Цаг бүртгэгдлээ · ${site.name} · ${fmtDist(distance)}` });
      setPhotoCapture(null);
      await loadAll();
    } catch (e) {
      setFeedback({ empId: emp.id, type: "error", msg: e.message });
      setPhotoCapture(null);
    }
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
          target: data.target, target_period: data.target_period,
          kpi_type: data.kpi_type || 'input',
          formula: data.formula || null,
          decimals: data.decimals ?? 0,
        }).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("kpi_definitions").insert({
          department_id: data.department_id,
          name: data.name, unit: data.unit, category: data.category,
          display_order: data.display_order || 0,
          target: data.target, target_period: data.target_period || 'daily',
          kpi_type: data.kpi_type || 'input',
          formula: data.formula || null,
          decimals: data.decimals ?? 0,
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div style={{ color: T.ink, fontFamily: FS, background: T.bg }} className="min-h-screen">
      <div className="flex min-h-screen">
        {/* SIDEBAR */}
        <aside style={{
          background: "rgba(255,255,255,0.6)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderRight: `1px solid ${T.border}`,
          width: 240,
        }} className={`fixed lg:sticky top-0 left-0 h-screen z-40 flex flex-col transition-transform ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>

          {/* Logo header */}
          <div className="px-4 py-4 border-b" style={{ borderColor: T.border }}>
            <div className="flex items-center gap-2.5">
              <div style={{ background: "linear-gradient(135deg, #f97316, #ec4899)", color: "white" }} className="w-8 h-8 rounded-md flex items-center justify-center">
                <ShieldCheck size={14} />
              </div>
              <div className="flex-1">
                <div style={{ fontFamily: FS, fontWeight: 600, letterSpacing: "-0.02em" }} className="text-base leading-none">
                  ORGOO<span style={{ color: T.highlight }}>.</span>
                </div>
                <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mt-0.5">
                  Admin
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="lg:hidden" style={{ color: T.muted }}>
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto px-2 py-3">
            <SidebarSection label="Хяналт">
              <SidebarTab active={view === "team"} onClick={() => { setView("team"); setSidebarOpen(false); }} icon={Users}>Баг</SidebarTab>
              <SidebarTab active={view === "livemap"} onClick={() => { setView("livemap"); setSidebarOpen(false); }} icon={MapPin}>Газрын зураг</SidebarTab>
              <SidebarTab active={view === "dashboard"} onClick={() => { setView("dashboard"); setSidebarOpen(false); }} icon={BarChart3}>Дашборд</SidebarTab>
              <SidebarTab active={view === "tasks"} onClick={() => { setView("tasks"); setSidebarOpen(false); }} icon={ClipboardCheck}>Даалгавар</SidebarTab>
              <SidebarTab active={view === "announcements"} onClick={() => { setView("announcements"); setSidebarOpen(false); }} icon={Inbox}>Зарлал</SidebarTab>
              <SidebarTab active={view === "best"} onClick={() => { setView("best"); setSidebarOpen(false); }} icon={ShieldCheck}>Шилдэг</SidebarTab>
              <SidebarTab active={view === "calendar"} onClick={() => { setView("calendar"); setSidebarOpen(false); }} icon={Calendar}>Календар</SidebarTab>
              <SidebarTab active={view === "schedule"} onClick={() => { setView("schedule"); setSidebarOpen(false); }} icon={Clock}>Хуваарь</SidebarTab>
              <SidebarTab active={view === "skills"} onClick={() => { setView("skills"); setSidebarOpen(false); }} icon={ShieldCheck}>Ур чадвар</SidebarTab>
              <SidebarTab active={view === "polls"} onClick={() => { setView("polls"); setSidebarOpen(false); }} icon={Vote}>Санал асуулга</SidebarTab>
              <SidebarTab active={view === "hrfile"} onClick={() => { setView("hrfile"); setSidebarOpen(false); }} icon={Briefcase}>HR файл</SidebarTab>
            </SidebarSection>

            <SidebarSection label="Бизнес">
              <SidebarTab active={view === "callcenter"} onClick={() => { setView("callcenter"); setSidebarOpen(false); }} icon={Phone}>Дуудлага</SidebarTab>
              <SidebarTab active={view === "orders"} onClick={() => { setView("orders"); setSidebarOpen(false); }} icon={ShoppingBag}>Захиалга</SidebarTab>
              <SidebarTab active={view === "customers"} onClick={() => { setView("customers"); setSidebarOpen(false); }} icon={Users}>Үйлчлүүлэгч</SidebarTab>
              <SidebarTab active={view === "fbpages"} onClick={() => { setView("fbpages"); setSidebarOpen(false); }} icon={Send}>FB Pages</SidebarTab>
              <SidebarTab active={view === "inventory"} onClick={() => { setView("inventory"); setSidebarOpen(false); }} icon={Package}>Бараа нөөц</SidebarTab>
              <SidebarTab active={view === "stockcount"} onClick={() => { setView("stockcount"); setSidebarOpen(false); }} icon={ClipboardCheck}>Тооллого</SidebarTab>
            </SidebarSection>

            <SidebarSection label="Ажилтнууд">
              <SidebarTab active={view === "departments"} onClick={() => { setView("departments"); setSidebarOpen(false); }} icon={Users}>Хэлтсүүд</SidebarTab>
              <SidebarTab active={view === "managers"} onClick={() => { setView("managers"); setSidebarOpen(false); }} icon={ShieldCheck}>Ахлагчид</SidebarTab>
              <SidebarTab active={view === "sites"} onClick={() => { setView("sites"); setSidebarOpen(false); }} icon={MapPin}>Байрууд</SidebarTab>
            </SidebarSection>

            <SidebarSection label="Хүсэлтүүд">
              <SidebarTab active={view === "approvals"} onClick={() => { setView("approvals"); setSidebarOpen(false); }} icon={Inbox} badge={pendingApprovals.length}>Хүсэлт</SidebarTab>
              <SidebarTab active={view === "leaves"} onClick={() => { setView("leaves"); setSidebarOpen(false); }} icon={Calendar} badge={leaves.filter(l => l.status === "pending").length}>Чөлөө</SidebarTab>
              <SidebarTab active={view === "ledger"} onClick={() => { setView("ledger"); setSidebarOpen(false); }} icon={Calendar}>Тэмдэглэл</SidebarTab>
            </SidebarSection>
          </nav>

          {/* Footer · User card */}
          <div className="border-t px-2 py-2" style={{ borderColor: T.border }}>
            <div className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-gray-50 transition-colors">
              <div style={{ background: "linear-gradient(135deg, #f97316, #ec4899)", color: "white" }} className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold">
                {profile.name?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-xs truncate">
                  {profile.name}
                </div>
                <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider">
                  Админ
                </div>
              </div>
              <DarkModeToggle />
              <button onClick={() => supabase.auth.signOut()} style={{ color: T.muted }}
                className="press-btn p-1.5 rounded hover:bg-gray-100" title="Гарах">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </aside>

        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)}
               className="fixed inset-0 bg-black/30 z-30 lg:hidden" />
        )}

        {/* MAIN CONTENT */}
        <main className="flex-1 min-w-0">
          {/* Mobile top bar */}
          <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b sticky top-0 z-20" style={{ background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderColor: T.border }}>
            <button onClick={() => setSidebarOpen(true)} style={{ color: T.ink }}>
              <Inbox size={18} />
            </button>
            <div style={{ fontFamily: FS, fontWeight: 600 }} className="text-sm">ORGOO<span style={{ color: T.highlight }}>.</span></div>
          </div>

          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 sm:py-8">
            {/* Page header */}
            <div className="mb-6 slide-up">
              <h1 style={{ fontFamily: FS, fontWeight: 600, letterSpacing: "-0.02em" }} className="text-2xl mb-1">
                {view === "team" && "Баг"}
                {view === "livemap" && "Газрын зураг"}
                {view === "dashboard" && "Дашборд"}
                {view === "tasks" && "Даалгавар"}
                {view === "announcements" && "Зарлал"}
                {view === "best" && "Шилдэг ажилтан"}
                {view === "calendar" && "Календар"}
                {view === "schedule" && "Хуваарь"}
                {view === "skills" && "Ур чадвар"}
                {view === "polls" && "Санал асуулга"}
                {view === "hrfile" && "HR хувийн файл"}
                {view === "inventory" && "Бараа нөөц"}
                {view === "stockcount" && "Тооллого"}
                {view === "callcenter" && "Дуудлагын самбар"}
                {view === "orders" && "Захиалга"}
                {view === "customers" && "Үйлчлүүлэгч"}
                {view === "fbpages" && "Facebook Pages"}
                {view === "departments" && "Хэлтсүүд"}
                {view === "managers" && "Ахлагчид"}
                {view === "sites" && "Байрууд"}
                {view === "approvals" && "Хүсэлт"}
                {view === "leaves" && "Чөлөө"}
                {view === "ledger" && "Тэмдэглэл"}
              </h1>
              <p style={{ color: T.muted }} className="text-sm">
                {view === "team" && `${employees.length} ажилтан · ${activeCount} ажиллаж байна`}
                {view === "livemap" && `${activeCount} ажилтан газрын зураг дээр харагдаж байна`}
                {view === "dashboard" && "Хэлтсийн KPI болон тоон үзүүлэлтүүд"}
                {view === "tasks" && "Даалгаврын Kanban самбар"}
                {view === "announcements" && "Бүх ажилтанд хүрэх мэдээлэл"}
                {view === "best" && "Сар бүрийн шилдэг ажилтны жагсаалт"}
                {view === "calendar" && "Чөлөө + амралтын календар"}
                {view === "schedule" && "Долоо хоногийн ажлын хуваарь"}
                {view === "skills" && "Ажилтны ур чадвар + сургалт"}
                {view === "polls" && "Ажилтнуудаас санал авах"}
                {view === "hrfile" && "Ажилтны хувийн дэлгэрэнгүй мэдээлэл"}
                {view === "inventory" && "Бараа, нөөц, орлого/зарлага хяналт"}
                {view === "stockcount" && "Бараа тоолох, зөрүү засах систем"}
                {view === "callcenter" && "Утсан захиалга хүлээн авах"}
                {view === "orders" && "Бүх захиалгын жагсаалт"}
                {view === "customers" && "Бүх үйлчлүүлэгчийн дугаар, түүх"}
                {view === "fbpages" && "Маркетингийн source хяналт"}
                {view === "departments" && "Хэлтсийн жагсаалт"}
                {view === "managers" && "Хэлтсийн ахлагчид"}
                {view === "sites" && "Цаг бүртгэлийн байршлууд"}
                {view === "approvals" && `${pendingApprovals.length} хариу хүлээж буй хүсэлт`}
                {view === "leaves" && `${leaves.filter(l => l.status === "pending").length} хариу хүлээж буй чөлөө`}
                {view === "ledger" && "Цаг бүртгэлийн нарийвчилсан түүх"}
              </p>
            </div>

            {view === "team" && (
              <div className="flex justify-end mb-4">
                <button onClick={() => { setFormEmp(null); setFormMode("add"); }}
                  className="glow-primary press-btn px-4 py-2 rounded-full text-[11px] uppercase tracking-[0.2em] flex items-center gap-1.5">
                  <Plus size={13} strokeWidth={2.5} /> Ажилтан нэмэх
                </button>
              </div>
            )}
            {view === "sites" && (
              <div className="flex justify-end mb-4">
                <button onClick={() => { setSiteFormData(null); setSiteFormMode("add"); }}
                  className="glow-primary press-btn px-4 py-2 rounded-full text-[11px] uppercase tracking-[0.2em] flex items-center gap-1.5">
                  <Plus size={13} strokeWidth={2.5} /> Байр нэмэх
                </button>
              </div>
            )}
            {view === "departments" && (
              <div className="flex justify-end mb-4">
                <button onClick={() => setEditingDept("add")}
                  className="glow-primary press-btn px-4 py-2 rounded-full text-[11px] uppercase tracking-[0.2em] flex items-center gap-1.5">
                  <Plus size={13} strokeWidth={2.5} /> Хэлтэс нэмэх
                </button>
              </div>
            )}

        {feedback && !feedback.empId && (
          <div className="mb-4"><FeedbackBox type={feedback.type}>{feedback.msg}</FeedbackBox></div>
        )}

        {view === "team" && (
          <TeamView
            employees={employees} sessions={sessions} activeSessions={activeSessions}
            sites={sites} employeeSites={employeeSites} leaves={leaves}
            geoBusyId={geoBusyId} feedback={feedback}
            onEdit={(emp) => { setFormEmp(emp); setFormMode("edit"); }}
            onDelete={(id) => setConfirmDel(id)}
            onClockIn={tryClockIn} onClockOut={tryClockOut}
            onViewPhoto={(data) => setPhotoViewer(data)}
            onAdd={() => { setFormEmp(null); setFormMode("add"); }} />
        )}
        {view === "livemap" && (
          <LiveMap
            employees={employees}
            activeSessions={activeSessions}
            sites={sites}
            sessions={sessions}
            departments={departments}
            scope="all"
          />
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

        {view === "announcements" && (
          <AnnouncementsView
            announcements={announcements}
            isAdmin={true}
            onAdd={() => setEditingAnn("add")}
            onEdit={(a) => setEditingAnn(a)}
            onDelete={async (id) => {
              try {
                await supabase.from("announcements").delete().eq("id", id);
                setFeedback({ type: "success", msg: "Устгагдлаа" });
                await loadAll();
              } catch (e) { setFeedback({ type: "error", msg: e.message }); }
            }}
          />
        )}

        {view === "best" && (
          <BestEmployeeView
            employees={employees}
            sessions={sessions}
            kpiEntries={kpiEntries}
            leaves={leaves}
          />
        )}

        {view === "calendar" && (
          <CalendarView
            leaves={leaves}
            employees={employees}
            scope="all"
          />
        )}

        {view === "schedule" && (
          <ScheduleView
            employees={employees}
            sites={sites}
            isAdmin={true}
          />
        )}

        {view === "skills" && (
          <SkillsView
            employees={employees}
            isAdmin={true}
          />
        )}

        {view === "polls" && (
          <PollsView
            profile={profile}
            isAdmin={true}
          />
        )}

        {view === "hrfile" && (
          <HRPersonalFileView
            employees={employees}
            profile={profile}
            isAdmin={true}
          />
        )}

        {view === "inventory" && (
          <InventoryView profile={profile} isAdmin={true} />
        )}

        {view === "stockcount" && (
          <StockCountView profile={profile} />
        )}

        {view === "callcenter" && (
          <CallCenterView profile={profile} />
        )}

        {view === "orders" && (
          <OrdersView profile={profile} />
        )}

        {view === "customers" && (
          <CustomersView profile={profile} />
        )}

        {view === "fbpages" && (
          <FbPagesView profile={profile} />
        )}

            <Footer count={sessions.length} />
          </div>
        </main>
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
          allKpis={kpiDefs}
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

      {editingAnn && (
        <AnnouncementFormModal
          mode={editingAnn === "add" ? "add" : "edit"}
          announcement={editingAnn === "add" ? null : editingAnn}
          onSave={async (data) => {
            try {
              if (data.id) {
                await supabase.from("announcements").update({
                  title: data.title, body: data.body, priority: data.priority,
                  pinned: data.pinned, expires_at: data.expires_at,
                }).eq("id", data.id);
              } else {
                await supabase.from("announcements").insert({
                  title: data.title, body: data.body, priority: data.priority,
                  pinned: data.pinned, expires_at: data.expires_at,
                  created_by: profile.id,
                });
              }
              setEditingAnn(null);
              setFeedback({ type: "success", msg: "Хадгаллаа" });
              await loadAll();
            } catch (e) { setFeedback({ type: "error", msg: e.message }); }
          }}
          onClose={() => setEditingAnn(null)} />
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

      {photoCapture && (
        <PhotoCaptureModal
          title="Цаг бүртгэхийн тулд зураг авна уу"
          onCapture={completeClockInWithPhoto}
          onCancel={() => setPhotoCapture(null)}
        />
      )}

      {photoViewer && (
        <PhotoViewerModal
          photoUrl={photoViewer.url}
          employee={photoViewer.employee}
          time={photoViewer.time}
          onClose={() => setPhotoViewer(null)}
        />
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
  const [myAnnouncements, setMyAnnouncements] = useState([]);
  const [nearestDistances, setNearestDistances] = useState(null);
  const [mySites, setMySites] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [photoFor, setPhotoFor] = useState(null); // {type: "in"|"out", siteId, callback}
  const [showSitePicker, setShowSitePicker] = useState(false);
  const [photoCapture, setPhotoCapture] = useState(null); // { site, loc, distance }
  const [, setTick] = useState(0);

  useEffect(() => { const id = setInterval(() => setTick((t) => t+1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (!feedback) return; const t = setTimeout(() => setFeedback(null), 5000); return () => clearTimeout(t); }, [feedback]);

  const loadMy = async () => {
    const [sess, active, apps, esResult, lvs, tsk, depts, colleagues, ann] = await Promise.all([
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
      supabase.from("announcements").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }),
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
    if (ann.data) setMyAnnouncements(ann.data);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () => loadMy())
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
      const startTimeMs = site.is_flexible ? Date.now() : capSessionStart(profile, Date.now());
      // Open photo modal to take selfie before saving
      setPhotoCapture({ site, loc, distance: d, startTime: new Date(startTimeMs).toISOString() });
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
    finally { setGeoBusy(false); }
  };

  const completeMyClockInWithPhoto = async (photoBlob) => {
    if (!photoCapture) return;
    const { site, loc, distance, startTime } = photoCapture;
    try {
      const photoUrl = await uploadClockPhoto(profile.id, photoBlob, "in");
      const { error } = await supabase.from("active_sessions").upsert({
        employee_id: profile.id, start_time: startTime,
        start_lat: loc.lat, start_lng: loc.lng, distance_meters: distance,
        site_id: site.id,
        clock_in_photo_url: photoUrl,
      });
      if (error) throw error;
      setFeedback({ type: "success", msg: `Цаг бүртгэгдлээ · ${site.name} · ${fmtDist(distance)}` });
      setPhotoCapture(null);
      await loadMy();
    } catch (e) {
      setFeedback({ type: "error", msg: e.message });
      setPhotoCapture(null);
    }
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div style={{ color: T.ink, fontFamily: FS, background: T.bg }} className="min-h-screen">
      <div className="flex min-h-screen">
        {/* SIDEBAR */}
        <aside style={{
          background: "rgba(255,255,255,0.6)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderRight: `1px solid ${T.border}`,
          width: 240,
        }} className={`fixed lg:sticky top-0 left-0 h-screen z-40 flex flex-col transition-transform ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>

          <div className="px-4 py-4 border-b" style={{ borderColor: T.border }}>
            <div className="flex items-center gap-2.5">
              <div style={{
                background: isActive ? "#10b981" : "#ec4899",
                color: "white",
              }} className="w-8 h-8 rounded-md flex items-center justify-center transition-all">
                <UserIcon size={14} />
              </div>
              <div className="flex-1">
                <div style={{ fontFamily: FS, fontWeight: 600, letterSpacing: "-0.02em" }} className="text-base leading-none">
                  ORGOO<span style={{ color: T.highlight }}>.</span>
                </div>
                <div style={{ color: isActive ? T.ok : T.muted, fontFamily: FS, fontWeight: 500 }} className="text-[10px] uppercase tracking-wider mt-0.5">
                  {isActive ? "● Ажиллаж байна" : "Ажилтан"}
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="lg:hidden" style={{ color: T.muted }}>
                <X size={16} />
              </button>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-3">
            <SidebarSection label="Үндсэн">
              <SidebarTab active={view === "home"} onClick={() => { setView("home"); setSidebarOpen(false); }} icon={Clock}>Цаг бүртгэл</SidebarTab>
              <SidebarTab active={view === "salary"} onClick={() => { setView("salary"); setSidebarOpen(false); }} icon={FileSpreadsheet}>Цалин</SidebarTab>
              <SidebarTab active={view === "history"} onClick={() => { setView("history"); setSidebarOpen(false); }} icon={Calendar}>Түүх</SidebarTab>
            </SidebarSection>

            <SidebarSection label="Ажил">
              <SidebarTab active={view === "tasks"} onClick={() => { setView("tasks"); setSidebarOpen(false); }} icon={ClipboardCheck}>Даалгавар</SidebarTab>
              <SidebarTab active={view === "announcements"} onClick={() => { setView("announcements"); setSidebarOpen(false); }} icon={Inbox} badge={myAnnouncements.filter(a => a.pinned).length}>Зарлал</SidebarTab>
              <SidebarTab active={view === "schedule"} onClick={() => { setView("schedule"); setSidebarOpen(false); }} icon={Clock}>Хуваарь</SidebarTab>
              <SidebarTab active={view === "skills"} onClick={() => { setView("skills"); setSidebarOpen(false); }} icon={ShieldCheck}>Ур чадвар</SidebarTab>
              <SidebarTab active={view === "calendar"} onClick={() => { setView("calendar"); setSidebarOpen(false); }} icon={Calendar}>Календар</SidebarTab>
              <SidebarTab active={view === "polls"} onClick={() => { setView("polls"); setSidebarOpen(false); }} icon={Vote}>Санал асуулга</SidebarTab>
              <SidebarTab active={view === "hrfile"} onClick={() => { setView("hrfile"); setSidebarOpen(false); }} icon={Briefcase}>Миний файл</SidebarTab>
            </SidebarSection>

            <SidebarSection label="Хүсэлтүүд">
              <SidebarTab active={view === "leaves"} onClick={() => { setView("leaves"); setSidebarOpen(false); }} icon={Calendar}>Чөлөө</SidebarTab>
              <SidebarTab active={view === "requests"} onClick={() => { setView("requests"); setSidebarOpen(false); }} icon={ClipboardCheck} badge={myApprovals.filter((a) => a.status === "pending").length}>Хүсэлт</SidebarTab>
            </SidebarSection>
          </nav>

          <div className="border-t px-2 py-2" style={{ borderColor: T.border }}>
            <div className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-gray-50">
              <div style={{ background: "linear-gradient(135deg, #f97316, #ec4899)", color: "white" }} className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold">
                {profile.name?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-xs truncate">
                  {profile.name}
                </div>
                <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider truncate">
                  {profile.job_title}
                </div>
              </div>
              <DarkModeToggle />
              <button onClick={() => supabase.auth.signOut()} style={{ color: T.muted }}
                className="press-btn p-1.5 rounded hover:bg-gray-100">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </aside>

        {sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)}
               className="fixed inset-0 bg-black/30 z-30 lg:hidden" />
        )}

        {/* MAIN */}
        <main className="flex-1 min-w-0">
          <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b sticky top-0 z-20" style={{ background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderColor: T.border }}>
            <button onClick={() => setSidebarOpen(true)} style={{ color: T.ink }}>
              <Inbox size={18} />
            </button>
            <div style={{ fontFamily: FS, fontWeight: 600 }} className="text-sm">ORGOO<span style={{ color: T.highlight }}>.</span></div>
            {isActive && (
              <div className="ml-auto flex items-center gap-1.5">
                <div style={{ background: T.ok }} className="w-2 h-2 rounded-full pulse-dot"></div>
                <span style={{ color: T.ok, fontFamily: FS }} className="text-[10px] uppercase tracking-wider font-medium">
                  Ажиллаж буй
                </span>
              </div>
            )}
          </div>

          <div className="max-w-2xl mx-auto px-5 sm:px-8 py-6 sm:py-8">
            <div className="mb-6 slide-up">
              <h1 style={{ fontFamily: FS, fontWeight: 600, letterSpacing: "-0.02em" }} className="text-2xl mb-1">
                {view === "home" && "Цаг бүртгэл"}
                {view === "salary" && "Цалин"}
                {view === "history" && "Ажилласан түүх"}
                {view === "tasks" && "Даалгавар"}
                {view === "announcements" && "Зарлал"}
                {view === "leaves" && "Чөлөө"}
                {view === "requests" && "Хүсэлт"}
                {view === "schedule" && "Миний хуваарь"}
                {view === "skills" && "Миний ур чадвар"}
                {view === "calendar" && "Календар"}
                {view === "polls" && "Санал асуулга"}
                {view === "hrfile" && "Миний хувийн файл"}
              </h1>
              <p style={{ color: T.muted }} className="text-sm">
                Сайн байна уу, {profile.name}!
              </p>
            </div>

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

        {view === "announcements" && (
          <AnnouncementsView
            announcements={myAnnouncements}
            isAdmin={false}
          />
        )}
        {view === "requests" && <PersonalRequests approvals={myApprovals} onNew={() => setShowRequest(true)} />}

        {view === "schedule" && (
          <ScheduleView
            employees={[profile]}
            sites={mySites}
            isAdmin={false}
            currentUserId={profile.id}
          />
        )}

        {view === "skills" && (
          <SkillsView
            employees={[profile]}
            isAdmin={false}
            currentUserId={profile.id}
          />
        )}

        {view === "calendar" && (
          <CalendarView
            leaves={myLeaves}
            employees={[profile]}
            scope="self"
            currentUserId={profile.id}
          />
        )}

        {view === "polls" && (
          <PollsView
            profile={profile}
            isAdmin={false}
          />
        )}

        {view === "hrfile" && (
          <HRPersonalFileView
            employees={[profile]}
            profile={profile}
            isAdmin={false}
            currentUserId={profile.id}
          />
        )}

        <Footer count={mySessions.length} />
          </div>
        </main>
      </div>

      {showRequest && (
        <RequestModal profile={profile} onClose={() => setShowRequest(false)} onSubmit={submitRequest} />
      )}

      {photoCapture && (
        <PhotoCaptureModal
          title="Цаг бүртгэхийн тулд зураг авна уу"
          onCapture={completeMyClockInWithPhoto}
          onCancel={() => setPhotoCapture(null)}
        />
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
function TeamView({ employees, sessions, activeSessions, sites = [], employeeSites = [], leaves = [], geoBusyId, feedback, onEdit, onDelete, onClockIn, onClockOut, onAdd, onViewPhoto }) {
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
                {activeSessions[emp.id]?.clock_in_photo_url && (
                  <button onClick={() => onViewPhoto({
                    url: activeSessions[emp.id].clock_in_photo_url,
                    employee: emp,
                    time: activeSessions[emp.id].start_time,
                  })} style={{ color: T.ok }} className="p-1.5 rounded-lg hover:bg-black/5" title="Clock-in зураг">
                    <Camera size={14} />
                  </button>
                )}
                <button onClick={() => {
                  const now = new Date();
                  exportSalaryPdf(emp, sessions, leaves, now.getFullYear(), now.getMonth() + 1)
                    .catch(e => alert("PDF алдаа: " + e.message));
                }} style={{ color: T.highlight }} className="p-1.5 rounded-lg hover:bg-black/5" title="Цалингийн PDF">
                  <FileText size={14} />
                </button>
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

function SidebarTab({ active, onClick, icon: Icon, badge, children }) {
  return (
    <button onClick={onClick}
      className={`press-btn w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all ${active ? "" : ""}`}
      style={{
        fontFamily: FS,
        background: active ? T.highlightSoft : "transparent",
        color: active ? T.highlight : T.inkSoft,
        fontWeight: active ? 500 : 400,
        textAlign: "left",
      }}>
      <Icon size={15} strokeWidth={2} style={{ color: active ? T.highlight : T.muted, flexShrink: 0 }} />
      <span className="flex-1 truncate">{children}</span>
      {badge > 0 && (
        <span style={{
          background: T.highlight,
          color: "white",
        }} className="px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}

function SidebarSection({ label, children, defaultOpen = true }) {
  // localStorage-аас сэргээх (label-ыг key болгож)
  const storageKey = label ? `orgoo-sidebar-${label}` : null;
  const [open, setOpen] = useState(() => {
    if (!storageKey || typeof window === "undefined") return defaultOpen;
    const stored = localStorage.getItem(storageKey);
    return stored === null ? defaultOpen : stored === "1";
  });

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, open ? "1" : "0");
    }
  }, [open, storageKey]);

  return (
    <div className="mb-4">
      {label && (
        <button
          onClick={() => setOpen(!open)}
          className="press-btn w-full flex items-center justify-between px-3 mb-1.5 hover:opacity-70 transition-opacity group"
          style={{ fontFamily: FS, color: T.mutedSoft }}>
          <span className="text-[10px] uppercase tracking-[0.15em] font-medium">
            {label}
          </span>
          {open
            ? <ChevronDown size={11} style={{ color: T.mutedSoft }} />
            : <ChevronRight size={11} style={{ color: T.mutedSoft }} />}
        </button>
      )}
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

// Dark mode toggle
function DarkModeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("orgoo-dark") === "1";
  });

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark-mode");
      localStorage.setItem("orgoo-dark", "1");
    } else {
      document.documentElement.classList.remove("dark-mode");
      localStorage.setItem("orgoo-dark", "0");
    }
  }, [dark]);

  return (
    <button onClick={() => setDark(!dark)}
      style={{ color: T.muted }}
      className="press-btn p-1.5 rounded hover:bg-black/5"
      title={dark ? "Цайвар горим" : "Бараан горим"}>
      {dark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  BEST EMPLOYEE VIEW — Сарын шилдэг ажилтан
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
//  POLLS VIEW — Санал асуулга
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
//  INVENTORY VIEW — Бараа нөөц
// ═══════════════════════════════════════════════════════════════════════════
function InventoryView({ profile, isAdmin = false }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [movementFor, setMovementFor] = useState(null); // { product, type: "in"|"out" }
  const [showBulkReceive, setShowBulkReceive] = useState(false);
  const [filterCat, setFilterCat] = useState("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("products"); // products | history | low

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: prodData }, { data: catData }, { data: movData }] = await Promise.all([
        supabase.from("inv_products").select("*").eq("is_active", true).order("name"),
        supabase.from("inv_categories").select("*").order("display_order"),
        supabase.from("inv_movements").select("*").order("created_at", { ascending: false }).limit(100),
      ]);
      setProducts(prodData || []);
      setCategories(catData || []);
      setMovements(movData || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  // Filtered products
  const filtered = useMemo(() => {
    let result = products;
    if (filterCat !== "all") {
      result = result.filter((p) => p.category_id === filterCat);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((p) =>
        p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [products, filterCat, search]);

  // Low stock products
  const lowStock = useMemo(() =>
    products.filter((p) => p.min_stock > 0 && p.stock <= p.min_stock),
    [products]
  );

  // Total value (нөөцийн зарах үнээр) ба авсан үнэ
  const totalValue = products.reduce((sum, p) => sum + (Number(p.stock) * Number(p.sale_price || 0)), 0);
  const totalCost = products.reduce((sum, p) => sum + (Number(p.stock) * Number(p.cost_price || 0)), 0);
  const totalProducts = products.length;

  const catById = (id) => categories.find((c) => c.id === id);

  const handleDelete = async (id) => {
    if (!confirm("Энэ барааг устгах уу?")) return;
    await supabase.from("inv_products").update({ is_active: false }).eq("id", id);
    await loadAll();
  };

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Нийт бараа</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.ink }} className="text-2xl">{totalProducts}</div>
        </div>
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Нөөцийн үнэ</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.highlight }} className="text-lg sm:text-xl tabular-nums">
            {totalValue.toLocaleString()}₮
          </div>
        </div>
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Нөөц багатай</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: lowStock.length > 0 ? T.warn : T.ink }} className="text-2xl">
            {lowStock.length}
          </div>
        </div>
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Нийт авсан үнэ</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.ink }} className="text-lg sm:text-xl tabular-nums">
            {totalCost.toLocaleString()}₮
          </div>
        </div>
      </div>

      {/* Tabs + actions */}
      <div className="glass rounded-2xl p-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-0.5 rounded-full" style={{ background: T.surfaceAlt }}>
          <button onClick={() => setTab("products")}
            className={`press-btn px-3 py-1.5 rounded-full text-xs ${tab === "products" ? "tab-active" : ""}`}
            style={{ fontFamily: FS, fontWeight: 500 }}>
            📦 Бараа ({filtered.length})
          </button>
          <button onClick={() => setTab("low")}
            className={`press-btn px-3 py-1.5 rounded-full text-xs ${tab === "low" ? "tab-active" : ""}`}
            style={{ fontFamily: FS, fontWeight: 500 }}>
            ⚠ Анхааруулга ({lowStock.length})
          </button>
          <button onClick={() => setTab("history")}
            className={`press-btn px-3 py-1.5 rounded-full text-xs ${tab === "history" ? "tab-active" : ""}`}
            style={{ fontFamily: FS, fontWeight: 500 }}>
            📜 Түүх
          </button>
        </div>

        <div className="flex-1" />

        {tab === "products" && (
          <>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Хайх..."
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS, padding: "6px 10px", borderRadius: 8 }}
              className="text-xs w-32 sm:w-44" />
            <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS, padding: "6px 10px", borderRadius: 8 }}
              className="text-xs">
              <option value="all">Бүх категори</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}

        {isAdmin && (
          <>
            <button onClick={() => setShowBulkReceive(true)}
              disabled={products.length === 0}
              className="press-btn px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1"
              style={{
                background: products.length === 0 ? T.surfaceAlt : "linear-gradient(135deg, #10b981, #14b8a6)",
                color: products.length === 0 ? T.mutedSoft : "white",
                fontFamily: FS,
              }}>
              📥 Бөөн орлого
            </button>
            <button onClick={() => setEditing({})}
              className="glow-primary press-btn px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1">
              <Plus size={12} /> Бараа
            </button>
          </>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="glass rounded-2xl p-8 text-center" style={{ color: T.muted, fontFamily: FS }}>
          <Loader2 className="spin mx-auto mb-2" size={20} />
        </div>
      ) : tab === "products" ? (
        filtered.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="text-4xl mb-2">📦</div>
            <div style={{ color: T.muted, fontFamily: FS }} className="text-sm mb-3">
              Бараа олдсонгүй
            </div>
            {isAdmin && products.length === 0 && (
              <button onClick={() => setEditing({})}
                className="glow-primary press-btn px-4 py-2 rounded-full text-xs font-semibold">
                + Анхны бараа нэмэх
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {filtered.map((p) => {
              const cat = catById(p.category_id);
              const isLow = p.min_stock > 0 && p.stock <= p.min_stock;
              const isOut = p.stock <= 0;
              const stockPct = p.min_stock > 0 ? Math.min(100, (p.stock / (p.min_stock * 2)) * 100) : 100;
              return (
                <div key={p.id} className="glass lift rounded-xl p-3">
                  {/* Зураг */}
                  {p.image_url && (
                    <div style={{
                      width: "100%", height: 120,
                      borderRadius: 8, overflow: "hidden",
                      background: T.surfaceAlt, marginBottom: 10,
                    }}>
                      <img src={p.image_url} alt={p.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => { e.target.style.display = "none"; }} />
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {cat && (
                          <span style={{ background: cat.color || T.highlight, color: "white" }}
                            className="text-[9px] px-1.5 py-0.5 rounded-full font-medium">
                            {cat.name}
                          </span>
                        )}
                        {isOut && <span style={{ background: T.errSoft, color: T.err }}
                          className="text-[9px] px-1.5 py-0.5 rounded-full font-medium">⚠ Дууссан</span>}
                        {!isOut && isLow && <span style={{ background: T.warnSoft, color: T.warn }}
                          className="text-[9px] px-1.5 py-0.5 rounded-full font-medium">⚠ Багатай</span>}
                      </div>
                      <div style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm mt-1 truncate">
                        {p.name}
                      </div>
                      {p.sku && (
                        <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
                          SKU: {p.sku}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-baseline gap-1 mb-2">
                    <span style={{
                      fontFamily: FD, fontWeight: 700,
                      color: isOut ? T.err : isLow ? T.warn : T.ink,
                    }} className="text-2xl">
                      {Number(p.stock).toLocaleString()}
                    </span>
                    <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
                      {p.unit}
                    </span>
                    {p.min_stock > 0 && (
                      <span style={{ color: T.muted, fontFamily: FM }} className="text-[9px] ml-auto">
                        мин: {p.min_stock}
                      </span>
                    )}
                  </div>

                  {p.min_stock > 0 && (
                    <div style={{ background: T.surfaceAlt, height: 4, borderRadius: 2 }} className="mb-2">
                      <div style={{
                        width: `${stockPct}%`,
                        height: "100%",
                        background: isOut ? T.err : isLow ? T.warn : T.ok,
                        borderRadius: 2,
                      }} />
                    </div>
                  )}

                  <div className="flex justify-between text-[10px]" style={{ fontFamily: FM, color: T.muted }}>
                    <span>Авсан: {Number(p.cost_price || 0).toLocaleString()}₮</span>
                    <span>Зарсан: {Number(p.sale_price || 0).toLocaleString()}₮</span>
                  </div>

                  <div className="flex gap-1 mt-2 pt-2 border-t" style={{ borderColor: T.borderSoft }}>
                    <button onClick={() => setMovementFor({ product: p, type: "in" })}
                      className="press-btn flex-1 py-1 rounded text-[10px]"
                      style={{ background: T.successSoft || "rgba(16,185,129,0.1)", color: T.ok, fontFamily: FS, fontWeight: 600 }}>
                      📥 Орлого
                    </button>
                    {isAdmin && (
                      <>
                        <button onClick={() => setEditing(p)} style={{ color: T.muted }}
                          className="press-btn p-1 rounded">
                          <Edit3 size={11} />
                        </button>
                        <button onClick={() => handleDelete(p.id)} style={{ color: T.err }}
                          className="press-btn p-1 rounded">
                          <Trash2 size={11} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : tab === "low" ? (
        lowStock.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="text-4xl mb-2">✅</div>
            <div style={{ color: T.muted, fontFamily: FS }} className="text-sm">
              Бүх барааны нөөц хангалттай
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {lowStock.map((p) => (
              <div key={p.id} className="glass rounded-xl p-3 flex items-center gap-3">
                <div style={{ background: T.warnSoft, color: T.warn }}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0">
                  ⚠
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm truncate">
                    {p.name}
                  </div>
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
                    Үлдэгдэл: {p.stock} {p.unit} · Мин: {p.min_stock} {p.unit}
                  </div>
                </div>
                <button onClick={() => setMovementFor({ product: p, type: "in" })}
                  className="glow-primary press-btn px-3 py-1.5 rounded-full text-xs font-semibold">
                  📥 Орлого
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        // History
        movements.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="text-4xl mb-2">📜</div>
            <div style={{ color: T.muted, fontFamily: FS }} className="text-sm">
              Хөдөлгөөн хараахан байхгүй байна
            </div>
          </div>
        ) : (
          <div className="glass rounded-2xl p-3 overflow-x-auto">
            <table className="w-full" style={{ minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <th style={{ fontFamily: FM, color: T.muted, fontWeight: 500, textAlign: "left" }} className="text-[10px] uppercase tracking-wider pb-2">Огноо</th>
                  <th style={{ fontFamily: FM, color: T.muted, fontWeight: 500, textAlign: "left" }} className="text-[10px] uppercase tracking-wider pb-2">Бараа</th>
                  <th style={{ fontFamily: FM, color: T.muted, fontWeight: 500, textAlign: "center" }} className="text-[10px] uppercase tracking-wider pb-2">Төрөл</th>
                  <th style={{ fontFamily: FM, color: T.muted, fontWeight: 500, textAlign: "right" }} className="text-[10px] uppercase tracking-wider pb-2">Тоо ширхэг</th>
                  <th style={{ fontFamily: FM, color: T.muted, fontWeight: 500, textAlign: "right" }} className="text-[10px] uppercase tracking-wider pb-2">Дүн</th>
                </tr>
              </thead>
              <tbody>
                {movements.slice(0, 50).map((m) => {
                  const product = products.find((p) => p.id === m.product_id);
                  return (
                    <tr key={m.id} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                      <td style={{ fontFamily: FM, color: T.muted }} className="text-[10px] py-2">
                        {new Date(m.created_at).toLocaleString("mn-MN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td style={{ fontFamily: FS, color: T.ink, fontWeight: 500 }} className="text-xs py-2">
                        {product?.name || "—"}
                      </td>
                      <td className="text-xs py-2 text-center">
                        <span style={{
                          background: m.movement_type === "in" ? "rgba(16,185,129,0.1)" : m.movement_type === "out" ? T.errSoft : T.surfaceAlt,
                          color: m.movement_type === "in" ? T.ok : m.movement_type === "out" ? T.err : T.muted,
                          fontFamily: FS, fontWeight: 600,
                        }} className="px-2 py-0.5 rounded text-[10px]">
                          {m.movement_type === "in" ? "📥 Орлого" : m.movement_type === "out" ? "📤 Зарлага" : "⚙ Засвар"}
                        </span>
                      </td>
                      <td style={{ fontFamily: FM, color: T.ink, fontWeight: 600 }} className="text-xs py-2 text-right tabular-nums">
                        {Number(m.quantity).toLocaleString()}
                      </td>
                      <td style={{ fontFamily: FM, color: T.muted }} className="text-xs py-2 text-right tabular-nums">
                        {m.total_amount ? Number(m.total_amount).toLocaleString() + "₮" : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {editing && (
        <ProductFormModal
          product={editing.id ? editing : null}
          categories={categories}
          profile={profile}
          onSave={async (data) => {
            try {
              if (editing.id) {
                await supabase.from("inv_products").update({ ...data, updated_at: new Date().toISOString() }).eq("id", editing.id);
              } else {
                await supabase.from("inv_products").insert({ ...data, created_by: profile.id });
              }
              setEditing(null);
              await loadAll();
            } catch (e) { alert("Алдаа: " + e.message); }
          }}
          onAddCategory={async (name) => {
            try {
              const { data } = await supabase.from("inv_categories").insert({ name }).select().single();
              await loadAll();
              return data;
            } catch (e) { alert("Алдаа: " + e.message); return null; }
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {movementFor && (
        <MovementFormModal
          product={movementFor.product}
          type={movementFor.type}
          profile={profile}
          onSave={async (data) => {
            try {
              await supabase.from("inv_movements").insert({
                product_id: movementFor.product.id,
                movement_type: movementFor.type,
                ...data,
                created_by: profile.id,
              });
              setMovementFor(null);
              await loadAll();
            } catch (e) { alert("Алдаа: " + e.message); }
          }}
          onClose={() => setMovementFor(null)}
        />
      )}

      {showBulkReceive && (
        <BulkReceivingModal
          products={products}
          profile={profile}
          onSave={async ({ header, items }) => {
            try {
              // 1. Receiving header insert
              const { data: receivData, error: rErr } = await supabase
                .from("inv_receivings")
                .insert({ ...header, created_by: profile.id })
                .select()
                .single();
              if (rErr) throw rErr;

              // 2. Movement бүрд insert (trigger automatically updates stock)
              const movements = items.map((it) => ({
                product_id: it.product_id,
                movement_type: "in",
                quantity: it.quantity,
                unit_price: it.unit_price,
                total_amount: it.total_amount,
                reason: "purchase",
                reference_number: header.receiving_number,
                receiving_id: receivData.id,
                notes: header.supplier_name ? `Нийлүүлэгч: ${header.supplier_name}` : null,
                created_by: profile.id,
              }));
              const { error: mErr } = await supabase.from("inv_movements").insert(movements);
              if (mErr) throw mErr;

              setShowBulkReceive(false);
              await loadAll();
              alert(`✅ ${items.length} бараа амжилттай орлогдлоо!\nНийт дүн: ${header.total_amount.toLocaleString()}₮`);
            } catch (e) { alert("Алдаа: " + e.message); }
          }}
          onClose={() => setShowBulkReceive(false)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  STOCK COUNT VIEW — Тооллого
// ═══════════════════════════════════════════════════════════════════════════
function StockCountView({ profile }) {
  const [counts, setCounts] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCount, setActiveCount] = useState(null); // open detail
  const [showNewModal, setShowNewModal] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: countsData }, { data: prodData }, { data: catData }] = await Promise.all([
        supabase.from("inv_stock_counts").select("*").order("started_at", { ascending: false }),
        supabase.from("inv_products").select("*").eq("is_active", true).order("name"),
        supabase.from("inv_categories").select("*").order("display_order"),
      ]);
      setCounts(countsData || []);
      setProducts(prodData || []);
      setCategories(catData || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  // Шинэ тооллого нээх (категориор шүүх боломжтой)
  const handleStartNew = async ({ notes, categoryId }) => {
    try {
      // Категориор шүүж бараа авах
      const filteredProducts = categoryId
        ? products.filter((p) => p.category_id === categoryId)
        : products;

      if (filteredProducts.length === 0) {
        alert("Сонгосон категорид бараа байхгүй байна");
        return;
      }

      const cat = categoryId ? categories.find((c) => c.id === categoryId) : null;
      const prefix = cat ? cat.name.toUpperCase().slice(0, 3).replace(/[^A-ZА-ЯЁӨҮ]/gi, "") || "TC" : "TC";

      const countNumber = `${prefix}-${new Date().toISOString().slice(0, 10)}-${Math.floor(Math.random() * 1000)}`;
      const { data: newCount, error } = await supabase
        .from("inv_stock_counts")
        .insert({
          count_number: countNumber,
          status: "in_progress",
          notes: cat ? `[${cat.name}] ${notes || ""}`.trim() : notes,
          total_products: filteredProducts.length,
          created_by: profile.id,
        })
        .select()
        .single();
      if (error) throw error;

      // Шүүгдсэн барааг snapshot хийх
      const items = filteredProducts.map((p) => ({
        count_id: newCount.id,
        product_id: p.id,
        system_qty: p.stock,
      }));
      const { error: itemErr } = await supabase.from("inv_stock_count_items").insert(items);
      if (itemErr) throw itemErr;

      setShowNewModal(false);
      await loadAll();
      setActiveCount(newCount.id);
    } catch (e) { alert("Алдаа: " + e.message); }
  };

  if (activeCount) {
    return (
      <StockCountDetail
        countId={activeCount}
        products={products}
        profile={profile}
        onClose={() => { setActiveCount(null); loadAll(); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNewModal(true)}
          className="glow-primary press-btn px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5">
          <Plus size={12} /> Шинэ тооллого
        </button>
      </div>

      {loading ? (
        <div className="glass rounded-2xl p-8 text-center" style={{ color: T.muted, fontFamily: FS }}>
          <Loader2 className="spin mx-auto mb-2" size={20} />
        </div>
      ) : counts.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <div className="text-4xl mb-2">📋</div>
          <div style={{ color: T.muted, fontFamily: FS }} className="text-sm mb-3">
            Тооллого хийгдээгүй байна
          </div>
          <button onClick={() => setShowNewModal(true)}
            className="glow-primary press-btn px-4 py-2 rounded-full text-xs font-semibold">
            + Анхны тооллого хийх
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {counts.map((c) => {
            const isComplete = c.status === "completed";
            const isCancel = c.status === "cancelled";
            return (
              <button key={c.id} onClick={() => setActiveCount(c.id)}
                className="glass lift rounded-xl p-3 w-full text-left">
                <div className="flex items-center gap-3">
                  <div style={{
                    background: isComplete ? "rgba(16,185,129,0.1)" : isCancel ? T.errSoft : T.warnSoft,
                    color: isComplete ? T.ok : isCancel ? T.err : T.warn,
                  }} className="w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0">
                    {isComplete ? "✓" : isCancel ? "✕" : "📋"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm">
                        {c.count_number}
                      </span>
                      <span style={{
                        background: isComplete ? "rgba(16,185,129,0.1)" : isCancel ? T.errSoft : T.warnSoft,
                        color: isComplete ? T.ok : isCancel ? T.err : T.warn,
                      }} className="text-[9px] px-1.5 py-0.5 rounded-full font-medium">
                        {isComplete ? "Дууссан" : isCancel ? "Цуцалсан" : "Хийгдэж буй"}
                      </span>
                    </div>
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-0.5">
                      {new Date(c.started_at).toLocaleString("mn-MN")} · {c.total_products || 0} бараа
                    </div>
                    {c.notes && (
                      <div style={{ color: T.inkSoft, fontFamily: FS }} className="text-[11px] mt-1 italic truncate">
                        "{c.notes}"
                      </div>
                    )}
                  </div>
                  {Number(c.total_diff_amount) !== 0 && (
                    <div style={{
                      color: c.total_diff_amount > 0 ? T.ok : T.err,
                      fontFamily: FD, fontWeight: 600,
                    }} className="text-sm">
                      {c.total_diff_amount > 0 ? "+" : ""}{Number(c.total_diff_amount).toLocaleString()}₮
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showNewModal && (
        <NewStockCountModal
          products={products}
          categories={categories}
          onSave={handleStartNew}
          onClose={() => setShowNewModal(false)}
        />
      )}
    </div>
  );
}

function NewStockCountModal({ products, categories, onSave, onClose }) {
  const [notes, setNotes] = useState("");
  const [categoryId, setCategoryId] = useState(""); // "" = бүх
  const [busy, setBusy] = useState(false);

  // Сонгосон категорийн бараа тоо
  const filteredCount = categoryId
    ? products.filter((p) => p.category_id === categoryId).length
    : products.length;

  // Категори бүрд бараа тоо
  const catCounts = useMemo(() => {
    const map = {};
    products.forEach((p) => {
      if (p.category_id) {
        map[p.category_id] = (map[p.category_id] || 0) + 1;
      }
    });
    return map;
  }, [products]);

  const noCatCount = products.filter((p) => !p.category_id).length;

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-content rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-lg">
            📋 Шинэ тооллого
          </h3>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        <div className="space-y-3">
          {/* Категори сонгох */}
          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-2 block">
              Аль барааг тоолох вэ?
            </label>
            <div className="space-y-1.5">
              {/* Бүх бараа */}
              <button onClick={() => setCategoryId("")}
                className="press-btn w-full p-3 rounded-xl flex items-center justify-between transition-all"
                style={{
                  background: categoryId === "" ? T.highlightSoft : T.surfaceAlt,
                  border: `2px solid ${categoryId === "" ? T.highlight : "transparent"}`,
                  fontFamily: FS,
                }}>
                <div className="flex items-center gap-2">
                  <span className="text-base">📦</span>
                  <span style={{ fontWeight: 600, color: T.ink }} className="text-sm">
                    Бүх бараа
                  </span>
                </div>
                <span style={{
                  background: categoryId === "" ? T.highlight : T.surface,
                  color: categoryId === "" ? "white" : T.ink,
                }} className="text-[10px] px-2 py-0.5 rounded-full font-semibold">
                  {products.length}
                </span>
              </button>

              {/* Категорууд */}
              {categories.map((cat) => {
                const count = catCounts[cat.id] || 0;
                const isSelected = categoryId === cat.id;
                if (count === 0) return null;
                return (
                  <button key={cat.id} onClick={() => setCategoryId(cat.id)}
                    className="press-btn w-full p-3 rounded-xl flex items-center justify-between transition-all"
                    style={{
                      background: isSelected ? T.highlightSoft : T.surfaceAlt,
                      border: `2px solid ${isSelected ? T.highlight : "transparent"}`,
                      fontFamily: FS,
                    }}>
                    <div className="flex items-center gap-2">
                      <span style={{ background: cat.color || T.highlight }}
                        className="w-3 h-3 rounded-full" />
                      <span style={{ fontWeight: 600, color: T.ink }} className="text-sm">
                        {cat.name}
                      </span>
                    </div>
                    <span style={{
                      background: isSelected ? T.highlight : T.surface,
                      color: isSelected ? "white" : T.ink,
                    } } className="text-[10px] px-2 py-0.5 rounded-full font-semibold">
                      {count}
                    </span>
                  </button>
                );
              })}

              {/* Категоригүй бараа */}
              {noCatCount > 0 && (
                <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] mt-1 italic">
                  💡 {noCatCount} бараа категорьгүй
                </div>
              )}
            </div>
          </div>

          {/* Summary */}
          <div className="glass-soft rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-wider">
                  Тооллогод орох
                </div>
                <div style={{ fontFamily: FD, fontWeight: 600, color: T.ink }} className="text-2xl">
                  {filteredCount} бараа
                </div>
              </div>
              <div style={{ fontSize: 32 }}>📋</div>
            </div>
          </div>

          {/* Тэмдэглэл */}
          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Тэмдэглэл (заавал биш)
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="ж.нь: Сарын эцсийн тооллого, агуулах А..."
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm resize-none" />
          </div>

          <button
            disabled={busy || filteredCount === 0}
            onClick={async () => {
              setBusy(true);
              await onSave({
                notes: notes.trim() || null,
                categoryId: categoryId || null,
              });
              setBusy(false);
            }}
            className="glow-primary press-btn w-full py-3 rounded-xl text-sm font-semibold">
            {busy ? "Үүсгэж байна..." : `Тооллого эхлүүлэх (${filteredCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function StockCountDetail({ countId, products, profile, onClose }) {
  const [count, setCount] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | counted | uncounted | diff
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: cData }, { data: iData }] = await Promise.all([
        supabase.from("inv_stock_counts").select("*").eq("id", countId).single(),
        supabase.from("inv_stock_count_items").select("*").eq("count_id", countId),
      ]);
      setCount(cData);
      setItems(iData || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [countId]);

  const productById = (id) => products.find((p) => p.id === id);

  // Update item actual qty
  const updateActual = async (itemId, actualQty) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const product = productById(item.product_id);
    const diffQty = actualQty - Number(item.system_qty);
    const diffAmount = diffQty * Number(product?.cost_price || 0);

    await supabase.from("inv_stock_count_items").update({
      actual_qty: actualQty,
      diff_qty: diffQty,
      diff_amount: diffAmount,
      counted_at: new Date().toISOString(),
      counted_by: profile.id,
    }).eq("id", itemId);

    setItems(items.map((i) => i.id === itemId ? {
      ...i, actual_qty: actualQty, diff_qty: diffQty, diff_amount: diffAmount,
    } : i));
  };

  // Тооллого дуусгах + бараа auto adjust
  const handleComplete = async () => {
    if (!confirm(`Тооллогыг дуусгах уу?\n\nБараа бүрийн нөөц бодит тоонд тохирч засагдана.\nЭнэ үйлдэл буцах боломжгүй!`)) return;

    setBusy(true);
    try {
      // Зөрүү байгаа item бүрд adjustment movement үүсгэх
      const totalDiff = items.reduce((sum, i) => sum + (Number(i.diff_amount) || 0), 0);
      const countedItems = items.filter((i) => i.actual_qty !== null && i.actual_qty !== undefined);

      for (const item of countedItems) {
        if (Number(item.diff_qty) !== 0) {
          await supabase.from("inv_movements").insert({
            product_id: item.product_id,
            movement_type: "adjust",
            quantity: Number(item.actual_qty), // adjust set нөөц to actual
            unit_price: 0,
            total_amount: Number(item.diff_amount) || 0,
            reason: "manual",
            notes: `Тооллого ${count.count_number}`,
            reference_number: count.count_number,
            created_by: profile.id,
          });
        }
      }

      // Тооллого дуусгах
      await supabase.from("inv_stock_counts").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        total_diff_amount: totalDiff,
      }).eq("id", countId);

      alert(`✅ Тооллого амжилттай дууслаа.\n\nБараа бүрийн нөөц шинэчлэгдсэн.`);
      onClose();
    } catch (e) {
      alert("Алдаа: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  // Тооллого цуцлах
  const handleCancel = async () => {
    if (!confirm("Тооллогыг цуцлах уу?\n\nБараа нөөц өөрчлөгдөхгүй.")) return;
    await supabase.from("inv_stock_counts").update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
    }).eq("id", countId);
    onClose();
  };

  // PDF тайлан
  const handlePdf = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      await import("jspdf-autotable");

      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      pdf.setFont("helvetica");

      // Header
      pdf.setFontSize(20);
      pdf.setTextColor(236, 72, 153);
      pdf.text("ORGOO", 20, 20);
      pdf.setFontSize(11);
      pdf.setTextColor(60, 60, 60);
      pdf.text("Toollogiin tailan", 20, 27);

      // Info
      pdf.setFontSize(9);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`Dugaar: ${count.count_number}`, 20, 38);
      pdf.text(`Ehlesen: ${new Date(count.started_at).toLocaleString("mn-MN")}`, 20, 43);
      if (count.completed_at) {
        pdf.text(`Duussan: ${new Date(count.completed_at).toLocaleString("mn-MN")}`, 20, 48);
      }
      pdf.text(`Toluv: ${count.status === "completed" ? "Duussan" : count.status === "cancelled" ? "Tsutsalsan" : "Hijgdej bui"}`, 20, 53);

      // Stats
      const counted = items.filter((i) => i.actual_qty !== null).length;
      const withDiff = items.filter((i) => Number(i.diff_qty) !== 0 && i.actual_qty !== null).length;
      const totalDiff = items.reduce((s, i) => s + (Number(i.diff_amount) || 0), 0);

      pdf.setFillColor(253, 243, 245);
      pdf.rect(20, 60, 170, 16, "F");
      pdf.setFontSize(8);
      pdf.setTextColor(120, 120, 120);
      pdf.text("Niit baraa", 25, 66);
      pdf.text("Toollson", 65, 66);
      pdf.text("Zoruutei", 105, 66);
      pdf.text("Niit zoruunii dun", 145, 66);

      pdf.setFontSize(11);
      pdf.setTextColor(30, 30, 30);
      pdf.text(`${items.length}`, 25, 73);
      pdf.text(`${counted}`, 65, 73);
      pdf.text(`${withDiff}`, 105, 73);
      pdf.setTextColor(totalDiff < 0 ? 220 : totalDiff > 0 ? 16 : 30, totalDiff < 0 ? 38 : totalDiff > 0 ? 185 : 30, totalDiff < 0 ? 38 : totalDiff > 0 ? 129 : 30);
      pdf.text(`${totalDiff.toLocaleString()}₮`, 145, 73);

      // Table — only items with diff
      const tableData = items
        .filter((i) => i.actual_qty !== null)
        .map((i) => {
          const p = productById(i.product_id);
          return [
            p?.name || "—",
            p?.sku || "—",
            String(i.system_qty || 0),
            String(i.actual_qty || 0),
            String(i.diff_qty || 0),
            (Number(i.diff_amount) || 0).toLocaleString(),
          ];
        });

      pdf.autoTable({
        startY: 85,
        head: [["Baraa", "SKU", "Sistemd", "Bodit", "Zoruu", "Dun (₮)"]],
        body: tableData,
        theme: "plain",
        headStyles: { fillColor: [236, 72, 153], textColor: [255, 255, 255], fontSize: 9 },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [253, 243, 245] },
        margin: { left: 20, right: 20 },
        columnStyles: {
          2: { halign: "right" },
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
        },
      });

      // Footer
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text(`Uusgesen: ${new Date().toLocaleString("mn-MN")}`, 20, 285);
      pdf.text("ORGOO", 180, 285);

      pdf.save(`ORGOO-${count.count_number}.pdf`);
    } catch (e) {
      alert("PDF алдаа: " + e.message);
    }
  };

  if (loading || !count) {
    return (
      <div className="glass rounded-2xl p-8 text-center" style={{ color: T.muted, fontFamily: FS }}>
        <Loader2 className="spin mx-auto mb-2" size={20} />
      </div>
    );
  }

  // Filter items
  let filtered = items;
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter((i) => {
      const p = productById(i.product_id);
      return p?.name?.toLowerCase().includes(q) || p?.sku?.toLowerCase().includes(q);
    });
  }
  if (filter === "counted") filtered = filtered.filter((i) => i.actual_qty !== null);
  else if (filter === "uncounted") filtered = filtered.filter((i) => i.actual_qty === null);
  else if (filter === "diff") filtered = filtered.filter((i) => Number(i.diff_qty) !== 0 && i.actual_qty !== null);

  const counted = items.filter((i) => i.actual_qty !== null).length;
  const withDiff = items.filter((i) => Number(i.diff_qty) !== 0 && i.actual_qty !== null).length;
  const totalDiff = items.reduce((s, i) => s + (Number(i.diff_amount) || 0), 0);
  const isReadOnly = count.status !== "in_progress";

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="glass rounded-2xl p-3 flex items-center gap-2">
        <button onClick={onClose} className="press-btn p-1.5 rounded-lg hover:bg-black/5"
          style={{ color: T.ink }}>
          ←
        </button>
        <div className="flex-1 min-w-0">
          <div style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm">
            {count.count_number}
          </div>
          <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
            {new Date(count.started_at).toLocaleString("mn-MN")}
          </div>
        </div>
        <button onClick={handlePdf}
          className="press-btn px-3 py-1.5 rounded-full text-xs flex items-center gap-1"
          style={{ background: T.surfaceAlt, color: T.ink, fontFamily: FS, fontWeight: 500 }}>
          <Download size={11} /> PDF
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="glass rounded-xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Нийт</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.ink }} className="text-2xl">{items.length}</div>
        </div>
        <div className="glass rounded-xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Тоолсон</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.ok }} className="text-2xl">{counted}</div>
        </div>
        <div className="glass rounded-xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Зөрүүтэй</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: withDiff > 0 ? T.warn : T.ink }} className="text-2xl">{withDiff}</div>
        </div>
        <div className="glass rounded-xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Зөрүүний дүн</div>
          <div style={{
            fontFamily: FD, fontWeight: 600,
            color: totalDiff < 0 ? T.err : totalDiff > 0 ? T.ok : T.ink,
          }} className="text-base">
            {totalDiff > 0 ? "+" : ""}{Math.abs(totalDiff) > 1000 ? (totalDiff / 1000).toFixed(0) + "к" : totalDiff.toLocaleString()}₮
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="glass rounded-2xl p-3 flex flex-wrap gap-2 items-center">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Хайх..."
          style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS, padding: "6px 10px", borderRadius: 8 }}
          className="text-xs flex-1 min-w-[120px]" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS, padding: "6px 10px", borderRadius: 8 }}
          className="text-xs">
          <option value="all">Бүх ({items.length})</option>
          <option value="uncounted">Тоолоогүй ({items.length - counted})</option>
          <option value="counted">Тоолсон ({counted})</option>
          <option value="diff">Зөрүүтэй ({withDiff})</option>
        </select>
      </div>

      {/* Items */}
      <div className="space-y-2">
        {filtered.map((item) => {
          const p = productById(item.product_id);
          if (!p) return null;
          const hasDiff = item.actual_qty !== null && Number(item.diff_qty) !== 0;
          const isCounted = item.actual_qty !== null;

          return (
            <div key={item.id} className="glass rounded-xl p-3">
              <div className="flex items-center gap-3 mb-2">
                {p.image_url && (
                  <img src={p.image_url} alt={p.name}
                    style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
                )}
                <div className="flex-1 min-w-0">
                  <div style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm truncate">
                    {p.name}
                  </div>
                  {p.sku && (
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
                      SKU: {p.sku}
                    </div>
                  )}
                </div>
                {isCounted && (
                  <div style={{
                    background: hasDiff ? (item.diff_qty > 0 ? "rgba(16,185,129,0.1)" : T.errSoft) : "rgba(16,185,129,0.1)",
                    color: hasDiff ? (item.diff_qty > 0 ? T.ok : T.err) : T.ok,
                  }} className="text-[10px] px-2 py-0.5 rounded-full font-medium">
                    {hasDiff ? `${item.diff_qty > 0 ? "+" : ""}${item.diff_qty}` : "✓"}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider mb-0.5">Системд</div>
                  <div style={{ fontFamily: FD, fontWeight: 500, color: T.ink }} className="text-sm">
                    {Number(item.system_qty).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider mb-0.5">Бодит</div>
                  {isReadOnly ? (
                    <div style={{ fontFamily: FD, fontWeight: 500, color: T.ink }} className="text-sm">
                      {item.actual_qty !== null ? Number(item.actual_qty).toLocaleString() : "—"}
                    </div>
                  ) : (
                    <input
                      type="number"
                      value={item.actual_qty ?? ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        if (v === null) {
                          // Clear
                          supabase.from("inv_stock_count_items").update({
                            actual_qty: null, diff_qty: null, diff_amount: null, counted_at: null,
                          }).eq("id", item.id);
                          setItems(items.map((i) => i.id === item.id ? { ...i, actual_qty: null, diff_qty: null, diff_amount: null } : i));
                        } else {
                          updateActual(item.id, v);
                        }
                      }}
                      placeholder="Бодит"
                      style={{ background: T.surfaceAlt, border: `1px solid ${isCounted ? T.border : T.warn}`, color: T.ink, fontFamily: FS }}
                      className="w-full px-2 py-1 rounded text-sm tabular-nums" />
                  )}
                </div>
                <div>
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider mb-0.5">Дүн</div>
                  <div style={{
                    fontFamily: FD, fontWeight: 500,
                    color: hasDiff ? (item.diff_qty > 0 ? T.ok : T.err) : T.muted,
                  }} className="text-sm">
                    {isCounted && hasDiff
                      ? `${item.diff_amount > 0 ? "+" : ""}${Math.abs(item.diff_amount) > 1000 ? (item.diff_amount/1000).toFixed(0)+"к" : Number(item.diff_amount).toLocaleString()}`
                      : "—"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      {!isReadOnly && (
        <div className="glass rounded-2xl p-3 flex gap-2 sticky bottom-3">
          <button onClick={handleCancel} disabled={busy}
            className="press-btn flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: T.surfaceAlt, color: T.err, fontFamily: FS }}>
            Цуцлах
          </button>
          <button onClick={handleComplete} disabled={busy || counted === 0}
            className="glow-primary press-btn flex-1 py-2.5 rounded-xl text-sm font-semibold">
            {busy ? "Хадгалаж..." : `✓ Дуусгах (${counted}/${items.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

function ProductFormModal({ product, categories, profile, onSave, onAddCategory, onClose }) {
  const [name, setName] = useState(product?.name || "");
  const [sku, setSku] = useState(product?.sku || "");
  const [categoryId, setCategoryId] = useState(product?.category_id || "");
  const [unit, setUnit] = useState(product?.unit || "ширхэг");
  const [costPrice, setCostPrice] = useState(product?.cost_price ? String(product.cost_price) : "");
  const [salePrice, setSalePrice] = useState(product?.sale_price ? String(product.sale_price) : "");
  const [stock, setStock] = useState(product?.stock ? String(product.stock) : "0");
  const [minStock, setMinStock] = useState(product?.min_stock ? String(product.min_stock) : "0");
  const [description, setDescription] = useState(product?.description || "");
  const [imageUrl, setImageUrl] = useState(product?.image_url || "");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(product?.image_url || "");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const fileInputRef = useRef(null);

  // File сонгох
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Хэмжээ шалгах (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      alert("Зураг 5MB-аас бага байх ёстой");
      return;
    }

    // Image мөн эсэх
    if (!file.type.startsWith("image/")) {
      alert("Зөвхөн зураг сонгох боломжтой");
      return;
    }

    setImageFile(file);
    // Preview
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  // Зураг устгах
  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview("");
    setImageUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Зураг upload хийх
  const uploadImage = async () => {
    if (!imageFile) return imageUrl;
    setUploading(true);
    try {
      const ext = imageFile.name.split(".").pop().toLowerCase();
      const fileName = `${profile.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("inv-products")
        .upload(fileName, imageFile, {
          contentType: imageFile.type,
          upsert: false,
        });
      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from("inv-products")
        .getPublicUrl(fileName);
      return urlData.publicUrl;
    } finally {
      setUploading(false);
    }
  };

  const inputStyle = { background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS };
  const inputClass = "w-full px-3 py-2 rounded-lg text-sm";

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-content rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-lg">
            📦 {product ? "Бараа засах" : "Шинэ бараа"}
          </h3>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        <div className="space-y-3">
          {/* Зураг upload */}
          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Барааны зураг
            </label>
            <div className="flex gap-3 items-start">
              {/* Preview */}
              <div
                onClick={() => !imagePreview && fileInputRef.current?.click()}
                style={{
                  width: 100, height: 100, borderRadius: 12,
                  border: `2px dashed ${imagePreview ? "transparent" : T.border}`,
                  background: imagePreview ? "transparent" : T.surfaceAlt,
                  cursor: imagePreview ? "default" : "pointer",
                  overflow: "hidden",
                  position: "relative",
                  flexShrink: 0,
                }}
                className="flex items-center justify-center">
                {imagePreview ? (
                  <>
                    <img src={imagePreview} alt="preview"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button onClick={handleRemoveImage}
                      style={{
                        position: "absolute", top: 4, right: 4,
                        background: "rgba(239,68,68,0.9)", color: "white",
                        width: 24, height: 24, borderRadius: 12,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <div className="text-center" style={{ color: T.muted, fontFamily: FM }}>
                    <Camera size={24} className="mx-auto mb-1" />
                    <div className="text-[9px]">Сонгох</div>
                  </div>
                )}
              </div>

              {/* Upload buttons */}
              <div className="flex-1 space-y-2">
                <button type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="press-btn w-full py-2 rounded-lg text-xs flex items-center justify-center gap-1.5"
                  style={{ background: T.surfaceAlt, color: T.ink, border: `1px solid ${T.border}`, fontFamily: FS, fontWeight: 500 }}>
                  📁 Файлаас сонгох
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />
                <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px]">
                  💡 JPG, PNG, WEBP (max 5MB)
                </div>
              </div>
            </div>
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Барааны нэр *
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="ж.нь: Кофе шар, 1кг"
              style={inputStyle} className={inputClass} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
                SKU/Дотоодын код
              </label>
              <input value={sku} onChange={(e) => setSku(e.target.value)}
                placeholder="COFFEE-001"
                style={inputStyle} className={inputClass} />
            </div>
            <div>
              <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
                Хэмжих нэгж
              </label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)}
                placeholder="ширхэг, кг, литр"
                style={inputStyle} className={inputClass} />
            </div>
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Категори
            </label>
            <div className="flex gap-2">
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                style={inputStyle} className={inputClass}>
                <option value="">— Сонгох —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                placeholder="+ Шинэ"
                style={inputStyle} className="px-3 py-2 rounded-lg text-sm w-24" />
              <button type="button" onClick={async () => {
                if (!newCatName.trim()) return;
                const newCat = await onAddCategory(newCatName.trim());
                if (newCat) {
                  setCategoryId(newCat.id);
                  setNewCatName("");
                }
              }}
                className="press-btn px-3 py-2 rounded-lg text-xs"
                style={{ background: T.highlightSoft, color: T.highlight, fontFamily: FS, fontWeight: 600 }}>
                +
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
                Авсан үнэ (₮)
              </label>
              <input type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value)}
                placeholder="0"
                style={inputStyle} className={inputClass} />
            </div>
            <div>
              <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
                Зарах үнэ (₮)
              </label>
              <input type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)}
                placeholder="0"
                style={inputStyle} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
                {product ? "Одоогийн нөөц" : "Эхлэх нөөц"}
              </label>
              <input type="number" value={stock} onChange={(e) => setStock(e.target.value)}
                placeholder="0"
                style={inputStyle} className={inputClass} disabled={!!product} />
              {product && (
                <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] mt-1">
                  💡 Нөөц өөрчлөхийн тулд "📥 Орлого" эсвэл "📤 Зарлага" товчийг ашигла
                </div>
              )}
            </div>
            <div>
              <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
                Хамгийн бага нөөц (alert)
              </label>
              <input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)}
                placeholder="0"
                style={inputStyle} className={inputClass} />
            </div>
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Тэмдэглэл
            </label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2}
              style={inputStyle} className={`${inputClass} resize-none`} />
          </div>

          <button
            disabled={busy || uploading || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const finalImageUrl = await uploadImage();
                await onSave({
                  name: name.trim(),
                  sku: sku.trim() || null,
                  category_id: categoryId || null,
                  unit,
                  cost_price: Number(costPrice) || 0,
                  sale_price: Number(salePrice) || 0,
                  stock: product ? Number(product.stock) : (Number(stock) || 0),
                  min_stock: Number(minStock) || 0,
                  description: description.trim() || null,
                  image_url: finalImageUrl || null,
                });
              } catch (e) {
                alert("Зураг хадгалахад алдаа: " + e.message);
              } finally {
                setBusy(false);
              }
            }}
            className="glow-primary press-btn w-full py-3 rounded-xl text-sm font-semibold">
            {uploading ? "🖼 Зураг илгээж буй..." : busy ? "Хадгалаж..." : "Хадгалах"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MovementFormModal({ product, type, profile, onSave, onClose }) {
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState(
    type === "in" ? String(product.cost_price || 0) : String(product.sale_price || 0)
  );
  const [reason, setReason] = useState(type === "in" ? "purchase" : "sale");
  const [notes, setNotes] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [busy, setBusy] = useState(false);

  const inputStyle = { background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS };
  const inputClass = "w-full px-3 py-2 rounded-lg text-sm";

  const total = (Number(quantity) || 0) * (Number(unitPrice) || 0);

  const reasonOptions = type === "in" ? [
    { value: "purchase", label: "Худалдан авалт" },
    { value: "return", label: "Эргэн ирсэн" },
    { value: "manual", label: "Гар тохируулга" },
  ] : [
    { value: "sale", label: "Борлуулалт" },
    { value: "damage", label: "Гэмтэлтэй" },
    { value: "manual", label: "Гар тохируулга" },
  ];

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-content rounded-2xl w-full max-w-md p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-lg">
              {type === "in" ? "📥 Орлого" : "📤 Зарлага"}
            </h3>
            <p style={{ color: T.muted, fontFamily: FS }} className="text-xs">
              {product.name}
            </p>
          </div>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        <div className="glass-soft rounded-lg p-2.5 mb-3 flex items-center gap-2">
          <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
            Одоогийн нөөц:
          </div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.ink }} className="text-sm">
            {Number(product.stock).toLocaleString()} {product.unit}
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
                Тоо ширхэг *
              </label>
              <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                style={inputStyle} className={inputClass} autoFocus />
            </div>
            <div>
              <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
                Нэгж үнэ (₮)
              </label>
              <input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0"
                style={inputStyle} className={inputClass} />
            </div>
          </div>

          {total > 0 && (
            <div className="glass-soft rounded-lg p-2.5 flex items-center justify-between">
              <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider">
                Нийт дүн
              </span>
              <span style={{ fontFamily: FD, fontWeight: 600, color: T.highlight }} className="text-base">
                {total.toLocaleString()}₮
              </span>
            </div>
          )}

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Шалтгаан
            </label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}
              style={inputStyle} className={inputClass}>
              {reasonOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Лавлагаа дугаар
            </label>
            <input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="ж.нь: INV-2026-001"
              style={inputStyle} className={inputClass} />
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Тэмдэглэл
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={inputStyle} className={`${inputClass} resize-none`} />
          </div>

          {type === "out" && Number(quantity) > Number(product.stock) && (
            <div style={{ background: T.errSoft, color: T.err, fontFamily: FS }}
              className="text-xs px-3 py-2 rounded-lg">
              ⚠ Нөөцөөс илүү! Үлдэгдэл: {product.stock} {product.unit}
            </div>
          )}

          <button
            disabled={busy || !quantity || Number(quantity) <= 0}
            onClick={async () => {
              setBusy(true);
              await onSave({
                quantity: Number(quantity),
                unit_price: Number(unitPrice) || 0,
                total_amount: total,
                reason,
                notes: notes.trim() || null,
                reference_number: referenceNumber.trim() || null,
              });
              setBusy(false);
            }}
            className="glow-primary press-btn w-full py-3 rounded-xl text-sm font-semibold">
            {busy ? "Хадгалаж..." : type === "in" ? "📥 Орлого хийх" : "📤 Зарлага хийх"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  BULK RECEIVING MODAL — Олон бараа нэг дор орлогодох
// ═══════════════════════════════════════════════════════════════════════════
function BulkReceivingModal({ products, profile, onSave, onClose }) {
  const [supplier, setSupplier] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([
    { id: 1, productId: "", quantity: "", unitPrice: "" }
  ]);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState({});

  const addRow = () => {
    setItems([...items, { id: Date.now(), productId: "", quantity: "", unitPrice: "" }]);
  };

  const removeRow = (id) => {
    if (items.length === 1) return;
    setItems(items.filter((it) => it.id !== id));
  };

  const updateRow = (id, field, value) => {
    setItems(items.map((it) => it.id === id ? { ...it, [field]: value } : it));
  };

  // Бараа сонгоход auto-fill авсан үнэ
  const selectProduct = (rowId, productId) => {
    const p = products.find((p) => p.id === productId);
    setItems(items.map((it) => it.id === rowId ? {
      ...it,
      productId,
      unitPrice: p?.cost_price ? String(p.cost_price) : it.unitPrice,
    } : it));
  };

  // Total
  const total = items.reduce((sum, it) => {
    const q = Number(it.quantity) || 0;
    const u = Number(it.unitPrice) || 0;
    return sum + (q * u);
  }, 0);

  const validItems = items.filter((it) => it.productId && Number(it.quantity) > 0);

  const inputStyle = { background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS };
  const inputClass = "px-2 py-1.5 rounded text-xs";

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-2">
      <div className="modal-content rounded-2xl w-full max-w-3xl p-5 max-h-[95vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-lg">
            📥 Бөөн орлого
          </h3>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        {/* Header info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Нийлүүлэгч
            </label>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
              placeholder="ж.нь: ABC ХХК"
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>
          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Утас
            </label>
            <input value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)}
              placeholder="99887766"
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>
          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Нэхэмжлэхийн дугаар
            </label>
            <input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="INV-001"
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>
          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Тэмдэглэл
            </label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="..."
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>
        </div>

        {/* Items */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider">
              Бараа ({items.length})
            </label>
            <button onClick={addRow}
              className="press-btn px-2 py-1 rounded-lg text-[10px] flex items-center gap-1"
              style={{ background: T.highlightSoft, color: T.highlight, fontFamily: FS, fontWeight: 600 }}>
              <Plus size={11} /> Мөр нэмэх
            </button>
          </div>

          {/* Header row */}
          <div className="grid grid-cols-[1fr_70px_85px_85px_30px] gap-1.5 mb-1.5 px-1">
            <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider">Бараа</div>
            <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider text-right">Тоо</div>
            <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider text-right">Нэгж үнэ</div>
            <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider text-right">Дүн</div>
            <div></div>
          </div>

          {/* Rows */}
          <div className="space-y-1.5">
            {items.map((it, idx) => {
              const lineTotal = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
              const product = products.find((p) => p.id === it.productId);
              return (
                <div key={it.id} className="grid grid-cols-[1fr_70px_85px_85px_30px] gap-1.5 items-center">
                  <select value={it.productId} onChange={(e) => selectProduct(it.id, e.target.value)}
                    style={inputStyle} className={inputClass}>
                    <option value="">— Сонгох —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.stock} {p.unit})
                      </option>
                    ))}
                  </select>
                  <input type="number" value={it.quantity}
                    onChange={(e) => updateRow(it.id, "quantity", e.target.value)}
                    placeholder="0"
                    style={inputStyle} className={`${inputClass} text-right tabular-nums`} />
                  <input type="number" value={it.unitPrice}
                    onChange={(e) => updateRow(it.id, "unitPrice", e.target.value)}
                    placeholder="0"
                    style={inputStyle} className={`${inputClass} text-right tabular-nums`} />
                  <div style={{ fontFamily: FM, color: T.ink, fontWeight: 600 }}
                    className="text-xs text-right tabular-nums px-1">
                    {lineTotal > 0 ? lineTotal.toLocaleString() : "—"}
                  </div>
                  <button onClick={() => removeRow(it.id)}
                    disabled={items.length === 1}
                    style={{ color: items.length === 1 ? T.mutedSoft : T.err }}
                    className="press-btn p-1 rounded">
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Total */}
        {total > 0 && (
          <div className="glass-soft rounded-lg p-3 mb-3 flex items-center justify-between">
            <span style={{ color: T.muted, fontFamily: FM }} className="text-xs uppercase tracking-wider">
              Нийт дүн ({validItems.length} бараа)
            </span>
            <span style={{ fontFamily: FD, fontWeight: 700, color: T.highlight }} className="text-xl">
              {total.toLocaleString()}₮
            </span>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy}
            className="press-btn flex-1 py-3 rounded-xl text-sm font-semibold"
            style={{ background: T.surfaceAlt, color: T.ink, fontFamily: FS }}>
            Цуцлах
          </button>
          <button
            disabled={busy || validItems.length === 0}
            onClick={async () => {
              setBusy(true);
              await onSave({
                header: {
                  receiving_number: `HA-${new Date().toISOString().slice(0, 10)}-${Math.floor(Math.random()*1000)}`,
                  supplier_name: supplier.trim() || null,
                  supplier_phone: supplierPhone.trim() || null,
                  reference_number: referenceNumber.trim() || null,
                  notes: notes.trim() || null,
                  total_items: validItems.length,
                  total_amount: total,
                },
                items: validItems.map((it) => ({
                  product_id: it.productId,
                  quantity: Number(it.quantity),
                  unit_price: Number(it.unitPrice) || 0,
                  total_amount: (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
                })),
              });
              setBusy(false);
            }}
            className="glow-primary press-btn flex-[2] py-3 rounded-xl text-sm font-semibold">
            {busy ? "Хадгалаж..." : `📥 ${validItems.length} бараа орлого хийх`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  CALL CENTER VIEW — Дуудлагын самбар (энгийн)
// ═══════════════════════════════════════════════════════════════════════════
function CallCenterView({ profile }) {
  const [showCallModal, setShowCallModal] = useState(false);
  const [orderForCall, setOrderForCall] = useState(null); // { phone, name }
  const [products, setProducts] = useState([]);
  const [recentCalls, setRecentCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ today: 0, week: 0, total: 0 });
  const [copiedPhone, setCopiedPhone] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: callData }, { data: prodData }] = await Promise.all([
        supabase.from("biz_calls").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("inv_products").select("*").eq("is_active", true).order("name"),
      ]);
      setRecentCalls(callData || []);
      setProducts(prodData || []);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

      setStats({
        today: (callData || []).filter((c) => new Date(c.created_at) >= today).length,
        week: (callData || []).filter((c) => new Date(c.created_at) >= weekAgo).length,
        total: (callData || []).length,
      });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  // Дугаарыг хуулах + захиалга нээх
  const handlePhoneClick = async (phone, customerName, callNotes, callProducts) => {
    try {
      // Clipboard-руу хуулах
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(phone);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = phone;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedPhone(phone);
      setTimeout(() => setCopiedPhone(""), 1500);

      // Захиалгын modal нээх (сэтгэгдэл + сонирхсон бараа дамжуулах)
      setOrderForCall({
        phone,
        name: customerName,
        notes: callNotes,
        products: callProducts,
      });
    } catch (e) {
      console.error("Copy error:", e);
      setOrderForCall({ phone, name: customerName, notes: callNotes, products: callProducts });
    }
  };

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Өнөөдөр</div>
          <div style={{ fontFamily: FD, fontWeight: 700, color: T.highlight }} className="text-3xl">
            {stats.today}
          </div>
        </div>
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Энэ долоо хоногт</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.ink }} className="text-3xl">
            {stats.week}
          </div>
        </div>
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Нийт</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.ink }} className="text-3xl">
            {stats.total}
          </div>
        </div>
      </div>

      {/* Big call button */}
      <button onClick={() => setShowCallModal(true)}
        style={{
          background: "linear-gradient(135deg, #ec4899, #f97316)",
          color: "white",
          fontFamily: FS,
          boxShadow: "0 8px 24px rgba(236,72,153,0.3)",
        }}
        className="press-btn w-full py-6 rounded-2xl font-bold text-lg flex items-center justify-center gap-3">
        📞 Шинэ дуудлага бүртгэх
      </button>

      {/* Recent calls */}
      <div>
        <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-2 px-1">
          Сүүлийн дуудлагууд
        </div>
        {loading ? (
          <div className="glass rounded-2xl p-8 text-center" style={{ color: T.muted, fontFamily: FS }}>
            <Loader2 className="spin mx-auto mb-2" size={20} />
          </div>
        ) : recentCalls.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="text-4xl mb-2">📞</div>
            <div style={{ color: T.muted, fontFamily: FS }} className="text-sm">
              Дуудлага хараахан бүртгэгдээгүй байна
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {recentCalls.map((c) => (
              <div key={c.id} className="glass rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <div style={{ background: T.highlightSoft, color: T.highlight }}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0">
                    📞
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => handlePhoneClick(c.phone, c.customer_name, c.notes, c.interested_products)}
                        style={{ fontFamily: FS, fontWeight: 600, color: T.highlight }}
                        className="text-sm press-btn hover:opacity-80 flex items-center gap-1">
                        📱 {c.phone}
                        {copiedPhone === c.phone && (
                          <span style={{ background: T.ok, color: "white" }}
                            className="text-[8px] px-1.5 py-0.5 rounded-full font-medium ml-1">
                            ✓ Хуулсан
                          </span>
                        )}
                      </button>
                      {c.customer_name && (
                        <span style={{ color: T.ink, fontFamily: FS }} className="text-xs">
                          · {c.customer_name}
                        </span>
                      )}
                    </div>
                    {/* Notes (clean — хуучин формат-аас бараа жагсаалтыг хасах) */}
                    {c.notes && (() => {
                      const cleanNotes = c.notes.replace(/\n*📦 СОНИРХСОН БАРАА:[\s\S]*$/, "").trim();
                      return cleanNotes ? (
                        <div style={{ color: T.ink, fontFamily: FS }} className="text-xs mt-1 italic">
                          "{cleanNotes}"
                        </div>
                      ) : null;
                    })()}

                    {/* Хуучин notes-аас бараа нэрийг таних */}
                    {(!c.interested_products || !Array.isArray(c.interested_products) || c.interested_products.length === 0) &&
                      c.notes && c.notes.includes("СОНИРХСОН БАРАА") && (() => {
                        const match = c.notes.match(/📦 СОНИРХСОН БАРАА:\n([\s\S]*?)(?:\n\n|$)/);
                        if (!match) return null;
                        const lines = match[1].split("\n").map((l) => l.trim()).filter((l) => l.startsWith("•"));
                        const oldProducts = lines.map((l) => {
                          const text = l.replace(/^•\s*/, "");
                          const qtyMatch = text.match(/\((\d+)\s*ш\)\s*$/);
                          const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                          const name = text.replace(/\s*\(\d+\s*ш\)\s*$/, "").trim();
                          return { name, qty };
                        });
                        if (oldProducts.length === 0) return null;
                        return (
                          <div className="mt-2">
                            <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                              <ShoppingBag size={10} /> Сонирхсон бараа ({oldProducts.length})
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {oldProducts.map((p, idx) => (
                                <div key={idx} className="flex items-center gap-1.5 rounded-lg p-1.5 pr-2"
                                  style={{ background: T.highlightSoft, border: `1px solid ${T.border}` }}>
                                  <div style={{
                                    width: 28, height: 28, borderRadius: 4, background: T.surface,
                                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0,
                                  }}>📦</div>
                                  <span style={{ fontFamily: FS, fontWeight: 500, color: T.ink }} className="text-[10px]">
                                    {p.name}
                                  </span>
                                  {p.qty > 1 && (
                                    <span style={{ background: T.highlight, color: "white", fontFamily: FD, fontWeight: 700 }}
                                      className="text-[10px] px-1.5 py-0.5 rounded-full">
                                      ×{p.qty}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                    {/* Сонирхсон бараа — зурагтай grid (шинэ формат) */}
                    {c.interested_products && Array.isArray(c.interested_products) && c.interested_products.length > 0 && (
                      <div className="mt-2">
                        <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <ShoppingBag size={10} /> Сонирхсон бараа ({c.interested_products.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {c.interested_products.map((p, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 rounded-lg p-1.5 pr-2"
                              style={{ background: T.highlightSoft, border: `1px solid ${T.border}` }}>
                              {p.image_url ? (
                                <img src={p.image_url} alt={p.name}
                                  style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
                              ) : (
                                <div style={{
                                  width: 28, height: 28, borderRadius: 4, background: T.surface,
                                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0,
                                }}>📦</div>
                              )}
                              <span style={{ fontFamily: FS, fontWeight: 500, color: T.ink }} className="text-[10px]">
                                {p.name}
                              </span>
                              {p.qty > 1 && (
                                <span style={{ background: T.highlight, color: "white", fontFamily: FD, fontWeight: 700 }}
                                  className="text-[10px] px-1.5 py-0.5 rounded-full">
                                  ×{p.qty}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-2">
                      🕐 {new Date(c.created_at).toLocaleString("mn-MN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCallModal && (
        <SimpleCallModal
          products={products}
          profile={profile}
          onSave={async ({ fb_page_id, phones: phoneList, interested_products }) => {
            try {
              // Тус утсаар customer + call бичих
              for (const phoneEntry of phoneList) {
                const { phone, notes } = phoneEntry;

                // 1. Customer find or create
                let customerId = null;
                const { data: existing } = await supabase
                  .from("biz_customers")
                  .select("id, name")
                  .eq("phone", phone)
                  .maybeSingle();

                if (existing) {
                  customerId = existing.id;
                } else {
                  const { data: newCust } = await supabase
                    .from("biz_customers")
                    .insert({ phone })
                    .select()
                    .single();
                  customerId = newCust?.id || null;
                }

                // 2. Call log
                await supabase.from("biz_calls").insert({
                  phone,
                  customer_id: customerId,
                  notes: notes || null,
                  fb_page_id: fb_page_id || null,
                  interested_products,
                  created_by: profile.id,
                });
              }

              setShowCallModal(false);
              await loadAll();
            } catch (e) { alert("Алдаа: " + e.message); }
          }}
          onClose={() => setShowCallModal(false)}
        />
      )}

      {orderForCall && (
        <CallReceiveModal
          products={products}
          profile={profile}
          initialPhone={orderForCall.phone}
          initialName={orderForCall.name}
          initialNotes={orderForCall.notes}
          initialProducts={orderForCall.products}
          onSave={async (data) => {
            try {
              // 1. Customer find or create
              let customerId = null;
              if (data.phone) {
                const { data: existing } = await supabase
                  .from("biz_customers")
                  .select("id, name")
                  .eq("phone", data.phone)
                  .maybeSingle();

                if (existing) {
                  customerId = existing.id;
                  if (data.name !== existing.name || data.address || data.phone2) {
                    await supabase.from("biz_customers").update({
                      name: data.name || existing.name,
                      address: data.address || null,
                      phone2: data.phone2 || null,
                      updated_at: new Date().toISOString(),
                    }).eq("id", customerId);
                  }
                } else {
                  const { data: newCust } = await supabase
                    .from("biz_customers")
                    .insert({
                      phone: data.phone,
                      phone2: data.phone2,
                      name: data.name,
                      address: data.address,
                    })
                    .select()
                    .single();
                  customerId = newCust?.id || null;
                }
              }

              // 2. Order create
              const orderNumber = `ZA-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000) + 1000}`;
              const { data: order, error } = await supabase
                .from("biz_orders")
                .insert({
                  order_number: orderNumber,
                  customer_id: customerId,
                  customer_phone: data.phone,
                  customer_phone2: data.phone2,
                  customer_name: data.name,
                  delivery_address: data.address,
                  source: "phone",
                  status: "new",
                  subtotal: data.subtotal,
                  delivery_fee: data.deliveryFee,
                  total_amount: data.totalAmount,
                  paid_amount: data.paidAmount,
                  balance_due: data.balanceDue,
                  notes: data.notes,
                  taken_by: profile.id,
                })
                .select()
                .single();
              if (error) throw error;

              // 3. Order items
              const orderItems = data.items.map((it) => ({
                order_id: order.id,
                product_id: it.product_id,
                product_name: it.product_name,
                quantity: it.quantity,
                unit_price: it.unit_price,
                total_amount: it.total_amount,
              }));
              await supabase.from("biz_order_items").insert(orderItems);

              setOrderForCall(null);
              await loadAll();
              alert(`✅ Захиалга #${orderNumber} амжилттай!\n${data.totalAmount.toLocaleString()}₮`);
            } catch (e) { alert("Алдаа: " + e.message); }
          }}
          onClose={() => setOrderForCall(null)}
        />
      )}
    </div>
  );
}

// ─── Дугаар нэмэх modal (FB page + олон утас + бараа table) ──────────
function SimpleCallModal({ products = [], profile, onSave, onClose }) {
  const [fbPages, setFbPages] = useState([]);
  const [fbPageId, setFbPageId] = useState("");
  const [phones, setPhones] = useState([{ id: 1, phone: "", notes: "" }]);
  const [items, setItems] = useState([]); // [{ productId, qty, ... }]
  const [productSearch, setProductSearch] = useState("");
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [activeProduct, setActiveProduct] = useState(null);
  const [busy, setBusy] = useState(false);
  const [foundCustomer, setFoundCustomer] = useState(null);

  // FB pages-уудыг ачаалах
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("biz_fb_pages")
        .select("*")
        .eq("is_active", true)
        .order("display_order");
      setFbPages(data || []);
    })();
  }, []);

  // Customer auto-search (1-р утсаар)
  useEffect(() => {
    const phone = phones[0]?.phone?.trim();
    if (!phone || phone.length < 6) {
      setFoundCustomer(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from("biz_customers")
          .select("*")
          .eq("phone", phone)
          .maybeSingle();
        setFoundCustomer(data);
      } catch (e) { console.error(e); }
    }, 500);
    return () => clearTimeout(timer);
  }, [phones[0]?.phone]);

  // Phones management
  const addPhone = () => setPhones([...phones, { id: Date.now(), phone: "", notes: "" }]);
  const removePhone = (id) => phones.length > 1 && setPhones(phones.filter((p) => p.id !== id));
  const updatePhone = (id, field, value) => setPhones(phones.map((p) => p.id === id ? { ...p, [field]: value } : p));

  // Products
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products;
    const q = productSearch.toLowerCase();
    return products.filter((p) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q));
  }, [products, productSearch]);

  const toggleProduct = (product) => {
    const exists = items.find((it) => it.productId === product.id);
    if (exists) {
      setItems(items.filter((it) => it.productId !== product.id));
    } else {
      setItems([...items, {
        productId: product.id,
        product,
        qty: 1,
      }]);
    }
  };

  const updateItemQty = (productId, qty) => {
    if (qty <= 0) {
      setItems(items.filter((it) => it.productId !== productId));
      return;
    }
    setItems(items.map((it) => it.productId === productId ? { ...it, qty } : it));
  };

  const removeItem = (productId) => setItems(items.filter((it) => it.productId !== productId));

  const validPhones = phones.filter((p) => p.phone.trim());
  const canSave = validPhones.length > 0;

  const inputStyle = { background: T.surface, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS };

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-2">
      <div className="modal-content rounded-2xl w-full max-w-5xl max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: `1px solid ${T.border}` }}>
          <h3 style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm">
            Нэмэх
          </h3>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        <div className="p-5">
          {/* Title bar with action buttons */}
          <div className="flex items-center justify-between mb-4 pb-3"
            style={{ borderBottom: `2px solid ${T.highlight}`, background: "linear-gradient(180deg, transparent, transparent)" }}>
            <div className="flex items-center gap-2">
              <div style={{ width: 4, height: 24, background: T.highlight, borderRadius: 2 }} />
              <h2 style={{ fontFamily: FS, fontWeight: 700, color: T.ink }} className="text-xl">
                Дугаар нэмэх
              </h2>
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} disabled={busy}
                className="press-btn px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: T.surface, color: T.ink, border: `1px solid ${T.border}`, fontFamily: FS }}>
                Болих
              </button>
              <button
                disabled={busy || !canSave}
                onClick={async () => {
                  setBusy(true);
                  await onSave({
                    fb_page_id: fbPageId || null,
                    phones: validPhones.map((p) => ({ phone: p.phone.trim(), notes: p.notes.trim() || null })),
                    interested_products: items.length > 0 ? items.map((it) => ({
                      id: it.productId,
                      name: it.product.name,
                      qty: it.qty,
                      image_url: it.product.image_url || null,
                      sku: it.product.sku || null,
                      price: it.product.sale_price || null,
                    })) : null,
                  });
                  setBusy(false);
                }}
                className="press-btn px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: T.surface, color: T.ink, border: `1px solid ${T.border}`, fontFamily: FS }}>
                {busy ? "Хадгалаж..." : "Хадгалах"}
              </button>
            </div>
          </div>

          {/* 2 column section: FB + Phones */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
            {/* FB info */}
            <div style={{ background: T.surfaceAlt, border: `1px solid ${T.border}` }}
              className="rounded-xl p-4">
              <h4 style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm mb-3">
                Facebook мэдээлэл
              </h4>
              <div className="flex items-center gap-2">
                <label style={{ color: T.muted, fontFamily: FM }} className="text-xs whitespace-nowrap">
                  Маркетинг :
                </label>
                <select value={fbPageId} onChange={(e) => setFbPageId(e.target.value)}
                  style={inputStyle} className="flex-1 px-3 py-2 rounded-lg text-sm">
                  <option value="">Маркетинг сонгох</option>
                  {fbPages.map((page) => (
                    <option key={page.id} value={page.id}>{page.name}</option>
                  ))}
                </select>
              </div>
              {fbPages.length === 0 && (
                <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-2 italic">
                  💡 Эхлээд Facebook page нэмнэ үү (Бизнес → Тохиргоо)
                </div>
              )}
            </div>

            {/* Phones */}
            <div style={{ background: T.surfaceAlt, border: `1px solid ${T.border}` }}
              className="rounded-xl p-4">
              <h4 style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm mb-3">
                Утасны дугаарууд
              </h4>
              <div className="space-y-2">
                {phones.map((p, idx) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <div style={{
                      background: T.highlightSoft, color: T.highlight,
                      width: 24, height: 24, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: FD, fontWeight: 700, fontSize: 11, flexShrink: 0,
                    }}>
                      {idx + 1}
                    </div>
                    <input value={p.notes} onChange={(e) => updatePhone(p.id, "notes", e.target.value)}
                      placeholder="Сэтгэгдэл"
                      style={inputStyle} className="flex-1 px-2 py-1.5 rounded-lg text-xs min-w-0" />
                    <input value={p.phone} onChange={(e) => updatePhone(p.id, "phone", e.target.value)}
                      placeholder="Утас"
                      style={inputStyle} className="flex-1 px-2 py-1.5 rounded-lg text-xs min-w-0 tabular-nums" />
                    <button onClick={() => removePhone(p.id)}
                      disabled={phones.length === 1}
                      style={{
                        background: phones.length === 1 ? T.surface : T.err,
                        color: phones.length === 1 ? T.mutedSoft : "white",
                      }}
                      className="press-btn w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-base font-bold leading-none">−</span>
                    </button>
                    {idx === phones.length - 1 && (
                      <button onClick={addPhone}
                        style={{ background: T.surface, color: T.muted, border: `1px solid ${T.border}` }}
                        className="press-btn w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Plus size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={addPhone}
                className="press-btn w-full mt-3 py-2 rounded-lg text-xs flex items-center justify-center gap-1"
                style={{
                  border: `1px dashed ${T.border}`, background: "transparent",
                  color: T.muted, fontFamily: FS, fontWeight: 500,
                }}>
                <Plus size={12} /> Дугаар нэмэх
              </button>
              {foundCustomer && (
                <div className="mt-2 px-2 py-1 rounded"
                  style={{ background: T.highlightSoft, color: T.highlight, fontFamily: FS }}>
                  <div className="text-[10px]">
                    ✓ {foundCustomer.name || "Үйлчлүүлэгч"} · {foundCustomer.total_orders || 0} өмнөх захиалга
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Бараа сонгох */}
          <div className="mb-4">
            <button onClick={() => setShowProductPicker(!showProductPicker)}
              className="press-btn w-full py-2 rounded-lg text-sm flex items-center justify-center gap-1.5"
              style={{
                background: showProductPicker ? T.highlight : T.surfaceAlt,
                color: showProductPicker ? "white" : T.ink,
                border: `1px ${showProductPicker ? "solid" : "dashed"} ${showProductPicker ? T.highlight : T.border}`,
                fontFamily: FS, fontWeight: 600,
              }}>
              {showProductPicker ? "Хаах" : `+ Бараа сонгох ${items.length > 0 ? `(${items.length})` : ""}`}
            </button>

            {showProductPicker && (
              <div className="mt-2 rounded-lg overflow-hidden"
                style={{ background: T.surfaceAlt, border: `1px solid ${T.border}` }}>
                <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="🔍 Бараа хайх..."
                  style={{ background: T.surface, border: "none", borderBottom: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
                  className="w-full px-3 py-2 text-sm" />
                <div className="max-h-72 overflow-y-auto p-2">
                  {filteredProducts.length === 0 ? (
                    <div style={{ color: T.muted, fontFamily: FS }} className="text-center py-6 text-xs">
                      {products.length === 0 ? "Бараа байхгүй" : "Олдсонгүй"}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {filteredProducts.slice(0, 30).map((p) => {
                        const selected = items.find((ip) => ip.productId === p.id);
                        return (
                          <div key={p.id}
                            className="rounded-lg overflow-hidden relative"
                            style={{
                              background: T.surface,
                              border: `1px solid ${T.border}`,
                            }}>
                            {/* Top: SKU + Тайлбар pill */}
                            <div className="flex items-center gap-1 p-1.5"
                              style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                              {p.sku && (
                                <span style={{ background: T.highlightSoft, color: T.highlight, fontFamily: FS, fontWeight: 600 }}
                                  className="text-[9px] px-1.5 py-0.5 rounded">
                                  {p.sku}
                                </span>
                              )}
                              <button onClick={() => setActiveProduct(p)}
                                style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6", fontFamily: FS, fontWeight: 600 }}
                                className="text-[9px] px-1.5 py-0.5 rounded press-btn hover:opacity-80">
                                Тайлбар
                              </button>
                            </div>

                            {/* Image (clickable to add) */}
                            <button onClick={() => toggleProduct(p)}
                              className="press-btn w-full block">
                              <div style={{ width: "100%", aspectRatio: "1", background: T.surfaceAlt, position: "relative" }}>
                                {p.image_url ? (
                                  <img src={p.image_url} alt={p.name}
                                    style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                                ) : (
                                  <div style={{
                                    width: "100%", height: "100%",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: 32,
                                  }}>📦</div>
                                )}
                                {selected && (
                                  <div style={{
                                    position: "absolute", inset: 0,
                                    background: "rgba(236,72,153,0.1)",
                                    border: `2px solid ${T.highlight}`,
                                  }} />
                                )}
                              </div>
                            </button>

                            {/* Name */}
                            <div className="px-1.5 pt-1 pb-0.5">
                              <div style={{ fontFamily: FS, fontWeight: 500, color: T.ink }}
                                className="text-[10px] line-clamp-2 leading-tight">
                                {p.name}
                              </div>
                            </div>

                            {/* Price + Qty */}
                            <div className="flex items-center justify-between px-1.5 pb-1.5">
                              <span style={{ color: T.ink, fontFamily: FD, fontWeight: 700 }}
                                className="text-[11px] tabular-nums">
                                {Number(p.sale_price || 0).toLocaleString()}₮
                              </span>
                              {selected ? (
                                <div className="flex items-center gap-0.5">
                                  <button onClick={() => updateItemQty(p.id, selected.qty - 1)}
                                    style={{ background: T.surfaceAlt, color: T.ink, border: `1px solid ${T.border}` }}
                                    className="w-5 h-5 rounded text-[10px] press-btn">−</button>
                                  <span style={{ background: T.highlight, color: "white", fontFamily: FD, fontWeight: 700 }}
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px]">
                                    {selected.qty}
                                  </span>
                                  <button onClick={() => updateItemQty(p.id, selected.qty + 1)}
                                    style={{ background: T.highlight, color: "white" }}
                                    className="w-5 h-5 rounded text-[10px] press-btn">+</button>
                                </div>
                              ) : (
                                <button onClick={() => toggleProduct(p)}
                                  style={{ background: T.surfaceAlt, color: T.muted, border: `1px solid ${T.border}` }}
                                  className="press-btn w-5 h-5 rounded-full flex items-center justify-center text-[11px]">
                                  +
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Сонгосон бараа table */}
          {items.length > 0 && (
            <div className="rounded-xl overflow-hidden mb-4"
              style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: T.surfaceAlt }}>
                      <th style={{ color: T.muted, fontFamily: FM, fontWeight: 500, padding: "10px 8px", textAlign: "left" }}>№</th>
                      <th style={{ color: T.muted, fontFamily: FM, fontWeight: 500, padding: "10px 8px", textAlign: "left" }}>Зураг</th>
                      <th style={{ color: T.muted, fontFamily: FM, fontWeight: 500, padding: "10px 8px", textAlign: "left" }}>Нэр</th>
                      <th style={{ color: T.muted, fontFamily: FM, fontWeight: 500, padding: "10px 8px", textAlign: "left" }}>Ангилал</th>
                      <th style={{ color: T.muted, fontFamily: FM, fontWeight: 500, padding: "10px 8px", textAlign: "left" }}>Дотоод код</th>
                      <th style={{ color: T.muted, fontFamily: FM, fontWeight: 500, padding: "10px 8px", textAlign: "left" }}>Баар код</th>
                      <th style={{ color: T.muted, fontFamily: FM, fontWeight: 500, padding: "10px 8px", textAlign: "right" }}>Үнэ</th>
                      <th style={{ color: T.muted, fontFamily: FM, fontWeight: 500, padding: "10px 8px", textAlign: "right" }}>Үлдэгдэл</th>
                      <th style={{ color: T.muted, fontFamily: FM, fontWeight: 500, padding: "10px 8px", textAlign: "center" }}>Тоо ширхэг</th>
                      <th style={{ color: T.muted, fontFamily: FM, fontWeight: 500, padding: "10px 8px", textAlign: "center" }}>Үйлдэл</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const p = it.product;
                      return (
                        <tr key={it.productId} style={{ borderTop: `1px solid ${T.borderSoft}` }}>
                          <td style={{ padding: "10px 8px", color: T.ink, fontFamily: FM }}>{idx + 1}</td>
                          <td style={{ padding: "8px" }}>
                            {p.image_url ? (
                              <img src={p.image_url} alt={p.name}
                                style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} />
                            ) : (
                              <div style={{
                                width: 36, height: 36, borderRadius: 4, background: T.surfaceAlt,
                                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                              }}>📦</div>
                            )}
                          </td>
                          <td style={{ padding: "10px 8px", color: T.ink, fontFamily: FS, fontWeight: 500 }}
                            className="line-clamp-2 max-w-[150px]">
                            {p.name}
                          </td>
                          <td style={{ padding: "10px 8px", color: T.ink, fontFamily: FS }}>
                            {p.category || "—"}
                          </td>
                          <td style={{ padding: "10px 8px", color: T.ink, fontFamily: FM }}>
                            {p.sku || "—"}
                          </td>
                          <td style={{ padding: "10px 8px", color: T.ink, fontFamily: FM }}>
                            {p.barcode || p.sku || "—"}
                          </td>
                          <td style={{ padding: "10px 8px", color: T.ink, fontFamily: FD, fontWeight: 600, textAlign: "right" }} className="tabular-nums">
                            {Number(p.sale_price || 0).toLocaleString()}₮
                          </td>
                          <td style={{ padding: "10px 8px", color: T.ink, fontFamily: FM, textAlign: "right" }} className="tabular-nums">
                            {p.stock || 0}
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "center" }}>
                            <input type="number" value={it.qty}
                              onChange={(e) => updateItemQty(it.productId, Number(e.target.value) || 0)}
                              style={{ ...inputStyle, width: 60, textAlign: "center" }}
                              className="px-2 py-1 rounded text-xs tabular-nums" />
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "center" }}>
                            <button onClick={() => removeItem(it.productId)}
                              style={{ color: T.muted }} className="press-btn p-1 rounded">
                              <span className="text-base">⋮</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Барааны popup */}
      {activeProduct && (
        <div onClick={() => setActiveProduct(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60 }}
          className="flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()}
            className="modal-content rounded-2xl w-full max-w-sm overflow-hidden">
            <div style={{ width: "100%", aspectRatio: "1", background: T.surfaceAlt, position: "relative" }}>
              {activeProduct.image_url ? (
                <img src={activeProduct.image_url} alt={activeProduct.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{
                  width: "100%", height: "100%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 80,
                }}>📦</div>
              )}
              <button onClick={() => setActiveProduct(null)}
                style={{
                  position: "absolute", top: 12, right: 12,
                  background: "rgba(0,0,0,0.6)", color: "white",
                  width: 32, height: 32, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <h4 style={{ fontFamily: FS, fontWeight: 700, color: T.ink }} className="text-base">
                  {activeProduct.name}
                </h4>
                {activeProduct.sku && (
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
                    SKU: {activeProduct.sku}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span style={{ fontFamily: FD, fontWeight: 700, color: T.highlight }} className="text-2xl tabular-nums">
                  {Number(activeProduct.sale_price || 0).toLocaleString()}₮
                </span>
                <span style={{ color: T.muted, fontFamily: FM }} className="text-xs">
                  Нөөц: {activeProduct.stock} {activeProduct.unit}
                </span>
              </div>
              {activeProduct.description && (
                <div>
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1">
                    📄 Тайлбар
                  </div>
                  <div className="text-sm whitespace-pre-wrap p-3 rounded-lg"
                    style={{ background: T.surfaceAlt, fontFamily: FS, color: T.ink }}>
                    {activeProduct.description}
                  </div>
                </div>
              )}
              {(() => {
                const selected = items.find((ip) => ip.productId === activeProduct.id);
                if (!selected) {
                  return (
                    <div style={{ color: T.muted, fontFamily: FS }} className="text-center text-xs italic">
                      💡 Зураг дээр дарж сонгоно уу
                    </div>
                  );
                }
                return (
                  <div className="flex items-center justify-between p-3 rounded-lg"
                    style={{ background: T.highlightSoft }}>
                    <span style={{ color: T.highlight, fontFamily: FS, fontWeight: 600 }} className="text-sm">
                      ✓ Сонгогдсон
                    </span>
                    <span style={{ fontFamily: FD, fontWeight: 700, color: T.ink }}
                      className="text-xl tabular-nums">
                      {selected.qty} ширхэг
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Захиалга авах modal — 2 баганатай зураг бүхий хувилбар ──────────
function CallReceiveModal({ products, profile, initialPhone, initialName, initialNotes, initialProducts, onSave, onClose }) {
  const [phone, setPhone] = useState(initialPhone || "");
  const [phone2, setPhone2] = useState("");
  const [name, setName] = useState(initialName || "");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState(initialNotes || "");
  // initialProducts-ийг items-руу хөрвүүлэх
  const [items, setItems] = useState(() => {
    if (!initialProducts || !Array.isArray(initialProducts) || initialProducts.length === 0) return [];
    return initialProducts.map((ip) => {
      const product = products.find((p) => p.id === ip.id);
      if (!product) return null;
      return {
        productId: product.id,
        product,
        quantity: ip.qty || 1,
        unitPrice: Number(product.sale_price || 0),
        itemNotes: product.description || "",
      };
    }).filter(Boolean);
  });
  const [deliveryFee, setDeliveryFee] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [callType, setCallType] = useState("called"); // called | walk_in
  const [busy, setBusy] = useState(false);
  const [foundCustomer, setFoundCustomer] = useState(null);
  const [searching, setSearching] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [activeProductDetail, setActiveProductDetail] = useState(null); // popup-ийн бараа

  // Customer auto-search
  useEffect(() => {
    if (!phone || phone.length < 6) {
      setFoundCustomer(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await supabase
          .from("biz_customers")
          .select("*")
          .eq("phone", phone)
          .maybeSingle();
        if (data) {
          setFoundCustomer(data);
          if (!name) setName(data.name || "");
          if (!address && data.address) setAddress(data.address);
          if (!phone2 && data.phone2) setPhone2(data.phone2);
        } else {
          setFoundCustomer(null);
        }
      } catch (e) { console.error(e); }
      finally { setSearching(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [phone]);

  // Filter products
  const filtered = useMemo(() => {
    if (!productSearch.trim()) return products;
    const q = productSearch.toLowerCase();
    return products.filter((p) =>
      p.name?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    );
  }, [products, productSearch]);

  const addItem = (product) => {
    const exists = items.find((it) => it.productId === product.id);
    if (exists) {
      setItems(items.map((it) => it.productId === product.id ? { ...it, quantity: it.quantity + 1 } : it));
    } else {
      setItems([...items, {
        productId: product.id,
        product: product,
        quantity: 1,
        unitPrice: Number(product.sale_price || 0),
        itemNotes: product.description || "", // Барааны description-аас auto-fill
      }]);
    }
  };

  const updateItemNotes = (productId, notes) => {
    setItems(items.map((it) => it.productId === productId ? { ...it, itemNotes: notes } : it));
  };

  const updateQty = (productId, qty) => {
    if (qty <= 0) {
      removeItem(productId);
      return;
    }
    setItems(items.map((it) => it.productId === productId ? { ...it, quantity: qty } : it));
  };

  const removeItem = (productId) => {
    setItems(items.filter((it) => it.productId !== productId));
  };

  // Тооцоо
  const subtotal = items.reduce((sum, it) => sum + (it.quantity * it.unitPrice), 0);
  const fee = Number(deliveryFee) || 0;
  const total = subtotal + fee;
  const paid = Number(paidAmount) || 0;
  const balance = total - paid;

  const inputStyle = { background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS };

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-2">
      <div className="modal-content rounded-2xl w-full max-w-6xl p-4 sm:p-5 max-h-[95vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-lg">
            🛍 Захиалга авах
          </h3>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
          {/* ЗҮҮН: Form */}
          <div className="glass rounded-xl p-4 space-y-3">
            {/* Phones */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label style={{ color: T.ink, fontFamily: FS, fontWeight: 500 }} className="text-xs mb-1 flex items-center gap-1">
                  <Phone size={11} style={{ color: T.highlight }} />
                  <span style={{ color: T.err }}>*</span> Дугаар 1
                </label>
                <div className="relative">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)}
                    placeholder="99887766"
                    style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm" />
                  {searching && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <Loader2 className="spin" size={14} style={{ color: T.muted }} />
                    </div>
                  )}
                </div>
                {foundCustomer && (
                  <div className="mt-1 px-2 py-1 rounded"
                    style={{ background: T.highlightSoft, color: T.highlight, fontFamily: FS }}>
                    <div className="text-[10px]">
                      ✓ {foundCustomer.total_orders || 0} өмнөх захиалга · {Number(foundCustomer.total_amount || 0).toLocaleString()}₮
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label style={{ color: T.ink, fontFamily: FS, fontWeight: 500 }} className="text-xs mb-1 flex items-center gap-1">
                  <Phone size={11} style={{ color: T.muted }} />
                  Дугаар 2
                </label>
                <input value={phone2} onChange={(e) => setPhone2(e.target.value)}
                  placeholder="99112233"
                  style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm" />
              </div>
            </div>

            {/* Address */}
            <div>
              <label style={{ color: T.ink, fontFamily: FS, fontWeight: 500 }} className="text-xs mb-1 flex items-center gap-1">
                <MapPin size={11} style={{ color: T.highlight }} />
                <span style={{ color: T.err }}>*</span> Хүргэх хаяг
              </label>
              <textarea value={address} onChange={(e) => setAddress(e.target.value)}
                rows={2}
                placeholder="Дүүрэг, хороо, байр, тоот..."
                style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm resize-none" />
            </div>

            {/* Subtotal + Total */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label style={{ color: T.ink, fontFamily: FS, fontWeight: 500 }} className="text-xs mb-1 flex items-center gap-1">
                  <ShoppingBag size={11} style={{ color: T.muted }} />
                  Бараа дүн
                </label>
                <div className="px-3 py-2 rounded-lg text-sm tabular-nums"
                  style={{ background: T.surfaceAlt, color: T.ink, fontFamily: FS, fontWeight: 600 }}>
                  {subtotal.toLocaleString()}₮
                </div>
              </div>
              <div>
                <label style={{ color: T.ink, fontFamily: FS, fontWeight: 500 }} className="text-xs mb-1 flex items-center gap-1">
                  <BarChart3 size={11} style={{ color: T.highlight }} />
                  Нийт дүн
                </label>
                <div className="px-3 py-2 rounded-lg text-sm tabular-nums"
                  style={{ background: T.highlightSoft, color: T.highlight, fontFamily: FS, fontWeight: 700 }}>
                  {total.toLocaleString()}₮
                </div>
              </div>
            </div>

            {/* Delivery fee + Paid */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label style={{ color: T.ink, fontFamily: FS, fontWeight: 500 }} className="text-xs mb-1 flex items-center gap-1">
                  <Send size={11} style={{ color: T.muted }} />
                  Хүргэлтийн үнэ
                </label>
                <input type="number" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)}
                  placeholder="0"
                  style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm tabular-nums" />
              </div>
              <div>
                <label style={{ color: T.ink, fontFamily: FS, fontWeight: 500 }} className="text-xs mb-1 flex items-center gap-1">
                  <CheckCircle2 size={11} style={{ color: T.ok }} />
                  Төлсөн дүн
                </label>
                <input type="number" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)}
                  placeholder="0"
                  style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm tabular-nums" />
                {paid > 0 && balance !== 0 && (
                  <div style={{ color: balance > 0 ? T.warn : T.ok, fontFamily: FM }}
                    className="text-[10px] mt-1">
                    {balance > 0 ? `⚠ Үлдэгдэл: ${balance.toLocaleString()}₮` : `💰 Илүү: ${Math.abs(balance).toLocaleString()}₮`}
                  </div>
                )}
              </div>
            </div>

            {/* Type buttons */}
            <div>
              <label style={{ color: T.ink, fontFamily: FS, fontWeight: 500 }} className="text-xs mb-1 flex items-center gap-1">
                <FileText size={11} style={{ color: T.muted }} />
                Захиалгын төрөл
              </label>
              <div className="flex gap-2 mb-2">
                <button onClick={() => setCallType("called")}
                  className="press-btn px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"
                  style={{
                    background: callType === "called" ? T.highlight : T.surfaceAlt,
                    color: callType === "called" ? "white" : T.ink,
                    fontFamily: FS, fontWeight: 600,
                  }}>
                  <Phone size={11} /> Залгасан
                </button>
                <button onClick={() => setCallType("walk_in")}
                  className="press-btn px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"
                  style={{
                    background: callType === "walk_in" ? T.highlight : T.surfaceAlt,
                    color: callType === "walk_in" ? "white" : T.ink,
                    fontFamily: FS, fontWeight: 600,
                  }}>
                  <UserIcon size={11} /> Орж ирсэн
                </button>
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Нэмэлт мэдээлэл..."
                style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm resize-none" />
            </div>
          </div>

          {/* БАРУУН: Бараа хайх + сонгосон бараа */}
          <div className="glass rounded-xl p-4 flex flex-col" style={{ maxHeight: "75vh" }}>
            <h4 style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-base mb-3">
              Бараа хайх
            </h4>

            {/* Search */}
            <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
              placeholder="🔍 Нэр, SKU-аар хайх..."
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm mb-3" />

            {/* Сонгосон бараанууд */}
            {items.length > 0 && (
              <div className="space-y-2 mb-3 pb-3" style={{ borderBottom: `1px solid ${T.border}` }}>
                {items.map((it) => {
                  const p = it.product;
                  return (
                    <div key={it.productId} className="rounded-xl p-3"
                      style={{ background: T.surfaceAlt, border: `1px solid ${T.border}` }}>
                      <div className="flex gap-3 items-start mb-2">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.name}
                            style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8 }} />
                        ) : (
                          <div style={{
                            width: 60, height: 60, borderRadius: 8,
                            background: T.surface, display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 24,
                          }}>📦</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 mb-1 flex-wrap">
                            {p.sku && (
                              <span style={{ background: T.highlightSoft, color: T.highlight }}
                                className="text-[9px] px-1.5 py-0.5 rounded font-medium">
                                {p.sku}
                              </span>
                            )}
                            <button onClick={() => removeItem(it.productId)}
                              style={{ background: T.muted, color: "white" }}
                              className="ml-auto w-5 h-5 rounded-full flex items-center justify-center text-[10px]">
                              ✕
                            </button>
                          </div>
                          <div style={{ fontFamily: FS, fontWeight: 600, color: T.ink }}
                            className="text-sm mb-2 line-clamp-2">
                            {p.name}
                          </div>
                          <div className="flex items-center gap-2">
                            <span style={{ fontFamily: FD, fontWeight: 600, color: T.ink }}
                              className="text-sm tabular-nums">
                              {Number(it.unitPrice).toLocaleString()}₮
                            </span>
                            <div className="flex items-center gap-1 ml-auto">
                              <button onClick={() => updateQty(it.productId, it.quantity - 1)}
                                style={{ background: T.surface, color: T.ink, border: `1px solid ${T.border}` }}
                                className="w-6 h-6 rounded text-xs press-btn">
                                −
                              </button>
                              <input type="number" value={it.quantity}
                                onChange={(e) => updateQty(it.productId, Number(e.target.value) || 0)}
                                style={{ ...inputStyle, width: 40, textAlign: "center" }}
                                className="px-1 py-0.5 rounded text-xs tabular-nums" />
                              <button onClick={() => updateQty(it.productId, it.quantity + 1)}
                                style={{ background: T.highlight, color: "white" }}
                                className="w-6 h-6 rounded text-xs press-btn">
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Барааны тайлбар */}
                      <div>
                        <label style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider mb-1 flex items-center gap-1">
                          <FileText size={9} /> Тайлбар
                        </label>
                        <textarea value={it.itemNotes || ""}
                          onChange={(e) => updateItemNotes(it.productId, e.target.value)}
                          rows={2}
                          placeholder="Барааны тайлбар, тэмдэглэл..."
                          style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
                          className="w-full px-2 py-1.5 rounded text-[11px] resize-none" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Хайлтын үр дүн — grid дизайн */}
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div style={{ color: T.muted, fontFamily: FS }} className="text-center py-8 text-sm">
                  {products.length === 0 ? "Бараа байхгүй" : "Олдсонгүй"}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {filtered.slice(0, 30).map((p) => {
                    const inCart = items.find((it) => it.productId === p.id);
                    return (
                      <div key={p.id}
                        className="rounded-lg overflow-hidden relative"
                        style={{
                          background: T.surface,
                          border: `1px solid ${T.border}`,
                        }}>
                        {/* Top pills: SKU + Тайлбар */}
                        <div className="flex items-center gap-1 p-1.5"
                          style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                          {p.sku && (
                            <span style={{ background: T.highlightSoft, color: T.highlight, fontFamily: FS, fontWeight: 600 }}
                              className="text-[9px] px-1.5 py-0.5 rounded">
                              {p.sku}
                            </span>
                          )}
                          <button onClick={() => setActiveProductDetail(p)}
                            style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6", fontFamily: FS, fontWeight: 600 }}
                            className="text-[9px] px-1.5 py-0.5 rounded press-btn hover:opacity-80">
                            Тайлбар
                          </button>
                        </div>

                        {/* Image — Click to add */}
                        <button onClick={() => addItem(p)}
                          className="press-btn w-full block">
                          <div style={{ width: "100%", aspectRatio: "1", background: T.surfaceAlt, position: "relative" }}>
                            {p.image_url ? (
                              <img src={p.image_url} alt={p.name}
                                style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                            ) : (
                              <div style={{
                                width: "100%", height: "100%",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 32,
                              }}>📦</div>
                            )}
                            {inCart && (
                              <div style={{
                                position: "absolute", inset: 0,
                                background: "rgba(236,72,153,0.1)",
                                border: `2px solid ${T.highlight}`,
                              }} />
                            )}
                          </div>
                        </button>

                        {/* Name */}
                        <div className="px-1.5 pt-1 pb-0.5">
                          <div style={{ fontFamily: FS, fontWeight: 500, color: T.ink }}
                            className="text-[10px] line-clamp-2 leading-tight">
                            {p.name}
                          </div>
                        </div>

                        {/* Price + Qty */}
                        <div className="flex items-center justify-between px-1.5 pb-1.5">
                          <span style={{ color: T.ink, fontFamily: FD, fontWeight: 700 }}
                            className="text-[11px] tabular-nums">
                            {Number(p.sale_price || 0).toLocaleString()}₮
                          </span>
                          {inCart ? (
                            <div className="flex items-center gap-0.5">
                              <button onClick={() => updateQty(p.id, inCart.quantity - 1)}
                                style={{ background: T.surfaceAlt, color: T.ink, border: `1px solid ${T.border}` }}
                                className="w-5 h-5 rounded text-[10px] press-btn">−</button>
                              <span style={{ background: T.highlight, color: "white", fontFamily: FD, fontWeight: 700 }}
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px]">
                                {inCart.quantity}
                              </span>
                              <button onClick={() => updateQty(p.id, inCart.quantity + 1)}
                                style={{ background: T.highlight, color: "white" }}
                                className="w-5 h-5 rounded text-[10px] press-btn">+</button>
                            </div>
                          ) : (
                            <button onClick={() => addItem(p)}
                              style={{ background: T.surfaceAlt, color: T.muted, border: `1px solid ${T.border}` }}
                              className="press-btn w-5 h-5 rounded-full flex items-center justify-center text-[11px]">
                              +
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Барааны тайлбар popup */}
        {activeProductDetail && (
          <div onClick={() => setActiveProductDetail(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60 }}
            className="flex items-center justify-center p-4">
            <div onClick={(e) => e.stopPropagation()}
              className="modal-content rounded-2xl w-full max-w-sm overflow-hidden">
              <div style={{ width: "100%", aspectRatio: "1", background: T.surfaceAlt, position: "relative" }}>
                {activeProductDetail.image_url ? (
                  <img src={activeProductDetail.image_url} alt={activeProductDetail.name}
                    style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  <div style={{
                    width: "100%", height: "100%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 80,
                  }}>📦</div>
                )}
                <button onClick={() => setActiveProductDetail(null)}
                  style={{
                    position: "absolute", top: 12, right: 12,
                    background: "rgba(0,0,0,0.6)", color: "white",
                    width: 32, height: 32, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <h4 style={{ fontFamily: FS, fontWeight: 700, color: T.ink }} className="text-base">
                    {activeProductDetail.name}
                  </h4>
                  {activeProductDetail.sku && (
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
                      SKU: {activeProductDetail.sku}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ fontFamily: FD, fontWeight: 700, color: T.highlight }} className="text-2xl tabular-nums">
                    {Number(activeProductDetail.sale_price || 0).toLocaleString()}₮
                  </span>
                  <span style={{ color: T.muted, fontFamily: FM }} className="text-xs">
                    Нөөц: {activeProductDetail.stock} {activeProductDetail.unit}
                  </span>
                </div>
                {activeProductDetail.description && (
                  <div>
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1">
                      📄 Тайлбар
                    </div>
                    <div className="text-sm whitespace-pre-wrap p-3 rounded-lg"
                      style={{ background: T.surfaceAlt, fontFamily: FS, color: T.ink }}>
                      {activeProductDetail.description}
                    </div>
                  </div>
                )}
                <div style={{ color: T.muted, fontFamily: FS }} className="text-center text-xs italic">
                  💡 Зураг дээр дарж сонгоно уу
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} disabled={busy}
            className="press-btn flex-1 py-3 rounded-xl text-sm font-semibold"
            style={{ background: T.surfaceAlt, color: T.ink, fontFamily: FS }}>
            Цуцлах
          </button>
          <button
            disabled={busy || !phone.trim() || items.length === 0 || !address.trim()}
            onClick={async () => {
              setBusy(true);
              await onSave({
                phone: phone.trim(),
                phone2: phone2.trim() || null,
                name: name.trim() || null,
                address: address.trim() || null,
                notes: notes.trim() || null,
                callType,
                subtotal,
                deliveryFee: fee,
                totalAmount: total,
                paidAmount: paid,
                balanceDue: balance,
                items: items.map((it) => ({
                  product_id: it.productId,
                  product_name: it.product.name,
                  quantity: it.quantity,
                  unit_price: it.unitPrice,
                  total_amount: it.quantity * it.unitPrice,
                  notes: it.itemNotes || null,
                })),
              });
              setBusy(false);
            }}
            className="glow-primary press-btn flex-[2] py-3 rounded-xl text-sm font-semibold">
            {busy ? "Хадгалаж..." : `✓ Захиалга үүсгэх (${items.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Бараа хайх + хуудаслах select ────────────────────────────────
function ProductSearchSelect({ products, value, onChange, isOpen, onOpen, onClose }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PER_PAGE = 8;
  const ref = useRef(null);

  const selected = products.find((p) => p.id === value);

  // Filter
  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter((p) =>
      p.name?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    );
  }, [products, search]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const pageProducts = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  useEffect(() => {
    setPage(0);
  }, [search]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  const inputStyle = { background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={isOpen ? onClose : onOpen}
        style={{ ...inputStyle, textAlign: "left", width: "100%" }}
        className="px-2 py-1.5 rounded text-xs flex items-center justify-between gap-1 truncate">
        <span className="truncate">
          {selected ? `${selected.name} (${selected.stock})` : "🔍 Сонгох..."}
        </span>
        <ChevronDown size={11} style={{ color: T.muted, flexShrink: 0 }} />
      </button>

      {isOpen && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          background: T.surface || "white",
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          zIndex: 100,
          minWidth: 250,
          maxWidth: 320,
        }} className="p-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Бараа хайх..."
            style={inputStyle}
            className="w-full px-2 py-1.5 rounded text-xs mb-2"
            autoFocus
          />

          <div className="max-h-60 overflow-y-auto space-y-0.5">
            {pageProducts.length === 0 ? (
              <div style={{ color: T.muted, fontFamily: FS }} className="text-xs text-center py-3">
                Бараа олдсонгүй
              </div>
            ) : (
              pageProducts.map((p) => (
                <button key={p.id} onClick={() => { onChange(p.id); setSearch(""); setPage(0); }}
                  style={{
                    background: value === p.id ? T.highlightSoft : "transparent",
                    color: T.ink, fontFamily: FS,
                  }}
                  className="press-btn w-full text-left px-2 py-1.5 rounded hover:bg-black/5 text-xs flex items-center justify-between gap-2">
                  <span className="truncate flex-1">{p.name}</span>
                  <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] flex-shrink-0">
                    {p.stock} {p.unit}
                  </span>
                </button>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-2 pt-2"
              style={{ borderTop: `1px solid ${T.borderSoft}` }}>
              <button onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                style={{ color: page === 0 ? T.mutedSoft : T.ink }}
                className="press-btn px-2 py-0.5 rounded text-xs">
                ‹ Өмнөх
              </button>
              <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
                {page + 1} / {totalPages} ({filtered.length})
              </span>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                style={{ color: page >= totalPages - 1 ? T.mutedSoft : T.ink }}
                className="press-btn px-2 py-0.5 rounded text-xs">
                Дараах ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Захиалгын карт ───────────────────────────────────────────────
function OrderCard({ order, compact = false, onClick }) {
  const statusInfo = {
    new: { label: "Шинэ", color: T.highlight, bg: T.highlightSoft, icon: "🆕" },
    preparing: { label: "Бэлтгэгдэж", color: T.warn, bg: T.warnSoft, icon: "👨‍🍳" },
    delivered: { label: "Хүргэгдсэн", color: T.ok, bg: "rgba(16,185,129,0.1)", icon: "✓" },
    cancelled: { label: "Цуцалсан", color: T.err, bg: T.errSoft, icon: "✕" },
  };
  const status = statusInfo[order.status] || statusInfo.new;

  return (
    <button onClick={onClick}
      className={`glass ${onClick ? "lift" : ""} rounded-xl p-3 w-full text-left block`}>
      <div className="flex items-start gap-3">
        <div style={{
          background: status.bg, color: status.color,
        }} className="w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0">
          {status.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm">
              #{order.order_number}
            </span>
            <span style={{
              background: status.bg, color: status.color, fontFamily: FS, fontWeight: 600,
            }} className="text-[9px] px-1.5 py-0.5 rounded-full">
              {status.label}
            </span>
          </div>
          <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-0.5">
            📱 {order.customer_phone || "—"} {order.customer_name ? `· ${order.customer_name}` : ""}
          </div>
          {!compact && order.delivery_address && (
            <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-0.5 truncate">
              📍 {order.delivery_address}
            </div>
          )}
          <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-0.5">
            🕐 {new Date(order.created_at).toLocaleString("mn-MN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        <div style={{ fontFamily: FD, fontWeight: 700, color: T.ink }} className="text-base tabular-nums whitespace-nowrap">
          {Number(order.total_amount).toLocaleString()}₮
        </div>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  ORDERS VIEW — Захиалгын жагсаалт
// ═══════════════════════════════════════════════════════════════════════════
function OrdersView({ profile }) {
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | new | preparing | delivered | cancelled
  const [search, setSearch] = useState("");
  const [activeOrder, setActiveOrder] = useState(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data: ordData } = await supabase
        .from("biz_orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      setOrders(ordData || []);

      // Items load
      if (ordData && ordData.length > 0) {
        const orderIds = ordData.map((o) => o.id);
        const { data: itemData } = await supabase
          .from("biz_order_items")
          .select("*")
          .in("order_id", orderIds);
        const itemMap = {};
        (itemData || []).forEach((it) => {
          if (!itemMap[it.order_id]) itemMap[it.order_id] = [];
          itemMap[it.order_id].push(it);
        });
        setItems(itemMap);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  // Filter
  let filtered = orders;
  if (filter !== "all") {
    filtered = filtered.filter((o) => o.status === filter);
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter((o) =>
      o.order_number?.toLowerCase().includes(q) ||
      o.customer_phone?.includes(q) ||
      o.customer_name?.toLowerCase().includes(q)
    );
  }

  // Counts
  const counts = {
    all: orders.length,
    new: orders.filter((o) => o.status === "new").length,
    preparing: orders.filter((o) => o.status === "preparing").length,
    delivered: orders.filter((o) => o.status === "delivered").length,
    cancelled: orders.filter((o) => o.status === "cancelled").length,
  };

  const updateStatus = async (orderId, newStatus) => {
    const updates = { status: newStatus };
    if (newStatus === "delivered") updates.delivered_at = new Date().toISOString();
    if (newStatus === "cancelled") updates.cancelled_at = new Date().toISOString();
    await supabase.from("biz_orders").update(updates).eq("id", orderId);
    await loadAll();
    if (activeOrder?.id === orderId) {
      const updated = (await supabase.from("biz_orders").select("*").eq("id", orderId).single()).data;
      setActiveOrder(updated);
    }
  };

  if (activeOrder) {
    return (
      <OrderDetail
        order={activeOrder}
        items={items[activeOrder.id] || []}
        onClose={() => setActiveOrder(null)}
        onUpdateStatus={(s) => updateStatus(activeOrder.id, s)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter pills */}
      <div className="glass rounded-2xl p-3 space-y-2">
        <div className="flex flex-wrap gap-1">
          {[
            { key: "all", label: "Бүх", icon: "📋" },
            { key: "new", label: "Шинэ", icon: "🆕" },
            { key: "preparing", label: "Бэлтгэж", icon: "👨‍🍳" },
            { key: "delivered", label: "Хүргэсэн", icon: "✓" },
            { key: "cancelled", label: "Цуцалсан", icon: "✕" },
          ].map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="press-btn px-3 py-1.5 rounded-full text-xs flex items-center gap-1"
              style={{
                background: filter === f.key ? T.highlight : T.surfaceAlt,
                color: filter === f.key ? "white" : T.ink,
                fontFamily: FS, fontWeight: 500,
              }}>
              <span>{f.icon}</span>
              <span>{f.label}</span>
              <span style={{
                background: filter === f.key ? "rgba(255,255,255,0.2)" : T.surface,
                color: filter === f.key ? "white" : T.muted,
              }} className="text-[9px] px-1.5 rounded-full ml-0.5">
                {counts[f.key]}
              </span>
            </button>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Захиалгын дугаар, утас, нэрээр хайх..."
          style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
          className="w-full px-3 py-2 rounded-lg text-xs" />
      </div>

      {loading ? (
        <div className="glass rounded-2xl p-8 text-center" style={{ color: T.muted, fontFamily: FS }}>
          <Loader2 className="spin mx-auto mb-2" size={20} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <div className="text-4xl mb-2">📋</div>
          <div style={{ color: T.muted, fontFamily: FS }} className="text-sm">
            Захиалга байхгүй байна
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => (
            <OrderCard key={o.id} order={o} onClick={() => setActiveOrder(o)} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ order, items, onClose, onUpdateStatus }) {
  const status = order.status;

  const statusActions = {
    new: [
      { label: "Бэлтгэж эхлэх", action: "preparing", color: T.warn, icon: "👨‍🍳" },
      { label: "Шууд хүргэгдсэн", action: "delivered", color: T.ok, icon: "✓" },
      { label: "Цуцлах", action: "cancelled", color: T.err, icon: "✕" },
    ],
    preparing: [
      { label: "Хүргэгдсэн", action: "delivered", color: T.ok, icon: "✓" },
      { label: "Цуцлах", action: "cancelled", color: T.err, icon: "✕" },
    ],
    delivered: [],
    cancelled: [],
  };

  const actions = statusActions[status] || [];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="glass rounded-2xl p-3 flex items-center gap-2">
        <button onClick={onClose} className="press-btn p-1.5 rounded-lg"
          style={{ color: T.ink }}>
          ←
        </button>
        <div className="flex-1 min-w-0">
          <div style={{ fontFamily: FS, fontWeight: 700, color: T.ink }} className="text-base">
            #{order.order_number}
          </div>
          <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
            {new Date(order.created_at).toLocaleString("mn-MN")}
          </div>
        </div>
      </div>

      {/* Customer info */}
      <div className="glass rounded-2xl p-4">
        <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider mb-2">
          Үйлчлүүлэгч
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span style={{ color: T.muted }}>📱</span>
            <a href={`tel:${order.customer_phone}`}
              style={{ fontFamily: FS, fontWeight: 600, color: T.highlight }}
              className="text-sm">
              {order.customer_phone || "—"}
            </a>
          </div>
          {order.customer_name && (
            <div className="flex items-center gap-2">
              <span style={{ color: T.muted }}>👤</span>
              <span style={{ fontFamily: FS, color: T.ink }} className="text-sm">
                {order.customer_name}
              </span>
            </div>
          )}
          {order.delivery_address && (
            <div className="flex items-start gap-2">
              <span style={{ color: T.muted }}>📍</span>
              <span style={{ fontFamily: FS, color: T.ink }} className="text-sm">
                {order.delivery_address}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="glass rounded-2xl p-4">
        <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider mb-2">
          Захиалсан бараа ({items.length})
        </div>
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-3 py-1.5"
              style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
              <div className="flex-1 min-w-0">
                <div style={{ fontFamily: FS, fontWeight: 500, color: T.ink }} className="text-sm">
                  {it.product_name}
                </div>
                <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
                  {Number(it.quantity)} × {Number(it.unit_price).toLocaleString()}₮
                </div>
              </div>
              <div style={{ fontFamily: FD, fontWeight: 600, color: T.ink }} className="text-sm tabular-nums">
                {Number(it.total_amount).toLocaleString()}₮
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-3 mt-2"
          style={{ borderTop: `2px solid ${T.border}` }}>
          <span style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-base">
            Нийт
          </span>
          <span style={{ fontFamily: FD, fontWeight: 700, color: T.highlight }} className="text-xl tabular-nums">
            {Number(order.total_amount).toLocaleString()}₮
          </span>
        </div>
      </div>

      {/* Notes */}
      {order.notes && (
        <div className="glass rounded-2xl p-4">
          <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider mb-2">
            Тэмдэглэл
          </div>
          <div style={{ fontFamily: FS, color: T.ink }} className="text-sm italic">
            "{order.notes}"
          </div>
        </div>
      )}

      {/* Actions */}
      {actions.length > 0 && (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${actions.length}, 1fr)` }}>
          {actions.map((a) => (
            <button key={a.action} onClick={() => {
              if (a.action === "cancelled" && !confirm("Захиалга цуцлах уу?")) return;
              onUpdateStatus(a.action);
            }}
              className="press-btn py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5"
              style={{
                background: a.action === "cancelled" ? T.errSoft : a.action === "delivered" ? "rgba(16,185,129,0.1)" : T.warnSoft,
                color: a.color, fontFamily: FS,
              }}>
              <span>{a.icon}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  CUSTOMERS VIEW — Үйлчлүүлэгч (дугаар бүртгэл)
// ═══════════════════════════════════════════════════════════════════════════
function CustomersView({ profile }) {
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | vip | regular | new
  const [editing, setEditing] = useState(null);
  const [activeCustomer, setActiveCustomer] = useState(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: custData }, { data: ordData }, { data: callData }] = await Promise.all([
        supabase.from("biz_customers").select("*").order("created_at", { ascending: true }),
        supabase.from("biz_orders").select("*").order("created_at", { ascending: false }),
        supabase.from("biz_calls").select("*").order("created_at", { ascending: false }),
      ]);
      setCustomers(custData || []);
      setOrders(ordData || []);
      setCalls(callData || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  // Statistic
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    return {
      total: customers.length,
      newThisWeek: customers.filter((c) => new Date(c.created_at) >= weekAgo).length,
      activeThisMonth: customers.filter((c) => c.last_order_at && new Date(c.last_order_at) >= monthAgo).length,
      vip: customers.filter((c) => (c.total_orders || 0) >= 5).length,
    };
  }, [customers]);

  // Categorize customers
  const categorize = (c) => {
    const orders = c.total_orders || 0;
    if (orders >= 5) return "vip";
    if (orders >= 2) return "regular";
    return "new";
  };

  // Filter
  let filtered = customers;
  if (filter !== "all") {
    filtered = filtered.filter((c) => categorize(c) === filter);
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter((c) =>
      c.phone?.includes(q) ||
      c.name?.toLowerCase().includes(q) ||
      c.address?.toLowerCase().includes(q)
    );
  }

  if (activeCustomer) {
    const customerOrders = orders.filter((o) => o.customer_id === activeCustomer.id);
    const customerCalls = calls.filter((c) => c.customer_id === activeCustomer.id || c.phone === activeCustomer.phone);
    const customerIndex = customers.findIndex((c) => c.id === activeCustomer.id);
    return (
      <CustomerDetail
        customer={activeCustomer}
        orders={customerOrders}
        calls={customerCalls}
        customerIndex={customerIndex + 1}
        onClose={() => setActiveCustomer(null)}
        onEdit={() => setEditing(activeCustomer)}
        onDelete={async () => {
          if (!confirm("Энэ үйлчлүүлэгчийг устгах уу?\n\nЗахиалгын түүх хэвээр үлдэнэ.")) return;
          await supabase.from("biz_customers").delete().eq("id", activeCustomer.id);
          setActiveCustomer(null);
          await loadAll();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Нийт дугаар</div>
          <div style={{ fontFamily: FD, fontWeight: 700, color: T.highlight }} className="text-3xl">
            {stats.total}
          </div>
        </div>
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Идэвхтэй (сард)</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.ok }} className="text-2xl">
            {stats.activeThisMonth}
          </div>
        </div>
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Шинэ (7 хоног)</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.warn }} className="text-2xl">
            +{stats.newThisWeek}
          </div>
        </div>
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">VIP (5+)</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.ink }} className="text-2xl flex items-center gap-1">
            🥇 {stats.vip}
          </div>
        </div>
      </div>

      {/* Filter + actions */}
      <div className="glass rounded-2xl p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: "all", label: "Бүх", icon: "👥" },
            { key: "vip", label: "VIP", icon: "🥇" },
            { key: "regular", label: "Тогтмол", icon: "⭐" },
            { key: "new", label: "Шинэ", icon: "🆕" },
          ].map((f) => {
            const count = f.key === "all" ? customers.length : customers.filter((c) => categorize(c) === f.key).length;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className="press-btn px-3 py-1.5 rounded-full text-xs flex items-center gap-1"
                style={{
                  background: filter === f.key ? T.highlight : T.surfaceAlt,
                  color: filter === f.key ? "white" : T.ink,
                  fontFamily: FS, fontWeight: 500,
                }}>
                <span>{f.icon}</span>
                <span>{f.label}</span>
                <span style={{
                  background: filter === f.key ? "rgba(255,255,255,0.2)" : T.surface,
                  color: filter === f.key ? "white" : T.muted,
                }} className="text-[9px] px-1.5 rounded-full ml-0.5">
                  {count}
                </span>
              </button>
            );
          })}
          <div className="flex-1" />
          <button onClick={() => setEditing({})}
            className="glow-primary press-btn px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1">
            <Plus size={12} /> Шинэ
          </button>
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Утас, нэр, хаягаар хайх..."
          style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
          className="w-full px-3 py-2 rounded-lg text-xs" />
      </div>

      {/* Customer list */}
      {loading ? (
        <div className="glass rounded-2xl p-8 text-center" style={{ color: T.muted, fontFamily: FS }}>
          <Loader2 className="spin mx-auto mb-2" size={20} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <div className="text-4xl mb-2">👥</div>
          <div style={{ color: T.muted, fontFamily: FS }} className="text-sm mb-3">
            {customers.length === 0 ? "Үйлчлүүлэгч хараахан байхгүй байна" : "Олдсонгүй"}
          </div>
          {customers.length === 0 && (
            <button onClick={() => setEditing({})}
              className="glow-primary press-btn px-4 py-2 rounded-full text-xs font-semibold">
              + Анхны үйлчлүүлэгч нэмэх
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const cat = categorize(c);
            const catInfo = {
              vip: { label: "VIP", color: T.highlight, bg: T.highlightSoft, icon: "🥇" },
              regular: { label: "Тогтмол", color: T.ok, bg: "rgba(16,185,129,0.1)", icon: "⭐" },
              new: { label: "Шинэ", color: T.warn, bg: T.warnSoft, icon: "🆕" },
            }[cat];

            return (
              <button key={c.id} onClick={() => setActiveCustomer(c)}
                className="glass lift rounded-xl p-3 w-full text-left">
                <div className="flex items-center gap-3">
                  <div style={{
                    background: catInfo.bg, color: catInfo.color,
                  }} className="w-10 h-10 rounded-full flex items-center justify-center text-base flex-shrink-0">
                    {catInfo.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm">
                        📱 {c.phone}
                      </span>
                      <span style={{
                        background: catInfo.bg, color: catInfo.color, fontFamily: FS, fontWeight: 600,
                      }} className="text-[9px] px-1.5 py-0.5 rounded-full">
                        {catInfo.label}
                      </span>
                    </div>
                    {c.name && (
                      <div style={{ color: T.ink, fontFamily: FS }} className="text-xs mt-0.5">
                        👤 {c.name}
                      </div>
                    )}
                    <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mt-0.5 flex flex-wrap gap-2">
                      <span>📦 {c.total_orders || 0} захиалга</span>
                      {Number(c.total_amount) > 0 && (
                        <span>💰 {Number(c.total_amount).toLocaleString()}₮</span>
                      )}
                      {c.last_order_at && (
                        <span>🕐 Сүүлд: {new Date(c.last_order_at).toLocaleDateString("mn-MN")}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {editing && (
        <CustomerFormModal
          customer={editing.id ? editing : null}
          onSave={async (data) => {
            try {
              if (editing.id) {
                await supabase.from("biz_customers").update({
                  ...data,
                  updated_at: new Date().toISOString(),
                }).eq("id", editing.id);
                if (activeCustomer?.id === editing.id) {
                  const { data: updated } = await supabase.from("biz_customers").select("*").eq("id", editing.id).single();
                  setActiveCustomer(updated);
                }
              } else {
                await supabase.from("biz_customers").insert(data);
              }
              setEditing(null);
              await loadAll();
            } catch (e) {
              if (e.message?.includes("duplicate") || e.message?.includes("unique")) {
                alert("Энэ утсан дугаар бүртгэлтэй байна!");
              } else {
                alert("Алдаа: " + e.message);
              }
            }
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CustomerFormModal({ customer, onSave, onClose }) {
  const [phone, setPhone] = useState(customer?.phone || "");
  const [name, setName] = useState(customer?.name || "");
  const [address, setAddress] = useState(customer?.address || "");
  const [notes, setNotes] = useState(customer?.notes || "");
  const [busy, setBusy] = useState(false);

  const inputStyle = { background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS };

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-content rounded-2xl w-full max-w-md p-5">
        <div className="flex items-start justify-between mb-3">
          <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-lg">
            👤 {customer ? "Үйлчлүүлэгч засах" : "Шинэ үйлчлүүлэгч"}
          </h3>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              📱 Утас *
            </label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="99887766"
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm"
              autoFocus disabled={!!customer} />
            {customer && (
              <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] mt-1">
                💡 Утас нь өөрчлөгдөхгүй
              </div>
            )}
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              👤 Нэр
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Овог нэр"
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              📍 Хаяг
            </label>
            <input value={address} onChange={(e) => setAddress(e.target.value)}
              placeholder="СБД 1-р хороо, 24-р байр..."
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              📝 Тэмдэглэл
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="VIP, аллерги, дуртай бараа..."
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm resize-none" />
          </div>

          <button
            disabled={busy || !phone.trim()}
            onClick={async () => {
              setBusy(true);
              await onSave({
                phone: phone.trim(),
                name: name.trim() || null,
                address: address.trim() || null,
                notes: notes.trim() || null,
              });
              setBusy(false);
            }}
            className="glow-primary press-btn w-full py-3 rounded-xl text-sm font-semibold">
            {busy ? "Хадгалаж..." : "Хадгалах"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CustomerDetail({ customer, orders, calls = [], customerIndex = 1, onClose, onEdit, onDelete }) {
  const totalOrders = orders.length;
  const totalCalls = calls.length;
  const totalAmount = orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + Number(o.total_amount || 0), 0);

  // Time ago format
  const timeAgo = (date) => {
    const diff = (Date.now() - new Date(date).getTime()) / 1000;
    if (diff < 60) return "одоо";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 30 * 86400) return `${Math.floor(diff / 86400)}d`;
    if (diff < 365 * 86400) return `${Math.floor(diff / (30 * 86400))}mo`;
    return `${Math.floor(diff / (365 * 86400))}y`;
  };

  // Бүх сонирхсон бараа цуглуулах
  const allInterestedProducts = useMemo(() => {
    const map = new Map();
    calls.forEach((c) => {
      if (c.interested_products && Array.isArray(c.interested_products)) {
        c.interested_products.forEach((p) => {
          const existing = map.get(p.id);
          if (existing) {
            existing.totalQty += (p.qty || 1);
            existing.lastDate = c.created_at;
          } else {
            map.set(p.id, {
              ...p,
              totalQty: p.qty || 1,
              lastDate: c.created_at,
            });
          }
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
  }, [calls]);

  // Status (active/inactive)
  const isActive = customer.last_order_at &&
    (Date.now() - new Date(customer.last_order_at).getTime()) < 30 * 86400 * 1000;
  const daysSinceCreate = (Date.now() - new Date(customer.created_at).getTime()) / 86400000;
  const isNew = daysSinceCreate < 7;

  return (
    <div className="space-y-3">
      {/* Тоq header */}
      <div className="glass rounded-2xl p-3 flex items-center gap-2 flex-wrap">
        <button onClick={onClose} className="press-btn p-1.5 rounded-lg" style={{ color: T.ink }}>
          ←
        </button>

        {/* #1 — number */}
        <div style={{ background: T.surfaceAlt, color: T.ink, fontFamily: FD, fontWeight: 700 }}
          className="px-2 py-1 rounded-lg text-xs">
          #{customerIndex}
        </div>

        <span style={{ color: T.muted }}>—</span>

        {/* Phone pill */}
        <a href={`tel:${customer.phone}`}
          className="press-btn flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
          style={{ background: T.highlight, color: "white", fontFamily: FS, fontWeight: 600 }}>
          <Phone size={11} /> {customer.phone}
        </a>

        {/* NEW pill */}
        {isNew && (
          <span style={{ background: "rgba(16,185,129,0.15)", color: T.ok, fontFamily: FS, fontWeight: 700 }}
            className="text-[10px] px-2 py-1 rounded-md tracking-wider">
            NEW
          </span>
        )}

        {/* Customer name pill */}
        {customer.name && (
          <span style={{ background: "rgba(168,85,247,0.15)", color: "#9333ea", fontFamily: FS, fontWeight: 600 }}
            className="text-[10px] px-2 py-1 rounded-md uppercase tracking-wider">
            {customer.name}
          </span>
        )}

        {/* Status pill */}
        <span style={{
          background: isActive ? "rgba(168,85,247,0.15)" : "rgba(148,163,184,0.2)",
          color: isActive ? "#9333ea" : T.muted,
          fontFamily: FS, fontWeight: 600,
        }} className="text-[10px] px-2 py-1 rounded-md">
          {isActive ? "Идэвхтэй" : "Идэвхгүй"}
        </span>

        {/* Created time */}
        <div className="flex items-center gap-1" style={{ color: T.muted, fontFamily: FM }}>
          <Clock size={11} />
          <span className="text-[11px]">Бүртгэгдсэн: {timeAgo(customer.created_at)}</span>
        </div>

        <div className="flex-1" />

        <button onClick={onEdit}
          style={{ background: "rgba(16,185,129,0.1)", color: T.ok, border: `1px solid rgba(16,185,129,0.2)` }}
          className="press-btn px-3 py-1.5 rounded-lg text-xs flex items-center gap-1">
          <Edit3 size={11} /> ─
        </button>
        <button onClick={onDelete}
          style={{ background: T.err, color: "white" }}
          className="press-btn px-3 py-1.5 rounded-lg text-xs flex items-center gap-1">
          <Trash2 size={11} /> Устгах
        </button>
      </div>

      {/* Sub-name */}
      {customer.name && (
        <div className="px-1">
          <span style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-base">
            {customer.name}
          </span>
        </div>
      )}

      {/* 2 column: Дуудлагын түүх + Сонирхсон бараа */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ЗҮҮН: Дуудлагын түүх */}
        <div className="glass rounded-2xl p-4">
          <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Phone size={11} /> Дуудлагын түүх ({totalCalls})
          </div>

          {calls.length === 0 ? (
            <div className="text-center py-12">
              <div style={{ color: T.mutedSoft, fontFamily: FS }} className="text-sm">
                Хоосон
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {calls.slice(0, 10).map((c) => (
                <div key={c.id} className="rounded-lg p-2.5"
                  style={{ background: T.surfaceAlt, border: `1px solid ${T.border}` }}>
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] mb-1">
                    🕐 {new Date(c.created_at).toLocaleString("mn-MN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  {c.notes && (
                    <div style={{ fontFamily: FS, color: T.ink }} className="text-xs italic">
                      "{c.notes}"
                    </div>
                  )}
                  {c.interested_products && Array.isArray(c.interested_products) && c.interested_products.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.interested_products.map((p, i) => (
                        <span key={i} style={{ background: T.surface, color: T.ink, fontFamily: FM }}
                          className="text-[9px] px-1.5 py-0.5 rounded-full">
                          {p.name}{p.qty > 1 ? ` ×${p.qty}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* БАРУУН: Сонирхсон бараа (нэгтгэсэн) */}
        <div className="glass rounded-2xl p-4">
          <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <ShoppingBag size={11} /> Сонирхсон бараа ({allInterestedProducts.length})
          </div>

          {allInterestedProducts.length === 0 ? (
            <div className="text-center py-12">
              <div style={{ color: T.mutedSoft, fontFamily: FS }} className="text-sm">
                Хоосон
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {allInterestedProducts.map((p) => (
                <div key={p.id} className="rounded-lg overflow-hidden"
                  style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                  <div className="flex items-center gap-1.5 p-2"
                    style={{ borderBottom: `1px solid ${T.border}` }}>
                    {p.sku && (
                      <span style={{ background: T.highlightSoft, color: T.highlight, fontFamily: FS, fontWeight: 600 }}
                        className="text-[9px] px-1.5 py-0.5 rounded">
                        {p.sku}
                      </span>
                    )}
                    <span style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6", fontFamily: FS, fontWeight: 600 }}
                      className="text-[9px] px-1.5 py-0.5 rounded">
                      Тайлбар
                    </span>
                  </div>
                  <div style={{ width: "100%", aspectRatio: "1", background: T.surfaceAlt }}>
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name}
                        style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    ) : (
                      <div style={{
                        width: "100%", height: "100%",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 40,
                      }}>📦</div>
                    )}
                  </div>
                  <div className="p-2">
                    <div style={{ fontFamily: FS, fontWeight: 500, color: T.ink }}
                      className="text-[11px] line-clamp-2 mb-1">
                      {p.name}
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ fontFamily: FD, fontWeight: 700, color: T.ink }} className="text-xs tabular-nums">
                        {p.price ? Number(p.price).toLocaleString() + "₮" : ""}
                      </span>
                      {p.totalQty > 0 && (
                        <span style={{ background: T.ok, color: "white", fontFamily: FD, fontWeight: 700 }}
                          className="text-[10px] px-1.5 py-0.5 rounded-full">
                          {p.totalQty}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stats summary */}
      {(totalOrders > 0 || totalAmount > 0) && (
        <div className="grid grid-cols-3 gap-2">
          <div className="glass rounded-xl p-3 text-center">
            <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Захиалга</div>
            <div style={{ fontFamily: FD, fontWeight: 700, color: T.highlight }} className="text-2xl">
              {totalOrders}
            </div>
          </div>
          <div className="glass rounded-xl p-3 text-center">
            <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Дуудлага</div>
            <div style={{ fontFamily: FD, fontWeight: 700, color: T.ok }} className="text-2xl">
              {totalCalls}
            </div>
          </div>
          <div className="glass rounded-xl p-3 text-center">
            <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Нийт зарцуулсан</div>
            <div style={{ fontFamily: FD, fontWeight: 700, color: T.ink }} className="text-base">
              {totalAmount > 0 ? Math.round(totalAmount).toLocaleString() + "₮" : "—"}
            </div>
          </div>
        </div>
      )}

      {/* Order history */}
      {orders.length > 0 && (
        <div>
          <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-2 px-1">
            Захиалгын түүх ({orders.length})
          </div>
          <div className="space-y-2">
            {orders.map((o) => (
              <OrderCard key={o.id} order={o} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  FACEBOOK PAGES VIEW — Маркетингийн source CRUD
// ═══════════════════════════════════════════════════════════════════════════
function FbPagesView({ profile }) {
  const [pages, setPages] = useState([]);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: pagesData }, { data: callsData }] = await Promise.all([
        supabase.from("biz_fb_pages").select("*").order("display_order").order("name"),
        supabase.from("biz_calls").select("fb_page_id, created_at"),
      ]);
      setPages(pagesData || []);
      setCalls(callsData || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  // Тус FB page бүрт ирсэн дуудлагын тоо
  const callsByPage = useMemo(() => {
    const map = {};
    calls.forEach((c) => {
      if (c.fb_page_id) map[c.fb_page_id] = (map[c.fb_page_id] || 0) + 1;
    });
    return map;
  }, [calls]);

  const totalCalls = calls.filter((c) => c.fb_page_id).length;
  const noPageCalls = calls.filter((c) => !c.fb_page_id).length;

  const handleDelete = async (id) => {
    if (!confirm("Энэ Facebook page-г устгах уу?\n\nДуудлагууд хэвээр үлдэнэ, харин page-тай холбоо алдагдана.")) return;
    await supabase.from("biz_fb_pages").delete().eq("id", id);
    await loadAll();
  };

  const toggleActive = async (page) => {
    await supabase.from("biz_fb_pages").update({ is_active: !page.is_active }).eq("id", page.id);
    await loadAll();
  };

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Нийт page</div>
          <div style={{ fontFamily: FD, fontWeight: 700, color: T.highlight }} className="text-3xl">
            {pages.length}
          </div>
        </div>
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Идэвхтэй</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.ok }} className="text-3xl">
            {pages.filter((p) => p.is_active).length}
          </div>
        </div>
        <div className="glass rounded-2xl p-3">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-wider">Нийт дуудлага</div>
          <div style={{ fontFamily: FD, fontWeight: 600, color: T.ink }} className="text-3xl">
            {totalCalls}
          </div>
        </div>
      </div>

      {/* Action */}
      <div className="flex justify-end">
        <button onClick={() => setEditing({})}
          className="glow-primary press-btn px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5">
          <Plus size={12} /> Шинэ Page
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="glass rounded-2xl p-8 text-center" style={{ color: T.muted, fontFamily: FS }}>
          <Loader2 className="spin mx-auto mb-2" size={20} />
        </div>
      ) : pages.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <div className="text-4xl mb-2">📘</div>
          <div style={{ color: T.muted, fontFamily: FS }} className="text-sm mb-3">
            Facebook page хараахан нэмэгдээгүй байна
          </div>
          <button onClick={() => setEditing({})}
            className="glow-primary press-btn px-4 py-2 rounded-full text-xs font-semibold">
            + Анхны page нэмэх
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {pages.map((p) => {
            const callCount = callsByPage[p.id] || 0;
            const percent = totalCalls > 0 ? (callCount / totalCalls) * 100 : 0;
            return (
              <div key={p.id} className="glass rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <div style={{
                    background: p.is_active ? "#1877f2" : T.surfaceAlt,
                    color: "white",
                  }} className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-base font-bold">
                    f
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm">
                        {p.name}
                      </span>
                      {!p.is_active && (
                        <span style={{ background: T.surfaceAlt, color: T.muted, fontFamily: FS }}
                          className="text-[9px] px-1.5 py-0.5 rounded-full font-medium">
                          ИДЭВХГҮЙ
                        </span>
                      )}
                      {p.is_active && (
                        <span style={{ background: "rgba(16,185,129,0.1)", color: T.ok, fontFamily: FS }}
                          className="text-[9px] px-1.5 py-0.5 rounded-full font-medium">
                          ИДЭВХТЭЙ
                        </span>
                      )}
                    </div>
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noopener noreferrer"
                        style={{ color: T.highlight, fontFamily: FM }}
                        className="text-[10px] hover:underline">
                        🔗 {p.url}
                      </a>
                    )}
                    {p.notes && (
                      <div style={{ color: T.muted, fontFamily: FS }} className="text-[11px] mt-0.5 italic">
                        "{p.notes}"
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] flex items-center gap-1">
                        📞 {callCount} дуудлага
                      </span>
                      {percent > 0 && (
                        <span style={{ color: T.highlight, fontFamily: FM, fontWeight: 600 }} className="text-[10px]">
                          {percent.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {totalCalls > 0 && (
                      <div className="mt-2" style={{ background: T.surfaceAlt, height: 4, borderRadius: 2 }}>
                        <div style={{
                          width: `${percent}%`,
                          height: "100%",
                          background: T.highlight,
                          borderRadius: 2,
                          transition: "width 0.5s",
                        }} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => toggleActive(p)}
                      style={{ color: p.is_active ? T.ok : T.muted }}
                      className="press-btn p-1.5 rounded-lg"
                      title={p.is_active ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}>
                      {p.is_active ? "✓" : "○"}
                    </button>
                    <button onClick={() => setEditing(p)}
                      style={{ color: T.muted }} className="press-btn p-1.5 rounded-lg">
                      <Edit3 size={12} />
                    </button>
                    <button onClick={() => handleDelete(p.id)}
                      style={{ color: T.err }} className="press-btn p-1.5 rounded-lg">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* No FB page calls */}
          {noPageCalls > 0 && (
            <div className="glass-soft rounded-xl p-3" style={{ border: `1px dashed ${T.border}` }}>
              <div style={{ color: T.muted, fontFamily: FS }} className="text-xs">
                💡 <span style={{ fontWeight: 600 }}>{noPageCalls} дуудлага</span> нь FB page-гүйгээр бүртгэгдсэн
              </div>
            </div>
          )}
        </div>
      )}

      {editing && (
        <FbPageFormModal
          page={editing.id ? editing : null}
          onSave={async (data) => {
            try {
              if (editing.id) {
                await supabase.from("biz_fb_pages").update(data).eq("id", editing.id);
              } else {
                await supabase.from("biz_fb_pages").insert(data);
              }
              setEditing(null);
              await loadAll();
            } catch (e) { alert("Алдаа: " + e.message); }
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function FbPageFormModal({ page, onSave, onClose }) {
  const [name, setName] = useState(page?.name || "");
  const [url, setUrl] = useState(page?.url || "");
  const [notes, setNotes] = useState(page?.notes || "");
  const [displayOrder, setDisplayOrder] = useState(page?.display_order || 0);
  const [isActive, setIsActive] = useState(page?.is_active !== false);
  const [busy, setBusy] = useState(false);

  const inputStyle = { background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS };

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-content rounded-2xl w-full max-w-md p-5">
        <div className="flex items-start justify-between mb-3">
          <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-lg flex items-center gap-2">
            <span style={{ background: "#1877f2", color: "white" }}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold">f</span>
            {page ? "Page засах" : "Шинэ Facebook Page"}
          </h3>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Page нэр *
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="ж.нь: Маркетинг, Худалдаа..."
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm"
              autoFocus />
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              🔗 URL (заавал биш)
            </label>
            <input value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://facebook.com/yourpage"
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              📝 Тэмдэглэл
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="..."
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm resize-none" />
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1 block">
              Дараалал
            </label>
            <input type="number" value={displayOrder}
              onChange={(e) => setDisplayOrder(Number(e.target.value) || 0)}
              placeholder="0"
              style={inputStyle} className="w-full px-3 py-2 rounded-lg text-sm tabular-nums" />
            <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] mt-1">
              💡 Бага тоо эхэнд харагдана
            </div>
          </div>

          <label className="flex items-center gap-2 press-btn p-2 rounded-lg cursor-pointer"
            style={{ background: isActive ? T.highlightSoft : T.surfaceAlt }}>
            <input type="checkbox" checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="cursor-pointer" />
            <span style={{ fontFamily: FS, fontWeight: 500, color: T.ink }} className="text-sm">
              Идэвхтэй (Дуудлага бүртгэхэд харагдана)
            </span>
          </label>

          <button
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              await onSave({
                name: name.trim(),
                url: url.trim() || null,
                notes: notes.trim() || null,
                display_order: displayOrder,
                is_active: isActive,
              });
              setBusy(false);
            }}
            className="glow-primary press-btn w-full py-3 rounded-xl text-sm font-semibold">
            {busy ? "Хадгалаж..." : "Хадгалах"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PollsView({ profile, isAdmin = false }) {
  const [polls, setPolls] = useState([]);
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const loadPolls = async () => {
    setLoading(true);
    try {
      const [{ data: pData }, { data: vData }] = await Promise.all([
        supabase.from("polls").select("*").order("created_at", { ascending: false }),
        supabase.from("poll_votes").select("*"),
      ]);
      setPolls(pData || []);
      setVotes(vData || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadPolls(); }, []);

  const myVote = (pollId) => votes.find((v) => v.poll_id === pollId && v.voter_id === profile.id);

  const handleVote = async (poll, optionIds) => {
    try {
      const existing = myVote(poll.id);
      if (existing) {
        await supabase.from("poll_votes").update({ option_ids: optionIds, voted_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await supabase.from("poll_votes").insert({ poll_id: poll.id, voter_id: profile.id, option_ids: optionIds });
      }
      await loadPolls();
    } catch (e) { alert("Алдаа: " + e.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Энэ санал асуулгыг устгах уу?")) return;
    await supabase.from("polls").delete().eq("id", id);
    await loadPolls();
  };

  const handleClose = async (id) => {
    await supabase.from("polls").update({ status: "closed" }).eq("id", id);
    await loadPolls();
  };

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex justify-end">
          <button onClick={() => setEditing({})}
            className="glow-primary press-btn px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5">
            <Plus size={12} /> Шинэ санал асуулга
          </button>
        </div>
      )}

      {loading ? (
        <div className="glass rounded-2xl p-8 text-center" style={{ color: T.muted, fontFamily: FS }}>
          <Loader2 className="spin mx-auto mb-2" size={20} />
        </div>
      ) : polls.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <div className="text-4xl mb-2">🗳</div>
          <div style={{ color: T.muted, fontFamily: FS }} className="text-sm">
            Идэвхтэй санал асуулга байхгүй байна
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {polls.map((poll) => {
            const pollVotes = votes.filter((v) => v.poll_id === poll.id);
            const my = myVote(poll.id);
            const isExpired = poll.expires_at && new Date(poll.expires_at) < new Date();
            const isClosed = poll.status === "closed" || isExpired;
            const totalVotes = pollVotes.length;

            // Count votes per option
            const counts = {};
            pollVotes.forEach((v) => {
              (v.option_ids || []).forEach((oid) => {
                counts[oid] = (counts[oid] || 0) + 1;
              });
            });

            return (
              <div key={poll.id} className="glass rounded-2xl p-4">
                <div className="flex items-start gap-2 mb-2">
                  <div style={{ background: "linear-gradient(135deg, #f97316, #ec4899)", color: "white" }}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0">
                    🗳
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm">
                          {poll.title}
                        </h3>
                        {poll.description && (
                          <p style={{ color: T.inkSoft, fontFamily: FS }} className="text-xs mt-0.5">
                            {poll.description}
                          </p>
                        )}
                      </div>
                      {isClosed && (
                        <span style={{ background: T.surfaceAlt, color: T.muted }}
                          className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap">
                          Хаагдсан
                        </span>
                      )}
                    </div>

                    <div className="mt-3 space-y-2">
                      {(poll.options || []).map((opt) => {
                        const cnt = counts[opt.id] || 0;
                        const pct = totalVotes ? Math.round((cnt / totalVotes) * 100) : 0;
                        const selected = (my?.option_ids || []).includes(opt.id);
                        const showResult = !!my || isClosed || isAdmin;

                        return (
                          <button
                            key={opt.id}
                            onClick={() => {
                              if (isClosed) return;
                              if (poll.multiple_choice) {
                                const current = my?.option_ids || [];
                                const newIds = current.includes(opt.id)
                                  ? current.filter((id) => id !== opt.id)
                                  : [...current, opt.id];
                                handleVote(poll, newIds);
                              } else {
                                handleVote(poll, [opt.id]);
                              }
                            }}
                            disabled={isClosed}
                            className="w-full text-left relative overflow-hidden rounded-lg"
                            style={{
                              background: showResult
                                ? `linear-gradient(to right, ${selected ? T.highlightSoft : T.surfaceAlt} 0%, ${selected ? T.highlightSoft : T.surfaceAlt} ${pct}%, ${T.surfaceGlass} ${pct}%, ${T.surfaceGlass} 100%)`
                                : T.surfaceAlt,
                              border: `1px solid ${selected ? T.highlight : T.borderSoft}`,
                              fontFamily: FS,
                              padding: "10px 12px",
                            }}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {selected && <CheckCircle2 size={14} style={{ color: T.highlight }} />}
                                <span style={{ color: T.ink, fontWeight: selected ? 600 : 400 }} className="text-sm truncate">
                                  {opt.text}
                                </span>
                              </div>
                              {showResult && (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span style={{ color: T.muted, fontFamily: FS }} className="text-[10px]">
                                    {cnt} саналт
                                  </span>
                                  <span style={{ color: selected ? T.highlight : T.inkSoft, fontFamily: FS, fontWeight: 600 }}
                                    className="text-xs">
                                    {pct}%
                                  </span>
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 mt-3 pt-2 border-t" style={{ borderColor: T.borderSoft, fontFamily: FS }}>
                      <span style={{ color: T.muted }} className="text-[10px]">
                        {totalVotes} нийт сонголт
                      </span>
                      {poll.multiple_choice && (
                        <span style={{ color: T.muted }} className="text-[10px]">
                          · Олон сонголт
                        </span>
                      )}
                      {poll.anonymous && (
                        <span style={{ color: T.muted }} className="text-[10px]">
                          · Нууц
                        </span>
                      )}
                      {poll.expires_at && (
                        <span style={{ color: isExpired ? T.err : T.muted }} className="text-[10px]">
                          · {isExpired ? "Дууссан" : `Дуусах: ${new Date(poll.expires_at).toLocaleDateString("mn-MN")}`}
                        </span>
                      )}
                      <div className="flex-1" />
                      {isAdmin && (
                        <>
                          {!isClosed && (
                            <button onClick={() => handleClose(poll.id)}
                              style={{ color: T.warn, fontFamily: FS }}
                              className="text-[10px] hover:underline">
                              Хаах
                            </button>
                          )}
                          <button onClick={() => handleDelete(poll.id)}
                            style={{ color: T.err, fontFamily: FS }}
                            className="text-[10px] hover:underline">
                            Устгах
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <PollFormModal
          poll={editing.id ? editing : null}
          profile={profile}
          onSave={async (data) => {
            try {
              if (editing.id) {
                await supabase.from("polls").update(data).eq("id", editing.id);
              } else {
                await supabase.from("polls").insert({ ...data, created_by: profile.id });
              }
              setEditing(null);
              await loadPolls();
            } catch (e) { alert("Алдаа: " + e.message); }
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PollFormModal({ poll, profile, onSave, onClose }) {
  const [title, setTitle] = useState(poll?.title || "");
  const [description, setDescription] = useState(poll?.description || "");
  const [options, setOptions] = useState(poll?.options || [
    { id: "1", text: "" },
    { id: "2", text: "" },
  ]);
  const [multipleChoice, setMultipleChoice] = useState(poll?.multiple_choice || false);
  const [anonymous, setAnonymous] = useState(poll?.anonymous || false);
  const [expiresAt, setExpiresAt] = useState(poll?.expires_at?.slice(0, 16) || "");
  const [busy, setBusy] = useState(false);

  const updateOption = (i, text) => {
    const newOpts = [...options];
    newOpts[i] = { ...newOpts[i], text };
    setOptions(newOpts);
  };

  const addOption = () => {
    setOptions([...options, { id: String(options.length + 1), text: "" }]);
  };

  const removeOption = (i) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, idx) => idx !== i));
  };

  const validOptions = options.filter((o) => o.text.trim());

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-content rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-lg">
            🗳 {poll ? "Засах" : "Шинэ санал асуулга"}
          </h3>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Гарчиг</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Жишээ: Дараагийн оффисын очих газар?"
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Тайлбар (заавал биш)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2}
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm resize-none" />
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-2 block">Сонголтууд</label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={opt.id} className="flex gap-1">
                  <input value={opt.text} onChange={(e) => updateOption(i, e.target.value)}
                    placeholder={`Сонголт ${i + 1}`}
                    style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
                    className="flex-1 px-3 py-2 rounded-lg text-sm" />
                  {options.length > 2 && (
                    <button onClick={() => removeOption(i)}
                      style={{ color: T.err }} className="press-btn p-2 rounded hover:bg-red-50">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addOption}
                className="press-btn w-full py-2 rounded-lg text-xs flex items-center justify-center gap-1 border-2 border-dashed"
                style={{ borderColor: T.border, color: T.muted, fontFamily: FS }}>
                <Plus size={12} /> Сонголт нэмэх
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={multipleChoice} onChange={(e) => setMultipleChoice(e.target.checked)} />
              <span style={{ color: T.ink, fontFamily: FS }} className="text-xs">Олон сонголт</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              <span style={{ color: T.ink, fontFamily: FS }} className="text-xs">Нууц</span>
            </label>
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Дуусах огноо (заавал биш)</label>
            <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>

          <button
            disabled={busy || !title || validOptions.length < 2}
            onClick={async () => {
              setBusy(true);
              await onSave({
                title,
                description: description || null,
                options: validOptions.map((o, i) => ({ id: String(i + 1), text: o.text })),
                multiple_choice: multipleChoice,
                anonymous,
                expires_at: expiresAt || null,
                status: "active",
              });
              setBusy(false);
            }}
            className="glow-primary press-btn w-full py-3 rounded-xl text-sm font-semibold">
            {busy ? "Хадгалаж..." : "Хадгалах"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  HR PERSONAL FILE — Дэлгэрэнгүй ажилтны мэдээлэл
// ═══════════════════════════════════════════════════════════════════════════
function HRPersonalFileView({ employees, profile, isAdmin = false, currentUserId = null }) {
  const [selectedEmpId, setSelectedEmpId] = useState(isAdmin ? "" : currentUserId);
  const [hrFile, setHrFile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadHrFile = async (empId) => {
    if (!empId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("hr_personal_files")
        .select("*")
        .eq("employee_id", empId)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      setHrFile(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (selectedEmpId) loadHrFile(selectedEmpId);
  }, [selectedEmpId]);

  const selectedEmp = employees.find((e) => e.id === selectedEmpId);

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="glass rounded-2xl p-3">
          <select value={selectedEmpId} onChange={(e) => setSelectedEmpId(e.target.value)}
            style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
            className="w-full px-3 py-2 rounded-lg text-sm">
            <option value="">— Ажилтан сонгох —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      )}

      {!selectedEmpId ? (
        <div className="glass rounded-2xl p-8 text-center">
          <div className="text-4xl mb-2">💼</div>
          <div style={{ color: T.muted, fontFamily: FS }} className="text-sm">
            Ажилтан сонгоно уу
          </div>
        </div>
      ) : loading ? (
        <div className="glass rounded-2xl p-8 text-center">
          <Loader2 className="spin mx-auto mb-2" size={20} />
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="glass-strong rounded-2xl p-5">
            <div className="flex items-start gap-4">
              <div style={{
                background: "linear-gradient(135deg, #f97316, #ec4899)",
                color: "white",
              }} className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold">
                {selectedEmp?.name?.[0]}
              </div>
              <div className="flex-1">
                <h2 style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-xl">
                  {selectedEmp?.name}
                </h2>
                <p style={{ color: T.muted, fontFamily: FS }} className="text-xs mt-0.5">
                  {selectedEmp?.job_title || "—"}
                </p>
                <p style={{ color: T.muted, fontFamily: FS }} className="text-[10px] mt-1">
                  {selectedEmp?.email}
                </p>
              </div>
              {isAdmin && (
                <button onClick={() => setEditing(true)}
                  className="glow-primary press-btn px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1">
                  <Edit3 size={12} /> Засах
                </button>
              )}
            </div>
          </div>

          {!hrFile && (
            <div className="glass rounded-2xl p-8 text-center">
              <div className="text-3xl mb-2">📋</div>
              <div style={{ color: T.muted, fontFamily: FS }} className="text-sm mb-3">
                HR файл хараахан үүсгэгдээгүй байна
              </div>
              {isAdmin && (
                <button onClick={() => setEditing(true)}
                  className="glow-primary press-btn px-4 py-2 rounded-full text-xs font-semibold">
                  + Үүсгэх
                </button>
              )}
            </div>
          )}

          {hrFile && (
            <>
              {/* Personal Info */}
              <div className="glass rounded-2xl p-4">
                <h3 style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm mb-3 flex items-center gap-2">
                  👤 Хувийн мэдээлэл
                </h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <FieldRow label="Бүтэн нэр" value={hrFile.full_name} />
                  <FieldRow label="Регистр" value={hrFile.national_id} />
                  <FieldRow label="Төрсөн огноо" value={hrFile.birth_date ? new Date(hrFile.birth_date).toLocaleDateString("mn-MN") : null} />
                  <FieldRow label="Хүйс" value={hrFile.gender === "male" ? "Эр" : hrFile.gender === "female" ? "Эм" : hrFile.gender} />
                  <FieldRow label="Утас" value={hrFile.phone} />
                  <FieldRow label="Гэр бүл" value={hrFile.marital_status === "single" ? "Гэрлээгүй" : hrFile.marital_status === "married" ? "Гэрлэсэн" : hrFile.marital_status} />
                  <FieldRow label="Хүүхдийн тоо" value={hrFile.children_count} />
                  <FieldRow label="Хаяг" value={hrFile.address} fullWidth />
                </div>
              </div>

              {/* Emergency Contact */}
              {(hrFile.emergency_contact_name || hrFile.emergency_contact_phone) && (
                <div className="glass rounded-2xl p-4">
                  <h3 style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm mb-3 flex items-center gap-2">
                    🚨 Яаралтай үед холбоо барих
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <FieldRow label="Нэр" value={hrFile.emergency_contact_name} />
                    <FieldRow label="Утас" value={hrFile.emergency_contact_phone} />
                  </div>
                </div>
              )}

              {/* Education */}
              {(hrFile.education || hrFile.university) && (
                <div className="glass rounded-2xl p-4">
                  <h3 style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm mb-3 flex items-center gap-2">
                    🎓 Боловсрол
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <FieldRow label="Боловсрол" value={hrFile.education} />
                    <FieldRow label="Их сургууль" value={hrFile.university} />
                    <FieldRow label="Төгссөн жил" value={hrFile.graduation_year} />
                  </div>
                </div>
              )}

              {/* Work Info */}
              <div className="glass rounded-2xl p-4">
                <h3 style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm mb-3 flex items-center gap-2">
                  💼 Ажлын мэдээлэл
                </h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <FieldRow label="Орсон огноо" value={hrFile.hire_date ? new Date(hrFile.hire_date).toLocaleDateString("mn-MN") : null} />
                  <FieldRow label="Гэрээний төгсгөл" value={hrFile.contract_end_date ? new Date(hrFile.contract_end_date).toLocaleDateString("mn-MN") : null} />
                  <FieldRow label="Гэрээний төрөл" value={hrFile.contract_type === "full_time" ? "Бүтэн цаг" : hrFile.contract_type === "part_time" ? "Хагас цаг" : hrFile.contract_type} />
                  <FieldRow label="Банк" value={hrFile.bank_name} />
                  <FieldRow label="Дансны дугаар" value={hrFile.bank_account} fullWidth />
                </div>
              </div>

              {hrFile.notes && (
                <div className="glass rounded-2xl p-4">
                  <h3 style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm mb-2">📝 Тэмдэглэл</h3>
                  <p style={{ color: T.inkSoft, fontFamily: FS }} className="text-xs whitespace-pre-wrap">
                    {hrFile.notes}
                  </p>
                </div>
              )}
            </>
          )}

          {editing && isAdmin && (
            <HRFileFormModal
              hrFile={hrFile}
              employee={selectedEmp}
              currentUserId={profile.id}
              onSave={async (data) => {
                try {
                  if (hrFile?.id) {
                    await supabase.from("hr_personal_files").update({ ...data, updated_at: new Date().toISOString(), updated_by: profile.id }).eq("id", hrFile.id);
                  } else {
                    await supabase.from("hr_personal_files").insert({ ...data, employee_id: selectedEmpId, updated_by: profile.id });
                  }
                  setEditing(false);
                  await loadHrFile(selectedEmpId);
                } catch (e) { alert("Алдаа: " + e.message); }
              }}
              onClose={() => setEditing(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

function FieldRow({ label, value, fullWidth }) {
  return (
    <div style={fullWidth ? { gridColumn: "1 / -1" } : {}}>
      <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-0.5">
        {label}
      </div>
      <div style={{ color: T.ink, fontFamily: FS }} className="text-sm">
        {value || <span style={{ color: T.mutedSoft }}>—</span>}
      </div>
    </div>
  );
}

function HRFileFormModal({ hrFile, employee, currentUserId, onSave, onClose }) {
  const [data, setData] = useState({
    full_name: hrFile?.full_name || employee?.name || "",
    birth_date: hrFile?.birth_date || "",
    gender: hrFile?.gender || "",
    national_id: hrFile?.national_id || "",
    phone: hrFile?.phone || "",
    emergency_contact_name: hrFile?.emergency_contact_name || "",
    emergency_contact_phone: hrFile?.emergency_contact_phone || "",
    address: hrFile?.address || "",
    marital_status: hrFile?.marital_status || "",
    children_count: hrFile?.children_count || 0,
    education: hrFile?.education || "",
    university: hrFile?.university || "",
    graduation_year: hrFile?.graduation_year || "",
    hire_date: hrFile?.hire_date || "",
    contract_end_date: hrFile?.contract_end_date || "",
    contract_type: hrFile?.contract_type || "",
    bank_name: hrFile?.bank_name || "",
    bank_account: hrFile?.bank_account || "",
    notes: hrFile?.notes || "",
  });
  const [busy, setBusy] = useState(false);

  const upd = (field, value) => setData({ ...data, [field]: value });

  const inputStyle = { background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS };
  const inputClass = "w-full px-3 py-2 rounded-lg text-sm";

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-content rounded-2xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-lg">
            💼 HR файл засах
          </h3>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        {/* Personal */}
        <div className="mb-4">
          <h4 style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-2">👤 Хувийн</h4>
          <div className="grid grid-cols-2 gap-2">
            <input value={data.full_name} onChange={(e) => upd("full_name", e.target.value)} placeholder="Бүтэн нэр" style={inputStyle} className={inputClass} />
            <input value={data.national_id} onChange={(e) => upd("national_id", e.target.value)} placeholder="Регистр" style={inputStyle} className={inputClass} />
            <input type="date" value={data.birth_date} onChange={(e) => upd("birth_date", e.target.value)} placeholder="Төрсөн огноо" style={inputStyle} className={inputClass} />
            <select value={data.gender} onChange={(e) => upd("gender", e.target.value)} style={inputStyle} className={inputClass}>
              <option value="">— Хүйс —</option>
              <option value="male">Эр</option>
              <option value="female">Эм</option>
              <option value="other">Бусад</option>
            </select>
            <input value={data.phone} onChange={(e) => upd("phone", e.target.value)} placeholder="Утас" style={inputStyle} className={inputClass} />
            <select value={data.marital_status} onChange={(e) => upd("marital_status", e.target.value)} style={inputStyle} className={inputClass}>
              <option value="">— Гэр бүлийн байдал —</option>
              <option value="single">Гэрлээгүй</option>
              <option value="married">Гэрлэсэн</option>
              <option value="divorced">Салсан</option>
              <option value="widowed">Бэлэвсэн</option>
            </select>
            <input type="number" value={data.children_count} onChange={(e) => upd("children_count", Number(e.target.value))} placeholder="Хүүхдийн тоо" style={inputStyle} className={inputClass} />
            <input value={data.address} onChange={(e) => upd("address", e.target.value)} placeholder="Хаяг" style={inputStyle} className={`${inputClass} col-span-2`} />
          </div>
        </div>

        {/* Emergency */}
        <div className="mb-4">
          <h4 style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-2">🚨 Яаралтай</h4>
          <div className="grid grid-cols-2 gap-2">
            <input value={data.emergency_contact_name} onChange={(e) => upd("emergency_contact_name", e.target.value)} placeholder="Нэр" style={inputStyle} className={inputClass} />
            <input value={data.emergency_contact_phone} onChange={(e) => upd("emergency_contact_phone", e.target.value)} placeholder="Утас" style={inputStyle} className={inputClass} />
          </div>
        </div>

        {/* Education */}
        <div className="mb-4">
          <h4 style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-2">🎓 Боловсрол</h4>
          <div className="grid grid-cols-2 gap-2">
            <input value={data.education} onChange={(e) => upd("education", e.target.value)} placeholder="Боловсрол (ж.нь Бакалавр)" style={inputStyle} className={inputClass} />
            <input value={data.university} onChange={(e) => upd("university", e.target.value)} placeholder="Их сургууль" style={inputStyle} className={inputClass} />
            <input type="number" value={data.graduation_year} onChange={(e) => upd("graduation_year", e.target.value)} placeholder="Төгссөн жил" style={inputStyle} className={inputClass} />
          </div>
        </div>

        {/* Work */}
        <div className="mb-4">
          <h4 style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-2">💼 Ажил</h4>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={data.hire_date} onChange={(e) => upd("hire_date", e.target.value)} placeholder="Орсон огноо" style={inputStyle} className={inputClass} />
            <input type="date" value={data.contract_end_date} onChange={(e) => upd("contract_end_date", e.target.value)} placeholder="Гэрээний төгсгөл" style={inputStyle} className={inputClass} />
            <select value={data.contract_type} onChange={(e) => upd("contract_type", e.target.value)} style={inputStyle} className={inputClass}>
              <option value="">— Гэрээний төрөл —</option>
              <option value="full_time">Бүтэн цаг</option>
              <option value="part_time">Хагас цаг</option>
              <option value="contract">Гэрээт</option>
            </select>
            <input value={data.bank_name} onChange={(e) => upd("bank_name", e.target.value)} placeholder="Банк" style={inputStyle} className={inputClass} />
            <input value={data.bank_account} onChange={(e) => upd("bank_account", e.target.value)} placeholder="Дансны дугаар" style={inputStyle} className={`${inputClass} col-span-2`} />
          </div>
        </div>

        <textarea value={data.notes} onChange={(e) => upd("notes", e.target.value)}
          rows={3}
          placeholder="Тэмдэглэл..."
          style={inputStyle} className={`${inputClass} resize-none mb-3`} />

        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onSave({
              ...data,
              children_count: Number(data.children_count) || 0,
              graduation_year: Number(data.graduation_year) || null,
              birth_date: data.birth_date || null,
              hire_date: data.hire_date || null,
              contract_end_date: data.contract_end_date || null,
            });
            setBusy(false);
          }}
          className="glow-primary press-btn w-full py-3 rounded-xl text-sm font-semibold">
          {busy ? "Хадгалаж..." : "Хадгалах"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  CALENDAR VIEW — Чөлөөг календар дээр харах
// ═══════════════════════════════════════════════════════════════════════════
function CalendarView({ leaves = [], employees = [], scope = "all", currentUserId = null }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const filteredLeaves = useMemo(() => {
    let result = leaves.filter((l) => l.status === "approved");
    if (scope === "self" && currentUserId) {
      result = result.filter((l) => l.employee_id === currentUserId);
    }
    return result;
  }, [leaves, scope, currentUserId]);

  // Build calendar grid
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Mon=0
  const daysInMonth = lastDay.getDate();

  // Group leaves by date
  const leavesByDate = useMemo(() => {
    const map = {};
    filteredLeaves.forEach((l) => {
      const key = l.leave_date;
      if (!map[key]) map[key] = [];
      map[key].push(l);
    });
    return map;
  }, [filteredLeaves]);

  const monthNames = ["1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар",
                      "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар"];
  const weekdayNames = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(d);
  }

  const empById = (id) => employees.find((e) => e.id === id);

  const goPrev = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const goNext = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="glass rounded-2xl p-3 flex items-center gap-2">
        <button onClick={goPrev} className="press-btn p-1.5 rounded-lg hover:bg-black/5"
          style={{ color: T.ink }}>
          ←
        </button>
        <div style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-base flex-1 text-center">
          {monthNames[month]} {year}
        </div>
        <button onClick={goNext} className="press-btn p-1.5 rounded-lg hover:bg-black/5"
          style={{ color: T.ink }}>
          →
        </button>
        <button onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}
          className="press-btn px-3 py-1.5 rounded-lg text-xs"
          style={{ background: T.surfaceAlt, color: T.ink, fontFamily: FS, fontWeight: 500 }}>
          Өнөөдөр
        </button>
      </div>

      {/* Calendar grid */}
      <div className="glass rounded-2xl p-3">
        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekdayNames.map((wd, i) => (
            <div key={i} style={{
              fontFamily: FS, fontWeight: 600,
              color: i >= 5 ? T.err : T.muted,
            }} className="text-[10px] text-center py-1.5 uppercase tracking-wider">
              {wd}
            </div>
          ))}
        </div>

        {/* Days */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />;
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const dayLeaves = leavesByDate[dateStr] || [];
            const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
            const dayOfWeek = new Date(year, month, d).getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            return (
              <div key={i} style={{
                background: isToday ? T.highlightSoft : "transparent",
                border: isToday ? `1.5px solid ${T.highlight}` : `1px solid ${T.borderSoft}`,
                minHeight: 64,
              }} className="rounded-lg p-1.5 relative">
                <div style={{
                  fontFamily: FS, fontWeight: isToday ? 700 : 500,
                  color: isToday ? T.highlight : isWeekend ? T.err : T.ink,
                }} className="text-xs">
                  {d}
                </div>
                {dayLeaves.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {dayLeaves.slice(0, 2).map((l, j) => {
                      const emp = empById(l.employee_id);
                      return (
                        <div key={j} style={{
                          background: l.leave_type === "sick" ? T.errSoft : T.highlightSoft,
                          color: l.leave_type === "sick" ? T.err : T.highlight,
                        }} className="text-[9px] px-1 py-0.5 rounded truncate"
                          title={`${emp?.name || "—"} (${l.leave_type === "sick" ? "Өвчтэй" : "Чөлөө"})`}>
                          {emp?.name?.split(" ")[0] || "—"}
                        </div>
                      );
                    })}
                    {dayLeaves.length > 2 && (
                      <div style={{ color: T.muted, fontFamily: FS }}
                        className="text-[9px] px-1">
                        +{dayLeaves.length - 2}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="glass rounded-xl p-3 flex flex-wrap items-center gap-3 text-[10px]" style={{ fontFamily: FS, color: T.inkSoft }}>
        <div className="flex items-center gap-1.5">
          <div style={{ background: T.highlightSoft, border: `1px solid ${T.highlight}` }} className="w-3 h-3 rounded" />
          <span>Өнөөдөр</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div style={{ background: T.highlightSoft, color: T.highlight }} className="w-3 h-3 rounded text-[8px] flex items-center justify-center font-bold">A</div>
          <span>Чөлөө</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div style={{ background: T.errSoft, color: T.err }} className="w-3 h-3 rounded text-[8px] flex items-center justify-center font-bold">B</div>
          <span>Өвчтэй</span>
        </div>
        <div className="flex-1" />
        <div style={{ color: T.muted }}>{filteredLeaves.length} нийт чөлөө</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SKILLS VIEW — Ажилтны ур чадвар + сургалт
// ═══════════════════════════════════════════════════════════════════════════
function SkillsView({ employees, isAdmin = false, currentUserId = null }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingSkill, setEditingSkill] = useState(null);
  const [filterEmpId, setFilterEmpId] = useState(isAdmin ? "all" : currentUserId);

  const loadSkills = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("skills").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      setSkills(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadSkills(); }, []);

  const filtered = filterEmpId === "all"
    ? skills
    : skills.filter((s) => s.employee_id === filterEmpId);

  const empById = (id) => employees.find((e) => e.id === id);

  const levelColors = {
    beginner: { bg: "rgba(148,163,184,0.15)", color: "#475569", label: "Анхан" },
    intermediate: { bg: "rgba(251,191,36,0.15)", color: "#b45309", label: "Дунд" },
    advanced: { bg: "rgba(16,185,129,0.15)", color: "#047857", label: "Гүнзгий" },
    expert: { bg: "rgba(236,72,153,0.15)", color: "#be185d", label: "Эксперт" },
  };

  const handleDelete = async (id) => {
    if (!confirm("Энэ ур чадварыг устгах уу?")) return;
    await supabase.from("skills").delete().eq("id", id);
    await loadSkills();
  };

  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl p-3 flex flex-wrap gap-2 items-center">
        {isAdmin && (
          <select value={filterEmpId} onChange={(e) => setFilterEmpId(e.target.value)}
            style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS, padding: "6px 10px", borderRadius: 8 }}
            className="text-sm">
            <option value="all">Бүх ажилтан</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
        <div className="flex-1" />
        {isAdmin && (
          <button onClick={() => setEditingSkill({})}
            className="glow-primary press-btn px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1">
            <Plus size={12} /> Нэмэх
          </button>
        )}
      </div>

      {loading ? (
        <div className="glass rounded-2xl p-8 text-center" style={{ color: T.muted, fontFamily: FS }}>
          <Loader2 className="spin mx-auto mb-2" size={20} />
          Ачааллаж байна...
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <div className="text-3xl mb-2">🎓</div>
          <div style={{ color: T.muted, fontFamily: FS }} className="text-sm">
            Ур чадвар бүртгэгдээгүй байна
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.map((s) => {
            const emp = empById(s.employee_id);
            const lvl = levelColors[s.level] || levelColors.beginner;
            return (
              <div key={s.id} className="glass lift rounded-xl p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm truncate">
                      {s.name}
                    </div>
                    {emp && (
                      <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px] mt-0.5">
                        {emp.name}
                      </div>
                    )}
                  </div>
                  <div style={{ background: lvl.bg, color: lvl.color, fontFamily: FS, fontWeight: 600 }}
                    className="text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap">
                    {lvl.label}
                  </div>
                </div>
                {s.category && (
                  <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px] mb-1">
                    📂 {s.category}
                  </div>
                )}
                {s.obtained_date && (
                  <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px]">
                    📅 {new Date(s.obtained_date).toLocaleDateString("mn-MN")}
                  </div>
                )}
                {s.notes && (
                  <div style={{ color: T.inkSoft, fontFamily: FS }} className="text-[11px] mt-2 italic">
                    "{s.notes}"
                  </div>
                )}
                {isAdmin && (
                  <div className="flex gap-1 mt-2 pt-2 border-t" style={{ borderColor: T.borderSoft }}>
                    <button onClick={() => setEditingSkill(s)}
                      className="press-btn flex-1 py-1 rounded text-[10px]"
                      style={{ background: T.surfaceAlt, color: T.inkSoft, fontFamily: FS }}>
                      Засах
                    </button>
                    <button onClick={() => handleDelete(s.id)}
                      className="press-btn flex-1 py-1 rounded text-[10px]"
                      style={{ background: T.errSoft, color: T.err, fontFamily: FS }}>
                      Устгах
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editingSkill && (
        <SkillFormModal
          skill={editingSkill.id ? editingSkill : null}
          employees={employees}
          onSave={async (data) => {
            try {
              if (editingSkill.id) {
                await supabase.from("skills").update(data).eq("id", editingSkill.id);
              } else {
                await supabase.from("skills").insert(data);
              }
              setEditingSkill(null);
              await loadSkills();
            } catch (e) { alert("Алдаа: " + e.message); }
          }}
          onClose={() => setEditingSkill(null)}
        />
      )}
    </div>
  );
}

function SkillFormModal({ skill, employees, onSave, onClose }) {
  const [employeeId, setEmployeeId] = useState(skill?.employee_id || "");
  const [name, setName] = useState(skill?.name || "");
  const [level, setLevel] = useState(skill?.level || "beginner");
  const [category, setCategory] = useState(skill?.category || "");
  const [obtainedDate, setObtainedDate] = useState(skill?.obtained_date || "");
  const [notes, setNotes] = useState(skill?.notes || "");
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-content rounded-2xl w-full max-w-md p-5">
        <div className="flex items-start justify-between mb-3">
          <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-lg">
            🎓 {skill ? "Засах" : "Шинэ ур чадвар"}
          </h3>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Ажилтан</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm">
              <option value="">— Сонгох —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Ур чадвар</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="ж.нь: React, Англи хэл, Менежмент..."
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Түвшин</label>
              <select value={level} onChange={(e) => setLevel(e.target.value)}
                style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
                className="w-full px-3 py-2 rounded-lg text-sm">
                <option value="beginner">Анхан</option>
                <option value="intermediate">Дунд</option>
                <option value="advanced">Гүнзгий</option>
                <option value="expert">Эксперт</option>
              </select>
            </div>
            <div>
              <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Авсан огноо</label>
              <input type="date" value={obtainedDate} onChange={(e) => setObtainedDate(e.target.value)}
                style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
                className="w-full px-3 py-2 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Ангилал</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)}
              placeholder="ж.нь: Програмчлал, Хэл, Менежмент"
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Тэмдэглэл</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm resize-none" />
          </div>

          <button
            disabled={busy || !employeeId || !name}
            onClick={async () => {
              setBusy(true);
              await onSave({
                employee_id: employeeId,
                name,
                level,
                category: category || null,
                obtained_date: obtainedDate || null,
                notes: notes || null,
              });
              setBusy(false);
            }}
            className="glow-primary press-btn w-full py-2.5 rounded-xl text-sm font-semibold">
            {busy ? "Хадгалаж байна..." : "Хадгалах"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCHEDULE VIEW — Долоо хоногийн ажилтны хуваарь
// ═══════════════════════════════════════════════════════════════════════════
function ScheduleView({ employees, sites, isAdmin = false, currentUserId = null }) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  });
  const [editing, setEditing] = useState(null);

  const loadSchedules = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("work_schedules")
        .select("*")
        .eq("week_start", weekStart);
      if (error) throw error;
      setSchedules(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadSchedules(); }, [weekStart]);

  const visibleEmployees = isAdmin
    ? employees
    : employees.filter((e) => e.id === currentUserId);

  const dayNames = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

  const getCell = (empId, dayOfWeek) => {
    return schedules.find((s) => s.employee_id === empId && s.day_of_week === dayOfWeek);
  };

  const goPrev = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };
  const goNext = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  // Long week dates
  const weekDates = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const handleSave = async (data) => {
    try {
      const existing = schedules.find((s) =>
        s.employee_id === data.employee_id && s.day_of_week === data.day_of_week
      );
      if (existing) {
        await supabase.from("work_schedules").update(data).eq("id", existing.id);
      } else {
        await supabase.from("work_schedules").insert({ ...data, week_start: weekStart });
      }
      setEditing(null);
      await loadSchedules();
    } catch (e) { alert("Алдаа: " + e.message); }
  };

  const handleDelete = async (cell) => {
    if (!confirm("Устгах уу?")) return;
    await supabase.from("work_schedules").delete().eq("id", cell.id);
    await loadSchedules();
  };

  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl p-3 flex items-center gap-2">
        <button onClick={goPrev} className="press-btn p-1.5 rounded-lg hover:bg-black/5"
          style={{ color: T.ink }}>←</button>
        <div style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-sm flex-1 text-center">
          {weekDates[0].toLocaleDateString("mn-MN", { day: "numeric", month: "short" })}
          {" — "}
          {weekDates[6].toLocaleDateString("mn-MN", { day: "numeric", month: "short", year: "numeric" })}
        </div>
        <button onClick={goNext} className="press-btn p-1.5 rounded-lg hover:bg-black/5"
          style={{ color: T.ink }}>→</button>
        <button onClick={() => {
          const d = new Date();
          const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
          d.setDate(d.getDate() - day);
          setWeekStart(d.toISOString().slice(0, 10));
        }}
          className="press-btn px-3 py-1.5 rounded-lg text-xs"
          style={{ background: T.surfaceAlt, color: T.ink, fontFamily: FS, fontWeight: 500 }}>
          Энэ долоо хоног
        </button>
      </div>

      {loading ? (
        <div className="glass rounded-2xl p-8 text-center" style={{ color: T.muted, fontFamily: FS }}>
          <Loader2 className="spin mx-auto mb-2" size={20} />
        </div>
      ) : (
        <div className="glass rounded-2xl p-3 overflow-x-auto">
          <table className="w-full" style={{ minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ fontFamily: FS, color: T.muted, fontWeight: 500, textAlign: "left" }}
                    className="text-[10px] uppercase tracking-wider pb-2 px-1">
                  Ажилтан
                </th>
                {dayNames.map((dn, i) => (
                  <th key={i} style={{
                    fontFamily: FS, fontWeight: 500,
                    color: i >= 5 ? T.err : T.muted,
                  }} className="text-[10px] uppercase tracking-wider pb-2 px-1 text-center">
                    {dn}
                    <div className="text-[9px] mt-0.5">{weekDates[i].getDate()}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((emp) => (
                <tr key={emp.id}>
                  <td style={{ fontFamily: FS, fontWeight: 500, color: T.ink }}
                      className="text-xs py-2 px-1 whitespace-nowrap">
                    {emp.name}
                  </td>
                  {[1,2,3,4,5,6,7].map((day) => {
                    const cell = getCell(emp.id, day);
                    const hasShift = !!cell?.shift_start;
                    return (
                      <td key={day} className="px-0.5 py-1 text-center">
                        <button
                          onClick={() => isAdmin && setEditing({ employee_id: emp.id, day_of_week: day, ...cell })}
                          disabled={!isAdmin}
                          style={{
                            background: hasShift
                              ? (cell.status === "absent" ? T.errSoft : cell.status === "leave" ? T.warnSoft : T.highlightSoft)
                              : T.surfaceAlt,
                            color: hasShift
                              ? (cell.status === "absent" ? T.err : cell.status === "leave" ? T.warn : T.highlight)
                              : T.muted,
                            fontFamily: FS,
                            fontWeight: 600,
                            cursor: isAdmin ? "pointer" : "default",
                          }}
                          className={`w-full py-1.5 rounded text-[10px] ${isAdmin ? "hover:opacity-80" : ""}`}>
                          {hasShift ? `${cell.shift_start.slice(0, 5)}` : "—"}
                          {hasShift && (
                            <div className="text-[8px] opacity-75">
                              {cell.shift_end?.slice(0, 5)}
                            </div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="glass rounded-xl p-3 flex flex-wrap items-center gap-3 text-[10px]" style={{ fontFamily: FS, color: T.inkSoft }}>
        <div className="flex items-center gap-1.5">
          <div style={{ background: T.highlightSoft }} className="w-3 h-3 rounded" />
          <span>Хуваарьт ажил</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div style={{ background: T.errSoft }} className="w-3 h-3 rounded" />
          <span>Ирээгүй</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div style={{ background: T.warnSoft }} className="w-3 h-3 rounded" />
          <span>Чөлөө</span>
        </div>
        <div className="flex-1" />
        {isAdmin && <span style={{ color: T.muted }}>Cell дарж засна</span>}
      </div>

      {editing && (
        <ScheduleFormModal
          schedule={editing}
          sites={sites}
          employee={employees.find((e) => e.id === editing.employee_id)}
          onSave={handleSave}
          onDelete={editing.id ? () => handleDelete(editing) : null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ScheduleFormModal({ schedule, sites, employee, onSave, onDelete, onClose }) {
  const [shiftStart, setShiftStart] = useState(schedule?.shift_start?.slice(0, 5) || "09:00");
  const [shiftEnd, setShiftEnd] = useState(schedule?.shift_end?.slice(0, 5) || "18:00");
  const [breakMinutes, setBreakMinutes] = useState(schedule?.break_minutes ?? 60);
  const [siteId, setSiteId] = useState(schedule?.site_id || "");
  const [status, setStatus] = useState(schedule?.status || "scheduled");
  const [notes, setNotes] = useState(schedule?.notes || "");
  const [busy, setBusy] = useState(false);

  const dayNames = ["", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба", "Ням"];

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-content rounded-2xl w-full max-w-md p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-base">
              🕐 {dayNames[schedule.day_of_week]}
            </h3>
            <p style={{ color: T.muted, fontFamily: FS }} className="text-xs">
              {employee?.name}
            </p>
          </div>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Эхлэх</label>
              <input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)}
                style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
                className="w-full px-3 py-2 rounded-lg text-sm" />
            </div>
            <div>
              <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Дуусах</label>
              <input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)}
                style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
                className="w-full px-3 py-2 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Завсарлага (мин)</label>
            <input type="number" value={breakMinutes} onChange={(e) => setBreakMinutes(Number(e.target.value))}
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Ажлын байр</label>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm">
              <option value="">— Сонгох —</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Төлөв</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm">
              <option value="scheduled">Хуваарьт</option>
              <option value="confirmed">Баталсан</option>
              <option value="absent">Ирээгүй</option>
              <option value="leave">Чөлөө</option>
            </select>
          </div>

          <div>
            <label style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mb-1 block">Тэмдэглэл</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS }}
              className="w-full px-3 py-2 rounded-lg text-sm" />
          </div>

          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onSave({
                  employee_id: schedule.employee_id,
                  day_of_week: schedule.day_of_week,
                  shift_start: shiftStart,
                  shift_end: shiftEnd,
                  break_minutes: breakMinutes,
                  site_id: siteId || null,
                  status,
                  notes: notes || null,
                });
                setBusy(false);
              }}
              className="glow-primary press-btn flex-1 py-2.5 rounded-xl text-sm font-semibold">
              {busy ? "Хадгалаж..." : "Хадгалах"}
            </button>
            {onDelete && (
              <button onClick={onDelete}
                className="glow-danger press-btn py-2.5 px-4 rounded-xl text-sm font-semibold">
                Устгах
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BestEmployeeView({ employees, sessions, kpiEntries, leaves }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const ranked = useMemo(() => {
    return calculateBestEmployees(employees, sessions, kpiEntries, leaves, year, month);
  }, [employees, sessions, kpiEntries, leaves, year, month]);

  const top3 = ranked.slice(0, 3);
  const others = ranked.slice(3, 10);

  const monthNames = ["", "1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар",
                      "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар"];

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="glass rounded-2xl p-4 flex flex-wrap gap-2 items-center">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS, padding: "6px 10px", borderRadius: 8 }}
          className="text-sm">
          {[2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
          style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS, padding: "6px 10px", borderRadius: 8 }}
          className="text-sm">
          {monthNames.slice(1).map((name, i) => <option key={i+1} value={i+1}>{name}</option>)}
        </select>
        <div className="flex-1" />
        <div style={{ color: T.muted, fontFamily: FS }} className="text-xs">
          {ranked.filter((r) => r.score > 0).length} ажилтан тооцоолсон
        </div>
      </div>

      {/* TOP 3 podium */}
      {top3.length > 0 && top3[0].score > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {top3.map((stat, i) => {
            const medals = ["🥇", "🥈", "🥉"];
            const colors = [
              "linear-gradient(135deg, #fbbf24, #f59e0b)",
              "linear-gradient(135deg, #cbd5e1, #94a3b8)",
              "linear-gradient(135deg, #fb923c, #ea580c)",
            ];
            return (
              <div key={stat.employee.id} className="glass-strong rounded-2xl p-5 text-center"
                style={{ order: i === 0 ? 2 : i === 1 ? 1 : 3 }}>
                <div style={{ fontSize: i === 0 ? 56 : 44 }} className="mb-2">
                  {medals[i]}
                </div>
                <div style={{
                  background: colors[i],
                  color: "white",
                  fontSize: i === 0 ? 28 : 24,
                }} className="w-20 h-20 rounded-full mx-auto mb-3 flex items-center justify-center font-bold">
                  {stat.employee.name?.[0]}
                </div>
                <div style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-base">
                  {stat.employee.name}
                </div>
                <div style={{ color: T.muted, fontFamily: FS }} className="text-xs mb-3">
                  {stat.employee.job_title || "—"}
                </div>
                <div style={{ background: T.highlightSoft, color: T.highlight }}
                  className="rounded-full px-3 py-1 inline-block text-xs font-bold">
                  {stat.score} оноо
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1 text-[10px]" style={{ fontFamily: FS, color: T.inkSoft }}>
                  <div>
                    <div style={{ color: T.muted }} className="text-[9px]">ЦАГ</div>
                    <div className="font-semibold">{stat.totalHours}</div>
                  </div>
                  <div>
                    <div style={{ color: T.muted }} className="text-[9px]">KPI</div>
                    <div className="font-semibold">{stat.kpiScore}</div>
                  </div>
                  <div>
                    <div style={{ color: T.muted }} className="text-[9px]">ЧӨЛӨӨ</div>
                    <div className="font-semibold">{stat.leaveCount}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Others list */}
      {others.length > 0 && (
        <div className="glass rounded-2xl p-4">
          <div style={{ fontFamily: FS, color: T.muted }}
               className="text-[10px] uppercase tracking-[0.2em] font-medium mb-3">
            Бусад ажилтнууд
          </div>
          <div className="space-y-2">
            {others.map((stat, i) => (
              <div key={stat.employee.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/40 transition-colors">
                <div style={{ color: T.muted, fontFamily: FS, fontWeight: 600 }} className="text-sm w-6">
                  {i + 4}
                </div>
                <div style={{ background: "linear-gradient(135deg, #f97316, #ec4899)", color: "white" }}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold">
                  {stat.employee.name?.[0]}
                </div>
                <div className="flex-1">
                  <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-sm">
                    {stat.employee.name}
                  </div>
                  <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px]">
                    {stat.totalHours}ц · {stat.kpiScore} KPI · {stat.leaveCount} чөлөө
                  </div>
                </div>
                <div style={{ background: T.surfaceAlt, color: T.inkSoft }}
                  className="px-3 py-1 rounded-full text-xs font-semibold">
                  {stat.score}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ranked.length === 0 || ranked[0].score === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <div className="text-4xl mb-2">📊</div>
          <div style={{ fontFamily: FS, color: T.muted }} className="text-sm">
            Энэ сард тоон үзүүлэлт хараахан байхгүй байна
          </div>
        </div>
      ) : null}

      {/* Info */}
      <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px] text-center">
        Шалгуур: Цаг (40%) + KPI (40%) + Чөлөө цөөн (20%)
      </div>
    </div>
  );
}


//  Filter, Alerts, Cluster, Heatmap, Tracking, Time slider, PDF, Manager view
// ═══════════════════════════════════════════════════════════════════════════

// Distance helper (haversine, метрээр)
function metersBetween(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function LiveMap({ employees, activeSessions, sites, sessions, departments = [], scope = "all" }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({ markers: [], circles: [], lines: [], heatLayer: null, clusters: [] });
  const [LRef, setLRef] = useState(null);

  // FILTER state
  const [filterDept, setFilterDept] = useState("all");
  const [filterSite, setFilterSite] = useState("all");
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showTracking, setShowTracking] = useState(true);
  const [showAlerts, setShowAlerts] = useState(true);

  // TIME SLIDER state
  const [timeMode, setTimeMode] = useState("live"); // live | history
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().slice(0, 10));

  // Leaflet динамик импорт
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((leaflet) => {
      if (!cancelled) setLRef(leaflet.default || leaflet);
    });
    return () => { cancelled = true; };
  }, []);

  // Map init
  useEffect(() => {
    if (!LRef || !mapContainerRef.current || mapRef.current) return;
    const defaultCenter = [47.9184, 106.9177];
    const map = LRef.map(mapContainerRef.current).setView(defaultCenter, 12);
    LRef.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [LRef]);

  // ─── Filter applied data ──────────────────────────────────────────────
  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      if (filterDept !== "all" && e.department_id !== filterDept) return false;
      return true;
    });
  }, [employees, filterDept]);

  const filteredSites = useMemo(() => {
    return sites.filter((s) => {
      if (filterSite !== "all" && s.id !== filterSite) return false;
      return s.lat && s.lng;
    });
  }, [sites, filterSite]);

  // ─── Live alerts (radius-аас гадуур) ──────────────────────────────────
  const alerts = useMemo(() => {
    const result = [];
    Object.entries(activeSessions).forEach(([empId, session]) => {
      const emp = filteredEmployees.find((e) => e.id === empId);
      if (!emp) return;
      const lat = session.start_lat ? Number(session.start_lat) : null;
      const lng = session.start_lng ? Number(session.start_lng) : null;
      if (!lat || !lng) return;

      // Хамгийн ойр байр олох
      let nearestSite = null;
      let nearestDist = Infinity;
      filteredSites.forEach((s) => {
        if (!s.lat || !s.lng) return;
        const d = metersBetween(lat, lng, Number(s.lat), Number(s.lng));
        if (d < nearestDist) {
          nearestDist = d;
          nearestSite = s;
        }
      });

      if (nearestSite) {
        const allowedRadius = nearestSite.radius_m || 200;
        const overshoot = nearestDist - allowedRadius;
        if (overshoot > 0) {
          result.push({
            employee: emp,
            site: nearestSite,
            distance: Math.round(nearestDist),
            overshoot: Math.round(overshoot),
            severity: overshoot > 200 ? "high" : overshoot > 50 ? "medium" : "low",
          });
        }
      }
    });
    return result;
  }, [activeSessions, filteredEmployees, filteredSites]);

  // ─── History sessions (timeMode=history) ──────────────────────────────
  const historySessions = useMemo(() => {
    if (timeMode !== "history") return [];
    return sessions.filter((s) => {
      const d = new Date(s.start_time).toISOString().slice(0, 10);
      return d === historyDate && s.start_lat && s.start_lng;
    });
  }, [sessions, timeMode, historyDate]);

  // ─── Render markers ───────────────────────────────────────────────────
  useEffect(() => {
    if (!LRef || !mapRef.current) return;
    const map = mapRef.current;

    // Цэвэрлэх
    layersRef.current.markers.forEach((m) => map.removeLayer(m));
    layersRef.current.circles.forEach((c) => map.removeLayer(c));
    layersRef.current.lines.forEach((l) => map.removeLayer(l));
    if (layersRef.current.heatLayer) {
      try { map.removeLayer(layersRef.current.heatLayer); } catch(e){}
    }
    layersRef.current = { markers: [], circles: [], lines: [], heatLayer: null, clusters: [] };

    const allBounds = [];

    // 1. Sites + radius
    filteredSites.forEach((s) => {
      const lat = Number(s.lat), lng = Number(s.lng);
      const circle = LRef.circle([lat, lng], {
        radius: s.radius_m || 200,
        color: "#ec4899",
        fillColor: "#ec4899",
        fillOpacity: 0.06,
        weight: 1.5,
        dashArray: "4 4",
      }).addTo(map);
      circle.bindPopup(`<strong>${s.name}</strong><br/>📍 ${s.radius_m || 200}м radius`);
      layersRef.current.circles.push(circle);

      const siteIcon = LRef.divIcon({
        className: "site-marker",
        html: `<div style="background: linear-gradient(135deg, #f97316, #ec4899); color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 2px 8px rgba(244,114,182,0.4); border: 2px solid white;">🏢</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const marker = LRef.marker([lat, lng], { icon: siteIcon }).addTo(map);
      marker.bindPopup(`<strong>${s.name}</strong><br/>Ажлын байр<br/>${s.radius_m || 200}м radius`);
      layersRef.current.markers.push(marker);
      allBounds.push([lat, lng]);
    });

    // 2. LIVE mode → Идэвхтэй ажилтнууд + alerts + tracking
    if (timeMode === "live") {
      Object.entries(activeSessions).forEach(([empId, session]) => {
        const emp = filteredEmployees.find((e) => e.id === empId);
        if (!emp) return;
        const lat = session.start_lat ? Number(session.start_lat) : null;
        const lng = session.start_lng ? Number(session.start_lng) : null;
        if (!lat || !lng) return;

        // Alert color
        const alert = alerts.find((a) => a.employee.id === empId);
        let bgGrad = "linear-gradient(135deg, #10b981, #14b8a6)"; // зеленэр (зөв)
        let pulseColor = "rgba(16,185,129,0.3)";
        if (alert && showAlerts) {
          if (alert.severity === "high") {
            bgGrad = "linear-gradient(135deg, #dc2626, #ef4444)"; // улаан
            pulseColor = "rgba(239,68,68,0.4)";
          } else if (alert.severity === "medium") {
            bgGrad = "linear-gradient(135deg, #f59e0b, #f97316)"; // шарга
            pulseColor = "rgba(245,158,11,0.35)";
          } else {
            bgGrad = "linear-gradient(135deg, #fbbf24, #f59e0b)"; // улбар
            pulseColor = "rgba(251,191,36,0.3)";
          }
        }

        const initial = (emp.name || "?")[0].toUpperCase();
        const startTime = new Date(session.start_time);
        const elapsedMs = Date.now() - startTime.getTime();
        const elapsedH = (elapsedMs / 3600000).toFixed(1);
        const startStr = startTime.toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" });

        const empIcon = LRef.divIcon({
          className: "emp-marker",
          html: `
            <div style="position: relative;">
              <div style="position: absolute; top: -6px; left: -6px; width: 48px; height: 48px; background: ${pulseColor}; border-radius: 50%; animation: pulse-halo 2s ease-in-out infinite;"></div>
              <div style="background: ${bgGrad}; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.25); border: 3px solid white; position: relative; z-index: 2;">${initial}</div>
            </div>
          `,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });

        const popupHtml = alert
          ? `<strong>${emp.name}</strong><br/>
             <span style="color: #ef4444; font-weight: 600;">⚠ ${alert.site.name}-аас ${alert.distance}м (зөвшөөрлөөс ${alert.overshoot}м гадуур)</span><br/>
             🕐 Эхэлсэн: ${startStr}<br/>
             ⏱ ${elapsedH} цаг`
          : `<strong>${emp.name}</strong><br/>
             <span style="color: #10b981; font-weight: 600;">● Ажиллаж байна</span><br/>
             🕐 Эхэлсэн: ${startStr}<br/>
             ⏱ ${elapsedH} цаг`;

        const empMarker = LRef.marker([lat, lng], { icon: empIcon, zIndexOffset: 1000 }).addTo(map);
        empMarker.bindPopup(popupHtml);
        layersRef.current.markers.push(empMarker);
        allBounds.push([lat, lng]);

        // 3. TRACKING line — clock-in цэгээс байр хүртэл
        if (showTracking) {
          const nearestSite = filteredSites.reduce((best, s) => {
            const d = metersBetween(lat, lng, Number(s.lat), Number(s.lng));
            return (!best || d < best.dist) ? { site: s, dist: d } : best;
          }, null);
          if (nearestSite && nearestSite.site) {
            const line = LRef.polyline([
              [lat, lng],
              [Number(nearestSite.site.lat), Number(nearestSite.site.lng)],
            ], {
              color: alert ? "#ef4444" : "#10b981",
              weight: 2,
              opacity: 0.5,
              dashArray: "6 6",
            }).addTo(map);
            layersRef.current.lines.push(line);
          }
        }
      });
    }

    // 4. HISTORY mode → тухайн өдрийн бүх sessions
    if (timeMode === "history") {
      historySessions.forEach((session) => {
        const emp = filteredEmployees.find((e) => e.id === session.employee_id);
        if (!emp) return;
        const lat = Number(session.start_lat), lng = Number(session.start_lng);

        const initial = (emp.name || "?")[0].toUpperCase();
        const empIcon = LRef.divIcon({
          html: `<div style="background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; box-shadow: 0 2px 6px rgba(139,92,246,0.4); border: 2px solid white;">${initial}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        const startStr = new Date(session.start_time).toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" });
        const endStr = session.end_time
          ? new Date(session.end_time).toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" })
          : "—";

        const empMarker = LRef.marker([lat, lng], { icon: empIcon }).addTo(map);
        empMarker.bindPopup(`<strong>${emp.name}</strong><br/>📅 ${historyDate}<br/>🕐 ${startStr} — ${endStr}`);
        layersRef.current.markers.push(empMarker);
        allBounds.push([lat, lng]);
      });
    }

    // 5. HEAT MAP — sessions-ы байршлуудаас тооцоолно
    if (showHeatmap && timeMode === "live") {
      // Энгийн heatmap — давтагдсан координат бүрт circle
      const heatPoints = {};
      sessions.forEach((s) => {
        if (!s.start_lat || !s.start_lng) return;
        const key = `${Number(s.start_lat).toFixed(3)}_${Number(s.start_lng).toFixed(3)}`;
        heatPoints[key] = (heatPoints[key] || 0) + 1;
      });
      const max = Math.max(...Object.values(heatPoints), 1);
      Object.entries(heatPoints).forEach(([key, count]) => {
        const [lat, lng] = key.split("_").map(Number);
        const intensity = count / max;
        const heatCircle = LRef.circle([lat, lng], {
          radius: 50 + intensity * 100,
          color: "#ef4444",
          fillColor: "#ef4444",
          fillOpacity: 0.08 + intensity * 0.25,
          weight: 0,
        }).addTo(map);
        layersRef.current.markers.push(heatCircle);
      });
    }

    // Auto-fit
    if (allBounds.length > 0 && allBounds.length < 100) {
      try {
        const bounds = LRef.latLngBounds(allBounds);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      } catch (e) {}
    }
  }, [LRef, filteredEmployees, activeSessions, filteredSites, sessions, alerts, showHeatmap, showTracking, showAlerts, timeMode, historySessions, historyDate]);

  // ─── PDF EXPORT ───────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    try {
      // Leaflet → PDF
      const { jsPDF } = await import("jspdf");

      // Map screenshot via leaflet-image (using html2canvas fallback)
      const mapNode = mapContainerRef.current;
      if (!mapNode) return;

      // Simple approach: capture as canvas via dom-to-image-like
      // Since html2canvas not installed, ашиглах backup arga
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      pdf.setFontSize(16);
      pdf.text("ORGOO Live Map Report", 20, 20);
      pdf.setFontSize(10);
      pdf.text(`Огноо: ${new Date().toLocaleString("mn-MN")}`, 20, 30);
      pdf.text(`Идэвхтэй: ${Object.keys(activeSessions).length} ажилтан`, 20, 40);
      pdf.text(`Ажлын байр: ${filteredSites.length}`, 20, 47);
      pdf.text(`Анхааруулга: ${alerts.length} ажилтан зөвшөөрөлгүй зайд`, 20, 54);

      let y = 70;
      pdf.setFontSize(12);
      pdf.text("Анхааруулгын жагсаалт:", 20, y);
      y += 8;
      pdf.setFontSize(9);
      alerts.forEach((a) => {
        pdf.text(`${a.employee.name} — ${a.site.name}-аас ${a.distance}м`, 25, y);
        y += 6;
        if (y > 190) { pdf.addPage(); y = 20; }
      });

      pdf.save(`ORGOO-livemap-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      alert("PDF тайлан үүсгэхэд алдаа гарлаа: " + e.message);
    }
  };

  // ─── Departments + sites unique ───────────────────────────────────────
  const allDepts = departments.filter(Boolean);
  const allSitesWithGps = sites.filter((s) => s.lat && s.lng);

  return (
    <div>
      {/* CONTROL PANEL */}
      <div className="glass rounded-2xl p-4 mb-3">
        <div className="flex flex-wrap gap-2 items-center mb-2">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 p-0.5 rounded-full" style={{ background: T.surfaceAlt }}>
            <button onClick={() => setTimeMode("live")}
              className={`press-btn px-3 py-1.5 rounded-full text-xs ${timeMode === "live" ? "tab-active" : ""}`}
              style={{ fontFamily: FS, fontWeight: 500 }}>
              ● Live
            </button>
            <button onClick={() => setTimeMode("history")}
              className={`press-btn px-3 py-1.5 rounded-full text-xs ${timeMode === "history" ? "tab-active" : ""}`}
              style={{ fontFamily: FS, fontWeight: 500 }}>
              📅 Түүх
            </button>
          </div>

          {/* Date picker (history mode) */}
          {timeMode === "history" && (
            <input type="date" value={historyDate} onChange={(e) => setHistoryDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS, padding: "6px 10px", borderRadius: 8 }}
              className="text-xs" />
          )}

          {/* Filter: Department */}
          <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}
            style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS, padding: "6px 10px", borderRadius: 8 }}
            className="text-xs">
            <option value="all">Бүх хэлтэс</option>
            {allDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>

          {/* Filter: Site */}
          <select value={filterSite} onChange={(e) => setFilterSite(e.target.value)}
            style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.ink, fontFamily: FS, padding: "6px 10px", borderRadius: 8 }}
            className="text-xs">
            <option value="all">Бүх байр</option>
            {allSitesWithGps.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div className="flex-1" />

          {/* Toggle: Heat */}
          <button onClick={() => setShowHeatmap(!showHeatmap)}
            className="press-btn px-3 py-1.5 rounded-full text-xs flex items-center gap-1"
            style={{
              background: showHeatmap ? T.warnSoft : T.surfaceAlt,
              color: showHeatmap ? T.warn : T.muted,
              border: `1px solid ${showHeatmap ? T.warn : T.border}`,
              fontFamily: FS, fontWeight: 500,
            }}>
            🔥 Heat
          </button>

          {/* Toggle: Tracking */}
          <button onClick={() => setShowTracking(!showTracking)}
            className="press-btn px-3 py-1.5 rounded-full text-xs flex items-center gap-1"
            style={{
              background: showTracking ? T.highlightSoft : T.surfaceAlt,
              color: showTracking ? T.highlight : T.muted,
              border: `1px solid ${showTracking ? T.highlight : T.border}`,
              fontFamily: FS, fontWeight: 500,
            }}>
            🛤 Зам
          </button>

          {/* Toggle: Alerts */}
          <button onClick={() => setShowAlerts(!showAlerts)}
            className="press-btn px-3 py-1.5 rounded-full text-xs flex items-center gap-1"
            style={{
              background: showAlerts ? T.errSoft : T.surfaceAlt,
              color: showAlerts ? T.err : T.muted,
              border: `1px solid ${showAlerts ? T.err : T.border}`,
              fontFamily: FS, fontWeight: 500,
            }}>
            ⚠ Alert
          </button>

          {/* Export PDF */}
          <button onClick={handleExportPdf}
            className="glow-primary press-btn px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5"
            style={{ fontFamily: FS, fontWeight: 600 }}>
            <Download size={11} /> PDF
          </button>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] pt-2 border-t" style={{ borderColor: T.borderSoft, fontFamily: FS }}>
          <div className="flex items-center gap-1">
            <div style={{ background: "linear-gradient(135deg, #10b981, #14b8a6)", boxShadow: "0 0 0 2px rgba(16,185,129,0.3)" }} className="w-2.5 h-2.5 rounded-full" />
            <span style={{ color: T.inkSoft }}>Зөв ({Object.keys(activeSessions).length - alerts.length})</span>
          </div>
          {alerts.length > 0 && (
            <div className="flex items-center gap-1">
              <div style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }} className="w-2.5 h-2.5 rounded-full" />
              <span style={{ color: T.inkSoft }}>Анхаар ({alerts.filter(a => a.severity !== "high").length})</span>
            </div>
          )}
          {alerts.filter(a => a.severity === "high").length > 0 && (
            <div className="flex items-center gap-1">
              <div style={{ background: "linear-gradient(135deg, #dc2626, #ef4444)" }} className="w-2.5 h-2.5 rounded-full" />
              <span style={{ color: T.inkSoft }}>Хол ({alerts.filter(a => a.severity === "high").length})</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <div style={{ background: "linear-gradient(135deg, #f97316, #ec4899)" }} className="w-2.5 h-2.5 rounded-full" />
            <span style={{ color: T.inkSoft }}>Байр ({filteredSites.length})</span>
          </div>
        </div>
      </div>

      {/* ALERT BAR — radius-аас гадуур */}
      {alerts.length > 0 && showAlerts && timeMode === "live" && (
        <div className="glass rounded-2xl p-3 mb-3 fade-in" style={{
          background: "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(245,158,11,0.05))",
          border: `1px solid ${T.errSoft}`,
        }}>
          <div className="flex items-start gap-2">
            <div style={{
              background: "linear-gradient(135deg, #f59e0b, #f97316)",
              color: "white",
            }} className="w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0">
              ⚠
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontFamily: FS, fontWeight: 600, color: T.ink }} className="text-xs mb-1">
                {alerts.length} ажилтан зөвшөөрөгдсөн зайнаас гадуур!
              </div>
              <div className="flex flex-wrap gap-1.5">
                {alerts.slice(0, 5).map((a, i) => (
                  <div key={i} style={{
                    background: a.severity === "high" ? T.errSoft : T.warnSoft,
                    color: a.severity === "high" ? T.err : T.warn,
                  }} className="px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1"
                    title={`${a.site.name}-аас ${a.distance}м (зөвшөөрөл ${a.site.radius_m || 200}м)`}>
                    {a.employee.name} · {a.distance}м
                  </div>
                ))}
                {alerts.length > 5 && (
                  <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px] py-0.5">
                    + {alerts.length - 5} илүү
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MAP */}
      <div className="glass rounded-2xl overflow-hidden" style={{ height: 520 }}>
        <div ref={mapContainerRef} style={{ width: "100%", height: "100%", borderRadius: 16 }} />
      </div>

      {/* INFO STRIP */}
      <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px] mt-2 text-center">
        {timeMode === "live"
          ? "🔴 Live · Real-time GPS байршил"
          : `📅 Түүх · ${historyDate} өдрийн ${historySessions.length} session`}
        {showHeatmap && " · 🔥 Heat map идэвхтэй"}
        {scope === "team" && " · 👥 Зөвхөн миний баг"}
      </div>
    </div>
  );
}



function BigStat({ label, value, suffix, accent, icon: Icon, iconColor = "pink" }) {
  const iconBg = {
    pink: "linear-gradient(135deg, #f97316, #ec4899)",
    success: "linear-gradient(135deg, #10b981, #14b8a6)",
    warn: "linear-gradient(135deg, #f59e0b, #f97316)",
    info: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
    purple: "linear-gradient(135deg, #8b5cf6, #ec4899)",
  }[iconColor] || "linear-gradient(135deg, #f97316, #ec4899)";

  return (
    <div className="glass lift rounded-2xl px-5 py-4">
      <div className="flex items-start justify-between mb-2">
        <div style={{ fontFamily: FM, color: T.muted }} className="text-[9px] uppercase tracking-[0.25em]">{label}</div>
        {Icon && (
          <div style={{
            background: iconBg,
            color: "white",
            boxShadow: "0 4px 12px rgba(244,114,182,0.25)",
          }} className="w-9 h-9 rounded-xl flex items-center justify-center">
            <Icon size={16} strokeWidth={2.2} />
          </div>
        )}
      </div>
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
// ═══════════════════════════════════════════════════════════════════════════
//  PHOTO CAPTURE MODAL — Цаг бүртгэх үед сэлфи авах
// ═══════════════════════════════════════════════════════════════════════════
function PhotoCaptureModal({ onCapture, onCancel, title = "Цаг бүртгэлд зураг шаардагдана" }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState(null); // {blob, dataUrl}

  // Start camera
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user", // front-facing camera (selfie)
            width: { ideal: 720 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (e) {
        setError(
          e.name === "NotAllowedError"
            ? "Камер ашиглах зөвшөөрөл өгнө үү"
            : e.name === "NotFoundError"
            ? "Камер олдсонгүй"
            : "Камер нээгдсэнгүй: " + e.message
        );
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const takePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      setCaptured({ blob, dataUrl });
    }, "image/jpeg", 0.85);
  };

  const retake = () => setCaptured(null);

  const confirm = async () => {
    if (!captured) return;
    setBusy(true);
    try {
      await onCapture(captured.blob);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
      <div className="modal-content rounded-2xl max-w-md w-full p-5 max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 style={{ fontFamily: FS, fontWeight: 600 }} className="text-base">
            📷 {title}
          </h3>
          <button onClick={onCancel} style={{ color: T.muted }}
            className="press-btn p-1 rounded hover:bg-black/5">
            <X size={18} />
          </button>
        </div>

        {error ? (
          <div className="mb-3">
            <FeedbackBox type="error">{error}</FeedbackBox>
            <p style={{ color: T.muted, fontFamily: FS }} className="text-xs mt-3">
              Камерийг шууд хааж амжуу. Утсаны тохиргоонд "Камер" зөвшөөрөл өгөөрэй.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-xl overflow-hidden mb-3 relative" style={{ background: "#000", aspectRatio: "1/1" }}>
              {captured ? (
                <img src={captured.dataUrl} alt="captured"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <video ref={videoRef} autoPlay playsInline muted
                  style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
              )}
              <canvas ref={canvasRef} style={{ display: "none" }} />

              {/* Overlay frame */}
              {!captured && (
                <div style={{
                  position: "absolute",
                  inset: "10%",
                  border: "2px dashed rgba(255,255,255,0.5)",
                  borderRadius: "50%",
                  pointerEvents: "none",
                }} />
              )}
            </div>

            <p style={{ color: T.muted, fontFamily: FS }} className="text-xs mb-3 text-center">
              {captured
                ? "Зураг авагдсан. Илгээх үү?"
                : "Нүүрээ дугуй дотор байрлуулаад товч дарна уу"}
            </p>

            <div className="flex gap-2">
              {captured ? (
                <>
                  <button onClick={retake}
                    className="press-btn flex-1 py-3 rounded-xl text-sm font-medium"
                    style={{ background: T.surfaceAlt, color: T.ink, border: `1px solid ${T.border}`, fontFamily: FS }}>
                    Дахин авах
                  </button>
                  <button onClick={confirm} disabled={busy}
                    className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                    {busy ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
                    {busy ? "Илгээж байна..." : "Илгээх"}
                  </button>
                </>
              ) : (
                <button onClick={takePhoto}
                  className="glow-primary press-btn flex-1 py-3 rounded-xl text-sm font-semibold">
                  📷 Зураг авах
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHOTO VIEWER — Зураг харах модал
// ═══════════════════════════════════════════════════════════════════════════
function PhotoViewerModal({ photoUrl, employee, time, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4"
      onClick={onClose}>
      <div className="modal-content rounded-2xl max-w-md w-full p-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div style={{ fontFamily: FS, fontWeight: 600 }} className="text-sm">
              {employee?.name || "Ажилтан"}
            </div>
            {time && (
              <div style={{ color: T.muted, fontFamily: FS }} className="text-xs">
                {new Date(time).toLocaleString("mn-MN")}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ color: T.muted }}
            className="press-btn p-1.5 rounded-lg hover:bg-black/5">
            <X size={18} />
          </button>
        </div>
        <div className="rounded-xl overflow-hidden" style={{ background: "#000" }}>
          <img src={photoUrl} alt="clock-in"
            style={{ width: "100%", height: "auto", maxHeight: "70vh", objectFit: "contain" }} />
        </div>
      </div>
    </div>
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
  const [view, setView] = useState("dashboard");
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div style={{ color: T.ink, fontFamily: FS, background: T.bg }} className="min-h-screen">
      <div className="flex min-h-screen">
        {/* SIDEBAR */}
        <aside style={{
          background: "rgba(255,255,255,0.6)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderRight: `1px solid ${T.border}`,
          width: 240,
        }} className={`fixed lg:sticky top-0 left-0 h-screen z-40 flex flex-col transition-transform ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>

          <div className="px-4 py-4 border-b" style={{ borderColor: T.border }}>
            <div className="flex items-center gap-2.5">
              <div style={{ background: "linear-gradient(135deg, #f97316, #ec4899)", color: "white" }} className="w-8 h-8 rounded-md flex items-center justify-center">
                <ShieldCheck size={14} />
              </div>
              <div className="flex-1">
                <div style={{ fontFamily: FS, fontWeight: 600, letterSpacing: "-0.02em" }} className="text-base leading-none">
                  ORGOO<span style={{ color: T.highlight }}>.</span>
                </div>
                <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider mt-0.5">
                  Ахлагч
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="lg:hidden" style={{ color: T.muted }}>
                <X size={16} />
              </button>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-3">
            <SidebarSection label="Хяналт">
              <SidebarTab active={view === "team"} onClick={() => { setView("team"); setSidebarOpen(false); }} icon={Users}>Баг</SidebarTab>
              <SidebarTab active={view === "livemap"} onClick={() => { setView("livemap"); setSidebarOpen(false); }} icon={MapPin}>Газрын зураг</SidebarTab>
              <SidebarTab active={view === "dashboard"} onClick={() => { setView("dashboard"); setSidebarOpen(false); }} icon={BarChart3}>Дашборд</SidebarTab>
              <SidebarTab active={view === "tasks"} onClick={() => { setView("tasks"); setSidebarOpen(false); }} icon={ClipboardCheck}>Даалгавар</SidebarTab>
            </SidebarSection>

            <SidebarSection label="Хүсэлтүүд">
              <SidebarTab active={view === "approvals"} onClick={() => { setView("approvals"); setSidebarOpen(false); }} icon={Inbox} badge={pendingApprovals.length}>Хүсэлт</SidebarTab>
              <SidebarTab active={view === "ledger"} onClick={() => { setView("ledger"); setSidebarOpen(false); }} icon={Calendar}>Тэмдэглэл</SidebarTab>
            </SidebarSection>
          </nav>

          <div className="border-t px-2 py-2" style={{ borderColor: T.border }}>
            <div className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-gray-50">
              <div style={{ background: "linear-gradient(135deg, #f97316, #ec4899)", color: "white" }} className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold">
                {profile.name?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontFamily: FS, fontWeight: 500 }} className="text-xs truncate">
                  {profile.name}
                </div>
                <div style={{ color: T.muted, fontFamily: FS }} className="text-[10px] uppercase tracking-wider">
                  {team.length} ажилтан
                </div>
              </div>
              <DarkModeToggle />
              <button onClick={() => supabase.auth.signOut()} style={{ color: T.muted }}
                className="press-btn p-1.5 rounded hover:bg-gray-100">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </aside>

        {sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)}
               className="fixed inset-0 bg-black/30 z-30 lg:hidden" />
        )}

        {/* MAIN */}
        <main className="flex-1 min-w-0">
          <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b sticky top-0 z-20" style={{ background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderColor: T.border }}>
            <button onClick={() => setSidebarOpen(true)} style={{ color: T.ink }}>
              <Inbox size={18} />
            </button>
            <div style={{ fontFamily: FS, fontWeight: 600 }} className="text-sm">ORGOO<span style={{ color: T.highlight }}>.</span></div>
          </div>

          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 sm:py-8">
            <div className="mb-6 slide-up">
              <h1 style={{ fontFamily: FS, fontWeight: 600, letterSpacing: "-0.02em" }} className="text-2xl mb-1">
                {view === "team" && "Багийн гишүүд"}
                {view === "livemap" && "Газрын зураг"}
                {view === "dashboard" && "Дашборд"}
                {view === "tasks" && "Даалгавар"}
                {view === "approvals" && "Хүсэлт"}
                {view === "ledger" && "Тэмдэглэл"}
              </h1>
              <p style={{ color: T.muted }} className="text-sm">
                {view === "team" && `${team.length} ажилтан · ${activeCount} ажиллаж байна`}
                {view === "livemap" && `Багийн ${activeCount} ажилтан газрын зураг дээр`}
                {view === "dashboard" && "KPI мониторинг"}
                {view === "tasks" && "Багийн даалгавар"}
                {view === "approvals" && `${pendingApprovals.length} шалгагдаагүй`}
                {view === "ledger" && "Цаг бүртгэлийн түүх"}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 slide-up-delay-1">
              <BigStat label="Ажиллаж буй" value={activeCount} accent={activeCount > 0} icon={Play} iconColor="success" />
              <BigStat label="Өнөөдөр" value={fmtHours(teamTodayMs)} suffix="цаг" icon={Clock} iconColor="warn" />
              <BigStat label="Ажилтан" value={team.length} icon={Users} iconColor="pink" />
            </div>

        {feedback && (
          <div className="mb-4"><FeedbackBox type={feedback.type}>{feedback.msg}</FeedbackBox></div>
        )}

        {view === "team" && (
          <ManagerTeamReadOnly
            team={team} sessions={sessions} activeSessions={activeSessions}
            sites={sites} employeeSites={employeeSites} />
        )}
        {view === "livemap" && (
          <LiveMap
            employees={team}
            activeSessions={activeSessions}
            sites={sites}
            sessions={sessions}
            departments={departments}
            scope="team"
          />
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
        </main>
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
// ═══════════════════════════════════════════════════════════════════════════
//  KPI Excel Export
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
//  SALARY PDF — Цалингийн тайлан үүсгэх
// ═══════════════════════════════════════════════════════════════════════════
async function exportSalaryPdf(employee, sessions, leaves, year, month) {
  const { jsPDF } = await import("jspdf");
  await import("jspdf-autotable");

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);

  // Filter sessions for this month
  const monthSessions = sessions.filter((s) => {
    if (s.employee_id !== employee.id || !s.end_time) return false;
    const start = new Date(s.start_time);
    return start >= monthStart && start <= monthEnd;
  });

  // Тооцооллуудаа хийе
  let totalMs = 0;
  let regularMs = 0;
  let overtimeMs = 0;
  const dailyHours = {};

  monthSessions.forEach((s) => {
    const start = new Date(s.start_time);
    const end = new Date(s.end_time);
    const ms = end - start;
    totalMs += ms;

    const dayKey = start.toISOString().slice(0, 10);
    dailyHours[dayKey] = (dailyHours[dayKey] || 0) + ms;
  });

  // Илүү цаг тооцох (өдөрт 8+ цаг -> overtime)
  Object.values(dailyHours).forEach((ms) => {
    const hours = ms / 3600000;
    if (hours <= 8) {
      regularMs += ms;
    } else {
      regularMs += 8 * 3600000;
      overtimeMs += (hours - 8) * 3600000;
    }
  });

  const totalHours = totalMs / 3600000;
  const regularHours = regularMs / 3600000;
  const overtimeHours = overtimeMs / 3600000;

  const hourlyRate = Number(employee.hourly_rate || 0);
  const otMultiplier = Number(employee.overtime_rate_multiplier || 1.5);
  const baseSalary = Number(employee.base_salary || 0);

  const regularPay = regularHours * hourlyRate;
  const overtimePay = overtimeHours * hourlyRate * otMultiplier;

  // Чөлөө тооцох
  const monthLeaves = leaves.filter((l) => {
    if (l.employee_id !== employee.id || l.status !== "approved") return false;
    const lDate = new Date(l.leave_date);
    return lDate >= monthStart && lDate <= monthEnd;
  });
  const leaveDeduction = monthLeaves.length * 8 * hourlyRate * 0.5; // 50% хасалт чөлөөтэй өдөр

  const grossPay = baseSalary + regularPay + overtimePay - leaveDeduction;
  const tax = grossPay * 0.1; // 10% татвар
  const netPay = grossPay - tax;

  const monthNames = ["", "1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар",
                      "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар"];

  // PDF үүсгэх
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  pdf.setFont("helvetica");

  // Header
  pdf.setFontSize(20);
  pdf.setTextColor(236, 72, 153);
  pdf.text("ORGOO", 20, 20);
  pdf.setFontSize(10);
  pdf.setTextColor(100, 100, 100);
  pdf.text("Tsalingiin tailan", 20, 28);

  // Employee info
  pdf.setFontSize(14);
  pdf.setTextColor(30, 30, 30);
  pdf.text(employee.name || "—", 20, 45);
  pdf.setFontSize(9);
  pdf.setTextColor(120, 120, 120);
  pdf.text(`Albanaa: ${employee.job_title || "—"}`, 20, 51);
  pdf.text(`${monthNames[month]} ${year}`, 20, 56);

  // Тооцооллын хүснэгт
  const data = [
    ["Undsen tsalin", `${baseSalary.toLocaleString()} togrog`],
    ["Niit tsag", `${totalHours.toFixed(1)} tsag`],
    ["  · Engiin", `${regularHours.toFixed(1)} tsag`],
    ["  · Iluu tsag", `${overtimeHours.toFixed(1)} tsag`],
    ["Tsagiin staavka", `${hourlyRate.toLocaleString()} togrog`],
    ["Engiin tsag mongo", `${regularPay.toLocaleString()} togrog`],
    [`Iluu tsag (x${otMultiplier})`, `${overtimePay.toLocaleString()} togrog`],
    ["Cholootei udur", `${monthLeaves.length} udur`],
    ["Cholootei khasalt", `-${leaveDeduction.toLocaleString()} togrog`],
    ["", ""],
    ["NIIT TUGREEN", `${grossPay.toLocaleString()} togrog`],
    ["Tatvar (10%)", `-${tax.toLocaleString()} togrog`],
  ];

  pdf.autoTable({
    startY: 70,
    head: [["Zuil", "Mongo"]],
    body: data,
    theme: "plain",
    headStyles: { fillColor: [236, 72, 153], textColor: [255, 255, 255], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [253, 243, 245] },
    margin: { left: 20, right: 20 },
  });

  const finalY = pdf.lastAutoTable.finalY + 8;

  // Final pay box
  pdf.setFillColor(236, 72, 153);
  pdf.rect(20, finalY, 170, 18, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(10);
  pdf.text("AVAH MONGO", 25, finalY + 8);
  pdf.setFontSize(16);
  pdf.text(`${netPay.toLocaleString()} togrog`, 25, finalY + 15);

  // Footer
  pdf.setFontSize(8);
  pdf.setTextColor(150, 150, 150);
  pdf.text(`Uusgesen: ${new Date().toLocaleString("mn-MN")}`, 20, 285);
  pdf.text("ORGOO automatic tailan", 150, 285);

  pdf.save(`ORGOO-${employee.name}-${year}-${String(month).padStart(2, "0")}.pdf`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  BEST EMPLOYEE — Шилдэг ажилтан автомат
// ═══════════════════════════════════════════════════════════════════════════
function calculateBestEmployees(employees, sessions, kpiEntries, leaves, year, month) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);

  const stats = employees.map((emp) => {
    // Цаг
    const empSessions = sessions.filter((s) => {
      if (s.employee_id !== emp.id || !s.end_time) return false;
      const sd = new Date(s.start_time);
      return sd >= monthStart && sd <= monthEnd;
    });
    const totalHours = empSessions.reduce((sum, s) =>
      sum + (new Date(s.end_time) - new Date(s.start_time)) / 3600000, 0);

    // KPI
    const empKpis = kpiEntries.filter((k) => {
      if (k.employee_id !== emp.id) return false;
      const kd = new Date(k.date);
      return kd >= monthStart && kd <= monthEnd;
    });
    const kpiScore = empKpis.reduce((sum, k) => sum + Number(k.value || 0), 0);

    // Чөлөө
    const empLeaves = leaves.filter((l) => {
      if (l.employee_id !== emp.id || l.status !== "approved") return false;
      const ld = new Date(l.leave_date);
      return ld >= monthStart && ld <= monthEnd;
    });
    const leaveCount = empLeaves.length;

    // Final оноо: цаг (40%) + KPI (40%) + цөөн чөлөө (20%)
    // Normalize: бусадтай харьцангуй
    return {
      employee: emp,
      totalHours: totalHours.toFixed(1),
      kpiScore,
      leaveCount,
      // Тогтмол шинж шалгаруулах
      score: 0,
    };
  });

  // Normalize and score
  const maxHours = Math.max(...stats.map((s) => s.totalHours), 1);
  const maxKpi = Math.max(...stats.map((s) => s.kpiScore), 1);
  const maxLeaves = Math.max(...stats.map((s) => s.leaveCount), 1);

  stats.forEach((s) => {
    const hourScore = (s.totalHours / maxHours) * 40;
    const kpiScore = (s.kpiScore / maxKpi) * 40;
    const leaveScore = ((maxLeaves - s.leaveCount) / maxLeaves) * 20;
    s.score = Math.round(hourScore + kpiScore + leaveScore);
  });

  // Sort by score desc
  stats.sort((a, b) => b.score - a.score);
  return stats;
}

function exportKpiToExcel(departments, kpiDefs, filteredEntries, periodRange) {
  const wb = XLSX.utils.book_new();

  // ============== Хуудас 1: ХУРААНГУЙ ==============
  const summaryRows = [
    ["ORGOO · KPI Хураангуй тайлан"],
    [`Хугацаа: ${periodRange.label}`],
    [`Огноо: ${periodRange.start} → ${periodRange.end}`],
    [],
    ["Хэлтэс", "KPI", "Нэгж", "Нийт утга", "Зорилт", "Биеэлэлт %", "Тренд"],
  ];

  departments.forEach((dept) => {
    const deptKpis = kpiDefs.filter(k => k.department_id === dept.id);
    deptKpis.forEach((kpi) => {
      const entries = filteredEntries.filter(e => e.kpi_id === kpi.id);
      const total = entries.reduce((sum, e) => sum + Number(e.value), 0);

      // Target tailbar
      let targetTotal = "";
      let percent = "";
      if (kpi.target) {
        let tt = Number(kpi.target);
        if (kpi.target_period === "daily") {
          const days = Math.max(1, Math.ceil((new Date(periodRange.end) - new Date(periodRange.start)) / 86400000) + 1);
          tt = Number(kpi.target) * days;
        } else if (kpi.target_period === "weekly") {
          const weeks = Math.max(1, Math.ceil((new Date(periodRange.end) - new Date(periodRange.start)) / (7 * 86400000)));
          tt = Number(kpi.target) * weeks;
        }
        targetTotal = tt;
        percent = tt > 0 ? `${((total / tt) * 100).toFixed(1)}%` : "";
      }

      summaryRows.push([
        dept.name,
        kpi.name,
        kpi.unit || "",
        total,
        targetTotal,
        percent,
        "", // тренд хоосон
      ]);
    });
  });

  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1["!cols"] = [{ wch: 18 }, { wch: 24 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Хураангуй");

  // ============== Хуудас 2: ӨДРИЙН ДЭЛГЭРЭНГҮЙ ==============
  // Огнооны массив
  const dateList = [];
  const start = new Date(periodRange.start);
  const end = new Date(periodRange.end);
  const cur = new Date(start);
  while (cur <= end) {
    dateList.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  const detailRows = [
    ["ORGOO · KPI Өдрийн дэлгэрэнгүй"],
    [`Хугацаа: ${periodRange.label}`],
    [],
  ];

  departments.forEach((dept) => {
    const deptKpis = kpiDefs.filter(k => k.department_id === dept.id);
    if (deptKpis.length === 0) return;

    // Хэлтсийн гарчиг
    detailRows.push([`▸ ${dept.name}`]);

    // Header: Огноо | KPI1 | KPI2 | ...
    const header = ["Огноо", ...deptKpis.map(k => `${k.name}${k.unit ? ` (${k.unit})` : ""}`)];
    detailRows.push(header);

    // Өдөр бүрд мөр
    dateList.forEach((date) => {
      const row = [date];
      deptKpis.forEach((kpi) => {
        const entry = filteredEntries.find(e => e.kpi_id === kpi.id && e.entry_date === date);
        row.push(entry ? Number(entry.value) : "");
      });
      detailRows.push(row);
    });

    // Нийт мөр
    const totalRow = ["НИЙТ"];
    deptKpis.forEach((kpi) => {
      const entries = filteredEntries.filter(e => e.kpi_id === kpi.id);
      const total = entries.reduce((sum, e) => sum + Number(e.value), 0);
      totalRow.push(total);
    });
    detailRows.push(totalRow);
    detailRows.push([]);  // хоосон мөр
  });

  const ws2 = XLSX.utils.aoa_to_sheet(detailRows);
  ws2["!cols"] = [{ wch: 12 }, ...Array(20).fill({ wch: 16 })];
  XLSX.utils.book_append_sheet(wb, ws2, "Өдрийн дэлгэрэнгүй");

  // Файл татах
  const fileName = `ORGOO-KPI-${periodRange.start}-${periodRange.end}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

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
    if (period === "yesterday") {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().slice(0, 10);
      return { start: yStr, end: yStr, label: `Өчигдөр (${yStr})` };
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
              { id: "day", label: "Өнөөдөр" },
              { id: "yesterday", label: "Өчигдөр" },
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

          <button onClick={() => exportKpiToExcel(visibleDepts, kpiDefs, filteredEntries, periodRange)}
            className="glass-soft press-btn px-3 py-2 rounded-lg text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5 hover:bg-white"
            style={{ fontFamily: FM, color: T.ok, border: `1px solid ${T.borderSoft}` }}>
            <FileSpreadsheet size={11} /> Excel
          </button>
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
                  let total = 0;
                  let entries = [];

                  // Calculated KPI: формулаар тооцоолох
                  if (kpi.kpi_type === "calculated" && kpi.formula?.numerator_id && kpi.formula?.denominator_id) {
                    const numEntries = filteredEntries.filter(e => e.kpi_id === kpi.formula.numerator_id);
                    const denEntries = filteredEntries.filter(e => e.kpi_id === kpi.formula.denominator_id);
                    const numSum = numEntries.reduce((s, e) => s + Number(e.value), 0);
                    const denSum = denEntries.reduce((s, e) => s + Number(e.value), 0);
                    const op = kpi.formula.operator;
                    if (op === "divide") {
                      total = denSum === 0 ? 0 : numSum / denSum;
                    } else if (op === "multiply") {
                      total = numSum * denSum;
                    } else if (op === "add") {
                      total = numSum + denSum;
                    } else if (op === "subtract") {
                      total = numSum - denSum;
                    }
                  } else {
                    entries = filteredEntries.filter(e => e.kpi_id === kpi.id);
                    total = entries.reduce((sum, e) => sum + Number(e.value), 0);
                  }

                  // Trend: Хэрэв 7 хоног мөн өнгөрсөн 7 хоног харьцуулах
                  let trend = null;
                  if (period === "week" || period === "day" || period === "yesterday") {
                    const dayShift = period === "week" ? 7 : 1;
                    const prevStart = new Date(periodRange.start);
                    prevStart.setDate(prevStart.getDate() - dayShift);
                    const prevEnd = new Date(periodRange.end);
                    prevEnd.setDate(prevEnd.getDate() - dayShift);
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

                  // Тус KPI-н өнгийг тогтоогдоход (display_order эсвэл index ашиглан)
                  const kpiIndex = deptKpis.findIndex(k => k.id === kpi.id);
                  const gradients = [
                    { from: "#8b5cf6", to: "#ec4899", shadow: "rgba(139,92,246,0.25)" }, // Purple → Pink
                    { from: "#06b6d4", to: "#3b82f6", shadow: "rgba(6,182,212,0.25)" },  // Cyan → Blue
                    { from: "#f59e0b", to: "#ef4444", shadow: "rgba(245,158,11,0.25)" }, // Orange → Red
                    { from: "#10b981", to: "#14b8a6", shadow: "rgba(16,185,129,0.25)" }, // Green → Teal
                    { from: "#ec4899", to: "#f97316", shadow: "rgba(236,72,153,0.25)" }, // Pink → Orange
                    { from: "#6366f1", to: "#8b5cf6", shadow: "rgba(99,102,241,0.25)" }, // Indigo → Purple
                    { from: "#f43f5e", to: "#fb7185", shadow: "rgba(244,63,94,0.25)" },  // Rose
                    { from: "#0ea5e9", to: "#06b6d4", shadow: "rgba(14,165,233,0.25)" }, // Sky → Cyan
                  ];
                  const grad = gradients[kpiIndex % gradients.length];

                  // Бүтээх mini chart points (өмнөх 7 өдрөөс)
                  const chartPoints = (() => {
                    const days = 7;
                    const today = new Date(periodRange.end || new Date());
                    const points = [];
                    for (let i = days - 1; i >= 0; i--) {
                      const d = new Date(today);
                      d.setDate(d.getDate() - i);
                      const dStr = d.toISOString().slice(0, 10);

                      let val = 0;
                      if (kpi.kpi_type === "calculated" && kpi.formula?.numerator_id && kpi.formula?.denominator_id) {
                        const numEntries = kpiEntries.filter(e => e.kpi_id === kpi.formula.numerator_id && e.entry_date === dStr);
                        const denEntries = kpiEntries.filter(e => e.kpi_id === kpi.formula.denominator_id && e.entry_date === dStr);
                        const n = numEntries.reduce((s, e) => s + Number(e.value), 0);
                        const dn = denEntries.reduce((s, e) => s + Number(e.value), 0);
                        const op = kpi.formula.operator;
                        if (op === "divide") val = dn === 0 ? 0 : n / dn;
                        else if (op === "multiply") val = n * dn;
                        else if (op === "add") val = n + dn;
                        else if (op === "subtract") val = n - dn;
                      } else {
                        const dayEntries = kpiEntries.filter(e => e.kpi_id === kpi.id && e.entry_date === dStr);
                        val = dayEntries.reduce((s, e) => s + Number(e.value), 0);
                      }
                      points.push(val);
                    }
                    return points;
                  })();

                  // Normalize to SVG points
                  const maxVal = Math.max(...chartPoints, 1);
                  const minVal = Math.min(...chartPoints, 0);
                  const range = maxVal - minVal || 1;
                  const svgPoints = chartPoints.map((v, i) => {
                    const x = (i / (chartPoints.length - 1)) * 80;
                    const y = 22 - ((v - minVal) / range) * 18;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(" ");
                  const polygonPoints = `${svgPoints} 80,24 0,24`;

                  return (
                    <div key={kpi.id}
                      className="lift rounded-2xl p-3 group relative"
                      style={{
                        background: `linear-gradient(135deg, ${grad.from} 0%, ${grad.to} 100%)`,
                        boxShadow: `0 4px 20px ${grad.shadow}`,
                        color: "white",
                      }}>
                      <div className="flex items-start justify-between mb-1.5">
                        <span style={{ fontFamily: FM, opacity: 0.9, fontWeight: 600 }} className="text-[9px] uppercase tracking-[0.15em] line-clamp-2">
                          {kpi.name}
                        </span>
                        <div className="flex items-center gap-1">
                          {kpi.kpi_type === "calculated" && (
                            <div style={{ background: "rgba(255,255,255,0.2)" }}
                              className="w-4 h-4 rounded-full flex items-center justify-center text-[8px]" title="Тооцооллын KPI">
                              🧮
                            </div>
                          )}
                          {trend && (
                            <div style={{ background: "rgba(255,255,255,0.2)" }}
                              className="w-4 h-4 rounded-full flex items-center justify-center text-[9px]">
                              {trend.up ? "↗" : "↘"}
                            </div>
                          )}
                          {isAdmin && (
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                              <button onClick={() => onEditKpi(kpi)} style={{ color: "white" }} className="hover:opacity-70">
                                <Edit3 size={10} />
                              </button>
                              <button onClick={() => setConfirmDelKpi(kpi)} style={{ color: "white" }} className="hover:opacity-70">
                                <Trash2 size={10} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-baseline gap-1">
                        <span style={{ fontFamily: FD, fontWeight: 700, letterSpacing: "-0.02em" }}
                              className="text-xl tabular-nums">
                          {total.toLocaleString(undefined, {
                            minimumFractionDigits: kpi.decimals || 0,
                            maximumFractionDigits: kpi.decimals || 0,
                          })}
                        </span>
                        {kpi.unit && <span style={{ opacity: 0.85, fontFamily: FM }} className="text-[9px]">{kpi.unit}</span>}
                      </div>

                      {/* Mini chart */}
                      <svg viewBox="0 0 80 24" style={{ width: "100%", height: 20, marginTop: 6 }}>
                        <defs>
                          <linearGradient id={`grad-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#fff" stopOpacity="0.4"/>
                            <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
                          </linearGradient>
                        </defs>
                        <polygon points={polygonPoints} fill={`url(#grad-${kpi.id})`} />
                        <polyline points={svgPoints} fill="none" stroke="white" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                      </svg>

                      {/* Trend or target */}
                      {trend ? (
                        <div className="flex items-center gap-1 mt-1.5">
                          <span style={{ opacity: 0.95, fontFamily: FM, fontWeight: 600 }} className="text-[9px]">
                            {trend.up ? "+" : ""}{trend.change.toFixed(1)}%
                          </span>
                          <span style={{ opacity: 0.7, fontFamily: FM }} className="text-[9px]">vs өмнөх</span>
                        </div>
                      ) : kpi.target && entries.length > 0 ? (() => {
                        let targetTotal = Number(kpi.target);
                        if (kpi.target_period === "daily") {
                          const days = Math.max(1, Math.ceil((new Date(periodRange.end) - new Date(periodRange.start)) / 86400000) + 1);
                          targetTotal = Number(kpi.target) * days;
                        } else if (kpi.target_period === "weekly") {
                          const weeks = Math.max(1, Math.ceil((new Date(periodRange.end) - new Date(periodRange.start)) / (7 * 86400000)));
                          targetTotal = Number(kpi.target) * weeks;
                        }
                        const percent = targetTotal > 0 ? (total / targetTotal) * 100 : 0;
                        return (
                          <div className="mt-1.5">
                            <div className="flex items-center justify-between text-[9px] mb-1">
                              <span style={{ opacity: 0.85, fontFamily: FM }}>🎯 {targetTotal.toLocaleString()}</span>
                              <span style={{ opacity: 0.95, fontFamily: FM, fontWeight: 600 }}>
                                {percent.toFixed(0)}%
                              </span>
                            </div>
                            <div style={{ background: "rgba(255,255,255,0.25)", height: 3, borderRadius: 999, overflow: "hidden" }}>
                              <div style={{
                                width: `${Math.min(percent, 100)}%`,
                                height: "100%",
                                background: "white",
                                transition: "width 0.5s ease",
                              }} />
                            </div>
                          </div>
                        );
                      })() : (
                        <div style={{ opacity: 0.7, fontFamily: FM }} className="text-[9px] mt-1.5">
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
function KpiDefFormModal({ mode, kpi, departments, allKpis = [], onSave, onClose }) {
  const [name, setName] = useState(kpi?.name || "");
  const [unit, setUnit] = useState(kpi?.unit || "");
  const [departmentId, setDepartmentId] = useState(kpi?.department_id || (departments[0]?.id || ""));
  const [category, setCategory] = useState(kpi?.category || "");
  const [order, setOrder] = useState(kpi?.display_order || 0);
  const [target, setTarget] = useState(kpi?.target ? String(kpi.target) : "");
  const [targetPeriod, setTargetPeriod] = useState(kpi?.target_period || "daily");
  const [kpiType, setKpiType] = useState(kpi?.kpi_type || "input");
  const [numeratorId, setNumeratorId] = useState(kpi?.formula?.numerator_id || "");
  const [denominatorId, setDenominatorId] = useState(kpi?.formula?.denominator_id || "");
  const [operator, setOperator] = useState(kpi?.formula?.operator || "divide");
  const [decimals, setDecimals] = useState(kpi?.decimals ?? 2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Энэ хэлтсийн KPI-уудаас сонгох (өөрөөсөө бусад)
  // Бүх хэлтсийн KPI-уудаас сонгох (хэлтэс бүрээр бүлэглэсэн)
  const allInputKpis = allKpis.filter((k) => k.id !== kpi?.id && k.kpi_type !== "calculated");
  const kpisByDept = useMemo(() => {
    const grouped = {};
    allInputKpis.forEach((k) => {
      const dept = departments.find((d) => d.id === k.department_id);
      const deptName = dept?.name || "Бусад";
      if (!grouped[deptName]) grouped[deptName] = [];
      grouped[deptName].push(k);
    });
    return grouped;
  }, [allInputKpis, departments]);

  const submit = async () => {
    setErr("");
    if (!name.trim()) return setErr("KPI-ийн нэр оруулна уу");
    if (!departmentId) return setErr("Хэлтэс сонгоно уу");
    if (kpiType === "calculated" && (!numeratorId || !denominatorId)) {
      return setErr("Тооцооллын KPI: эх KPI-ууд сонгоно уу");
    }
    setBusy(true);
    await onSave({
      id: kpi?.id || null,
      department_id: departmentId,
      name: name.trim(),
      unit: unit.trim(),
      category: category.trim() || null,
      display_order: parseInt(order) || 0,
      target: target ? Number(target) : null,
      target_period: targetPeriod,
      kpi_type: kpiType,
      formula: kpiType === "calculated" ? {
        numerator_id: numeratorId,
        denominator_id: denominatorId,
        operator,
      } : null,
      decimals: parseInt(decimals) || 0,
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

        {/* KPI төрөл сонгох */}
        <Field label="KPI төрөл">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setKpiType("input")}
              className={`press-btn px-3 py-2.5 rounded-lg text-xs ${kpiType === "input" ? "tab-active" : "tab-inactive glass-soft"}`}
              style={{ fontFamily: FM, border: "1px solid", borderColor: kpiType === "input" ? "transparent" : T.borderSoft }}>
              ✍ Гар оруулах
            </button>
            <button type="button" onClick={() => setKpiType("calculated")}
              className={`press-btn px-3 py-2.5 rounded-lg text-xs ${kpiType === "calculated" ? "tab-active" : "tab-inactive glass-soft"}`}
              style={{ fontFamily: FM, border: "1px solid", borderColor: kpiType === "calculated" ? "transparent" : T.borderSoft }}>
              🧮 Тооцоолох
            </button>
          </div>
        </Field>

        {/* Тооцооллын KPI бол формула UI */}
        {kpiType === "calculated" && (
          <div className="glass-soft rounded-lg p-3 space-y-2">
            <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider mb-1">
              🧮 Формул (бүх хэлтсийн KPI-аас сонгож болно)
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
              <select value={numeratorId} onChange={(e) => setNumeratorId(e.target.value)}
                style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                className="px-2 py-2 rounded-lg border text-xs outline-none">
                <option value="">— Сонгох —</option>
                {Object.entries(kpisByDept).map(([deptName, kpis]) => (
                  <optgroup key={deptName} label={`📂 ${deptName}`}>
                    {kpis.map((k) => (
                      <option key={k.id} value={k.id}>{k.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <select value={operator} onChange={(e) => setOperator(e.target.value)}
                style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM, fontSize: 18, fontWeight: 600 }}
                className="px-2 py-2 rounded-lg border outline-none text-center">
                <option value="divide">÷</option>
                <option value="multiply">×</option>
                <option value="add">+</option>
                <option value="subtract">−</option>
              </select>
              <select value={denominatorId} onChange={(e) => setDenominatorId(e.target.value)}
                style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
                className="px-2 py-2 rounded-lg border text-xs outline-none">
                <option value="">— Сонгох —</option>
                {Object.entries(kpisByDept).map(([deptName, kpis]) => (
                  <optgroup key={deptName} label={`📂 ${deptName}`}>
                    {kpis.map((k) => (
                      <option key={k.id} value={k.id}>{k.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Хэлтэс хоорондын тооцоолол байгаа эсэхийг харуулах */}
            {numeratorId && denominatorId && (() => {
              const num = allInputKpis.find((k) => k.id === numeratorId);
              const den = allInputKpis.find((k) => k.id === denominatorId);
              if (!num || !den) return null;
              const numDept = departments.find((d) => d.id === num.department_id);
              const denDept = departments.find((d) => d.id === den.department_id);
              const sameDept = num.department_id === den.department_id;
              return (
                <div style={{ background: sameDept ? T.highlightSoft : "rgba(245,158,11,0.1)", color: sameDept ? T.highlight : T.warn, fontFamily: FM }}
                     className="text-[10px] px-2 py-1.5 rounded">
                  {sameDept ? "✓" : "🔀"} {numDept?.name || "?"} · {num.name}
                  {" "}{operator === "divide" ? "÷" : operator === "multiply" ? "×" : operator === "add" ? "+" : "−"}{" "}
                  {denDept?.name || "?"} · {den.name}
                  {!sameDept && " (хэлтэс хооронд)"}
                </div>
              );
            })()}

            <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] mt-1">
              💡 Энэ KPI-д хүн утга оруулахгүй — автомат тооцоолно
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Хэмжих нэгж">
            <Input value={unit} onChange={setUnit} placeholder="₮, тоо, %" />
          </Field>
          {kpiType === "calculated" ? (
            <Field label="Аравтын орон">
              <Input value={String(decimals)} onChange={setDecimals} type="number" placeholder="2" />
            </Field>
          ) : (
            <Field label="Дараалал">
              <Input value={String(order)} onChange={setOrder} type="number" placeholder="0" />
            </Field>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="🎯 Зорилт (заавал биш)">
            <Input value={target} onChange={setTarget} type="number" placeholder="14581" />
          </Field>
          <Field label="Зорилтын хугацаа">
            <select value={targetPeriod} onChange={(e) => setTargetPeriod(e.target.value)}
              style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none">
              <option value="daily">Өдөр бүр</option>
              <option value="weekly">7 хоног бүр</option>
              <option value="monthly">Сар бүр</option>
            </select>
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

  // Зөвхөн input KPI-уудыг харуулах (calculated биш)
  const inputKpis = kpiDefs.filter((k) => k.kpi_type !== "calculated");

  // Date солигдох тоолон утгуудыг ачаалах
  useEffect(() => {
    const initial = {};
    inputKpis.forEach((k) => {
      const existing = existingEntries.find(e => e.kpi_id === k.id && e.entry_date === date);
      initial[k.id] = existing ? String(existing.value) : "";
    });
    setValues(initial);
  }, [date, inputKpis.length]);

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
          {inputKpis.length === 0 ? (
            <div className="glass-soft rounded-xl p-4 text-center">
              <p style={{ color: T.muted }} className="text-sm">Энэ хэлтэст KPI тохируулаагүй байна</p>
            </div>
          ) : (
            inputKpis.map((k) => (
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
          <button onClick={submit} disabled={busy || inputKpis.length === 0}
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
                              background: "#ec4899",
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
                                background: "#ec4899",
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

// ═══════════════════════════════════════════════════════════════════════════
//  ANNOUNCEMENTS VIEW
// ═══════════════════════════════════════════════════════════════════════════
const ANN_PRIORITY = {
  normal: { label: "Энгийн", color: T.muted, bg: "rgba(107,114,128,0.1)", emoji: "📢" },
  important: { label: "Чухал", color: T.highlight, bg: T.highlightSoft, emoji: "⭐" },
  urgent: { label: "Яаралтай", color: T.err, bg: "rgba(239,68,68,0.12)", emoji: "🚨" },
};

function AnnouncementsView({ announcements, isAdmin, onAdd, onEdit, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(null);

  return (
    <div className="space-y-4 fade-in">
      {isAdmin && (
        <div className="flex justify-end slide-up">
          <button onClick={onAdd}
            className="glow-primary press-btn px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2"
            style={{ fontFamily: FS }}>
            <Plus size={14} /> Зарлал нэмэх
          </button>
        </div>
      )}

      {announcements.length === 0 ? (
        <div className="glass rounded-3xl py-12 px-6 text-center slide-up-delay-1" style={{ color: T.muted }}>
          <Inbox size={28} className="mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm">Зарлал алга</p>
        </div>
      ) : (
        <div className="space-y-3 slide-up-delay-1">
          {announcements.map((a, i) => {
            const p = ANN_PRIORITY[a.priority] || ANN_PRIORITY.normal;
            const isExpired = a.expires_at && new Date(a.expires_at) < new Date();
            return (
              <article key={a.id}
                className={`${a.pinned ? "glass-strong" : "glass"} lift rounded-3xl p-5 slide-up ${isExpired ? "opacity-50" : ""}`}
                style={a.pinned ? { borderColor: p.color, borderWidth: 2 } : {}}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.pinned && (
                      <span style={{ background: T.highlightSoft, color: T.highlight, fontFamily: FM }}
                            className="px-2 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold">
                        📌 Бэхэлсэн
                      </span>
                    )}
                    <span style={{ background: p.bg, color: p.color, fontFamily: FM }}
                          className="px-2 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold">
                      {p.emoji} {p.label}
                    </span>
                    {isExpired && (
                      <span style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider">
                        Хугацаа дууссан
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => onEdit(a)} style={{ color: T.muted }}
                        className="hover:text-black p-1">
                        <Edit3 size={12} />
                      </button>
                      <button onClick={() => setConfirmDel(a)} style={{ color: T.err }} className="p-1">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>

                <h3 style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.02em" }}
                    className="text-xl mb-2">
                  {a.title}
                </h3>

                <p style={{ color: T.ink, fontFamily: FS }} className="text-sm leading-relaxed whitespace-pre-wrap">
                  {a.body}
                </p>

                <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: T.borderSoft }}>
                  <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-wider">
                    {new Date(a.created_at).toLocaleString("mn-MN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {a.expires_at && (
                    <span style={{ color: T.muted, fontFamily: FM }} className="text-[10px]">
                      ⏰ {new Date(a.expires_at).toLocaleDateString("mn-MN")} хүртэл
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)} title="Зарлал устгах?" maxW="max-w-sm">
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
//  ANNOUNCEMENT FORM MODAL
// ═══════════════════════════════════════════════════════════════════════════
function AnnouncementFormModal({ mode, announcement, onSave, onClose }) {
  const [title, setTitle] = useState(announcement?.title || "");
  const [body, setBody] = useState(announcement?.body || "");
  const [priority, setPriority] = useState(announcement?.priority || "normal");
  const [pinned, setPinned] = useState(announcement?.pinned || false);
  const [expiresAt, setExpiresAt] = useState(announcement?.expires_at ? announcement.expires_at.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!title.trim()) return setErr("Гарчиг бичнэ үү");
    if (!body.trim()) return setErr("Агуулга бичнэ үү");
    setBusy(true);
    await onSave({
      id: announcement?.id || null,
      title: title.trim(),
      body: body.trim(),
      priority,
      pinned,
      expires_at: expiresAt ? new Date(expiresAt + "T23:59:59").toISOString() : null,
    });
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={mode === "add" ? "Шинэ зарлал" : "Зарлал засах"}>
      <div className="space-y-4">
        <Field label="Гарчиг" required>
          <Input value={title} onChange={setTitle} placeholder="Жишээ: Маргааш баяр өдөр" autoFocus />
        </Field>

        <Field label="Агуулга" required>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
            placeholder="Зарлалын дэлгэрэнгүй мэдээлэл"
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FS }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none resize-none" />
        </Field>

        <Field label="Зэрэг">
          <div className="flex gap-1.5">
            {Object.entries(ANN_PRIORITY).map(([k, v]) => (
              <button key={k} onClick={() => setPriority(k)}
                className={`${priority === k ? "tab-active" : "tab-inactive glass-soft"} press-btn flex-1 py-2 rounded-lg text-[10px] uppercase tracking-wider`}
                style={{ fontFamily: FM, borderColor: priority === k ? "transparent" : T.borderSoft, border: "1px solid" }}>
                {v.emoji} {v.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Дуусах огноо (заавал биш)">
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
            style={{ borderColor: T.border, background: "rgba(255,255,255,0.7)", color: T.ink, fontFamily: FM }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none" />
        </Field>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          <span style={{ fontFamily: FM }} className="text-sm">📌 Дээр бэхлэх</span>
        </label>

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
