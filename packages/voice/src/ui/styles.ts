export const styles = String.raw`
:host { --xy-ink:#27363c; --xy-muted:#7e9196; --xy-paper:#ffffffed; --xy-line:#dce7ebaa; --xy-accent:#bcebd6; --xy-green:#33715c; color-scheme:light; }
*, *::before, *::after { box-sizing:border-box; }
button, input, textarea { font:inherit; }
button { -webkit-tap-highlight-color:transparent; cursor:pointer; }
button:disabled { cursor:default; opacity:.45; }
button, a { touch-action:manipulation; }
button:focus-visible, input:focus-visible, a:focus-visible, [tabindex]:focus-visible { outline:3px solid #72bba2; outline-offset:3px; }
.xy-widget { --xy-size:100px; position:fixed; z-index:2147482000; right:var(--xy-drag-right,var(--xiaoyun-right,28px)); bottom:var(--xy-drag-bottom,var(--xiaoyun-bottom,22px)); width:min(390px,calc(100vw - 32px)); height:var(--xy-size); pointer-events:none; font:var(--xy-font-size,14px)/1.65 'Segoe UI','Microsoft YaHei',sans-serif; color:var(--xy-ink); letter-spacing:.01em; }
.xy-widget button, .xy-widget input, .xy-cards, .xy-composer, .xy-caption, .xy-task-group { pointer-events:auto; }
.xy-panels { position:absolute; display:flex; flex-direction:column; bottom:calc(100% + 28px); left:var(--xy-panel-shift,0px); width:var(--xy-panel-width,360px); max-height:var(--xy-panel-space,72vh); }
.xy-widget[data-panels=below] .xy-panels { bottom:auto; top:calc(100% + 28px); flex-direction:column-reverse; }
.xy-cards { order:0; flex:0 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:12px 8px 12px; scrollbar-width:thin; scrollbar-color:#c3d3d3 transparent; overflow-anchor:none; }
.xy-cards:has(.xy-cards-inner:empty) { display:none; }
.xy-cards-inner { display:flex; flex-direction:column; gap:12px; }
.xy-widget[data-panels=below] .xy-cards-inner { flex-direction:column-reverse; }
.xy-card-slot { position:relative; flex-shrink:0; min-width:0; max-height:var(--xy-card-height,1000px); transform-origin:50% 100%; animation:xy-arrive .52s cubic-bezier(.16,.8,.25,1.1) backwards; transition:max-height .32s cubic-bezier(.2,.75,.25,1),margin .32s; }
.xy-widget[data-panels=below] .xy-card-slot { transform-origin:50% 0; }
.xy-card-slot[data-exiting=true] { animation:none; max-height:0; margin-bottom:-12px; pointer-events:none; transition:max-height .34s .2s cubic-bezier(.3,0,.3,1),margin .34s .2s; }
.xy-widget[data-panels=below] .xy-card-slot[data-exiting=true] { margin-bottom:0; margin-top:-12px; }
.xy-card-slot[data-exiting=true] .xy-card { animation:xy-bubble-break .4s cubic-bezier(.18,.7,.25,1) both; transform-origin:center; }
.xy-bubble-pop { position:absolute; inset:0; height:var(--xy-card-height); pointer-events:none; z-index:2; }
.xy-bubble-pop::before { content:''; position:absolute; inset:0; border-radius:26px; border:1px solid #c7e7df; box-shadow:inset 0 0 8px #e5fff366,0 0 8px #c7e1f344; animation:xy-pop-ring .5s ease-out both; }
.xy-bubble-pop i { position:absolute; left:var(--px); top:var(--py); width:7px; height:7px; border:1px solid #b9dcd6; border-radius:50%; background:radial-gradient(circle at 25% 20%,#ffffffed,#dcf3ee55 50%,transparent 65%); animation:xy-pop-drop .46s var(--delay) cubic-bezier(.15,.65,.3,1) both; }
.xy-card { position:relative; min-width:0; overflow:hidden; background:linear-gradient(135deg,#fffffff9,#f8fcfff7 55%,#eff9f5f5); border:1px solid #ffffffd9; outline:1px solid #dce7eb99; border-radius:24px; box-shadow:0 12px 34px #3b657314,0 2px 6px #46677408,inset 0 1px 0 #fff; backdrop-filter:blur(22px) saturate(1.35); transition:height .32s cubic-bezier(.2,.75,.25,1),border-color .6s,box-shadow .6s,background .6s; }
.xy-card-content { padding:15px 17px 17px; }
.xy-card[data-speaking=true] { border-color:#c7e8da; outline-color:#aed6cba0; }
.xy-card[data-pinned=true] { background:linear-gradient(135deg,#fffff9f5,#fff9e9f2); outline-color:#e7dfc999; border-color:#fffdf1; }
.xy-card-head { display:flex; align-items:center; gap:8px; min-height:30px; margin-bottom:7px; }
.xy-card-head h3 { flex:1; margin:0; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.86em; font-weight:600; color:#737a6e; }
.xy-card-mark { color:#6ba58d; flex-shrink:0; }
.xy-card[data-pinned=true] .xy-card-mark { color:#b8a45c; }
.xy-actions { display:flex; gap:2px; flex-shrink:0; }
.xy-icon-button { display:grid; place-items:center; width:36px; height:36px; border:none; border-radius:11px; background:transparent; color:#8b9186; }
.xy-icon-button:hover { background:#eff2e9; color:var(--xy-ink); }
.xy-icon-button[aria-pressed=true] { background:#f0e9c8; color:#84713c; }
.xy-icon { width:17px; height:17px; display:block; fill:none; stroke:currentColor; stroke-width:1.65; stroke-linecap:round; stroke-linejoin:round; }
.xy-transcript { font-size:1.07em; line-height:1.85; overflow-wrap:anywhere; }
.xy-transcript > div > :first-child, .xy-markdown > div > :first-child { margin-top:0; }
.xy-transcript > div > :last-child, .xy-markdown > div > :last-child { margin-bottom:0; }
.xy-attachment { margin-top:14px; padding-top:12px; border-top:1px dashed #dfe5d9; }
.xy-attachment-label { margin-bottom:9px; color:#8a9184; font-size:10px; font-weight:600; letter-spacing:.12em; }
.xy-markdown { min-width:0; font-size:.86em; line-height:1.8; overflow-wrap:anywhere; }
.xy-transcript.xy-markdown { font-size:1.07em; line-height:1.85; }
.xy-markdown h1,.xy-markdown h2,.xy-markdown h3,.xy-transcript h1,.xy-transcript h2,.xy-transcript h3 { font-size:15px; line-height:1.5; margin:16px 0 7px; font-weight:650; }
.xy-markdown p,.xy-transcript p { margin:7px 0; }
.xy-markdown ul,.xy-markdown ol,.xy-transcript ul,.xy-transcript ol { padding-left:22px; margin:8px 0; }
.xy-markdown li,.xy-transcript li { margin:3px 0; }
.xy-markdown a,.xy-transcript a { color:#28775c; text-underline-offset:3px; }
.xy-markdown blockquote,.xy-transcript blockquote { margin:12px 0; padding:2px 12px; border-left:3px solid #c5d6bd; color:#6e7968; }
.xy-markdown pre,.xy-transcript pre { background:#f1f3ec; padding:12px; border-radius:10px; overflow:auto; font:12px/1.65 Consolas,monospace; }
.xy-markdown code,.xy-transcript code { background:#edf0e7; padding:2px 4px; border-radius:4px; font:12px/1.65 Consolas,monospace; }
.xy-markdown pre code,.xy-transcript pre code { padding:0; background:none; }
.xy-markdown table,.xy-transcript table { width:100%; min-width:240px; border-collapse:collapse; white-space:nowrap; font-size:12px; margin:8px 0; }
.xy-markdown th,.xy-transcript th { background:#f0f3e9; text-align:left; font-weight:600; }
.xy-markdown td,.xy-markdown th,.xy-transcript td,.xy-transcript th { padding:8px 10px; border-bottom:1px solid #e4e9dd; }
.xy-markdown img,.xy-transcript img { max-width:100%; height:auto; border-radius:8px; }
.xy-markdown [data-streamdown=table-wrapper],.xy-transcript [data-streamdown=table-wrapper] { overflow-x:auto; }
.xy-artifact-table { border:1px solid #e4e9dd; border-radius:10px; overflow-x:auto; }
.xy-artifact-table table { margin:0; }
.xy-artifact-table tbody tr:last-child td { border-bottom:0; }
.xy-artifact-empty { margin:0; color:var(--xy-muted); font-size:12px; }
.xy-markdown hr,.xy-transcript hr { border:0; border-top:1px solid var(--xy-line); margin:14px 0; }
.xy-task-group { flex:none; margin:0 8px 10px; border:1px solid #ffffffe0; border-radius:18px; background:linear-gradient(135deg,#fafffff2,#edf7f2dd); backdrop-filter:blur(20px); box-shadow:0 5px 18px #3054690b; animation:xy-arrive .4s ease-out; }
.xy-live-area { order:2; position:relative; flex:none; }
.xy-live-inner { display:flex; flex-direction:column; gap:10px; }
.xy-live-meta { display:flex; gap:6px; align-items:flex-start; margin:0 8px; }.xy-live-meta:empty { display:none; }
.xy-live-meta .xy-task-group { flex:1; min-width:0; margin:0; }
.xy-widget[data-panels=below] .xy-live-inner { flex-direction:column-reverse; }
.xy-task-toggle { display:flex; align-items:center; gap:9px; width:100%; min-height:42px; padding:9px 13px; border:0; border-radius:17px; background:transparent; color:#678274; text-align:left; font-size:.83em; }
.xy-task-toggle>span:nth-child(2) { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.xy-task-toggle>.xy-icon { width:15px; height:15px; transition:transform .3s; }
.xy-task-toggle[aria-expanded=true]>.xy-icon { transform:rotate(180deg); }
.xy-task-list { display:flex; flex-direction:column; gap:2px; margin:0 8px 8px; border-top:1px solid #dceae3aa; padding-top:4px; }
.xy-task { display:flex; gap:9px; align-items:center; padding:6px 1px 6px 5px; pointer-events:auto; }
.xy-task .xy-icon-button { width:34px; height:34px; }
.xy-task-body { flex:1; min-width:0; line-height:1.5; }
.xy-task-title { font-size:.79em; color:#66705f; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.xy-task-progress { font-size:.72em; color:#92998a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.xy-task-dot { width:6px; height:6px; border-radius:50%; background:#89b396; flex-shrink:0; animation:xy-light-breathe 2.6s ease-in-out infinite; }
.xy-new-results { flex:none; margin-left:auto; display:flex; align-items:center; justify-content:center; gap:6px; min-height:42px; padding:8px 12px; border:1px solid #ffffffdd; border-radius:18px; background:#eaf8f1f5; backdrop-filter:blur(18px); color:#44735e; box-shadow:0 4px 16px #33615120; font-size:.78em; animation:xy-arrive .35s ease-out; }
.xy-new-results .xy-icon { width:14px; height:14px; }
.xy-caption-shell { position:relative; flex:none; margin:0 8px; transform-origin:var(--xy-tail-x,310px) calc(100% + 27px); animation:xy-inflate .58s cubic-bezier(.2,.7,.2,1) both; }
.xy-caption { position:relative; padding:15px 18px; border:1px solid #ffffffeb; border-radius:25px; background:linear-gradient(145deg,#fffffffa,#f2faf7f2); backdrop-filter:blur(24px) saturate(1.3); box-shadow:0 12px 32px #3b657319,inset 0 1px 0 white; transition:box-shadow .4s,border-color .4s; }
.xy-caption-shell[data-active=true] .xy-caption { animation:xy-card-breathe 3.4s ease-in-out infinite; }
.xy-caption-tail { position:absolute; z-index:2; bottom:-27px; left:calc(var(--xy-tail-x,310px) - 36px); width:48px; height:30px; fill:#f3faf7; filter:drop-shadow(1px 2px 1px #46786b0a); transform-origin:50% 0; transform:scale(.25,0); opacity:0; transition:transform .32s cubic-bezier(.2,.75,.2,1),opacity .2s; pointer-events:none; }
.xy-caption-shell[data-active=true] .xy-caption-tail { transform:scale(1); opacity:1; }
.xy-caption-shell[data-leaving=true] { animation:xy-bubble-break .48s ease-out both; }
.xy-caption-shell[data-leaving=true] .xy-caption-tail { opacity:0; transform:scale(.25,0); }
.xy-widget[data-panels=below] .xy-caption-shell { transform-origin:var(--xy-tail-x,310px) -27px; }
.xy-widget[data-panels=below] .xy-caption-tail { bottom:auto; top:-27px; transform-origin:50% 100%; }
.xy-widget[data-panels=below] .xy-caption-tail path { transform:translateY(30px) scaleY(-1); }
.xy-caption[data-kind=question] { border-color:#dbeee3; }
.xy-caption[data-failed=true] { border-color:#edddcf; }
.xy-caption-body { min-width:0; max-height:min(108px,max(48px,calc(var(--xy-panel-space,70vh) - 92px))); overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:#c4dad1 transparent; }
.xy-caption-retry { margin:6px -7px -4px auto; }
.xy-caption .xy-markdown { font-size:1.07em; line-height:1.85; }
.xy-card-tools { display:flex; align-items:center; gap:5px; margin:10px -4px -4px; }
.xy-tools-spacer { flex:1; }
.xy-text-button { display:flex; align-items:center; justify-content:center; gap:5px; min-height:34px; padding:5px 8px; border:0; border-radius:11px; background:transparent; color:#759183; font-size:.77em; white-space:nowrap; transition:background .2s,color .2s; }
.xy-text-button:hover { color:#3a755c; background:#dcefe680; }
.xy-text-button .xy-icon { width:14px; height:14px; }
.xy-details-toggle .xy-icon { transition:transform .3s; }
.xy-details-toggle[aria-expanded=true] .xy-icon { transform:rotate(180deg); }
.xy-details { max-height:min(38vh,340px); overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:#c3d3d3 transparent; margin:12px -3px 0 0; padding:13px 5px 0 0; border-top:1px solid #dce8e0; animation:xy-arrive .3s ease-out; }
.xy-delivery-note { margin-top:8px; color:#8a9b90; font-size:.74em; }
.xy-delivery-error { margin-top:10px; color:#a16d54; font-size:.79em; }
.xy-delivery-error span { display:block; font-size:.9em; opacity:.8; }
.xy-sources { margin-top:15px; padding-top:12px; border-top:1px dashed #dfe5d9; }
.xy-sources h4 { margin:0 0 7px; color:#849486; font-size:.75em; font-weight:600; }
.xy-sources ol { margin:0; padding-left:18px; }
.xy-sources li { margin:8px 0; font-size:.76em; }
.xy-sources a { color:#477b65; text-underline-offset:3px; overflow-wrap:anywhere; }
.xy-sources li>span { display:block; color:#91a096; font-size:.9em; }
.xy-dock { position:relative; width:var(--xy-size); height:var(--xy-size); margin-left:auto; margin-right:8px; }
.xy-dock::before { content:''; position:absolute; right:100%; top:0; width:16px; height:100%; pointer-events:auto; }
.xy-dock-meta { position:absolute; right:calc(100% + 12px); top:50%; transform:translateY(-50%); display:flex; flex-direction:column; align-items:flex-end; gap:6px; width:max-content; max-width:min(255px,var(--xy-controls-space,255px)); pointer-events:auto; }
.xy-widget[data-controls-side=right] .xy-dock-meta { right:auto; left:calc(100% + 12px); align-items:flex-start; }
.xy-widget[data-controls-side=right] .xy-dock::before { right:auto; left:100%; }
.xy-status { max-width:min(255px,var(--xy-controls-space,255px)); font-size:11px; color:#788d91; text-align:right; line-height:1.5; overflow-wrap:anywhere; padding:5px 9px; border:1px solid #ffffff8a; border-radius:12px; background:#ffffff9e; backdrop-filter:blur(14px); box-shadow:0 2px 8px #36596305; }
.xy-widget[data-controls-side=right] .xy-status { text-align:left; }
.xy-status[data-error=true] { color:#a56756; }
.xy-dock-controls { position:relative; display:flex; gap:4px; align-items:center; max-height:0; padding:0 5px; border:1px solid #ffffffdc; border-radius:22px; background:linear-gradient(140deg,#fffffff0,#e9f4f1d9 55%,#edf2fae6); backdrop-filter:blur(24px) saturate(1.4); box-shadow:inset 0 1px 1px white,0 8px 24px #365d761c,0 2px 5px #365d760a; opacity:0; visibility:hidden; transform:translateY(6px) scale(.94); transform-origin:right center; pointer-events:none; transition:opacity .24s,transform .38s cubic-bezier(.2,.8,.25,1),max-height .3s,padding .3s,visibility .24s; }
.xy-dock-controls::before { content:''; position:absolute; left:50%; top:16px; bottom:16px; border-left:1px solid #c9ddd970; pointer-events:none; }
.xy-widget[data-controls-side=right] .xy-dock-controls { transform-origin:left center; }
.xy-dock:hover .xy-dock-controls,.xy-dock:has(:focus-visible) .xy-dock-controls,.xy-dock[data-touch-controls=true] .xy-dock-controls { max-height:60px; padding:5px; opacity:1; visibility:visible; transform:translateY(0) scale(1); pointer-events:auto; }
.xy-widget[data-dragging=true] .xy-dock-controls { opacity:0; visibility:hidden; pointer-events:none; }
.xy-pill { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; width:48px; min-width:48px; height:46px; min-height:46px; padding:4px; border:0; border-radius:16px; background:transparent; color:#66868a; font-size:10px; transition:background .2s,color .2s,transform .2s; }
.xy-pill:active { transform:scale(.95); }
.xy-pill:hover { background:#ffffffb8; color:#386b60; }
.xy-pill[aria-pressed=true] { color:#397b60; background:#d8eee480; }
.xy-pill .xy-icon { width:21px; height:21px; }
.xy-tool-label { font-size:10px; line-height:1; font-weight:550; }
.xy-mode { font-size:9px; letter-spacing:.06em; color:#89a294; margin-right:6px; }
.xy-character-button { position:relative; isolation:isolate; display:grid; place-items:center; width:var(--xy-size); height:var(--xy-size); padding:0; border:1px solid #ffffffde; border-radius:38%; background:radial-gradient(ellipse at 18% 8%,#ffffffee,transparent 55%),radial-gradient(ellipse at 85% 95%,#c9eeea88,transparent 66%),linear-gradient(145deg,#f7ffff9c,#e2ebf470 55%,#ffffffb8); backdrop-filter:blur(26px) saturate(1.5); box-shadow:inset 0 1px 1px #fff,inset 1px 0 2px #fff9,inset 0 -1px 2px #7897a328,0 14px 30px #35536c1a,0 3px 8px #4167790a; transition:box-shadow .45s,transform .3s,border-color .45s; overflow:visible; touch-action:none; user-select:none; -webkit-user-select:none; }
.xy-character-button::before { content:''; position:absolute; inset:2px; border-radius:36%; border:1px solid #ffffff70; background:linear-gradient(140deg,#ffffff65,transparent 35%,transparent 70%,#def1f260); pointer-events:none; }
.xy-character-button::after { content:''; position:absolute; inset:1px; border-radius:37%; background:radial-gradient(ellipse at 24% 0%,#fff 0,transparent 35%); opacity:.6; pointer-events:none; animation:xy-lens 7s ease-in-out infinite; }
.xy-character-button:hover { box-shadow:inset 0 1px 2px white,inset 0 -1px 2px #7794a128,0 16px 36px #355b7126,0 0 24px #c5efe433; border-color:#fff; }
.xy-character-button:active { transform:scale(.97); cursor:grabbing; }
.xy-widget[data-dragging=true] .xy-character-button { cursor:grabbing; transform:scale(1.035); box-shadow:inset 0 1px 2px white,0 22px 40px #355b7133; }
.xy-character-button[aria-pressed=true] { border-color:#dafff2; }
.xy-character-svg { position:relative; z-index:1; width:calc(var(--xy-size) - 2px); height:calc(var(--xy-size) - 2px); pointer-events:none; overflow:visible; filter:drop-shadow(0 4px 3px #3f576314); animation:xy-float 5.8s ease-in-out infinite; }
.xy-widget[data-dragging=true] .xy-character-svg { animation-play-state:paused; }
.xy-character-halo { --voice-level:0; position:absolute; inset:-3px; border:1px solid #b9dce240; border-radius:40%; pointer-events:none; box-shadow:0 0 14px #c3e8ea1c; transition:border-color .6s,box-shadow .6s,transform .18s; animation:xy-halo-breathe 5.2s ease-in-out infinite; }
.xy-character-halo::before { content:''; position:absolute; inset:-4px; border-radius:44%; background:conic-gradient(from 40deg,transparent 0 20%,#afdfdb60 35%,transparent 50% 65%,#c5c5eb45 80%,transparent); filter:blur(9px); opacity:.5; }
.xy-character-halo[data-state=listening],.xy-character-halo[data-state=speaking] { border-color:rgba(120,202,179,calc(.3 + var(--voice-level) * .5)); transform:scale(calc(1 + var(--voice-level) * .075)); animation-duration:2.8s; }
.xy-character-halo[data-state=mic_off] { border-color:#c7d4e13b; opacity:.5; animation-duration:6.6s; }
.xy-connection-dot { position:absolute; z-index:2; right:11px; bottom:10px; width:7px; height:7px; border:2px solid #fffffff0; box-shadow:0 0 0 1px #ffffff40; border-radius:50%; background:#c1c6c8; }
.xy-connection-dot[data-connected=true] { background:#79ad91; }
.xy-composer { order:1; flex:none; margin:0 8px 15px; padding:13px; background:#ffffffed; backdrop-filter:blur(22px); border:1px solid #fff; border-radius:21px; box-shadow:0 10px 25px #36566b12; animation:xy-arrive .36s cubic-bezier(.2,.8,.25,1.1); }
.xy-composer-label { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:11px; color:#8c947f; }
.xy-composer-row { display:flex; align-items:center; gap:8px; }
.xy-composer input { flex:1; min-width:0; width:100%; background:#f3f5ed; border:1px solid transparent; padding:11px 12px; border-radius:11px; color:var(--xy-ink); font-size:13px; outline-offset:0; }
.xy-composer input::placeholder { color:#a0a793; }
.xy-send { border:0; border-radius:12px; width:42px; height:42px; display:grid; place-items:center; background:#d0e7bd; color:#45633b; }
.xy-send:hover { background:#c2dcac; }
.xy-composer-note { margin:8px 0 0; color:#a5ab9b; font-size:10px; }
@keyframes xy-arrive { from { opacity:0; transform:translateY(11px) scale(.975); } to { opacity:1; transform:translateY(0) scale(1); } }
@keyframes xy-inflate { 0% { opacity:0; transform:scale(.16,.08); } 40% { opacity:1; transform:scale(.94,.89); } 72% { transform:scale(1.015,1.025); } 100% { opacity:1; transform:scale(1); } }
@keyframes xy-depart { to { opacity:0; transform:translateY(6px) scale(.975); } }
@keyframes xy-bubble-break { 0% { opacity:1; transform:scale(1); } 28% { opacity:.94; transform:scale(1.025,.985); } 65% { opacity:.12; transform:scale(1.05,1.025); } 100% { opacity:0; transform:scale(1.065,1.045); } }
@keyframes xy-pop-ring { 0%,12% { opacity:0; transform:scale(.99); } 32% { opacity:.75; transform:scale(1.025); } 100% { opacity:0; transform:scale(1.08); } }
@keyframes xy-pop-drop { 0%,18% { opacity:0; transform:translate(0,0) scale(.35); } 32% { opacity:.9; transform:translate(calc(var(--dx) * .25),calc(var(--dy) * .25)) scale(1); } 100% { opacity:0; transform:translate(var(--dx),var(--dy)) scale(.25); } }
@keyframes xy-float { 0%,100% { transform:translateY(2px); } 50% { transform:translateY(-3px); } }
@keyframes xy-lens { 0%,100% { opacity:.46; } 50% { opacity:.82; } }
@keyframes xy-halo-breathe { 0%,100% { box-shadow:0 0 13px #b0dcd81c; } 50% { box-shadow:0 0 22px #b1dfdc45; } }
@keyframes xy-card-breathe { 0%,100% { box-shadow:0 10px 30px #3b657314,0 0 0 1px #d8eae64d,inset 0 1px 0 white; } 50% { box-shadow:0 13px 36px #4b938121,0 0 0 1px #bfdfd9a3,inset 0 1px 0 white; } }
@keyframes xy-light-breathe { 0%,100% { opacity:.4; } 50% { opacity:1; } }
@media(max-width:480px) { .xy-widget { --xy-size:88px; right:var(--xy-drag-right,var(--xiaoyun-right,12px)); bottom:var(--xy-drag-bottom,var(--xiaoyun-bottom,max(12px,env(safe-area-inset-bottom)))); width:calc(100vw - 24px); } .xy-status { max-width:min(200px,var(--xy-controls-space,200px)); } }
`;
