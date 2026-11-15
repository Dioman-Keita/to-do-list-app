import { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';

export const TASK_MAX = 1000;
const LINE = 34; // interligne du bout de papier (à garder égal au CSS)

// Une tâche est une seule phrase : les retours à la ligne collés deviennent des espaces.
const oneLine = (text) => text.replace(/\s*\n\s*/g, ' ');

// Champ qui passe à la ligne et grandit d'une ligne du papier à la fois.
function fit(el) {
  if (!el) return;
  el.style.height = '0px';
  el.style.height = `${Math.max(1, Math.round(el.scrollHeight / LINE)) * LINE}px`;
}

function TaskField({ value, onChange, className, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => fit(ref.current));
  return (
    <textarea
      ref={ref}
      rows={1}
      maxLength={TASK_MAX}
      className={className}
      value={value}
      onChange={(e) => {
        onChange(oneLine(e.target.value));
        fit(e.target);
      }}
      {...props}
    />
  );
}

// La liste "À faire" (héritée de l'ancienne to-do list), version bout de papier scotché.
// Les tâches longues passent à la ligne, sur les lignes du papier.
export default function TaskList({ day, tasks, setTasks }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const doneCount = tasks.filter((t) => t.done).length;

  async function add(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setError('');
    try {
      const created = await api.addTask(day, text);
      setTasks((ts) => [...ts, created]);
    } catch (err) {
      setDraft(text);
      setError(`Tâche non ajoutée : ${err.message}`);
    }
  }

  async function update(task, patch) {
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, ...patch } : t)));
    try {
      await api.updateTask(task.id, patch);
      setError('');
    } catch (err) {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? task : t)));
      setError(`Modification non enregistrée : ${err.message}`);
    }
  }

  async function remove(task) {
    setTasks((ts) => ts.filter((t) => t.id !== task.id));
    await api.deleteTask(task.id).catch((err) => {
      setTasks((ts) => [...ts, task]);
      setError(`Tâche non supprimée : ${err.message}`);
    });
  }

  return (
    <motion.div className="scrap tasks" initial={{ opacity: 0, y: 20, rotate: 2 }} animate={{ opacity: 1, y: 0, rotate: 1 }}>
      <span className="tape tape-top" />
      <h2 className="hand-title">
        À faire
        {tasks.length > 0 && (
          <span className="task-count">
            {doneCount}/{tasks.length}
          </span>
        )}
      </h2>
      <ul>
        <AnimatePresence initial={false}>
          {tasks.map((task) => (
            <motion.li
              key={task.id}
              layout
              className={task.done ? 'done' : ''}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 30, transition: { duration: 0.2 } }}
            >
              <button type="button" className="check" aria-pressed={task.done} aria-label="Fait" onClick={() => update(task, { done: !task.done })}>
                <svg viewBox="0 0 32 32" aria-hidden="true">
                  <path d="M5 6 L27 4.5 L26 27 L6 27.5 Z" fill="none" stroke="currentColor" strokeWidth="2" filter="url(#rough)" />
                  <motion.path
                    d="M8 16 L14 23 L29 2"
                    fill="none"
                    stroke="#d2407a"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    initial={false}
                    animate={{ pathLength: task.done ? 1 : 0, opacity: task.done ? 1 : 0 }}
                    transition={{ duration: 0.35 }}
                  />
                </svg>
              </button>
              <span className="task-text-wrap">
                {/* La clé suit le texte : si l'enregistrement échoue, le champ revient à l'ancien texte. */}
                <TaskText key={task.text} task={task} onSave={(text) => update(task, { text })} />
                {/* Copie invisible du texte, posée sur le champ : la rature suit chaque ligne écrite. */}
                <span className="task-measure" aria-hidden="true">
                  <span className="task-ink">{task.text}</span>
                </span>
              </span>
              <button type="button" className="task-delete" aria-label="Supprimer" onClick={() => remove(task)}>
                ×
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <form onSubmit={add} className="task-add">
        <span aria-hidden="true">+</span>
        <TaskField
          className="task-add-text"
          value={draft}
          onChange={setDraft}
          placeholder="ajouter une tâche…"
          aria-label="Nouvelle tâche"
          onKeyDown={(e) => {
            if (e.key === 'Enter') add(e); // Entrée ajoute la tâche ; le texte long passe à la ligne tout seul
          }}
        />
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </motion.div>
  );
}

// Texte d'une tâche existante : modifiable sur place, enregistré en quittant le champ (ou Entrée).
function TaskText({ task, onSave }) {
  const [text, setText] = useState(task.text);
  return (
    <TaskField
      className="task-text"
      value={text}
      onChange={setText}
      aria-label="Tâche"
      onBlur={() => {
        const next = text.trim();
        if (next && next !== task.text) onSave(next);
        else setText(task.text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          setText(task.text);
          requestAnimationFrame(() => document.activeElement?.blur());
        }
      }}
    />
  );
}
