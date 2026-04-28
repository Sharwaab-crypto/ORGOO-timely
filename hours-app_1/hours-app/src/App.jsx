import React, { useState, useEffect, useMemo } from "react";
import {
  Plus, Play, Square, Trash2, X, Users, Calendar, MapPin, Edit3,
  AlertCircle, CheckCircle2, Loader2, Crosshair, LogOut, Lock,
  ClipboardCheck, Clock, Inbox, FileText, Send,
  ShieldCheck, User as UserIcon, Eye, EyeOff,
} from "lucide-react";
import { supabase, isConfigured } from "./supabaseClient";

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

const checkSchedule = (profile, when = new Date()) => {
  if (!profile?.schedule_days?.length) return { ok: true, reason: null };
  const dayKey = DAY_KEYS[when.getDay()];
  if (!profile.schedule_days.includes(dayKey)) {
    return { ok: false, reason: `Өнөөдөр (${DAY_FULL[dayKey]}) ажлын өдөр биш` };
  }
  const start = setTimeOnDate(when, profile.schedule_start);
  const end = setTimeOnDate(when, profile.schedule_end);
  const buffer = 5 * 60 * 1000;
  if (when.getTime() < start - buffer) return { ok: false, reason: `Ээлж ${profile.schedule_start} цагт эхэлнэ` };
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
  return Math.max(startTime, setTimeOnDate(d, profile.schedule_start));
};

const hasSite = (p) => p?.site_lat != null && p?.site_lng != null;
const siteOf = (p) => ({ lat: p.site_lat, lng: p.site_lng, radius: p.site_radius || 100, label: p.site_label });

