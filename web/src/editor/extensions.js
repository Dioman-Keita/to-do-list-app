import { Extension, Mark, mergeAttributes } from '@tiptap/react';
import Heading from '@tiptap/extension-heading';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Titre de chapitre (h2) avec l'heure à laquelle il a été commencé.
export const Chapter = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      time: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-time'),
        renderHTML: (attrs) => (attrs.time ? { 'data-time': attrs.time } : {}),
      },
    };
  },
}).configure({ levels: [2] });

// Saut de page : le texte qui suit commence en haut de la page suivante.
export const PageBreak = HorizontalRule.extend({
  name: 'pageBreak',
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: () => ['div', { 'data-page-break': '', class: 'page-break' }],
  addInputRules: () => [],
  addCommands() {
    return {
      ...this.parent?.(),
      // Nouvelle page APRÈS le bloc en cours, toujours avec une ligne prête à écrire
      // (une page faite seulement de sauts n'aurait aucun endroit où poser le curseur).
      insertPage:
        () =>
        ({ state, chain }) => {
          const { selection, doc } = state;
          const { $from } = selection;
          const top = $from.depth > 0 ? $from.index(0) : null;
          const block = top != null ? doc.child(top) : null;
          const previous = top > 0 ? doc.child(top - 1) : null;
          // Déjà sur une page vierge (ligne vide juste après un saut) : on y reste.
          if (block?.type.name === 'paragraph' && block.content.size === 0 && previous?.type.name === this.name) {
            return chain().focus().run();
          }
          const after = $from.depth > 0 ? $from.after(1) : selection.to;
          return chain()
            .insertContentAt(after, [{ type: this.name }, { type: 'paragraph' }])
            .setTextSelection(after + 2)
            .focus()
            .run();
        },
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.insertPage() };
  },
});

// Texte en grand (reste aligné sur les lignes du carnet).
export const Big = Mark.create({
  name: 'big',
  parseHTML: () => [{ tag: 'span.big' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: 'big' }), 0],
  addCommands() {
    return { toggleBig: () => ({ commands }) => commands.toggleMark(this.name) };
  },
});

// ---- Correcteur : les fautes sont des décorations (soulignement), jamais du contenu ----

export const spellKey = new PluginKey('spellcheck');

export const Spellcheck = Extension.create({
  name: 'spellcheck',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: spellKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const next = tr.getMeta(spellKey);
            return next || set.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations: (state) => spellKey.getState(state) },
      }),
    ];
  },
});

// Texte envoyé au correcteur + correspondance position texte -> position document.
export function docToText(doc) {
  let text = '';
  const segments = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (text.length) text += '\n\n';
    node.forEach((child, offset) => {
      if (child.isText) {
        segments.push({ start: text.length, pos: pos + 1 + offset, len: child.text.length });
        text += child.text;
      } else {
        text += ' ';
      }
    });
    return false;
  });
  return { text, segments };
}

function textToPos(segments, offset) {
  const seg = segments.find((s) => offset >= s.start && offset <= s.start + s.len);
  return seg ? seg.pos + (offset - seg.start) : null;
}

export function buildSpellDecorations(doc, segments, matches) {
  const decorations = [];
  for (const match of matches) {
    const from = textToPos(segments, match.offset);
    const to = textToPos(segments, match.offset + match.length);
    if (from == null || to == null || to <= from) continue;
    decorations.push(
      Decoration.inline(from, to, { class: match.type === 'spelling' ? 'spell-error' : 'grammar-error' }, { match })
    );
  }
  return DecorationSet.create(doc, decorations);
}

// ---- Clics dans un texte en colonnes ----
// ProseMirror calcule la position d'un clic avec la boîte englobante des paragraphes.
// En colonnes, un paragraphe qui continue sur la page suivante a une boîte qui couvre
// plusieurs pages : un clic sur la page 3 pouvait placer le curseur en page 1 (et le
// carnet revenait en arrière). Le test de position natif du navigateur, lui, connaît
// les colonnes : on l'utilise d'abord, et on garde le calcul de ProseMirror en secours.
export function fixColumnHitTesting(view) {
  const original = view.posAtCoords.bind(view);
  view.posAtCoords = (coords) => nativePosAtCoords(view, coords) ?? original(coords);
}

function nativePosAtCoords(view, { left, top }) {
  const doc = view.dom.ownerDocument;
  let node;
  let offset;
  if (doc.caretPositionFromPoint) {
    const caret = doc.caretPositionFromPoint(left, top);
    if (!caret) return null;
    ({ offsetNode: node, offset } = caret);
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(left, top);
    if (!range) return null;
    ({ startContainer: node, startOffset: offset } = range);
  } else {
    return null;
  }
  if (!node || !view.dom.contains(node)) return null;
  let pos;
  try {
    pos = view.posAtDOM(node, offset);
  } catch {
    return null;
  }
  if (pos < 0 || pos > view.state.doc.content.size) return null;
  const $pos = view.state.doc.resolve(pos);
  return { pos, inside: $pos.depth > 0 ? $pos.before() : -1 };
}

// Ancien texte brut (avant les pages) -> document : une ligne = un paragraphe.
export function legacyToDoc(body) {
  if (!body) return null;
  return {
    type: 'doc',
    content: body.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  };
}
