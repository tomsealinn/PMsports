"use client";

import { useState } from "react";

/* ─── Design tokens ─────────────────────────────────────────────── */
const C = {
  white:       "#FFFFFF",
  blue:        "#3B82F6",
  blueDark:    "#2563EB",
  blueBg:      "#EFF6FF",
  blueMid:     "#DBEAFE",
  border:      "#F0F2F5",
  borderMid:   "#E9EDF2",
  textDark:    "#0F172A",
  textMid:     "#475569",
  textLight:   "#94A3B8",
  pageBg:      "#F8FAFF",
  green:       "#10B981",
  red:         "#EF4444",
  amber:       "#F59E0B",
};

const SPORTS_HREF = "/next/sports.html";

/* ─── Static data ────────────────────────────────────────────────── */
const STATS = [
  { value: "500+",   label: "覆盖联赛" },
  { value: "50,000+", label: "每日赛事" },
  { value: "毫秒",   label: "赔率更新" },
  { value: "24/7",   label: "客服支持" },
];

const FEATURES = [
  {
    icon: "⚡",
    title: "实时滚球",
    desc:  "比赛进行中随时下注，赔率毫秒级刷新，把握每一个得分时机。",
    tag:   "LIVE",
  },
  {
    icon: "📊",
    title: "多种玩法",
    desc:  "独赢、让球、大小、波胆、半场、串关……一站式覆盖主流盘口。",
    tag:   "玩法",
  },
  {
    icon: "⚙️",
    title: "智能结算",
    desc:  "赛果即时同步，自动结算，赢款秒级到账，无需等待。",
    tag:   "结算",
  },
  {
    icon: "🔒",
    title: "资金安全",
    desc:  "银行级加密传输，多重风控体系，每一笔资金都得到妥善保障。",
    tag:   "安全",
  },
  {
    icon: "📱",
    title: "全端适配",
    desc:  "H5 随开即用，无需下载 App，iOS 与 Android 浏览器流畅运行。",
    tag:   "便捷",
  },
  {
    icon: "🌏",
    title: "中文界面",
    desc:  "专为华人用户打造，简体中文全覆盖，操作直觉简单。",
    tag:   "本地化",
  },
];

const SPORTS = [
  { emoji: "⚽", name: "足球", hot: true },
  { emoji: "🏀", name: "篮球", hot: true },
  { emoji: "🎾", name: "网球", hot: false },
  { emoji: "🏐", name: "排球", hot: false },
  { emoji: "🏒", name: "冰球", hot: false },
  { emoji: "⚾", name: "棒球", hot: false },
  { emoji: "🏈", name: "橄榄球", hot: false },
  { emoji: "🏸", name: "羽毛球", hot: false },
];

const SAMPLE_ODDS = [
  {
    home: "曼城",    away: "利物浦",
    league: "英超",  time: "64'",
    score: "1 - 1",
    mh: "2.10", mn: "3.40", mc: "3.20",
    live: true,
  },
  {
    home: "皇马",    away: "巴萨",
    league: "西甲",  time: "明 03:00",
    score: null,
    mh: "2.45", mn: "3.20", mc: "2.75",
    live: false,
  },
  {
    home: "拜仁",    away: "多特",
    league: "德甲",  time: "周六 22:30",
    score: null,
    mh: "1.85", mn: "3.60", mc: "4.10",
    live: false,
  },
];

