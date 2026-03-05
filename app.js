const TOWERS=[
  {lat:49.010924967578234,lng:8.386127143611693,name:"Turm West"},
  {lat:49.01189835923452,lng:8.406438513549588,name:"Turm Mitte-West"},
  {lat:49.00759741335346,lng:8.398087439992846,name:"Turm Süd-Mitte"},
  {lat:49.00947898308795,lng:8.419205592852764,name:"Turm Mitte-Ost"},
  {lat:48.998463819002204,lng:8.474148930061281,name:"Turm Durlach"},
];
const HOTSPOTS=[
  {lat:49.01003920549964,lng:8.394179505229648,name:"Europaplatz",trend:"stable"},
  {lat:49.00827749510261,lng:8.40990270520203,name:"Kronenplatz",trend:"increasing"},
  {lat:49.00071730400815,lng:8.426548212118755,name:"Ostring",trend:"declining"},
];
const DISCOVERED_HOTSPOTS=[
  {lat:49.00868244041697,lng:8.399378946018745,name:"St.-Stefan-Kirche"},
  {lat:48.9935,lng:8.4020,name:"Hauptbahnhof"},
];
const URBAN_BOUNDARY=[
  {lat:49.030,lng:8.340},{lat:49.032,lng:8.380},{lat:49.028,lng:8.420},
  {lat:49.025,lng:8.450},{lat:49.020,lng:8.470},{lat:49.015,lng:8.490},
  {lat:49.005,lng:8.500},{lat:48.990,lng:8.495},{lat:48.985,lng:8.475},
  {lat:48.983,lng:8.450},{lat:48.985,lng:8.420},{lat:48.985,lng:8.390},
  {lat:48.988,lng:8.360},{lat:48.995,lng:8.340},{lat:49.005,lng:8.335},
  {lat:49.015,lng:8.335},{lat:49.025,lng:8.338},
];

const canvas=document.getElementById('map');
const ctx=canvas.getContext('2d');
let dpr=window.devicePixelRatio||1;

function lat2y(lat){const s=Math.sin(lat*Math.PI/180);return 0.5-Math.log((1+s)/(1-s))/(4*Math.PI);}
function lng2x(lng){return(lng+180)/360;}

let mapZoom=window.innerWidth>=768?13:12,centerX=lng2x(8.419),centerY=lat2y(49.013),panX=0,panY=0;
let analysisRadius=500;
let layers={gap:true,labels:false,hotspots:false};

function worldScale(){return 256*Math.pow(2,mapZoom);}
function resize(){
  const r=canvas.parentElement.getBoundingClientRect();
  canvas.width=r.width*dpr;canvas.height=r.height*dpr;
  canvas.style.width=r.width+'px';canvas.style.height=r.height+'px';
}
function W(){return canvas.width/dpr;}function H(){return canvas.height/dpr;}

function geo(lat,lng){
  const ws=worldScale();
  return{x:W()/2+(lng2x(lng)*ws-(centerX*ws+panX)),y:H()/2+(lat2y(lat)*ws-(centerY*ws+panY))};
}
function m2px(m){
  return m/((40075016.686*Math.cos(49.005*Math.PI/180))/worldScale());
}

// === TILES ===
const tileCache={};
const TILE_URL='https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png';
function getTile(tx,ty,tz){
  const key=tz+'/'+tx+'/'+ty;
  if(tileCache[key])return tileCache[key];
  const img=new Image();img.crossOrigin='anonymous';
  img.src=TILE_URL.replace('{z}',tz).replace('{x}',tx).replace('{y}',ty);
  img.onload=()=>{tileCache[key].loaded=true;render();};
  img.onerror=()=>{tileCache[key].error=true;};
  tileCache[key]={img,loaded:false,error:false};
  return tileCache[key];
}
function drawTiles(){
  const ws=worldScale(),cx=centerX*ws+panX,cy=centerY*ws+panY;
  const tz=Math.max(0,Math.min(19,Math.round(mapZoom)));
  const tc=Math.pow(2,tz),tws=ws/tc;
  const left=cx-W()/2,top_=cy-H()/2,right=cx+W()/2,bottom=cy+H()/2;
  const txMin=Math.floor((left/ws)*tc),txMax=Math.floor((right/ws)*tc);
  const tyMin=Math.floor((top_/ws)*tc),tyMax=Math.floor((bottom/ws)*tc);
  for(let tx=txMin;tx<=txMax;tx++){
    for(let ty=tyMin;ty<=tyMax;ty++){
      const wtx=((tx%tc)+tc)%tc;
      if(ty<0||ty>=tc)continue;
      const tile=getTile(wtx,ty,tz);
      const sx=W()/2+((tx/tc)*ws-cx),sy=H()/2+((ty/tc)*ws-cy);
      if(tile.loaded)ctx.drawImage(tile.img,sx,sy,tws+0.5,tws+0.5);
      else{ctx.fillStyle='#e8e4de';ctx.fillRect(sx,sy,tws+0.5,tws+0.5);}
    }
  }
}

