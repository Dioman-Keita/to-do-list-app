import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import { api } from '../lib/api.js';
import {
  Big,
  Chapter,
  PageBreak,
  Spellcheck,
  blankPages,
  buildSpellDecorations,
  docToText,
  dropExtraBlankPages,
  fixColumnHitTesting,
  legacyToDoc,
  spellKey,
} from '../editor/extensions.js';

const LINE = 30; // hauteur d'une ligne du carnet (px), à garder égale au CSS
const GAP = 48; // espace (invisible) entre deux pages
const MIN_LINES = 6;
const HIGHLIGHTS = [
  { color: '#f6df4f', label: 'Surligner en jaune' },
  { color: '#f7a8c9', label: 'Surligner en rose' },
  { color: '#9fd8f0', label: 'Surligner en bleu' },
];
const STATUS_TEXT = { dirty: '…', saving: 'j’écris…', saved: 'enregistré ✓', error: 'pas enregistré ✗' };

const nowTime = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/**
 * Le texte du jour, présenté comme un vrai carnet : une page à la fois, sans défilement.
 * Techniquement un seul document mis en colonnes CSS (une colonne = une page) : le texte
 * passe tout seul à la page suivante, et on fait glisser la vue de page en page.
 */
export default function JournalEditor({ content, legacyBody, isToday, status, onChange }) {
  const frameRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [geom, setGeom] = useState(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [chapters, setChapters] = useState([]);
  const [menu, setMenu] = useState(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [spellOn, setSpellOn] = useState(true);
  const spell = useRef({ timer: null, ignored: new Set() });
  const layout = useRef({ stride: 0, page: 0 });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false, code: false, codeBlock: false, blockquote: false }),
      Chapter,
      PageBreak,
      Underline,
      Highlight.configure({ multicolor: true }),
      Big,
      Spellcheck,
      Placeholder.configure({ placeholder: 'Cher journal, aujourd’hui…' }),
    ],
    content: content ?? legacyToDoc(legacyBody),
    shouldRerenderOnTransaction: true,
    editorProps: {
      // Le correcteur du navigateur sert de secours tant que LanguageTool ne répond pas.
      attributes: { class: 'journal-pages', lang: 'fr', spellcheck: 'true' },
      // Pas de défilement automatique : c'est nous qui tournons les pages.
      handleScrollToSelection: () => true,
      handleDOMEvents: { contextmenu: (view, event) => openSpellMenu(view, event) },
    },
    onUpdate: ({ editor: ed }) => {
      onChangeRef.current(ed.getJSON(), ed.getText({ blockSeparator: '\n' }));
      measure();
      scheduleCheck(1200);
    },
    onCreate: ({ editor: ed }) => {
      fixColumnHitTesting(ed.view);
      // Journées écrites avant la limite : on ne garde qu'une page vierge.
      const cleanup = dropExtraBlankPages(ed.state);
      if (cleanup) ed.view.dispatch(cleanup);
    },
    onSelectionUpdate: () => followCaret(),
  });

  // Les fonctions ci-dessous sont appelées depuis des callbacks créés au premier rendu :
  // elles lisent toujours l'instance courante via ce ref (StrictMode peut recréer l'éditeur).
  const edRef = useRef(null);
  edRef.current = editor;
  const live = () => (edRef.current && !edRef.current.isDestroyed ? edRef.current : null);

  // ---------- Pages ----------

  const dom = () => live()?.view.dom ?? null;

  function showPage(p) {
    const el = dom();
    if (!el) return;
    layout.current.page = p;
    el.scrollLeft = p * layout.current.stride;
    setPage(p);
  }

  function pageOf(x) {
    return Math.max(0, Math.floor(x / layout.current.stride));
  }

  function measure() {
    const el = dom();
    if (!el || !layout.current.stride) return;
    const count = Math.max(1, Math.round((el.scrollWidth + GAP) / layout.current.stride));
    setPageCount(count);
    const base = el.getBoundingClientRect().left - el.scrollLeft;
    setChapters(
      [...el.querySelectorAll('h2')].map((h, i) => ({
        title: h.textContent.trim() || `Chapitre ${i + 1}`,
        time: h.getAttribute('data-time'),
        page: pageOf(h.getBoundingClientRect().left - base + 1),
        node: h,
      }))
    );
  }

  // La page affichée suit le curseur (quand on écrit au-delà du bas de la page, on passe à la suivante).
  function followCaret() {
    const editor = live();
    if (!editor) return;
    const el = dom();
    if (!el || !layout.current.stride) return;
    const { head } = editor.state.selection;
    const base = el.getBoundingClientRect().left - el.scrollLeft;
    // À la frontière de deux pages (juste après la dernière lettre d'une page = juste avant
    // la première de la suivante), le curseur appartient aux deux : le navigateur peut le
    // situer en fin de page précédente. On ne tourne la page que si le curseur ne peut pas
    // être sur la page affichée ; sinon, on va du côté « après » (celui où l'on écrit).
    const pages = [];
    for (const side of [-1, 1]) {
      try {
        pages.push(pageOf(editor.view.coordsAtPos(head, side).left - base));
      } catch {
        /* position sans rendu (ex. entre deux blocs) */
      }
    }
    if (!pages.length || pages.includes(layout.current.page)) return;
    showPage(pages[pages.length - 1]);
  }

  // Aller à une page et y placer le curseur (en haut de la page).
  function goTo(p) {
    const editor = live();
    if (!editor) return;
    const el = dom();
    if (!el) return;
    const target = Math.min(Math.max(p, 0), pageCount - 1);
    showPage(target);
    const rect = el.getBoundingClientRect();
    const hit = editor.view.posAtCoords({ left: rect.left + 60, top: rect.top + 8 });
    // Ne poser le curseur que s'il tombe bien sur cette page (sinon le carnet le suivrait ailleurs).
    const onPage = hit && pageOf(editor.view.coordsAtPos(hit.pos).left - (rect.left - el.scrollLeft)) === target;
    if (onPage) editor.chain().focus().setTextSelection(hit.pos).run();
  }

  // Taille d'une page : largeur du cadre, hauteur arrondie à un nombre entier de lignes.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const ro = new ResizeObserver(() => {
      const w = Math.floor(frame.clientWidth);
      const h = Math.max(MIN_LINES, Math.floor(frame.clientHeight / LINE)) * LINE;
      setGeom((g) => (g && g.w === w && g.h === h ? g : { w, h }));
    });
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!geom || !editor) return;
    layout.current.stride = geom.w + GAP;
    const el = dom();
    if (!el) return;
    el.scrollLeft = layout.current.page * layout.current.stride;
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom, editor]);

  // Le navigateur peut décaler la vue tout seul (sélection à la souris…) : on la recale sur une page.
  useEffect(() => {
    const el = dom();
    if (!el) return undefined;
    // On remet seulement la feuille sur la page affichée, sans jamais « suivre le curseur » ici :
    // au premier clic, le navigateur fait défiler vers l'ANCIEN curseur avant de placer le
    // nouveau, et suivre ce curseur périmé renvoyait à une page précédente. Tolérance de 1 px :
    // avec un zoom à 125 % / 150 %, scrollLeft est arrondi (3072,67 au lieu de 3073).
    const snap = () => {
      const want = layout.current.page * layout.current.stride;
      if (Math.abs(el.scrollLeft - want) > 1) el.scrollLeft = want;
    };
    el.addEventListener('scroll', snap);
    return () => el.removeEventListener('scroll', snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ---------- Chapitres et pages ----------

  function addChapter() {
    const editor = live();
    if (!editor) return;
    const { doc } = editor.state;
    const last = doc.lastChild;
    const attrs = { level: 2, time: isToday ? nowTime() : null };
    if (last?.type.name === 'paragraph' && last.content.size === 0) {
      editor.chain().focus('end').setNode('heading', attrs).run();
    } else {
      const end = doc.content.size;
      editor.chain().insertContentAt(end, { type: 'heading', attrs }).setTextSelection(end + 1).focus().run();
    }
  }

  // `atEnd` : bouton « nouvelle page + » du bas, affiché sur la dernière page -> à la fin.
  // Sinon (barre d'outils, Ctrl+Entrée) : après le bloc où se trouve le curseur.
  function newPage(atEnd) {
    const editor = live();
    if (!editor) return;
    if (atEnd) editor.commands.focus('end');
    else if (!editor.isFocused) editor.commands.focus();
    editor.commands.insertPage();
  }

  function jumpToChapter(ch) {
    const editor = live();
    if (!editor) return;
    setTocOpen(false);
    const pos = editor.view.posAtDOM(ch.node, 0);
    showPage(ch.page);
    editor.chain().focus().setTextSelection(pos + ch.node.textContent.length).run();
  }

  // ---------- Correcteur ----------

  function scheduleCheck(delay) {
    clearTimeout(spell.current.timer);
    spell.current.timer = setTimeout(runCheck, delay);
  }

  async function runCheck() {
    const editor = live();
    if (!editor) return;
    const doc = editor.state.doc;
    const { text, segments } = docToText(doc);
    try {
      const { matches } = await api.spellcheck(text);
      if (editor.isDestroyed) return;
      if (editor.state.doc !== doc) return scheduleCheck(600); // texte modifié entre-temps
      const kept = matches.filter((m) => !spell.current.ignored.has(m.word.toLowerCase()));
      editor.view.dispatch(editor.state.tr.setMeta(spellKey, buildSpellDecorations(doc, segments, kept)));
      setSpellOn(true);
      editor.view.dom.setAttribute('spellcheck', 'false');
    } catch {
      // LanguageTool absent ou en démarrage : correcteur du navigateur, nouvel essai plus tard.
      if (editor.isDestroyed) return;
      setSpellOn(false);
      editor.view.dom.setAttribute('spellcheck', 'true');
      scheduleCheck(60000);
    }
  }

  useEffect(() => {
    if (!editor) return undefined;
    scheduleCheck(300);
    return () => clearTimeout(spell.current.timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  function openSpellMenu(view, event) {
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!hit) return false;
    const found = spellKey.getState(view.state).find(hit.pos, hit.pos);
    if (!found.length) return false;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, deco: found[0] });
    return true;
  }

  function removeDecorations(predicate) {
    const editor = live();
    if (!editor) return;
    const set = spellKey.getState(editor.state);
    const gone = set.find().filter(predicate);
    editor.view.dispatch(editor.state.tr.setMeta(spellKey, set.remove(gone)));
  }

  function applySuggestion(value) {
    const editor = live();
    if (!editor) return;
    const { from, to } = menu.deco;
    removeDecorations((d) => d.from === from && d.to === to);
    editor.chain().focus().insertContentAt({ from, to }, value).run();
    setMenu(null);
  }

  async function ignoreWord(permanent) {
    const editor = live();
    if (!editor) return;
    const word = menu.deco.spec.match.word.toLowerCase();
    spell.current.ignored.add(word);
    removeDecorations((d) => d.spec.match.word.toLowerCase() === word);
    setMenu(null);
    if (permanent) await api.addWord(word).catch(() => {});
    editor.commands.focus();
  }

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => e.type === 'keydown' ? e.key === 'Escape' && setMenu(null) : !e.target.closest?.('.spell-menu') && setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  useEffect(() => {
    if (!tocOpen) return undefined;
    const close = (e) => (e.type === 'keydown' ? e.key === 'Escape' && setTocOpen(false) : !e.target.closest?.('.pager-mid') && setTocOpen(false));
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [tocOpen]);

  // ---------- Rendu ----------

  // Une seule page vierge : sur elle, plus de bouton « nouvelle page » (la suivante
  // se créera toute seule quand celle-ci sera pleine).
  const blank = editor ? blankPages(editor.state.doc)[0] : null;
  const onBlankPage = !!blank && editor.state.selection.from >= blank.breakPos && editor.state.selection.from <= blank.end;
  const lastIsBlank = !!blank && blank.end === editor.state.doc.content.size;
  const BLANK_HINT = 'Écris d’abord sur la page vierge : la suivante se créera toute seule';

  const btn = (label, title, active, onClick, className = '', disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      className={`fmt ${active ? 'active' : ''} ${className}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} // garder la sélection dans le texte
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="journal-editor">
      {editor && (
        <div className="fmt-bar" role="toolbar" aria-label="Mise en forme">
          {btn(<b>G</b>, 'Gras (Ctrl+B)', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
          {btn(<i>I</i>, 'Italique (Ctrl+I)', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
          {btn(<u>S</u>, 'Souligné (Ctrl+U)', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run())}
          {btn(<s>B</s>, 'Barré', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run())}
          {btn(<span className="fmt-big">A</span>, 'Texte en grand', editor.isActive('big'), () => editor.chain().focus().toggleBig().run())}
          <span className="fmt-sep" />
          {HIGHLIGHTS.map((h) =>
            btn(
              <span className="fmt-swatch" style={{ background: h.color }} />,
              h.label,
              editor.isActive('highlight', { color: h.color }),
              () => editor.chain().focus().toggleHighlight({ color: h.color }).run(),
              'fmt-hl'
            )
          )}
          <span className="fmt-sep" />
          {btn('+ Chapitre', 'Commencer un nouveau chapitre', false, addChapter, 'fmt-text')}
          {btn(
            '+ Page',
            onBlankPage ? BLANK_HINT : blank ? 'Aller à la page vierge (Ctrl+Entrée)' : 'Passer à une nouvelle page (Ctrl+Entrée)',
            false,
            () => newPage(false),
            'fmt-text',
            onBlankPage
          )}
        </div>
      )}

      <div
        className="pages-frame"
        ref={frameRef}
        style={geom ? { '--page-w': `${geom.w}px`, '--page-h': `${geom.h}px`, '--stride': `${geom.w + GAP}px` } : undefined}
      >
        <EditorContent editor={editor} />
        <AnimatePresence initial={false}>
          <motion.span
            key={page}
            className="page-turn"
            aria-hidden="true"
            initial={{ opacity: 0.55, x: '0%' }}
            animate={{ opacity: 0, x: '100%' }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          />
        </AnimatePresence>
      </div>

      <div className="pager">
        <button type="button" onClick={() => goTo(page - 1)} disabled={page === 0} aria-label="Page précédente">
          ← précédente
        </button>
        <span className="pager-mid">
          {page + 1} / {pageCount}
          {chapters.length > 0 && (
            <button type="button" className="toc-toggle" aria-expanded={tocOpen} onClick={() => setTocOpen((o) => !o)}>
              sommaire ({chapters.length})
            </button>
          )}
          {!spellOn && (
            <small className="spell-off" title="LanguageTool ne répond pas : le correcteur du navigateur est utilisé">
              ✎?
            </small>
          )}
          {tocOpen && chapters.length > 0 && (
            <nav className="toc" aria-label="Chapitres du jour">
              {chapters.map((ch, i) => (
                <button key={i} type="button" className={ch.page === page ? 'current' : ''} onClick={() => jumpToChapter(ch)}>
                  <span className="chapter-num">{i + 1}.</span> {ch.title}
                  <small>
                    {ch.time ? ` ${ch.time} · ` : ' '}p. {ch.page + 1}
                  </small>
                </button>
              ))}
            </nav>
          )}
        </span>
        <button
          type="button"
          onClick={() => (page >= pageCount - 1 ? newPage(true) : goTo(page + 1))}
          disabled={page >= pageCount - 1 && lastIsBlank}
          title={page >= pageCount - 1 && lastIsBlank ? BLANK_HINT : undefined}
          aria-label="Page suivante"
        >
          {page >= pageCount - 1 ? 'nouvelle page +' : 'suivante →'}
        </button>
      </div>

      <span className={`save-status ${status}`} aria-live="polite">
        {STATUS_TEXT[status] || ''}
      </span>

      {menu && (
        <div className="spell-menu" style={{ left: Math.min(menu.x, window.innerWidth - 260), top: Math.min(menu.y + 8, window.innerHeight - 260) }} role="menu">
          <p className="spell-message">{menu.deco.spec.match.message}</p>
          {menu.deco.spec.match.replacements.length ? (
            menu.deco.spec.match.replacements.map((r) => (
              <button key={r} type="button" className="spell-suggestion" onClick={() => applySuggestion(r)}>
                {r}
              </button>
            ))
          ) : (
            <p className="spell-none">Aucune suggestion</p>
          )}
          <hr />
          <button type="button" onClick={() => ignoreWord(false)}>
            Ignorer
          </button>
          {menu.deco.spec.match.type === 'spelling' && (
            <button type="button" onClick={() => ignoreWord(true)}>
              Ajouter au dictionnaire
            </button>
          )}
        </div>
      )}
    </div>
  );
}
