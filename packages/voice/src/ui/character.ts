import type {VisualState} from '@xiaoyun/protocol';
import {GrokCharacter} from './vendor/grok-engine';

const poses:Record<VisualState,string> = {
  armed:'idle', mic_off:'sleeping', waking:'waking', listening:'listening',
  thinking:'curious', working:'humming', speaking:'dictating', happy:'happy', error:'confused',
};

/** The character owns its frames. React never receives microphone samples. */
export class CharacterView {
  private bot:InstanceType<typeof GrokCharacter>;
  private state:VisualState = 'armed';
  private suspended=false;
  private micEnabled=false;
  private hovered=false;
  private pose='';
  constructor(private svg:SVGSVGElement, private halo:HTMLElement) {
    this.bot = new GrokCharacter(svg, {
      mode:'hold', state:'idle', shape:'blob', color:'black', loginWrap:true,
      inkFlat:'#232b30', eyeColor:'#fbffff', followPointer:false,
      paused:true, ambientTricks:false, reduceMotion:false, faceOverlays:false,
      keepWaveFace:true, overlayTurns:false,
    });
    this.update('armed',true);
    document.addEventListener('visibilitychange',this.onVisibility);
    this.onVisibility();
  }
  update(state:VisualState, force = false) {
    if (state === this.state && !force) return;
    this.state = state;
    this.halo.dataset.state = state;
    this.bot.audioLevel = 0;
    this.halo.style.setProperty('--voice-level','0');
    this.applyPose();
    this.bot.setPaused(this.suspended);
  }
  private applyPose(){
    const pose=this.hovered&&this.micEnabled?'happy':poses[this.state];
    if(pose===this.pose)return;
    this.pose=pose;this.svg.dataset.pose=pose;
    this.bot.faceOverlays=pose==='dictating';
    // Native eye morphs and body springs keep their current values when the pose changes.
    this.bot.setState(pose);
    if(pose==='happy'&&this.hovered&&this.micEnabled)this.bot.bounceOnce(0.3);
  }
  private onVisibility=()=>document.hidden?this.suspend():this.resume();
  setMicEnabled(enabled:boolean){this.micEnabled=enabled;this.bot.setFollowPointer(enabled);this.applyPose();}
  setHovered(hovered:boolean){this.hovered=hovered;this.applyPose();}
  suspend(){this.suspended=true;this.bot.setPaused(true);}
  resume(){this.suspended=false;this.bot.setPaused(false);}
  setAudioLevel(level:number) {
    const amount = Math.max(0,Math.min(1,Number.isFinite(level) ? level : 0));
    this.bot.audioLevel = this.state === 'speaking' ? amount : 0;
    this.halo.style.setProperty('--voice-level',['listening','speaking'].includes(this.state) ? String(amount) : '0');
  }
  destroy() {
    document.removeEventListener('visibilitychange',this.onVisibility);
    this.bot.destroy();
  }
}