// === HELPERS ===
function pip(lat,lng,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const yi=poly[i].lat,xi=poly[i].lng,yj=poly[j].lat,xj=poly[j].lng;
    if((yi>lat)!==(yj>lat)&&lng<(xj-xi)*(lat-yi)/(yj-yi)+xi)inside=!inside;
  }return inside;
}
const D2M_LAT=111320,D2M_LNG=111320*Math.cos(49.005*Math.PI/180);

// Precompute distance grid
const GRID_STEP=0.00015;
const LAT_MIN=48.978,LAT_MAX=49.037,LNG_MIN=8.328,LNG_MAX=8.507;
const GRID_COLS=Math.ceil((LNG_MAX-LNG_MIN)/GRID_STEP);
const GRID_ROWS=Math.ceil((LAT_MAX-LAT_MIN)/GRID_STEP);
let distGrid=null;
let inBoundary=null;

function precomputeDistances(){
  distGrid=new Float32Array(GRID_ROWS*GRID_COLS);
  inBoundary=new Uint8Array(GRID_ROWS*GRID_COLS);
  for(let r=0;r<GRID_ROWS;r++){
    const lat=LAT_MAX-r*GRID_STEP;
    for(let c=0;c<GRID_COLS;c++){
      const lng=LNG_MIN+c*GRID_STEP;
      const idx=r*GRID_COLS+c;
      inBoundary[idx]=pip(lat,lng,URBAN_BOUNDARY)?1:0;
      if(!inBoundary[idx]){distGrid[idx]=0;continue;}
      let mn=Infinity;
      for(const t of TOWERS){
        const dl=(lat-t.lat)*D2M_LAT,dn=(lng-t.lng)*D2M_LNG;
        const d=Math.sqrt(dl*dl+dn*dn);if(d<mn)mn=d;
      }
      distGrid[idx]=mn;
    }
  }
}

// Build heatmap canvas for current radius
let gapCanvas=null;
function buildGapCanvas(){
  gapCanvas=document.createElement('canvas');
  gapCanvas.width=GRID_COLS;gapCanvas.height=GRID_ROWS;
  const gctx=gapCanvas.getContext('2d');
  const imgData=gctx.createImageData(GRID_COLS,GRID_ROWS);
  const rad=analysisRadius;
  const fadeRange=rad*0.3;
  const maxAlpha=rad<=300?110:rad<=500?90:70;

  for(let i=0;i<GRID_ROWS*GRID_COLS;i++){
    const px=i*4;
    if(!inBoundary[i]){imgData.data[px+3]=0;continue;}
    const d=distGrid[i];
    if(d>rad){
      const beyond=d-rad;
      const intensity=Math.min(beyond/fadeRange,1);
      imgData.data[px]=192;
      imgData.data[px+1]=50;
      imgData.data[px+2]=40;
      imgData.data[px+3]=Math.round(intensity*maxAlpha);
    } else {
      imgData.data[px+3]=0;
    }
  }
  gctx.putImageData(imgData,0,0);
}

function calcCoverage(){
  let covered=0,total=0;
  for(let i=0;i<GRID_ROWS*GRID_COLS;i++){
    if(!inBoundary[i])continue;
    total++;
    if(distGrid[i]<=analysisRadius)covered++;
  }
  const pct=total>0?covered/total*100:0;
  document.getElementById('coveredPct').textContent=Math.round(pct)+'%';
  document.getElementById('gapPct').textContent=Math.round(100-pct)+'%';
  document.getElementById('radiusLabel').textContent=analysisRadius>=1000?(analysisRadius/1000)+'km':analysisRadius+'m';
}

// === DRAWING ===
function drawGap(){
  if(!layers.gap||!gapCanvas)return;
  const tl=geo(LAT_MAX,LNG_MIN),br=geo(LAT_MIN,LNG_MAX);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(gapCanvas,tl.x,tl.y,br.x-tl.x,br.y-tl.y);
}

