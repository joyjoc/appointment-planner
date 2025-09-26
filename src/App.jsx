import { doc, setDoc, getDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import React, { useMemo, useState, useEffect } from "react";
import Flatpickr from "react-flatpickr";
import ko from "flatpickr/dist/l10n/ko.js"; // 한국어 달력
import { db, ensureAnonAuth } from "./firebase";
import { doc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";


// ---- 미니 UI ----
function cls(...a){return a.filter(Boolean).join(" ")}
const Card = ({className="", children, style}) => (
  <div className={cls("rounded-2xl border border-gray-200 shadow-sm", className)} style={style}>{children}</div>
);
const CardContent = ({className="", children}) => (
  <div className={cls("p-4", className)}>{children}</div>
);
const Button = ({children, className="", ...rest}) => (
  <button className={cls(
    "inline-flex items-center justify-center rounded-xl px-3 py-2 border text-sm",
    "border-gray-300 bg-gray-50 hover:bg-gray-100",
    className
  )} {...rest}>{children}</button>
);

// ---- 유틸 ----
function dateKey(d) {
  if (typeof d === "string") return d.trim();
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function parseDateList(text) {
  return new Set(text.split(/[\n,\s]+/).map(s=>s.trim()).filter(s=>/^\d{4}-\d{2}-\d{2}$/.test(s)));
}
function enumerateDates(startStr, endStr) {
  const out=[]; const s=new Date(startStr); const e=new Date(endStr);
  if (isNaN(s)||isNaN(e)||s>e) return out;
  const cur=new Date(s); while(cur<=e){ out.push(dateKey(cur)); cur.setDate(cur.getDate()+1); } return out;
}
function intersect(a,b){ const o=new Set(); for(const x of a) if(b.has(x)) o.add(x); return o;}
function diff(a,b){ const o=new Set(); for(const x of a) if(!b.has(x)) o.add(x); return o;}
function copyToClipboard(t){ navigator.clipboard?.writeText(t); }
function toggleDateInText(text, date){ const s=parseDateList(text); s.has(date)?s.delete(date):s.add(date); return Array.from(s).sort().join(" ");}

// ---- 색상(이름별) ----
const NAME_COLORS = [
  {bg:"#fff7ed", ring:"#fdba74"}, // 인자
  {bg:"#eff6ff", ring:"#93c5fd"}, // 올립
  {bg:"#fef2f2", ring:"#fca5a5"}, // 미달
  {bg:"#ecfeff", ring:"#67e8f9"}, // 영하
  {bg:"#f5f3ff", ring:"#c4b5fd"}, // 뽁자
  {bg:"#f0fdf4", ring:"#86efac"}, // 김지
  {bg:"#fdf4ff", ring:"#f0abfc"}, // 니콩
];

export default function AppointmentPlanner(){
  // 기본 기간
  const today=new Date(); const in30=new Date(); in30.setDate(today.getDate()+30);
  const [range,setRange]=useState({start:dateKey(today), end:dateKey(in30)});

  // 참가자 프리셋
  const [people,setPeople]=useState([
    {id:1,name:"인자", wants:"", blocks:"", mode:"block", showCal:true},
    {id:2,name:"올립", wants:"", blocks:"", mode:"block", showCal:false},
    {id:3,name:"미달", wants:"", blocks:"", mode:"block", showCal:false},
    {id:4,name:"영하", wants:"", blocks:"", mode:"block", showCal:false},
    {id:5,name:"뽁자", wants:"", blocks:"", mode:"block", showCal:false},
    {id:6,name:"김지", wants:"", blocks:"", mode:"block", showCal:false},
    {id:7,name:"니콩", wants:"", blocks:"", mode:"block", showCal:false},
  ]);

  // --- Firebase 공유용 상태
  const [roomId, setRoomId] = useState(null);
  const [isReady, setIsReady] = useState(false);

  // 저장(디바운스) —— 문서 없을 때도 동작하게 setDoc+merge 사용
  let saveTimer;
  async function saveRoomNow(refData, rid) {
    const ref = doc(db, "rooms", rid);
    await setDoc(ref, { ...refData, updatedAt: serverTimestamp() }, { merge: true });
  }
  function saveRoom(refData){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!roomId) return;
      saveRoomNow(refData, roomId).catch((e)=>console.error("saveRoom error:", e));
    }, 300);
  }

  // 방 생성 & 실시간 구독 (한 번만)
useEffect(() => {
  let unsub = null;
  (async () => {
    try {
      await ensureAnonAuth();

      // room 파라미터 확보 (없으면 생성해 URL에 붙임)
      let rid = new URL(window.location.href).searchParams.get("room");
      if (!rid) {
        rid = Math.random().toString(36).slice(2, 10);
        const url = new URL(window.location.href);
        url.searchParams.set("room", rid);
        window.history.replaceState(null, "", url.toString());
      }
      setRoomId(rid);

      const ref = doc(db, "rooms", rid);

      // 🔴 여기! 문서가 없을 때만 초기 세팅
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(
          ref,
          {
            range: { start: range.start, end: range.end },
            people,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      // 실시간 구독 (기존 데이터 그대로 불러옴)
      unsub = onSnapshot(
        ref,
        (docSnap) => {
          if (!docSnap.exists()) return;
          const d = docSnap.data();
          if (d.range) setRange(d.range);
          if (d.people) setPeople(d.people);
          setIsReady(true);
        },
        (err) => console.error("onSnapshot error:", err)
      );
    } catch (e) {
      console.error("init error:", e);
    }
  })();
  return () => {
    if (unsub) unsub();
  };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);


  // --- 이름 선택 UI (처음엔 이름만, 선택한 사람만 열기)
  const [activeId,setActiveId]=useState(1);
  useEffect(()=>{
    setPeople(prev=>prev.map(p=>p.id===activeId?{...p,showCal:true}:{...p,showCal:false}));
  },[activeId]);

  // --- 계산
  const universe=useMemo(()=>new Set(enumerateDates(range.start, range.end)),[range]);
  const availability=useMemo(()=>people.map(p=>{
    const wants=parseDateList(p.wants), blocks=parseDateList(p.blocks);
    const base=wants.size>0?wants:universe, avail=diff(base,blocks);
    return {id:p.id,name:p.name,available:avail};
  }),[people,universe]);
  const common=useMemo(()=>{ let cur=new Set(universe); for(const ap of availability){ cur=intersect(cur,ap.available); if(cur.size===0)break;} return cur; },[availability,universe]);
  const scored=useMemo(()=>{
    const counts={}; for(const d of universe) counts[d]=0;
    for(const ap of availability) for(const d of ap.available) if(counts[d]!=null) counts[d]+=1;
    return Object.entries(counts).map(([date,count])=>({date,count})).sort((a,b)=>(b.count-a.count)||(a.date.localeCompare(b.date)));
  },[availability,universe]);
  const commonList=useMemo(()=>Array.from(common).sort(),[common]);

  // --- 핸들러 (모든 변경에서 saveRoom 호출)
  const handlePersonChange=(idx,key,val)=>{
    setPeople(prev=>{
      const next=[...prev];
      next[idx]={...next[idx],[key]:val};
      saveRoom({ range, people: next });
      return next;
    });
  };
  const addPerson=()=>setPeople(prev=>{
    const next=[...prev,{id:prev.length+1,name:`참가자 ${prev.length+1}`,wants:"",blocks:"",mode:"block",showCal:false}];
    saveRoom({ range, people: next });
    return next;
  });
  const removePerson=(idx)=>setPeople(prev=>{
    const next=prev.filter((_,i)=>i!==idx);
    saveRoom({ range, people: next });
    return next;
  });

  const exportCSV=()=>{
    const header=["이름","불가 날짜","원하는 날짜"].join(",");
    const rows=people.map(p=>[
      p.name,
      parseDateList(p.blocks).size?Array.from(parseDateList(p.blocks)).join(" "):"",
      parseDateList(p.wants).size?Array.from(parseDateList(p.wants)).join(" "):"",
    ].map(v=>`"${v}"`).join(","));
    const csv=[header,...rows].join("\n"); const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="약속잡기_입력템플릿.csv"; a.click(); URL.revokeObjectURL(url);
  };
  const copyResults=()=>{
    const best=scored.slice(0,20).map(({date,count})=>`${date} (${count}명 가능)`).join("\n");
    const common=commonList.length?commonList.join(", "):"(없음)";
    copyToClipboard(`공통 가능일: ${common}\n\n상위 후보(최대 20일):\n${best}`);
    alert("결과를 복사했어요!");
  };

  const personBadge=(p)=>{
    const b=parseDateList(p.blocks).size, w=parseDateList(p.wants).size;
    return <span className="text-[11px] text-gray-600 ml-1">({b}불가/{w}원함)</span>;
  };

  // ✅ 로딩 상태 처리
  if (!isReady || !roomId) {
    return <div className="p-6 text-sm text-gray-600">방 준비 중… 잠시만요.</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">약속잡기 도우미</h1>

      <Card>
        <CardContent className="grid md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-sm font-medium">기간 시작</label>
            <input
              type="date"
              value={range.start}
              onChange={(e)=>{
                const next={...range,start:e.target.value};
                setRange(next);
                saveRoom({ range: next, people });
              }}
              className="mt-1 w-full border rounded-xl px-3 py-2"
            />
          </div>
          <div>
            <label className="text-sm font-medium">기간 종료</label>
            <input
              type="date"
              value={range.end}
              onChange={(e)=>{
                const next={...range,end:e.target.value};
                setRange(next);
                saveRoom({ range: next, people });
              }}
              className="mt-1 w-full border rounded-xl px-3 py-2"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={exportCSV}>⬇️ 입력 템플릿 CSV</Button>
          </div>
        </CardContent>
      </Card>

      {/* 이름 선택 바 */}
      <div className="flex flex-wrap gap-2">
        {people.map((p,idx)=>{
          const c=NAME_COLORS[idx%NAME_COLORS.length];
          const active=p.id===activeId;
          return (
            <button
              key={p.id}
              onClick={()=>setActiveId(p.id)}
              className={cls("px-3 py-2 rounded-xl border text-sm", active?"ring-2 ring-black/20":"")}
              style={{background:c.bg, borderColor:c.ring}}
              title={`${p.name} 선택`}
            >
              {p.name}{personBadge(p)}
            </button>
          );
        })}
        <Button onClick={addPerson}>➕ 참가자 추가</Button>
      </div>

      {/* 선택된 사람만 표시 */}
      {people.map((p,idx)=>{
        if(p.id!==activeId) return null;
        const c=NAME_COLORS[idx%NAME_COLORS.length];
        return (
          <Card key={p.id} style={{background:c.bg, borderColor:c.ring}}>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <input value={p.name} onChange={e=>handlePersonChange(idx,"name",e.target.value)} className="border rounded-xl px-3 py-2 w-full md:w-64"/>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-gray-600">선택 모드</span>
                  <Button className={cls(p.mode==='block'&&'ring-2 ring-red-300')} onClick={()=>handlePersonChange(idx,'mode','block')}>🚫 불가</Button>
                  <Button className={cls(p.mode==='want'&&'ring-2 ring-green-300')} onClick={()=>handlePersonChange(idx,'mode','want')}>✅ 원하는</Button>
                  <Button onClick={()=>removePerson(idx)} title="삭제">❌ 삭제</Button>
                </div>
              </div>

              {/* 입력 순서: 불가 → 원하는 */}
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-sm font-medium mb-1">불가 날짜 (먼저 입력)</div>
                  <textarea
                    placeholder="예) 2025-10-05 2025-10-06, 2025-10-13"
                    value={p.blocks}
                    onChange={e=>handlePersonChange(idx,"blocks",e.target.value)}
                    className="w-full h-24 border rounded-xl px-3 py-2"
                  />
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">원하는 날짜 (없으면 비우기)</div>
                  <textarea
                    placeholder={"예) 2025-10-03, 2025-10-09 2025-10-12\n(없으면 비워두세요: 기간 전체가 후보)"}
                    value={p.wants}
                    onChange={e=>handlePersonChange(idx,"wants",e.target.value)}
                    className="w-full h-24 border rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              {/* Flatpickr 달력: jQuery-UI 스타일 */}
              <div className="border rounded-xl p-3 bg-white/70">
                <div className="text-sm font-medium mb-2">기간 내 날짜 선택</div>
                <Flatpickr
                  options={{
                    inline: true,
                    mode: "multiple",
                    minDate: range.start,
                    maxDate: range.end,
                    showMonths: 1,
                    locale: ko.ko,
                  }}
                  onChange={(selectedDates, _str, fp) => {
                    selectedDates.forEach((d) => {
                      const key = fp.formatDate(d, "Y-m-d");
                      if (p.mode === "block") {
                        handlePersonChange(idx, "blocks", toggleDateInText(p.blocks, key));
                      } else {
                        handlePersonChange(idx, "wants", toggleDateInText(p.wants, key));
                      }
                    });
                    fp.clear();
                  }}
                  onDayCreate={(_dObj, _dStr, fp, dayElem) => {
                    const key = fp.formatDate(dayElem.dateObj, "Y-m-d");
                    if (parseDateList(p.blocks).has(key)) dayElem.classList.add("blocked");
                    if (parseDateList(p.wants).has(key))  dayElem.classList.add("wanted");
                  }}
                />
                <div className="text-xs text-gray-500 mt-2">
                  표시색: <span className="px-2 py-0.5 rounded border blocked">불가</span>
                  {" · "}
                  <span className="px-2 py-0.5 rounded border wanted">원하는</span>
                  {"  "} (우측의 “선택 모드”를 바꾸고 날짜를 클릭하세요)
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* 결과 */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">결과</h2>
            <div className="flex gap-2">
              <Button onClick={copyResults}>📋 결과 복사</Button>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-2xl p-3">
              <div className="font-medium mb-2">공통 가능일 (전원 가능)</div>
              {commonList.length ? (
                <ul className="list-disc pl-5 space-y-1">
                  {commonList.map(d=><li key={d}>{d}</li>)}
                </ul>
              ) : <p className="text-sm text-gray-600">해당 기간에 전원이 가능한 날짜가 없습니다.</p>}
            </div>
            <div className="border rounded-2xl p-3">
              <div className="font-medium mb-2">상위 후보일 (가능 인원 순)</div>
              <ul className="space-y-1">
                {scored.slice(0,30).map(({date,count})=>(
                  <li key={date} className="text-sm"><span className="font-mono">{date}</span> — <span className="font-semibold">{count}명</span> 가능</li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
