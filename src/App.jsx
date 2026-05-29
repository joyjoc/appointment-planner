import React, { useMemo, useState, useEffect } from "react";
import Flatpickr from "react-flatpickr";
import ko from "flatpickr/dist/l10n/ko.js";
import { db, ensureAnonAuth } from "./firebase";
import { doc, setDoc, getDoc, onSnapshot, serverTimestamp } from "firebase/firestore";

const cls = (...a) => a.filter(Boolean).join(" ");

function dateKey(d) {
  if (typeof d === "string") return d.trim();
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function enumerateDates(startStr, endStr) {
  const out=[], s=new Date(startStr), e=new Date(endStr);
  if (isNaN(s)||isNaN(e)||s>e) return out;
  const cur=new Date(s); while(cur<=e){ out.push(dateKey(cur)); cur.setDate(cur.getDate()+1); }
  return out;
}
function parseList(text){ return new Set(text.split(/[\n,\s]+/).map(s=>s.trim()).filter(Boolean)); }
function toggleInText(text, key){
  const s=parseList(text);
  s.has(key)?s.delete(key):s.add(key);
  return Array.from(s).sort().join(" ");
}

const MEMBER_COLORS = [
  "#f97316","#3b82f6","#ef4444","#06b6d4",
  "#8b5cf6","#22c55e","#ec4899",
];

export default function AppointmentPlanner(){
  const today=new Date(); const in30=new Date(); in30.setDate(today.getDate()+30);
  const [range,setRange]=useState({ start: dateKey(today), end: dateKey(in30) });
  const [title, setTitle] = useState("약속잡기");
  const [editingTitle, setEditingTitle] = useState(false);
  const [people,setPeople]=useState([
    {id:1,name:"Iris",blocks:""},{id:2,name:"Olip",blocks:""},
    {id:3,name:"Michelle",blocks:""},{id:4,name:"YH",blocks:""},
    {id:5,name:"Bonita",blocks:""},{id:6,name:"Kimberly",blocks:""},
    {id:7,name:"Nina",blocks:""},
  ]);
  const [roomId, setRoomId] = useState(null);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState(null);

  let saveTimer;
  const saveRoom = (data) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!roomId) return;
      const ref = doc(db, "rooms", roomId);
      await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    }, 250);
  };

  useEffect(() => {
    let unsub=null;
    (async () => {
      await ensureAnonAuth();
      let rid = new URL(window.location.href).searchParams.get("room");
      if (!rid) {
        rid = Math.random().toString(36).slice(2,10);
        const u = new URL(window.location.href);
        u.searchParams.set("room", rid);
        window.history.replaceState(null, "", u.toString());
      }
      setRoomId(rid);
      const ref = doc(db, "rooms", rid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, { range, people, title: "약속잡기", createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      }
      unsub = onSnapshot(ref, (ds) => {
        if (!ds.exists()) return;
        const d = ds.data();
        if (d.range) setRange(d.range);
        if (d.people) setPeople(d.people.map((p,i)=>({ id:p.id??i+1, name:p.name, blocks:p.blocks||"" })));
        if (d.title) setTitle(d.title);
        setReady(true);
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  const universe = useMemo(()=>new Set(enumerateDates(range.start, range.end)),[range]);
  const availabilityByPerson = useMemo(()=>
    people.map(p=>({ ...p, blocks: parseList(p.blocks) }))
  ,[people]);
  const countsPerDate = useMemo(()=>{
    const total = people.length;
    const counts = Object.fromEntries(Array.from(universe).map(d=>[d, total]));
    availabilityByPerson.forEach(ap=>{
      Array.from(universe).forEach(d=>{ if (ap.blocks.has(d)) counts[d] -= 1; });
    });
    return counts;
  },[availabilityByPerson, universe, people.length]);

  const setBlocks = (idx, nextText) => {
    setPeople(prev=>{
      const arr=[...prev];
      arr[idx] = { ...arr[idx], blocks: nextText };
      saveRoom({ range, people: arr, title });
      return arr;
    });
  };

  /* ── 2025~2026 한국 공휴일 ── */
const KR_HOLIDAYS = new Set([
  "2026-01-01","2026-01-28","2026-01-29","2026-01-30",
  "2026-03-01","2026-05-05","2026-05-25",
  "2026-06-06","2026-08-15",
  "2026-09-24","2026-09-25","2026-09-26",
  "2026-10-03","2026-10-09","2026-12-25",
]);

const decorateResultDay = (dayElem, fp) => {
  const key = fp.formatDate(dayElem.dateObj, "Y-m-d");

  // 공휴일 표시
  if (KR_HOLIDAYS.has(key)) {
    dayElem.style.color = "#ef4444";
  }

  if (countsPerDate[key] == null) return;
  const able = countsPerDate[key];
  const total = people.length;
  if (able === total) dayElem.classList.add("cal-all-free");
  else if (able === 0) dayElem.classList.add("cal-all-busy");
  else dayElem.classList.add("cal-part-free");

  const badge = document.createElement("span");
  badge.textContent = String(able);
  badge.className = "cal-badge";
  dayElem.style.position = "relative";
  dayElem.appendChild(badge);
};

  if (!ready || !roomId) {
    return (
      <div className="app-loading">
        <div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" />
      </div>
    );
  }

  const activeIndex = people.findIndex(p => p.id === activeId);
  const allFreeDates = Object.entries(countsPerDate)
    .filter(([,c])=>c===people.length)
    .sort(([a],[b])=>a.localeCompare(b));

  return (
    <div className="app-root">
      <div className="app-inner">

        {/* 헤더 */}
        <header className="app-header">
          <div className="header-eyebrow">일정 조율</div>
          {editingTitle ? (
            <input
              autoFocus
              value={title}
              onChange={e=>setTitle(e.target.value)}
              onBlur={()=>{ setEditingTitle(false); saveRoom({ range, people, title }); }}
              onKeyDown={e=>{ if(e.key==="Enter"){ setEditingTitle(false); saveRoom({ range, people, title }); } }}
              className="title-input"
            />
          ) : (
            <h1 className="app-title" onClick={()=>setEditingTitle(true)}>
              {title}
              <span className="title-edit-icon">✏️</span>
            </h1>
          )}
          <p className="header-hint">제목을 클릭하면 수정할 수 있어요</p>
        </header>

        {/* 사용법 */}
        <section className="guide-card">
          <div className="guide-steps">
            {[
              ["①","기간 설정","조율할 날짜 범위를 정해요"],
              ["②","이름 선택","본인 이름을 눌러요"],
              ["③","불가 표시","갈 수 없는 날을 탭해요"],
              ["④","결과 확인","초록 날짜가 모두 가능!"],
            ].map(([num, title, desc])=>(
              <div className="guide-step" key={num}>
                <span className="guide-num">{num}</span>
                <span className="guide-title">{title}</span>
                <span className="guide-desc">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 기간 설정 */}
        <section className="card">
          <div className="card-label">📅 조율 기간</div>
          <div className="date-grid">
            <label className="date-label">
              <span>시작일</span>
              <input type="date" value={range.start}
                onChange={e=>{ const next={...range,start:e.target.value}; setRange(next); saveRoom({range:next,people,title}); }}
                className="date-input"
              />
            </label>
            <label className="date-label">
              <span>종료일</span>
              <input type="date" value={range.end}
                onChange={e=>{ const next={...range,end:e.target.value}; setRange(next); saveRoom({range:next,people,title}); }}
                className="date-input"
              />
            </label>
          </div>
        </section>

        {/* 참여자 */}
        <section className="card">
          <div className="card-label">👥 참여자 — 이름을 눌러 불가 날짜 입력</div>
          <div className="people-grid">
            {people.map((p, i)=>{
              const color = MEMBER_COLORS[i % MEMBER_COLORS.length];
              const active = p.id === activeId;
              const blockedCount = parseList(p.blocks).size;
              return (
                <button
                  key={p.id}
                  onClick={()=>setActiveId(active ? null : p.id)}
                  className={cls("person-btn", active && "person-btn--active")}
                  style={{ "--accent": color }}
                >
                  <span className="person-avatar" style={{background: color + "22", color}}>
                    {p.name[0]}
                  </span>
                  <span className="person-name">{p.name}</span>
                  {blockedCount > 0 && (
                    <span className="person-badge">{blockedCount}일 불가</span>
                  )}
                  {active && <span className="person-close">✕</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* 개인 불가 달력 */}
        {activeId !== null && people[activeIndex] && (
          <section className="card cal-card">
            <div className="card-label">
              🚫 <span style={{color: MEMBER_COLORS[activeIndex % MEMBER_COLORS.length]}}>
                {people[activeIndex].name}
              </span>의 불가 날짜
              <span className="cal-hint">날짜를 탭하면 표시돼요</span>
            </div>
            <Flatpickr
              className="fp-hidden"
              options={{
                inline:true, mode:"multiple",
                minDate:range.start, maxDate:range.end,
                showMonths:1, locale:ko.ko, clickOpens:false,
              }}
              onDayCreate={(_d,_s,fp,dayElem)=>{
                const key = fp.formatDate(dayElem.dateObj,"Y-m-d");
                const set = parseList(people[activeIndex].blocks);
                if (KR_HOLIDAYS.has(key)) dayElem.style.color = "#ef4444";
                if (set.has(key)) dayElem.classList.add("fp-blocked");
                dayElem.addEventListener("click",(ev)=>{
                  ev.preventDefault(); ev.stopPropagation();
                  const was = set.has(key);
                  setBlocks(activeIndex, toggleInText(people[activeIndex].blocks, key));
                  if (was) dayElem.classList.remove("fp-blocked");
                  else dayElem.classList.add("fp-blocked");
                });
              }}
            />
          </section>
        )}

        {/* 결과 달력 */}
        <section className="card cal-card">
          <div className="card-label">📊 결과 달력</div>
          <Flatpickr
            options={{
              inline:true, mode:"multiple",
              minDate:range.start, maxDate:range.end,
              showMonths:1, locale:ko.ko, clickOpens:false, enable:[],
            }}
            onDayCreate={(_d,_s,fp,dayElem)=>decorateResultDay(dayElem,fp)}
          />
          <div className="legend-row">
            <span className="legend-item"><span className="legend-dot legend-green"/>전원 가능</span>
            <span className="legend-item"><span className="legend-dot legend-yellow"/>일부 가능</span>
            <span className="legend-item"><span className="legend-dot legend-gray"/>전원 불가</span>
          </div>
        </section>

        {/* 전원 가능 날짜 */}
        <section className={cls("card", allFreeDates.length > 0 ? "card--success" : "")}>
          <div className="card-label">✅ 전원 가능 날짜</div>
          {allFreeDates.length === 0 ? (
            <p className="empty-msg">아직 전원 가능한 날짜가 없어요</p>
          ) : (
            <ul className="free-list">
              {allFreeDates.map(([date])=>{
                const d = new Date(date);
                const day = ["일","월","화","수","목","금","토"][d.getDay()];
                const isWeekend = d.getDay()===0||d.getDay()===6;
                return (
                  <li key={date} className={cls("free-item", isWeekend&&"free-item--weekend")}>
                    <span className="free-date">{date}</span>
                    <span className={cls("free-day", isWeekend&&"free-day--weekend")}>({day})</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

      </div>
    </div>
  );
}