function drawBoundary(){
  ctx.beginPath();
  const f=geo(URBAN_BOUNDARY[0].lat,URBAN_BOUNDARY[0].lng);
  ctx.moveTo(f.x,f.y);
  for(let i=1;i<URBAN_BOUNDARY.length;i++){const p=geo(URBAN_BOUNDARY[i].lat,URBAN_BOUNDARY[i].lng);ctx.lineTo(p.x,p.y);}
  ctx.closePath();
  ctx.strokeStyle='rgba(100,90,80,0.3)';ctx.lineWidth=2;
  ctx.setLineDash([8,5]);ctx.stroke();ctx.setLineDash([]);
}

function drawRings(){
  const fillAlpha=analysisRadius<=300?0.14:analysisRadius<=500?0.08:0.05;
  const strokeAlpha=analysisRadius<=300?0.6:analysisRadius<=500?0.45:0.35;
  const strokeWidth=analysisRadius<=300?2:analysisRadius<=500?1.8:1.5;

  for(const t of TOWERS){
    const p=geo(t.lat,t.lng);
    const r=m2px(analysisRadius);
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);
    ctx.fillStyle=`rgba(26,138,101,${fillAlpha})`;ctx.fill();
    ctx.strokeStyle=`rgba(26,138,101,${strokeAlpha})`;
    ctx.lineWidth=strokeWidth;ctx.stroke();
  }
}

function drawTowerMarkers(){
  for(const t of TOWERS){
    const p=geo(t.lat,t.lng);
    ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);
    ctx.fillStyle='rgba(212,133,30,0.18)';ctx.fill();
    ctx.strokeStyle='#d97706';ctx.lineWidth=2;ctx.stroke();
    ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);
    ctx.fillStyle='#d97706';ctx.fill();
    if(layers.labels){
      ctx.font='700 11px "DM Sans"';ctx.textAlign='left';
      ctx.strokeStyle='rgba(255,255,255,0.9)';ctx.lineWidth=3.5;
      ctx.strokeText(t.name,p.x+13,p.y+4);
      ctx.fillStyle='#92400e';ctx.fillText(t.name,p.x+13,p.y+4);
    }
  }
}

function drawHotspots(){
  if(!layers.hotspots)return;
  const trendColors={
    increasing:{fill:'rgba(185,28,28,0.2)',stroke:'#b91c1c',dot:'#b91c1c',label:'#991b1b'},
    declining:{fill:'rgba(5,150,105,0.2)',stroke:'#059669',dot:'#059669',label:'#065f46'},
    stable:{fill:'rgba(120,113,108,0.2)',stroke:'#78716c',dot:'#78716c',label:'#57534e'},
  };
  for(const h of HOTSPOTS){
    const p=geo(h.lat,h.lng);
    const c=trendColors[h.trend]||trendColors.stable;
    ctx.beginPath();
    ctx.moveTo(p.x,p.y-10);ctx.lineTo(p.x-7,p.y+4);ctx.lineTo(p.x+7,p.y+4);ctx.closePath();
    ctx.fillStyle=c.fill;ctx.fill();
    ctx.strokeStyle=c.stroke;ctx.lineWidth=1.8;ctx.stroke();
    ctx.beginPath();ctx.arc(p.x,p.y-1,2.5,0,Math.PI*2);
    ctx.fillStyle=c.dot;ctx.fill();
    if(layers.labels){
      const arrow=h.trend==='increasing'?'\u2191 ':h.trend==='declining'?'\u2193 ':'';
      ctx.font='700 10px "DM Sans"';ctx.textAlign='left';
      ctx.strokeStyle='rgba(255,255,255,0.9)';ctx.lineWidth=3.5;
      ctx.strokeText(arrow+h.name,p.x+11,p.y+3);
      ctx.fillStyle=c.label;ctx.fillText(arrow+h.name,p.x+11,p.y+3);
    }
  }
  for(const h of DISCOVERED_HOTSPOTS){
    const p=geo(h.lat,h.lng);
    const s=6;
    ctx.beginPath();
    ctx.moveTo(p.x,p.y-s);ctx.lineTo(p.x+s,p.y);ctx.lineTo(p.x,p.y+s);ctx.lineTo(p.x-s,p.y);ctx.closePath();
    ctx.fillStyle='rgba(120,113,108,0.15)';ctx.fill();
    ctx.strokeStyle='#78716c';ctx.lineWidth=1.5;ctx.stroke();
    ctx.beginPath();ctx.arc(p.x,p.y,2,0,Math.PI*2);
    ctx.fillStyle='#78716c';ctx.fill();
    if(layers.labels){
      ctx.font='700 10px "DM Sans"';ctx.textAlign='left';
      ctx.strokeStyle='rgba(255,255,255,0.9)';ctx.lineWidth=3.5;
      ctx.strokeText(h.name,p.x+10,p.y+3);
      ctx.fillStyle='#57534e';ctx.fillText(h.name,p.x+10,p.y+3);
    }
  }
}

