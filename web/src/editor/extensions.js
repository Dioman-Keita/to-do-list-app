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
// Reprend la logique d'insertion de HorizontalRule (paragraphe ajouté si besoin).
export const PageBreak = HorizontalRule.extend({
  name: 'pageBreak',
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: () => ['div', { 'data-page-break': '', class: 'page-break' }],
  addInputRules: () => [],
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setHorizontalRule() };
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

// Ancien texte brut (avant les pages) -> document : une ligne = un paragraphe.
export function legacyToDoc(body) {
  if (!body) return null;
  return {
    type: 'doc',
    content: body.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  };
}
