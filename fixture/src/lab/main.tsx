import { StrictMode, type CSSProperties, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Annotations, emptyDoc, closeRound, type AnnotationDoc, type ReviewInsets, type ReviewStatus } from '../annotations';
import { anno, annoText, annoRegion } from '../anno';
import './lab.css';

const name = new URLSearchParams(location.search).get('fixture') ?? 'spec';
const lane = location.pathname.includes('/candidate/') ? 'candidate' : 'baseline';
const key = `mobile-lab-${name}-${lane}-v1`;
const identity = { id: 'local-reviewer', name: 'Test reviewer' };
function load(): AnnotationDoc {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? emptyDoc(`${name}-v1`); }
  catch { return emptyDoc(`${name}-v1`); }
}
function App() {
  const ref = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [doc, setDoc] = useState(load);
  const [status, setStatus] = useState('Local test only — nothing is sent to a bot.');
  const [busy, setBusy] = useState(false);
  const [insets, setInsets] = useState<ReviewInsets>({top:44,bottom:0});
  const [hasDraft, setHasDraft] = useState(false);
  const [delivery, setDelivery] = useState<ReviewStatus['state']>(()=>doc.threads.some(t=>!t.closedRoundId)?'unsent':doc.rounds?.length?'sent':'idle');
  const [fail, setFail] = useState(false);
  useEffect(() => { setRoot(ref.current); }, []);
  const change = (next: AnnotationDoc) => { setDoc(next); setDelivery(next.threads.some(t=>!t.closedRoundId) ? 'unsent' : 'idle'); localStorage.setItem(key, JSON.stringify(next)); };
  const pending = doc.threads.filter(t => !t.closedRoundId).length;
  async function send() {
    if (hasDraft) {
      setStatus('Post or cancel the open comment first.'); return;
    }
    setBusy(true); setDelivery('sending'); setStatus('Simulating delivery…');
    await new Promise(r => setTimeout(r, 700));
    if (fail) { setDelivery('error'); setStatus('Simulated failure — review retained. Retry when ready.'); }
    else { change(closeRound(doc, root?.outerHTML)); setDelivery('sent'); setStatus('Sent (simulated). No message was posted to a bot.'); }
    setBusy(false);
  }
  return <div className="review-shell" style={{'--review-top':`${insets.top}px`, '--review-bottom':`${insets.bottom}px`} as CSSProperties}>
    <div className="lab-safety" data-anno-ignore="">
      <span>TEST FIXTURE · {lane.toUpperCase()} UI · <span role="status">{status}</span></span>
      <details><summary>Test controls</summary>
        <button onClick={() => { change(emptyDoc(`${name}-v1`)); setStatus('Reset local test.'); }}>Reset this fixture</button>
        <label><input type="checkbox" checked={fail} onChange={e => setFail(e.target.checked)}/> Simulate delivery failure</label>
        <span>Browser-local state, isolated per fixture. Save all simulates a review round; it never calls a platform API.</span>
      </details>
    </div>
    <div id="artifact-root" ref={ref}>{name === 'ui' ? <Mockup/> : name === 'deck' ? <Deck/> : <Spec/>}</div>
    <Annotations root={root} annotations={doc} onChange={change} author={identity} readOnly={busy}
      onLayoutChange={setInsets} onDraftStateChange={setHasDraft}
      review={{state:delivery, pendingCount:pending, disabled:busy || !pending,
        onSend:() => void send(), message:status}}/>
  </div>;
}
function Spec() {
  return <main className="spec">
    <header className="spec-header"><span>PRODUCT / SPECS</span><button {...anno('spec.approve', 'Approve spec')}>Approve</button></header>
    <article className="spec-body">
      <p className="eyebrow">REVIEW COPY · EXAMPLE DATA</p>
      <h1 {...anno('spec.title', 'Spec title')}>Shared workspace invitations</h1>
      <p className="lede" {...annoText('spec.intro', 'Problem statement')}>A teammate should be able to join a workspace without losing the context that brought them here. Invitations must explain who invited them, what they can see, and what happens next.</p>
      <h2 {...anno('spec.goals', 'Goals heading')}>01 / Goals</h2>
      <p {...annoText('spec.goals.body', 'Goals prose')}>Make joining predictable. Preserve the destination, show the scope of access before acceptance, and provide a clear recovery route if the invitation expires.</p>
      <div className="spec-note" {...anno('spec.note', 'Security requirement')}>An invitation is not authorization. Existing access rules still apply to every workspace resource.</div>
      <h2>02 / Decisions to review</h2>
      <div className="table-wrap"><table><thead><tr><th>Decision</th><th>Proposal</th><th>Owner</th></tr></thead><tbody>
        {['Expiration', 'Guest access', 'Duplicate invite'].map((s,i) => <tr key={s}><td>{s}</td><td {...anno(`spec.decision.${i}`, `${s} proposal`)}>{['Seven-day validity with resend', 'Explicit resource access only', 'Show the existing invitation'][i]}</td><td>Product</td></tr>)}
      </tbody></table></div>
      <h2>03 / Interaction reference</h2>
      <figure {...annoRegion('spec.figure', 'Invitation layout reference')}><img src="reference-screenshot.svg" alt="Sample interface for region annotation"/></figure>
      <h2>04 / Acceptance criteria</h2>
      {Array.from({length:5},(_,i)=><p key={i} {...annoText(`spec.acceptance.${i}`, `Acceptance criterion ${i+1}`)}>The user can review the invitation details, accept access, and return to the original destination. Errors remain visible and explain how to recover without losing entered information.</p>)}
      <footer {...anno('spec.footer', 'Final sign-off')}>Ready for a cross-functional review.</footer>
    </article>
  </main>;
}
function Mockup() {
  const [tab,setTab] = useState('Overview');
  const [clicks,setClicks] = useState(0);
  return <main className="mockup">
    <header className="mock-header"><strong {...anno('ui.brand','Application name')}>Atlas / Workspaces</strong><button {...anno('ui.invite', 'Invite teammate')} onClick={()=>setClicks(v=>v+1)}>Invite teammate</button></header>
    <div className="mock-layout">
      <nav className="mock-nav">{['Overview','Members','Settings'].map(t=><button key={t} {...anno(`ui.nav.${t}`,`${t} navigation`)} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</nav>
      <section className="mock-main">
        <p className="eyebrow">WORKSPACE OVERVIEW</p><h1 {...anno('ui.title','Workspace heading')}>Good work happens together.</h1>
        <p>Current view: <b>{tab}</b> · Invite clicks: <output data-testid="invite-clicks">{clicks}</output></p>
        <div className="mock-metrics">{[['Members','24'],['Active projects','8'],['Open reviews','12']].map(([label,v])=><article key={label} {...anno(`ui.metric.${label}`,`${label} card`)}><span>{label}</span><strong>{v}</strong></article>)}</div>
        <section className="mock-card" {...anno('ui.activity','Recent activity panel')}>
          <header><h2>Recent activity</h2><button {...anno('ui.sort','Sort activity')}>Newest first</button></header>
          <div className="activity-scroll">
            {Array.from({length:10},(_,i)=><article key={i} {...anno(`ui.activity.${i}`,`Activity item ${i+1}`)}><span className="avatar">{i%2?'JL':'AR'}</span><div><b>{i%2?'Jordan Lee':'Alex Rivera'}</b><p>Updated the launch review and requested your feedback.</p></div><button {...anno(`ui.open.${i}`,`Open review ${i+1}`)} onClick={()=>setClicks(v=>v+1)}>Open</button></article>)}
          </div>
        </section>
        <section className="mock-card"><h2>Workspace settings</h2><label {...anno('ui.setting','Project name field')}>Project name <input defaultValue="Launch review"/></label><button {...anno('ui.save','Save workspace settings')} onClick={()=>setClicks(v=>v+1)}>Save settings</button></section>
      </section>
    </div>
  </main>;
}
function Deck() {
  const [index,setIndex] = useState(0);
  const titles = ['The invitation is the first impression.', 'Three moments that matter.', 'Make the next step obvious.'];
  return <main className="deck">
    <header className="deck-header"><strong>Invitation experience / Product review</strong><span>Example slide deck</span></header>
    <div className="slide-stage">
      <section className={`slide slide-${index}`} key={index} {...anno(`deck.slide.${index}`,`Slide ${index+1}`)}>
        <p className="eyebrow">ATLAS / PRODUCT DESIGN</p>
        <h1 {...annoText(`deck.title.${index}`,`Slide ${index+1} headline`)}>{titles[index]}</h1>
        {index===0?<p {...annoText('deck.summary','Opening slide summary')}>Turn an unfamiliar link into a clear, confident start.</p>:index===1?<div className="slide-columns">{['Understand','Accept','Continue'].map(t=><div key={t} {...anno(`deck.pillar.${t}`,`${t} pillar`)}><h2>{t}</h2><p>A clear promise.<br/>A visible next step.</p></div>)}</div>:<figure {...annoRegion('deck.figure','Closing slide interface reference')}><img src="reference-screenshot.svg" alt="Interface reference"/></figure>}
        <span className="slide-number">{String(index+1).padStart(2,'0')} / 03</span>
      </section>
    </div>
    <nav className="deck-controls" data-anno-ignore=""><button disabled={index===0} onClick={()=>setIndex(v=>v-1)}>Previous slide</button><span>{index+1} / 3</span><button disabled={index===2} onClick={()=>setIndex(v=>v+1)}>Next slide</button></nav>
    <p className="deck-notes" {...annoText('deck.notes','Speaker notes')}>Speaker notes: start with the problem, then explain the three moments. The deck keeps a 16:9 canvas and scales to fit. Test comments while navigating between slides.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
