"use client";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
type Role = "employee" | "supervisor" | "admin";
type Profile = {
  id: string;
  display_name: string;
  role: Role;
  organization_id: string;
  must_change_password: boolean;
  active: boolean;
};
type Card = {
  id: string;
  employee_id: string;
  month: string;
  status: "draft" | "submitted" | "returned" | "approved" | "amended";
  current_version: number;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  returned_at: string | null;
  return_reason: string | null;
  profiles?: { display_name: string } | null;
};
type Shift = {
  id: string;
  employee_id: string;
  timecard_id: string;
  started_at: string;
  ended_at: string | null;
  break_minutes: number;
  source: "clock" | "manual";
  correction_reason: string | null;
  corrected: boolean;
};
type SB = SupabaseClient;
const ZONE = "America/Los_Angeles",
  nowIso = () => new Date().toISOString(),
  monthKey = (d = new Date()) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONE,
      year: "numeric",
      month: "2-digit",
    }).format(d) + "-01",
  hours = (m: number) => `${(m / 60).toFixed(2)} hrs`,
  hoursAndMinutes = (m: number) => {
    const paid = Math.max(0, Math.round(m));
    return `${Math.floor(paid / 60)} hr${Math.floor(paid / 60) === 1 ? "" : "s"} ${paid % 60} min`;
  },
  duration = (s: Shift) =>
    s.ended_at
      ? Math.max(
          0,
          Math.round(
            (new Date(s.ended_at).getTime() -
              new Date(s.started_at).getTime()) /
              60000,
          ) - s.break_minutes,
        )
      : 0,
  dateFmt = (
    v: string,
    o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
  ) =>
    new Intl.DateTimeFormat("en-US", { timeZone: ZONE, ...o }).format(
      new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v),
    ),
  timeFmt = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: ZONE,
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(v))
      : "—",
  statusText = (s: string) =>
    s === "returned" ? "Needs correction" : s[0].toUpperCase() + s.slice(1),
  statusClass = (s: string) => `status status-${s}`,
  csvCell = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`,
  pacificParts = (value = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(value);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  },
  submissionDeadline = (month: string, value = new Date()) => {
    const [year, monthNumber] = month.slice(0, 7).split("-").map(Number),
      lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(),
      deadlineDate = `${year}-${String(monthNumber).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      now = pacificParts(value),
      nowDate = `${now.year}-${now.month}-${now.day}`,
      nowMinutes = Number(now.hour) * 60 + Number(now.minute),
      open = nowDate >= deadlineDate,
      late = nowDate > deadlineDate || (nowDate === deadlineDate && nowMinutes >= 12 * 60);
    return {
      open,
      late,
      opensLabel: `${new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNumber - 1, 1)))} ${lastDay}`,
      label: `${new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNumber - 1, 1)))} ${lastDay} at 12:00 PM Pacific Time`,
    };
  },
  submittedLate = (card: Card) => card.submitted_at ? submissionDeadline(card.month, new Date(card.submitted_at)).late : false;

export default function StaffApp() {
  const [sb] = useState(() => createClient()),
    [user, setUser] = useState<User | null | undefined>(),
    [profile, setProfile] = useState<Profile | null>(null),
    [error, setError] = useState("");
  const load = useCallback(
    async (u: User) => {
      const { data, error } = await sb
        .from("profiles")
        .select("*")
        .eq("id", u.id)
        .single();
      if (error) setError(error.message);
      else setProfile(data as Profile);
    },
    [sb],
  );
  useEffect(() => {
    sb.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) void load(data.user);
    });
    const { data } = sb.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user ?? null);
      if (s?.user) void load(s.user);
      else setProfile(null);
    });
    return () => data.subscription.unsubscribe();
  }, [sb, load]);
  if (user === undefined)
    return (
      <div className="auth-page">
        <div className="loader" />
        <p>Loading MCC Timecards…</p>
      </div>
    );
  if (!user) return <Login sb={sb} />;
  if (!profile)
    return (
      <Center
        title="Finishing account setup…"
        text={error || "Please refresh in a moment."}
      >
        <button onClick={() => sb.auth.signOut()}>Sign out</button>
      </Center>
    );
  if (profile.must_change_password)
    return <PasswordSetup sb={sb} done={() => load(user)} />;
  return (
    <Shell p={profile} signOut={() => sb.auth.signOut()}>
      {profile.role === "employee" ? (
        <Employee sb={sb} p={profile} />
      ) : (
        <RolePortal sb={sb} p={profile} />
      )}
    </Shell>
  );
}
function RolePortal({ sb, p }: { sb: SB; p: Profile }) {
  const [area, setArea] = useState<"mine" | "management">("mine");
  return (
    <>
      <div className="role-nav admin-nav">
        <button
          className={area === "mine" ? "active" : ""}
          onClick={() => setArea("mine")}
        >
          My timecard
        </button>
        <button
          className={area === "management" ? "active" : ""}
          onClick={() => setArea("management")}
        >
          {p.role === "admin" ? "Payroll administration" : "Supervisor review"}
        </button>
      </div>
      {area === "mine" ? (
        <Employee sb={sb} p={p} />
      ) : p.role === "admin" ? (
        <Admin sb={sb} p={p} />
      ) : (
        <Supervisor sb={sb} p={p} />
      )}
    </>
  );
}
function Logo() {
  return (
    <div className="logo">
      <Image className="sidebar-logo" src="/mcc-logo.png" alt="McMinnville Covenant Church" width={460} height={180} priority />
    </div>
  );
}
function Center({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo />
        <h1>{title}</h1>
        <p>{text}</p>
        {children}
      </div>
    </div>
  );
}
function Shell({
  p,
  signOut,
  children,
}: {
  p: Profile;
  signOut: () => void;
  children: React.ReactNode;
}) {
  return (
    <main className="app-shell">
      <aside>
        <Logo />
        <div className="side-note">
          <span>Secure payroll workspace</span>
          <small>
            Pacific Time ·{" "}
            {dateFmt(nowIso(), {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </small>
        </div>
        <div className="user-block">
          <span>
            {p.display_name
              .split(/\s+/)
              .map((x) => x[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <div>
            <b>{p.display_name}</b>
            <small>{p.role}</small>
          </div>
        </div>
      </aside>
      <section className="workspace">
        <header>
          <div>
            <small>STAFF TIMEKEEPING</small>
            <h1>
              {p.role === "employee"
                ? "My workspace"
                : p.role === "supervisor"
                  ? "Supervisor review"
                  : "Payroll administration"}
            </h1>
          </div>
          <button className="ghost" onClick={signOut}>
            Sign out
          </button>
        </header>
        {children}
      </section>
    </main>
  );
}
function Login({ sb }: { sb: SB }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const r = await sb.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setMsg(r.error?.message ?? "");
    setBusy(false);
  }
  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={go}>
        <Logo />
        <div className="auth-copy">
          <h1>Welcome back</h1>
          <p>Sign in to record, review, or approve staff time.</p>
        </div>
        <label>
          Work email
          <input
            required
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {msg ? (
          <p className="form-error" role="alert">
            {msg}
          </p>
        ) : null}
        <small className="security-note">
          Accounts are created by the MCC payroll administrator.
        </small>
      </form>
    </div>
  );
}
function PasswordSetup({ sb, done }: { sb: SB; done: () => void }) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [msg, setMsg] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setMsg("Passwords do not match.");
    const session = (await sb.auth.getSession()).data.session;
    const r = await fetch("/api/account/password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ password }),
    });
    const data = (await r.json()) as { error?: string };
    if (!r.ok) return setMsg(data.error || "Could not save password.");
    done();
  }
  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={save}>
        <Logo />
        <h1>Create your password</h1>
        <p>
          Choose at least 12 characters. Your temporary password will stop
          working.
        </p>
        <label>
          New password
          <input
            required
            minLength={12}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm password
          <input
            required
            minLength={12}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <button className="primary">Save password</button>
        {msg ? <p className="form-error">{msg}</p> : null}
      </form>
    </div>
  );
}