/* ─── Sub-components ─────────────────────────────────────────────── */
function NavBar() {
  return (
    <nav style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(12px)",
      borderBottom: `1px solid ${C.border}`,
      padding: "0 1.5rem",
    }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", display: "flex", alignItems: "center", height: 64, gap: 32 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div className="cg-icon-box-sm" style={{ background: C.blue, borderRadius: "0.75rem", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 18 }}>👑</span>
          </div>
          <span style={{ fontWeight: 800, fontSize: "1.1rem", color: C.textDark, letterSpacing: "-0.01em" }}>
            CrownGold
          </span>
        </div>

        {/* Desktop links */}
        <div className="cg-nav-links" style={{ display: "flex", gap: 4, flex: 1 }}>
          {["滚球", "足球", "篮球", "早盘", "冠军"].map(label => (
            <a key={label} href={SPORTS_HREF}
              style={{ padding: "6px 14px", borderRadius: "2rem", fontSize: "0.9rem", fontWeight: 500, color: C.textMid, textDecoration: "none", transition: "all 0.2s" }}
              className="cg-nav-link">
              {label}
            </a>
          ))}
        </div>

        {/* CTA */}
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <a href={SPORTS_HREF}
            className="cg-btn-outline"
            style={{ padding: "8px 20px", borderRadius: "2rem", fontSize: "0.875rem", fontWeight: 600, border: `1.5px solid ${C.blue}`, color: C.blue, textDecoration: "none", transition: "all 0.25s" }}>
            登录
          </a>
          <a href={SPORTS_HREF}
            className="cg-btn-primary"
            style={{ padding: "8px 20px", borderRadius: "2rem", fontSize: "0.875rem", fontWeight: 600, background: C.blue, color: "#fff", textDecoration: "none", boxShadow: `0 4px 14px ${C.blue}40`, transition: "all 0.25s" }}>
            立即体验
          </a>
        </div>
      </div>
    </nav>
  );
}

function HeroSection() {
  return (
    <section style={{ background: C.white, padding: "5rem 1.5rem 4rem", overflow: "hidden" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "center" }}
        className="cg-hero-grid">
        {/* Left copy */}
        <div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: C.blueBg, color: C.blue, borderRadius: "2rem",
            padding: "5px 14px", fontSize: "0.8rem", fontWeight: 600,
            marginBottom: "1.5rem", letterSpacing: "0.04em",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, display: "inline-block", animation: "cgPulse 1.4s ease-in-out infinite" }} />
            实时赔率 · 毫秒更新
          </div>

          <h1 style={{
            fontSize: "clamp(2.2rem, 4vw, 3.25rem)",
            fontWeight: 900,
            color: C.textDark,
            lineHeight: 1.15,
            letterSpacing: "-0.025em",
            marginBottom: "1.25rem",
          }}>
            实时竞猜<br />
            <span style={{ color: C.blue }}>随时随地</span>
          </h1>

          <p style={{ fontSize: "1.075rem", color: C.textMid, lineHeight: 1.75, maxWidth: 440, marginBottom: "2.25rem" }}>
            覆盖全球 500+ 足球联赛，独赢、让球、大小、波胆一键下注，赛果即时结算，专为华人玩家打造。
          </p>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <a href={SPORTS_HREF} className="cg-btn-primary"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 30px", borderRadius: "2rem", background: C.blue, color: "#fff", fontWeight: 700, fontSize: "1rem", textDecoration: "none", boxShadow: `0 8px 24px ${C.blue}40`, transition: "all 0.25s" }}>
              立即体验 →
            </a>
            <a href={SPORTS_HREF} className="cg-btn-ghost"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 30px", borderRadius: "2rem", background: C.blueBg, color: C.blue, fontWeight: 700, fontSize: "1rem", textDecoration: "none", transition: "all 0.25s" }}>
              查看赛事
            </a>
          </div>

          {/* Trust chips */}
          <div style={{ display: "flex", gap: 10, marginTop: "2rem", flexWrap: "wrap" }}>
            {["🔒 安全加密", "⚡ 毫秒结算", "📱 无需 App", "💬 中文客服"].map(t => (
              <span key={t} style={{ padding: "4px 14px", borderRadius: "2rem", background: C.border, color: C.textMid, fontSize: "0.8rem", fontWeight: 500 }}>
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Right — phone mockup */}
        <div style={{ display: "flex", justifyContent: "center", position: "relative" }}>
          <PhoneMockup />
        </div>
      </div>
    </section>
  );
}

