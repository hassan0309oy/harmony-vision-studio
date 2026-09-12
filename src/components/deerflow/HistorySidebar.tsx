import { FolderPlus, MessageSquarePlus, Trash2, X } from "lucide-react";
import { useState } from "react";

export type ConversationItem = {
  id: string;
  title: string;
  project_id: string | null;
  updated_at: string;
};
export type ProjectItem = { id: string; name: string; created_at: string };

export function HistorySidebar(props: {
  open: boolean;
  onClose: () => void;
  projects: ProjectItem[];
  conversations: ConversationItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: (projectId: string | null) => void;
  onNewProject: (name: string) => void;
  onDeleteConversation: (id: string) => void;
  onDeleteProject: (id: string) => void;
}) {
  const [newProject, setNewProject] = useState("");
  const loose = props.conversations.filter((c) => !c.project_id);

  return (
    <aside
      className={`${props.open ? "fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw]" : "hidden"} shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-sidebar p-3 lg:static lg:flex lg:w-64`}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => props.onNew(null)}
          className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs hover:bg-accent"
        >
          <MessageSquarePlus className="size-3.5" /> Nouvelle conversation
        </button>
        <button onClick={props.onClose} className="text-muted-foreground lg:hidden" aria-label="Fermer">
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-1">
        <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Historique
        </p>
        {loose.length === 0 && (
          <p className="px-1 text-[11px] text-muted-foreground">Aucune conversation.</p>
        )}
        {loose.map((c) => (
          <Row
            key={c.id}
            label={c.title}
            active={c.id === props.activeId}
            onSelect={() => props.onSelect(c.id)}
            onDelete={() => props.onDeleteConversation(c.id)}
          />
        ))}
      </div>

      <div className="space-y-2">
        <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Projets
        </p>
        {props.projects.map((p) => (
          <div key={p.id} className="space-y-1">
            <div className="flex items-center gap-1">
              <span className="flex-1 truncate px-1 text-xs font-medium">{p.name}</span>
              <button
                onClick={() => props.onNew(p.id)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={`Nouvelle conversation dans ${p.name}`}
              >
                <MessageSquarePlus className="size-3.5" />
              </button>
              <button
                onClick={() => props.onDeleteProject(p.id)}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                aria-label={`Supprimer ${p.name}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="space-y-1 pl-2">
              {props.conversations
                .filter((c) => c.project_id === p.id)
                .map((c) => (
                  <Row
                    key={c.id}
                    label={c.title}
                    active={c.id === props.activeId}
                    onSelect={() => props.onSelect(c.id)}
                    onDelete={() => props.onDeleteConversation(c.id)}
                  />
                ))}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-1 px-1">
          <input
            value={newProject}
            onChange={(e) => setNewProject(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newProject.trim()) {
                props.onNewProject(newProject.trim());
                setNewProject("");
              }
            }}
            placeholder="Nouveau projet"
            className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => {
              if (!newProject.trim()) return;
              props.onNewProject(newProject.trim());
              setNewProject("");
            }}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Créer le projet"
          >
            <FolderPlus className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function Row(props: {
  label: string;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${props.active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
    >
      <button onClick={props.onSelect} className="min-w-0 flex-1 truncate text-left">
        {props.label}
      </button>
      <button
        onClick={props.onDelete}
        className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
        aria-label="Supprimer la conversation"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