function Employee({ sb, p }: { sb: SB; p: Profile }) {
  const [selectedMonth, setSelectedMonth] = useState(monthKey()),
    [card, setCard] = useState<Card | null>(null),
    [shifts, setShifts] = useState<Shift[]>([]),
    [view, setView] = useState<"overview" | "calendar" | "list">("overview"),
    [msg, setMsg] = useState(""),
    [errorMsg, setErrorMsg] = useState(""),
    [editing, setEditing] = useState<Shift | null>(null),
    [manual, setManual] = useState(false),
    [review, setReview] = useState(false);
  const load = useCallback(async () => {
    const { data: c } = await sb
      .from("monthly_timecards")
      .select("*")
      .eq("employee_id", p.id)
      .eq("month", selectedMonth)
      .maybeSingle();
    setCard(c as Card | null);
    if (c) {
      const { data } = await sb
        .from("work_shifts")
        .select("*")
        .eq("timecard_id", c.id)
        .order("started_at");
      setShifts((data ?? []) as Shift[]);
    } else setShifts([]);
  }, [sb, p.id, selectedMonth]);
  useEffect(() => {
    // Loading Supabase records is the external synchronization performed here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const open = shifts.find((s) => !s.ended_at),
    total = shifts.reduce((n, s) => n + duration(s), 0),
    todayKey = dateFmt(nowIso(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    todayTotal = shifts
      .filter(
        (s) =>
          dateFmt(s.started_at, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }) === todayKey,
      )
      .reduce((n, s) => n + duration(s), 0),
    corrections = shifts.filter(
      (s) => s.corrected || s.source === "manual",
    ).length,
    locked = card?.status === "submitted" || card?.status === "approved",
    deadline = submissionDeadline(selectedMonth);
  async function punch(k: "in" | "out") {
    setMsg("");
    const { error } = await sb.rpc(k === "in" ? "clock_in" : "clock_out");
    if (error) setErrorMsg(error.message);
    else setMsg(k === "in" ? `Clocked in at ${timeFmt(nowIso())}.` : `Clocked out at ${timeFmt(nowIso())}.`);
    await load();
  }
  async function saveShift(v: {
    start: string;
    end: string;
    breaks: number;
    reason: string;
  }) {
    const startedAt = new Date(v.start);
    const endedAt = v.end ? new Date(v.end) : null;
    if (Number.isNaN(startedAt.getTime())) {
      setErrorMsg("Enter a valid clock-in time.");
      return;
    }
    if (endedAt && (Number.isNaN(endedAt.getTime()) || endedAt <= startedAt)) {
      setErrorMsg("Clock-out must be later than clock-in.");
      return;
    }
    if (monthKey(startedAt) !== selectedMonth || (endedAt && monthKey(endedAt) !== selectedMonth)) {
      setErrorMsg(
        `Both times must be inside ${dateFmt(selectedMonth, { month: "long", year: "numeric" })}. Select the correct month before adding this shift.`,
      );
      return;
    }
    if (startedAt.getTime() > Date.now() + 5 * 60000 || (endedAt && endedAt.getTime() > Date.now() + 5 * 60000)) {
      setErrorMsg("Future time cannot be recorded as hours already worked.");
      return;
    }
    if (!Number.isInteger(v.breaks)) {
      setErrorMsg("Unpaid break time must be entered in whole minutes.");
      return;
    }
    if (endedAt) {
      const elapsedMinutes = Math.round(
        (endedAt.getTime() - startedAt.getTime()) / 60000,
      );
      if (v.breaks < 0 || (v.breaks > 0 && v.breaks >= elapsedMinutes)) {
        setErrorMsg("The unpaid break must be shorter than the full shift.");
        return;
      }
      const conflict = shifts.find((shift) => {
        if (shift.id === editing?.id) return false;
        const existingStart = new Date(shift.started_at).getTime();
        const existingEnd = shift.ended_at
          ? new Date(shift.ended_at).getTime()
          : Number.POSITIVE_INFINITY;
        return startedAt.getTime() < existingEnd && endedAt.getTime() > existingStart;
      });
      if (conflict) {
        setManual(false);
        setEditing(conflict);
        setErrorMsg(
          `A saved entry already covers ${dateFmt(conflict.started_at)} from ${timeFmt(conflict.started_at)} to ${timeFmt(conflict.ended_at)}. That entry is now open so you can correct it instead of counting the same time twice.`,
        );
        return;
      }
    }
    if (!editing && !endedAt) {
      setErrorMsg("A missed shift needs both a clock-in and clock-out time.");
      return;
    }
    let c = card;
    if (!c) {
      const { data, error } = await sb.rpc("ensure_month_card", {
        p_employee: p.id,
        p_at: startedAt.toISOString(),
      });
      if (error) return setErrorMsg(error.message);
      const r = await sb
        .from("monthly_timecards")
        .select("*")
        .eq("id", data)
        .single();
      c = r.data as Card;
    }
    const payload = {
      organization_id: p.organization_id,
      employee_id: p.id,
      timecard_id: c.id,
      started_at: startedAt.toISOString(),
      ended_at: endedAt?.toISOString() ?? null,
      break_minutes: v.breaks,
      source: "manual",
      correction_reason: v.reason,
    };
    const r = editing
      ? await sb.from("work_shifts").update(payload).eq("id", editing.id)
      : await sb.from("work_shifts").insert(payload);
    if (r.error) {
      setErrorMsg(
        r.error.message.includes("overlaps an existing shift")
          ? "That correction overlaps another time entry. Open the overlapping entry and correct or delete it first so hours are not counted twice."
          : r.error.message,
      );
      return;
    }
    setMsg(
      editing
        ? "Correction saved in the audit history."
        : "Missed shift added to the audit history.",
    );
    setEditing(null);
    setManual(false);
    await load();
  }
  async function deleteShift(shift: Shift, reason: string) {
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      setErrorMsg("Enter a reason before deleting this time entry.");
      return;
    }
    const { error } = await sb.rpc("delete_work_shift", {
      p_shift: shift.id,
      p_reason: cleanReason,
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setMsg("Time entry deleted and preserved in the audit history.");
    setEditing(null);
    setManual(false);
    await load();
  }
  async function submit(sig: string) {
    if (!card) return;
    if (!deadline.open)
      return setErrorMsg(`Timecard submission opens on ${deadline.opensLabel}.`);
    if (sig.trim().toLocaleLowerCase() !== p.display_name.trim().toLocaleLowerCase())
      return setErrorMsg(`Type ${p.display_name} exactly to sign this timecard.`);
    const r = await sb.rpc("submit_monthly_timecard", {
      p_card: card.id,
      p_signature: sig.trim(),
      p_snapshot: {
        shifts,
        total_minutes: total,
        corrections,
        deadline: deadline.label,
        submitted_late: deadline.late,
      },
    });
    if (!r.error) {
      const session = (await sb.auth.getSession()).data.session;
      await fetch("/api/timecards/notify-supervisor", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ timecardId: card.id }),
      });
    }
    if (r.error) setErrorMsg(r.error.message);
    else setMsg("Timecard submitted and locked for supervisor review.");
    setReview(false);
    await load();
  }
  return (
    <div className="page">
      <div className="print-heading timecard-print-title">
        <h2>McMinnville Covenant Church</h2>
        <p>Monthly employee timecard</p>
        <p><b>Employee:</b> {p.display_name}</p>
        <p><b>Pay period:</b> {dateFmt(selectedMonth, { month: "long", year: "numeric" })}</p>
        <p><b>Total paid time:</b> {hoursAndMinutes(total)} ({hours(total)})</p>
      </div>
      <div className="page-title no-print">
        <div>
          <p className="eyebrow">EMPLOYEE DASHBOARD</p>
          <h2>Hello, {p.display_name.split(" ")[0]}</h2>
          <p>
            {dateFmt(nowIso(), {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        <label className="month-picker">
          Month
          <input
            type="month"
            value={selectedMonth.slice(0, 7)}
            onChange={(e) => setSelectedMonth(`${e.target.value}-01`)}
          />
        </label>
      </div>
      {card?.status === "returned" ? (
        <div className="notice warning">
          <b>Needs correction</b>
          <span>
            {card.return_reason || "Your supervisor returned this timecard."}
          </span>
        </div>
      ) : null}
      {!locked ? (
        <div className={`notice ${deadline.late ? "warning" : ""}`}>
          <b>{!deadline.open ? "Submission locked" : deadline.late ? "Submission overdue" : "Submission deadline"}</b>
          <span>
            {!deadline.open
              ? `Submission opens on ${deadline.opensLabel}. Continue recording and correcting time until then.`
              : `Due by ${deadline.label}. ${deadline.late ? "Submit as soon as possible; late submissions remain available so all worked time can still be reported." : "The timecard locks after signing and submission."}`}
          </span>
        </div>
      ) : null}
      <div className="metric-grid no-print">
        <Metric
          label="Clock status"
          value={open ? "Clocked in" : "Clocked out"}
          tone={open ? "green" : ""}
        />
        <Metric label="Today" value={hoursAndMinutes(todayTotal)} />
        <Metric label="Current period" value={hoursAndMinutes(total)} />
        <Metric label="Corrections" value={String(corrections)} />
      </div>
      <div className="punch-card no-print">
        <div>
          <span className={`clock-dot ${open ? "live" : ""}`} />
          <div>
            <b>
              {open
                ? `Working since ${timeFmt(open.started_at)}`
                : "You are currently clocked out"}
            </b>
            <small>Exact times are stored and displayed in Pacific Time</small>
          </div>
        </div>
        <button
          className={open ? "danger" : "primary"}
          onClick={() => {
            if (selectedMonth !== monthKey())
              return setErrorMsg("Live Clock In and Clock Out are available only on the current month. Select the current month first.");
            if (locked)
              return setErrorMsg("This timecard is locked because it has already been submitted or approved.");
            void punch(open ? "out" : "in");
          }}
        >
          {open ? "Clock Out" : "Clock In"}
        </button>
      </div>
      <div className="tabs no-print">
        <button
          className={view === "overview" ? "active" : ""}
          onClick={() => setView("overview")}
        >
          Overview
        </button>
        <button
          className={view === "calendar" ? "active" : ""}
          onClick={() => setView("calendar")}
        >
          Calendar
        </button>
        <button
          className={view === "list" ? "active" : ""}
          onClick={() => setView("list")}
        >
          Timecard list
        </button>
      </div>
      {view === "calendar" ? (
        <Calendar
          month={selectedMonth}
          shifts={shifts}
          onDay={(dayShifts) => {
            if (dayShifts.length === 1) setEditing(dayShifts[0]);
            else setView("list");
          }}
        />
      ) : (
        <ShiftList
          shifts={shifts}
          compact={view === "overview"}
          editable={!locked}
          onEdit={setEditing}
        />
      )}
      <div className="action-row">
        <button
          onClick={() => {
            if (!shifts.length) {
              setErrorMsg("There are no recorded time entries to print for this month.");
              return;
            }
            setView("list");
            requestAnimationFrame(() => window.print());
          }}
        >
          Print / PDF
        </button>
        <button onClick={() =>
          locked
            ? setErrorMsg("This timecard is locked because it has already been submitted or approved.")
            : setManual(true)
        }>
          + Add missed shift
        </button>
        <button
          className="primary"
          onClick={() => {
            if (!shifts.length) return setErrorMsg("Add at least one time entry before submitting this timecard.");
            if (open) return setErrorMsg("Clock out before submitting this timecard.");
            if (locked) return setErrorMsg("This timecard has already been submitted or approved.");
            if (!deadline.open) return setErrorMsg(`Timecard submission opens on ${deadline.opensLabel}.`);
            setReview(true);
          }}
          title={!deadline.open ? `Submission opens on ${deadline.opensLabel}` : undefined}
        >
          {deadline.open ? "Submit Timecard" : `Submit on ${deadline.opensLabel}`}
        </button>
      </div>
      {msg ? <div className="toast">{msg}</div> : null}
      {manual || editing ? (
        <ShiftModal
          shift={editing}
          onClose={() => {
            setEditing(null);
            setManual(false);
          }}
          onSave={saveShift}
          onDelete={deleteShift}
        />
      ) : null}
      {review ? (
        <SubmitModal
          p={p}
          shifts={shifts}
          total={total}
          corrections={corrections}
          deadline={deadline}
          onClose={() => setReview(false)}
          onSubmit={submit}
        />
      ) : null}
      {errorMsg ? (
        <ErrorDialog message={errorMsg} onClose={() => setErrorMsg("")} />
      ) : null}
    </div>
  );
}
function Metric({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className={`metric ${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
function ErrorDialog({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const nextStep = message.toLowerCase().includes("overlap") || message.toLowerCase().includes("saved entry")
    ? "Open the existing entry for that time, then edit or delete it before adding another overlapping entry."
    : message.toLowerCase().includes("locked") || message.toLowerCase().includes("submission opens")
      ? "Continue recording time. The action will become available when the timecard is unlocked."
      : message.toLowerCase().includes("full name")
        ? "Enter the full name shown on your MCC Timecards account, then try again."
        : message.toLowerCase().includes("clock out")
          ? "Clock out first, then try the action again."
          : "Review the information, make the requested correction, and try again.";
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="action-error-title">
        <p className="eyebrow">ACTION NOT COMPLETED</p>
        <h3 id="action-error-title">Why this could not be done</h3>
        <p>{message}</p>
        <div className="notice compact warning">
          <b>What to do</b>
          <span>{nextStep}</span>
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose} autoFocus>Okay</button>
        </div>
      </div>
    </div>
  );
}
function ShiftList({
  shifts,
  compact = false,
  editable = false,
  onEdit,
}: {
  shifts: Shift[];
  compact?: boolean;
  editable?: boolean;
  onEdit?: (s: Shift) => void;
}) {
  const rows = compact ? shifts.slice(-5).reverse() : shifts;
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>{compact ? "Recent activity" : "Detailed timecard"}</h3>
          <p>
            {rows.length
              ? `${rows.length} recorded shift${rows.length === 1 ? "" : "s"}`
              : "No hours have been recorded yet."}
          </p>
        </div>
      </div>
      {!rows.length ? (
        <Empty
          icon="◷"
          title="No time entries yet"
          text="Use Clock In when work begins, or add a missed shift."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Clock in</th>
                <th>Clock out</th>
                <th>Break</th>
                <th>Total</th>
                <th>Status</th>
                {editable ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    {dateFmt(s.started_at, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td>{timeFmt(s.started_at)}</td>
                  <td>{timeFmt(s.ended_at)}</td>
                  <td>{s.break_minutes} min</td>
                  <td>
                    <b>{hoursAndMinutes(duration(s))}</b>
                    <small className="block-muted">{hours(duration(s))}</small>
                  </td>
                  <td>
                    {s.corrected || s.source === "manual" ? (
                      <span className="status status-returned">Corrected</span>
                    ) : (
                      <span className="status status-approved">Recorded</span>
                    )}
                  </td>
                  {editable ? (
                    <td>
                      <button className="link-btn" onClick={() => onEdit?.(s)}>
                        Edit time
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function Calendar({
  month,
  shifts,
  onDay,
}: {
  month: string;
  shifts: Shift[];
  onDay: (shifts: Shift[]) => void;
}) {
  const f = new Date(`${month}T12:00:00`),
    days = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate(),
    offset = new Date(f.getFullYear(), f.getMonth(), 1).getDay(),
    map = new Map<number, number>(),
    shiftsByDay = new Map<number, Shift[]>();
  for (const s of shifts) {
    const d = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: ZONE,
        day: "numeric",
      }).format(new Date(s.started_at)),
    );
    map.set(d, (map.get(d) || 0) + duration(s));
    shiftsByDay.set(d, [...(shiftsByDay.get(d) ?? []), s]);
  }
  return (
    <div className="panel calendar-panel">
      <div className="weekdays">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => (
          <b key={x}>{x}</b>
        ))}
      </div>
      <div className="calendar">
        {Array.from({ length: offset }).map((_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <button
            key={d}
            className={map.has(d) ? "worked" : ""}
            onClick={() => map.has(d) && onDay(shiftsByDay.get(d) ?? [])}
            title={
              map.has(d)
                ? shiftsByDay.get(d)?.length === 1
                  ? "Edit this time entry"
                  : "View and edit this day's entries"
                : "No time recorded"
            }
          >
            <b>{d}</b>
            <small>{map.has(d) ? hoursAndMinutes(map.get(d)!) : "—"}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
function ShiftModal({
  shift,
  onClose,
  onSave,
  onDelete,
}: {
  shift: Shift | null;
  onClose: () => void;
  onSave: (v: {
    start: string;
    end: string;
    breaks: number;
    reason: string;
  }) => void;
  onDelete: (shift: Shift, reason: string) => void;
}) {
  const local = (iso?: string | null) =>
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .format(iso ? new Date(iso) : new Date())
        .replace(" ", "T"),
    [start, setStart] = useState(local(shift?.started_at)),
    [end, setEnd] = useState(() =>
      shift && !shift.ended_at
        ? ""
        : local(shift?.ended_at ?? new Date(Date.now() + 3600000).toISOString()),
    ),
    [breaks, setBreaks] = useState(shift?.break_minutes ?? 0),
    [reason, setReason] = useState(shift?.correction_reason ?? ""),
    startValue = new Date(start),
    endValue = end ? new Date(end) : null,
    elapsed =
      endValue &&
      !Number.isNaN(startValue.getTime()) &&
      !Number.isNaN(endValue.getTime())
        ? Math.max(
            0,
            Math.round((endValue.getTime() - startValue.getTime()) / 60000) -
              breaks,
          )
        : 0;
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ start, end, breaks, reason });
        }}
      >
        <div className="panel-head">
          <div>
            <p className="eyebrow">AUDITED CHANGE</p>
            <h3>{shift ? "Edit clock-in / clock-out" : "Add missed shift"}</h3>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="form-grid">
          <label>
            Clock in
            <input
              required={!shift || Boolean(shift.ended_at)}
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Clock out
            <input
              required
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
            {shift && !shift.ended_at ? (
              <small>Leave blank to stay clocked in.</small>
            ) : null}
          </label>
          <label>
            Unpaid break (minutes)
            <input
              required
              type="number"
              min="0"
              max="1440"
              value={breaks}
              onChange={(e) => setBreaks(Number(e.target.value))}
            />
            <small>
              Paid time: {hoursAndMinutes(elapsed)} ({hours(elapsed)})
            </small>
          </label>
          <label className="wide">
            Reason for correction
            <textarea
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this time needs to be changed."
            />
          </label>
        </div>
        <div className="modal-actions">
          {shift ? (
            <button
              type="button"
              className="danger"
              disabled={reason.trim().length < 3}
              onClick={() => {
                if (
                  window.confirm(
                    "Delete this time entry? The deletion and reason will remain in the audit history.",
                  )
                )
                  onDelete(shift, reason);
              }}
            >
              Delete entry
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save corrected time</button>
        </div>
      </form>
    </div>
  );
}
function SubmitModal({
  p,
  shifts,
  total,
  corrections,
  deadline,
  onClose,
  onSubmit,
}: {
  p: Profile;
  shifts: Shift[];
  total: number;
  corrections: number;
  deadline: { late: boolean; label: string };
  onClose: () => void;
  onSubmit: (s: string) => void;
}) {
  const [sig, setSig] = useState("");
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(sig);
        }}
      >
        <p className="eyebrow">FINAL REVIEW</p>
        <h3>Submit this timecard?</h3>
        <div className="review-summary">
          <Metric
            label="Dates worked"
            value={String(
              new Set(shifts.map((s) => dateFmt(s.started_at))).size,
            )}
          />
          <Metric label="Total hours" value={hours(total)} />
          <Metric label="Corrections" value={String(corrections)} />
        </div>
        <p className={deadline.late ? "form-error" : "security-note"}>
          {deadline.late ? `This timecard is past the ${deadline.label} deadline and will be marked late.` : `Submission deadline: ${deadline.label}.`}
        </p>
        <div className="certification">
          <b>Employee Certification</b>
          <p>I certify that the hours shown on this timecard are a true and accurate record of all hours I worked during this pay period. I have reviewed the time recorded, including meal periods and rest periods, and have reported any corrections or concerns to my supervisor. By selecting <b>Sign &amp; Submit</b>, I intend to electronically sign this timecard and certify that the information provided is accurate to the best of my knowledge.</p>
        </div>
        <label>
          Type your full name as your signature
          <input
            required
            value={sig}
            onChange={(e) => setSig(e.target.value)}
            placeholder={p.display_name}
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Continue editing
          </button>
          <button className="primary">Sign & submit</button>
        </div>
      </form>
    </div>
  );
}

function Supervisor({ sb, p }: { sb: SB; p: Profile }) {
  const [cards, setCards] = useState<Card[]>([]),
    [selected, setSelected] = useState<Card | null>(null),
    [shifts, setShifts] = useState<Shift[]>([]),
    [employeeSignature, setEmployeeSignature] = useState<{ display_name: string; typed_signature: string; signed_at: string } | null>(null),
    [supervisorSignature, setSupervisorSignature] = useState<{ typed_signature: string; approved_at: string } | null>(null),
    [msg, setMsg] = useState(""),
    [errorMsg, setErrorMsg] = useState("");
  const load = useCallback(async () => {
    const { data } = await sb
      .from("monthly_timecards")
      .select("*,profiles!monthly_timecards_employee_id_fkey(display_name)")
      .in("status", ["submitted", "approved", "returned"])
      .order("submitted_at", { ascending: false });
    setCards((data ?? []) as Card[]);
  }, [sb]);
  useEffect(() => {
    // Loading Supabase records is the external synchronization performed here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function open(c: Card) {
    setSelected(c);
    const [shiftResult, versionResult] = await Promise.all([
      sb.from("work_shifts").select("*").eq("timecard_id", c.id).order("started_at"),
      sb.from("timecard_versions").select("id").eq("timecard_id", c.id).order("version", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setShifts((shiftResult.data ?? []) as Shift[]);
    if (!versionResult.data?.id) {
      setEmployeeSignature(null);
      setSupervisorSignature(null);
      return;
    }
    const [employeeResult, supervisorResult] = await Promise.all([
      sb.from("employee_certifications").select("display_name,typed_signature,signed_at").eq("timecard_version_id", versionResult.data.id).maybeSingle(),
      sb.from("supervisor_approvals").select("typed_signature,approved_at").eq("timecard_version_id", versionResult.data.id).maybeSingle(),
    ]);
    setEmployeeSignature(employeeResult.data);
    setSupervisorSignature(supervisorResult.data);
  }
  async function act(status: "returned" | "approved") {
    if (!selected) return;
    let reason: string | null = null;
    if (status === "returned") {
      reason = prompt("Explain what the employee must correct:");
      if (!reason?.trim()) return setErrorMsg("A return explanation is required before sending the timecard back.");
    }
    if (status === "approved") {
      const typed = prompt("Type your full name to approve this timecard:");
      if (!typed) return;
      if (typed.trim().toLocaleLowerCase() !== p.display_name.trim().toLocaleLowerCase())
        return setErrorMsg(`Type ${p.display_name} exactly to approve this timecard.`);
      reason = typed.trim();
    }
    const { error } = await sb.rpc("review_monthly_timecard", {
      p_card: selected.id,
      p_action: status,
      p_signature: status === "approved" ? reason : null,
      p_reason: status === "returned" ? reason : null,
    });
    if (error) setErrorMsg(error.message);
    else setMsg(`Timecard ${status === "returned" ? "returned for correction" : "approved"}.`);
    setSelected(null);
    await load();
  }
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <p className="eyebrow">SUPERVISOR QUEUE</p>
          <h2>Timecards awaiting review</h2>
          <p>Only employees assigned to you appear here.</p>
        </div>
      </div>
      <div className="metric-grid three">
        <Metric
          label="Awaiting review"
          value={String(cards.filter((c) => c.status === "submitted").length)}
          tone="amber"
        />
        <Metric
          label="Approved"
          value={String(cards.filter((c) => c.status === "approved").length)}
          tone="green"
        />
        <Metric
          label="Needs correction"
          value={String(cards.filter((c) => c.status === "returned").length)}
        />
      </div>
      <div className="panel queue-list">
        {!cards.length ? (
          <Empty
            icon="✓"
            title="All caught up"
            text="Submitted employee timecards will appear here."
          />
        ) : (
          cards.map((c) => (
            <button key={c.id} onClick={() => open(c)}>
              <span className="avatar">
                {c.profiles?.display_name?.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <b>{c.profiles?.display_name || "Employee"}</b>
                <small>
                  {dateFmt(c.month, { month: "long", year: "numeric" })}
                </small>
              </span>
              <span className={statusClass(c.status)}>
                {statusText(c.status)}
              </span>
              {submittedLate(c) ? <span className="status status-returned">Late</span> : null}
              <span>Review →</span>
            </button>
          ))
        )}
      </div>
      {selected ? (
        <div className="modal-backdrop">
          <div className="modal wide-modal print-sheet">
            <div className="panel-head">
              <div>
                <p className="eyebrow">TIMECARD REVIEW</p>
                <h3>{selected.profiles?.display_name}</h3>
                <p>
                  {dateFmt(selected.month, { month: "long", year: "numeric" })}{" "}
                  · {hours(shifts.reduce((n, s) => n + duration(s), 0))}
                </p>
              </div>
              <button
                className="icon-btn no-print"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
            <ShiftList shifts={shifts} />
            <div className="signature-lines">
              <span>Employee: {employeeSignature?.typed_signature || "Not signed"} / {employeeSignature?.signed_at ? dateFmt(employeeSignature.signed_at, { dateStyle: "medium", timeStyle: "short" }) : "—"}</span>
              <span>
                Supervisor: {supervisorSignature?.typed_signature || "Not signed"} / {supervisorSignature?.approved_at ? dateFmt(supervisorSignature.approved_at, { dateStyle: "medium", timeStyle: "short" }) : "—"}
              </span>
            </div>
            <div className="certification supervisor-certification">
              <b>Supervisor Approval</b>
              <p>I have reviewed this employee&apos;s timecard and approve the hours recorded for this pay period. To the best of my knowledge, the timecard accurately reflects the employee&apos;s reported hours worked. By selecting <b>Approve &amp; Sign</b>, I intend to electronically sign and approve this timecard.</p>
            </div>
            <div className="modal-actions no-print">
              <button onClick={() => window.print()}>Print / PDF</button>
              {selected.status === "submitted" ? (
                <>
                  <button className="danger" onClick={() => act("returned")}>
                    Return for correction
                  </button>
                  <button className="primary" onClick={() => act("approved")}>
                    Approve & sign
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {msg ? <div className="toast">{msg}</div> : null}
      {errorMsg ? (
        <ErrorDialog message={errorMsg} onClose={() => setErrorMsg("")} />
      ) : null}
    </div>
  );
}

function Admin({ sb, p }: { sb: SB; p: Profile }) {
  const [tab, setTab] = useState<"payroll" | "staff" | "settings">("payroll"),
    [cards, setCards] = useState<Card[]>([]),
    [staff, setStaff] = useState<Profile[]>([]),
    [shifts, setShifts] = useState<Shift[]>([]),
    [status, setStatus] = useState("all"),
    [employee, setEmployee] = useState("all"),
    [period, setPeriod] = useState("");
  const load = useCallback(async () => {
    const [c, s, w] = await Promise.all([
      sb
        .from("monthly_timecards")
        .select("*,profiles!monthly_timecards_employee_id_fkey(display_name)")
        .order("month", { ascending: false }),
      sb.from("profiles").select("*").order("display_name"),
      sb.from("work_shifts").select("*"),
    ]);
    setCards((c.data ?? []) as Card[]);
    setStaff((s.data ?? []) as Profile[]);
    setShifts((w.data ?? []) as Shift[]);
  }, [sb]);
  useEffect(() => {
    // Loading Supabase records is the external synchronization performed here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const filtered = cards.filter(
      (c) =>
        (status === "all" || c.status === status) &&
        (employee === "all" || c.employee_id === employee) &&
        (!period || c.month.startsWith(period)),
    ),
    totals = new Map<string, number>();
  for (const s of shifts)
    totals.set(s.timecard_id, (totals.get(s.timecard_id) || 0) + duration(s));
  function csv() {
    const rows = [
      [
        "Employee",
        "Pay period",
        "Total hours",
        "Status",
        "Submitted",
        "Approved",
      ],
      ...filtered.map((c) => [
        c.profiles?.display_name || "",
        c.month,
        (totals.get(c.id) || 0) / 60,
        statusText(c.status),
        c.submitted_at || "",
        c.approved_at || "",
      ]),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], {
        type: "text/csv",
      }),
    );
    a.download = "mcc-payroll-timecards.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="page">
      <div className="admin-nav">
        <button
          className={tab === "payroll" ? "active" : ""}
          onClick={() => setTab("payroll")}
        >
          Payroll overview
        </button>
        <button
          className={tab === "staff" ? "active" : ""}
          onClick={() => setTab("staff")}
        >
          Staff management
        </button>
        <button
          className={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
      </div>
      {tab === "payroll" ? (
        <>
          <div className="page-title">
            <div>
              <p className="eyebrow">PAYROLL READINESS</p>
              <h2>Staff timecards</h2>
              <p>Review readiness, approvals, and exceptions at a glance.</p>
            </div>
            <div className="button-group">
              <button onClick={csv}>Export CSV</button>
              <button onClick={() => window.print()}>Print / PDF</button>
            </div>
          </div>
          <div className="metric-grid">
            <Metric label="All timecards" value={String(cards.length)} />
            <Metric
              label="Submitted"
              value={String(
                cards.filter((c) => c.status === "submitted").length,
              )}
              tone="amber"
            />
            <Metric
              label="Approved"
              value={String(
                cards.filter((c) => c.status === "approved").length,
              )}
              tone="green"
            />
            <Metric
              label="Needs correction"
              value={String(
                cards.filter((c) => c.status === "returned").length,
              )}
            />
          </div>
          <div className="filters no-print">
            <label>
              Employee
              <select
                value={employee}
                onChange={(e) => setEmployee(e.target.value)}
              >
                <option value="all">All employees</option>
                {staff
                  .filter((x) => x.role === "employee")
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.display_name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Pay period
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="returned">Needs correction</option>
                <option value="approved">Approved</option>
              </select>
            </label>
          </div>
          <div className="panel print-sheet">
            <div className="print-heading">
              <h2>McMinnville Covenant Church</h2>
              <p>Employee timecard readiness</p>
            </div>
            {!filtered.length ? (
              <Empty
                icon="▤"
                title="No timecards match"
                text="Timecards appear after employees begin recording hours. Adjust filters if records already exist."
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Pay period</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Submitted</th>
                      <th>Approved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <b>{c.profiles?.display_name || "Employee"}</b>
                        </td>
                        <td>
                          {dateFmt(c.month, { month: "long", year: "numeric" })}
                        </td>
                        <td>{hours(totals.get(c.id) || 0)}</td>
                        <td>
                          <span className={statusClass(c.status)}>
                            {statusText(c.status)}
                          </span>
                        </td>
                        <td>
                          {c.submitted_at ? dateFmt(c.submitted_at) : "—"}
                        </td>
                        <td>{c.approved_at ? dateFmt(c.approved_at) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : tab === "staff" ? (
        <StaffManagement sb={sb} p={p} staff={staff} reload={load} />
      ) : (
        <Settings sb={sb} p={p} />
      )}
    </div>
  );
}
function StaffManagement({
  sb,
  p,
  staff,
  reload,
}: {
  sb: SB;
  p: Profile;
  staff: Profile[];
  reload: () => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [role, setRole] = useState<Role>("employee"),
    [created, setCreated] = useState(""),
    [temporaryPassword, setTemporaryPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [assignments, setAssignments] = useState<Record<string, string>>({});
  useEffect(() => {
    void sb
      .from("supervisor_assignments")
      .select("employee_id,supervisor_id")
      .eq("active", true)
      .then(({ data }) =>
        setAssignments(
          Object.fromEntries(
            (data ?? []).map((assignment) => [
              assignment.employee_id,
              assignment.supervisor_id,
            ]),
          ),
        ),
      );
  }, [sb, staff]);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setCreated("");
    setTemporaryPassword("");
    try {
      const session = (await sb.auth.getSession()).data.session;
      if (!session) throw new Error("Your session expired. Please sign in again.");
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ email, displayName: name, role }),
      });
      const data = (await r.json()) as { temporaryPassword?: string; error?: string };
      if (!r.ok || !data.temporaryPassword)
        throw new Error(data.error || "Could not create account");
      setCreated(`Account created for ${name}.`);
      setTemporaryPassword(data.temporaryPassword);
      setEmail("");
      setName("");
      await reload();
    } catch (error) {
      setCreated(error instanceof Error ? error.message : "Could not create account");
    } finally {
      setBusy(false);
    }
  }
  async function assign(employeeId: string, supervisorId: string) {
    if (!supervisorId) return;
    const deactivate = await sb
      .from("supervisor_assignments")
      .update({ active: false })
      .eq("employee_id", employeeId)
      .neq("supervisor_id", supervisorId);
    if (deactivate.error) {
      setCreated(deactivate.error.message);
      return;
    }
    const { error } = await sb
      .from("supervisor_assignments")
      .upsert(
        {
          organization_id: p.organization_id,
          employee_id: employeeId,
          supervisor_id: supervisorId,
          active: true,
        },
        { onConflict: "employee_id,supervisor_id" },
      );
    setCreated(error?.message ?? "Supervisor assignment saved.");
    if (!error)
      setAssignments((current) => ({ ...current, [employeeId]: supervisorId }));
  }
  const supervisors = staff.filter((x) => x.role === "supervisor");
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">STAFF MANAGEMENT</p>
          <h2>Accounts and assignments</h2>
          <p>Create secure logins and connect employees to supervisors.</p>
        </div>
      </div>
      <div className="staff-grid">
        <form className="panel staff-form" onSubmit={add}>
          <h3>Create staff account</h3>
          <label>
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Work email
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="employee">Employee</option>
              <option value="supervisor">Supervisor</option>
            </select>
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
          {created && !temporaryPassword ? (
            <p className="form-error" role="alert">{created}</p>
          ) : null}
        </form>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Current staff</h3>
              <p>
                {staff.filter((account) => account.active).length} active account
                {staff.filter((account) => account.active).length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          {staff.map((x) => (
            <div className="staff-row" key={x.id}>
              <span className="avatar">
                {x.display_name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <b>{x.display_name}</b>
                <small>{x.role}</small>
              </span>
              {x.role === "employee" ? (
                <select
                  aria-label={`Supervisor for ${x.display_name}`}
                  value={assignments[x.id] ?? ""}
                  onChange={(e) => assign(x.id, e.target.value)}
                >
                  <option value="">Assign supervisor…</option>
                  {supervisors.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.display_name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="status status-approved">Active</span>
              )}
            </div>
          ))}
        </div>
      </div>
      {temporaryPassword ? (
        <div className="modal-backdrop">
          <div className="modal account-created" role="dialog" aria-modal="true" aria-labelledby="account-created-title">
            <p className="eyebrow">ACCOUNT READY</p>
            <h3 id="account-created-title">{created}</h3>
            <p>Give the staff member their work email and this one-time temporary password:</p>
            <div className="temporary-password">
              <code>{temporaryPassword}</code>
              <button onClick={() => navigator.clipboard.writeText(temporaryPassword)}>Copy password</button>
            </div>
            <p className="security-note">At first sign-in, MCC Timecards will require them to create their own password before they can use the app.</p>
            <div className="modal-actions">
              <button className="primary" onClick={() => setTemporaryPassword("")}>Done</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
function Settings({ sb }: { sb: SB; p: Profile }) {
  const [outlook, setOutlook] = useState<{ configured: boolean; connected: boolean; email: string | null } | null>(null),
    [outlookMessage, setOutlookMessage] = useState("");
  useEffect(() => {
    void sb.auth.getSession().then(({ data }) =>
      fetch("/api/integrations/outlook/status", {
        headers: { authorization: `Bearer ${data.session?.access_token}` },
      })
        .then((response) => response.ok ? response.json() : null)
        .then(setOutlook)
        .catch(() => setOutlook(null)),
    );
  }, [sb]);
  async function connectOutlook() {
    setOutlookMessage("");
    const session = (await sb.auth.getSession()).data.session;
    const response = await fetch("/api/integrations/outlook/start", {
      method: "POST",
      headers: { authorization: `Bearer ${session?.access_token}` },
    });
    const data = (await response.json()) as { url?: string; error?: string };
    if (data.url) window.location.assign(data.url);
    else setOutlookMessage(data.error || "Outlook connection could not be started.");
  }
  return (
    <div className="settings-card panel">
      <p className="eyebrow">PAYROLL SETTINGS</p>
      <h2>Monthly timecards</h2>
      <p>
        Every MCC timecard runs from the first through the last day of the
        calendar month.
      </p>
      <div className="notice compact">
        <b>Schedule</b>
        <span>Monthly · 1st through the last day</span>
      </div>
      <div className="notice compact">
        <b>Submission deadline</b>
        <span>12:00 PM Pacific Time on the final calendar day of every month. Late submissions remain available and are flagged for Ted.</span>
      </div>
      <div className="notice compact">
        <b>Supervisor email notifications</b>
        {outlook?.connected ? (
          <span>Connected to {outlook.email}. Submitted timecards are emailed to tyuen@maccov.org.</span>
        ) : (
          <>
            <span>Connect Rachel’s Outlook email to notify Ted when a timecard is submitted.</span>
            <button className="button-link" onClick={connectOutlook}>Connect Outlook: officeadmin@maccov.org</button>
          </>
        )}
        {outlookMessage ? <span className="form-error">{outlookMessage}</span> : null}
      </div>
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