function drawScale(){
  const px=m2px(500);
  const x=W()-18-px,y=H()-22;
  ctx.strokeStyle='rgba(60,55,50,0.5)';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+px,y);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x,y-3);ctx.lineTo(x,y+3);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x+px,y-3);ctx.lineTo(x+px,y+3);ctx.stroke();
  ctx.font='500 9px "DM Sans"';ctx.fillStyle='rgba(60,55,50,0.6)';
  ctx.textAlign='center';ctx.fillText('500m',x+px/2,y-7);
}

// === USER LOCATION ===
let userLoc=null;
function drawUserLocation(){
  if(!userLoc)return;
  const p=geo(userLoc.lat,userLoc.lng);
  let minDist=Infinity;
  for(const t of TOWERS){
    const dl=(userLoc.lat-t.lat)*D2M_LAT,dn=(userLoc.lng-t.lng)*D2M_LNG;
    const d=Math.sqrt(dl*dl+dn*dn);if(d<minDist)minDist=d;
  }
  const covered=minDist<=analysisRadius;
  const color=covered?'#059669':'#b91c1c';
  ctx.beginPath();ctx.arc(p.x,p.y,14,0,Math.PI*2);
  ctx.fillStyle=color+'30';ctx.fill();
  ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);
  ctx.fillStyle=color;ctx.fill();
  ctx.strokeStyle='#fff';ctx.lineWidth=2.5;ctx.stroke();
  const distText=minDist>=1000?(minDist/1000).toFixed(1)+'km':Math.round(minDist)+'m';
  const banner=document.getElementById('locBanner');
  banner.style.display='block';
  banner.style.borderColor=color;
  banner.innerHTML=covered
    ?'<strong class="text-emerald-600">\u2713 Im Versorgungsbereich</strong><br>'+distText+' zum n\u00e4chsten Turm.'
    :'<strong class="text-red-700">\u2717 Keine Turmversorgung</strong><br>'+distText+' zum n\u00e4chsten Turm. Kein betreuter Schlag in Reichweite.';
}

// === RENDER ===
let rq=false;
function render(){
  if(rq)return;rq=true;
  requestAnimationFrame(()=>{
    rq=false;
    ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,W(),H());
    drawTiles();drawGap();drawBoundary();drawRings();drawHotspots();drawTowerMarkers();drawUserLocation();drawScale();
    ctx.restore();
  });
}

// === INTERACTION ===
let dragging=false,dsx=0,dsy=0,dspx=0,dspy=0;
let touches={},pinchDist0=null,pinchZoom0=null,pinchMid0=null,pinchPanX0=null,pinchPanY0=null;

