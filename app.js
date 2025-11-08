/* app.js - vanilla JS mobile-first prototype
   Core concepts:
   - grid 10x10
   - shapes pool (3 shapes)
   - drag & drop and tap-to-place
   - rotate on second tap (when selected)
   - clear full rows/cols + scoring
   - localStorage save/load and undo (single-step)
*/

const GRID_SIZE = 10;
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const shapesWrap = document.getElementById('shapes');
const toast = document.getElementById('toast');

let boardPx = 360; // base px for canvas drawing; canvas element has width/height attributes for pixel rendering
canvas.width = boardPx; canvas.height = boardPx;

const state = {
  grid: createGrid(GRID_SIZE),
  score: 0,
  shapes: [],
  selectedShape: null,
  history: []
};

function createGrid(n){
  const g = Array.from({length:n}, ()=>Array.from({length:n}, ()=>0));
  return g;
}

/* Shapes defined as array of [ [x,y] ... ] with origin at 0,0.
   We'll provide simple tetromino-like plus 1x1 and 2x2 etc.
*/
const SHAPE_LIBRARY = [
  {id:'single', cells:[[0,0]], color:'#6cf270'},
  {id:'line3', cells:[[0,0],[1,0],[2,0]], color:'#4fb7ff'},
  {id:'square2', cells:[[0,0],[1,0],[0,1],[1,1]], color:'#ffd166'},
  {id:'L3', cells:[[0,0],[0,1],[1,0]], color:'#ff7b7b'},
  {id:'T3', cells:[[0,0],[1,0],[2,0],[1,1]], color:'#d79bff'}
];

function cloneGrid(g){ return g.map(r=>r.slice()); }
function randShapes(n=3){
  const out=[];
  for(let i=0;i<n;i++){
    const s = SHAPE_LIBRARY[Math.floor(Math.random()*SHAPE_LIBRARY.length)];
    out.push({id:s.id,cells: s.cells.map(c=>c.slice()), color:s.color});
  }
  return out;
}

// utils rotate shape 90deg clockwise (about origin)
function rotateCells(cells){
  return cells.map(([x,y])=>[y, -x]).map(([x,y])=>{
    // normalize to min(0)
    return [x, y];
  });
}
function normalize(cells){
  const minX = Math.min(...cells.map(c=>c[0]));
  const minY = Math.min(...cells.map(c=>c[1]));
  return cells.map(([x,y])=>[x-minX,y-minY]);
}

