import {DAYS, addDays, weekday, closedReason, inYear, slotAt, yearBounds, validDate} from './model.mjs?v=4';
export const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const DEFAULT_PALETTE = ['#263238','#d32f2f','#1565c0','#2e7d32','#f9a825','#7b1fa2'];
export function plannerData(state) {
  return state.planner ||= {events:{},weeks:{},palette:[...DEFAULT_PALETTE],ink:{}};
}
export function monthsOf(year) {
  return Array.from({length:12},(_,i)=>({year:year+Math.floor((i+3)/12),month:(i+3)%12+1}));
}
const dateString=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const short=date=>`${Number(date.slice(5,7))}/${Number(date.slice(8))}`;
const dayClass=(s,d)=>`${weekday(d)===5?'saturday ':''}${weekday(d)===6?'sunday ':''}${closedReason(s,d)?'holiday ':''}`;
export function annualMarkup(state,kind) {
  const data=plannerData(state);
  return `<div class="annual-sheet ${kind}">${monthsOf(state.year).map(({year,month})=>{
    const first=dateString(year,month,1), offset=(weekday(first)+1)%7;
    const days=new Date(Date.UTC(year,month,0)).getUTCDate();
    const cell=d=>{
      const date=dateString(year,month,d), reason=closedReason(state,date), event=data.events[date]||'';
      return `<button class="annual-day ${dayClass(state,date)}" data-event="${date}" title="${date} ${esc(reason)} ${esc(event)}" aria-label="${date} ${esc(reason)} ${esc(event)}"><span>${d}${kind==='list'?DAYS[weekday(date)]:''}</span><small>${esc([reason,event].filter(Boolean).join(' '))}</small></button>`;
    };
    return `<section class="month-panel"><h3>${month}月</h3>${kind==='blocks'?`<div class="month-weekdays">${['日','月','火','水','木','金','土'].map(x=>`<span>${x}</span>`).join('')}</div><div class="month-days">${Array.from({length:42},(_,i)=>i>=offset&&i<offset+days?cell(i-offset+1):'<div class="blank-day"></div>').join('')}</div>`:`<div class="month-list">${Array.from({length:31},(_,i)=>i<days?cell(i+1):'<div class="blank-day"></div>').join('')}</div>`}</section>`;
  }).join('')}</div>`;
}
export function weekMarkup(state,week,weekend=false) {
  const data=plannerData(state), fields=data.weeks[week]||{}, dayCount=weekend?7:5;
  const edit=(key,label,cls='')=>`<button class="sheet-write ${cls}" data-field="${key}" aria-label="${esc(label)}"><span>${esc(fields[key]||'')}</span></button>`;
  let grid='<div class="corner"></div>';
  for(let d=0;d<dayCount;d++) {const date=addDays(week,d);grid+=`<div class="day-head ${dayClass(state,date)}"><strong>${DAYS[d]}</strong><strong>${short(date)}</strong><small>${esc(closedReason(state,date))}</small></div>`;}
  for(const period of ['朝',1,2,3,4,'昼',5,6,'業後']) {
    grid+=`<div class="period-label">${period}</div>`;
    for(let d=0;d<dayCount;d++) {
      const date=addDays(week,d);
      if(typeof period==='string') {grid+=inYear(state,date)?edit(`${date}:${period}`,`${short(date)} ${period}`):'<div class="outside"></div>';continue;}
      const slot=slotAt(state,date,period),lesson=state.lessons.find(l=>l.id===slot.lessonId);
      grid+=`<button class="lesson-cell ${slot.outside?'outside':''} ${closedReason(state,date)?'closed':''}" data-date="${date}" data-period="${period}" ${slot.outside?'disabled':''} ${lesson?`style="--lesson-color:${esc(lesson.color)}"`:''} aria-label="${short(date)} ${DAYS[d]}曜${period}限 ${esc(lesson?.name||'空き時間')}">${lesson?`<span class="lesson-tag">${esc(lesson.name)}</span>`:''}<span class="lesson-note">${esc(slot.note)}</span>${slot.changed?'<span class="change-marker">変更</span>':''}</button>`;
    }
  }
  return `<div class="weekly-sheet"><div id="week-grid" class="week-grid" style="--days:${dayCount}">${grid}</div><aside class="week-side"><div class="day-events">${Array.from({length:7},(_,d)=>{const date=addDays(week,d);return `<div class="event-row ${dayClass(state,date)}"><span>${short(date)}(${DAYS[d]})</span><button class="sheet-write" data-event="${date}" ${inYear(state,date)?'':'disabled'} aria-label="${short(date)}の行事・予定"><small>${esc(closedReason(state,date))}</small><span>${esc(data.events[date]||'')}</span></button></div>`;}).join('')}</div><div class="teaching-plan"><h3>指導計画</h3>${Array.from({length:5},(_,i)=>`<div>${edit(`plan-title-${i}`,`指導計画${i+1}の項目`)}${edit(`plan-text-${i}`,`指導計画${i+1}の内容`)}</div>`).join('')}</div><div class="weekly-memo"><label for="week-note">メモ・ふりかえり</label><textarea id="week-note" maxlength="10000" aria-label="メモ・ふりかえり">${esc(state.notes[week]||'')}</textarea></div></aside></div>`;
}
export function validatePlanner(p,state) {
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v), text=(v,n)=>typeof v==='string'&&v.length<=n;
  if(!object(p)||!object(p.events)||!object(p.weeks)||!object(p.ink)||!Array.isArray(p.palette)||p.palette.length>8||p.palette.length<1||p.palette.some(c=>!/^#[0-9a-fA-F]{6}$/.test(c))) throw new Error('ノート欄の保存形式が不正です。');
  const [first,last]=yearBounds(state), date=d=>validDate(d)&&d>=first&&d<=last;
  if(Object.keys(p.events).length>366||Object.entries(p.events).some(([d,v])=>!date(d)||!text(v,2000))) throw new Error('行事の保存形式が不正です。');
  if(Object.keys(p.weeks).length>54) throw new Error('週の保存上限を超えています。');
  for(const [w,fields] of Object.entries(p.weeks)) {
    if(!validDate(w)||weekday(w)!==0||addDays(w,6)<first||w>last||!object(fields)||Object.keys(fields).length>31) throw new Error('週の保存形式が不正です。');
    for(const [key,value] of Object.entries(fields)) {
      const aux=key.match(/^(\d{4}-\d{2}-\d{2}):(朝|昼|業後)$/);
      if((!/^plan-(title|text)-[0-4]$/.test(key)&&!(aux&&date(aux[1])&&aux[1]>=w&&aux[1]<=addDays(w,6)))||!text(value,2000)) throw new Error('記入欄の保存形式が不正です。');
    }
  }
  if(Object.keys(p.ink).some(k=>!['blocks','list','free'].includes(k))) throw new Error('手書きページが不正です。');
}
