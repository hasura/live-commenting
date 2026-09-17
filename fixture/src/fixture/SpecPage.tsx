import { useState } from 'react';
import { anno, annoText, annoRegion } from '../anno';
import { DecisionTable } from './DecisionTable';
import { Wireframe } from './Wireframe';

/**
 * The artifact under test: a product spec that happens to describe the feature
 * we're building, and embeds a live HTML wireframe of it.
 *
 * The shape is deliberate. A spec doc gives us real prose (text mode); an
 * embedded wireframe gives us a densely nested interactive UI (block mode) with
 * a legitimate reason to sit inside that prose. Text and element mode therefore
 * collide on one page, which is where the interesting bugs are.
 */

const SECTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'goals', label: 'Goals' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'wireframe', label: 'Wireframe' },
  { id: 'reference', label: 'Reference' },
  { id: 'open', label: 'Open questions' },
];

export function SpecPage() {
  return (
    <div className="doc">
      <Header />
      <div className="doc-cols">
        <Sidebar />
        <main className="doc-main">
          <h1 {...annoText('spec.title', 'Spec title', { kind: 'heading' })}>
            Inline Comments for Artifacts
          </h1>
          <p className="lede" {...annoText('spec.lede', 'Lede', { kind: 'prose' })}>
            A commenting layer that can be attached to any artifact we generate, so
            reviewers can respond to a specific part of it rather than to the whole thing.
          </p>

          <Summary />
          <Goals />

          <Section id="decisions" label="Decisions">
            <DecisionTable />
          </Section>

          <Section id="wireframe" label="Wireframe">
            <p {...annoText('spec.wireframe.caption', 'Wireframe caption', { kind: 'prose' })}>
              The panel below is live markup, not an image. Every control in it is a
              separate annotation target.
            </p>
            <Wireframe />
          </Section>

          <Reference />
          <OpenQuestions />
        </main>
      </div>
    </div>
  );
}