// draw helpers
function draw(){
  const size = canvas.width;
  const cell = Math.floor(size / GRID_SIZE);
  ctx.clearRect(0,0,size,size);

  // background cells
  for(let r=0;r<GRID_SIZE;r++){
    for(let c=0;c<GRID_SIZE;c++){
      ctx.fillStyle = '#08101a';
      ctx.fillRect(c*cell, r*cell, cell-1, cell-1);
      if(state.grid[r][c]){
        ctx.fillStyle = state.grid[r][c];
        ctx.fillRect(c*cell+4, r*cell+4, cell-8, cell-8);
      }
    }
  }
  // if dragging selectedShape show ghost on pointer if valid
  if(state.selectedShape && state.selectedShape.preview){
    const {x,y, color, valid} = state.selectedShape.preview;
    ctx.globalAlpha = 0.85;
    for(const [cx,cy] of state.selectedShape.cells){
      const gx = x+cx, gy = y+cy;
      if(gx>=0 && gx<GRID_SIZE && gy>=0 && gy<GRID_SIZE){
        ctx.fillStyle = valid ? color : 'rgba(255,80,80,0.6)';
        ctx.fillRect(gx*cell+4, gy*cell+4, cell-8, cell-8);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// check placement validity at boardXY
function canPlace(cells, boardX, boardY, grid){
  for(const [cx,cy] of cells){
    const x = boardX + cx, y = boardY + cy;
    if(x<0 || y<0 || x>=GRID_SIZE || y>=GRID_SIZE) return false;
    if(grid[y][x]) return false;
  }
  return true;
}

// place shape: mutate grid, return placed cells coords
function placeShape(cells, boardX, boardY, color){
  const placed = [];
  for(const [cx,cy] of cells){
    const x = boardX + cx, y = boardY + cy;
    state.grid[y][x] = color;
    placed.push([x,y]);
  }
  return placed;
}

// check full rows/cols and clear them, return cleared count
function clearFull(){
  const fullRows = [];
  const fullCols = [];
  for(let r=0;r<GRID_SIZE;r++){
    if(state.grid[r].every(v=>v)) fullRows.push(r);
  }
  for(let c=0;c<GRID_SIZE;c++){
    let all=true;
    for(let r=0;r<GRID_SIZE;r++) if(!state.grid[r][c]) { all=false; break; }
    if(all) fullCols.push(c);
  }
  // clear
  for(const r of fullRows) for(let c=0;c<GRID_SIZE;c++) state.grid[r][c]=0;
  for(const c of fullCols) for(let r=0;r<GRID_SIZE;r++) state.grid[r][c]=0;
  return {rows: fullRows.length, cols: fullCols.length};
}

// scoring: base = placed cells count, bonus per cleared line
function scoreForPlace(count, cleared){
  const base = count * 10;
  const bonus = (cleared.rows + cleared.cols) * 100;
  return base + bonus;
}

/* UI: shapes rendering area as small canvas elements with drag support */
function renderShapes(){
  shapesWrap.innerHTML = '';
  state.shapes.forEach((s, idx)=>{
    const el = document.createElement('div');
    el.className = 'shape';
    el.draggable = false;
    el.dataset.index = idx;
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    el.appendChild(cv);
    shapesWrap.appendChild(el);

    // draw shape preview
    const cctx = cv.getContext('2d');
    cctx.clearRect(0,0,64,64);
    const cell = 12;
    const offsetX = 6, offsetY = 6;
    const norm = normalize(s.cells);
    cctx.fillStyle = s.color;
    norm.forEach(([x,y])=>{
      cctx.fillRect(offsetX + x*cell, offsetY + y*cell, cell-2, cell-2);
    });

    // event handlers: touch/mouse
    let pointerId = null;
    let startPointer = null;
    const onStart = (ev) => {
      ev.preventDefault();
      pointerId = ev.pointerId || (ev.changedTouches ? ev.changedTouches[0].identifier : 'mouse');
      startPointer = getPointerPos(ev);
      // mark selected
      state.selectedShape = {
        shapeIndex: idx,
        cells: s.cells.map(c=>c.slice()),
        color: s.color,
        offsetStart: startPointer
      };
      showToast('Geser ke papan untuk menempatkan, tap lagi untuk rotasi.');
    };
    const onMove = (ev) => {
      if(!state.selectedShape) return;
      const p = getPointerPos(ev);
      const boardPos = screenToBoard(p.x, p.y);
      const bx = boardPos.x, by = boardPos.y;
      const valid = canPlace(state.selectedShape.cells, bx, by, state.grid);
      state.selectedShape.preview = {x: bx, y: by, color: state.selectedShape.color, valid};
      draw();
    };
    const onEnd = (ev) => {
      if(!state.selectedShape) return;
      const p = getPointerPos(ev);
      const boardPos = screenToBoard(p.x, p.y);
      const bx = boardPos.x, by = boardPos.y;
      if(canPlace(state.selectedShape.cells, bx, by, state.grid)){
        // push history
        state.history.push({
          grid: cloneGrid(state.grid),
          score: state.score,
          shapes: JSON.parse(JSON.stringify(state.shapes))
        });
        const placed = placeShape(state.selectedShape.cells, bx, by, state.selectedShape.color);
        // remove shape from pool
        state.shapes.splice(state.selectedShape.shapeIndex,1);
        // refill if empty
        if(state.shapes.length===0) state.shapes = randShapes(3);
        const cleared = clearFull();
        const pts = scoreForPlace(placed.length, cleared);
        state.score += pts;
        scoreEl.textContent = 'Score: ' + state.score;
        renderShapes();
        draw();
        showToast(`Placed ${placed.length} blocks. +${pts} pts`);
        saveLocalState(); // auto save progress
      } else {
        // if ended on shape area (tap), treat as rotate
        const withinShapeCard = ev.target.closest && ev.target.closest('.shape');
        if(withinShapeCard){
          // rotate selected shape inplace (toggle rotate)
          const idx0 = state.selectedShape.shapeIndex;
          const rotated = state.shapes[idx0].cells.map(c=>[c[1], -c[0]]);
          state.shapes[idx0].cells = normalize(rotated);
          renderShapes();
        } else {
          showToast('Tidak bisa ditempatkan di lokasi itu.');
        }
      }
      state.selectedShape = null;
      draw();
    };

    // pointer events (use pointer where supported)
    el.addEventListener('pointerdown', onStart);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    // fallback touch
    el.addEventListener('touchstart', onStart);
    window.addEventListener('touchmove', onMove, {passive:false});
    window.addEventListener('touchend', onEnd);
    // click/tap to rotate: single tap toggles selection then second tap rotates
    el.addEventListener('click', (e)=>{
      e.preventDefault();
      // choose shape for tap-place mode
      state.selectedShape = {
        shapeIndex: idx,
        cells: state.shapes[idx].cells.map(c=>c.slice()),
        color: state.shapes[idx].color,
        tapMode: true,
        taps: (state.selectedShape && state.selectedShape.shapeIndex===idx && state.selectedShape.taps+1) || 1
      };
      // second click rotates
      if(state.selectedShape.taps >= 2){
        const rCells = rotateCells(state.selectedShape.cells);
        state.shapes[idx].cells = normalize(rCells);
        state.selectedShape = null;
        renderShapes();
        showToast('Rotated');
      } else {
        showToast('Tap grid untuk menempatkan; tap shape lagi to rotate');
      }
    });
  });
}

// convert screen pointer to board cell coords
function getPointerPos(ev){
  if(ev.touches && ev.touches[0]) ev = ev.touches[0];
  return {x: ev.clientX, y: ev.clientY};
}
function screenToBoard(px, py){
  const rect = canvas.getBoundingClientRect();
  const cx = px - rect.left;
  const cy = py - rect.top;
  const cell = canvas.width / GRID_SIZE;
  const bx = Math.floor(cx / cell);
  const by = Math.floor(cy / cell);
  return {x: bx, y: by};
}

// show toast
let toastTimer = 0;
function showToast(txt, tm=1300){
  toast.textContent = txt;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ toast.textContent=''; }, tm);
}

// save/load local
function saveLocalState(){
  const payload = {
    grid: state.grid,
    score: state.score,
    shapes: state.shapes
  };
  localStorage.setItem('bp_state', JSON.stringify(payload));
  localStorage.setItem('bp_score', String(state.score));
}
function loadLocalState(){
  const raw = localStorage.getItem('bp_state');
  if(!raw) return false;
  try{
    const p = JSON.parse(raw);
    state.grid = p.grid;
    state.score = p.score || 0;
    state.shapes = p.shapes || randShapes(3);
    scoreEl.textContent = 'Score: ' + state.score;
    renderShapes();
    draw();
    showToast('Dimuat dari lokal');
    return true;
  }catch(e){ return false; }
}

function undo(){
  const h = state.history.pop();
  if(!h){ showToast('Tidak ada undo'); return; }
  state.grid = h.grid;
  state.score = h.score;
  state.shapes = h.shapes;
  scoreEl.textContent = 'Score: ' + state.score;
  renderShapes();
  draw();
  showToast('Undo');
  saveLocalState();
}

// UI buttons
document.getElementById('btn-reset').addEventListener('click', ()=>{
  if(!confirm('Reset permainan?')) return;
  state.grid = createGrid(GRID_SIZE);
  state.score = 0;
  state.shapes = randShapes(3);
  state.history = [];
  scoreEl.textContent = 'Score: 0';
  renderShapes(); draw(); saveLocalState();
});
document.getElementById('save').addEventListener('click', ()=>{ saveLocalState(); showToast('Tersimpan'); });
document.getElementById('load').addEventListener('click', ()=>{ loadLocalState(); });
document.getElementById('undo').addEventListener('click', ()=>{ undo(); });

// initial
state.shapes = randShapes(3);
renderShapes();
draw();

// redraw on resize for crispness (scale canvas size with devicePixelRatio)
function fitCanvas(){
  const dpr = window.devicePixelRatio || 1;
  const styleW = canvas.getBoundingClientRect().width;
  const size = Math.floor(styleW * dpr);
  canvas.width = size;
  canvas.height = size;
  draw();
}
window.addEventListener('resize', ()=>{ fitCanvas(); });
fitCanvas();
