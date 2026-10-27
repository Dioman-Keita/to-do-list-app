import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';

// La liste "À faire" (héritée de l'ancienne to-do list), version bout de papier scotché.
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
                <input
                  // La clé suit le texte : si l'enregistrement échoue, le champ se remonte avec l'ancien texte.
                  key={task.text}
                  className="task-text"
                  defaultValue={task.text}
                  aria-label="Tâche"
                  onBlur={(e) => {
                    const text = e.target.value.trim();
                    if (text && text !== task.text) update(task, { text });
                    else e.target.value = task.text;
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                {/* Copie invisible du texte : donne à la rature la largeur exacte des mots. */}
                <span className="task-measure" aria-hidden="true">
                  {task.text}
                <motion.svg className="strike" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                  <motion.path
                    d="M1 6 C 20 3, 40 8, 60 4 S 90 6, 99 4"
                    fill="none"
                    stroke="#33302b"
                    strokeWidth="1.6"
                    initial={false}
                    animate={{ pathLength: task.done ? 1 : 0 }}
                    transition={{ duration: 0.4 }}
                  />
                </motion.svg>
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
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="ajouter une tâche…" maxLength={200} />
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </motion.div>
  );
}
