import React, { useMemo, useState, useEffect } from "react";
import Flatpickr from "react-flatpickr";
import ko from "flatpickr/dist/l10n/ko.js";
import { db, ensureAnonAuth } from "./firebase";
import { doc, setDoc, getDoc, onSnapshot, serverTimestamp } from "firebase/firestore";

/* ---- 작은 UI 유틸 ---- */
const cls = (...a) => a.filter(Boolean).join(" ");
const Button = (p) => (
  <button
    {...p}
    className={[
      "w-full rounded-xl border px-4 py-5 h-16",  // 큼직한 버튼
      "text-lg font-semibold",
      "bg-white hover:bg-gray-50",
      p.className || ""
    ].join(" ")}
  />
);

/* ---- 날짜 유틸 ---- */
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

/* ---- 색상 팔레트(사람별) ---- */
const NAME_COLORS = [
  { bg:"#fff7ed", ring:"#fdba74" }, // 1
  { bg:"#eff6ff", ring:"#93c5fd" }, // 2
  { bg:"#fef2f2", ring:"#fca5a5" }, // 3
  { bg:"#ecfeff", ring:"#67e8f9" }, // 4
  { bg:"#f5f3ff", ring:"#c4b5fd" }, // 5
  { bg:"#f0fdf4", ring:"#86efac" }, // 6
  { bg:"#fdf4ff", ring:"#f0abfc" }, // 7
];