/* ---- CASE 7 (sticky) and CASES 4 + 8 (tiny target, conditional mount) ---- */
function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="doc-header" {...anno('doc.header', 'Document header', { semantic: { kind: 'section' } })}>
      <a className="crumb" href="#" {...anno('doc.header.back', 'Back to specs', { semantic: { kind: 'action' } })}>
        ◂ Specs
      </a>
      <span className="doc-header-title">Inline Comments for Artifacts</span>
      <span className="pill" {...anno('doc.header.version', 'Version', { semantic: { kind: 'status', value: 'v0.3' } })}>
        v0.3
      </span>

      <div className="menu-wrap">
        <button
          className="icon-btn"
          aria-label="More actions"
          onClick={() => setMenuOpen((v) => !v)}
          {...anno('doc.header.menu', 'More actions', { semantic: { kind: 'action' } })}
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="menu" {...anno('doc.header.menu.list', 'Actions menu', { semantic: { kind: 'section' } })}>
            {['Duplicate', 'Export', 'Archive'].map((item) => (
              <button
                key={item}
                className="menu-item"
                {...anno(`doc.header.menu.${item.toLowerCase()}`, item, { semantic: { kind: 'action' } })}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

function Sidebar() {
  return (
    <nav className="doc-side" {...anno('doc.toc', 'Table of contents', { semantic: { kind: 'section' } })}>
      <span className="side-label">Contents</span>
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          className="side-link"
          href={`#${s.id}`}
          {...anno(`doc.toc.${s.id}`, `Jump to ${s.label}`, { semantic: { kind: 'action' } })}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

function Section({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <section id={id} {...anno(`spec.${id}`, label, { semantic: { kind: 'section' } })}>
      <h2 {...annoText(`spec.${id}.heading`, `${label} heading`, { kind: 'heading' })}>{label}</h2>
      {children}
    </section>
  );
}

/* ---- CASE 5 — inline block targets inside a mode="text" paragraph -------- */
function Summary() {
  return (
    <Section id="summary" label="Summary">
      <p {...annoText('spec.summary.body', 'Summary prose', { kind: 'prose' })}>
        Reviewers select a part of an artifact and attach a comment to it. Targets are
        declared by the renderer, not discovered by the library: a node is annotatable
        only if it carries a{' '}
        <code {...anno('spec.summary.token', 'data-anno-id attribute', { semantic: { kind: 'token', value: 'data-anno-id' } })}>
          data-anno-id
        </code>{' '}
        attribute. Comments persist across revisions by id, and carry a semantic payload
        so they stay legible once the element is gone.{' '}
        <button className="inline-btn" {...anno('spec.summary.link', 'Learn more about anchoring', { semantic: { kind: 'action' } })}>
          Learn more
        </button>
      </p>
    </Section>
  );
}

function Goals() {
  const goals = [
    { id: 'g1', text: 'Comment on a specific element, not the whole page.' },
    { id: 'g2', text: 'Comments survive re-render and artifact revision.' },
    { id: 'g3', text: 'Comment bodies are free-form — text, reactions, tags.' },
    { id: 'g4', text: 'No backend required; annotations travel with the artifact.' },
  ];

  return (
    <Section id="goals" label="Goals">
      <ul className="goals">
        {goals.map((g) => (
          <li key={g.id} {...annoText(`spec.goals.${g.id}`, `Goal: ${g.text}`, { kind: 'list-item' })}>
            {g.text}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Reference() {
  return (
    <Section id="reference" label="Reference">
      <p {...annoText('spec.reference.caption', 'Reference caption', { kind: 'prose' })}>
        A mock screenshot of a commenting UI, for comparison. You can annotate a
        region of this figure, or try the dedicated image example below.
      </p>
      <figure {...annoRegion('spec.reference.figure', 'Prior art screenshot', { kind: 'figure' })}>
        <img src="/reference-screenshot.svg" alt="Mock screenshot of a commenting UI" width={640} height={360} />
        <figcaption {...annoText('spec.reference.figcaption', 'Figure caption', { kind: 'prose' })}>
          Fig 1. Pin-and-thread layout, as seen in existing tools.
        </figcaption>
      </figure>
      <ImageAnnotationExample />
    </Section>
  );
}

function ImageAnnotationExample() {
  return (
    <div className="image-annotation-example">
      <h3 {...annoText('spec.image-example.heading', 'Image annotation example heading', { kind: 'heading' })}>
        Try it: annotate an image
      </h3>
      <p {...annoText('spec.image-example.instructions', 'Image annotation instructions', { kind: 'prose' })}>
        Turn on <strong>Comment mode</strong>, then <strong>drag a rectangle</strong> over
        the headline or orange button in the image. Type your comment and press Enter
        to post it. In the shared app every comment is shared the moment it is posted, and the bot reads them in batches.
      </p>
      <figure>
        <img
          {...annoRegion('spec.image-example.image', 'Sample launch graphic', {
            kind: 'image', title: 'Northstar sample launch graphic', src: '/image-annotation-example.png',
          })}
          src="/image-annotation-example.png"
          alt="Fictional Northstar launch graphic: Make room for better ideas, an orange Explore the workspace button, and an illustrated chart."
          width={960}
          height={540}
          draggable={false}
        />
        <figcaption {...annoText('spec.image-example.caption', 'Image example caption', { kind: 'prose' })}>
          Fig 2. This is one PNG image: the text and button are pixels, not separate HTML
          controls. Your comment attaches to the rectangle you select, not to this caption.
        </figcaption>
      </figure>
    </div>
  );
}

function OpenQuestions() {
  const qs = [
    { id: 'q1', text: 'What happens to a comment whose target is conditionally unmounted?' },
    { id: 'q2', text: 'Should a text selection crossing a block target widen or split?' },
    { id: 'q3', text: 'Do pins clip to the nearest scroll container or the viewport?' },
  ];

  return (
    <Section id="open" label="Open questions">
      <ol className="open-qs">
        {qs.map((q) => (
          <li key={q.id} {...annoText(`spec.open.${q.id}`, `Open question: ${q.text}`, { kind: 'list-item' })}>
            {q.text}
          </li>
        ))}
      </ol>
    </Section>
  );
}