// ─────────── design tokens ───────────
const T = {
  bg: "#fafaf7", surface: "#ffffff", surfaceAlt: "#f4f3ee",
  ink: "#0a0a0a", inkSoft: "#27272a",
  muted: "#71717a", mutedSoft: "#a1a1aa",
  border: "#e7e5de", borderSoft: "#f0eee8",
  highlight: "#ea580c", highlightSoft: "#fef3ec",
  ok: "#15803d", okSoft: "#ecfdf3",
  err: "#b91c1c", errSoft: "#fef1f1",
  warn: "#b45309", warnSoft: "#fef7e6",
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
  if (!session) return <LoginScreen />;
  if (!profile) {
    return (
      <CenterCard>
        <Loader2 size={24} className="animate-spin mb-4 mx-auto" style={{ color: T.muted }} />
        <p style={{ color: T.muted }} className="text-sm mb-4">Профайл татаж байна…</p>
        <p style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] mb-3">
          Профайл олдсонгүй гэж гарвал админд хандаарай
        </p>
        <button onClick={() => supabase.auth.signOut()}
          style={{ borderColor: T.border, fontFamily: FS }}
          className="w-full py-2 rounded-xl border text-sm hover:bg-black/5">
          Гарах
        </button>
      </CenterCard>
    );
  }

  if (profile.role === "admin") return <AdminDashboard profile={profile} />;
  return <EmployeeDashboard profile={profile} />;
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
    <div style={{ background: T.bg, color: T.ink, fontFamily: FS }} className="min-h-screen flex items-center justify-center p-5">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.3em] mb-3">
            Time Ledger
          </div>
          <h1 style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.04em", lineHeight: 0.95 }} className="text-6xl">
            Hours<span style={{ color: T.highlight }}>.</span>
          </h1>
        </div>

        <div style={{ background: T.surface, borderColor: T.border }} className="border rounded-2xl p-6 space-y-4">
          <Field label="Имэйл">
            <Input value={email} onChange={setEmail} placeholder="you@example.com" autoFocus
              onEnter={() => document.getElementById("lpw")?.focus()} />
          </Field>
          <Field label="Нууц үг">
            <PwInput id="lpw" value={password} onChange={setPassword} onEnter={submit} />
          </Field>
          {err && <ErrorBox>{err}</ErrorBox>}
          <button onClick={submit} disabled={busy || !email.trim() || !password}
            style={{ background: T.ink, color: T.surface }}
            className="w-full py-3 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
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
  const [, setTick] = useState(0);

  const [formMode, setFormMode] = useState(null);
  const [formEmp, setFormEmp] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [geoBusyId, setGeoBusyId] = useState(null);

  useEffect(() => { const id = setInterval(() => setTick((t) => t+1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (!feedback) return; const t = setTimeout(() => setFeedback(null), 5000); return () => clearTimeout(t); }, [feedback]);

  const loadAll = async () => {
    const [emps, sess, active, apps] = await Promise.all([
      supabase.from("profiles").select("*").eq("role", "employee").order("created_at", { ascending: false }),
      supabase.from("sessions").select("*").order("start_time", { ascending: false }).limit(200),
      supabase.from("active_sessions").select("*"),
      supabase.from("approvals").select("*").order("created_at", { ascending: false }),
    ]);
    if (emps.data) setEmployees(emps.data);
    if (sess.data) setSessions(sess.data);
    if (active.data) {
      const map = {};
      active.data.forEach((a) => { map[a.employee_id] = a; });
      setActiveSessions(map);
    }
    if (apps.data) setApprovals(apps.data);
  };

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    const ch = supabase.channel("admin-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "active_sessions" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  const upsertEmployee = async ({ formData, password, isNew, existingId }) => {
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
        role: "employee",
        name: formData.name,
        job_title: formData.job_title,
        hourly_rate: formData.hourly_rate,
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

  const tryClockIn = async (emp) => {
    if (!hasSite(emp)) { setFeedback({ empId: emp.id, type: "error", msg: "Ажлын байр тогтоогоогүй" }); return; }
    const sched = checkSchedule(emp);
    if (!sched.ok) { setFeedback({ empId: emp.id, type: "error", msg: sched.reason }); return; }
    setGeoBusyId(emp.id);
    try {
      const loc = await getLocation();
      const d = distanceMeters(loc, siteOf(emp));
      if (d > emp.site_radius) {
        setFeedback({ empId: emp.id, type: "error", msg: `Хязгаараас гадуур — ${fmtDist(d)} (${emp.site_radius}m)` });
        return;
      }
      const startTime = new Date(capSessionStart(emp, Date.now())).toISOString();
      const { error } = await supabase.from("active_sessions").upsert({
        employee_id: emp.id, start_time: startTime,
        start_lat: loc.lat, start_lng: loc.lng, distance_meters: d,
      });
      if (error) throw error;
      setFeedback({ empId: emp.id, type: "success", msg: `Цаг бүртгэгдлээ · ${fmtDist(d)}` });
      await loadAll();
    } catch (e) { setFeedback({ empId: emp.id, type: "error", msg: e.message }); }
    finally { setGeoBusyId(null); }
  };

  const tryClockOut = async (emp) => {
    const entry = activeSessions[emp.id];
    if (!entry) return;
    setGeoBusyId(emp.id);
    try {
      let endLoc = null;
      if (hasSite(emp)) {
        try {
          endLoc = await getLocation();
          const ed = distanceMeters(endLoc, siteOf(emp));
          if (ed > emp.site_radius) {
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
      });
      if (insErr) throw insErr;
      const { error: delErr } = await supabase.from("active_sessions").delete().eq("employee_id", emp.id);
      if (delErr) throw delErr;
      setFeedback({ empId: emp.id, type: "success", msg: "Цаг буулаа" });
      await loadAll();
    } catch (e) { setFeedback({ empId: emp.id, type: "error", msg: e.message }); }
    finally { setGeoBusyId(null); }
  };

  const resolveApproval = async (approval, decision) => {
    const updates = {
      status: decision, resolved_at: new Date().toISOString(), resolved_by: profile.id,
    };
    const { error: updErr } = await supabase.from("approvals").update(updates).eq("id", approval.id);
    if (updErr) { setFeedback({ type: "error", msg: updErr.message }); return; }

    if (decision === "approved") {
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
      .reduce((a, s) => a + (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()), 0);
    const live = Object.entries(activeSessions).reduce((a, [id, e]) => {
      const st = new Date(e.start_time).getTime();
      if (st < t) return a;
      const emp = employees.find((x) => x.id === id);
      const capped = capSessionEnd(emp, Date.now());
      return a + Math.max(0, capped - st);
    }, 0);
    return closed + live;
  }, [sessions, activeSessions, employees]);

  const activeCount = Object.keys(activeSessions).length;

  return (
    <div style={{ background: T.bg, color: T.ink, fontFamily: FS }} className="min-h-screen">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 sm:py-10">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <div style={{ background: T.ink, color: T.surface }} className="w-9 h-9 rounded-xl flex items-center justify-center">
              <ShieldCheck size={16} />
            </div>
            <div>
              <div style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.03em" }} className="text-2xl leading-none">
                Hours<span style={{ color: T.highlight }}>.</span>
              </div>
              <div style={{ fontFamily: FM, color: T.muted }} className="text-[10px] uppercase tracking-[0.25em] mt-1">
                Admin · {profile.name}
              </div>
            </div>
          </div>
          <button onClick={() => supabase.auth.signOut()} style={{ borderColor: T.border, fontFamily: FM }}
            className="px-3 py-2 rounded-lg border text-[11px] uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-black/5">
            <LogOut size={12} /> Гарах
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
          <BigStat label="Ажиллаж буй" value={activeCount} accent={activeCount > 0} />
          <BigStat label="Өнөөдөр" value={fmtHours(teamTodayMs)} suffix="цаг" />
          <BigStat label="Ажилтан" value={employees.length} />
        </div>

        <nav className="flex items-center gap-1.5 mb-6 flex-wrap">
          <Tab active={view === "team"} onClick={() => setView("team")} icon={Users}>Баг</Tab>
          <Tab active={view === "ledger"} onClick={() => setView("ledger")} icon={Calendar}>Тэмдэглэл</Tab>
          <Tab active={view === "approvals"} onClick={() => setView("approvals")} icon={Inbox} badge={pendingApprovals.length}>
            Хүсэлт
          </Tab>
          <div className="flex-1" />
          {view === "team" && (
            <button onClick={() => { setFormEmp(null); setFormMode("add"); }}
              style={{ background: T.ink, color: T.surface }}
              className="px-4 py-2 rounded-full text-[11px] uppercase tracking-[0.2em] flex items-center gap-1.5 hover:opacity-90">
              <Plus size={13} strokeWidth={2.5} /> Ажилтан нэмэх
            </button>
          )}
        </nav>

        {feedback && !feedback.empId && (
          <div className="mb-4"><FeedbackBox type={feedback.type}>{feedback.msg}</FeedbackBox></div>
        )}

        {view === "team" && (
          <TeamView
            employees={employees} sessions={sessions} activeSessions={activeSessions}
            geoBusyId={geoBusyId} feedback={feedback}
            onEdit={(emp) => { setFormEmp(emp); setFormMode("edit"); }}
            onDelete={(id) => setConfirmDel(id)}
            onClockIn={tryClockIn} onClockOut={tryClockOut}
            onAdd={() => { setFormEmp(null); setFormMode("add"); }} />
        )}
        {view === "ledger" && <LedgerView sessions={sessions} employees={employees} />}
        {view === "approvals" && (
          <ApprovalsView approvals={approvals} employees={employees} onResolve={resolveApproval} />
        )}

        <Footer count={sessions.length} />
      </div>

      {formMode && (
        <EmployeeFormModal
          mode={formMode} employee={formEmp}
          onSave={upsertEmployee}
          onClose={() => { setFormMode(null); setFormEmp(null); }} />
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
  const [feedback, setFeedback] = useState(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => { const id = setInterval(() => setTick((t) => t+1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (!feedback) return; const t = setTimeout(() => setFeedback(null), 5000); return () => clearTimeout(t); }, [feedback]);

  const loadMy = async () => {
    const [sess, active, apps] = await Promise.all([
      supabase.from("sessions").select("*").eq("employee_id", profile.id).order("start_time", { ascending: false }).limit(60),
      supabase.from("active_sessions").select("*").eq("employee_id", profile.id).maybeSingle(),
      supabase.from("approvals").select("*").eq("employee_id", profile.id).order("created_at", { ascending: false }),
    ]);
    if (sess.data) setMySessions(sess.data);
    setMyActive(active.data || null);
    if (apps.data) setMyApprovals(apps.data);
  };

  useEffect(() => { loadMy(); }, []);

  useEffect(() => {
    const ch = supabase.channel(`employee-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `employee_id=eq.${profile.id}` }, () => loadMy())
      .on("postgres_changes", { event: "*", schema: "public", table: "active_sessions", filter: `employee_id=eq.${profile.id}` }, () => loadMy())
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals", filter: `employee_id=eq.${profile.id}` }, () => loadMy())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile.id]);

  const isActive = !!myActive;
  const liveMs = isActive ? capSessionEnd(profile, Date.now()) - new Date(myActive.start_time).getTime() : 0;

  const stats = useMemo(() => {
    const cap = (list) => list.reduce((a, s) => a + (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()), 0);
    const today = mySessions.filter((s) => new Date(s.start_time).getTime() >= startOfDay());
    const week = mySessions.filter((s) => new Date(s.start_time).getTime() >= startOfWeek());
    const live = isActive ? Math.max(0, liveMs) : 0;
    return { today: cap(today) + live, week: cap(week) + live, total: cap(mySessions) + live };
  }, [mySessions, isActive, liveMs]);

  const onClockIn = async () => {
    if (!hasSite(profile)) { setFeedback({ type: "error", msg: "Ажлын байр тогтоогоогүй. Админд хандаарай." }); return; }
    const sched = checkSchedule(profile);
    if (!sched.ok) { setFeedback({ type: "error", msg: sched.reason }); return; }
    setGeoBusy(true);
    try {
      const loc = await getLocation();
      const d = distanceMeters(loc, siteOf(profile));
      if (d > profile.site_radius) {
        setFeedback({ type: "error", msg: `Хязгаараас гадуур — ${fmtDist(d)}` });
        return;
      }
      const startTime = new Date(capSessionStart(profile, Date.now())).toISOString();
      const { error } = await supabase.from("active_sessions").upsert({
        employee_id: profile.id, start_time: startTime,
        start_lat: loc.lat, start_lng: loc.lng, distance_meters: d,
      });
      if (error) throw error;
      setFeedback({ type: "success", msg: `Цаг бүртгэгдлээ · ${fmtDist(d)}` });
      await loadMy();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
    finally { setGeoBusy(false); }
  };

  const onClockOut = async () => {
    if (!myActive) return;
    setGeoBusy(true);
    try {
      let endLoc = null;
      if (hasSite(profile)) {
        try {
          endLoc = await getLocation();
          const ed = distanceMeters(endLoc, siteOf(profile));
          if (ed > profile.site_radius) {
            setFeedback({ type: "error", msg: `Гарах боломжгүй — ${fmtDist(ed)} зайтай` });
            return;
          }
        } catch (e) { setFeedback({ type: "error", msg: e.message }); return; }
      }
      const startMs = new Date(myActive.start_time).getTime();
      const cappedEnd = capSessionEnd(profile, Date.now());
      const endMs = Math.max(startMs + 1000, cappedEnd);

      const { error: insErr } = await supabase.from("sessions").insert({
        employee_id: profile.id,
        start_time: new Date(startMs).toISOString(),
        end_time: new Date(endMs).toISOString(),
        start_lat: myActive.start_lat, start_lng: myActive.start_lng,
        end_lat: endLoc?.lat, end_lng: endLoc?.lng,
      });
      if (insErr) throw insErr;
      await supabase.from("active_sessions").delete().eq("employee_id", profile.id);
      setFeedback({ type: "success", msg: "Цаг буулаа" });
      await loadMy();
    } catch (e) { setFeedback({ type: "error", msg: e.message }); }
    finally { setGeoBusy(false); }
  };

  const submitRequest = async ({ start, end, reason }) => {
    const { error } = await supabase.from("approvals").insert({
      employee_id: profile.id,
      proposed_start: new Date(start).toISOString(),
      proposed_end: new Date(end).toISOString(),
      reason, status: "pending",
    });
    if (error) { setFeedback({ type: "error", msg: error.message }); return; }
    setShowRequest(false);
    setFeedback({ type: "success", msg: "Хүсэлт админ руу илгээгдлээ" });
    await loadMy();
  };

  const sched = profile ? checkSchedule(profile) : { ok: true };
  const noSite = !hasSite(profile);
  const cantClock = !isActive && (noSite || !sched.ok);

  return (
    <div style={{ background: T.bg, color: T.ink, fontFamily: FS }} className="min-h-screen">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-6 sm:py-10">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div style={{ background: isActive ? T.highlight : T.ink, color: T.surface }}
                 className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors">
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
          <button onClick={() => supabase.auth.signOut()} style={{ borderColor: T.border, fontFamily: FM }}
            className="px-3 py-2 rounded-lg border text-[11px] uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-black/5">
            <LogOut size={12} /> Гарах
          </button>
        </div>

        <nav className="flex items-center gap-1.5 mb-6 flex-wrap">
          <Tab active={view === "home"} onClick={() => setView("home")} icon={Clock}>Цаг</Tab>
          <Tab active={view === "history"} onClick={() => setView("history")} icon={Calendar}>Түүх</Tab>
          <Tab active={view === "requests"} onClick={() => setView("requests")} icon={ClipboardCheck}
               badge={myApprovals.filter((a) => a.status === "pending").length}>Хүсэлт</Tab>
        </nav>

        {view === "home" && (
          <div className="space-y-5">
            <div style={{ background: T.surface, borderColor: isActive ? T.highlight : T.border, borderWidth: isActive ? 2 : 1 }}
                 className="rounded-2xl p-6 sm:p-8 transition-all">
              <div className="flex items-center gap-2 mb-1">
                <span style={{ background: isActive ? T.highlight : T.muted, boxShadow: isActive ? `0 0 0 5px ${T.highlight}1a` : "none" }}
                      className="inline-block w-2 h-2 rounded-full" />
                <span style={{ fontFamily: FM, color: isActive ? T.highlight : T.muted }}
                      className="text-[10px] uppercase tracking-[0.25em] font-medium">
                  {isActive ? "Ажиллаж байна" : "Цагтай биш"}
                </span>
              </div>

              <div className="my-5">
                <div style={{ fontFamily: FM, fontWeight: 500, color: isActive ? T.highlight : T.ink, letterSpacing: "-0.03em" }}
                     className="text-5xl sm:text-6xl tabular-nums">
                  {isActive ? fmtClock(liveMs) : "00:00:00"}
                </div>
                {isActive && (
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-xs mt-2">
                    {fmtTime(new Date(myActive.start_time).getTime())}-аас эхэлсэн
                  </div>
                )}
              </div>

              <div className="space-y-2 mb-5 pb-5 border-b" style={{ borderColor: T.borderSoft }}>
                <InfoRow icon={MapPin} label="Ажлын байр"
                  value={hasSite(profile) ? `${profile.site_label || `${fmtCoord(profile.site_lat)}, ${fmtCoord(profile.site_lng)}`} · ${profile.site_radius}m` : "Тогтоогоогүй"}
                  warn={!hasSite(profile)} />
                <InfoRow icon={Clock} label="Цагийн хуваарь"
                  value={profile.schedule_days?.length ? `${profile.schedule_days.map((d) => DAY_LABELS[d]).join("·")} ${profile.schedule_start}–${profile.schedule_end}` : "Хязгааргүй"} />
              </div>

              {feedback && <FeedbackBox type={feedback.type}>{feedback.msg}</FeedbackBox>}
              {!isActive && profile.schedule_days?.length && !sched.ok && (
                <div className="mb-3"><FeedbackBox type="warn">{sched.reason}</FeedbackBox></div>
              )}

              <button onClick={() => isActive ? onClockOut() : onClockIn()}
                disabled={geoBusy || cantClock}
                style={{
                  background: geoBusy ? T.muted : isActive ? T.ink : cantClock ? T.muted : T.highlight,
                  color: T.surface, fontFamily: FS,
                  cursor: cantClock ? "not-allowed" : "pointer", opacity: cantClock ? 0.5 : 1,
                }}
                className="w-full py-4 rounded-xl text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
                {geoBusy ? <><Loader2 size={14} className="animate-spin" /> Байршил шалгаж байна…</>
                  : isActive ? <><Square size={13} fill="currentColor" /> Цаг буулгах</>
                  : noSite ? <><MapPin size={13} /> Ажлын байр тогтоогоогүй</>
                  : !sched.ok ? <><Clock size={13} /> Цагийн хязгаараас гадуур</>
                  : <><Play size={13} fill="currentColor" /> Цаг бүртгүүлэх</>}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <SmallStat label="Өнөөдөр" value={fmtHours(stats.today)} />
              <SmallStat label="Энэ долоо хоног" value={fmtHours(stats.week)} />
              <SmallStat label="Нийт" value={fmtHours(stats.total)} />
            </div>

            <button onClick={() => setShowRequest(true)}
              style={{ borderColor: T.border, color: T.muted, fontFamily: FM }}
              className="w-full py-3 rounded-xl border-dashed border-2 text-[11px] uppercase tracking-[0.2em] hover:bg-black/5 flex items-center justify-center gap-2">
              <FileText size={12} /> Цагаа мартсан уу? Хүсэлт явуул
            </button>
          </div>
        )}

        {view === "history" && <PersonalHistory sessions={mySessions} />}
        {view === "requests" && <PersonalRequests approvals={myApprovals} onNew={() => setShowRequest(true)} />}

        <Footer count={mySessions.length} />
      </div>

      {showRequest && (
        <RequestModal profile={profile} onClose={() => setShowRequest(false)} onSubmit={submitRequest} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEAM VIEW
// ═══════════════════════════════════════════════════════════════════════════
function TeamView({ employees, sessions, activeSessions, geoBusyId, feedback, onEdit, onDelete, onClockIn, onClockOut, onAdd }) {
  if (employees.length === 0) {
    return (
      <div style={{ borderColor: T.border, background: T.surface }}
           className="border-2 border-dashed rounded-2xl py-16 px-6 text-center">
        <Users size={32} style={{ color: T.muted }} strokeWidth={1.5} className="mx-auto mb-4" />
        <h3 style={{ fontFamily: FD, fontWeight: 500 }} className="text-2xl mb-2">Багт ажилтан байхгүй байна</h3>
        <p style={{ color: T.muted }} className="text-sm mb-5">Анхны ажилтнаа нэмж тэмдэглэлийг эхлүүлээрэй.</p>
        <button onClick={onAdd} style={{ background: T.ink, color: T.surface }}
          className="px-5 py-2.5 rounded-full text-[11px] uppercase tracking-[0.25em] inline-flex items-center gap-2 hover:opacity-90">
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
        const noSite = !hasSite(emp);
        const cantClock = !isActive && (noSite || !sched.ok);

        return (
          <article key={emp.id}
            style={{ background: T.surface, borderColor: isActive ? T.highlight : T.border, borderWidth: isActive ? 2 : 1 }}
            className="rounded-2xl p-5 transition-all">
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span style={{ background: isActive ? T.highlight : T.mutedSoft, boxShadow: isActive ? `0 0 0 4px ${T.highlight}1a` : "none" }}
                        className="inline-block w-1.5 h-1.5 rounded-full" />
                  <span style={{ fontFamily: FM, color: isActive ? T.highlight : T.muted }}
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
                <MapPin size={10} />{noSite ? "байргүй" : `${emp.site_radius}m`}
              </span>
              <span className="flex items-center gap-1">
                <Clock size={10} />
                {emp.schedule_days?.length ? `${emp.schedule_start}–${emp.schedule_end}` : "хязгааргүй"}
              </span>
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
function LedgerView({ sessions, employees }) {
  const recent = sessions.slice(0, 50);
  const empById = (id) => employees.find((e) => e.id === id);
  return (
    <div style={{ background: T.surface, borderColor: T.border }} className="rounded-2xl border overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b" style={{ borderColor: T.borderSoft }}>
        <h2 style={{ fontFamily: FD, fontWeight: 500 }} className="text-xl">Цагийн тэмдэглэл</h2>
        <p style={{ color: T.muted, fontFamily: FM }} className="text-[10px] uppercase tracking-[0.2em] mt-0.5">
          Нийт {sessions.length} бүртгэл
        </p>
      </div>
      {recent.length === 0 ? (
        <div className="px-6 py-14 text-center" style={{ color: T.muted }}>
          <p className="text-base">Бүртгэл алга байна</p>
        </div>
      ) : (
        <ul>
          {recent.map((s, i) => {
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
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-[10px] flex items-center gap-1.5 mt-0.5">
                    <span>{fmtTime(startMs)} → {fmtTime(endMs)}</span>
                    {s.start_lat && <span>· баталгаажсан</span>}
                    {s.from_approval && <span>· гар бичиг</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div style={{ fontFamily: FM, fontWeight: 500 }} className="text-base tabular-nums">
                    {fmtHours(endMs - startMs)}
                  </div>
                  <div style={{ color: T.muted, fontFamily: FM }} className="text-[9px] uppercase tracking-wider">цаг</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
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
        <div style={{ background: T.surface, borderColor: T.border, color: T.muted }}
             className="border rounded-2xl py-12 px-6 text-center">
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
              <div key={a.id} style={{ background: T.surface, borderColor: T.border }} className="border rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
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
                      style={{ borderColor: T.border, fontFamily: FS }}
                      className="flex-1 py-2.5 rounded-xl border text-xs font-medium hover:bg-black/5">
                      Татгалзах
                    </button>
                    <button onClick={() => onResolve(a, "approved")}
                      style={{ background: T.ok, color: T.surface, fontFamily: FS }}
                      className="flex-1 py-2.5 rounded-xl text-xs font-medium hover:opacity-90 flex items-center justify-center gap-1.5">
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
    <div style={{ background: T.surface, borderColor: T.border }} className="rounded-2xl border overflow-hidden">
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
      <button onClick={onNew} style={{ background: T.ink, color: T.surface, fontFamily: FS }}
        className="w-full py-3 rounded-xl text-sm font-medium hover:opacity-90 flex items-center justify-center gap-2">
        <Plus size={14} /> Шинэ хүсэлт явуулах
      </button>
      {approvals.length === 0 ? (
        <div style={{ background: T.surface, borderColor: T.border, color: T.muted }}
             className="border rounded-2xl py-10 px-6 text-center">
          <p className="text-sm">Илгээсэн хүсэлт алга</p>
        </div>
      ) : (
        <div className="space-y-2">
          {approvals.map((a) => {
            const startMs = new Date(a.proposed_start).getTime();
            const endMs = new Date(a.proposed_end).getTime();
            return (
              <div key={a.id} style={{ background: T.surface, borderColor: T.border }} className="border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
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
function EmployeeFormModal({ mode, employee, onSave, onClose }) {
  const [name, setName] = useState(employee?.name || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [jobTitle, setJobTitle] = useState(employee?.job_title || "");
  const [rate, setRate] = useState(employee?.hourly_rate ? String(employee.hourly_rate) : "");

  const [site, setSite] = useState(hasSite(employee) ? { lat: employee.site_lat, lng: employee.site_lng, accuracy: null } : null);
  const [siteLabel, setSiteLabel] = useState(employee?.site_label || "");
  const [radius, setRadius] = useState(employee?.site_radius || 100);
  const [siteBusy, setSiteBusy] = useState(false);
  const [siteError, setSiteError] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [manLat, setManLat] = useState(""); const [manLng, setManLng] = useState("");

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
      job_title: jobTitle.trim() || "Ажилтан",
      hourly_rate: parseFloat(rate) || 0,
      site_lat: site?.lat ?? null, site_lng: site?.lng ?? null,
      site_radius: site ? radius : null,
      site_label: site ? (siteLabel.trim() || null) : null,
      schedule_days: hasSchedule ? days : null,
      schedule_start: hasSchedule ? startTime : null,
      schedule_end: hasSchedule ? endTime : null,
    };

    await onSave({ formData, password, isNew: mode === "add", existingId: employee?.id });
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
          <Field label="Албан тушаал">
            <Input value={jobTitle} onChange={setJobTitle} placeholder="Дизайнер" />
          </Field>
          <Field label="Цагийн хөлс (заавал биш)">
            <div className="relative">
              <span style={{ color: T.muted, fontFamily: FM }} className="absolute left-3 top-1/2 -translate-y-1/2 text-sm">₮</span>
              <input value={rate} type="number" step="100" onChange={(e) => setRate(e.target.value)} placeholder="0"
                style={{ borderColor: T.border, background: T.bg, color: T.ink, fontFamily: FM }}
                className="w-full pl-8 pr-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
            </div>
          </Field>
        </Section>

        <Section title="Ажлын байр (геофенс)" subtitle="Зөвхөн энэ байршилд цаг бүртгүүлэх боломжтой">
          {!site ? (
            <div className="space-y-2">
              <button onClick={captureSite} disabled={siteBusy}
                style={{ background: T.ink, color: T.surface, fontFamily: FS }}
                className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50">
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
                      style={{ borderColor: T.border, background: T.bg, fontFamily: FM }}
                      className="px-3 py-2 rounded-md border text-xs outline-none" />
                    <input value={manLng} onChange={(e) => setManLng(e.target.value)} placeholder="Longitude"
                      style={{ borderColor: T.border, background: T.bg, fontFamily: FM }}
                      className="px-3 py-2 rounded-md border text-xs outline-none" />
                  </div>
                  <button onClick={applyManual} style={{ background: T.ink, color: T.surface, fontFamily: FS }}
                    className="w-full py-1.5 rounded-md text-[10px] uppercase tracking-[0.2em] hover:opacity-90">
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
                <button onClick={() => { setSite(null); setSiteLabel(""); }} style={{ color: T.ok }}
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
                    style={{ borderColor: T.border, background: T.bg, color: T.ink, fontFamily: FM }}
                    className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
                </Field>
                <Field label="Дуусах">
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                    style={{ borderColor: T.border, background: T.bg, color: T.ink, fontFamily: FM }}
                    className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
                </Field>
              </div>
            </div>
          )}
        </Section>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} style={{ borderColor: T.border, fontFamily: FS }}
            className="flex-1 py-3 rounded-xl border text-sm font-medium hover:bg-black/5">Цуцлах</button>
          <button onClick={submit} disabled={busy}
            style={{ background: T.ink, color: T.surface, fontFamily: FS }}
            className="flex-1 py-3 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
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
            style={{ borderColor: T.border, background: T.bg, color: T.ink, fontFamily: FM }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Эхэлсэн цаг">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)}
              style={{ borderColor: T.border, background: T.bg, color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
          </Field>
          <Field label="Дууссан цаг">
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)}
              style={{ borderColor: T.border, background: T.bg, color: T.ink, fontFamily: FM }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
          </Field>
        </div>
        <Field label="Шалтгаан / тайлбар" required>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="Жишээ: Утас цэнэглэгдээгүй байсан тул цаг бүртгүүлж амжсангүй"
            style={{ borderColor: T.border, background: T.bg, color: T.ink, fontFamily: FS }}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black resize-none" />
        </Field>
        {err && <ErrorBox>{err}</ErrorBox>}
        <div className="flex gap-3">
          <button onClick={onClose} style={{ borderColor: T.border, fontFamily: FS }}
            className="flex-1 py-3 rounded-xl border text-sm font-medium hover:bg-black/5">Цуцлах</button>
          <button onClick={submit} disabled={busy}
            style={{ background: T.ink, color: T.surface, fontFamily: FS }}
            className="flex-1 py-3 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
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
        <button onClick={onCancel} style={{ borderColor: T.border, fontFamily: FS }}
          className="flex-1 py-2.5 rounded-xl border text-sm hover:bg-black/5">Цуцлах</button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(10,10,10,0.4)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderColor: T.border }}
           className={`border rounded-2xl p-6 w-full ${maxW} shadow-xl max-h-[92vh] overflow-y-auto`}>
        {title && (
          <div className="flex items-center justify-between mb-5">
            <h3 style={{ fontFamily: FD, fontWeight: 500, letterSpacing: "-0.02em" }} className="text-2xl">{title}</h3>
            <button onClick={onClose} style={{ color: T.muted }} className="p-1.5 rounded-full hover:bg-black/5">
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
      style={{ borderColor: T.border, background: T.bg, color: T.ink, fontFamily: FS }}
      className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-black" />
  );
}

function PwInput({ value, onChange, onEnter, id }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter && onEnter()}
        style={{ borderColor: T.border, background: T.bg, color: T.ink, fontFamily: FM }}
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
    <div style={{ background: T.errSoft, color: T.err }} className="px-3 py-2 rounded-lg flex items-start gap-2">
      <AlertCircle size={13} className="mt-0.5 shrink-0" />
      <span style={{ fontFamily: FM }} className="text-[11px] leading-snug">{children}</span>
    </div>
  );
}

function FeedbackBox({ type, children }) {
  const colors = type === "error" ? { bg: T.errSoft, fg: T.err, Icon: AlertCircle }
              : type === "warn"  ? { bg: T.warnSoft, fg: T.warn, Icon: AlertCircle }
              : { bg: T.okSoft, fg: T.ok, Icon: CheckCircle2 };
  const { Icon } = colors;
  return (
    <div style={{ background: colors.bg, color: colors.fg }} className="px-3 py-2.5 rounded-lg flex items-start gap-2 mb-3">
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
      style={{ background: active ? T.ink : "transparent", color: active ? T.surface : T.ink,
               borderColor: active ? T.ink : T.border, fontFamily: FM }}
      className="px-3.5 py-1.5 rounded-full border text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5 hover:opacity-80">
      <Icon size={11} strokeWidth={2} />
      {children}
      {badge > 0 && (
        <span style={{ background: active ? T.surface : T.highlight, color: active ? T.ink : T.surface }}
              className="ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold tabular-nums">{badge}</span>
      )}
    </button>
  );
}

function BigStat({ label, value, suffix, accent }) {
  return (
    <div style={{ background: T.surface, borderColor: T.border }} className="border rounded-2xl px-5 py-4">
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
    <div style={{ background: T.surface, borderColor: T.border }} className="border rounded-xl p-3">
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
    <div style={{ background: T.bg, color: T.ink, fontFamily: FS }} className="min-h-screen flex items-center justify-center p-5">
      <div style={{ background: T.surface, borderColor: T.border }} className="border rounded-2xl p-7 w-full max-w-md text-center">
        {children}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div style={{ background: T.bg, color: T.ink, fontFamily: FS }} className="min-h-screen flex items-center justify-center">
      <Loader2 size={20} className="animate-spin" style={{ color: T.muted }} />
    </div>
  );
}
