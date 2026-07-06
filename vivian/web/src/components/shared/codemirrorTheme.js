import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const theme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontSize: '13px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
    lineHeight: '1.5',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text-dim)',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--border-subtle)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--text-primary)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(88, 166, 255, 0.2)',
  },
  '.cm-content ::selection': {
    backgroundColor: 'rgba(88, 166, 255, 0.2)',
  },
  '.cm-placeholder': {
    color: 'var(--text-dim)',
  },
  '.cm-error-gutter': {
    width: '16px',
  },
  '.cm-error-gutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0',
  },
  /* Lint diagnostic styling */
  '.cm-diagnostic': {
    fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
    fontSize: '12px',
    padding: '4px 8px',
    borderRadius: '0',
  },
  '.cm-diagnostic-error': {
    borderLeft: '2px solid var(--red)',
    color: 'var(--text-primary)',
  },
  '.cm-diagnostic-warning': {
    borderLeft: '2px solid var(--yellow)',
    color: 'var(--text-primary)',
  },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--red)',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--yellow)',
    textUnderlineOffset: '3px',
  },
  '.cm-panel.cm-panel-lint': {
    backgroundColor: 'var(--bg-surface)',
    borderTop: '1px solid var(--border)',
  },
  '.cm-panel.cm-panel-lint ul': {
    maxHeight: '80px',
  },
  '.cm-panel.cm-panel-lint ul [aria-selected]': {
    backgroundColor: 'var(--bg-elevated)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: '2px',
  },
  '.cm-lint-marker-error': {
    content: '"●"',
    color: 'var(--red)',
  },
  '.cm-lint-marker-warning': {
    content: '"●"',
    color: 'var(--yellow)',
  },
})

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--syntax-comment)' },
  { tag: tags.lineComment, color: 'var(--syntax-comment)' },
  { tag: tags.blockComment, color: 'var(--syntax-comment)' },
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--syntax-keyword)' },
  { tag: tags.operatorKeyword, color: 'var(--syntax-keyword)' },
  { tag: tags.definitionKeyword, color: 'var(--syntax-keyword)' },
  { tag: tags.moduleKeyword, color: 'var(--syntax-keyword)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.special(tags.string), color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.bool, color: 'var(--syntax-number)' },
  { tag: tags.null, color: 'var(--syntax-number)' },
  { tag: tags.function(tags.definition(tags.variableName)), color: 'var(--syntax-title)' },
  { tag: tags.function(tags.variableName), color: 'var(--syntax-title)' },
  { tag: tags.variableName, color: 'var(--syntax-variable)' },
  { tag: tags.propertyName, color: 'var(--syntax-attribute)' },
  { tag: tags.className, color: 'var(--syntax-built-in)' },
  { tag: tags.typeName, color: 'var(--syntax-built-in)' },
  { tag: tags.standard(tags.variableName), color: 'var(--syntax-built-in)' },
  { tag: tags.meta, color: 'var(--syntax-meta)' },
  { tag: tags.operator, color: 'var(--syntax-subst)' },
  { tag: tags.punctuation, color: 'var(--syntax-subst)' },
  { tag: tags.paren, color: 'var(--syntax-subst)' },
  { tag: tags.squareBracket, color: 'var(--syntax-subst)' },
  { tag: tags.brace, color: 'var(--syntax-subst)' },
  { tag: tags.self, color: 'var(--syntax-keyword)' },
  { tag: tags.atom, color: 'var(--syntax-number)' },
])

export const vivianTheme = [theme, syntaxHighlighting(highlightStyle)]
