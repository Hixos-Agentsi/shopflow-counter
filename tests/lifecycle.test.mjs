import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {CrossingTracker, computeLineCoordinate} from '../js/tracker.js';

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const flush = () => new Promise(resolve=>setImmediate(resolve));
function harness() {
  const ids=[...readFileSync(new URL('../index.html', import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)].map(x=>x[1]);
  const nodes=Object.fromEntries(ids.map(id=>[id, {
    value:'', textContent:'', innerHTML:'', hidden:false, disabled:false, style:{},
    options:[{},{}], addEventListener(){}, append(option){this.options.push(option)},
    classList:{toggle(){}}, readyState:4, videoWidth:640, videoHeight:480,
    async play(){}, getContext(){return new Proxy({}, {get:(o,k)=>k==='measureText'?()=>({width:50}):()=>{}})}
  }]));
  nodes.cameraSelect.options=[{value:''}];
  const acquired=deferred(), detection=deferred();
  let stopped=0;
  const track={stop(){stopped++},addEventListener(){}};
  const stream={getTracks:()=>[track], getVideoTracks:()=>[track]};
  const storage=new Map(), timers=new Map(); let nextTimer=0;
  const document={hidden:false,querySelector:s=>nodes[s.slice(1)],createElement:()=>({}), addEventListener(){}};
  const ctx=vm.createContext({
    document, console:{error(){}}, performance, Date, Math, Blob, URL,
    CrossingTracker,computeLineCoordinate,
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    navigator:{mediaDevices:{getUserMedia:()=>acquired.promise,enumerateDevices:async()=>[]}},
    window:{tf:{ready:async()=>{}},cocoSsd:{load:async()=>({detect:()=>detection.promise})},addEventListener(){}},
    setTimeout:(fn)=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),setInterval(){}
  });
  vm.runInContext(source,ctx);
  return {run:s=>vm.runInContext(s,ctx), nodes, acquired,detection,stream,storage,timers,stopped:()=>stopped};
}
// Stop while permission is pending: release the late stream; never restart automatically.
{
  const h=harness(), start=h.run('startCounting()');
  h.run('stopCounting()'); h.acquired.resolve(h.stream); await start;
  assert.equal(h.stopped(),1); assert.equal(h.run('running'),false);
  assert.equal(h.nodes.cameraVideo.srcObject,null);
}
// Stop during inference: discard result and don't schedule a new loop.
{
  const h=harness(), start=h.run('startCounting()');
  h.acquired.resolve(h.stream); await start;
  assert.equal(h.run('running'),true);
  assert.equal(h.nodes.cameraStage.style.aspectRatio,'640 / 480');
  const inference=h.run('detectFrame(generation)');
  h.run('stopCounting()');
  h.detection.resolve([{class:'person',score:0.9,bbox:[40,40,100,200]}]);
  await inference;
  assert.equal(h.nodes.detectedCount.textContent,'0');
  assert.equal(h.timers.size,0);
  assert.equal(h.stopped(),1);
}
// Permission refusal leaves a usable restart button and explicit feedback.
{
  const h=harness(), start=h.run('startCounting()');
  h.acquired.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}));
  await start;
  assert.equal(h.nodes.startButton.disabled,false);
  assert.match(h.nodes.errorMessage.textContent,/refusé/);
}
// Simulated detections pass through the real mapping, tracker and stats persistence.
{
  const h=harness();
  h.run('elements.canvas.width=640; elements.canvas.height=480; settings.mirror=false; settings.orientation="vertical"; settings.linePosition=50');
  h.run('processCrossings([{x:200,y:100,width:100,height:200}]); processCrossings([{x:280,y:100,width:100,height:200}])');
  assert.equal(h.nodes.entriesCount.textContent,'0','centre crossing alone is not a passage');
  h.run('processCrossings([{x:334,y:100,width:100,height:200}])');
  assert.equal(h.nodes.entriesCount.textContent,'1');
  assert.equal(h.nodes.occupancyCount.textContent,'1');
  const event=JSON.parse(h.storage.get('shopflow-counter-events-v1'))[0];
  assert.equal(event.type,'entry');
  assert.equal(event.source,'camera');
  assert.equal('trackId' in event,false);
}
console.log('Camera lifecycle and counter integration (simulated): OK');

// Display mirror and detection use the same whole rectangle coordinates.
{
  const h=harness();
  h.run('elements.canvas.width=640; elements.canvas.height=480; settings.mirror=true; settings.orientation="vertical"; settings.linePosition=50');
  h.run('processCrossings([mapPredictionForDisplay({bbox:[340,100,100,200],score:0.9})]); processCrossings([mapPredictionForDisplay({bbox:[260,100,100,200],score:0.9})])');
  assert.equal(h.nodes.entriesCount.textContent,'0');
  h.run('processCrossings([mapPredictionForDisplay({bbox:[206,100,100,200],score:0.9})])');
  assert.equal(h.nodes.entriesCount.textContent,'1');
}
console.log('Whole-rectangle integration and mirrored display: OK');