function PhoneMockup() {
  return (
    <div style={{ position: "relative", width: 280, height: 560 }}>
      {/* Glow */}
      <div style={{ position: "absolute", inset: -24, background: `radial-gradient(ellipse at center, ${C.blue}22 0%, transparent 70%)`, borderRadius: "50%", filter: "blur(2px)" }} />
      {/* Phone frame */}
      <div style={{
        position: "relative",
        width: 280, height: 560,
        background: C.textDark,
        borderRadius: "2.5rem",
        padding: 10,
        boxShadow: `0 40px 80px ${C.textDark}30, 0 0 0 1px ${C.textDark}20`,
      }}>
        {/* Screen */}
        <div style={{ width: "100%", height: "100%", background: C.pageBg, borderRadius: "2rem", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Status bar */}
          <div style={{ background: C.blue, padding: "12px 16px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#fff", fontSize: "0.75rem", fontWeight: 700 }}>👑 CrownGold</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ADE80", display: "inline-block" }} />
              <span style={{ color: "#ffffffcc", fontSize: "0.65rem" }}>滚球</span>
            </div>
          </div>
          {/* Match cards inside phone */}
          <div style={{ padding: "10px 10px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { h: "曼城", c: "利物浦", score: "1-1", t: "64'", live: true },
              { h: "皇马", c: "巴萨", score: "—", t: "03:00", live: false },
            ].map((m, i) => (
              <div key={i} style={{
                background: C.white,
                borderRadius: "1.25rem",
                padding: "10px 12px",
                boxShadow: `0 2px 8px ${C.textDark}08`,
              }}>
                {m.live && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.red, display: "inline-block" }} />
                    <span style={{ fontSize: "0.6rem", color: C.red, fontWeight: 700 }}>LIVE {m.t}</span>
                  </div>
                )}
                {!m.live && <div style={{ fontSize: "0.6rem", color: C.textLight, marginBottom: 4 }}>{m.t}</div>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: C.textDark }}>{m.h}</span>
                  <span style={{ fontSize: "0.8rem", fontWeight: 800, color: m.live ? C.blue : C.textLight, padding: "2px 8px", background: m.live ? C.blueBg : C.border, borderRadius: "1rem" }}>{m.score}</span>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: C.textDark }}>{m.c}</span>
                </div>
                <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                  {["1.90", "3.40", "4.10"].map((o, j) => (
                    <div key={j} style={{ flex: 1, background: C.blueBg, borderRadius: "0.75rem", padding: "5px 0", textAlign: "center", fontSize: "0.7rem", fontWeight: 700, color: C.blue }}>
                      {o}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ background: C.blue, borderRadius: "1.25rem", padding: "10px 12px", display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#fff" }}>查看全部 50+ 场赛事</span>
              <span style={{ color: "#ffffffcc" }}>→</span>
            </div>
          </div>
        </div>
      </div>
      {/* Floating odds chip */}
      <div className="cg-float-a" style={{
        position: "absolute", top: 60, right: -48,
        background: C.white, borderRadius: "1.5rem",
        padding: "10px 14px",
        boxShadow: `0 8px 24px ${C.textDark}14`,
        display: "flex", alignItems: "center", gap: 8,
        minWidth: 120,
      }}>
        <div style={{ width: 28, height: 28, borderRadius: "0.75rem", background: C.blueBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚽</div>
        <div>
          <div style={{ fontSize: "0.65rem", color: C.textLight }}>英超 64&apos;</div>
          <div style={{ fontSize: "0.85rem", fontWeight: 800, color: C.green }}>2.10↑</div>
        </div>
      </div>
      {/* Floating tag */}
      <div className="cg-float-b" style={{
        position: "absolute", bottom: 80, left: -44,
        background: C.green, borderRadius: "2rem",
        padding: "7px 14px",
        boxShadow: `0 8px 20px ${C.green}44`,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#fff" }}>⚡ 赢款已到账</span>
      </div>
    </div>
  );
}

function StatsBar() {
  return (
    <section style={{ background: C.blue, padding: "2.25rem 1.5rem" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}
        className="cg-stats-grid">
        {STATS.map(s => (
          <div key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: "clamp(1.75rem, 3vw, 2.25rem)", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: "0.85rem", color: "#ffffffaa", marginTop: 4, fontWeight: 500 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section style={{ background: C.pageBg, padding: "5rem 1.5rem" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto" }}>
        <SectionHeader
          tag="核心功能"
          title="为什么选择 CrownGold"
          sub="专为华人玩家深度打磨，每个细节都经过精心设计"
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }} className="cg-feat-grid">
          {FEATURES.map(f => (
            <div key={f.title} className="cg-feature-card"
              style={{
                background: C.white, borderRadius: "1.75rem", padding: "2rem",
                boxShadow: `0 2px 12px ${C.textDark}06`,
                transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
                cursor: "default",
              }}>
              <div className="cg-icon-box"
                style={{
                  width: 56, height: 56, borderRadius: "1.5rem",
                  background: C.blueBg, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 26, marginBottom: "1.25rem",
                  transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
                }}>
                {f.icon}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: C.textDark, margin: 0 }}>{f.title}</h3>
                <span style={{ padding: "2px 10px", borderRadius: "2rem", background: C.blueBg, color: C.blue, fontSize: "0.72rem", fontWeight: 700 }}>{f.tag}</span>
              </div>
              <p style={{ fontSize: "0.9rem", color: C.textMid, lineHeight: 1.7, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SportsSection() {
  const [active, setActive] = useState("足球");
  return (
    <section style={{ background: C.white, padding: "5rem 1.5rem" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto" }}>
        <SectionHeader
          tag="运动项目"
          title="多项运动，全面覆盖"
          sub="从足球到篮球，丰富的运动项目任您选择"
        />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginBottom: "3rem" }}>
          {SPORTS.map(s => (
            <button key={s.name}
              onClick={() => setActive(s.name)}
              className="cg-sport-pill"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 22px", borderRadius: "2rem", border: "none",
                background: active === s.name ? C.blue : C.blueBg,
                color:  active === s.name ? "#fff" : C.textMid,
                fontWeight: 700, fontSize: "0.9rem", cursor: "pointer",
                boxShadow: active === s.name ? `0 6px 18px ${C.blue}44` : "none",
                transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
              }}>
              <span style={{ fontSize: 18 }}>{s.emoji}</span>
              {s.name}
              {s.hot && <span style={{ padding: "1px 7px", borderRadius: "2rem", background: active === s.name ? "rgba(255,255,255,0.25)" : `${C.red}18`, color: active === s.name ? "#fff" : C.red, fontSize: "0.65rem", fontWeight: 800 }}>热</span>}
            </button>
          ))}
        </div>
        <OddsPreview />
      </div>
    </section>
  );
}

function OddsPreview() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }} className="cg-odds-grid">
      {SAMPLE_ODDS.map((m, i) => (
        <div key={i} className="cg-odds-card"
          style={{
            background: C.white, borderRadius: "1.75rem",
            border: `1.5px solid ${C.border}`,
            padding: "1.5rem",
            boxShadow: `0 2px 16px ${C.textDark}06`,
            transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
            cursor: "pointer",
          }}>
          {/* Header row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ padding: "3px 10px", borderRadius: "2rem", background: C.blueBg, color: C.blue, fontSize: "0.72rem", fontWeight: 700 }}>{m.league}</span>
              {m.live && <span style={{ padding: "3px 10px", borderRadius: "2rem", background: `${C.red}14`, color: C.red, fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.red, display: "inline-block" }} />LIVE
              </span>}
            </div>
            <span style={{ fontSize: "0.8rem", color: C.textLight, fontWeight: 600 }}>{m.time}</span>
          </div>
          {/* Teams + score */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
            <span style={{ fontWeight: 800, fontSize: "1rem", color: C.textDark }}>{m.home}</span>
            <div style={{ textAlign: "center" }}>
              {m.score
                ? <span style={{ fontWeight: 900, fontSize: "1.1rem", color: C.blue, background: C.blueBg, padding: "4px 14px", borderRadius: "1rem" }}>{m.score}</span>
                : <span style={{ fontWeight: 600, fontSize: "0.85rem", color: C.textLight }}>VS</span>}
            </div>
            <span style={{ fontWeight: 800, fontSize: "1rem", color: C.textDark }}>{m.away}</span>
          </div>
          {/* Odds row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[
              { label: "主", val: m.mh },
              { label: "平", val: m.mn },
              { label: "客", val: m.mc },
            ].map(o => (
              <button key={o.label} className="cg-odds-btn"
                style={{
                  border: "none", borderRadius: "1rem", padding: "10px 0",
                  background: C.blueBg, cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  transition: "all 0.22s cubic-bezier(0.4,0,0.2,1)",
                }}>
                <span style={{ fontSize: "0.65rem", color: C.textLight, fontWeight: 600 }}>{o.label}</span>
                <span style={{ fontSize: "0.95rem", fontWeight: 800, color: C.blue }}>{o.val}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CtaSection() {
  return (
    <section style={{ background: C.pageBg, padding: "5rem 1.5rem" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto" }}>
        <div style={{
          background: C.blue,
          borderRadius: "2.5rem",
          padding: "4rem 3rem",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
          boxShadow: `0 24px 64px ${C.blue}44`,
        }}>
          {/* Decorative circles */}
          <div style={{ position: "absolute", top: -48, left: -48, width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
          <div style={{ position: "absolute", bottom: -32, right: -32, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />

          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ display: "inline-block", padding: "5px 18px", borderRadius: "2rem", background: "rgba(255,255,255,0.18)", color: "#fff", fontSize: "0.8rem", fontWeight: 700, marginBottom: "1.25rem", letterSpacing: "0.06em" }}>
              免费注册 · 立即开始
            </div>
            <h2 style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)", fontWeight: 900, color: "#fff", margin: "0 0 1rem", lineHeight: 1.2, letterSpacing: "-0.02em" }}>
              加入数万玩家的行列
            </h2>
            <p style={{ fontSize: "1.05rem", color: "rgba(255,255,255,0.8)", maxWidth: 500, margin: "0 auto 2.25rem", lineHeight: 1.7 }}>
              无需下载 App，打开浏览器即可开始下注，随时随地体验顶级竞猜体验。
            </p>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
              <a href={SPORTS_HREF} className="cg-cta-btn-white"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "14px 36px", borderRadius: "2rem",
                  background: "#fff", color: C.blue,
                  fontWeight: 800, fontSize: "1rem", textDecoration: "none",
                  boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
                  transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
                }}>
                立即体验 →
              </a>
              <a href={SPORTS_HREF} className="cg-cta-btn-ghost"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "14px 36px", borderRadius: "2rem",
                  background: "transparent", color: "#fff",
                  border: "2px solid rgba(255,255,255,0.5)",
                  fontWeight: 700, fontSize: "1rem", textDecoration: "none",
                  transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
                }}>
                了解更多
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{ background: C.textDark, padding: "3rem 1.5rem 2rem" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 40, marginBottom: "2.5rem" }} className="cg-footer-grid">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1rem" }}>
              <div style={{ width: 32, height: 32, borderRadius: "0.75rem", background: C.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>👑</div>
              <span style={{ fontWeight: 800, color: "#fff", fontSize: "1rem" }}>CrownGold</span>
            </div>
            <p style={{ fontSize: "0.875rem", color: "#94A3B8", lineHeight: 1.7, maxWidth: 280, margin: 0 }}>
              专业华人体育竞猜平台，覆盖全球主流赛事，提供安全、公平、透明的竞猜体验。
            </p>
          </div>
          {[
            { title: "产品", links: ["滚球竞猜", "早盘竞猜", "冠军玩法", "串关投注"] },
            { title: "运动", links: ["足球", "篮球", "网球", "更多运动"] },
            { title: "支持", links: ["帮助中心", "联系客服", "负责任博彩", "用户协议"] },
          ].map(col => (
            <div key={col.title}>
              <h4 style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fff", marginBottom: "0.875rem" }}>{col.title}</h4>
              {col.links.map(l => (
                <a key={l} href={SPORTS_HREF}
                  style={{ display: "block", fontSize: "0.85rem", color: "#94A3B8", textDecoration: "none", marginBottom: "0.5rem", transition: "color 0.2s" }}
                  className="cg-footer-link">
                  {l}
                </a>
              ))}
            </div>
          ))}
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <span style={{ fontSize: "0.8rem", color: "#64748B" }}>© 2026 CrownGold. 请合理娱乐，理性竞猜。</span>
          <div style={{ display: "flex", gap: 16 }}>
            {["隐私政策", "服务条款", "Cookie 政策"].map(l => (
              <a key={l} href="#" style={{ fontSize: "0.8rem", color: "#64748B", textDecoration: "none" }}>{l}</a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

function SectionHeader({ tag, title, sub }: { tag: string; title: string; sub: string }) {
  return (
    <div style={{ textAlign: "center", marginBottom: "3rem" }}>
      <div style={{ display: "inline-block", padding: "5px 16px", borderRadius: "2rem", background: C.blueBg, color: C.blue, fontSize: "0.8rem", fontWeight: 700, marginBottom: "1rem", letterSpacing: "0.04em" }}>
        {tag}
      </div>
      <h2 style={{ fontSize: "clamp(1.6rem, 3vw, 2.25rem)", fontWeight: 900, color: C.textDark, margin: "0 0 0.75rem", letterSpacing: "-0.02em" }}>{title}</h2>
      <p style={{ fontSize: "1rem", color: C.textMid, maxWidth: 520, margin: "0 auto", lineHeight: 1.7 }}>{sub}</p>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────── */
export default function NextPage() {
  return (
    <>
      <style>{`
        /* Transition base */
        .cg-feature-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 40px rgba(59,130,246,0.14) !important;
          border-color: #DBEAFE;
        }
        .cg-feature-card:hover .cg-icon-box {
          background: #DBEAFE !important;
          transform: scale(1.08);
        }
        .cg-odds-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 32px rgba(59,130,246,0.12) !important;
          border-color: #BFDBFE !important;
        }
        .cg-odds-btn:hover {
          background: #3B82F6 !important;
        }
        .cg-odds-btn:hover span { color: #fff !important; }
        .cg-btn-primary:hover {
          background: #2563EB !important;
          transform: translateY(-1px);
          box-shadow: 0 10px 28px rgba(59,130,246,0.5) !important;
        }
        .cg-btn-outline:hover {
          background: #EFF6FF !important;
          transform: translateY(-1px);
        }
        .cg-btn-ghost:hover {
          background: #DBEAFE !important;
          transform: translateY(-1px);
        }
        .cg-cta-btn-white:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 32px rgba(0,0,0,0.18) !important;
        }
        .cg-cta-btn-ghost:hover {
          background: rgba(255,255,255,0.12) !important;
          border-color: rgba(255,255,255,0.75) !important;
        }
        .cg-sport-pill:hover {
          transform: scale(1.04);
        }
        .cg-nav-link:hover {
          background: #EFF6FF;
          color: #3B82F6;
        }
        .cg-footer-link:hover { color: #fff !important; }

        /* Float animations */
        @keyframes cgFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-10px); }
        }
        @keyframes cgFloatB {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(8px); }
        }
        @keyframes cgPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        .cg-float-a { animation: cgFloat  3.2s ease-in-out infinite; }
        .cg-float-b { animation: cgFloatB 4.0s ease-in-out infinite; }

        /* Responsive grid overrides */
        @media (max-width: 900px) {
          .cg-hero-grid  { grid-template-columns: 1fr !important; text-align: center; }
          .cg-hero-grid > div:last-child { display: none; }
          .cg-feat-grid  { grid-template-columns: repeat(2, 1fr) !important; }
          .cg-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .cg-odds-grid  { grid-template-columns: 1fr !important; }
          .cg-footer-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 560px) {
          .cg-feat-grid  { grid-template-columns: 1fr !important; }
          .cg-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .cg-footer-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{ background: C.white, minHeight: "100vh", fontFamily: `Arial, "PingFang SC", "Helvetica Neue", ui-sans-serif, system-ui, sans-serif` }}>
        <NavBar />
        <HeroSection />
        <StatsBar />
        <FeaturesSection />
        <SportsSection />
        <CtaSection />
        <Footer />
      </div>
    </>
  );
}
