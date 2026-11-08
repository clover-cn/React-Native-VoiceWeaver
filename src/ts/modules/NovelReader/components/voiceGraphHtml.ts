/** 本地离线画布；只经桥传递标识、布局和分配草稿，不接触文件和密钥。 */
export const VOICE_GRAPH_HTML = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<style>
:root{--ink:#292b31;--muted:#77756e;--paper:#f5f3ed;--line:#d9d6cc;--accent:#ad611c;--teal:#38877c}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;display:flex;flex-direction:column;height:calc(var(--vh,1vh)*100)}
[hidden]{display:none!important}#rubber{pointer-events:none}
header,.tools,#hint,footer{flex-shrink:0}
button,input,select{font:inherit}button{background:#fffdf8;border:1px solid var(--line);border-radius:9px;padding:9px 12px;color:var(--ink);cursor:pointer}button:disabled{opacity:.4;cursor:default}
button.primary,.selected{background:var(--ink);color:white}button:focus-visible,input:focus-visible{outline:2px solid var(--teal)}
header{padding:15px 16px 10px;border-bottom:1px solid var(--line);background:#fbfaf6}h1{font-size:22px;letter-spacing:-.8px;margin:2px 0 8px}
.eyebrow{font-size:10px;letter-spacing:2px;color:var(--accent)}.row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
#summary{font-size:12px;color:var(--muted);margin:8px 0}.tools{padding:10px 12px;border-bottom:1px solid var(--line);display:flex;gap:7px;flex-wrap:wrap;align-items:center}
input[type=search]{min-width:100px;flex:1;width:130px;padding:10px;border:1px solid var(--line);background:#fffdf8;border-radius:9px}
.hint{font-size:11px;color:var(--muted)}#hint{padding:7px 12px;background:#ece9df;min-height:30px}#view{position:relative;flex:1;min-height:0}
#graph{width:100%;height:100%;touch-action:none;background-image:radial-gradient(#d4d0c4 .7px,transparent .7px);background-size:20px 20px}
.wire{fill:none;stroke:#a7b9b2;stroke-width:2.2}.wire.emotion{stroke:#a9a0c2;stroke-dasharray:7 5}.wire.pending{stroke:#c78d35;stroke-dasharray:5 6}.wire.failed,.wire.missing{stroke:#be6660}
.wire.active{stroke:#247a6c;stroke-width:4}.wire.generating{stroke:#458bd1;stroke-width:3;animation:pulse 1.2s infinite}
.wire.draft{stroke:#b3671f;stroke-width:3}.edge-hit{fill:none;stroke:transparent;stroke-width:20;cursor:pointer}
.node rect{fill:#fffdf8;stroke:#d4d0c5;stroke-width:1.4;filter:drop-shadow(0 3px 5px #302e2610)}.node.audio rect{fill:#eaf1ed;stroke:#a8c6b7}.node.focus rect{stroke:var(--accent);stroke-width:3}
.node text{pointer-events:none;fill:#333;font-size:13px}.node .sub{font-size:10px;fill:#777}.port{fill:var(--teal);stroke:#fff;stroke-width:2;cursor:crosshair}
.label{font-size:10px;fill:#6b706d;paint-order:stroke;stroke:var(--paper);stroke-width:5px;stroke-linejoin:round;pointer-events:none}
.flow{fill:#428d7e;pointer-events:none}body.still .flow{display:none}body.still .generating{animation:none}
@keyframes pulse{50%{stroke-opacity:.3}}
footer{padding:8px 12px;border-top:1px solid var(--line);background:#fbfaf6;display:flex;gap:8px;align-items:center;flex-wrap:wrap}footer .hint{flex:1}
.panel{position:absolute;right:10px;top:10px;width:min(340px,calc(100% - 20px));max-height:calc(100% - 20px);overflow:auto;padding:16px;background:#fffdf9;border:1px solid var(--line);box-shadow:0 12px 40px #302c2428;border-radius:14px;z-index:5}
.panel h2{font-size:18px;margin:0 0 12px}.panel h3{font-size:14px;margin:16px 0 8px}.list{display:flex;flex-direction:column;gap:7px}.list button{text-align:left}.close{float:right;padding:4px 8px}.pill{font-size:11px;border:1px solid var(--line);padding:3px 7px;border-radius:20px;color:var(--muted)}
.exception{font-size:12px;border-left:2px solid #c99551;padding:8px;margin:8px 0;background:#faf5eb}#dialog{position:fixed;inset:0;background:#25241f55;z-index:10;display:flex;align-items:center;justify-content:center;padding:20px}#dialog[hidden],.panel[hidden]{display:none}
.dialog-box{background:#fffdf8;border-radius:18px;padding:20px;max-width:390px;width:100%;box-shadow:0 20px 80px #0003}.dialog-box h2{font-size:19px;margin-top:0}
select{display:block;width:100%;padding:11px;border:1px solid var(--line);border-radius:8px;margin:14px 0;background:white}
#toast{position:fixed;bottom:78px;left:16px;right:16px;background:#292b31;color:#fff;padding:13px;border-radius:10px;z-index:20;font-size:12px;display:none}
@media(min-width:700px){header{padding-left:24px}h1{font-size:26px}}
@media(prefers-reduced-motion:reduce){.flow{display:none}.wire.generating{animation:none}}
</style></head><body>
<header><span class="eyebrow">VOICE CASTING · 本书分配</span><h1>音色分配图</h1><div id="summary">正在读取本机分配…</div><div class="row"><span class="pill">录音 → 角色</span><span class="hint">仅统计已解析章节，未解析章节不在图中</span></div></header>
<div class="tools"><input id="search" type="search" placeholder="搜索角色或录音" aria-label="搜索角色或录音"><button id="scope">整本已解析</button><button id="edit">进入编辑</button><button id="library">音频库</button><button id="locate">当前角色</button><button id="fit">适应画布</button><button id="motion">动效：开</button><button id="reload">刷新</button></div>
<div id="hint">拖动节点整理布局 · 双指缩放 · 点击角色查看情绪和片段特例</div>
<div id="view"><svg id="graph" role="group" aria-label="参考音频与小说角色关系图"><g id="world"><g id="edges"></g><g id="nodes"></g><path id="rubber" class="wire draft" hidden></path></g></svg>
<aside id="details" class="panel" hidden></aside><aside id="drawer" class="panel" hidden></aside></div>
<footer><button id="undo" disabled>撤销</button><button id="redo" disabled>重做</button><button id="save" class="primary" disabled>保存分配</button><button id="regen">重新生成</button><span id="draftStatus" class="hint">无未保存修改</span></footer>
<div id="dialog" hidden><div class="dialog-box" id="dialogBox"></div></div><div id="toast" role="status"></div>
<script>
(function(){
'use strict';
var NS='http://www.w3.org/2000/svg', snap=null, runtime={}, edits=[], undo=[], redo=[], editing=false, currentOnly=false, selectedAudio=null, draftRevision=null, bridgeAcknowledged=false, handshakeTimer=null, handshakeAttempts=0;
var positions={}, initialized=false, graphEdges=[], visibleRoles=[], scale=1, tx=0, ty=0, gesture=null, pointers=new Map(), dragging=false, active=true, motion=true, cover=false;
var graph=document.getElementById('graph'), world=document.getElementById('world'), rubber=document.getElementById('rubber'), toastTimer;
var labels={neutral:'普通',happy:'开心',angry:'愤怒',sad:'悲伤',fearful:'害怕',disgusted:'厌恶',melancholy:'忧郁',surprised:'惊讶'};
function el(id){return document.getElementById(id)}
function send(type,payload){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:type,payload:payload}));}
function toast(message){el('toast').textContent=message;el('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(function(){el('toast').style.display='none'},3500)}
function elem(tag,attrs,text){var node=document.createElementNS(NS,tag);Object.keys(attrs||{}).forEach(function(k){node.setAttribute(k,String(attrs[k]))});if(text!==undefined)node.textContent=text;return node}
function text(parent,tag,value,cls){var n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;parent.appendChild(n);return n}
function button(parent,title,action){var b=text(parent,'button',title);b.onclick=action;return b}
function changeSize(){document.documentElement.style.setProperty('--vh',(window.innerHeight*.01)+'px')}
function transform(){world.setAttribute('transform','translate('+tx+','+ty+') scale('+scale+')')}
function point(event){var r=graph.getBoundingClientRect();return{x:(event.clientX-r.left-tx)/scale,y:(event.clientY-r.top-ty)/scale}}
function key(type,id){return type+':'+id}
function audioName(id){var a=snap.audios.find(function(v){return v.id===id});return a?a.name:'缺失录音 · '+id.slice(0,16)}
function audioAvailable(id){return snap.audios.some(function(a){return a.id===id&&!a.missing})}
function remember(){if(!edits.length)draftRevision=snap.revision;undo.push(JSON.stringify(edits));if(undo.length>100)undo.shift();redo=[]}
function draft(role,emotion,audioId){remember();var previous=edits.findIndex(function(e){return e.role===role&&e.emotion===emotion});if(previous>=0)edits.splice(previous,1);edits.push({role:role,emotion:emotion,audioId:audioId});render()}
function dialog(title){var box=el('dialogBox');box.replaceChildren();text(box,'h2',title);el('dialog').hidden=false;return box}
function closeDialog(){el('dialog').hidden=true}
function choose(role,audioId,emotion,removeEmotions){
  if(!editing)return;var box=dialog(audioId===null?'解除对应绑定':'分配给 '+role);
  text(box,'p',audioId===null?'解除后恢复角色的自动分配规则；片段特例默认保留。':audioName(audioId),'hint');
  if(snap.provider==='indextts2'&&audioId!==null)text(box,'p','已有情绪绑定保留其参考模式；向量情绪的说话人音色通过“普通”情绪修改。','hint');
  var select=document.createElement('select');select.setAttribute('aria-label','选择情绪');
  var info=snap.roles.find(function(r){return r.name===role});
  var emotions=Array.from(new Set(['neutral'].concat(info?info.emotions:[],Object.keys(labels),removeEmotions||[])));
  emotions.forEach(function(e){var option=document.createElement('option');option.value=e;option.textContent=labels[e]||e;select.appendChild(option)});
  var all=document.createElement('option');all.value='*';all.textContent='全部情绪';select.appendChild(all);select.value=emotion||'neutral';box.appendChild(select);
  button(box,'取消',closeDialog);button(box,'加入修改草稿',function(){
    if(select.value==='*'){remember();emotions.forEach(function(e){edits=edits.filter(function(v){return v.role!==role||v.emotion!==e});edits.push({role:role,emotion:e,audioId:audioId})});render()}
    else draft(role,select.value,audioId);selectedAudio=null;closeDialog();
  });
}
function buildEdges(){
  var list=snap.edges.map(function(e){return Object.assign({},e,{emotions:e.emotions.slice(),usages:e.usages.slice()})});
  edits.forEach(function(edit){
    // 草稿叠加展示，实际连线保留，避免把片段特例和情绪回退误画成已被替换。
    var targets=edit.audioId?[edit.audioId]:snap.edges.filter(function(e){return e.role===edit.role&&e.emotions.includes(edit.emotion)}).map(function(e){return e.audioId});
    Array.from(new Set(targets)).forEach(function(id){list.push({id:JSON.stringify(['draft',id,edit.role,edit.emotion]),audioId:id,role:edit.role,kind:'voice',emotions:[edit.emotion],usages:[],draft:true,removing:edit.audioId===null})});
  });
  if(currentOnly)list=list.filter(function(e){return snap.usages.some(function(u){return u.chapter===runtime.chapter&&u.role===e.role})&&(e.draft||e.usages.some(function(u){return u.chapter===runtime.chapter}))});
  var q=el('search').value.trim().toLowerCase();
  if(q)list=list.filter(function(e){return (e.role+' '+audioName(e.audioId)).toLowerCase().includes(q)});
  return list;
}
function filteredUsages(){return snap.usages.filter(function(u){return !currentOnly||u.chapter===runtime.chapter})}
function edgeState(e){
  var usages=e.usages.filter(function(u){return !currentOnly||u.chapter===runtime.chapter});
  if(e.draft)return 'draft';
  if(!audioAvailable(e.audioId))return 'missing';
  if(runtime.playing&&usages.some(function(u){return u.chapter===runtime.chapter&&u.index===runtime.index}))return 'active';
  if((snap.tasks||[]).some(function(t){return t.phase==='generating'&&usages.some(function(u){return u.chapter===t.chapter&&u.index===t.index})}))return 'generating';
  if(usages.some(function(u){return u.failed}))return 'failed';
  if(usages.some(function(u){return u.pending}))return 'pending';
  return '';
}
function curves(){
  el('edges').replaceChildren();
  graphEdges.forEach(function(e,i){
    var a=positions[key('a',e.audioId)],r=positions[key('r',e.role)];if(!a||!r)return;
    var x=a.x+186,y=a.y+30,x2=r.x,y2=r.y+30,bend=Math.max(70,Math.abs(x2-x)*.5);
    var d='M '+x+' '+y+' C '+(x+bend)+' '+y+', '+(x2-bend)+' '+y2+', '+x2+' '+y2;
    var state=edgeState(e),p=elem('path',{d:d,class:'wire '+e.kind+' '+state,id:'path'+i});
    el('edges').appendChild(p);
    var hit=elem('path',{d:d,class:'edge-hit','data-edge':e.id});el('edges').appendChild(hit);
    var label=e.emotions.slice(0,2).map(function(v){return labels[v]||v}).join('、')+(e.emotions.length>2?'等 '+e.emotions.length+' 种':'')+(e.kind==='emotion'?' · 情绪参考':'')+(e.draft?(e.removing?' · 拟解除':' · 拟绑定'):!e.usages.length?' · 后续默认':'');
    el('edges').appendChild(elem('text',{x:(x+x2)/2,y:(y+y2)/2+(e.draft?15:-8),class:'label','text-anchor':'middle'},label));
    if(motion&&active&&(i<24||state==='active'||state==='generating')){var dot=elem('circle',{r:state==='active'?4:2.5,class:'flow'});var anim=elem('animateMotion',{dur:(3+i%4)+'s',repeatCount:'indefinite',path:d});dot.appendChild(anim);el('edges').appendChild(dot)}
  });
}
function node(type,id,title,subtitle,position){
  var g=elem('g',{class:'node '+(type==='a'?'audio':'role')+(selectedAudio===id&&type==='a'?' focus':''),transform:'translate('+position.x+','+position.y+')','data-type':type,'data-id':id,tabindex:0,role:'button','aria-label':title});
  g.appendChild(elem('rect',{width:186,height:60,rx:11}));
  g.appendChild(elem('text',{x:14,y:25},title.length>16?title.slice(0,15)+'…':title));
  g.appendChild(elem('text',{x:14,y:44,class:'sub'},subtitle));
  if(editing)g.appendChild(elem('circle',{cx:type==='a'?186:0,cy:30,r:10,class:'port','data-port':type,role:'button','aria-label':(type==='a'?'拖出录音：':'连接角色：')+title}));
  g.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();clicked(type,id)}};
  el('nodes').appendChild(g);
}
function clicked(type,id){
  if(type==='a'){if(editing){selectedAudio=id;toast('已选择 '+audioName(id)+'，点击角色完成分配');render()}else audioDetails(id)}
  else if(editing&&selectedAudio)choose(id,selectedAudio);else roleDetails(id);
}
function render(){
  if(!snap)return;graphEdges=buildEdges();var q=el('search').value.trim().toLowerCase(),usages=filteredUsages();
  visibleRoles=snap.roles.filter(function(r){return (!currentOnly||usages.some(function(u){return u.role===r.name}))&&(!q||r.name.toLowerCase().includes(q)||graphEdges.some(function(e){return e.role===r.name}))});
  var ids=Array.from(new Set(graphEdges.map(function(e){return e.audioId})));
  ids.forEach(function(id,i){var k=key('a',id);if(!positions[k])positions[k]={x:35,y:45+i*92}});
  visibleRoles.forEach(function(r,i){var k=key('r',r.name);if(!positions[k])positions[k]={x:470,y:45+i*92}});
  el('nodes').replaceChildren();
  ids.forEach(function(id){var count=new Set(graphEdges.filter(function(e){return e.audioId===id}).map(function(e){return e.role})).size;node('a',id,audioName(id),count+' 个角色'+(!audioAvailable(id)?' · 文件缺失':''),positions[key('a',id)])});
  visibleRoles.forEach(function(r){var links=graphEdges.filter(function(e){return e.role===r.name});node('r',r.name,r.name,(links.length?links.length+' 条音色关系':'尚未分配')+(r.exceptions?' · '+r.exceptions+' 个特例':''),positions[key('r',r.name)])});
  curves();
  var assigned=new Set(graphEdges.filter(function(e){return audioAvailable(e.audioId)}).map(function(e){return e.role})).size;
  var missing=new Set(graphEdges.filter(function(e){return !audioAvailable(e.audioId)}).map(function(e){return e.audioId})).size;
  el('summary').textContent=visibleRoles.length+' 个角色 · '+assigned+' 已分配 · '+missing+' 缺失音频 · '+usages.filter(function(u){return u.pending}).length+' 待更新';
  el('undo').disabled=!undo.length;el('redo').disabled=!redo.length;el('save').disabled=!edits.length||runtime.busy;
  el('draftStatus').textContent=edits.length?edits.length+' 项草稿 · 尚未生效':'无未保存修改';
  el('scope').textContent=currentOnly?'仅当前章':'整本已解析';el('edit').textContent=editing?'退出编辑':'进入编辑';el('edit').className=editing?'primary':'';
  el('hint').textContent=editing?'拖线或依次点击录音和角色；橙色为拟修改，当前连线保留至保存后更新':'实线：音色 · 虚线：情绪 / 待更新 · 绿：播放 · 蓝：生成 · 红：缺失 / 失败';
  if(!ids.length&&!visibleRoles.length)el('hint').textContent=snap.roles.length?'没有符合筛选的角色':'本书尚未解析角色；解析章节后即可查看音色分配';
  transform();
}
function fit(){
  var points=Array.from(el('nodes').children).map(function(n){return positions[key(n.dataset.type,n.dataset.id)]});
  if(!points.length)return;
  var minX=Math.min.apply(null,points.map(function(p){return p.x})),maxX=Math.max.apply(null,points.map(function(p){return p.x+186}));
  var minY=Math.min.apply(null,points.map(function(p){return p.y})),maxY=Math.max.apply(null,points.map(function(p){return p.y+60}));
  scale=Math.max(.025,Math.min(1,(graph.clientWidth-40)/(maxX-minX),(graph.clientHeight-40)/(maxY-minY)));tx=(graph.clientWidth-(maxX-minX)*scale)/2-minX*scale;ty=(graph.clientHeight-(maxY-minY)*scale)/2-minY*scale;transform();
}
function roleDetails(name){
  el('drawer').hidden=true;var panel=el('details');panel.replaceChildren();button(panel,'×',function(){panel.hidden=true}).className='close';text(panel,'h2',name);
  var links=graphEdges.filter(function(e){return e.role===name});text(panel,'p',links.length+' 条音色关系；特例以实际片段为准','hint');
  links.forEach(function(e){text(panel,'h3',e.emotions.map(function(v){return labels[v]||v}).join('、')+(e.kind==='emotion'?' · 情绪参考':''));button(panel,audioName(e.audioId)+' · 试听',function(){send('previewAudio',{audioId:e.audioId})});if(editing)button(panel,'解除此绑定',function(){choose(name,null,e.emotions[0],e.emotions)})});
  text(panel,'h3','片段与特例');
  snap.usages.filter(function(u){return u.role===name&&(!currentOnly||u.chapter===runtime.chapter)}).forEach(function(u){
    var title='第 '+(u.chapter+1)+' 章 · 第 '+(u.index+1)+' 段 · '+(labels[u.emotion]||u.emotion);
    var source=u.source==='legacy'?'待确认特例':u.source==='segment'?'片段特例':u.source==='role'?'角色绑定':'自动分配';
    text(panel,'div',title+' / '+source+(u.pending?' / 待更新，旧音频已保留':'')+'\n'+u.text,(u.source==='legacy'||u.source==='segment')?'exception':'hint');
  });panel.hidden=false;
}
function audioDetails(id){
  var panel=el('details');panel.replaceChildren();button(panel,'×',function(){panel.hidden=true}).className='close';text(panel,'h2',audioName(id));button(panel,'试听参考录音',function(){send('previewAudio',{audioId:id})});
  var list=text(panel,'div','','list');graphEdges.filter(function(e){return e.audioId===id}).forEach(function(e){button(list,e.role+' · '+e.emotions.map(function(v){return labels[v]||v}).join('、'),function(){roleDetails(e.role)})});panel.hidden=false;
}
function library(){
  el('details').hidden=true;var panel=el('drawer');panel.replaceChildren();button(panel,'×',function(){panel.hidden=true}).className='close';text(panel,'h2','参考音频库');
  var search=document.createElement('input');search.type='search';search.placeholder='搜索本机录音';panel.appendChild(search);var list=text(panel,'div','','list');
  function populate(){list.replaceChildren();snap.audios.filter(function(a){return a.name.toLowerCase().includes(search.value.toLowerCase())}).forEach(function(a){
    var used=snap.edges.some(function(e){return e.audioId===a.id});button(list,a.name+(used?' · 已使用':' · 未使用'),function(){
      if(editing){selectedAudio=a.id;panel.hidden=true;toast('已选择录音，请点击目标角色');render()}else send('previewAudio',{audioId:a.id});
    });
  })}search.oninput=populate;populate();panel.hidden=false;
}
graph.addEventListener('pointerdown',function(e){
  if(!snap)return;graph.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2){var ps=Array.from(pointers.values());gesture={type:'pinch',distance:Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y),scale:scale};return}
  var port=e.target.closest('[data-port]'),n=e.target.closest('[data-type]'),edge=e.target.closest('[data-edge]');
  var p=point(e);dragging=false;
  if(port&&port.dataset.port==='a'&&editing){gesture={type:'connect',id:n.dataset.id,start:p};rubber.removeAttribute('hidden');return}
  if(n){gesture={type:'node',node:n,id:n.dataset.id,kind:n.dataset.type,start:p,origin:Object.assign({},positions[key(n.dataset.type,n.dataset.id)])};return}
  if(edge){gesture={type:'edge',id:edge.dataset.edge,start:p};return}
  gesture={type:'pan',x:e.clientX,y:e.clientY,tx:tx,ty:ty};
});
graph.addEventListener('pointermove',function(e){
  if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  var p=point(e);
  if(gesture.type==='pinch'&&pointers.size===2){var ps=Array.from(pointers.values());var distance=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);scale=Math.max(.025,Math.min(2.5,gesture.scale*distance/Math.max(gesture.distance,1)));transform();return}
  if(gesture.type==='connect'){var a=positions[key('a',gesture.id)],x=a.x+186,y=a.y+30;rubber.setAttribute('d','M '+x+' '+y+' C '+(x+80)+' '+y+','+(p.x-80)+' '+p.y+','+p.x+' '+p.y);return}
  if(gesture.type==='node'){var dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;if(Math.abs(dx)+Math.abs(dy)>5)dragging=true;if(dragging){var pos={x:gesture.origin.x+dx,y:gesture.origin.y+dy};positions[key(gesture.kind,gesture.id)]=pos;gesture.node.setAttribute('transform','translate('+pos.x+','+pos.y+')');curves()}return}
  if(gesture.type==='pan'){tx=gesture.tx+e.clientX-gesture.x;ty=gesture.ty+e.clientY-gesture.y;transform()}
});
function endPointer(e,cancelled){
  pointers.delete(e.pointerId);rubber.setAttribute('hidden','');var g=gesture;gesture=null;if(!g||cancelled)return;
  if(g.type==='connect'){
    var target=document.elementFromPoint(e.clientX,e.clientY),n=target&&target.closest('[data-type="r"]');
    if(n)choose(n.dataset.id,g.id);return;
  }
  if(g.type==='node'){if(dragging){send('layout',{positions:positions,revision:snap.revision});render()}else clicked(g.kind,g.id)}
  if(g.type==='edge'&&editing){var edge=graphEdges.find(function(v){return v.id===g.id});if(edge)choose(edge.role,null,edge.emotions[0],edge.emotions)}
  if(g.type==='pan'||g.type==='pinch')render();
}
graph.addEventListener('pointerup',function(e){endPointer(e,false)});
graph.addEventListener('pointercancel',function(e){endPointer(e,true)});
graph.addEventListener('wheel',function(e){e.preventDefault();var p=point(e),r=graph.getBoundingClientRect();scale=Math.max(.025,Math.min(2.5,scale*(e.deltaY>0?.9:1.1)));tx=e.clientX-r.left-p.x*scale;ty=e.clientY-r.top-p.y*scale;transform()},{passive:false});
el('search').oninput=function(){render()};
el('fit').onclick=fit;el('scope').onclick=function(){currentOnly=!currentOnly;render();fit()};
el('edit').onclick=function(){editing=!editing;selectedAudio=null;render()};
el('library').onclick=library;
el('reload').onclick=function(){
  function reload(){edits=[];undo=[];redo=[];draftRevision=null;closeDialog();send('refresh',{});render()}
  if(!edits.length){reload();return}
  var box=dialog('放弃草稿并刷新？');text(box,'p','节点布局保留，未保存的音色分配修改将被放弃。','hint');
  button(box,'继续编辑',closeDialog);button(box,'放弃并刷新',reload);
};
el('motion').onclick=function(){motion=!motion;el('motion').textContent='动效：'+(motion?'开':'关');document.body.classList.toggle('still',!motion||!active);curves()};
el('locate').onclick=function(){var usage=snap&&snap.usages.find(function(u){return u.chapter===runtime.chapter&&u.index===runtime.index});if(!usage){toast('当前没有播放中的角色');return}var p=positions[key('r',usage.role)];if(!p){currentOnly=false;el('search').value='';render();p=positions[key('r',usage.role)]}if(p){scale=1;tx=graph.clientWidth/2-p.x-93;ty=graph.clientHeight/2-p.y-30;transform();roleDetails(usage.role)}};
el('undo').onclick=function(){if(!undo.length)return;redo.push(JSON.stringify(edits));edits=JSON.parse(undo.pop());render()};
el('redo').onclick=function(){if(!redo.length)return;undo.push(JSON.stringify(edits));edits=JSON.parse(redo.pop());render()};
el('save').onclick=function(){
  if(!edits.length)return;var box=dialog('保存分配前确认');
  text(box,'p','修改应用于本书全部已解析章节及后续章节。保存只标记待更新，不自动生成。','hint');
  var label=text(box,'label','');var checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=cover;label.appendChild(checkbox);label.appendChild(document.createTextNode(' 覆盖片段特例（默认保留）'));
  button(box,'取消',closeDialog);button(box,'查看影响范围',function(){cover=checkbox.checked;send('save',{revision:draftRevision||snap.revision,edits:edits,coverExceptions:cover});closeDialog()});
};
el('regen').onclick=function(){
  if(edits.length){toast('请先保存或撤销草稿，再重新生成');return}
  var box=dialog('手动重新生成');text(box,'p','只生成标记为待更新的片段，使用当前模型设置。此操作将调用你配置的语音服务。','hint');
  button(box,'取消',closeDialog);button(box,'当前章受影响片段',function(){send('regenerate',{chapter:runtime.chapter});closeDialog()});button(box,'全部受影响片段',function(){send('regenerate',{});closeDialog()});
};
window.voiceGraphReceive=function(message){
  if(message.type==='runtime'||message.type==='snapshot'){bridgeAcknowledged=true;clearTimeout(handshakeTimer)}
  if(message.type==='snapshot'){
    if(message.reset){edits=[];undo=[];redo=[];draftRevision=null}
    if(edits.length&&draftRevision&&message.data.revision!==draftRevision)toast('分配已变化。请刷新后重新编辑，当前草稿不会覆盖新的分配。');
    snap=message.data;
    if(!initialized){positions=Object.assign({},snap.layout);initialized=true}
    if(!gesture){render();if(!window.didFit){fit();window.didFit=true}}
  }else if(message.type==='runtime'){
    runtime=message.data;active=runtime.active!==false&&!document.hidden;document.body.classList.toggle('still',!motion||!active);if(!gesture)render();
  }else if(message.type==='saved'){edits=[];undo=[];redo=[];draftRevision=null;toast('已保存分配，请手动重新生成受影响片段');send('refresh',{})}
  else if(message.type==='error')toast(message.message);
  else if(message.type==='closeRequest')send(edits.length?'confirmClose':'close',{});
};
document.addEventListener('visibilitychange',function(){active=runtime.active!==false&&!document.hidden;document.body.classList.toggle('still',!motion||!active);curves()});
// 鸿蒙消息代理可能在文档完成后才注册；收到应用回执前进行有界握手。
window.voiceGraphAnnounceReady=function(){
  if(bridgeAcknowledged)return;
  clearTimeout(handshakeTimer);send('ready',{});handshakeAttempts++;
  if(handshakeAttempts<24)handshakeTimer=setTimeout(window.voiceGraphAnnounceReady,400);
};
changeSize();window.addEventListener('resize',changeSize);window.voiceGraphAnnounceReady();
})();
</script></body></html>`;
