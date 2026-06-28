import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import Overview from './components/pages/Overview.jsx';
import CalendarPage from './components/pages/CalendarPage.jsx';
import GanttPage from './components/pages/GanttPage.jsx';
import TasksPage from './components/pages/TasksPage.jsx';
import TeamPage from './components/pages/TeamPage.jsx';
import TaskEditModal from './components/ui/TaskEditModal.jsx';
import RestoreFromAudit from './components/ui/RestoreFromAudit.jsx';
import { useFocusedTask, closeTask } from './lib/taskFocus.js';

const PAGES = {
  overview: Overview,
  gantt:    GanttPage,
  calendar: CalendarPage,
  tasks:    TasksPage,
  team:     TeamPage,
};

const KEY_TO_PAGE = { '1': 'overview', '2': 'gantt', '3': 'calendar', '4': 'tasks', '5': 'team' };

export default function App() {
  const [page, setPage] = useState('overview');
  const Page = PAGES[page];
  const focusedTaskId = useFocusedTask();

  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      const next = KEY_TO_PAGE[e.key];
      if (next) setPage(next);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full bg-canvas">
      <Sidebar page={page} setPage={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar page={page} onJump={setPage} />
        <main key={page} className="flex-1 overflow-auto bg-canvas animate-fade-in">
          <div className="mx-auto max-w-[1440px] px-6 py-6 lg:px-8 lg:py-8">
            <Page />
          </div>
        </main>
      </div>
      {focusedTaskId && (
        <TaskEditModal taskId={focusedTaskId} onClose={closeTask} />
      )}
      <RestoreFromAudit />
    </div>
  );
}