export default function AppointmentPlanner(){
  /* 기본 기간(오늘 ~ +30일) */
  const today=new Date(); const in30=new Date(); in30.setDate(today.getDate()+30);
  const [range,setRange]=useState({ start: dateKey(today), end: dateKey(in30) });

  /* 참여자(불가만 사용) */
  const [people,setPeople]=useState([
    {id:1,name:"Iris", blocks:""},
    {id:2,name:"Olip", blocks:""},
    {id:3,name:"Michelle", blocks:""},
    {id:4,name:"YH", blocks:""},
    {id:5,name:"Bonita", blocks:""},
    {id:6,name:"Kimberly", blocks:""},
    {id:7,name:"Nina", blocks:""},
  ]);

  /* 방/동기화 */
  const [roomId, setRoomId] = useState(null);
  const [ready, setReady] = useState(false);

  // 저장(디바운스)
  let saveTimer;
  const saveRoom = (data) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!roomId) return;
      const ref = doc(db, "rooms", roomId);
      await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    }, 250);
  };

  // 방 생성 & 구독
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

      // 문서 없을 때만 초기화
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          range, people, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        }, { merge: true });
      }

      unsub = onSnapshot(ref, (ds) => {
        if (!ds.exists()) return;
        const d = ds.data();
        if (d.range) setRange(d.range);
        if (d.people) setPeople(d.people.map((p,i)=>({ id:p.id??i+1, name:p.name, blocks:p.blocks||"" })));
        setReady(true);
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  /* 선택 중인 사람: 처음엔 null → 이름 클릭 후 달력 표시 */
  const [activeId, setActiveId] = useState(null);

  /* 계산 */
  const universe = useMemo(()=>new Set(enumerateDates(range.start, range.end)),[range]);
  const availabilityByPerson = useMemo(()=>{
    return people.map(p=>{
      const blocks = parseList(p.blocks);
      const available = new Set(Array.from(universe).filter(d=>!blocks.has(d)));
      return { id:p.id, name:p.name, available, blocks };
    });
  },[people,universe]);
  const countsPerDate = useMemo(()=>{
    const total = people.length;
    const counts = Object.fromEntries(Array.from(universe).map(d=>[d, total]));
    availabilityByPerson.forEach(ap=>{
      Array.from(universe).forEach(d=>{
        if (ap.blocks.has?.(d)) counts[d] -= 1;
      });
    });
    return counts; // date => 가능한 인원 수
  },[availabilityByPerson, universe, people.length]);

  /* 핸들러 */
  const setBlocks = (idx, nextText) => {
    setPeople(prev=>{
      const arr=[...prev];
      arr[idx] = { ...arr[idx], blocks: nextText };
      saveRoom({ range, people: arr });
      return arr;
    });
  };

  /* 결과 달력 Day 스타일러 */
  const decorateResultDay = (dayElem, fp) => {
    const key = fp.formatDate(dayElem.dateObj, "Y-m-d");
    if (!countsPerDate[key] && countsPerDate[key] !== 0) return;
    const able = countsPerDate[key];
    const total = people.length;

    if (able === total) dayElem.classList.add("all-free");
    else if (able === 0) dayElem.classList.add("all-busy");
    else dayElem.classList.add("part-free");

    const badge = document.createElement("span");
    badge.textContent = String(able);
    badge.style.cssText = "position:absolute;right:4px;bottom:2px;font-size:10px;padding:0 4px;border-radius:8px;background:rgba(0,0,0,.08);";
    dayElem.style.position = "relative";
    dayElem.appendChild(badge);
  };

  if (!ready || !roomId) {
    return <div className="p-6 text-sm text-gray-600">방 준비 중…</div>;
  }

  const activeIndex = people.findIndex(p => p.id === activeId);

  return (
    <div className="max-w-5xl mx-auto p-5 space-y-6">
      <h1 className="text-2xl font-bold">약속잡기 도우미</h1>

      {/* 기간 설정 */}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          기간 시작
          <input
            type="date"
            value={range.start}
            onChange={(e)=>{ const next={...range,start:e.target.value}; setRange(next); saveRoom({range:next, people}); }}
            className="mt-1 w-full border rounded-xl px-3 py-2"
          />
        </label>
        <label className="text-sm">
          기간 종료
          <input
            type="date"
            value={range.end}
            onChange={(e)=>{ const next={...range,end:e.target.value}; setRange(next); saveRoom({range:next, people}); }}
            className="mt-1 w-full border rounded-xl px-3 py-2"
          />
        </label>
      </div>

      {/* 소속원 7명: 세로 큰 버튼 */}
      <div className="grid grid-cols-1 gap-2">
        {people.map((p, i)=>{
          const c = NAME_COLORS[i%NAME_COLORS.length];
          const active = p.id===activeId;
          return (
            <Button
              key={p.id}
              onClick={()=>setActiveId(p.id)}
              className={cls(active && "ring-2 ring-black/20")}
              style={{background:c.bg, borderColor:c.ring}}
              title={`${p.name}의 불가 날짜 선택`}
            >
              {p.name}
            </Button>
          );
        })}
      </div>

      {/* 선택한 사람의 “불가 날짜” 달력만 표시 (선택 전엔 숨김) */}
      {activeId !== null && people[activeIndex] && (
        <div className="rounded-xl border p-4 bg-white">
          <div className="mb-2 font-semibold">
            {people[activeIndex].name} — 불가 날짜 선택
          </div>

          <Flatpickr
            className="flatpickr-input-hidden" // ← 입력박스 숨김
            options={{
              inline: true,
              mode: "multiple",
              minDate: range.start,
              maxDate: range.end,
              showMonths: 1,
              locale: ko.ko,
              clickOpens: false, // 입력창 비활성화, 셀 직접 클릭
            }}
            /* 날짜 셀 클릭으로 직접 토글 */
            onDayCreate={(_dObj, _dStr, fp, dayElem) => {
              const key = fp.formatDate(dayElem.dateObj, "Y-m-d");
              const set = parseList(people[activeIndex].blocks);

              if (set.has(key)) dayElem.classList.add("blocked");

              dayElem.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();

                const wasBlocked = set.has(key);
                const next = toggleInText(people[activeIndex].blocks, key);
                setBlocks(activeIndex, next);

                if (wasBlocked) dayElem.classList.remove("blocked");
                else dayElem.classList.add("blocked");
              });
            }}
          />
        </div>
      )}

{/* 결과: 달력으로 요일 포함 표시 (보기용) */}
<div className="rounded-xl border p-4 bg-white">
  <div className="mb-2 font-semibold">결과 달력</div>
  <Flatpickr
    options={{
      inline: true,
      mode: "multiple",
      minDate: range.start,
      maxDate: range.end,
      showMonths: 1,
      locale: ko.ko,
      clickOpens: false,  // 보기용
      enable: [],         // 선택 불가
    }}
    onDayCreate={(_dObj, _dStr, fp, dayElem) => decorateResultDay(dayElem, fp)}
  />

  <div className="text-xs text-gray-500 mt-2 flex gap-3">
    <span><span className="legend legend-allfree" /> 전원 가능</span>
    <span><span className="legend legend-part" /> 일부 가능</span>
    <span><span className="legend legend-busy" /> 전원 불가</span>
  </div>

  {/* ✅ 가능 날짜 텍스트 출력 */}
  <div className="mt-4">
    <div className="font-medium mb-1">전원 가능 날짜</div>
    <ul className="list-disc pl-5 space-y-1 text-sm">
      {Object.entries(countsPerDate)
        .filter(([date, count]) => count === people.length) // 전원 가능만
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date]) => {
          const d = new Date(date);
          const weekdays = ["일","월","화","수","목","금","토"];
          const day = weekdays[d.getDay()];
          return <li key={date}>{date} ({day})</li>;
        })}
    </ul>
  </div>
</div>
    </div>
  );
}