canvas.addEventListener('touchstart',e=>{
  if(e.target!==canvas)return;
  e.preventDefault();
  for(const t of e.changedTouches)touches[t.identifier]={x:t.clientX,y:t.clientY};
  const ids=Object.keys(touches);
  if(ids.length===1){
    const t=touches[ids[0]];
    dragging=true;dsx=t.x;dsy=t.y;dspx=panX;dspy=panY;
  } else if(ids.length===2){
    const a=touches[ids[0]],b=touches[ids[1]];
    pinchDist0=Math.hypot(b.x-a.x,b.y-a.y);
    pinchZoom0=mapZoom;pinchPanX0=panX;pinchPanY0=panY;
    pinchMid0={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    dragging=false;
  }
},{passive:false});

canvas.addEventListener('touchmove',e=>{
  e.preventDefault();
  for(const t of e.changedTouches)if(touches[t.identifier])touches[t.identifier]={x:t.clientX,y:t.clientY};
  const ids=Object.keys(touches);
  if(ids.length===1){
    const t=touches[ids[0]];
    if(dragging){panX=dspx-(t.x-dsx);panY=dspy-(t.y-dsy);render();}
  } else if(ids.length===2&&pinchDist0){
    const a=touches[ids[0]],b=touches[ids[1]];
    const dist=Math.hypot(b.x-a.x,b.y-a.y);
    const scale=dist/pinchDist0;
    const nz=Math.max(10,Math.min(17,pinchZoom0+Math.log2(scale)));
    const rect=canvas.getBoundingClientRect();
    const mx=pinchMid0.x-rect.left,my=pinchMid0.y-rect.top;
    const ws1=256*Math.pow(2,pinchZoom0),ws2=256*Math.pow(2,nz);
    panX=(centerX*ws1+pinchPanX0+(mx-W()/2))*ws2/ws1-centerX*ws2-(mx-W()/2);
    panY=(centerY*ws1+pinchPanY0+(my-H()/2))*ws2/ws1-centerY*ws2-(my-H()/2);
    mapZoom=nz;render();
  }
},{passive:false});

canvas.addEventListener('touchend',e=>{
  for(const t of e.changedTouches)delete touches[t.identifier];
  pinchDist0=null;
},{passive:false});

canvas.addEventListener('pointerdown',e=>{
  if(e.pointerType==='touch')return;
  dragging=true;dsx=e.clientX;dsy=e.clientY;dspx=panX;dspy=panY;
  canvas.setPointerCapture(e.pointerId);e.preventDefault();
});
canvas.addEventListener('pointermove',e=>{
  if(e.pointerType==='touch'||!dragging)return;
  panX=dspx-(e.clientX-dsx);panY=dspy-(e.clientY-dsy);render();
});
canvas.addEventListener('pointerup',e=>{if(e.pointerType!=='touch'){dragging=false;canvas.releasePointerCapture(e.pointerId);}});

canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  const rect=canvas.getBoundingClientRect();
  const mx=e.clientX-rect.left,my=e.clientY-rect.top;
  const ws1=worldScale();
  const delta=e.deltaY>0?-0.3:0.3;
  const nz=Math.max(10,Math.min(17,mapZoom+delta));
  const ws2=256*Math.pow(2,nz),scale=ws2/ws1;
  panX=(centerX*ws1+panX+(mx-W()/2))*scale-centerX*ws2-(mx-W()/2);
  panY=(centerY*ws1+panY+(my-H()/2))*scale-centerY*ws2-(my-H()/2);
  mapZoom=nz;render();
},{passive:false});

function zoomBy(f){
  const ws1=worldScale(),wc={x:centerX*ws1+panX,y:centerY*ws1+panY};
  mapZoom=Math.max(10,Math.min(17,mapZoom+f));
  const ws2=worldScale();
  panX=wc.x/ws1*ws2-centerX*ws2;panY=wc.y/ws1*ws2-centerY*ws2;render();
}
document.getElementById('zoomIn').onclick=()=>zoomBy(0.5);
document.getElementById('zoomOut').onclick=()=>zoomBy(-0.5);
document.getElementById('resetView').onclick=()=>{mapZoom=14;panX=0;panY=0;render();};
document.getElementById('locateMe').onclick=()=>{
  const banner=document.getElementById('locBanner');
  if(!navigator.geolocation){
    banner.style.display='block';
    banner.innerHTML='Geolocation wird von diesem Browser nicht unterst\u00fctzt.';
    return;
  }
  banner.style.display='block';
  banner.innerHTML='Standort wird ermittelt\u2026';
  navigator.geolocation.getCurrentPosition(pos=>{
    userLoc={lat:pos.coords.latitude,lng:pos.coords.longitude};
    const ws=worldScale();
    panX=lng2x(userLoc.lng)*ws-centerX*ws;
    panY=lat2y(userLoc.lat)*ws-centerY*ws;
    mapZoom=15;render();
  },err=>{
    banner.style.display='block';
    const msgs={1:'Standortzugriff verweigert. Bitte in den Einstellungen erlauben.',2:'Standort nicht verf\u00fcgbar.',3:'Zeit\u00fcberschreitung.'};
    banner.innerHTML=msgs[err.code]||'Fehler '+err.code+': '+err.message;
  },{enableHighAccuracy:true,timeout:10000});
};

['togGap','togLabels','togHotspots'].forEach(id=>{
  const k={togGap:'gap',togLabels:'labels',togHotspots:'hotspots'}[id];
  document.getElementById(id).onchange=e=>{layers[k]=e.target.checked;render();};
});

document.querySelectorAll('.radius-btn').forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll('.radius-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    analysisRadius=parseInt(b.dataset.r);
    buildGapCanvas();
    calcCoverage();
    render();
  };
});

// Init
window.addEventListener('resize',()=>{dpr=window.devicePixelRatio||1;resize();render();});
resize();
precomputeDistances();
buildGapCanvas();
calcCoverage();
render();
