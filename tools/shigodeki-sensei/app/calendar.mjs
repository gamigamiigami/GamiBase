// Measure wrapped text at the paper's canonical width, then reserve enough space for every row.
// The viewport can fit the resulting sheet or zoom into it without truncating event text.
export function fitCalendar(sheet) {
  if (!sheet) return 0;
  const list=sheet.classList.contains('list');
  const panels=[...sheet.querySelectorAll('.month-panel')];
  const heights=panels.map(panel=>{
    const cells=[...panel.querySelectorAll('.annual-day,.blank-day')];
    return cells.map(cell=>{
      const text=cell.querySelector('.annual-copy'), date=cell.querySelector('.annual-date');
      if (!text) return 16;
      text.style.fontSize='11px';
      const label=date?.offsetHeight||13;
      const natural=()=>[...text.children].reduce((sum,e)=>sum+e.offsetHeight,0);
      const available=cell.clientHeight-(list?0:label)-6;
      for(let size=11;size>8&&(natural()>available+1||text.scrollWidth>text.clientWidth+1);size-=.5)
        text.style.fontSize=`${size-.5}px`;
      return Math.ceil((list?Math.max(label,natural()):label+natural())+6);
    });
  });
  if(list) {
    const rows=Array.from({length:31},(_,i)=>Math.max(17,...heights.map(h=>h[i]||0)));
    panels.forEach(p=>p.querySelector('.month-list').style.gridTemplateRows=rows.map(h=>`minmax(${h}px,1fr)`).join(' '));
    return Math.ceil(rows.reduce((a,b)=>a+b,0)+panels[0].querySelector('h3').offsetHeight+2);
  }
  const totals=panels.map((panel,i)=>{
    const rows=Array.from({length:6},(_,r)=>Math.max(24,...heights[i].slice(r*7,r*7+7)));
    panel.querySelector('.month-days').style.gridTemplateRows=rows.map(h=>`minmax(${h}px,1fr)`).join(' ');
    return rows.reduce((a,b)=>a+b,0)+panel.querySelector('h3').offsetHeight+panel.querySelector('.month-weekdays').offsetHeight+2;
  });
  const rows=Array.from({length:3},(_,i)=>Math.max(...totals.slice(i*4,i*4+4)));
  sheet.style.gridTemplateRows=rows.map(h=>`minmax(${h}px,1fr)`).join(' ');
  return Math.ceil(rows.reduce((a,b)=>a+b,0)+20);
}
