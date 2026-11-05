// Минами Син (Swarggy/Ew). Opening the card makes a higanbana bloom and starts his theme,
// "Run Up" by Jun Murayama (assets/minami-run-up.mp3).
// Element ids keep the old "swarggy" prefix: tactics, simulation and saved drafts rely on them.
import {createHiganbana, bloom} from './higanbana.mjs?v=1';
import {STAT_AXES, parseRating} from './rating-model.mjs?v=36';
import {createProfileRadar} from './player-ratings.mjs?v=36';

(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const screen=$('screen'),database=$('database'),section=$('dbSection'),roster=$('playersRoster');
  const card=$('swarggyCard'),dossier=$('swarggyDossier'),title=$('swarggyTitle');
  if(!screen||!database||!card||!dossier)return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const NAME='Минами Син';
  // Where the theme starts, in seconds of the file.
  const THEME_START=0;
  const BLOOM_TIME=2350,FADE_TIME=850;

  // ── Theme music ───────────────────────────────────────────────────────────
  const music=(()=>{
    const audio=$('swarggyScore'),toggle=$('swarggyMusicToggle'),volume=$('swarggyVolume');
    const level=$('swarggyVolumeLevel'),status=$('swarggyMusicStatus');
    const sound=window.HyperboreaSound,key='hyperborea_swarggy_audio_v1';
    let wanted=false,userPaused=false,resume=false,pending=false,version=0,frame=0,output=0,context=null,gain=null;
    try{userPaused=JSON.parse(localStorage.getItem(key)||'null')?.paused===true;}catch{}
    const target=()=>sound?sound.gain('swarggy','score'):.3;
    function setOutput(value){output=Math.max(0,Math.min(1,value));if(gain)gain.gain.value=output;else if(audio)audio.volume=output;}
    // Web Audio lets the level work on phones too, where media volume is fixed.
    function prepare(){
      const Context=window.AudioContext||window.webkitAudioContext;
      if(audio&&!context&&Context)try{context=new Context();gain=context.createGain();gain.gain.value=output;context.createMediaElementSource(audio).connect(gain);gain.connect(context.destination);audio.volume=1;}catch{}
      if(context&&context.state!=='running')context.resume().catch(()=>{});
    }
    function fade(to,seconds,done){
      cancelAnimationFrame(frame);frame=0;
      if(seconds<=0||motion.matches||document.hidden){setOutput(to);done?.();return;}
      const from=output,begin=performance.now();
      const step=now=>{
        const k=Math.min(1,(now-begin)/(seconds*1000));setOutput(from+(to-from)*k*k*(3-2*k));
        if(k<1)frame=requestAnimationFrame(step);else{frame=0;done?.();}
      };
      frame=requestAnimationFrame(step);
    }
    function seek(value){try{audio.currentTime=value;}catch{}}
    function sync(){
      if(!toggle)return;
      const playing=pending||(audio&&!audio.paused);
      toggle.textContent=playing?'PAUSE':'PLAY';toggle.setAttribute('aria-pressed',String(playing));
      toggle.setAttribute('aria-label',playing?'Приостановить тему Минами Сина':'Включить тему Минами Сина');
    }
    function save(){try{localStorage.setItem(key,JSON.stringify({paused:userPaused}));}catch{}}
    function play(){
      if(!audio||!wanted||userPaused||document.hidden)return;
      prepare();
      if(!audio.paused&&!pending){fade(target(),.6);sync();return;}
      const token=++version;pending=true;sync();
      audio.play().then(()=>{
        if(token!==version){if(!wanted||userPaused)audio.pause();return;}
        pending=false;
        if(!wanted||userPaused||document.hidden){audio.pause();sync();return;}
        status.textContent='';fade(target(),1.6);sync();
      }).catch(error=>{
        if(token!==version)return;
        pending=false;
        status.textContent=error?.name==='NotAllowedError'?'Нажми PLAY, чтобы включить тему':'Тема недоступна — попробуй PLAY';
        sync();
      });
    }
    function start(){
      if(!audio)return;
      wanted=true;resume=false;status.textContent='';
      cancelAnimationFrame(frame);frame=0;
      if(audio.paused){setOutput(0);seek(THEME_START);}
      if(userPaused)sync();else play();
    }
    function stop(){
      if(!audio)return;
      wanted=false;resume=false;version++;pending=false;
      const finish=()=>{if(wanted)return;audio.pause();seek(THEME_START);setOutput(0);sync();};
      if(!audio.paused)fade(0,.4,finish);else finish();
      status.textContent='';
    }
    if(audio){
      toggle?.addEventListener('click',()=>{
        if(!wanted)return;
        if(pending||!audio.paused){userPaused=true;version++;pending=false;cancelAnimationFrame(frame);frame=0;audio.pause();setOutput(0);sync();}
        else{userPaused=false;play();}
        save();
      });
      sound?.bind(volume,'swarggy',level);
      sound?.subscribe(channel=>{if((channel==='swarggy'||channel==='master')&&!audio.paused&&!frame)setOutput(target());});
      // Unlock Web Audio on a real gesture without loading the track.
      document.addEventListener('pointerdown',event=>{if(event.isTrusted&&wanted)prepare();},{capture:true});
      audio.addEventListener('playing',()=>{if(!wanted||userPaused)audio.pause();sync();});
      audio.addEventListener('pause',sync);
      audio.addEventListener('error',()=>{pending=false;version++;if(wanted)status.textContent='Тема недоступна — попробуй PLAY';sync();});
      document.addEventListener('visibilitychange',()=>{
        if(document.hidden){if(wanted&&(pending||!audio.paused)){resume=true;version++;pending=false;cancelAnimationFrame(frame);frame=0;audio.pause();}}
        else if(wanted&&resume&&!userPaused){resume=false;play();}
      });
      setOutput(0);sync();
    }
    return {start,stop,get state(){return audio?{wanted,userPaused,pending,paused:audio.paused,currentTime:audio.currentTime,level:output}:null;}};
  })();

  // ── Intro: the flower opens over the roster ───────────────────────────────
  const overlay=document.createElement('section');
  overlay.id='swarggyIntroOverlay';overlay.className='swarggy-intro';overlay.hidden=true;
  overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label',NAME+' — вход в досье');overlay.tabIndex=-1;
  overlay.innerHTML='<div class="minami-intro-sky" aria-hidden="true"></div><div class="minami-intro-moon" aria-hidden="true"></div><span class="minami-intro-kanji" aria-hidden="true" lang="ja">彼岸花</span><div class="minami-intro-bloom" aria-hidden="true"></div><div class="minami-intro-petals" aria-hidden="true"></div><div class="minami-intro-flash" aria-hidden="true"></div><div class="swarggy-intro-label"><span>04 / HIGANBANA ARCHIVE</span><strong>'+NAME+'</strong><span>Swarggy/Ew</span></div><button id="swarggyIntroSkip" type="button">ПРОПУСТИТЬ <span aria-hidden="true">↗</span></button>';
  screen.append(overlay);
  const skip=$('swarggyIntroSkip'),bloomBox=overlay.querySelector('.minami-intro-bloom');
  const introFlower=createHiganbana({seed:11,petals:22,stamens:32,reach:200,stem:true,className:'minami-intro-flower'});
  bloomBox.append(introFlower.svg);
  scatterPetals(overlay.querySelector('.minami-intro-petals'),18,5);

  let opened=false,busy=false,swapping=false,epoch=0,phase='idle',finishCurrent=null;
  let timers=[],animations=[],tiltFrame=0;
  const later=(callback,delay)=>{const token=epoch;const id=setTimeout(()=>{if(token===epoch)callback();},delay);timers.push(id);return id;};
  const ambient=()=>window.HyperboreaAmbience?.refresh();
  function clearTilt(){cancelAnimationFrame(tiltFrame);tiltFrame=0;dossier.style.setProperty('--swarggy-rx','0deg');dossier.style.setProperty('--swarggy-ry','0deg');}
  function cleanup(){
    epoch++;timers.forEach(clearTimeout);timers=[];animations.forEach(a=>a.cancel());animations=[];
    finishCurrent=null;overlay.hidden=true;overlay.classList.remove('is-blooming','is-finishing','is-iris');
    skip.hidden=false;database.inert=false;roster.classList.remove('space-suspended');screen.classList.remove('swarggy-cinematic');
    busy=false;phase='idle';
  }
  function theme(active){database.classList.toggle('swarggy-theme',active);screen.classList.toggle('swarggy-active',active);ambient();}
  function reveal(){
    opened=true;section.hidden=true;roster.hidden=true;dossier.hidden=false;theme(true);
    $('dbPath').textContent='HYPERBOREA / PLAYERS / МИНАМИ СИН';
    const network=$('dbNetworkStatus');if(network)network.textContent='CONNECTION STABLE';
    database.scrollTop=0;
  }
  function deactivate(restore){
    opened=false;dossier.hidden=true;theme(false);clearTilt();music.stop();
    if(restore){section.hidden=false;roster.hidden=false;$('dbPath').textContent='HYPERBOREA / PLAYERS';database.scrollTop=0;window.PlayersSpace?.refresh?.();}
  }
  function finishIntro(immediate=false){
    if(!busy||phase!=='intro')return;
    phase='reveal';reveal();
    const finish=()=>{if(phase!=='reveal')return;cleanup();if(opened&&!document.hidden)title.focus({preventScroll:true});};
    finishCurrent=finish;
    if(immediate||motion.matches||document.hidden){finish();return;}
    overlay.classList.add('is-finishing');
    animations.push(overlay.animate([{opacity:1},{opacity:1,offset:.25},{opacity:0}],{duration:FADE_TIME,easing:'ease-in',fill:'both'}));
    animations.push(introFlower.flower.animate([{transform:'scale(1) rotate(0deg)'},{transform:'scale(3.4) rotate(14deg)'}],{duration:FADE_TIME,easing:'cubic-bezier(.55,0,.4,1)',fill:'both'}));
    later(finish,FADE_TIME);
  }
  function enter(){
    if(opened||busy||window.HyperboreaTransitions?.busy||window.FrogArchive?.busy||window.FrogArchive?.isOpen||window.FrogCoin?.active||window.WahArchive?.busy||window.WahArchive?.isOpen||window.FearArchive?.isOpen||window.NewPlayersArchive?.isOpen||window.NewPlayersArchive?.busy||!database.classList.contains('active')||section.hidden||roster.hidden)return;
    window.FearArchive?.silence();window.WahAudio?.exit();window.FrogAudio?.exit();window.EmilianoAudio?.exit?.();
    cleanup();busy=true;phase='intro';ambient();
    // Start inside the click so the browser lets the theme play.
    music.start();
    if(motion.matches||document.hidden){finishIntro(true);return;}
    database.inert=true;roster.classList.add('space-suspended');screen.classList.add('swarggy-cinematic');
    overlay.hidden=false;skip.hidden=false;
    // Restart the CSS parts of the intro (label, moon, falling petals).
    void overlay.offsetWidth;overlay.classList.add('is-blooming');
    animations.push(...bloom(introFlower,{delay:120}));
    animations.push(overlay.animate([{opacity:0},{opacity:1}],{duration:260,easing:'ease-out',fill:'both'}));
    skip.focus({preventScroll:true});
    finishCurrent=()=>finishIntro(true);
    later(()=>finishIntro(),BLOOM_TIME);
  }
  // Short closing bloom: the open flower flares and hides the swap between views.
  function iris(swap,done){
    cleanup();busy=true;phase='iris';database.inert=true;roster.classList.add('space-suspended');screen.classList.add('swarggy-cinematic');
    let changed=false;
    const change=()=>{if(changed)return;changed=true;swapping=true;try{swap();}finally{swapping=false;}};
    const finish=()=>{if(phase!=='iris')return;change();cleanup();done?.();};
    finishCurrent=finish;
    if(motion.matches||document.hidden){finish();return;}
    music.stop();
    overlay.hidden=false;overlay.classList.add('is-iris');skip.hidden=true;overlay.focus({preventScroll:true});
    animations.push(overlay.animate([{opacity:0},{opacity:1,offset:.4},{opacity:1,offset:.56},{opacity:0}],{duration:950,easing:'cubic-bezier(.3,0,.2,1)',fill:'both'}));
    animations.push(introFlower.flower.animate([{transform:'scale(.35) rotate(-30deg)',opacity:0},{transform:'scale(1.05) rotate(0deg)',opacity:1,offset:.45},{transform:'scale(2.6) rotate(10deg)',opacity:0}],{duration:950,easing:'cubic-bezier(.3,0,.2,1)',fill:'both'}));
    later(change,380);later(finish,980);
  }
  function close(){
    if(busy&&(phase==='intro'||phase==='reveal')){reset();if(database.classList.contains('active'))card.focus({preventScroll:true});return;}
    if(!opened||busy)return;
    iris(()=>deactivate(true),()=>{if(database.classList.contains('active'))card.focus({preventScroll:true});});
  }
  function exitTo(swap,done){if(!opened||busy)return false;iris(()=>{deactivate(false);swap();},done);return true;}
  function reset(){
    if(swapping){deactivate(false);return;}
    const restore=opened||busy;cleanup();deactivate(restore);
  }
  card.addEventListener('click',enter);$('swarggyReturn').addEventListener('click',close);
  skip.addEventListener('click',()=>finishIntro());
  overlay.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&(phase==='intro'||phase==='reveal')){event.preventDefault();event.stopPropagation();close();}
    if(event.key==='Tab'){event.preventDefault();(skip.hidden?overlay:skip).focus({preventScroll:true});}
  });

  // ── Dossier art: flowers around the portrait, two looks of Shin ───────────
  const art=dossier.querySelector('.swarggy-art');
  const back=dossier.querySelector('.minami-flowers-back'),front=dossier.querySelector('.minami-flowers-front');
  [[back,{seed:3,petals:18,stamens:26,reach:190,stem:true,stemLength:900,className:'minami-flower flower-a'}],
   [back,{seed:21,petals:16,stamens:24,reach:170,stem:true,stemLength:900,className:'minami-flower flower-b'}],
   [back,{seed:8,petals:14,stamens:20,reach:150,stem:true,stemLength:900,className:'minami-flower flower-c'}],
   [front,{seed:5,petals:18,stamens:28,reach:190,stem:true,stemLength:900,className:'minami-flower flower-d'}]]
    .forEach(([parent,options])=>parent?.append(createHiganbana(options).svg));
  scatterPetals(dossier.querySelector('.minami-drift'),12,9);
  // A small flower on the roster card too.
  const cardArt=card.querySelector('.swarggy-card-art');
  if(cardArt){
    const bloomMark=document.createElement('span');bloomMark.className='minami-card-bloom';bloomMark.setAttribute('aria-hidden','true');
    bloomMark.append(createHiganbana({seed:17,petals:16,stamens:22,reach:190,className:'minami-card-flower'}).svg);
    cardArt.insertBefore(bloomMark,cardArt.querySelector('img'));
  }

  const looks=[...dossier.querySelectorAll('.minami-look button')];
  const portraits={field:dossier.querySelector('.minami-portrait-field'),off:dossier.querySelector('.minami-portrait-off')};
  function setLook(look){
    if(!art||!portraits[look])return;
    art.dataset.look=look;
    for(const button of looks)button.setAttribute('aria-pressed',String(button.dataset.look===look));
    for(const [name,image] of Object.entries(portraits))image?.setAttribute('aria-hidden',String(name!==look));
  }
  looks.forEach(button=>button.addEventListener('click',()=>setLook(button.dataset.look)));
  setLook('field');

  dossier.querySelectorAll('[data-swarggy-scroll]').forEach(button=>button.addEventListener('click',()=>{
    const target=$(button.dataset.swarggyScroll);target?.focus({preventScroll:true});target?.scrollIntoView({behavior:motion.matches?'auto':'smooth',block:'start'});
  }));
  art?.addEventListener('pointermove',event=>{
    if(!opened||busy||motion.matches||event.pointerType==='touch')return;
    cancelAnimationFrame(tiltFrame);tiltFrame=requestAnimationFrame(()=>{
      const rect=art.getBoundingClientRect(),x=Math.max(-.5,Math.min(.5,(event.clientX-rect.left)/rect.width-.5)),y=Math.max(-.5,Math.min(.5,(event.clientY-rect.top)/rect.height-.5));
      dossier.style.setProperty('--swarggy-rx',(-y*8).toFixed(2)+'deg');dossier.style.setProperty('--swarggy-ry',(x*11).toFixed(2)+'deg');
    });
  },{passive:true});
  art?.addEventListener('pointerleave',clearTilt,{passive:true});
  window.addEventListener('resize',()=>{finishCurrent?.();clearTilt();},{passive:true});
  document.addEventListener('visibilitychange',()=>{const hidden=document.hidden;dossier.classList.toggle('swarggy-paused',hidden);overlay.classList.toggle('swarggy-paused',hidden);if(hidden){finishCurrent?.();clearTilt();}});
  motion.addEventListener('change',()=>{finishCurrent?.();clearTilt();});
  window.addEventListener('pagehide',reset);
  // An iris exit deliberately deactivates the database before its finish callback.
  // Keep that callback alive so central navigation can release its running state.
  new MutationObserver(()=>{if((opened||busy)&&phase!=='iris'&&!database.classList.contains('active'))reset();}).observe(database,{attributes:true,attributeFilter:['class']});

  // ── Profile: ratings, position, description and weapon (saved on this device) ──
  const inputs=STAT_AXES.map(axis=>$('swarggyStat'+axis));
  const position=$('swarggyPosition'),description=$('swarggyDescription'),weapon=$('swarggyWeapon');
  const profileKey='hyperborea_swarggy_profile_v1',updateRadar=createProfileRadar('swarggy');
  function draw(){
    const ratings=inputs.map(input=>parseRating(input.value));updateRadar(ratings);
    $('swarggyDescriptionCount').textContent=description.value.length+' / 12000';$('swarggyWeaponCount').textContent=weapon.value.length+' / 6000';
    return ratings;
  }
  function save(){
    const profile={ratings:draw(),position:position.value,description:description.value,weapon:weapon.value};
    try{localStorage.setItem(profileKey,JSON.stringify(profile));$('swarggySaveState').textContent='Сохранено на этом устройстве';}catch{$('swarggySaveState').textContent='Изменения доступны до закрытия страницы';}
  }
  try{
    const saved=JSON.parse(localStorage.getItem(profileKey)||'null');
    if(saved&&typeof saved==='object'&&!Array.isArray(saved)){
      if(Array.isArray(saved.ratings))inputs.forEach((input,i)=>{input.value=parseRating(saved.ratings[i])??'';});
      if(typeof saved.position==='string')position.value=saved.position.slice(0,40);
      if(typeof saved.description==='string')description.value=saved.description.slice(0,12000);
      if(typeof saved.weapon==='string')weapon.value=saved.weapon.slice(0,6000);
    }
  }catch{}
  inputs.forEach(input=>input.addEventListener('input',()=>{input.value=parseRating(input.value)??'';save();}));
  for(const input of [position,description,weapon])input.addEventListener('input',save);
  draw();

  // Loose petals that drift down; positions are fixed per page so they never jump.
  function scatterPetals(box,count,seed){
    if(!box)return;
    let value=seed;
    const rand=()=>{value=(value*16807)%2147483647;return value/2147483647;};
    for(let i=0;i<count;i++){
      const petal=document.createElement('i');
      petal.style.setProperty('--x',(rand()*100).toFixed(1)+'%');
      petal.style.setProperty('--size',(7+rand()*9).toFixed(1)+'px');
      petal.style.setProperty('--drift',((rand()-.5)*160).toFixed(0)+'px');
      petal.style.setProperty('--spin',((rand()-.5)*720).toFixed(0)+'deg');
      petal.style.setProperty('--time',(6+rand()*7).toFixed(2)+'s');
      petal.style.setProperty('--delay',(-rand()*12).toFixed(2)+'s');
      box.append(petal);
    }
  }

  window.SwarggyArchive={open:enter,close,reset,exitTo,get isOpen(){return opened;},get busy(){return busy;},get state(){return phase;},get variant(){return 'bloom';},get cinematic(){return null;},get music(){return music.state;}};
})();
